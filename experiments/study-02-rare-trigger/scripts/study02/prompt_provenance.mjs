/**
 * Study 02 — frozen prompt provenance (D-14).
 *
 * The Dell pilot exposed a real provenance defect (review/07-PILOT-ERRATA.md D2): prompt
 * files were rebuilt on resume/restart while the production `MemoryEngine` assigns fresh
 * random memory UUIDs, so 41/132 record `prompt_sha256` values ended up not matching the
 * committed prompt bytes (same length, same content, different IDs).
 *
 * This module makes the confirmatory/qualification prompt set immutable:
 *
 *   freezePromptSet(): build once, write `<run_id>.txt` + `<run_id>.meta.json` atomically,
 *                      refuse to overwrite a different prompt, write a prompt manifest.
 *   loadPromptSet():   read the frozen bytes + metadata; verify SHA-256 against metadata and
 *                      against an optional frozen manifest; never rebuild.
 *   verifyPromptSet(): re-hash every prompt/meta and compare with the manifest.
 *
 * The bytes read from disk are the bytes the runner sends; the record's `prompt_sha256`
 * is computed from those bytes at execution time (see runner.mjs), never from a rebuild.
 *
 * No model calls, no clock dependence in the hashes/ordering; the only timestamps are in
 * metadata and are not part of any hash.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PROVENANCE_VERSION = 's02-prompt-provenance-1.0';
export const PROMPT_MANIFEST_NAME = 'prompts.manifest.json';

export const sha256Text = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
export const sha256Buffer = (buffer) => createHash('sha256').update(buffer).digest('hex');

export function promptPaths(promptsDir, runId) {
  return {
    promptFile: path.join(promptsDir, `${runId}.txt`),
    metaFile: path.join(promptsDir, `${runId}.meta.json`),
    manifestFile: path.join(promptsDir, PROMPT_MANIFEST_NAME),
  };
}

function writeAtomic(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

function readJson(file, what) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${what} is missing or invalid JSON: ${file} (${error.message})`);
  }
}

/** Metadata fields that must accompany one frozen prompt. */
const META_FIELDS = [
  'baseline_sha256', 'memory_ids', 'memory_contents', 'seeded', 'correction',
  'retrieval', 'request_text', 'rule_in_prompt', 'correction_in_prompt', 'manipulation',
];

export function metaFromPromptInfo(runId, promptInfo) {
  const meta = {
    provenance_version: PROVENANCE_VERSION,
    run_id: runId,
    prompt_sha256: sha256Text(promptInfo.prompt),
    prompt_bytes: Buffer.byteLength(promptInfo.prompt),
    prompt_chars: promptInfo.prompt.length,
    memory_id_source: 'production MemoryEngine (random UUIDs captured here and hashed into the prompt)',
  };
  for (const field of META_FIELDS) {
    if (!(field in promptInfo)) throw new Error(`promptInfo is missing required provenance field ${field}`);
    meta[field] = promptInfo[field];
  }
  return meta;
}

function loadedFromMeta(prompt, meta, files) {
  const info = {
    prompt,
    prompt_sha256: sha256Text(prompt),
    prompt_bytes: Buffer.byteLength(prompt),
    provenance_version: PROVENANCE_VERSION,
    prompt_file: files.promptFile,
    prompt_meta_file: files.metaFile,
    prompt_meta_sha256: sha256Buffer(readFileSync(files.metaFile)),
    frozen: true,
  };
  for (const field of META_FIELDS) info[field] = meta[field];
  if (info.prompt_sha256 !== meta.prompt_sha256) {
    throw new Error(`frozen prompt hash mismatch for ${meta.run_id}: file ${info.prompt_sha256} != meta ${meta.prompt_sha256}`);
  }
  if (info.prompt_bytes !== meta.prompt_bytes) {
    throw new Error(`frozen prompt byte-length mismatch for ${meta.run_id}`);
  }
  if (!info.manipulation || info.manipulation.passed !== true) {
    throw new Error(`frozen prompt for ${meta.run_id} failed its recorded manipulation check`);
  }
  return info;
}

/**
 * Build/verify one frozen prompt. Never overwrites different bytes.
 * @returns {object} promptInfo with `frozen: true`
 */
