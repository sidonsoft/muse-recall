#!/usr/bin/env -S node --import tsx
/**
 * mcp-recall — stdio MCP server for the shared tool contract.
 *
 * Usage:
 *   DATABASE_PATH=/path/to/db node --import tsx packages/mcp-server/src/main.ts \
 *     [--project <project-id>] [--allow-writes] [--db <path>]
 *
 * Stdout carries MCP traffic only; diagnostics go to stderr.
 */
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { createDefaultToolRegistry } from '@mml/tool-runtime';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from './index.js';

function fail(message: string): never {
  console.error(`mcp-recall: ${message}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
let projectId: string | null = null;
let allowWrites = false;
let dbPath = process.env.DATABASE_PATH ?? '';
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--project') {
    projectId = argv[index + 1] ?? fail('--project requires a value');
    index += 1;
  } else if (arg === '--allow-writes') {
    allowWrites = true;
  } else if (arg === '--db') {
    dbPath = argv[index + 1] ?? fail('--db requires a value');
    index += 1;
  } else {
    fail(`unknown argument "${arg}"`);
  }
}
if (!dbPath) fail('set DATABASE_PATH or pass --db <path>');

const database = openDatabase({ path: dbPath });
const engine = new MemoryEngine(database.db);
const registry = createDefaultToolRegistry();
const server = buildMcpServer(
  registry,
  { db: database.db, memory: engine, now: () => new Date() },
  { projectId, allowWrites },
);

console.error(
  `mcp-recall: project=${projectId ?? '(none)'} writes=${allowWrites ? 'enabled' : 'disabled'} db=${dbPath}`,
);
await server.connect(new StdioServerTransport());
