/**
 * Study 02 checkpoint 2 — Dell endpoint qualification runs.
 * 6 sequential full-file generations against http://192.168.86.39:8080/v1/chat/completions.
 * Records every field needed for the go/no-go projection. No streaming.
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BASE = 'http://192.168.86.39:8080';
const OUT = '/tmp/study02-qual';
const MANIFEST = JSON.parse(readFileSync(`${OUT}/prompts/manifest.json`, 'utf8'));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const byKey = Object.fromEntries(MANIFEST.baselines.map((b) => [b.key, b]));

const COMMON = {
  temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5, min_p: 0.0,
  reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false }, stream: false,
};

// id, baseline, seed, max_tokens, purpose
const RUNS = [
  { id: 'q01-farmyard-primary',   baseline: 'farmyard',  seed: 1001, max_tokens: 16384, purpose: 'primary baseline 1 (game, arcade request)' },
  { id: 'q02-orchard-primary',    baseline: 'orchard',   seed: 1002, max_tokens: 16384, purpose: 'primary baseline 2 (game, arcade request)' },
  { id: 'q03-focusflow-primary',  baseline: 'focusflow', seed: 1003, max_tokens: 16384, purpose: 'primary baseline 3 (planner, reward request)' },
  { id: 'q04-farmyard-sameseed',  baseline: 'farmyard',  seed: 1001, max_tokens: 16384, purpose: 'determinism: repeat q01 prompt + same seed' },
  { id: 'q05-farmyard-newseed',   baseline: 'farmyard',  seed: 1004, max_tokens: 16384, purpose: 'variability: same prompt, different seed' },
  { id: 'q06-farmyard-cap512',    baseline: 'farmyard',  seed: 1001, max_tokens: 512,   purpose: 'truncation/cap probe: max_tokens=512' },
];

function extractHtml(content) {
  const m = /```html\s*([\s\S]*?)```/i.exec(content) || /```\s*([\s\S]*?)```/.exec(content);
  return m ? m[1].trim() : null;
}

const modelList = await (await fetch(`${BASE}/v1/models`, { signal: AbortSignal.timeout(15000) })).json();
const MODEL = modelList.data?.[0]?.id;
if (!MODEL) throw new Error('no model id from /v1/models');
console.log('model asserted:', MODEL, 'ctx:', modelList.data[0]?.meta?.n_ctx);

const LOG = `${OUT}/runs/records.jsonl`;
writeFileSync(LOG, '');
const all = [];

for (const run of RUNS) {
  const b = byKey[run.baseline];
  const prompt = readFileSync(b.prompt_file, 'utf8');
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: run.max_tokens,
    seed: run.seed,
    ...COMMON,
  };
  writeFileSync(`${OUT}/runs/${run.id}.request.json`, JSON.stringify({
    ...body, messages: [{ role: 'user', content: `<${prompt.length} chars, sha256 ${b.prompt_sha256}>` }], prompt_file: b.prompt_file,
  }, null, 2));

  const rec = {
    id: run.id, purpose: run.purpose, baseline: run.baseline, baseline_path: b.baseline_path,
    model_requested: MODEL, seed: run.seed, max_tokens: run.max_tokens,
    prompt_sha256: b.prompt_sha256, prompt_chars: b.prompt_chars,
    requested_at: new Date().toISOString(),
  };
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(900_000), // 15 min hard stop
    });
    const wall = (Date.now() - t0) / 1000;
    const text = await res.text();
    rec.wall_s = Number(wall.toFixed(2));
    rec.http = res.status;
    rec.response_bytes = Buffer.byteLength(text);
    writeFileSync(`${OUT}/runs/${run.id}.response.json`, text);
    const j = JSON.parse(text);
    const choice = j.choices?.[0] ?? {};
    const msg = choice.message ?? {};
    const content = msg.content ?? null;
    rec.usage = j.usage ?? null;
    rec.timings = j.timings ?? null;
    rec.finish_reason = choice.finish_reason ?? null;
    rec.model_returned = j.model ?? null;
    rec.model_echoed_ok = j.model === MODEL;
    rec.content_is_null = content === null;
    rec.reasoning_content_present = 'reasoning_content' in msg && msg.reasoning_content !== null && msg.reasoning_content !== undefined;
    rec.content_chars = content ? content.length : 0;
    if (content) {
      writeFileSync(`${OUT}/runs/${run.id}.content_raw.txt`, content);
      const html = extractHtml(content);
      rec.html_block_found = Boolean(html);
      rec.html_complete = Boolean(html && /<\/html>\s*$/i.test(html));
      if (html) {
        writeFileSync(`${OUT}/runs/${run.id}.html`, html);
        rec.output_html_bytes = Buffer.byteLength(html);
        rec.output_html_chars = html.length;
        rec.output_html_sha256 = sha256(html);
      }
    }
    rec.status = rec.model_echoed_ok && content && rec.html_block_found && rec.html_complete && rec.finish_reason === 'stop' ? 'succeeded' : 'succeeded_with_caveats';
    if (rec.finish_reason !== 'stop') rec.status = 'incomplete';
    rec.error = null;
  } catch (err) {
    rec.wall_s = Number(((Date.now() - t0) / 1000).toFixed(2));
    rec.status = 'failed';
    rec.error = String(err?.name === 'TimeoutError' ? 'timeout after 900s' : err.message).slice(0, 300);
  }
  rec.measured_at = new Date().toISOString();
  all.push(rec);
  appendFileSync(LOG, `${JSON.stringify(rec)}\n`);
  writeFileSync(`${OUT}/runs/records.json`, `${JSON.stringify(all, null, 2)}\n`);
  console.log(`[${run.id}]`, rec.status, `wall=${rec.wall_s}s`, `http=${rec.http}`, `finish=${rec.finish_reason}`,
    `prompt_tok=${rec.usage?.prompt_tokens}`, `completion_tok=${rec.usage?.completion_tokens}`,
    `cache_n=${rec.timings?.cache_n}`, `html=${rec.output_html_bytes ?? '-'}B`, rec.error ?? '');
}
console.log('ALL RUNS COMPLETE');