export function freezeOnePrompt({ runId, promptsDir, build }) {
  const files = promptPaths(promptsDir, runId);
  if (existsSync(files.promptFile) || existsSync(files.metaFile)) {
    if (!existsSync(files.promptFile) || !existsSync(files.metaFile)) {
      throw new Error(`incomplete frozen prompt pair for ${runId}: prompt and meta must both exist`);
    }
    const prompt = readFileSync(files.promptFile, 'utf8');
    const meta = readJson(files.metaFile, 'prompt meta');
    if (meta.run_id !== runId) throw new Error(`frozen meta run_id mismatch for ${runId}`);
    return loadedFromMeta(prompt, meta, files);
  }
  const promptInfo = build();
  const meta = metaFromPromptInfo(runId, promptInfo);
  writeAtomic(files.promptFile, promptInfo.prompt);
  writeAtomic(files.metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  return loadedFromMeta(promptInfo.prompt, meta, files);
}

/** Freeze (or verify) a whole set and write the prompt manifest. */
export function freezePromptSet({ specs, promptsDir, buildFor, writeManifest = true }) {
  const entries = [];
  const promptInfos = new Map();
  for (const spec of specs) {
    const info = freezeOnePrompt({ runId: spec.run_id, promptsDir, build: () => buildFor(spec) });
    promptInfos.set(spec.run_id, info);
    entries.push({
      run_id: spec.run_id,
      prompt_sha256: info.prompt_sha256,
      prompt_bytes: info.prompt_bytes,
      prompt_meta_sha256: info.prompt_meta_sha256,
      memory_ids: info.memory_ids,
    });
  }
  let manifest = null;
  if (writeManifest) {
    manifest = {
      provenance_version: PROVENANCE_VERSION,
      generated_from: 'freezePromptSet',
      count: entries.length,
      prompts: entries,
    };
    const file = promptPaths(promptsDir, '.').manifestFile;
    writeAtomic(file, `${JSON.stringify(manifest, null, 2)}\n`);
    manifest.manifest_sha256 = sha256Buffer(readFileSync(file));
    manifest.manifest_file = file;
  }
  return { promptInfos, manifest };
}

/** Load a frozen prompt set; refuses missing, mismatched or unfrozen entries. */
export function loadPromptSet({ specs, promptsDir, expectedManifest = null }) {
  if (!expectedManifest) {
    throw new Error('frozen prompt load requires the frozen prompt manifest (prevents meta/prompt drift)');
  }
  const promptInfos = new Map();
  for (const spec of specs) {
    const files = promptPaths(promptsDir, spec.run_id);
    if (!existsSync(files.promptFile) || !existsSync(files.metaFile)) {
      throw new Error(`frozen prompt missing for ${spec.run_id}: run --write-frozen-prompts before execution`);
    }
    const prompt = readFileSync(files.promptFile, 'utf8');
    const meta = readJson(files.metaFile, 'prompt meta');
    const info = loadedFromMeta(prompt, meta, files);
    if (expectedManifest) {
      const entry = expectedManifest.prompts?.find((row) => row.run_id === spec.run_id);
      if (!entry) throw new Error(`frozen manifest has no entry for ${spec.run_id}`);
      if (entry.prompt_sha256 !== info.prompt_sha256) {
        throw new Error(`frozen manifest hash mismatch for ${spec.run_id}`);
      }
      if (entry.prompt_meta_sha256 !== info.prompt_meta_sha256) {
        throw new Error(`frozen meta hash mismatch for ${spec.run_id}`);
      }
    }
    promptInfos.set(spec.run_id, info);
  }
  return { promptInfos };
}

/** Re-verify every prompt/meta against a manifest; returns a report (throws on failure). */
export function verifyPromptSet({ promptsDir, manifestFile = null }) {
  const file = manifestFile ?? promptPaths(promptsDir, '.').manifestFile;
  const manifest = readJson(file, 'prompt manifest');
  const problems = [];
  for (const entry of manifest.prompts ?? []) {
    const files = promptPaths(promptsDir, entry.run_id);
    if (!existsSync(files.promptFile)) { problems.push(`${entry.run_id}: prompt missing`); continue; }
    if (!existsSync(files.metaFile)) { problems.push(`${entry.run_id}: meta missing`); continue; }
    const promptHash = sha256Buffer(readFileSync(files.promptFile));
    const metaHash = sha256Buffer(readFileSync(files.metaFile));
    if (promptHash !== entry.prompt_sha256) problems.push(`${entry.run_id}: prompt hash mismatch`);
    if (metaHash !== entry.prompt_meta_sha256) problems.push(`${entry.run_id}: meta hash mismatch`);
  }
  const actualManifestHash = sha256Buffer(readFileSync(file));
  return {
    ok: problems.length === 0,
    count: (manifest.prompts ?? []).length,
    manifest_sha256: actualManifestHash,
    problems,
  };
}
