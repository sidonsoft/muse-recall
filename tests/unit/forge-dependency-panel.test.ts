// The approval panel renders text taken from a generated document: a URL, a
// version string, a reason sentence. Those are untrusted, so this checks both
// that the three cases are visually distinguishable in the markup a reviewer
// reads and that nothing in them is treated as HTML (KI-74).

import type { ForgeDependencyDisclosure } from '@mml/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DependencyDisclosure } from '../../apps/web/src/components/studio/DependencyDisclosure.tsx';
import {
  dependencyView,
  NOT_RECORDED_SUMMARY,
} from '../../apps/web/src/components/studio/dependency-view.ts';

const PHASER_URL = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js';

function disclosure(
  rows: ForgeDependencyDisclosure['dependencies'],
  partial: Partial<ForgeDependencyDisclosure> = {},
): ForgeDependencyDisclosure {
  return {
    network_policy: partial.network_policy ?? 'vendored',
    self_contained: partial.self_contained ?? rows.every((row) => row.status === 'bundled'),
    granted_origins: partial.granted_origins ?? [],
    dependencies: rows,
    pending_media_references: partial.pending_media_references ?? 0,
    ...(partial.scan_limits === undefined ? {} : { scan_limits: partial.scan_limits }),
    html_sha256: partial.html_sha256 ?? 'a'.repeat(64),
    recorded_at: partial.recorded_at ?? '2026-11-03T09:00:00.000Z',
  };
}

const bundled = {
  status: 'bundled' as const,
  reason: 'bundled_pinned_copy' as const,
  library: 'phaser',
  version: '3.80.1',
  url: PHASER_URL,
  origin: null,
  sha256: '6'.repeat(64),
  bytes: 1_181_917,
  note: 'carried by this product at the pinned sha256',
};

const fetched = {
  status: 'fetched' as const,
  reason: 'version_outside_pin' as const,
  library: 'phaser',
  version: '3.55.0',
  url: 'https://cdn.jsdelivr.net/npm/phaser@3.55.0/dist/phaser.min.js',
  origin: 'https://cdn.jsdelivr.net',
  sha256: null,
  bytes: null,
  note: 'asks for phaser@3.55.0; this product vendors phaser@3.80.1 and left the reference exactly as written',
};

const blocked = {
  status: 'blocked' as const,
  reason: 'requested_by_application_code' as const,
  library: null,
  version: null,
  url: 'https://exfiltration.example/collect',
  origin: 'https://exfiltration.example',
  sha256: null,
  bytes: null,
  note:
    "this URL appears as a literal in the application's code text, which is not evidence that the " +
    'line ever runs',
  // This fixture models the case where the check really did refuse a request for
  // that origin; the row wording for a prediction rather than an observation is
  // pinned separately below.
  basis: 'code_text' as const,
  observed: true as boolean | null,
};

function markup(view: ReturnType<typeof dependencyView>): string {
  return renderToStaticMarkup(createElement(DependencyDisclosure, { view }));
}

describe('the dependency block a reviewer sees (KI-74)', () => {
  it('renders the three cases apart, each marked with its kind', () => {
    const html = markup(
      dependencyView(
        disclosure([bundled, fetched, blocked], {
          network_policy: 'cdn-allowlist',
          self_contained: false,
          granted_origins: ['https://cdn.jsdelivr.net'],
        }),
      ),
    );
    expect(html).toContain('data-testid="dependency-disclosure"');
    for (const kind of ['bundled', 'fetched', 'blocked']) {
      expect(html).toContain(`data-dependency-kind="${kind}"`);
      expect(html).toContain(`data-dependency-status="${kind}"`);
    }
    // A reviewer skimming the rail reads the status words, not the attributes.
    expect(html).toContain('Carried inside these bytes');
    expect(html).toContain('Loaded from a remote host');
    expect(html).toContain('Refused by the verification policy');
    // The unsupported version is named with the version it asked for, and the
    // pin the product carries, in the same block.
    expect(html).toContain('phaser 3.55.0');
    expect(html).toContain('phaser@3.80.1');
    // Bundled rows carry the pin identity, so the claim is checkable.
    expect(html).toContain('pinned sha256 666666666666…');
    // The block states the rule it was measured under.
    expect(html).toContain('data-testid="dependency-policy"');
    expect(html).toContain('verification permitted: https://cdn.jsdelivr.net');
  });

  it('says a record is missing without inventing one', () => {
    const html = markup(dependencyView(null));
    expect(html).toContain('policy not recorded');
    expect(html).toContain(NOT_RECORDED_SUMMARY);
    expect(html).not.toContain('data-dependency-kind');
  });

  it('escapes reference text, because every row can come from a generated document', () => {
    const hostile = {
      ...fetched,
      library: 'phaser"><img src=x onerror=alert(1)>',
      note: '</span><script>steal()</script>',
      url: 'https://cdn.jsdelivr.net/npm/phaser@3.55.0/<script>steal()</script>',
    };
    const html = markup(dependencyView(disclosure([hostile], { self_contained: false })));
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>steal()</script>');
    // The payload is still readable as text: hiding it would be its own defect.
    expect(html).toContain('&lt;script&gt;steal()&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('keeps the two kinds of refusal apart in the wording a reviewer reads', () => {
    const html = markup(
      dependencyView(
        disclosure([bundled, blocked], {
          self_contained: false,
          dependencies: [bundled, blocked],
        }),
      ),
    );
    expect(html).toContain('verification granted no remote origin');
    // A passed check under this policy never saw the blocked reach; the block has
    // to say that rather than leave the reader to guess which green means what.
    expect(html).toContain('refused during verification');
    // And the row itself says whether a request was *seen* being refused or the
    // policy merely would refuse it: one is an observation, the other a reading.
    expect(html).toContain('recorded a request for this origin being refused');
    expect(html).toContain('the policy in force refuses that origin');
  });

  it('states what the reading cannot see, even for a record that never said', () => {
    const stated = markup(
      dependencyView(
        disclosure([bundled], {
          scan_limits: ['a request whose URL is assembled at run time will not appear here'],
        }),
      ),
    );
    expect(stated).toContain('what this record cannot see');
    expect(stated).toContain('assembled at run time will not appear here');

    // An empty list is the dangerous case: it is a finding about a scan, not a
    // record of what ran. A record that predates the field must not go silent.
    const unstated = markup(dependencyView(disclosure([])));
    expect(unstated).toContain('what this record cannot see');
    // Rendered as static markup, the quotes arrive escaped: asserting the source
    // form would pass only if the component leaked HTML, which it must not.
    expect(unstated).toContain('never as &quot;nothing was fetched&quot;');
  });

  it('does not report a predicted refusal as an observed one', () => {
    const html = markup(
      dependencyView(
        disclosure([{ ...blocked, observed: null }], {
          self_contained: false,
          network_policy: 'cdn-allowlist',
          granted_origins: ['https://cdn.jsdelivr.net'],
        }),
      ),
    );
    expect(html).toContain('no browser run was recorded against these bytes');
    expect(html).not.toContain('recorded a request for this origin being refused');
    // Code text is labelled as text, because the same characters in a comment
    // produce this row and produce no request at all.
    expect(html).toContain('found by reading the application');
  });
});
