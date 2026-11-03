/**
 * Load retained vision evidence for a resumed Batch C acceptance run.
 *
 * A resumed run must not spend another vision call: it reuses the drafts
 * recorded by a prior vision-only run's evidence report. This loader is the
 * only trust boundary for that reuse — it fails closed on a missing
 * directory, an unreadable report, or drafts that do not satisfy the media
 * suggestion contract, so a resumed run can never silently proceed with
 * absent or malformed vision output. No provider or browser is involved.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RetainedSuggestion {
  type: 'preference' | 'constraint' | 'technical_decision';
  content: string;
  confidence: number;
}

export interface RetainedVisionEvidence {
  suggestions: RetainedSuggestion[];
  referenceSha256: string | null;
  generatedAt: string | null;
}

const SUGGESTION_TYPES = ['preference', 'constraint', 'technical_decision'] as const;

/** Read and validate the vision output retained by a previous smoke run. */
export function loadRetainedVisionEvidence(evidenceDir: string): RetainedVisionEvidence {
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(join(evidenceDir, 'report.json'), 'utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `cannot read retained vision evidence at ${evidenceDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error(`retained evidence at ${evidenceDir} is not a report object`);
  }
  const observations = (report as Record<string, unknown>).observations;
  if (observations === null || typeof observations !== 'object' || Array.isArray(observations)) {
    throw new Error(`retained evidence at ${evidenceDir} has no observations block`);
  }
  const response = (observations as Record<string, unknown>).visionResponse;
  if (response === null || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error(
      `retained evidence at ${evidenceDir} has no vision response (vision never succeeded there)`,
    );
  }
  const raw = (response as Record<string, unknown>).suggestions;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`retained evidence at ${evidenceDir} has no suggestions to resume from`);
  }
  const suggestions: RetainedSuggestion[] = raw.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`retained suggestion ${index} is not an object`);
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.type !== 'string' ||
      !(SUGGESTION_TYPES as readonly string[]).includes(record.type)
    ) {
      throw new Error(`retained suggestion ${index} has an unknown type`);
    }
    if (
      typeof record.content !== 'string' ||
      record.content.trim().length === 0 ||
      record.content.length > 1_000
    ) {
      throw new Error(`retained suggestion ${index} has unusable content`);
    }
    const confidence = typeof record.confidence === 'number' ? record.confidence : NaN;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error(`retained suggestion ${index} has an out-of-range confidence`);
    }
    return {
      type: record.type as RetainedSuggestion['type'],
      content: record.content,
      confidence,
    };
  });
  const reference = (observations as Record<string, unknown>).referenceAsset;
  const referenceSha256 =
    reference !== null &&
    typeof reference === 'object' &&
    !Array.isArray(reference) &&
    typeof (reference as Record<string, unknown>).sha256 === 'string'
      ? ((reference as Record<string, unknown>).sha256 as string)
      : null;
  const generatedAt =
    typeof (report as Record<string, unknown>).generated_at === 'string'
      ? ((report as Record<string, unknown>).generated_at as string)
      : null;
  return { suggestions, referenceSha256, generatedAt };
}
