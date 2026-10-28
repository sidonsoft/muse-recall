/**
 * Phase 17 as-run integrity check (SHA256SUMS).
 *
 * `scripts/verify-phase17.ts` is itself hashed into `protocol.sha256`, so it
 * cannot be edited after the lock without invalidating the lock. The per-file
 * integrity check for the trial outputs therefore lives here, and
 * `pnpm verify:research17` runs this script after the locked verifier. It is
 * the same check `verify-phase16.ts` performs for Phase 16.
 *
 *   - every file under `out/` plus `phase17-analysis.json` is listed exactly
 *     once, and no line names a file that is not there;
 *   - every listed hash matches the file on disk.
 *
 * No network, no model, no mutation.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P17 = join(ROOT, 'docs/hackathon-evidence/phase17');
const ANALYSIS = 'phase17-analysis.json';

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Every regular file under `dir`, as paths relative to P17, sorted. */
function walk(dir: string, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

const expected = [...walk(join(P17, 'out'), 'out'), ANALYSIS].sort();
const lines = readFileSync(join(P17, 'SHA256SUMS'), 'utf8').trim().split('\n');

const listed = new Map<string, string>();
for (const line of lines) {
  const [hash, path] = line.split(/\s+/, 2);
  assert(/^[0-9a-f]{64}$/.test(hash), `malformed hash line: ${line}`);
  assert(!listed.has(path), `duplicate entry in SHA256SUMS: ${path}`);
  listed.set(path, hash);
}

for (const path of expected) {
  assert(listed.has(path), `SHA256SUMS is missing ${path}`);
  assert(sha256(join(P17, path)) === listed.get(path), `SHA256SUMS mismatch: ${path}`);
}
for (const path of listed.keys()) {
  assert(expected.includes(path), `SHA256SUMS lists a file that is not a trial artefact: ${path}`);
}

const outFiles = expected.length - 1;
console.log('Phase 17 as-run integrity (SHA256SUMS)');
console.log(
  `  files: ${listed.size} listed (out/ ${outFiles} + analysis 1), ${expected.length} present`,
);
console.log(`  hashes: ${listed.size}/${listed.size} match`);
console.log('PASS');
