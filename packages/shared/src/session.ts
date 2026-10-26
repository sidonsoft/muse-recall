import { z } from 'zod';
import { MemorySchema, MemoryTypeSchema } from './memory.js';
import { TokenUsageSchema } from './provider.js';
import { RetrievalMetadataSchema, RetrievedMemorySchema } from './retrieval.js';

/**
 * Session, message, and turn contracts.
 *
 * A session is the unit of conversation continuity. Its messages persist; the
 * memories that influenced a turn persist *as evidence* — but their content is
 * not copied, because a provenance record must not become a second copy of
 * knowledge the user may later delete.
 */

export const SESSION_STATUSES = ['active', 'archived'] as const;
export const SessionStatusSchema = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSchema = z.object({
  id: z.uuid(),
  project_id: z.string().min(1).max(128).nullable(),
  title: z.string().max(200).nullable(),
  status: SessionStatusSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  message_count: z.number().int().min(0),
  last_message_at: z.iso.datetime().nullable(),
});
export type Session = z.infer<typeof SessionSchema>;

export const SessionListSchema = z.object({
  items: z.array(SessionSchema),
  total: z.number().int().min(0),
});
export type SessionList = z.infer<typeof SessionListSchema>;

export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export const MessageRoleSchema = z.enum(MESSAGE_ROLES);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

/**
 * `interrupted` means the stream stopped before completion (client disconnect,
 * cancellation, or provider failure mid-stream). Such a message is never
 * presented as a finished answer.
 */
export const MESSAGE_STATUSES = ['complete', 'interrupted', 'failed'] as const;
export const MessageStatusSchema = z.enum(MESSAGE_STATUSES);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

/** Per-section character accounting for one assembled prompt. */
export const ContextReportSchema = z.object({
  prompt_characters: z.number().int().min(0),
  memory_characters: z.number().int().min(0),
  /** Conversation messages included from prior turns (both roles). */
  history_messages: z.number().int().min(0),
  /** Older messages omitted to stay inside the history budget. */
  history_messages_dropped: z.number().int().min(0),
  sections: z.object({
    system: z.number().int().min(0),
    constraints: z.number().int().min(0),
    memories: z.number().int().min(0),
    corrections: z.number().int().min(0),
    history: z.number().int().min(0),
    request: z.number().int().min(0),
  }),
  memory_ids: z.array(z.uuid()),
  /** ~4 chars/token. Always labelled as an estimate where displayed. */
  estimated_tokens: z.number().int().min(0),
  warnings: z.array(z.string()),
});
export type ContextReport = z.infer<typeof ContextReportSchema>;

export const MessageSchema = z.object({
  id: z.uuid(),
  session_id: z.uuid(),
  /** Monotonic within a session; assigned under a write lock. */
  sequence: z.number().int().min(0),
  role: MessageRoleSchema,
  content: z.string(),
  status: MessageStatusSchema,
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  latency_ms: z.number().int().min(0).nullable(),
  context: ContextReportSchema.nullable(),
  created_at: z.iso.datetime(),
});
export type Message = z.infer<typeof MessageSchema>;

export const MemoryTypeNameSchema = MemoryTypeSchema;

/**
 * Persisted retrieval evidence for one turn.
 *
 * `memory_id` deliberately has no foreign key: purging a memory must not erase
 * the record that it influenced an answer. When the memory no longer exists,
 * `memory` is null and `memory_available` is false.
 */
export const TurnMemoryEvidenceSchema = z.object({
  memory_id: z.uuid(),
  score: z.number().min(0).max(1),
  evidence: z.string(),
  memory_type: MemoryTypeNameSchema,
  scope: z.enum(['global', 'project']),
  pinned: z.boolean(),
  truncated: z.boolean(),
  characters: z.number().int().min(0),
  /** Resolved at read time; null when deleted or purged since the turn. */
  memory: MemorySchema.nullable(),
  memory_available: z.boolean(),
});
export type TurnMemoryEvidence = z.infer<typeof TurnMemoryEvidenceSchema>;

export const MessageWithEvidenceSchema = MessageSchema.extend({
  memories: z.array(TurnMemoryEvidenceSchema),
});
export type MessageWithEvidence = z.infer<typeof MessageWithEvidenceSchema>;

export const SessionDetailSchema = SessionSchema.extend({
  messages: z.array(MessageWithEvidenceSchema),
});
export type SessionDetail = z.infer<typeof SessionDetailSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const CreateSessionInputSchema = z.object({
  project_id: z.string().min(1).max(128).nullable().default(null),
  title: z.string().min(1).max(200).optional(),
});
export type CreateSessionInput = z.input<typeof CreateSessionInputSchema>;

export const UpdateSessionInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: SessionStatusSchema.optional(),
});
export type UpdateSessionInput = z.infer<typeof UpdateSessionInputSchema>;

export const SendMessageInputSchema = z.object({
  content: z.string().min(1).max(16_000),
  /** Explicit memory commands are honoured unless this is false. */
  capture_memories: z.boolean().default(true),
});
export type SendMessageInput = z.input<typeof SendMessageInputSchema>;

/** A memory written because the user explicitly asked for it. */
export const CapturedMemorySchema = z.object({
  memory_id: z.uuid(),
  content: z.string(),
  type: MemoryTypeNameSchema,
  reason: z.string(),
  superseded_ids: z.array(z.uuid()),
  created: z.boolean(),
});
export type CapturedMemory = z.infer<typeof CapturedMemorySchema>;

/**
 * A proposed memory that was NOT stored.
 *
 * Candidate extraction only ever proposes. Storage requires a separate,
 * explicit confirmation call, so a model's phrasing can never become a "fact"
 * on its own.
 */
export const MemoryCandidateSchema = z.object({
  content: z.string(),
  type: MemoryTypeNameSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;

export const TurnResultSchema = z.object({
  session_id: z.uuid(),
  user_message: MessageSchema,
  /** Includes retrieval evidence so the interface can explain the turn at once. */
  assistant_message: MessageWithEvidenceSchema,
  retrieval: RetrievalMetadataSchema,
  context: ContextReportSchema,
  usage: TokenUsageSchema,
  captures: z.array(CapturedMemorySchema),
  candidates: z.array(MemoryCandidateSchema),
});
export type TurnResult = z.infer<typeof TurnResultSchema>;

// ---------------------------------------------------------------------------
// Streaming events
// ---------------------------------------------------------------------------

/**
 * SSE event vocabulary. `retrieval` is emitted before the first `delta` so the
 * interface can show *why* before it shows *what*.
 */
export const TurnEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('retrieval'),
    metadata: RetrievalMetadataSchema,
    results: z.array(RetrievedMemorySchema),
  }),
  z.object({ type: z.literal('memory_captured'), captures: z.array(CapturedMemorySchema) }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('usage'), usage: TokenUsageSchema }),
  z.object({ type: z.literal('completed'), turn: TurnResultSchema }),
  z.object({
    type: z.literal('error'),
    code: z.string().min(1),
    message: z.string().min(1),
    /** Present when the failure happened after the turn was identified. */
    session_id: z.uuid().nullable().default(null),
  }),
]);
export type TurnEvent = z.infer<typeof TurnEventSchema>;
