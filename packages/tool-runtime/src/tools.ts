import { randomUUID } from 'node:crypto';
import {
  MemoryGraphEdgeSchema,
  MemoryGraphEventSchema,
  MemoryGraphNodeSchema,
  MemoryTypeSchema,
} from '@mml/shared';
import { z } from 'zod';
import { ToolRegistry } from './registry.js';
import type { ToolContext } from './types.js';
import { defineTool } from './types.js';

/**
 * The initial tool set.
 *
 * Every tool is project-scoped by construction: the project id comes from the
 * session context, never from model arguments. There is no shell, filesystem,
 * or network tool in this phase.
 */

const MemoryGraphInput = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});
const MemoryGraphOutput = z.object({
  nodes: z.array(MemoryGraphNodeSchema),
  edges: z.array(MemoryGraphEdgeSchema),
  events: z.array(MemoryGraphEventSchema),
  truncated: z.boolean(),
  observed_at: z.string(),
});

const MemorySearchInput = z.object({
  query: z.string().min(2).max(300),
  limit: z.number().int().min(1).max(8).default(5),
});
const MemorySearchOutput = z.object({
  query: z.string(),
  selected_count: z.number().int().min(0),
  memories: z.array(
    z.object({
      id: z.uuid(),
      type: MemoryTypeSchema,
      content: z.string(),
      score: z.number(),
      evidence: z.string(),
    }),
  ),
});

const MemoryCreateInput = z.object({
  content: z.string().min(3).max(1_000),
  type: MemoryTypeSchema.default('contextual_fact'),
  confidence: z.number().min(0).max(1).default(0.9),
});
const MemoryCreateOutput = z.object({
  memory_id: z.uuid(),
  content: z.string(),
  created: z.boolean(),
});

const ProjectGetInput = z.object({});
const ProjectGetOutput = z.object({
  project: z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      created_at: z.string(),
      updated_at: z.string(),
    })
    .nullable(),
  tasks: z.object({ todo: z.number(), in_progress: z.number(), done: z.number() }),
  memory_count: z.number(),
});

const ProjectUpdateInput = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1_000).optional(),
});
const ProjectUpdateOutput = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  updated_at: z.string(),
});

const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;
const TaskStatusSchema = z.enum(TASK_STATUSES);

