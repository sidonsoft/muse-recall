import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import { TOOL_CONTRACT_VERSION } from '@mml/shared';
import { createDefaultToolRegistry } from '@mml/tool-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/fake-muse.mjs', import.meta.url));

const open: Array<{ close: () => Promise<void>; root: string }> = [];
afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

function config(root: string): AppConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    corsOrigins: [],
    databasePath: ':memory:',
    wal: false,
    workspaceRoot: root,
    toolApprovalPolicy: 'always',
    provider: { kind: 'echo', museBin: FIXTURE },
    memoryBudget: { max_memories: 8, max_characters: 4_000, max_memory_characters: 1_000 },
    sweepOnStart: true,
    agent: {
      budgets: {
        max_history_messages: 8,
        max_history_characters: 6_000,
        max_memory_characters: 4_000,
        max_prompt_characters: 24_000,
        max_message_characters: 8_000,
        max_correction_history: 3,
      },
      autoCapture: 'suggest',
      includeCorrectionHistory: true,
      maxOutputTokens: 1_200,
      tools: { enabled: false, approvalPolicy: 'always', maxCallsPerTurn: 3, decisionMode: 'off' },
    },
    serviceVersion: SERVICE_VERSION,
  };
}

describe('REST tool list shares the versioned contract (G-5)', () => {
  it('GET /api/tools stamps the contract version and lists the same registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tools-contract-'));
    const database = openDatabase({ path: ':memory:', wal: false });
    const engine = new MemoryEngine(database.db);
    const app = await buildApp({
      config: config(root),
      db: database.db,
      dbPath: ':memory:',
      provider: new EchoProvider(),
      engine,
      providerHealth: new ProviderHealthTracker(new EchoProvider(), 0),
    });
    open.push({
      close: async () => {
        await app.close();
        database.close();
      },
      root,
    });

    const response = await app.inject({ method: 'GET', url: '/api/tools' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: { items: Array<{ id: string }>; contract_version: string };
    };
    expect(body.data.contract_version).toBe(TOOL_CONTRACT_VERSION);
    expect(body.data.items.map((tool) => tool.id)).toEqual(createDefaultToolRegistry().ids());
  });
});
