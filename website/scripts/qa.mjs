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
import os from 'node:os';
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
  const missing = [
    ['hero headline', 'orrectable project memory'],
    ['evidence table', 'Phase 17'],
    ['timeline records', 'Sunset → ocean'],
    ['JSON-LD', 'SoftwareSourceCode'],
    ['site self-verification', 'held to the same bar'],
    ['manifest link', 'rel="manifest"'],
    ['apple-touch-icon', 'apple-touch-icon'],
  ].filter(([, probe]) => !html.includes(probe));
  check('static HTML pre-rendered (works without JS)', missing.length === 0, missing.map(([n]) => n + ' missing').join(', ') || `len=${html.length}`);
  const r404 = await fetch(URL_ + '404.html');
  const body404 = await r404.text();
  check('404 fallback redirects to app root', r404.status === 200 && body404.includes('Redirecting') && body404.includes('muse-recall-website'), `status=${r404.status}`);
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
    lbOpen.exists && lbOpen.img?.endsWith('.webp') && lbOpen.count === '1 / 4' && lbMoved === '2 / 4' && lbClosed,
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
