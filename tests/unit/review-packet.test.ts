import { describe, expect, it } from 'vitest';
import {
  decisionChecklist,
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
