import { SessionStore } from '@mml/agent-core';
import { openDatabase } from '@mml/memory-engine';
import { describe, expect, it } from 'vitest';
import { UiSurfaceStore } from '../../apps/server/src/ui-store.js';

/**
 * The ui_surfaces migration comment promises: "The spec is stored as JSON
 * and re-validated on read, so a corrupted row can never be rendered."
 * parseStoredSurface is a strict Zod .parse and the store calls it on EVERY
 * read — but until now no test ever corrupted a row. A regression that
 * downgrades .parse to .safeParse-with-fallback, or that returns raw
 * spec_json on parse failure, would let malformed UI reach the browser with
 * a fully green suite.
 */

function setup() {
  const opened = openDatabase({ path: ':memory:' });
  const sessions = new SessionStore(opened.db);
  const surfaces = new UiSurfaceStore(opened.db);
  const session = sessions.createSession({ project_id: null, title: 'spec-integrity' });
  const record = surfaces.create({
    sessionId: session.id,
    messageId: null,
    spec: { version: 1, title: 'Panel', blocks: [{ kind: 'text', text: 'hello' }] },
  });
  return { opened, sessions, surfaces, record };
}

describe('ui_surfaces re-validation on read (corrupted row never renders)', () => {
  it('a happy path round-trips the spec through the schema', () => {
    const { opened, surfaces, record } = setup();
    try {
      const back = surfaces.get(record.id);
      expect(back?.spec.blocks[0]).toEqual({ kind: 'text', text: 'hello' });
    } finally {
      opened.close();
    }
  });

  it('malformed JSON in spec_json THROWS on read instead of rendering', () => {
    const { opened, surfaces, record } = setup();
    try {
      opened.db
        .prepare('UPDATE ui_surfaces SET spec_json = ? WHERE id = ?')
        .run('{"version": 1, "title": "ZOMBIE_SPEC_SENTINEL", "blocks": [', record.id);
      expect(() => surfaces.get(record.id)).toThrow();
      expect(() => surfaces.listBySession(record.session_id ?? '')).toThrow();
    } finally {
      opened.close();
    }
  });

  it('schema-valid JSON but schema-INVALID spec also throws (version 2, zero blocks)', () => {
    const { opened, surfaces, record } = setup();
    try {
      opened.db
        .prepare('UPDATE ui_surfaces SET spec_json = ? WHERE id = ?')
        .run('{"version": 2, "title": "ZOMBIE_SPEC_SENTINEL", "blocks": []}', record.id);
      // version !== 1 and blocks.min(1) are both violations; neither may pass.
      const thrown = (() => {
        try {
          surfaces.get(record.id);
          return null;
        } catch {
          return true;
        }
      })();
      expect(thrown).toBe(true);
      expect(() => surfaces.get(record.id)).toThrow();
    } finally {
      opened.close();
    }
  });
});
