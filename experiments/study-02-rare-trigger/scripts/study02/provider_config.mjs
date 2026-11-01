/**
 * Study 02 — authorized provider configuration loader (Pi / models config).
 *
 * Hackathon constraints (Director-confirmed):
 *  - The authorized model is already configured in the Pi provider/models configuration.
 *    Reuse that exact configuration; do not invent another model identifier.
 *  - One existing hackathon key exists. No dedicated replacement key is available or required.
 *  - Provider credits are supplied for hackathon use; do not require purchasing credits or
 *    creating another account.
 *  - This is the only authorized model and it will not be changed.
 *
 * This module reads the Pi configuration at runtime, validates the exactly-authorized
 * provider/model and limits, and returns the API key **in memory only**. It never prints,
 * logs or serialises the key; callers may export `publicSnapshot()` (key-free) for evidence.
 * A non-reversible fingerprint is available for provenance.
 *
 * No network access, no model call, no credential output.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PROVIDER = 'baseten-muse';
export const DEFAULT_MODEL = 'meta-models/muse-spark-open-1026';
export const DEFAULT_AGENT_DIR = path.join(os.homedir(), '.pi', 'agent');

export const AUTHORIZED_MODEL = Object.freeze({
  provider: DEFAULT_PROVIDER,
  modelId: DEFAULT_MODEL,
  baseUrl: 'https://inference.baseten.co/v1',
  api: 'openai-completions',
  contextWindow: 1_048_576,
  maxTokens: 32_768,
  cost: Object.freeze({ input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 }),
});

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const keyFingerprint = (key) => sha256(`s02-key-fingerprint:${key}`).slice(0, 16);

export function piVersion() {
  try {
    return execFileSync('pi', ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim();
  } catch {
    return null;
  }
}

function readJson(file, what) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${what} is missing or invalid JSON: ${file} (${error.message})`);
  }
}

/**
 * Load and validate the exactly-authorized provider/model configuration.
 * Returns a config whose `keyMaterial` is non-enumerable so accidental JSON.stringify()
 * of the config does not leak the key. Use `publicSnapshot()` for evidence.
 */
