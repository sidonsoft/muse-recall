import { readFileSync, writeFileSync } from 'node:fs';
import { buildForgePrompt } from '/Users/burnz/projects/muse-recall-rc/apps/server/src/forge/prompt.ts';

const KEY = readFileSync(process.env.HOME + '/.zshrc', 'utf8')
  .split('\n').map((l) => l.match(/^\s*(?:export\s+)?BASETEN_API_KEY\s*=\s*["']?([^"'\s]+)/))
  .find(Boolean)?.[1];
if (!KEY) throw new Error('no key');
const BASE = readFileSync('/Users/burnz/projects/muse-recall-rc/demo/forge-baseline/index.html', 'utf8');
const REQUEST = 'Make the game more exciting and challenging, like an arcade game.';
const memoryBlock = process.argv[2] === 'rule'
  ? '- This children’s game must avoid flashing effects, countdown timers, and penalties for mistakes.\n- Art direction: use a cool ocean palette. Primary accent #4EA8DE and dark text #102A43.'
  : '';
const base = buildForgePrompt({ kind: 'modify', request: REQUEST, memoryBlock });
const prompt = `${base}\n\nThe current index.html is:\n\`\`\`html\n${BASE}\n\`\`\`\n\nReturn the complete updated index.html in one \`\`\`html code block. No commentary.`;
const t0 = Date.now();
const res = await fetch('https://inference.baseten.co/v1/chat/completions', {
  method: 'POST',
  headers: { authorization: `Api-Key ${KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'meta-models/muse-spark-open-1026', messages: [{ role: 'user', content: prompt }], max_tokens: 20000, temperature: 0 }),
});
const body = await res.json();
console.log('status', res.status, 'seconds', ((Date.now()-t0)/1000).toFixed(1));
console.log('usage', body.usage);
const content = body.choices?.[0]?.message?.content ?? '';
console.log('content chars', content.length, 'reasoning chars', (body.choices?.[0]?.message?.reasoning_content ?? '').length);
const m = /```html\s*([\s\S]*?)```/i.exec(content) || /```\s*([\s\S]*?)```/.exec(content);
if (!m) { console.log('NO HTML BLOCK', content.slice(0,300)); process.exit(2); }
writeFileSync('/Users/burnz/projects/muse-memory-lab/research/phase16b/out/test-nomem.html', m[1].trim());
console.log('wrote', m[1].length);
