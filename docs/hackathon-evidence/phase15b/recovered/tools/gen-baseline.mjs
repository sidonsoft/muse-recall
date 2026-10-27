/**
 * Baseline generation for Phase 15B, on the funded path:
 * muse-spark-1.3-contributor over the Meta API (FORGE_MUSE_API_KEY, piped on stdin).
 *
 * This is the connectivity + baseline-generation check the director required before the
 * preregistration is locked. It is NOT a trial observation and is excluded from all counts.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs video/tools/gen-baseline.mjs
 */
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'video/probe/baseline');
mkdirSync(OUT, { recursive: true });

const MODEL = 'muse-spark-1.3-contributor';
const EFFORT = 'high';   // model profile default for muse-spark-1.3-contributor
const key = readFileSync(process.env.HOME + '/.zshrc', 'utf8')
  .split('\n')
  .map((l) => l.match(/^\s*(?:export\s+)?FORGE_MUSE_API_KEY\s*=\s*["']?([^"'\s]+)/))
  .find(Boolean)?.[1];
if (!key) throw new Error('FORGE_MUSE_API_KEY not found in ~/.zshrc');

const BRIEF = `Write ONE complete HTML file containing a Phaser 3.80.1 game (Phaser from
https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js). Canvas 900x700, scale FIT,
CENTER_BOTH. No build step, no external images or fonts. Draw everything with canvas primitives,
text and simple shapes. It must work when opened as a local file.

The game is called "Sky Pairs": a calm memory card-matching game for children aged 4-7. Six pairs of
cards, each pair showing the same constellation. A start screen, a HUD showing moves and pairs
found, and a win state with a replay button.

Craft requirements: deep night-sky background, warm off-white line art, generous spacing, no
clutter. Every shape must be drawn — do not use emoji. Typography should look considered.

Return ONLY the HTML file. No explanation, no markdown fences.`;

function callMuse(prompt) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mml-baseline-'));
  const promptPath = path.join(dir, 'prompt.md');
  writeFileSync(promptPath, prompt, 'utf8');
  return new Promise((resolve, reject) => {
    const child = spawn('muse', [
      'exec', '--json', '--no-session-log', '--no-foreign-personal-context',
      '--disable-web-tools', '--disable-reminders', '--disable-request-user-input',
      '--preset', 'empty', '--model', MODEL, '--reasoning-effort', EFFORT,
      '--prompt-file', promptPath,
      '--provider', 'meta', '--api-key-stdin',
    ], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.write(key);
    child.stdin.end();
    let out = '', err = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { err += b; });
    child.on('close', (code) => {
      const records = out.split('\n').filter((l) => l.startsWith('{')).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      let text = '', conf = null, usage = null;
      for (const r of records) {
        const p = r.payload ?? {};
        if (r.payload_type === 'run.output.delta') text += p.text ?? '';
        if (r.payload_type === 'run.model.configured') conf = p;
        if (r.payload_type === 'run.usage') usage = p;
      }
      if (code !== 0 && !text) return reject(new Error(`muse exit ${code}: ${err.slice(0, 300)}`));
      resolve({ text, conf, usage });
    });
  });
}

const MAX_CANDIDATES = 3;
const results = [];
let chosen = null;

for (let i = 1; i <= MAX_CANDIDATES && !chosen; i++) {
  console.log(`\ncandidate ${i}: generating with ${MODEL} (${EFFORT}) over the API`);
  const started = Date.now();
  const { text, conf, usage } = await callMuse(BRIEF);
  const secs = (Date.now() - started) / 1000;

  let html = text.trim();
  const fence = html.match(/```(?:html)?\n([\s\S]*?)```/);
  if (fence) html = fence[1].trim();
  if (!html.includes('<html') && !html.includes('<!DOCTYPE')) {
    console.log('  rejected: no HTML in output');
    results.push({ candidate: i, ok: false, reason: 'no html' });
    continue;
  }

  const file = path.join(OUT, `sky-pairs-high-cand${i}.html`);
  writeFileSync(file, html);
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
  const m = usage?.models?.[0] ?? {};
  const inTok = m.input_tokens ?? 0, outTok = m.output_tokens ?? 0;
  const cost = (inTok / 1e6) * 1.25 + (outTok / 1e6) * 4.25;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let blank = true;
  try {
    await page.goto(`file://${file}`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 20000 });
    await page.waitForTimeout(1600);
    const shot = path.join(OUT, `high-cand${i}-start.png`);
    await page.screenshot({ path: shot });
    const stats = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const g = c.getContext('2d');
      if (!g) return null;
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let min = 255, max = 0;
      for (let k = 0; k < d.length; k += 4 * 97) { min = Math.min(min, d[k]); max = Math.max(max, d[k]); }
      return { spread: max - min };
    });
    blank = !!stats && stats.spread < 6;
    await page.mouse.click(450, 470);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `high-cand${i}-play.png`) });
  } catch (err) {
    errors.push(String(err.message).slice(0, 120));
  }
  await browser.close();

  const ok = errors.length === 0 && !blank;
  results.push({
    candidate: i, ok, blank, errors, file: path.relative(ROOT, file), bytes: html.length, sha256: sha,
    reported_model: conf?.model_id, profile: conf?.profile_id,
    calls: usage?.calls, failed: usage?.failed_calls,
    input_tokens: inTok, output_tokens: outTok, reasoning: m.reasoning_tokens,
    seconds: Number(secs.toFixed(1)), cost_usd_estimate: Number(cost.toFixed(4)),
  });
  console.log(`  ${ok ? 'CLEAN' : 'REJECTED'}  errors=${errors.length ? errors.join(' | ') : 'none'}  ` +
    `blank=${blank}  ${secs.toFixed(1)}s  $${cost.toFixed(4)}`);
  if (ok) chosen = results[results.length - 1];
}

writeFileSync(path.join(OUT, 'baseline-candidates-high.json'), JSON.stringify({ model: MODEL, effort: EFFORT, results, chosen }, null, 2));
console.log('\n' + JSON.stringify({ results, chosen: chosen?.file ?? null }, null, 2));
