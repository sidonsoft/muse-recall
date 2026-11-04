import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { createModelProvider } from '@mml/muse-provider';
import { buildApp } from './app.js';
import { loadConfig, loadDotEnv } from './config.js';
import { isLoopbackSocketAddress } from './host-guard.js';
import { formatSetupPanel, probeSetupReadiness } from './setup-readiness.js';

/**
 * Server entrypoint: load config, open the database, build the app, listen.
 * Any failure here is fatal and reported with its cause — a half-started
 * server is worse than a refused one.
 */
async function main(): Promise<void> {
  const envFile = loadDotEnv();
  const config = loadConfig();

  const database = openDatabase({ path: config.databasePath, wal: config.wal });

  const provider = createModelProvider(config.provider);
  const engine = new MemoryEngine(database.db);
  const app = await buildApp({
    config,
    db: database.db,
    dbPath: config.databasePath,
    provider,
    engine,
    startedAt: Date.now(),
  });

  // Retention runs once at startup so an expired memory is never retrievable
  // just because the server was down when its deadline passed.
  if (config.sweepOnStart) {
    const expired = engine.expireStale();
    if (expired > 0) app.log.info({ expired }, 'marked expired memories');
  }

  if (provider.id !== 'muse-cli') {
    app.log.warn(
      { provider: provider.id },
      'Running on the deterministic offline provider. This is NOT Meta Muse — set MODEL_PROVIDER=muse-cli for real inference.',
    );
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
    } finally {
      database.close();
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });

  // `localhost` is resolved at bind time; confirm every bound socket is
  // actually loopback rather than trusting the configured name.
  const exposed = app.addresses().filter((bound) => !isLoopbackSocketAddress(bound.address));
  if (exposed.length > 0 && !config.accessToken) {
    await app.close();
    database.close();
    throw new Error(
      `Refusing to serve on non-loopback address ${exposed.map((bound) => bound.address).join(', ')} — HOST=${config.host} did not resolve to loopback`,
    );
  }
  if (exposed.length > 0) {
    // G-6 groundwork: a non-loopback bind is only reachable with the bearer
    // token, and the Host guard relaxed its name check solely for that mode.
    // The secret must have arrived out of band — say so on every startup.
    app.log.warn(
      { addresses: exposed.map((bound) => bound.address) },
      'Serving off-loopback under ACCESS_TOKEN: authentication without identity; provision the secret out of band',
    );
  }

  app.log.info(
    {
      url: `http://${config.host}:${config.port}`,
      provider: provider.id,
      model: config.provider.museModel ?? null,
      database: config.databasePath,
      workspaceRoot: config.workspaceRoot,
      envFile,
      environment: config.environment,
    },
    'Muse Recall API ready',
  );

  /*
   * The setup panel, printed on every start. A judge's first failure is almost
   * never a server error: it is a missing seed, a missing browser, or expecting
   * live generation from an `echo` run or a codespace. All of those look like a
   * healthy server showing an empty screen, so the answer goes to the terminal
   * the judge is already reading. Offline by construction — no request leaves
   * the machine here — and a probe failure must never take the server down.
   */
  try {
    const setup = probeSetupReadiness({
      providerId: provider.id,
      cliBin: config.forge?.museBin ?? config.provider.museBin,
      mediaApiKey: config.forge?.apiKey ?? null,
      mediaModel: config.media?.model,
      samModel: config.media?.samModel,
      databasePath: config.databasePath,
      workspaceRoot: config.workspaceRoot,
    });
    app.log.info(formatSetupPanel(setup));
    if (setup.offline_seed.state === 'missing') {
      app.log.warn(
        'The offline demo is not seeded, so Studio opens with no project. Run `pnpm demo:seed` and restart.',
      );
    }
  } catch (error) {
    app.log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'setup readiness probe could not complete; GET /api/health omits the setup block',
    );
  }
}

main().catch((error: unknown) => {
  console.error('Fatal startup error:', error instanceof Error ? error.message : error);
  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exit(1);
});
