/**
 * Offline tests for the authorized provider-configuration loader. No network, no model calls,
 * and the credential value is never printed.
 */
import { loadProviderConfig, publicSnapshot, AUTHORIZED_MODEL } from './provider_config.mjs';

let failures = 0;
function assert(condition, message) {
  if (condition) console.log(`  ok   ${message}`);
  else { failures += 1; console.error(`  FAIL ${message}`); }
}
function throws(fn, matcher, message) {
  try { fn(); failures += 1; console.error(`  FAIL ${message} (did not throw)`); }
  catch (error) { assert(matcher.test(String(error.message)), `${message}: ${String(error.message).slice(0, 120)}`); }
}

console.log('authorized configuration loads');
const config = loadProviderConfig();
assert(config.provider === 'baseten-muse', 'provider is baseten-muse');
assert(config.modelId === 'meta-models/muse-spark-open-1026', 'configured model id is the existing authorized identifier');
assert(config.baseUrl === 'https://inference.baseten.co/v1', 'base URL matches the configured provider');
assert(config.api === 'openai-completions', 'API style is openai-completions');
assert(config.contextWindow === 1_048_576, 'context window 1,048,576');
assert(config.maxTokens === 32_768, 'max output tokens 32,768');
assert(config.cost.input === 1.25 && config.cost.output === 4.25 && config.cost.cacheRead === 0.15, 'costs match configured values');
assert(typeof config.keyMaterial === 'string' && config.keyMaterial.length > 0, 'existing hackathon key is present (value not printed)');
assert(!Object.keys(config).includes('keyMaterial'), 'keyMaterial is non-enumerable on the config object');
assert(!JSON.stringify(config).includes(config.keyMaterial), 'JSON.stringify(config) does not include the key');
assert(/^[0-9a-f]{16}$/.test(config.keyFingerprint), 'non-reversible 16-hex key fingerprint available');
assert(config.sources.piVersion !== null, `Pi version observed: ${config.sources.piVersion}`);

console.log('public snapshot is key-free');
const snapshot = publicSnapshot(config);
const text = JSON.stringify(snapshot);
assert(!text.includes(config.keyMaterial), 'snapshot does not contain the key');
assert(snapshot.credential.fingerprintSha256_16 === config.keyFingerprint, 'snapshot carries the fingerprint');
assert(snapshot.versionMetadata && snapshot.versionMetadata.snapshotGuarantee.includes('none'), 'snapshot limitation recorded');
assert(snapshot.authorizedModel === true && snapshot.onlyAuthorizedModel === true, 'authorized-model facts recorded');

console.log('refuses lookalike identities');
throws(() => loadProviderConfig({ modelId: 'meta-models/muse-spark-open' }), /not configured/, 'public alias is not silently accepted');
throws(() => loadProviderConfig({ provider: 'strata' }), /not configured|authorized model/, 'unrelated provider is refused');
throws(() => loadProviderConfig({ agentDir: '/nonexistent-pi-agent-dir' }), /missing|ENOENT/, 'missing config directory is refused');
throws(() => loadProviderConfig({ provider: 'baseten-muse', modelId: AUTHORIZED_MODEL.modelId, agentDir: '/tmp' }), /not configured|missing|ENOENT/, 'config without the authorized provider is refused');

if (failures > 0) {
  console.error(`\n${failures} provider-config test(s) failed`);
  process.exit(1);
}
console.log('\nall provider-config tests passed (no credential printed)');
