#!/usr/bin/env node
// Site QA — no dependencies beyond Node 22+ (global fetch/WebSocket) and headless Chrome.
//
// Runs `vite preview`, attaches over CDP and asserts:
//   1. a11y: single h1, no heading skips, alt text on all imgs, accessible names, landmarks
//   2. mobile (390px): no horizontal overflow (scrollWidth === 390)
//   3. interactive widget: all three memory states behave correctly
//   4. vitals thresholds: LCP < 2500ms, CLS < 0.1
//
// Usage: npm run build && npm run qa         (finds Chrome automatically)
//        CHROME_PATH=/path/to/chrome npm run qa

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const PREVIEW_PORT = 4173;
const CDP_PORT = 9334;
const URL_ = `http://localhost:${PREVIEW_PORT}/`;

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const fixed = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const p of fixed) if (fs.existsSync(p)) return p;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const r = spawnSync('which', [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  console.error('qa: no Chrome found (set CHROME_PATH)');
  process.exit(1);
}

const children = [];
const cleanup = () => {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {}
  }
};
process.on('exit', cleanup);

const preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], { stdio: 'pipe' });
children.push(preview);
let browser = null;
let target = null;
let chromeErr = '';
for (let attempt = 1; attempt <= 3 && !target; attempt++) {
  const profile = fs.mkdtempSync(os.tmpdir() + '/qa-chrome-');
  browser = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${CDP_PORT}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  children.push(browser);
  browser.stderr.on('data', (d) => {
    chromeErr = (chromeErr + d.toString()).slice(-4000);
  });
  for (let i = 0; i < 20 && !target; i++) {
    await sleep(500);
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' });
      if (res.ok) target = await res.json();
    } catch {}
  }
  if (!target) {
    console.error(`qa: Chrome attempt ${attempt} failed to expose CDP; retrying…`);
    browser.kill('SIGKILL');
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
if (!target) {
  console.error('qa: Chrome DevTools endpoint never came up on port ' + CDP_PORT);
  console.error('chrome stderr:\n' + chromeErr);
  cleanup();
  process.exit(1);
}

let ws;
let id = 0;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    const h = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === mid) {
        ws.removeEventListener('message', h);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
const evalJS = async (expression, awaitPromise = false) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })).result?.value;

ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));

