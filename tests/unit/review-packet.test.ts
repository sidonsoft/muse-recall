import { describe, expect, it } from 'vitest';
import {
  carryCost,
  costChain,
  costRecordIsSilent,
  decisionChecklist,
  describeCost,
  type PacketFacts,
  packetIssues,
  REVIEW_DIMENSIONS,
  renderReviewPacket,
} from '../../scripts/lib/review-packet.js';

const BASE: PacketFacts = {
  project: 'palette-bench',
  app_name: 'Palette Bench',
  brief_path: 'docs/review-apps/palette-bench-brief.md',
  created_at: '2026-11-03T09:00:00.000Z',
  commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  bundle_identity: {
    server_build_hash: '59deb4ab3232c93c5e1db45c8b2121551a669ef503a9fc1ce147972ab05b1989',
    web_build_hash: '065ee809a76613c6e38642e304c94b344526d2847df796818fe85405029bc705',
    supports_commit_identity: true,
    note: 'both bundles were built at a1b2c3d; the build ran over a clean tree',
  },
  decisions: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      revision: 1,
      type: 'preference',
      content: 'Never use modal dialogs for feedback; report results in inline status text.',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      revision: 3,
      type: 'constraint',
      content: 'Body text keeps a contrast ratio of at least 4.5:1 against its own background.',
    },
  ],
  job: {
    id: '33333333-3333-4333-8333-333333333333',
    kind: 'generate',
    status: 'succeeded',
    usage_calls: 7,
    model_observed: 'muse-wonder-1.0',
  },
  artifact: {
    version: 1,
    sha256: 'e17df26f578d99f1ca6a5ffcefea26384422490e59d95a64b8662b93cf3f1007',
    bytes: 18_244,
    saved_to: 'artifact.html',
  },
  media_dispatches: 0,
  screenshots: [{ name: 'app-1280.png', label: 'desktop 1280×800', bytes: 61_002 }],
  page: {
    title: 'Palette Bench',
    interactive_controls: 11,
    distinct_colors: 412,
    console_errors: 0,
    http_failures: 0,
    non_local_requests: [],
  },
};

function withFacts(base: PacketFacts, app: Record<string, unknown>): PacketFacts {
  return {
    ...base,
    page: { ...base.page, app_facts: app as PacketFacts['page']['app_facts'] },
  };
}

describe('human review packet', () => {
  it('gives a clean capture no issues, so the packet does not cry wolf', () => {
    expect(packetIssues(BASE)).toEqual([]);
  });

  it('says so when the capture cannot support a visual judgement', () => {
    const issues = packetIssues({
      ...BASE,
      page: { ...BASE.page, distinct_colors: 1, console_errors: 3, http_failures: 2 },
    });
    expect(issues.join(' ')).toContain('effectively blank');
    expect(issues.join(' ')).toContain('3 console error(s)');
    expect(issues.join(' ')).toContain('2 request(s) returned HTTP >= 400');
  });

  it('refuses to call an empty ledger a zero-media run', () => {
    const issues = packetIssues({ ...BASE, media_dispatches: 3 });
    expect(issues.join(' ')).toContain('promises zero provider media calls');
  });

  it('treats an unknown call count as unknown, never as free', () => {
    const issues = packetIssues({ ...BASE, job: { ...BASE.job, usage_calls: null } });
    expect(issues.join(' ')).toContain('what this run spent is unknown');
  });

  it('names an app that reached for the network when the brief forbade it', () => {
    const issues = packetIssues({
      ...BASE,
      page: { ...BASE.page, non_local_requests: ['cdn.jsdelivr.net'] },
    });
    expect(issues.join(' ')).toContain('the brief forbade network use');
    expect(issues.join(' ')).toContain('cdn.jsdelivr.net');
  });

  it('says when a contrast measurement was impossible instead of letting zero read as a pass', () => {
    const facts = withFacts(BASE, {
      named_controls: ['Generate', 'Export'],
      controls_without_visible_label: 0,
      status_texts: [],
      contrast: { checked: 0, below_4_5: 0, worst: [], skipped: 61 },
      contrast_note: 'nothing was measurable',
    });
    const nothing = packetIssues(facts);
    const rendered = renderReviewPacket(facts, nothing);
    expect(rendered).toContain('nothing was measurable');
    expect(rendered).not.toContain('no measured element fell below 4.5:1');
  });

  it('reports what the app named and how it reported results, without grading either', () => {
    const facts = withFacts(BASE, {
      named_controls: ['Generate', 'Export', 'Clear'],
      controls_without_visible_label: 5,
      fields_without_visible_label: 2,
      status_texts: ['Generated five colours from seed 42.'],
      contrast: {
        checked: 64,
        below_4_5: 0,
        worst: [{ ratio: 6.7, text: 'Generate' }],
        skipped: 0,
      },
    });
    const rendered = renderReviewPacket(facts, packetIssues(facts));
    expect(rendered).toContain('Generated five colours from seed 42.');
    expect(rendered).toContain('6.70:1 — "Generate"');
    expect(rendered).toContain(
      'controls with an accessible name but no visible text of their own | 5 control(s), 2 text field(s)',
    );
  });

  it('pins the exact decision wording a reviewer is being asked about', () => {
    const checklist = decisionChecklist(BASE.decisions);
    expect(checklist).toHaveLength(2);
    expect(checklist[0]).toContain('revision 1');
    expect(checklist[0]).toContain('Never use modal dialogs');
    expect(checklist[1]).toContain('r'.length > 0 ? 'revision 3' : '');
  });

  it('renders every dimension and one sheet row per decision, left blank', () => {
    const rendered = renderReviewPacket(BASE, packetIssues(BASE));
    for (const dimension of REVIEW_DIMENSIONS) {
      expect(rendered).toContain(dimension);
      // Our own rows carry no score: the score column stays empty.
      expect(rendered).not.toMatch(new RegExp(`${dimension.slice(0, 20)}.*\\|\\s*[1-5]\\s*\\|`));
    }
    expect(rendered.match(/^\| 11111111 r1:/m)).not.toBeNull();
    expect(rendered.match(/^\| 22222222 r3:/m)).not.toBeNull();
  });

  it('emits exactly one judgement row per dimension, so the sheet cannot silently gain or lose one', () => {
    const rendered = renderReviewPacket(BASE, []);
    const sheetLines = rendered.split('\n').filter((line) => line.startsWith('| '));
    const dimensionRows = sheetLines.filter((line) =>
      REVIEW_DIMENSIONS.some((dimension) => line.startsWith(`| ${dimension}`)),
    );
    expect(dimensionRows).toHaveLength(REVIEW_DIMENSIONS.length);
    // A sheet with a pre-filled score cell is not the sheet this packet promises.
    for (const row of dimensionRows) {
      expect(row).toBe(`| ${row.slice(2, row.indexOf(' | ', 2))} |  |  |`);
    }
  });

  it('refuses to score the app itself, in words and in fact', () => {
    const rendered = renderReviewPacket(BASE, []);
    expect(rendered).toContain('**No automatic score.**');
    // No "quality: 4/5"-style verdict anywhere in the document.
    expect(rendered).not.toMatch(/\b[1-5]\s*\/\s*5\b/);
    expect(rendered).not.toMatch(/overall score/i);
  });

  it('states when the packet cannot anchor a release identity', () => {
    const issues = packetIssues({
      ...BASE,
      bundle_identity: {
        ...BASE.bundle_identity,
        supports_commit_identity: false,
        note: 'built at an older commit',
      },
    });
    expect(issues.join(' ')).toContain('cannot anchor a release identity');
    expect(issues.join(' ')).toContain('built at an older commit');
  });
});

