import { TOOL_CONTRACT_VERSION } from '@mml/shared';
import type { ToolContext, ToolRegistry } from '@mml/tool-runtime';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

/**
 * MCP surface for the shared tool contract (gap G-5).
 *
 * The seven bounded tools the session runtime already enforces are exposed over
 * the Model Context Protocol from the SAME registry — the REST tool list, the
 * session runtime, and this server can never drift, and a conformance test
 * pins that. JSON Schemas come from the tools' zod contracts (input and
 * output), so clients can validate structured results, not just text.
 *
 * Scope and confirmation semantics mirror the beta's threat model:
 *  - the project scope is bound when the server starts (operator choice),
 *    never taken from model arguments;
 *  - write tools run only when the operator started the server with writes
 *    allowed; a model cannot self-confirm, mirroring the session flow where a
 *    human approves pending writes.
 */

export const MCP_INSTRUCTIONS =
  'Muse Recall memory tools over the shared tool contract. Project scope is fixed when this server starts; tool arguments never change it. Write tools run only if the operator started this endpoint with writes enabled.';

export const CONTRACT_RESOURCE_URI = 'mcp-recall://contract';

export interface McpServerOptions {
  /** Project the tools operate on. Bound at startup, never model-supplied. */
  projectId: string | null;
  /**
   * When false (the default), write-class tools are advertised but every
   * call returns an isError explaining the operator policy.
   */
  allowWrites?: boolean;
  /** Audit identity recorded on records created through this surface. */
  sessionId?: string;
  name?: string;
  version?: string;
  contractVersion?: string;
}

/** MCP tool names must not contain dots; keep ids recoverable from names. */
export function mcpToolName(id: string): string {
  return id.replace(/\./g, '_');
}

export function buildMcpServer(
  registry: ToolRegistry,
  context: Omit<ToolContext, 'sessionId' | 'projectId'>,
  options: McpServerOptions,
): Server {
  const allowWrites = options.allowWrites ?? false;
  const sessionId = options.sessionId ?? 'mcp-stdio';
  const contractVersion = options.contractVersion ?? TOOL_CONTRACT_VERSION;

  const server = new Server(
    { name: options.name ?? 'muse-recall', version: options.version ?? '0.1.0' },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: MCP_INSTRUCTIONS,
    },
  );

  const tools = registry.list();
  const byName = new Map(tools.map((tool) => [mcpToolName(tool.id), tool]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => {
      const definition = registry.get(tool.id);
      const outputSchema = definition ? safeOutputSchema(definition.output) : undefined;
      return {
        name: mcpToolName(tool.id),
        title: tool.id,
        description: tool.description,
        inputSchema: tool.input_schema as { type: 'object'; [k: string]: unknown },
        ...(outputSchema ? { outputSchema } : {}),
        annotations: {
          readOnlyHint: tool.side_effect === 'read',
          destructiveHint: false,
          openWorldHint: false,
        },
      };
    }),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const info = byName.get(name);
    if (!info) {
      return {
        content: [{ type: 'text', text: `Unknown tool "${name}".` }],
        isError: true,
      };
    }
    if (info.side_effect === 'write' && !allowWrites) {
      return {
        content: [
          {
            type: 'text',
            text:
              `Tool "${info.id}" is a write and this MCP endpoint was started with writes ` +
              'disabled. The operator must enable writes when launching this server; a model ' +
              'cannot self-confirm.',
          },
        ],
        isError: true,
      };
    }
    const invocation = await registry.invoke(info.id, request.params.arguments ?? {}, {
      ...context,
      sessionId,
      projectId: options.projectId,
    });
    if (invocation.status === 'executed') {
      return {
        content: [{ type: 'text', text: JSON.stringify(invocation.output) }],
        structuredContent: invocation.output as Record<string, unknown>,
      };
    }
    if (invocation.status === 'invalid') {
      const issues = (invocation.issues ?? [])
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ');
      return {
        content: [{ type: 'text', text: `${invocation.error ?? 'Invalid arguments.'} ${issues}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: invocation.error ?? 'Tool failed.' }],
      isError: true,
    };
  });

  const contractDocument = () => ({
    contract_version: contractVersion,
    project_id: options.projectId,
    write_policy: allowWrites ? 'enabled-at-startup' : 'disabled-at-startup',
    tools: tools.map((tool) => ({
      id: tool.id,
      mcp_name: mcpToolName(tool.id),
      side_effect: tool.side_effect,
      requires_confirmation: tool.requires_confirmation,
    })),
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: CONTRACT_RESOURCE_URI,
        name: 'Tool contract',
        description: 'Versioned identity, scope, and write policy of this tool surface.',
        mimeType: 'application/json',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== CONTRACT_RESOURCE_URI) {
      throw new Error(`Unknown resource "${request.params.uri}".`);
    }
    return {
      contents: [
        {
          uri: CONTRACT_RESOURCE_URI,
          mimeType: 'application/json',
          text: JSON.stringify(contractDocument()),
        },
      ],
    };
  });

  return server;
}

function safeOutputSchema(output: unknown): Record<string, unknown> | undefined {
  try {
    return z.toJSONSchema(output as z.ZodType, { io: 'output' }) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
