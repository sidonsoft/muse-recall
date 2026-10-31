/**
 * Offline tests for the D-14 frozen-prompt provenance module. No model calls, no network.
 * Run: pnpm exec tsx experiments/study-02-rare-trigger/scripts/study02/test_prompt_provenance.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  freezePromptSet, freezeOnePrompt, loadPromptSet, promptPaths, sha256Text, verifyPromptSet,
} from './prompt_provenance.mjs';

let failures = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`  ok   ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${message}`);
  }
}
function throws(fn, matcher, message) {
  try {
    fn();
    failures += 1;
    console.error(`  FAIL ${message} (did not throw)`);
  } catch (error) {
    assert(matcher.test(String(error.message)), `${message}: ${String(error.message).slice(0, 120)}`);
  }
}

function makeInfo(runId, text) {
  return {
    prompt: `${runId}\n${text}`,
    baseline_sha256: sha256Text(`baseline:${runId}`),
    memory_ids: [`mem-${runId}-1`, `mem-${runId}-2`],
    memory_contents: ['rule', 'context'],
    seeded: [],
    correction: null,
    retrieval: { memory_count: 2 },
    request_text: 'request',
    rule_in_prompt: true,
    correction_in_prompt: false,
    manipulation: { passed: true, problems: [], expected: { memories: 2, rule_in_prompt: true } },
  };
}

const root = mkdtempSync(path.join(os.tmpdir(), 's02-provenance-test-'));
try {
  const dir = path.join(root, 'prompts');
  const specs = ['run-a', 'run-b', 'run-c'].map((id) => ({ run_id: id }));
  let builds = 0;
  const buildFor = (spec) => {
    builds += 1;
    return makeInfo(spec.run_id, 'built');
  };

  console.log('freeze set');
  const frozen = freezePromptSet({ specs, promptsDir: dir, buildFor });
  assert(builds === 3, 'builds once per run on first freeze');
  assert(frozen.promptInfos.size === 3, 'all prompts frozen');
  assert(frozen.manifest.count === 3, 'manifest count');
  const verify = verifyPromptSet({ promptsDir: dir });
  assert(verify.ok, 'manifest verifies');
  assert(verify.manifest_sha256 === frozen.manifest.manifest_sha256, 'manifest hash stable');

  console.log('second freeze never rebuilds or overwrites');
  const buildsBefore = builds;
  const again = freezePromptSet({ specs, promptsDir: dir, buildFor });
  assert(builds === buildsBefore, 'no rebuild on second freeze');
  assert(again.manifest.manifest_sha256 === frozen.manifest.manifest_sha256, 'manifest unchanged');

  console.log('load frozen set');
  const loaded = loadPromptSet({ specs, promptsDir: dir, expectedManifest: frozen.manifest });
  assert(loaded.promptInfos.get('run-a').prompt === frozen.promptInfos.get('run-a').prompt, 'same bytes');
  assert(loaded.promptInfos.get('run-a').prompt_sha256 === sha256Text(loaded.promptInfos.get('run-a').prompt), 'hash of loaded bytes');
  assert(loaded.promptInfos.get('run-a').memory_ids.length === 2, 'memory ids preserved');
  assert(loaded.promptInfos.get('run-a').frozen === true, 'marked frozen');

  console.log('tamper detection');
  const tampered = promptPaths(dir, 'run-b').promptFile;
  const original = readFileSync(tampered, 'utf8');
  writeFileSync(tampered, `${original}\nTAMPER`);
  throws(() => loadPromptSet({ specs, promptsDir: dir, expectedManifest: frozen.manifest }), /hash mismatch/, 'load rejects tampered prompt');
  assert(!verifyPromptSet({ promptsDir: dir }).ok, 'verify rejects tampered prompt');
  writeFileSync(tampered, original);
  assert(verifyPromptSet({ promptsDir: dir }).ok, 'restored prompt verifies');
  const metaTampered = promptPaths(dir, 'run-c').metaFile;
  const originalMeta = readFileSync(metaTampered, 'utf8');
  writeFileSync(metaTampered, originalMeta.replace('"rule_in_prompt": true', '"rule_in_prompt": false'));
  throws(() => loadPromptSet({ specs, promptsDir: dir, expectedManifest: frozen.manifest }), /meta hash mismatch/, 'load rejects tampered meta');
  writeFileSync(metaTampered, originalMeta);

  console.log('missing frozen prompt is fatal');
  rmSync(promptPaths(dir, 'run-a').promptFile);
  throws(() => loadPromptSet({ specs, promptsDir: dir, expectedManifest: frozen.manifest }), /missing/, 'load rejects missing prompt');

  console.log('freezeOnePrompt refuses partial pairs');
  writeFileSync(promptPaths(dir, 'run-orphan').promptFile, 'orphan');
  throws(() => freezeOnePrompt({ runId: 'run-orphan', promptsDir: dir, build: () => makeInfo('run-orphan', 'x') }), /incomplete/, 'partial pair refused');
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} provenance test(s) failed`);
  process.exit(1);
}
console.log('\nall prompt-provenance tests passed');
