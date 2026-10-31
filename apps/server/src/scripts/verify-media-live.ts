import { loadConfig, loadDotEnv } from '../config.js';
import { MediaAdapter } from '../media/adapter.js';
import { MediaOperations } from '../media/operations.js';

/**
 * `pnpm verify:media` — live provider verification for Batch B.
 *
 * Requires the real media key. Absent a key this reports `unconfigured` and
 * exits non-zero rather than pretending the provider path was proven. With a
 * key it performs a minimal generation followed by an edit of those bytes and
 * prints only validated metadata (never payloads or credentials).
 */
async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const key = config.forge?.apiKey ?? process.env.FORGE_MUSE_API_KEY ?? null;
  if (key === null || key.trim().length === 0) {
    console.log('media live verification: unconfigured (FORGE_MUSE_API_KEY is not set)');
    process.exitCode = 2;
    return;
  }
  const adapter = new MediaAdapter({
    apiKey: key,
    ...(config.forge?.model ? { model: config.forge.model } : {}),
    maxRetries: 0,
  });
  const operations = new MediaOperations(adapter, {
    ...(config.forge?.model ? { model: config.forge.model } : {}),
    generationTimeoutMs: 180_000,
  });

  const generated = await operations.generate({
    prompt: 'a single small blue circle centered on a plain white background',
    size: '512x512',
  });
  console.log(
    `generate: ok ${generated.mime} ${String(generated.width)}x${String(generated.height)} ${String(generated.bytes.length)} bytes (${generated.payload_source}, model ${generated.model})`,
  );

  const edited = await operations.edit({
    prompt: 'change the circle to green, keep everything else the same',
    size: '512x512',
    image: { bytes: generated.bytes, mime: generated.mime },
  });
  console.log(
    `edit: ok ${edited.mime} ${String(edited.width)}x${String(edited.height)} ${String(edited.bytes.length)} bytes (${edited.payload_source})`,
  );
}

main().catch((error: unknown) => {
  console.error('media live verification failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
