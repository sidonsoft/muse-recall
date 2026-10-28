/**
 * Phase 17 evidence inventory check (SHA256SUMS).
 *
 * `scripts/verify-phase17.ts` is itself hashed into `protocol.sha256`, so it
 * cannot be edited after the lock without invalidating the lock. The per-file
 * integrity check for the trial outputs therefore lives here, and
 * `pnpm verify:research17` runs this script after the locked verifier.
 *
 * Inventory policy:
 *   - the required artefacts are every file under `out/` in one of the four
 *     documented shapes (run HTML, run prompt, Spark job record, shard summary)
 *     plus `phase17-analysis.json`;
 *   - every required artefact must be listed in `SHA256SUMS`, and every listed
 *     file must exist and match its hash;
 *   - a file in an undocumented shape is an error, so an unexpected
 *     substantive artefact cannot be added silently;
 *   - explicitly named operating-system metadata (`.DS_Store`, AppleDouble
 *     `._*`, `Thumbs.db`, `desktop.ini`, `.localized`) is ignored and must not
 *     be listed: it is not evidence and must not make a correct tree fail.
 *
 * Usage: tsx scripts/verify-phase17-sums.ts [--root=<dir>]
 * No network, no model, no mutation.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootArg = process.argv.slice(2).find((a) => a.startsWith('--root='));
const ROOT = rootArg ? resolve(rootArg.slice('--root='.length)) : REPO;
const P17 = join(ROOT, 'docs/hackathon-evidence/phase17');
const ANALYSIS = 'phase17-analysis.json';

const OS_METADATA = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized']);
const isOsMetadata = (path: string) => {
  const name = basename(path);
  return OS_METADATA.has(name) || name.startsWith('._');
};

/** The only shapes evidence may take. Anything else is reported, not ignored. */
const ALLOWED = [
  /^out\/(spark|open)\/[A-Za-z0-9][A-Za-z0-9._-]*\.html$/,
  /^out\/(spark|open)\/prompts\/[A-Za-z0-9][A-Za-z0-9._-]*\.txt$/,
  /^out\/(spark|open)\/jobs\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/,
  /^out\/(spark|open)\/(spark|open)-shard-[0-5]\.json$/,
  /^phase17-analysis\.json$/,
];

interface RunRecord {
  id: string;
  status: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Every regular file under `dir`, as paths relative to P17. */
function walk(dir: string, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

assert(existsSync(join(P17, ANALYSIS)), `${ANALYSIS} is missing`);

const allOut = walk(join(P17, 'out'), 'out');
const ignoredMetadata = allOut.filter(isOsMetadata).length;
const presentOut = allOut.filter((p) => !isOsMetadata(p)).sort();
const present = [...presentOut, ANALYSIS].sort();

for (const path of presentOut) {
  assert(
    ALLOWED.some((re) => re.test(path)),
    `unexpected artefact (not one of the documented shapes): ${path}`,
  );
}

const lines = readFileSync(join(P17, 'SHA256SUMS'), 'utf8').trim().split('\n');
const listed = new Map<string, string>();
for (const line of lines) {
  const [hash, path] = line.split(/\s+/, 2);
  assert(/^[0-9a-f]{64}$/.test(hash), `malformed hash line: ${line}`);
  assert(!listed.has(path), `duplicate entry in SHA256SUMS: ${path}`);
  assert(!isOsMetadata(path), `SHA256SUMS must not list OS metadata: ${path}`);
  assert(
    ALLOWED.some((re) => re.test(path)),
    `SHA256SUMS lists an undocumented artefact: ${path}`,
  );
  listed.set(path, hash);
}

for (const path of present) {
  assert(listed.has(path), `SHA256SUMS is missing ${path}`);
  assert(sha256(join(P17, path)) === listed.get(path), `SHA256SUMS mismatch: ${path}`);
}
for (const path of listed.keys()) {
  assert(present.includes(path), `SHA256SUMS lists a missing file: ${path}`);
}

// Every shard record must have the artefacts its status implies.
const shards = presentOut.filter((p) => /-shard-[0-5]\.json$/.test(p));
for (const model of ['spark', 'open']) {
  assert(
    shards.some((p) => p.startsWith(`out/${model}/`)),
    `no ${model} shard summary is present`,
  );
}
for (const shard of shards) {
  const model = shard.split('/')[1];
  const rows = (JSON.parse(readFileSync(join(P17, shard), 'utf8')) as { results: RunRecord[] })
    .results;
  for (const r of rows) {
    const prompt = `out/${model}/prompts/${r.id}.txt`;
    const html = `out/${model}/${r.id}.html`;
    assert(listed.has(prompt), `SHA256SUMS is missing the prompt for ${r.id}`);
    if (r.status === 'succeeded') {
      assert(listed.has(html), `SHA256SUMS is missing the output for succeeded run ${r.id}`);
    } else {
      assert(!listed.has(html), `unusable run ${r.id} must not have a listed output`);
    }
    if (model === 'spark') {
      assert(listed.has(`out/${model}/jobs/${r.id}.json`), `missing job record for ${r.id}`);
    }
  }
}

console.log('Phase 17 evidence inventory (SHA256SUMS)');
console.log(
  `  files: ${listed.size} listed, ${present.length} present ` +
    `(out/ ${presentOut.length} + analysis 1)`,
);
console.log(`  os metadata ignored: ${ignoredMetadata}`);
console.log(`  hashes: ${listed.size}/${listed.size} match`);
console.log('PASS');
