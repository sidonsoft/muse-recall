import { z } from 'zod';
import { MemoryHistoryEntrySchema, MemorySchema, ProjectSchema } from './memory.js';

/**
 * Portable memory export (roadmap §6 "Make changes safe": export/import with
 * schema versions and round-trip checks, including provenance and
 * relationships).
 *
 * The envelope is a faithful database snapshot, not the API shape: tombstones
 * (`deleted` rows) and audit history are included because an import that
 * silently dropped them would erase the guarantees the audit trail exists to
 * provide. `content_hash` is carried per record because dedupe and replay
 * detection are defined over the normalized fingerprint, not prose.
 */
export const MEMORY_EXPORT_FORMAT = 'muse-recall-memory-export';
/** Bump when the envelope shape changes; importers refuse newer versions. */
export const MEMORY_EXPORT_FORMAT_VERSION = 1;

export const MemoryExportRecordSchema = MemorySchema.extend({
  /** The normalized fingerprint the engine deduplicates on. */
  content_hash: z.string().min(1),
});
export type MemoryExportRecord = z.infer<typeof MemoryExportRecordSchema>;

export const MemorySupersessionEdgeSchema = z.object({
  new_id: z.uuid(),
  old_id: z.uuid(),
  created_at: z.iso.datetime(),
});
export type MemorySupersessionEdge = z.infer<typeof MemorySupersessionEdgeSchema>;

/**
 * Referential integrity is part of the format: an envelope whose history,
 * edges, or scopes point at records it does not carry is rejected before any
 * import write happens. Exporters get the same check for free — a snapshot
 * that fails it is an exporter bug caught at the source.
 */
function checkReferentialIntegrity(
  envelope: Pick<MemoryEnvelopeShape, 'projects' | 'records' | 'history' | 'supersessions'>,
  addIssue: (issue: { path: PropertyKey[]; message: string }) => void,
): void {
  const projectIds = new Set(envelope.projects.map((project) => project.id));
  const recordIds = new Set(envelope.records.map((record) => record.id));
  if (recordIds.size !== envelope.records.length) {
    addIssue({ path: ['records'], message: 'duplicate record id in export envelope' });
  }

  for (const [index, record] of envelope.records.entries()) {
    if (record.scope === 'project' && (!record.project_id || !projectIds.has(record.project_id))) {
      addIssue({
        path: ['records', String(index), 'project_id'],
        message: `record ${record.id} scopes to unknown project ${record.project_id ?? 'null'}`,
      });
    }
    for (const oldId of record.supersedes) {
      if (!recordIds.has(oldId)) {
        addIssue({
          path: ['records', String(index), 'supersedes'],
          message: `record ${record.id} supersedes unknown record ${oldId}`,
        });
      }
    }
    if (record.superseded_by && !recordIds.has(record.superseded_by)) {
      addIssue({
        path: ['records', String(index), 'superseded_by'],
        message: `record ${record.id} is superseded by unknown record ${record.superseded_by}`,
      });
    }
  }

  for (const [index, entry] of envelope.history.entries()) {
    if (!recordIds.has(entry.memory_id)) {
      addIssue({
        path: ['history', String(index), 'memory_id'],
        message: `history entry ${entry.id} audits unknown record ${entry.memory_id}`,
      });
    }
  }

  for (const [index, edge] of envelope.supersessions.entries()) {
    if (!recordIds.has(edge.new_id) || !recordIds.has(edge.old_id)) {
      addIssue({
        path: ['supersessions', String(index)],
        message: `supersession edge ${edge.new_id}->${edge.old_id} references unknown record`,
      });
    }
  }
}

interface MemoryEnvelopeShape {
  projects: Array<{ id: string }>;
  records: Array<{
    id: string;
    scope: string;
    project_id: string | null;
    supersedes: string[];
    superseded_by: string | null;
  }>;
  history: Array<{ id: string; memory_id: string }>;
  supersessions: Array<{ new_id: string; old_id: string }>;
}

export const MemoryExportEnvelopeSchema = z
  .object({
    format: z.string().min(1),
    /** Format of the envelope itself, independent of the storage schema. */
    format_version: z.number().int().min(1),
    /** Storage schema version the snapshot was taken at (audit metadata). */
    schema_version: z.number().int().min(0),
    exported_at: z.iso.datetime(),
    projects: z.array(ProjectSchema),
    records: z.array(MemoryExportRecordSchema),
    history: z.array(MemoryHistoryEntrySchema),
    supersessions: z.array(MemorySupersessionEdgeSchema),
  })
  .superRefine((envelope, context) => {
    checkReferentialIntegrity(envelope, (issue) => context.addIssue({ code: 'custom', ...issue }));
  });
export type MemoryExportEnvelope = z.infer<typeof MemoryExportEnvelopeSchema>;

/** Result summary returned by an import. */
export const MemoryImportResultSchema = z.object({
  format_version: z.number().int().min(1),
  schema_version: z.number().int().min(0),
  records_imported: z.number().int().min(0),
  records_replayed: z.number().int().min(0),
  history_imported: z.number().int().min(0),
  edges_imported: z.number().int().min(0),
  projects_ensured: z.number().int().min(0),
  dry_run: z.boolean(),
});
export type MemoryImportResult = z.infer<typeof MemoryImportResultSchema>;
