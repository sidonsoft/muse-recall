#!/usr/bin/env node
// Cross-browser smoke test via Playwright. BROWSER=firefox (default) or chromium.
// Caveat: Playwright's bundled Firefox (firefox-1555 "Nightly") fails to start on
// macOS 27 even with a pre-created profile dir, so run this with BROWSER=firefox
// on Linux CI for real Gecko coverage; BROWSER=chromium exercises the same flow
// through Playwright's driver (independent of the hand-rolled CDP qa harness).
import { createRequire } from 'node:module';

const URL_ = process.env.URL_ || 'http://localhost:4173/';
const WHICH = process.env.BROWSER || 'firefox';

const pw = await import('playwright');
const fs = await import('node:fs');
const path = await import('node:path');
const profileDir = path.join(process.cwd(), 'pwprofile');
fs.rmSync(profileDir, { recursive: true, force: true });
fs.mkdirSync(profileDir, { recursive: true });
const ctx = await pw[WHICH].launchPersistentContext(profileDir, {
  viewport: { width: 1280, height: 900 },
  headless: true,
});
const browser = ctx.browser();
const page = ctx.pages()[0] || (await ctx.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

await page.goto(URL_, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const report = async (label) => {
  const r = await page.evaluate(() => ({
    scrollW: document.scrollingElement.scrollWidth,
    hero: !!document.querySelector('h1'),
    switches: document.querySelectorAll('[role=switch]').length,
    tlCards: document.querySelectorAll('.tl-card').length,
    webpLoaded: [...document.images].filter((i) => (i.currentSrc || '').endsWith('.webp') && i.naturalWidth > 0).length,
    revealVisible: [...document.querySelectorAll('.reveal')].filter((e) => getComputedStyle(e).opacity === '1').length,
  }));
  console.log(label, JSON.stringify(r));
  return r;
};

console.log(`== ${WHICH} desktop ==`);
await page.evaluate(async () => {
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise((r) => setTimeout(r, 900));
  window.scrollTo(0, 0);
});
const d = await report('desktop');
await page.screenshot({ path: '/tmp/ff-desktop.png', fullPage: false });

// interactions
await page.click('[role=switch]');
await page.waitForTimeout(400);
const snippetLines = await page.$$eval('.snippet .bad-add, .snippet .add', (els) => els.length);
await page.keyboard.press('Control+k');
await page.waitForTimeout(400);
const palette = await page.$('.palette input');
await page.keyboard.press('Escape');
const tlExpanded = await page.$$eval('.tl-card[aria-expanded=true]', (e) => e.length);
await page.click('.lb-open');
await page.waitForTimeout(500);
const lb = await page.$('.lb-backdrop');
await page.keyboard.press('Escape');
console.log('interactions:', JSON.stringify({ snippetLines, palette: !!palette, tlExpanded, lb: !!lb }));

// mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(700);
const m = await report('mobile');
await page.evaluate(() => { document.querySelector('.nav-menu').open = true; });
await page.waitForTimeout(300);
const panel = await page.evaluate(() => {
  const r = document.querySelector('.nav-menu-panel').getBoundingClientRect();
  return { inViewport: r.left >= 0 && r.right <= 390 };
});
await page.screenshot({ path: '/tmp/ff-mobile.png' });
console.log('mobile menu panel inside viewport:', panel.inViewport);

await browser.close();
const ok =
  d.hero && d.switches === 2 && d.tlCards === 5 && d.webpLoaded >= 3 &&
  m.scrollW === 390 && snippetLines > 0 && palette && tlExpanded >= 1 && lb && panel.inViewport &&
  errors.length === 0;
console.log('console/page errors:', errors.length ? errors.join('\n') : 'none');
console.log(ok ? `${WHICH.toUpperCase()}: PASS` : `${WHICH.toUpperCase()}: FAIL`);
process.exit(ok ? 0 : 1);
