#!/usr/bin/env node
// Link audit: every github.com/sidonsoft/muse-recall path referenced in the site
// must exist in the upstream repo checkout. Run after editing copy or links.
// Release tags are resolved to a commit; set CITED_COMMIT=<sha> to assert the tag
// still points where the copy says it does.
// Usage: npm run links   (audits the parent muse-recall checkout this folder lives in,
//        or set UPSTREAM=/path/to/muse-recall)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const UP = process.env.UPSTREAM || new URL('..', `file://${process.cwd()}/`).pathname;
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
for (const f of [
  'src/components/Sections.jsx',
  'src/components/Nav.jsx',
  'src/components/Hero.jsx',
  'src/components/CommandPalette.jsx',
  'index.html',
]) {
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
  if (loc.startsWith('#')) {
    // README anchor: GitHub slugs each heading (lowercase, drop punctuation, spaces to hyphens)
    const slugs = fs
      .readFileSync(path.join(UP, 'README.md'), 'utf8')
      .split('\n')
      .filter((l) => /^#{1,6} /.test(l))
      .map((l) => l.replace(/^#+ /, '').trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-'));
    if (slugs.includes(loc.slice(1))) console.log(`OK   README ${loc}`);
    else {
      fails++;
      console.log(`MISS README ${loc}`);
    }
    continue;
  }
  const commit = loc.match(/^\/commit\/([0-9a-f]{7,40})$/)?.[1];
  if (commit) {
    const r = spawnSync('git', ['-C', UP, 'cat-file', '-e', `${commit}^{commit}`]);
    if (r.status === 0) console.log(`OK   commit ${commit}`);
    else {
      fails++;
      console.log(`MISS commit ${commit}`);
    }
    continue;
  }
  // A release tag: it must exist, and it must still name the commit the copy cites.
  const tag = loc.match(/^\/releases\/tag\/(.+)$/)?.[1];
  if (tag) {
    const show = spawnSync('git', ['-C', UP, 'rev-parse', '--verify', `refs/tags/${tag}^{commit}`], {
      encoding: 'utf8',
    });
    if (show.status !== 0) {
      fails++;
      console.log(`MISS tag    ${tag}`);
    } else {
      const at = show.stdout.trim();
      const cited = process.env.CITED_COMMIT;
      const mismatch = cited && !at.startsWith(cited);
      if (mismatch) fails++;
      console.log(`${mismatch ? 'MISS tag' : 'OK   tag'}  ${tag} → ${at.slice(0, 40)}${mismatch ? ` (copy cites ${cited})` : ''}`);
    }
    continue;
  }
  if (fs.existsSync(path.join(UP, loc))) {
    console.log(`OK   ${loc}`);
  } else {
    fails++;
    console.log(`MISS ${loc}`);
  }
}
console.log(`${seen.size} unique paths, ${fails} broken`);
process.exit(fails ? 1 : 0);
