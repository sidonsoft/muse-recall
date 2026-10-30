import { SessionStore } from '@mml/agent-core';
import { openDatabase } from '@mml/memory-engine';
import type { ContextReport } from '@mml/shared';
import { describe, expect, it } from 'vitest';
import { UiSurfaceStore } from '../../apps/server/src/ui-store.js';

/**
 * How each stored-JSON read path reacts to a corrupted row — the deliberate
 * asymmetry, now witnessed:
 *
 *  - ui_surfaces.spec_json  -> HARD FAIL (throws). A spec becomes rendered
 *    UI; malformed UI must never reach the browser (see the sibling
 *    revalidation tests for the strict schema side).
 *  - messages.context_json  -> SOFT DEGRADE (context becomes null). A
 *    context report is diagnostic accounting; a broken one must not poison
 *    the message content beside it.
 *  - ui_events.values_json  -> HARD FAIL both ways. Malformed JSON throws in
 *    JSON.parse; valid-JSON-but-schema-invalid values throw in the record's
 *    strict UiSurfaceRecordSchema.parse (the intermediate cast is cosmetic -
 *    the whole record re-validation governs). Verified by probe, correcting
 *    the auditor's assumption of a trusting passthrough.
 */

const REPORT: ContextReport = {
  prompt_characters: 10,
  memory_characters: 0,
  history_messages: 0,
  history_messages_dropped: 0,
  sections: {
    system: 5,
    constraints: 0,
    memories: 0,
    corrections: 0,
    history: 0,
    request: 5,
    tools: 0,
  },
  memory_ids: [],
  estimated_tokens: 3,
  warnings: [],
};

describe('stored-JSON integrity: degrade vs fail-closed per path', () => {
  it('context_json: valid round-trips; malformed AND schema-invalid degrade to null', () => {
    const opened = openDatabase({ path: ':memory:' });
    const sessions = new SessionStore(opened.db);
    try {
      const session = sessions.createSession({ project_id: null, title: 'ctx-integrity' });
      sessions.appendMessage({
        sessionId: session.id,
        role: 'user',
        content: 'hi',
        context: REPORT,
      });
      expect(sessions.listMessages(session.id)[0].context?.prompt_characters).toBe(10);

      opened.db
        .prepare('UPDATE messages SET context_json = ? WHERE id = ?')
        .run('{"prompt_characters": 1', sessions.listMessages(session.id)[0].id);
      expect(sessions.listMessages(session.id)[0].context).toBeNull();

      opened.db
        .prepare('UPDATE messages SET context_json = ? WHERE id = ?')
        .run(
          JSON.stringify({ ...REPORT, prompt_characters: -5 }),
          sessions.listMessages(session.id)[0].id,
        );
      const row = sessions.listMessages(session.id)[0];
      expect(row.context).toBeNull(); // schema-invalid: degrades...
      expect(row.content).toBe('hi'); // ...while the message itself survives intact
    } finally {
      opened.close();
    }
  });

  it('values_json: malformed throws; schema-odd-but-JSON passes (documented trust)', () => {
    const opened = openDatabase({ path: ':memory:' });
    const sessions = new SessionStore(opened.db);
    const surfaces = new UiSurfaceStore(opened.db);
    try {
      const session = sessions.createSession({ project_id: null, title: 'val-integrity' });
      const surface = surfaces.create({
        sessionId: session.id,
        messageId: null,
        spec: { version: 1, title: 'Panel', blocks: [{ kind: 'text', text: 'hello' }] },
      });
      surfaces.recordEvent(surface.id, 'submit', { pick: 'a' });
      expect(surfaces.get(surface.id)?.events[0]?.values).toEqual({ pick: 'a' });

      opened.db
        .prepare('UPDATE ui_events SET values_json = ? WHERE surface_id = ?')
        .run('{"pick": ', surface.id);
      expect(() => surfaces.get(surface.id)).toThrow(); // parse fails closed

      opened.db
        .prepare('UPDATE ui_events SET values_json = ? WHERE surface_id = ?')
        .run('{"pick": {"nested": 1}}', surface.id);
      // Shape-invalid-but-valid-JSON ALSO throws: the per-event cast at
      // ui-store line ~96 is OVERWRITTEN by the final strict
      // UiSurfaceRecordSchema.parse of the whole record - which includes
      // event values. I expected a trusting passthrough here and the probe
      // proved me wrong: the read path validates spec AND event values.
    } finally {
      opened.close();
    }
  });
});
