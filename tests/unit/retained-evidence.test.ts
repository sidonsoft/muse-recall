import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRetainedVisionEvidence } from '../../scripts/lib/retained-evidence.js';

function writeReport(dir: string, report: unknown): string {
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  return dir;
}

function visionReport(
  suggestions: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    generated_at: '2026-11-01T01:06:00.000Z',
    observations: {
      visionResponse: { suggestions, asset_id: 'a', version: 1 },
      referenceAsset: { asset_id: 'a', version: 1, sha256: 'abc123' },
      ...extra,
    },
  };
}

describe('retained vision evidence loader', () => {
  it('loads valid retained drafts with provenance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retained-'));
    try {
      writeReport(
        dir,
        visionReport([
          { type: 'preference', content: 'Rounded cards.', confidence: 0.8 },
          { type: 'constraint', content: 'Six colors max.', confidence: 0.6 },
        ]),
      );
      const loaded = loadRetainedVisionEvidence(dir);
      expect(loaded.suggestions).toHaveLength(2);
      expect(loaded.suggestions[0]).toEqual({
        type: 'preference',
        content: 'Rounded cards.',
        confidence: 0.8,
      });
      expect(loaded.referenceSha256).toBe('abc123');
      expect(loaded.generatedAt).toBe('2026-11-01T01:06:00.000Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed on a missing directory or report', () => {
    expect(() => loadRetainedVisionEvidence(join(tmpdir(), 'retained-missing-xyz'))).toThrow(
      /cannot read retained vision evidence/,
    );
    const dir = mkdtempSync(join(tmpdir(), 'retained-'));
    try {
      writeFileSync(join(dir, 'report.json'), 'not json{{{');
      expect(() => loadRetainedVisionEvidence(dir)).toThrow(/cannot read retained/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed on absent vision output or empty drafts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retained-'));
    try {
      writeReport(dir, { observations: {} });
      expect(() => loadRetainedVisionEvidence(dir)).toThrow(/no vision response/);
      writeReport(dir, visionReport([]));
      expect(() => loadRetainedVisionEvidence(dir)).toThrow(/no suggestions/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed on malformed drafts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retained-'));
    try {
      writeReport(dir, visionReport([{ type: 'vibe', content: 'x', confidence: 0.5 }]));
      expect(() => loadRetainedVisionEvidence(dir)).toThrow(/unknown type/);
      writeReport(dir, visionReport([{ type: 'preference', content: '  ', confidence: 0.5 }]));
      expect(() => loadRetainedVisionEvidence(dir)).toThrow(/unusable content/);
      writeReport(dir, visionReport([{ type: 'preference', content: 'x', confidence: 2 }]));
      expect(() => loadRetainedVisionEvidence(dir)).toThrow(/out-of-range confidence/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tolerates a missing reference sha (linkage is checked at resume time)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retained-'));
    try {
      writeReport(dir, {
        generated_at: null,
        observations: {
          visionResponse: {
            suggestions: [{ type: 'preference', content: 'Rounded cards.', confidence: 0.8 }],
          },
        },
      });
      const loaded = loadRetainedVisionEvidence(dir);
      expect(loaded.suggestions).toHaveLength(1);
      expect(loaded.referenceSha256).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
