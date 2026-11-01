/**
 * Offline retained-cutout loader tests: fixtures only, no provider,
 * browser, or server. Every failure mode must throw before any dispatch
 * surface is reachable.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRetainedCutout } from '../../scripts/lib/retained-cutout.js';

/** 1x1 transparent PNG bytes (no decoder dependency). */
function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
}

describe('loadRetainedCutout', () => {
  it('throws for a missing directory', () => {
    expect(() => loadRetainedCutout(join(tmpdir(), 'no-such-cutout-dir'))).toThrow(/cutout\.png/);
  });

  it('throws when cutout.png is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retained-cutout-'));
    try {
      writeFileSync(join(dir, 'report.json'), '{}');
      expect(() => loadRetainedCutout(dir)).toThrow(/cutout\.png/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when report.json is missing or unparsable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retained-cutout-'));
    try {
      writeFileSync(join(dir, 'cutout.png'), tinyPng());
      expect(() => loadRetainedCutout(dir)).toThrow(/report\.json is missing/);
      writeFileSync(join(dir, 'report.json'), 'not json');
      expect(() => loadRetainedCutout(dir)).toThrow(/not valid JSON/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a sha mismatch between bytes and report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retained-cutout-'));
    try {
      writeFileSync(join(dir, 'cutout.png'), tinyPng());
      writeFileSync(
        join(dir, 'report.json'),
        JSON.stringify({ observations: { cutoutPng: { sha256: '0'.repeat(64) } } }),
      );
      expect(() => loadRetainedCutout(dir)).toThrow(/does not match retained/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads a well-formed retained cutout with provenance', async () => {
    const { createHash } = await import('node:crypto');
    const dir = mkdtempSync(join(tmpdir(), 'retained-cutout-'));
    try {
      const bytes = tinyPng();
      const sha = createHash('sha256').update(bytes).digest('hex');
      writeFileSync(join(dir, 'cutout.png'), bytes);
      writeFileSync(
        join(dir, 'report.json'),
        JSON.stringify({
          reference_image: { path: '/ref.png', sha256: 'a'.repeat(64) },
          observations: {
            cutoutPng: { sha256: sha },
            segment: { segment_id: 'seg-1' },
            cutout: {
              source: {
                kind: 'segment',
                text: 'orange restart button',
                segment: {
                  concept: 'orange restart button',
                  box: { x1: 1, y1: 2, x2: 10, y2: 12 },
                  mask_width: 9,
                  mask_height: 10,
                },
              },
            },
          },
        }),
      );
      const retained = loadRetainedCutout(dir);
      expect(retained.sha256).toBe(sha);
      expect(retained.bytes.equals(bytes)).toBe(true);
      expect(retained).toMatchObject({
        segmentId: 'seg-1',
        concept: 'orange restart button',
        box: { x1: 1, y1: 2, x2: 10, y2: 12 },
        maskWidth: 9,
        maskHeight: 10,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates the real 0755 retained cutout end to end', async () => {
    const { existsSync } = await import('node:fs');
    if (!existsSync('test-results/batchc-live/2026-11-01-0755/cutout.png')) {
      console.log('skip: retained 0755 evidence not present in this checkout');
      return;
    }
    const retained = loadRetainedCutout('test-results/batchc-live/2026-11-01-0755');
    expect(retained.sha256).toBe(
      '52d90d986e623a035abdad1e28df05f232efb964c56c579f0827c1fed00cc5f8',
    );
    expect(retained.bytes.length).toBe(6374);
    expect(retained.concept).toBe('orange restart button');
  });
});
