#!/usr/bin/env node
// Link audit: every github.com/sidonsoft/muse-recall path referenced in the site
// must exist in the upstream repo checkout. Run after editing copy or links.
// Usage: npm run links   (expects the muse-recall clone at ../muse-recall-src,
//        or set UPSTREAM=/path/to/muse-recall)
import fs from 'node:fs';
import path from 'node:path';

const UP = process.env.UPSTREAM || new URL('../muse-recall-src', `file://${process.cwd()}/`).pathname;
if (!fs.existsSync(UP)) {
  console.error(`links: upstream checkout not found at ${UP} (set UPSTREAM=...)`);
  process.exit(1);
}

const base = {
  REPO: 'https://github.com/sidonsoft/muse-recall',
  DOCS: 'https://github.com/sidonsoft/muse-recall/blob/main/docs',
  RESULTS: 'https://github.com/sidonsoft/muse-recall/blob/main/docs/hackathon-evidence/phase17/RESULTS.md',
  DOCS16: 'https://github.com/sidonsoft/muse-recall/blob/main/docs/hackathon-evidence/phase16/EVIDENCE_CARD.md',
};

let all = '';
for (const f of ['src/components/Sections.jsx', 'src/components/Nav.jsx', 'src/components/Hero.jsx', 'index.html']) {
  let s = fs.readFileSync(f, 'utf8');
  for (const [k, v] of Object.entries(base)) s = s.split('${' + k + '}').join(v);
  all += s;
}

const re = /github\.com\/sidonsoft\/muse-recall([^\s`'"<>)]*)/g;
const seen = new Set();
let m;
let fails = 0;
while ((m = re.exec(all))) {
  const p = m[1];
  if (seen.has(p)) continue;
  seen.add(p);
  const loc = p.replace(/^\/(blob|tree)\/main\//, '').replace(/^\/$/, '');
  if (!loc) continue;
  if (fs.existsSync(path.join(UP, loc))) {
    console.log(`OK   ${loc}`);
  } else {
    fails++;
    console.log(`MISS ${loc}`);
  }
}
console.log(`${seen.size} unique paths, ${fails} broken`);
process.exit(fails ? 1 : 0);
