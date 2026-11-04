import { TOOL_CONTRACT_VERSION, type ToolInfo } from '@mml/shared';
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
 * Scope and write policy are STARTUP bindings (D043, as amended for the local
 * beta):
 *  - the project scope is bound when the server starts (operator choice),
 *    never taken from model arguments;
 *  - writes are REFUSED by default — the endpoint is read-only unless the
 *    operator starts it with --allow-writes;
 *  - when writes are enabled, that startup switch authorizes EVERY write call
 *    for the process lifetime. This surface performs NO per-write review:
 *    there is no pending-write queue and nothing to approve per call. Any
 *    human review at this surface is the operator's MCP client's job. The
 *    session runtime's per-write approval flow (D032) lives on the session
 *    surface, not here.
 */

export const MCP_INSTRUCTIONS =
  "Muse Recall memory tools over the shared tool contract. Project scope is fixed when this server starts; tool arguments never change it. Write tools are refused unless the operator started this endpoint with writes enabled (--allow-writes). When enabled, that startup switch authorizes every write for the process lifetime: this endpoint performs no per-write review, so any human review is the connected MCP client's responsibility.";

export const CONTRACT_RESOURCE_URI = 'mcp-recall://contract';

export interface McpServerOptions {
  /** Project the tools operate on. Bound at startup, never model-supplied. */
  projectId: string | null;
  /**
   * When false (the default), write-class tools are advertised but every
   * call returns an isError explaining the operator policy. When true, the
   * switch authorizes EVERY write call for the process lifetime — this
   * surface performs no per-write review either way (see MCP_INSTRUCTIONS).
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
    { name: options.name ?? 'muse-recall', version: options.version ?? '0.1.1' },
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
        description: tool.description + writePolicyNote(tool, allowWrites),
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
              `Tool "${info.id}" is a write and this MCP endpoint is read-only: writes were not ` +
              'enabled when the operator launched it (--allow-writes is a STARTUP switch that, ' +
              'when set, authorizes every write for the process lifetime). A model cannot enable ' +
              'writes at runtime, and this endpoint performs no per-write review either way.',
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
    // Per-surface truth (beta fix): MCP has no interactive approval channel,
    // so write policy is enforced ONCE at startup and every allowed write
    // executes immediately. The per-tool requires_confirmation below is the
    // shared registry's session-runtime gate — read write_execution and
    // per_write_review for what THIS surface actually does.
    write_execution: allowWrites ? 'immediate-under-startup-policy' : 'refused-at-startup',
    per_write_review: false,
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

/**
 * Write-class tools advertise THIS surface's policy in their description, so
 * no MCP client can mistake the shared description for a per-write approval
 * flow that does not exist here. Read-tool descriptions stay verbatim.
 */
function writePolicyNote(tool: ToolInfo, allowWrites: boolean): string {
  if (tool.side_effect !== 'write') return '';
  return allowWrites
    ? " Write tool: this endpoint executes writes immediately under the operator's startup authorization (--allow-writes); there is no per-write review at this surface."
    : " Write tool: this endpoint refuses write calls (read-only default; --allow-writes is the operator's startup switch).";
}
