import { createHash } from 'node:crypto';

/**
 * Content normalisation and fingerprinting for deduplication.
 *
 * Two memories are "the same" when they make the same claim, in the same
 * scope, with the same type. Whitespace and casing are presentation, not
 * meaning, so they are normalised away before hashing.
 */

export function normaliseContent(content: string): string {
  return content.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface HashableMemory {
  type: string;
  scope: string;
  project_id: string | null;
  content: string;
}

/**
 * SHA-256 over `type | scope | project | normalised content`.
 *
 * The separator is a NUL byte so field boundaries cannot be forged by content
 * that happens to contain the separator characters.
 */
export function memoryContentHash(memory: HashableMemory): string {
  const material = [
    memory.type,
    memory.scope,
    memory.project_id ?? '',
    normaliseContent(memory.content),
  ].join('\u0000');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}