describe('cost records survive re-measurement hops (KI-85)', () => {
  const paidRecord = {
    coding_jobs: 1,
    max_calls_per_job: 12,
    idempotency_key: 'a6f98754-4fe0-4267-86b1-e43806c1523f',
    media_dispatches: 0,
    coding_calls_known: 3,
    coding_calls_unknown_jobs: 0,
  };

  it('carries the original cost through a second hop instead of printing nulls', () => {
    // The defect, from the 2026-11-03 re-measurement: reading only `paid` meant each hop degraded
    // the record, so a packet two hops from the paid run said nothing about what it cost.
    const hop1 = { paid: null, observations: { paid_basis_carried_forward: paidRecord } };
    const carried = carryCost(hop1);
    expect(carried).not.toBeNull();
    expect(carried?.coding_calls_known).toBe(3);
    expect(carried?.idempotency_key).toBe('a6f98754-4fe0-4267-86b1-e43806c1523f');
    expect(costRecordIsSilent(carried)).toBe(false);
  });

  it('prefers the record that states more, whichever field it sits in', () => {
    const emptyOwn = { paid: { coding_jobs: null, coding_calls_known: null }, observations: null };
    expect(carryCost(emptyOwn)).toEqual({ coding_jobs: null, coding_calls_known: null });
    const rich = {
      paid: { coding_jobs: null },
      observations: { paid_basis_carried_forward: paidRecord },
    };
    expect(carryCost(rich)?.coding_jobs).toBe(1);
  });

  it('names every packet the cost travelled through, newest first', () => {
    const chain = costChain({ observations: { cost_chain: ['packet-hop2'] } }, 'packet-hop3');
    expect(chain).toEqual(['packet-hop3', 'packet-hop2']);
    expect(costChain(undefined, 'only-hop')).toEqual(['only-hop']);
  });

  it('says so plainly when a packet cannot state its own price', () => {
    expect(costRecordIsSilent(null)).toBe(true);
    expect(costRecordIsSilent({ coding_jobs: null, coding_calls_known: null })).toBe(true);
    expect(describeCost(null)).toContain('cannot state what was paid');
    expect(describeCost(paidRecord)).toContain('1 coding job(s)');
    expect(describeCost(paidRecord)).toContain('3 internal call(s)');
    expect(describeCost(paidRecord)).toContain('Idempotency-Key a6f98754');
  });

  it('flags a silent cost record as an evidence problem, not as a zero-cost app', () => {
    const base = BASE;
    const silent = packetIssues({ ...base, cost: { coding_jobs: null } });
    expect(silent.some((issue) => issue.includes('cost record is silent'))).toBe(true);
    const stated = packetIssues({ ...base, cost: paidRecord });
    expect(stated.some((issue) => issue.includes('cost record is silent'))).toBe(false);
  });

  it('prints the built-at and measured-by commits apart, so a re-measure is not read as a new build', () => {
    const base = BASE;
    const sheet = renderReviewPacket(
      {
        ...base,
        built_at_commit: '94867e5f8c67d382025b5a3dc62ccaf1c1432b27',
        measured_by_commit: 'd706f2d0000000000000000000000000000000ab',
        cost: paidRecord,
        cost_chain: ['test-results/human-review/palette-bench-2026-11-02-2250'],
      },
      [],
    );
    expect(sheet).toContain('bytes built at / measured by');
    expect(sheet).toContain('94867e5f8c67d382025b5a3dc62ccaf1c1432b27 / d706f2d');
    expect(sheet).toContain('what was paid for the app');
    expect(sheet).toContain('1 coding job(s), 3 internal call(s), capped at 12');
    expect(sheet).toContain('this cost record was copied through');
  });
});