export function loadProviderConfig({
  provider = DEFAULT_PROVIDER,
  modelId = DEFAULT_MODEL,
  agentDir = process.env.PI_AGENT_DIR || DEFAULT_AGENT_DIR,
} = {}) {
  const modelsPath = path.join(agentDir, 'models.json');
  const settingsPath = path.join(agentDir, 'settings.json');
  const modelsRaw = readFileSync(modelsPath, 'utf8');
  const models = JSON.parse(modelsRaw);
  const providerConfig = models?.providers?.[provider];
  if (!providerConfig) {
    throw new Error(`authorized provider ${provider} is not configured in ${modelsPath}`);
  }
  const model = (providerConfig.models ?? []).find((entry) => entry?.id === modelId);
  if (!model) {
    throw new Error(`authorized model ${modelId} is not configured under provider ${provider} in ${modelsPath}`);
  }

  // Validate exact identity/limits against the authorized configuration, not a lookalike.
  if (providerConfig.baseUrl !== AUTHORIZED_MODEL.baseUrl) {
    throw new Error(`provider base URL mismatch: configured ${providerConfig.baseUrl}, authorized ${AUTHORIZED_MODEL.baseUrl}`);
  }
  if (providerConfig.api !== AUTHORIZED_MODEL.api) {
    throw new Error(`provider API style mismatch: configured ${providerConfig.api}, authorized ${AUTHORIZED_MODEL.api}`);
  }
  if (model.contextWindow !== AUTHORIZED_MODEL.contextWindow) {
    throw new Error(`context window mismatch: configured ${model.contextWindow}, authorized ${AUTHORIZED_MODEL.contextWindow}`);
  }
  if (model.maxTokens !== AUTHORIZED_MODEL.maxTokens) {
    throw new Error(`max output tokens mismatch: configured ${model.maxTokens}, authorized ${AUTHORIZED_MODEL.maxTokens}`);
  }
  for (const field of ['input', 'output', 'cacheRead', 'cacheWrite']) {
    if (Number(model.cost?.[field]) !== AUTHORIZED_MODEL.cost[field]) {
      throw new Error(`cost.${field} mismatch: configured ${model.cost?.[field]}, authorized ${AUTHORIZED_MODEL.cost[field]}`);
    }
  }

  // The existing hackathon key: prefer the provider entry, fall back to the Pi key file.
  // Read only to use in memory; never return it from publicSnapshot() or log it.
  let keyMaterial = typeof providerConfig.apiKey === 'string' && providerConfig.apiKey.length > 0
    ? providerConfig.apiKey
    : null;
  let keySource = 'providers.baseten-muse.apiKey in models.json';
  let keyFilePath = null;
  let keyFileMode = null;
  if (!keyMaterial) {
    keyFilePath = path.join(agentDir, 'baseten_key');
    if (!existsSync(keyFilePath)) throw new Error('no hackathon key found in provider config or Pi key file');
    keyMaterial = readFileSync(keyFilePath, 'utf8').trim();
    keySource = 'Pi key file';
    keyFileMode = (statSync(keyFilePath).mode & 0o777).toString(8);
  }
  if (!keyMaterial) throw new Error('hackathon key is empty');
  const fingerprint = keyFingerprint(keyMaterial);
  const keyLength = keyMaterial.length;
  // Remove any inline key from the parsed provider object so it cannot leak through it.
  const providerForSnapshot = { ...providerConfig, apiKey: undefined };

  const config = {
    provider,
    providerName: providerConfig.name ?? null,
    baseUrl: providerConfig.baseUrl,
    api: providerConfig.api,
    modelId: model.id,
    modelName: model.name ?? null,
    reasoning: model.reasoning ?? null,
    input: model.input ?? [],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: { ...model.cost },
    keyFingerprint: fingerprint,
    keyLength,
    keySource,
    keyFileMode,
    providerForSnapshot,
    sources: {
      agentDir,
      modelsPath,
      modelsSha256: sha256(modelsRaw),
      settingsPath: existsSync(settingsPath) ? settingsPath : null,
      settingsSha256: existsSync(settingsPath) ? sha256(readFileSync(settingsPath)) : null,
      piVersion: piVersion(),
    },
  };
  Object.defineProperty(config, 'keyMaterial', {
    value: keyMaterial,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return config;
}

/** Key-free evidence snapshot. Safe to write to disk / print. */
export function publicSnapshot(config) {
  const snapshot = {
    status: 'offline configuration check; no credential included; no model call made',
    provider: config.provider,
    providerName: config.providerName,
    baseUrl: config.baseUrl,
    api: config.api,
    modelId: config.modelId,
    modelName: config.modelName,
    reasoning: config.reasoning,
    input: config.input,
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    costUsdPerMillion: config.cost,
    credential: {
      source: config.keySource,
      fingerprintSha256_16: config.keyFingerprint,
      lengthClass: config.keyLength > 0 ? 'present' : 'missing',
      keyFileMode: config.keyFileMode,
      note: 'Existing hackathon key reused; no dedicated replacement key; value never exported.',
    },
    configuredIn: {
      providerFile: config.sources.modelsPath,
      providerFileSha256: config.sources.modelsSha256,
      settingsFile: config.sources.settingsPath,
      settingsFileSha256: config.sources.settingsSha256,
      piVersion: config.sources.piVersion,
      piDefaultProvider: readDefault(settingsPathIfAny(config.sources.settingsPath))?.defaultProvider ?? null,
      piDefaultModel: readDefault(settingsPathIfAny(config.sources.settingsPath))?.defaultModel ?? null,
    },
    authorizedModel: true,
    onlyAuthorizedModel: true,
    versionMetadata: {
      observable: 'Pi provider entry exposes id/name/context/maxTokens/cost only; no snapshot, revision or system-fingerprint field is configured.',
      snapshotGuarantee: 'none documented in the local configuration; public docs do not publish a dated snapshot guarantee for this slug',
      reproducibilityLimitation: 'Provider may route the configured model id to a different underlying snapshot; model identity/version must be treated as endpoint metadata observed per request, not as a frozen scientific constant.',
    },
  };
  const text = JSON.stringify(snapshot);
  if (config.keyMaterial && text.includes(config.keyMaterial)) {
    throw new Error('internal error: public snapshot would leak the credential');
  }
  return snapshot;
}

function settingsPathIfAny(p) {
  return p && existsSync(p) ? p : null;
}
function readDefault(p) {
  if (!p) return null;
  try {
    const s = JSON.parse(readFileSync(p, 'utf8'));
    return { defaultProvider: s.defaultProvider ?? null, defaultModel: s.defaultModel ?? null };
  } catch {
    return null;
  }
}
