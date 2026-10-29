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
import fs from 'node:fs';
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
const browser = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP_PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);
children.push(browser);

// Wait for the CDP endpoint to come up (CI runners can be slow), then open a target.
let target = null;
for (let i = 0; i < 30 && !target; i++) {
  await sleep(500);
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' });
    if (res.ok) target = await res.json();
  } catch {}
}
if (!target) {
  console.error('qa: Chrome DevTools endpoint never came up on port ' + CDP_PORT);
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

  // 5. command palette + timeline interactions
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await evalJS(`window.dispatchEvent(new KeyboardEvent("keydown", {key:"k", metaKey:true, bubbles:true}))`);
  await sleep(400);
  const paletteOpen = await evalJS(`!!document.querySelector(".palette")`);
  const paletteFilter = await evalJS(`(() => {
    const i = document.querySelector(".palette input");
    if (!i) return "no-input";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(i, "judges");
    i.dispatchEvent(new Event("input", { bubbles: true }));
    return [...document.querySelectorAll(".palette li button")].map(b => b.textContent.trim());
  })()`);
  check('command palette opens via ⌘K and filters', paletteOpen && Array.isArray(paletteFilter) && paletteFilter.some((t) => t.includes('judges') || t.includes('judges'.toUpperCase()) || /judge/i.test(t)), JSON.stringify(paletteFilter));
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
  const missing = [
    ['hero headline', 'orrectable project memory'],
    ['evidence table', 'Phase 17'],
    ['timeline records', 'Sunset → ocean'],
    ['JSON-LD', 'SoftwareSourceCode'],
  ].filter(([, probe]) => !html.includes(probe));
  check('static HTML pre-rendered (works without JS)', missing.length === 0, missing.map(([n]) => n + ' missing').join(', ') || `len=${html.length}`);

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
    lbOpen.exists && lbOpen.img?.endsWith('.webp') && lbOpen.count === '1 / 4' && lbMoved === '2 / 4' && lbClosed,
    JSON.stringify({ ...lbOpen, moved: lbMoved, closed: lbClosed })
  );
} catch (e) {
  check('script completed', false, e.message);
} finally {
  ws.close();
  cleanup();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
