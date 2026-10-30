import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMcpServer, CONTRACT_RESOURCE_URI, mcpToolName } from '@mml/mcp-server';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { TOOL_CONTRACT_VERSION } from '@mml/shared';
import { createDefaultToolRegistry } from '@mml/tool-runtime';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Gap G-5 conformance: the MCP surface, the session tool registry, and the
 * REST tool list all resolve from ONE registry, carry a contract version, and
 * keep the beta's scope/confirmation semantics. Client + server run over an
 * in-memory transport pair — the same protocol objects a stdio client gets.
 */

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const item of cleanup.splice(0)) await item();
});

async function connect(
  options: { projectId?: string | null; allowWrites?: boolean } = {},
): Promise<{ client: Client; ids: string[] }> {
  const root = mkdtempSync(join(tmpdir(), 'mcp-contract-'));
  const database = openDatabase({ path: join(root, 'db.sqlite'), wal: false });
  const engine = new MemoryEngine(database.db);
  engine.ensureProject('demo');
  engine.create({
    type: 'contextual_fact',
    scope: 'project',
    project_id: 'demo',
    content: 'The countdown rule exists for the MCP conformance check.',
  });

  const registry = createDefaultToolRegistry();
  const server = buildMcpServer(
    registry,
    { db: database.db, memory: engine, now: () => new Date() },
    {
      projectId: options.projectId === undefined ? 'demo' : options.projectId,
      allowWrites: options.allowWrites,
    },
  );

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'conformance', version: '0.0.0' });
  await client.connect(clientSide);

  cleanup.push(async () => {
    await client.close().catch(() => undefined);
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { client, ids: registry.ids() };
}

describe('MCP conformance: one registry, versioned contract (G-5)', () => {
  it('advertises exactly the registry tools, dot-names mapped, reads annotated', async () => {
    const { client, ids } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...ids].map(mcpToolName).sort());
    const search = tools.find((tool) => tool.name === 'memory_search');
    expect(search?.title).toBe('memory.search');
    expect(search?.annotations?.readOnlyHint).toBe(true);
    const create = tools.find((tool) => tool.name === 'memory_create');
    expect(create?.annotations?.readOnlyHint).toBe(false);
    const graphInfo = tools.find((tool) => tool.name === 'memory_graph');
    expect(graphInfo?.annotations?.readOnlyHint).toBe(true);
    const inputSchema = search?.inputSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(inputSchema.properties ?? {})).toEqual(['query', 'limit']);
  });

  it('publishes the contract resource pinning version, scope, and write policy', async () => {
    const { client, ids } = await connect({ allowWrites: true });
    const resource = await client.readResource({ uri: CONTRACT_RESOURCE_URI });
    const document = JSON.parse(resource.contents[0]?.text ?? '{}') as {
      contract_version: string;
      project_id: string | null;
      write_policy: string;
      tools: Array<{ id: string; mcp_name: string; side_effect: string }>;
    };
    expect(document.contract_version).toBe(TOOL_CONTRACT_VERSION);
    expect(document.project_id).toBe('demo');
    expect(document.write_policy).toBe('enabled-at-startup');
    expect(document.tools.map((tool) => tool.id).sort()).toEqual([...ids].sort());
  });

  it('executes reads end to end with structured content matching the tool output', async () => {
    const { client } = await connect();
    const search = await client.callTool({
      name: 'memory_search',
      arguments: { query: 'countdown conformance', limit: 3 },
    });
    expect(search.isError).toBeFalsy();
    const structured = search.structuredContent as {
      selected_count: number;
      memories: Array<{ content: string }>;
    };
    expect(structured.selected_count).toBeGreaterThanOrEqual(1);
    expect(structured.memories[0]?.content).toContain('countdown');

    const project = await client.callTool({ name: 'project_get', arguments: {} });
    expect((project.structuredContent as { project: { id: string } }).project.id).toBe('demo');

    // D052 graph surface over MCP: same edges/events as REST, one registry.
    const graph = await client.callTool({ name: 'memory_graph', arguments: {} });
    expect(graph.isError).toBeFalsy();
    const graphOut = graph.structuredContent as {
      nodes: { id: string }[];
      events: { kind: string }[];
      truncated: boolean;
    };
    expect(graphOut.nodes.length).toBeGreaterThanOrEqual(1);
    expect(graphOut.events.some((event) => event.kind === 'created')).toBe(true);
  });

  it('runs writes only under the operator startup flag, then they persist', async () => {
    const closed = await connect();
    const denied = await closed.client.callTool({
      name: 'memory_create',
      arguments: { content: 'A write the model attempted anyway.' },
    });
    expect(denied.isError).toBe(true);
    expect((denied.content as Array<{ text: string }>)[0]?.text).toMatch(/writes disabled/);
    await cleanup.shift()?.();

    const open = await connect({ allowWrites: true });
    const created = await open.client.callTool({
      name: 'memory_create',
      arguments: { content: 'A write allowed at startup.', type: 'contextual_fact' },
    });
    expect(created.isError).toBeFalsy();
    const list = await open.client.callTool({
      name: 'memory_search',
      arguments: { query: 'allowed at startup' },
    });
    const structured = list.structuredContent as { memories: Array<{ content: string }> };
    expect(
      structured.memories.some((memory) => memory.content.includes('allowed at startup')),
    ).toBe(true);
  });

  it('project scope stays startup-bound: tools see no project when none is bound', async () => {
    const { client } = await connect({ projectId: null });
    const project = await client.callTool({ name: 'project_get', arguments: {} });
    expect(project.isError).toBe(true);
    expect((project.content as Array<{ text: string }>)[0]?.text).toMatch(/project/i);
  });

  it('rejects unknown tools and invalid arguments as errors, never as silent output', async () => {
    const { client } = await connect();
    const unknown = await client.callTool({ name: 'memory_searchs', arguments: {} });
    expect(unknown.isError).toBe(true);
    const invalid = await client.callTool({ name: 'memory_search', arguments: { query: 'x' } });
    expect(invalid.isError).toBe(true);
    expect((invalid.content as Array<{ text: string }>)[0]?.text).toMatch(/query/);
  });
});
