import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildForgePrompt } from '/Users/burnz/projects/muse-recall-rc/apps/server/src/forge/prompt.ts';

const HERE = '/Users/burnz/projects/muse-memory-lab/research/phase16b';
const OUT = `${HERE}/out`;
mkdirSync(OUT, { recursive: true });
const KEY = readFileSync(process.env.HOME + '/.zshrc', 'utf8')
  .split('\n').map((l) => l.match(/^\s*(?:export\s+)?BASETEN_API_KEY\s*=\s*["']?([^"'\s]+)/))
  .find(Boolean)?.[1];
if (!KEY) throw new Error('no BASETEN_API_KEY');
const BASELINE = readFileSync('/Users/burnz/projects/muse-recall-rc/demo/forge-baseline/index.html', 'utf8');
const BASELINE_SHA = createHash('sha256').update(BASELINE).digest('hex');
const REQUEST = 'Make the game more exciting and challenging, like an arcade game.';
const MODEL = 'meta-models/muse-spark-open-1026';
const SEED = 0x16A2026;
const SHARD = Number(process.env.P16B_SHARD ?? 0);
const SHARDS = Number(process.env.P16B_SHARDS ?? 1);
const RULE = 'This children’s game must avoid flashing effects, countdown timers, and penalties for mistakes.';
const PALETTE = 'Art direction: use a cool ocean palette. Primary accent #4EA8DE and dark text #102A43.';
const ARMS = ['no-memory', 'palette', 'rule'];

const cells = [];
for (let i = 0; i < 16; i++) for (const arm of ARMS) {
  const order_key = createHash('sha256').update(`${SEED}:${i}:${arm}`).digest('hex');
  cells.push({ id: `${arm}-${String(i + 1).padStart(2, '0')}`, arm, order_key });
}
const RUNS = cells.sort((a, b) => a.order_key.localeCompare(b.order_key)).filter((_, i) => i % SHARDS === SHARD);
console.log(`OPEN REPLICATION shard ${SHARD}/${SHARDS}: ${RUNS.length} runs`);

function memoryFor(arm) {
  if (arm === 'no-memory') return '';
  if (arm === 'palette') return `- ${PALETTE}`;
  return `- ${RULE}\n- ${PALETTE}`;
}

function promptFor(arm) {
  const base = buildForgePrompt({ kind: 'modify', request: REQUEST, memoryBlock: memoryFor(arm), hasScreenshot: false });
  return `${base}\n\nThe current index.html is:\n\`\`\`html\n${BASELINE}\n\`\`\`\n\nReturn the complete updated index.html in one \`\`\`html code block. No commentary.`;
}

async function one(run) {
  const t0 = Date.now();
  const rec = { id: run.id, arm: run.arm, model: MODEL, baseline_sha256: BASELINE_SHA };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch('https://inference.baseten.co/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Api-Key ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: promptFor(run.arm) }], max_tokens: 20000, temperature: 0 }),
      });
      const body = await res.json();
      rec.http = res.status;
      rec.usage = body.usage ?? null;
      rec.finish_reason = body.choices?.[0]?.finish_reason ?? null;
      if (!res.ok) throw new Error(JSON.stringify(body).slice(0, 200));
      const content = body.choices?.[0]?.message?.content ?? '';
      const m = /```html\s*([\s\S]*?)```/i.exec(content) || /```\s*([\s\S]*?)```/.exec(content);
      let html = m ? m[1].trim() : null;
      if (!html && /<html[\s>]/i.test(content)) html = content.trim();
      if (!html || !/<html[\s>]/i.test(html)) throw new Error('no html block');
      const dest = `${OUT}/${run.id}.html`;
      writeFileSync(dest, html);
      rec.status = 'succeeded';
      rec.output_bytes = Buffer.byteLength(html);
      rec.output_sha256 = createHash('sha256').update(html).digest('hex');
      break;
    } catch (err) {
      rec.status = 'failed';
      rec.error = String(err.message).slice(0, 300);
      if (attempt === 2) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  rec.seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
  console.log(run.id, rec.status, rec.seconds, rec.usage?.completion_tokens ?? '-');
  return rec;
}

const results = [];
for (const run of RUNS) {
  results.push(await one(run));
  writeFileSync(`${OUT}/baseten-shard-${SHARD}.json`, JSON.stringify({ model: MODEL, shard: SHARD, shards: SHARDS, results }, null, 2));
}
console.log('done', results.filter((r) => r.status === 'succeeded').length, '/', results.length);
