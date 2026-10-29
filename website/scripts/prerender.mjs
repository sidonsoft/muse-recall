#!/usr/bin/env node
// Pre-render the React app into dist/index.html so the built site works as
// static HTML: crawlers, link-preview bots, and JS-disabled readers all see the
// full page. Client scripts still load and take over (progressive enhancement).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = process.cwd();

execFileSync('npx', ['vite', 'build', '--ssr', 'src/ssr.jsx', '--outDir', 'dist-ssr'], {
  stdio: 'inherit',
  cwd: ROOT,
});

const { render } = await import(pathToFileURL(path.join(ROOT, 'dist-ssr', 'ssr.js')).href);
const appHtml = render();

if (!appHtml.includes('<h1') || appHtml.length < 20000) {
  console.error('prerender: suspicious output, aborting', {
    hasH1: appHtml.includes('<h1'),
    length: appHtml.length,
  });
  process.exit(1);
}

const file = path.join(ROOT, 'dist', 'index.html');
let html = readFileSync(file, 'utf8');
if (!html.includes('<div id="root"></div>')) {
  console.error('prerender: root placeholder not found in dist/index.html');
  process.exit(1);
}
html = html.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);

// Inline the built stylesheet: one fewer render-blocking request.
const linkRe = /<link rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/;
const m = html.match(linkRe);
if (m) {
  const cssFile = path.join(ROOT, 'dist', m[1].replace(/^\.\//, ''));
  const css = readFileSync(cssFile, 'utf8');
  html = html.replace(m[0], `<style>\n${css}\n</style>`);
  console.log(`prerender: inlined stylesheet (${(css.length / 1024).toFixed(1)} KB)`);
}

writeFileSync(file, html);
rmSync(path.join(ROOT, 'dist-ssr'), { recursive: true, force: true });

console.log(`prerender: inlined ${appHtml.length} chars of static HTML into dist/index.html`);