const TaskCreateInput = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(1_000).optional(),
  status: TaskStatusSchema.default('todo'),
});
const TaskOutput = z.object({
  id: z.uuid(),
  project_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: TaskStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

const TaskListInput = z.object({
  status: TaskStatusSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
const TaskListOutput = z.object({
  tasks: z.array(TaskOutput),
  total: z.number(),
});

function requireProject(context: ToolContext): string {
  if (!context.projectId) {
    throw new Error('This tool requires a project-scoped conversation.');
  }
  return context.projectId;
}

function ensureProjectRow(context: ToolContext, projectId: string): void {
  const now = context.now().toISOString();
  context.db
    .prepare(
      `INSERT INTO projects (id, name, description, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?) ON CONFLICT(id) DO NOTHING`,
    )
    .run(projectId, projectId, now, now);
}

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(
    defineTool({
      id: 'memory.search',
      description:
        'Search the project memories for facts relevant to a query. Returns ranked memories with evidence.',
      sideEffect: 'read',
      requiresConfirmation: false,
      input: MemorySearchInput,
      output: MemorySearchOutput,
      execute: (input, context) => {
        const result = context.memory.retrieve(
          {
            project_id: context.projectId,
            query: input.query,
            budget: { max_memories: input.limit },
          },
          { now: context.now() },
        );
        return {
          query: input.query,
          selected_count: result.results.length,
          memories: result.results.map((entry) => ({
            id: entry.memory.id,
            type: entry.memory.type,
            content: entry.injected_content,
            score: entry.score,
            evidence: entry.evidence,
          })),
        };
      },
    }),
  );

  registry.register(
    defineTool({
      id: 'memory.graph',
      description:
        'Read the relationship graph and timeline of memories: supersession edges ' +
        '(which claim replaced which, and when) plus recent created/corrected events. ' +
        'Read-only; deleted memories never appear.',
      sideEffect: 'read',
      requiresConfirmation: false,
      input: MemoryGraphInput,
      output: MemoryGraphOutput,
      execute: (input, context) =>
        context.memory.graph({
          ...(context.projectId ? { projectId: context.projectId } : {}),
          ...(input.limit ? { limit: input.limit } : {}),
        }),
    }),
  );

  registry.register(
    defineTool({
      id: 'memory.create',
      description:
        'Store a fact in project memory. Requires user approval; duplicates are deduplicated.',
      sideEffect: 'write',
      requiresConfirmation: true,
      input: MemoryCreateInput,
      output: MemoryCreateOutput,
      execute: (input, context) => {
        const result = context.memory.create({
          type: input.type,
          scope: context.projectId ? 'project' : 'global',
          project_id: context.projectId,
          content: input.content,
          source: { session_id: context.sessionId, reference: 'tool:memory.create' },
          confidence: input.confidence,
          validation_status: 'verified',
          tags: [],
          expires_at: null,
        });
        return {
          memory_id: result.memory.id,
          content: result.memory.content,
          created: result.created,
        };
      },
    }),
  );

  registry.register(
    defineTool({
      id: 'project.get',
      description: 'Read the current project metadata, task counts, and memory count.',
      sideEffect: 'read',
      requiresConfirmation: false,
      input: ProjectGetInput,
      output: ProjectGetOutput,
      execute: (_input, context) => {
        const projectId = requireProject(context);
        const row = context.db
          .prepare(
            'SELECT id, name, description, created_at, updated_at FROM projects WHERE id = ?',
          )
          .get(projectId) as unknown as
          | {
              id: string;
              name: string;
              description: string | null;
              created_at: string;
              updated_at: string;
            }
          | undefined;

        const counts = { todo: 0, in_progress: 0, done: 0 };
        for (const rowCount of context.db
          .prepare(
            'SELECT status, COUNT(*) AS count FROM project_tasks WHERE project_id = ? GROUP BY status',
          )
          .all(projectId) as unknown as { status: string; count: number }[]) {
          if (rowCount.status === 'todo') counts.todo = rowCount.count;
          if (rowCount.status === 'in_progress') counts.in_progress = rowCount.count;
          if (rowCount.status === 'done') counts.done = rowCount.count;
        }

        return {
          project: row ?? null,
          tasks: counts,
          memory_count: context.memory.list({ project_id: projectId, status: ['active'] }).total,
        };
      },
    }),
  );

  registry.register(
    defineTool({
      id: 'project.update',
      description:
        'Update the project name or description. Requires user approval. At least one field is required.',
      sideEffect: 'write',
      requiresConfirmation: true,
      input: ProjectUpdateInput,
      output: ProjectUpdateOutput,
      execute: (input, context) => {
        const projectId = requireProject(context);
        if (input.name === undefined && input.description === undefined) {
          throw new Error('Provide a name or description to update.');
        }
        ensureProjectRow(context, projectId);
        const now = context.now().toISOString();
        const current = context.db
          .prepare('SELECT name, description FROM projects WHERE id = ?')
          .get(projectId) as unknown as { name: string; description: string | null };

        context.db
          .prepare('UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?')
          .run(
            input.name ?? current.name,
            input.description === undefined ? current.description : input.description,
            now,
            projectId,
          );

        const updated = context.db
          .prepare('SELECT id, name, description, updated_at FROM projects WHERE id = ?')
          .get(projectId) as unknown as {
          id: string;
          name: string;
          description: string | null;
          updated_at: string;
        };
        return updated;
      },
    }),
  );

  registry.register(
    defineTool({
      id: 'task.create',
      description:
        'Create a task in the current project. Requires user approval; use one call per task.',
      sideEffect: 'write',
      requiresConfirmation: true,
      input: TaskCreateInput,
      output: TaskOutput,
      execute: (input, context) => {
        const projectId = requireProject(context);
        ensureProjectRow(context, projectId);
        const id = randomUUID();
        const now = context.now().toISOString();
        context.db
          .prepare(
            `INSERT INTO project_tasks (id, project_id, title, description, status, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'agent', ?, ?)`,
          )
          .run(id, projectId, input.title, input.description ?? null, input.status, now, now);

        return {
          id,
          project_id: projectId,
          title: input.title,
          description: input.description ?? null,
          status: input.status,
          created_at: now,
          updated_at: now,
        };
      },
    }),
  );

  registry.register(
    defineTool({
      id: 'task.list',
      description:
        'List tasks in the current project, newest first, optionally filtered by status.',
      sideEffect: 'read',
      requiresConfirmation: false,
      input: TaskListInput,
      output: TaskListOutput,
      execute: (input, context) => {
        const projectId = requireProject(context);
        const conditions = ['project_id = ?'];
        const params: (string | number)[] = [projectId];
        if (input.status) {
          conditions.push('status = ?');
          params.push(input.status);
        }

        const rows = context.db
          .prepare(
            `SELECT id, project_id, title, description, status, created_at, updated_at
             FROM project_tasks WHERE ${conditions.join(' AND ')}
             ORDER BY created_at DESC, id ASC LIMIT ?`,
          )
          .all(...params, input.limit) as unknown as {
          id: string;
          project_id: string;
          title: string;
          description: string | null;
          status: 'todo' | 'in_progress' | 'done';
          created_at: string;
          updated_at: string;
        }[];

        const totalRow = context.db
          .prepare(`SELECT COUNT(*) AS count FROM project_tasks WHERE ${conditions.join(' AND ')}`)
          .get(...params) as unknown as { count: number } | undefined;

        return { tasks: rows, total: totalRow?.count ?? rows.length };
      },
    }),
  );

  return registry;
}