const results = [];
let gateBadge;
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${URL_}?qa=${Date.now()}` });
  await sleep(3000);

  // 1. a11y audit
  const a11y = await evalJS(`(() => {
    const issues = [];
    let prev = 0;
    document.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      const lvl = +h.tagName[1];
      if (prev !== 0 && lvl > prev + 1) issues.push("heading skip at " + h.tagName);
      prev = lvl;
    });
    if (document.querySelectorAll("h1").length !== 1) issues.push("h1 count " + document.querySelectorAll("h1").length);
    document.querySelectorAll("img").forEach((i) => { if (!i.alt && i.alt !== "") issues.push("img alt: " + i.src.split("/").pop()); });
    document.querySelectorAll("button,a").forEach((b) => { if (!((b.getAttribute("aria-label") || b.textContent || "").trim())) issues.push("no name: " + (b.className || b.tagName)); });
    ["header", "nav", "main", "footer"].forEach((l) => { if (!document.querySelector(l)) issues.push("landmark: " + l); });
    return issues;
  })()`);
  check('a11y audit clean', a11y.length === 0, a11y.join('; '));

  // 2. widget state machine
  await evalJS(`document.querySelector("#loop").scrollIntoView({behavior:"instant",block:"start"})`);
  await sleep(600);
  const state = () =>
    evalJS(`(() => {
      const g = document.querySelector(".guard-panel").textContent;
      const s = document.querySelector(".snippet").textContent;
      return {
        findings: (g.match(/\\d+ findings/) || ["?"])[0],
        forbidden: s.includes("remembered rule forbids"),
        violation: s.includes("reintroduced patterns"),
        allowed: s.includes("allowed again"),
        states: [...document.querySelectorAll(".decision-card .state")].map((x) => x.textContent.trim()).sort().join(","),
        why: document.querySelector(".why")?.textContent?.slice(0, 90) || "",
      };
    })()`);
  const s1 = await state();
  check('state: memory supplied → rule respected', s1.findings === '0 findings' && s1.forbidden && s1.states === 'retrieved', JSON.stringify(s1));
  await evalJS(`document.querySelectorAll("[role=switch]")[0].click()`);
  await sleep(500);
  const s2 = await state();
  check('state: memory off → violations + guard flags', s2.findings === '3 findings' && s2.violation && s2.states === 'not supplied', JSON.stringify(s2));
  await evalJS(`document.querySelectorAll("[role=switch]")[0].click()`);
  await sleep(400);
  await evalJS(`document.querySelectorAll("[role=switch]")[1].click()`);
  await sleep(500);
  const s3 = await state();
  check('state: corrected → restriction released, superseded audit kept', s3.findings === '0 findings' && s3.allowed && s3.states === 'active,superseded', JSON.stringify(s3));
  const whys = new Set([s1.why, s2.why, s3.why]);
  check('explanation panel updates per state', whys.size === 3 && ![s1, s2, s3].some((s) => !s.why), `${whys.size} distinct explanations`);

  // 3. mobile overflow
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(900);
  const sw = await evalJS('document.scrollingElement.scrollWidth');
  check('mobile 390px: no horizontal overflow', sw === 390, `scrollWidth=${sw}`);
  const menu = await evalJS(`(() => {
    const d = document.querySelector(".nav-menu");
    d.open = true;
    return { links: d.querySelectorAll("a").length, panelShown: getComputedStyle(d.querySelector(".nav-menu-panel")).display !== "none" };
  })()`);
  check('mobile nav menu opens with section links', menu.panelShown && menu.links >= 10, JSON.stringify(menu));
  await evalJS(`document.querySelector(".nav-menu a[href='#timeline']").click()`);
  await sleep(400);
  const menuClosed = await evalJS(`!document.querySelector(".nav-menu").open`);
  const atTimeline = await evalJS(`location.hash === "#timeline"`);
  check('menu closes on pick and jumps to section', menuClosed && atTimeline, `closed=${menuClosed} hash=${atTimeline}`);

  // 5. command palette + timeline interactions
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await evalJS(`window.dispatchEvent(new KeyboardEvent("keydown", {key:"k", metaKey:true, bubbles:true}))`);
  await sleep(400);
  const paletteOpen = await evalJS(`!!document.querySelector(".palette")`);
  const paletteFocus = await evalJS(`document.activeElement === document.querySelector(".palette input")`);
  const paletteFilter = await evalJS(`(() => {
    const i = document.querySelector(".palette input");
    if (!i) return "no-input";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(i, "judges");
    i.dispatchEvent(new Event("input", { bubbles: true }));
    return [...document.querySelectorAll(".palette li button")].map(b => b.textContent.trim());
  })()`);
  check('command palette opens via ⌘K and filters (focus in input)', paletteOpen && paletteFocus && Array.isArray(paletteFilter) && paletteFilter.some((t) => t.includes('judges') || t.includes('judges'.toUpperCase()) || /judge/i.test(t)), JSON.stringify({ paletteFocus, paletteFilter }));
  await evalJS(`window.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true}))`);
  await sleep(300);
  check('palette closes on Escape', (await evalJS(`!!document.querySelector(".palette")`)) === false);
  await evalJS(`document.querySelector("#timeline")?.scrollIntoView({behavior:"instant",block:"center"})`);
  await sleep(600);
  const tl = await evalJS(`(() => {
    const cards = [...document.querySelectorAll(".tl-card")];
    const c = cards.find((c) => c.getAttribute("aria-expanded") === "false");
    const title = c?.querySelector("b")?.textContent?.slice(0, 30);
    c?.click();
    return { total: cards.length, title, wasExpanded: "false" };
  })()`);
  await sleep(500);
  const expandedTitles = await evalJS(`[...document.querySelectorAll(".tl-card")]
    .filter((c) => c.getAttribute("aria-expanded") === "true")
    .map((c) => c.querySelector("b")?.textContent?.slice(0, 30))`);
  const whyInOpen = await evalJS(`document.querySelectorAll('.tl-card[aria-expanded="true"] .tl-why').length`);
  check(
    'memory timeline cards expand on click (with why-panel)',
    tl.total === 5 && expandedTitles.includes(tl.title) && whyInOpen === 1,
    `clicked "${tl.title}" → expanded [${expandedTitles.join(' | ')}], why panels in open card: ${whyInOpen}`
  );

  // 4. vitals
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${URL_}?vitals=${Date.now()}` });
  const vitals = await evalJS(
    `new Promise((res) => {
      let lcp = 0, cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.entryType === "largest-contentful-paint") lcp = Math.round(e.startTime); }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: "layout-shift", buffered: true });
      setTimeout(() => res({ lcp, cls: Math.round(cls * 1e4) / 1e4 }), 3500);
    })`,
    true
  );
  check('LCP < 2500ms', vitals.lcp < 2500, `lcp=${vitals.lcp}ms`);
  check('CLS < 0.1', vitals.cls < 0.1, `cls=${vitals.cls}`);

  // 5. pre-rendered static HTML: crawlers, bots, and JS-disabled readers see content
  const html = await (await fetch(URL_)).text();
  // Some meta tags are written across several lines in the source head, so metadata probes are
  // matched against a whitespace-flattened copy as well as the raw bytes.
  const htmlFlat = html.replace(/\s+/g, ' ');
  const missing = [
    ['hero product promise', 'local-first studio for building small browser applications'],
    ['hero headline phrase', 'orrectable project memory'],
    ['beta capability grid', 'Generation context you can read back'],
    ['SAM workflow', 'Select the object. Keep the transparency'],
    ['demo product intro', 'turn project decisions into a reviewable application workflow'],
    ['evidence classes', 'Deterministic fixture'],
    ['evidence table', 'Phase 17'],
    ['timeline records', 'Sunset → ocean'],
    ['JSON-LD', 'SoftwareSourceCode'],
    // Metadata has to name the origin the site is really served from. The deployed page is GitHub
    // Pages; the prerender default is a pages.dev host and the docs also reference a CDN mirror,
    // so these probes pin whichever origin the head currently commits to.
    ['canonical names the deployed GitHub Pages origin', '<link rel="canonical" href="https://sidonsoft.github.io/muse-recall/"'],
    ['og:url names the deployed GitHub Pages origin', 'property="og:url" content="https://sidonsoft.github.io/muse-recall/"'],
    ['og:image is on the same origin as og:url', 'property="og:image" content="https://sidonsoft.github.io/muse-recall/assets/og-image.png"'],
    ['demo video markup', './video/muse-recall-demo.mp4'],
    ['JSON-LD VideoObject', '"@type": "VideoObject"'],
    ['VideoObject duration', 'PT3M0S'],
    ['site self-verification', 'held to the same bar'],
    ['manifest link', 'rel="manifest"'],
    ['apple-touch-icon', 'apple-touch-icon'],
  ].filter(([, probe]) => !html.includes(probe) && !htmlFlat.includes(probe));
  check('static HTML pre-rendered (works without JS)', missing.length === 0, missing.map(([n]) => n + ' missing').join(', ') || `len=${html.length}`);
  const r404 = await fetch(URL_ + '404.html');
  const body404 = await r404.text();
  check('404 fallback redirects to app root', r404.status === 200 && body404.includes('Redirecting') && body404.includes('/muse-recall/'), `status=${r404.status}`);
  const vid = await evalJS(`(() => {
    const v = document.querySelector("#watch video");
    if (!v) return null;
    return { src: v.querySelector("source")?.getAttribute("src"), poster: v.getAttribute("poster"), track: v.querySelector("track")?.getAttribute("src"), controls: v.controls };
  })()`);
  const vidOk = [];
  if (vid) {
    for (const u of [vid.src, vid.poster, vid.track]) {
      const r = await fetch(URL_ + u.replace(/^\.\//, ''), { headers: { Range: 'bytes=0-1023' } });
      vidOk.push(r.status === 200 || r.status === 206);
    }
  }
  check('demo video, poster and captions reachable', !!vid && vid.controls && vidOk.length === 3 && vidOk.every(Boolean), JSON.stringify({ vid, vidOk }));

  // 5b. demo media: captions parse, transcript serves, and the copy's links are the ones offered
  const media = await (async () => {
    const range = await fetch(URL_ + 'video/muse-recall-demo.mp4', { headers: { Range: 'bytes=0-0' } });
    const total = Number((range.headers.get('content-range') || '').split('/')[1]);
    const served = new Uint8Array(await (await fetch(URL_ + 'video/muse-recall-demo.mp4')).arrayBuffer());
    const servedSha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', served))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const vtt = await (await fetch(URL_ + 'video/muse-recall-demo.en.vtt')).text();
    const cues = vtt.split('\n\n').filter((b) => b.includes('-->'));
    const ends = cues
      .map((b) => b.split('\n').find((l) => l.includes('-->')).split('-->')[1].trim().split(' ')[0])
      .map((t) => t.split(':').reduce((acc, p) => acc * 60 + Number(p.replace(',', '.')), 0));
    const transcript = await fetch(URL_ + 'video/muse-recall-demo-transcript.txt');
    const transcriptBody = await transcript.text();
    const figure = await evalJS(`(() => {
      const f = document.querySelector("#watch figure.video-figure");
      const links = [...f.querySelectorAll("a")].map((a) => ({ text: a.textContent.trim(), href: a.getAttribute("href") }));
      return {
        labels: links.map((a) => a.text).join(" | "),
        details: links.filter((a) => /V21_QA\.md/.test(a.href || "")),
        scope: (document.querySelector("#watch .footnote") || {}).textContent || "",
        watchText: document.querySelector("#watch").textContent,
      };
    })()`);
    return {
      total,
      servedSha,
      figure,
      cues: cues.length,
      lastCueEnd: ends[ends.length - 1],
      overlaps: ends.filter((e, i) => i > 0 && e < ends[i - 1]).length,
      transcriptStatus: transcript.status,
      transcriptChars: transcriptBody.length,
      transcriptBeats: /^0:00 — /m.test(transcriptBody) && /^2:55 — /m.test(transcriptBody),
      posterBytes: Number((await fetch(URL_ + 'video/muse-recall-demo-poster.jpg', { method: 'HEAD' })).headers.get('content-length') || 0),
    };
  })();
  // The page no longer prints a download size or a checksum, so integrity is pinned against the
  // repository instead: what a visitor downloads must be the file the repo ships, and the SHA-256
  // its QA record publishes must be the hash of those bytes. Swapping media on the site, drifting
  // the repo copy, or letting the QA record go stale all fail here. Copy-dependent by design:
  // V21_QA.md is documentation, so this asserts consistency rather than restating the numbers.
  const repoMedia = await (async () => {
    const root = path.resolve(process.cwd(), '..');
    const file = path.join(root, 'docs', 'demo', 'video', 'Muse_Recall_Demo_V21_1080p.mp4');
    const qaDoc = path.join(root, 'docs', 'demo', 'video', 'V21_QA.md');
    if (!fs.existsSync(file) || !fs.existsSync(qaDoc)) return { missing: true };
    const bytes = fs.readFileSync(file);
    const repoSha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const doc = fs.readFileSync(qaDoc, 'utf8');
    const docSha = (doc.match(/\|\s*SHA-256\s*\|\s*`([0-9a-f]{64})`/) || [])[1] || '';
    const docSize = Number(((doc.match(/\|\s*Size\s*\|\s*([\d,]+)\s*bytes/) || [])[1] || '').replace(/,/g, ''));
    return { repoBytes: bytes.length, repoSha, docSha, docSize };
  })();
  check(
    'served demo bytes match the repository file and the checksum its QA record publishes',
    !repoMedia.missing &&
      media.servedSha === repoMedia.repoSha &&
      media.total === repoMedia.repoBytes &&
      repoMedia.docSize === repoMedia.repoBytes &&
      repoMedia.docSha === repoMedia.repoSha,
    repoMedia.missing
      ? 'docs/demo/video not found — run qa from the website/ folder'
      : `served=${media.total}B sha=${media.servedSha.slice(0, 12)} · repo=${repoMedia.repoBytes}B sha=${repoMedia.repoSha.slice(0, 12)} · V21_QA size=${repoMedia.docSize} sha=${(repoMedia.docSha || '').slice(0, 12)}`,
  );
  check(
    'demo figure offers Download video, Captions, Transcript and one Recording details link',
      ['Download video', 'Captions', 'Transcript', 'Recording details'].every((l) => media.figure.labels.includes(l)) &&
      media.figure.details.length === 1 &&
      /docs\/demo\/video\/V21_QA\.md/.test(media.figure.details[0].href) &&
      /recorded live model calls with retained outputs and labelled replays or fixtures/.test(media.figure.scope) &&
      !/submission/i.test(media.figure.watchText),
    `labels=[${media.figure.labels}] details=${JSON.stringify(media.figure.details)} scope=${JSON.stringify(media.figure.scope.trim())}`,
  );
  check(
    'caption track parses: cues present, no overlaps, all inside the runtime',
    media.cues >= 40 && media.overlaps === 0 && media.lastCueEnd <= 180.001 && media.posterBytes > 50_000,
    `cues=${media.cues} overlaps=${media.overlaps} lastCueEnd=${media.lastCueEnd} poster=${media.posterBytes}B`
  );
  check(
    'plain-text transcript served, with timecoded beats',
    media.transcriptStatus === 200 && media.transcriptChars > 1500 && media.transcriptBeats,
    `status=${media.transcriptStatus} chars=${media.transcriptChars} beats=${media.transcriptBeats}`
  );

  // 5c. the sidecar track is offered, but not shown on load — the same text is burned into the frame
  const trackState = await evalJS(`(() => {
    const v = document.querySelector('#watch video');
    const t = v.textTracks[0];
    return {
      tracks: v.textTracks.length,
      kind: t && t.kind,
      label: t && t.label,
      mode: t && t.mode,
      defaultAttr: [...v.querySelectorAll('track')].some((tr) => tr.hasAttribute('default')),
      named: !!v.getAttribute('aria-label'),
    };
  })()`);
  check(
    'caption sidecar is offered without double-rendering the burned-in text',
    trackState.tracks === 1 && trackState.kind === 'captions' && [ 'hidden', 'disabled' ].includes(trackState.mode) && !trackState.defaultAttr && trackState.named,
    JSON.stringify(trackState)
  );

  // 5d. every in-page navigation target exists; the two "seven" claims are counted on the page
  const anchors = await evalJS(`(() => {
    const bad = [...document.querySelectorAll('.nav-menu a[href^="#"], .nav-links a[href^="#"], a.btn[href^="#"]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => h.length > 1 && !document.querySelector(h));
    return { bad: [...new Set(bad)], ruleFamilies: document.querySelectorAll('.rulefam').length, toolChips: document.querySelectorAll('.chips .chip').length };
  })()`);
  check('every in-page anchor resolves to a section', anchors.bad.length === 0, anchors.bad.join(', ') || 'all resolve');

  // 5e. every local asset path named anywhere in the built output must resolve — this catches
  //     fallback and srcset variants (WebP ⇄ JPG/PNG, poster sizes) that the browser never fetched.
  const assets = await (async () => {
    const files = [
      'dist/index.html',
      ...fs.readdirSync('dist/assets').filter((f) => f.endsWith('.js')).map((f) => `dist/assets/${f}`),
    ];
    const set = new Set();
    for (const f of files)
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/\.\/((?:assets|video)\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp|mp4|vtt|txt))/g))
        set.add(m[1]);
    const bad = [];
    for (const p of [...set].sort()) {
      const r = await fetch(URL_ + p, { method: 'HEAD' });
      if (r.status !== 200) bad.push(`${p} → ${r.status}`);
    }
    return { count: set.size, bad };
  })();
  check(
    'every local asset path in the built output resolves',
    assets.bad.length === 0,
    assets.bad.join(', ') || `${assets.count} unique ./assets + ./video paths`
  );
  check(
    'the seven Guard families and seven shared tools are counted on the page',
    anchors.ruleFamilies === 7 && anchors.toolChips === 7,
    JSON.stringify(anchors)
  );
  const manifest = await (await fetch(URL_ + 'site.webmanifest')).json();
  const iconOk = await Promise.all(
    manifest.icons.map(async (i) => (await fetch(new URL(i.src, URL_))).ok)
  );
  check('PWA manifest valid, icons reachable', manifest.name.includes('Muse Recall') && iconOk.every(Boolean), JSON.stringify({ name: manifest.name, icons: iconOk }));

  // 6. WebP sources serve every image
  await send('Page.navigate', { url: `${URL_}?imgs=${Date.now()}` });
  await sleep(1200);
  const imgs = await evalJS(`(async () => {
    [...document.images].forEach((i) => (i.loading = "eager"));
    await Promise.all([...document.images].map((i) => i.complete ? 1 : new Promise((r) => { i.onload = r; i.onerror = () => r("err"); })));
    return [...document.images].map((i) => ({ src: (i.currentSrc || i.src).split("/").pop(), ok: i.naturalWidth > 0, webp: (i.currentSrc || "").endsWith(".webp") }));
  })()`, true);
  const badImgs = imgs.filter((i) => !i.ok || !i.webp);
  check(`${imgs.length} images all load WebP`, badImgs.length === 0, badImgs.length ? JSON.stringify(badImgs) : 'webp + loaded');

  // 6b. no aspect-ratio distortion (Lighthouse image-aspect-ratio guard)
  const heroBox = await evalJS(`(() => { const i = document.querySelector("figure img"); return { nat: i.naturalWidth / i.naturalHeight, box: i.clientWidth / i.clientHeight, src: i.currentSrc.split("/").pop() }; })()`);
  check('hero not distorted, responsive variant picked', Math.abs(heroBox.nat - heroBox.box) < 0.03 && heroBox.src.endsWith('.webp'), JSON.stringify(heroBox));

  // 7. reduced-motion honoring
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(400);
  const rm = await evalJS(`({
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
    aurora: getComputedStyle(document.querySelector(".aurora span")).animationName,
    why: getComputedStyle(document.querySelector(".why") || document.body).animationName,
  })`);
  check('prefers-reduced-motion: reduce honored', rm.scroll === 'auto' && rm.aurora === 'none' && rm.why === 'none', JSON.stringify(rm));
  await send('Emulation.setEmulatedMedia', { features: [] });

  // 8. quickstart copy button
  try { await send('Browser.grantPermissions', { origin: new URL(URL_).origin, permissions: ['clipboard-read', 'clipboard-write'] }); } catch {}
  await evalJS(`document.querySelector(".copy-btn")?.click()`);
  await sleep(500);
  const copyLabel = await evalJS(`document.querySelector(".copy-btn")?.textContent?.trim()`);
  check('quickstart copy button confirms', /copied/.test(copyLabel || ''), `label="${copyLabel}"`);
  const payload = await evalJS(`document.querySelector(".code-shell pre")?.innerText || ""`);
  const cmds = ['git clone', 'pnpm demo:seed', 'MODEL_PROVIDER=echo pnpm dev', 'pnpm verify'];
  check('copy payload carries the right commands', cmds.every((c) => payload.includes(c)), cmds.filter((c) => !payload.includes(c)).join(', ') || 'all present');

  // 9. gallery lightbox
  await evalJS(`document.querySelector("#gallery")?.scrollIntoView({behavior:"instant",block:"center"})`);
  await sleep(500);
  await evalJS(`document.querySelectorAll(".lb-open")[0].click()`);
  await sleep(500);
  const lbOpen = await evalJS(`({ exists: !!document.querySelector(".lb-backdrop"), img: document.querySelector(".lb-backdrop img")?.currentSrc?.split("/").pop(), count: document.querySelector(".lb-count")?.textContent?.trim() })`);
  await evalJS(`window.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowRight", bubbles:true}))`);
  await sleep(400);
  const lbMoved = await evalJS(`document.querySelector(".lb-count")?.textContent?.trim()`);
  await evalJS(`window.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true}))`);
  await sleep(400);
  const lbClosed = await evalJS(`!document.querySelector(".lb-backdrop")`);
  check(
    'gallery lightbox opens, arrows move, Escape closes',
    lbOpen.exists && lbOpen.img?.endsWith('.webp') && lbOpen.count === '1 / 5' && lbMoved === '2 / 5' && lbClosed,
    JSON.stringify({ ...lbOpen, moved: lbMoved, closed: lbClosed })
  );

  // 10. no-JS fallback
  await send('Emulation.setScriptExecutionDisabled', { value: true });
  await send('Page.navigate', { url: `${URL_}?nojs=${Date.now()}` });
  await sleep(1200);
  const nojs = await evalJS(`({
    cls: document.documentElement.className,
    reveal: getComputedStyle(document.querySelector("#engine .reveal")).opacity,
    copyHidden: getComputedStyle(document.querySelector(".copy-btn")).display === "none",
    tlFull: [...document.querySelectorAll(".tl-printonly")].slice(0,1).map(e=>getComputedStyle(e).display)[0],
  })`);
  check(
    'JS-disabled: content visible, dead controls hidden',
    nojs.cls === 'no-js' && nojs.reveal === '1' && nojs.copyHidden && nojs.tlFull === 'block',
    JSON.stringify(nojs)
  );
  await send('Emulation.setScriptExecutionDisabled', { value: false });

  // 11. keyboard path: skip link first in tab order, all controls named
  await send('Page.navigate', { url: `${URL_}?kb=${Date.now()}` });
  await sleep(1200);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await sleep(200);
  const firstTab = await evalJS(`(document.activeElement.getAttribute("aria-label") || document.activeElement.textContent || "").trim()`);
  const skipTarget = await evalJS(`(() => { const s = document.querySelector(".skip-link"); return !!s && !!document.querySelector(s.getAttribute("href")); })()`);
  const unnamed = await evalJS(`[...document.querySelectorAll("a,button,input")].filter((e) => !(e.getAttribute("aria-label") || e.textContent.trim() || e.getAttribute("title"))).length`);
  check(
    'keyboard: skip link first, target exists, no unnamed controls',
    /Skip to content/.test(firstTab) && skipTarget && unnamed === 0,
    `firstTab="${firstTab}" skipTarget=${skipTarget} unnamed=${unnamed}`
  );

  // Drift gate data: the "N/N headless QA checks" badge on the site must equal
  // the suite's real total (this gate included) — enforced in the summary below.
  try {
    gateBadge = await evalJS(`document.querySelector("#sitecheck .stats b")?.textContent?.trim() ?? null`);
  } catch {
    gateBadge = null;
  }
} catch (e) {
  check('script completed', false, e.message);
} finally {
  ws.close();
  cleanup();
}

// Drift gate: the "N/N headless QA checks" badge printed on the site must equal
// the suite's real total — adding a check without updating the copy fails CI.
let gateOk = null;
if (results.every((r) => r.ok)) {
  const expected = `${results.length + 1}/${results.length + 1}`;
  gateOk = gateBadge === expected;
  console.log(gateOk ? `PASS  site badge matches suite total — ${expected} (self-referential gate)` : `FAIL  site badge matches suite total — badge="${gateBadge}" expected="${expected}"`);
}

const passed = results.filter((r) => r.ok).length + (gateOk === true ? 1 : 0);
const total = results.length + (gateOk === null ? 0 : 1);
console.log(`\n${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
