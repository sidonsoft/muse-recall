import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evidenceStamp, uniqueEvidenceDir } from '../../scripts/lib/evidence-dir.js';

describe('evidence directories cannot collide', () => {
  it('takes the natural name when nothing is there', () => {
    const parent = mkdtempSync(join(tmpdir(), 'evidence-'));
    const chosen = uniqueEvidenceDir(parent, 'palette-bench-2026-11-03-081740');
    expect(chosen.path).toBe(join(parent, 'palette-bench-2026-11-03-081740'));
    expect(chosen.suffix).toBe('');
    expect(chosen.taken).toEqual([]);
  });

  it('moves aside instead of writing over a packet that already exists', () => {
    const parent = mkdtempSync(join(tmpdir(), 'evidence-'));
    const first = join(parent, 'palette-bench-2026-11-03-081740');
    mkdirSync(first);
    writeFileSync(join(first, 'review-packet.md'), 'the packet that must survive');
    const second = uniqueEvidenceDir(parent, 'palette-bench-2026-11-03-081740');
    expect(second.path).toBe(join(parent, 'palette-bench-2026-11-03-081740-2'));
    expect(second.suffix).toBe('-2');
    expect(second.taken).toEqual(['palette-bench-2026-11-03-081740']);
    // The retained packet is untouched, which is the whole point of the helper.
    expect(readFileSync(join(first, 'review-packet.md'), 'utf8')).toBe(
      'the packet that must survive',
    );
  });

  it('keeps moving aside for a third and fourth run in the same stamp', () => {
    const parent = mkdtempSync(join(tmpdir(), 'evidence-'));
    const base = 'app-2026-11-03-090000';
    mkdirSync(join(parent, base));
    mkdirSync(join(parent, `${base}-2`));
    const third = uniqueEvidenceDir(parent, base);
    expect(third.path).toBe(join(parent, `${base}-3`));
    expect(third.taken).toEqual([base, `${base}-2`]);
  });

  it('stamps to the second, so back-to-back runs rarely even reach the collision path', () => {
    const stamp = evidenceStamp(new Date('2026-11-03T08:17:40.123Z'));
    expect(stamp).toBe('2026-11-03-081740');
    // The old minute stamp is exactly what collided; pinning the length keeps a future edit from
    // trimming the seconds off again.
    expect(stamp).toHaveLength(17);
  });
});
