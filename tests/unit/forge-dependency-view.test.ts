// The sentences a reviewer acts on are pinned here (KI-74). A person deciding to
// approve a change that fetches its engine over the network should read the same
// warning every time, and the difference between "no dependencies were recorded"
// and "there are none" must survive every refactor.
import type { ForgeDependencyDisclosure } from '@mml/shared';
import { describe, expect, it } from 'vitest';
import {
  dependencyView,
  disclosureForVersion,
  NOT_RECORDED_SUMMARY,
  REMOTE_ENGINE_WARNING,
  SELF_CONTAINED_SUMMARY,
  STATUS_LABELS,
} from '../../apps/web/src/components/studio/dependency-view.ts';

const PHASER_URL = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js';
const NEWER_URL = 'https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js';

function disclosure(
  partial: Partial<ForgeDependencyDisclosure> & Pick<ForgeDependencyDisclosure, 'dependencies'>,
): ForgeDependencyDisclosure {
  return {
    network_policy: partial.network_policy ?? 'vendored',
    // Bundled rows are not fetches, so a document carrying everything is
    // self-contained — the same rule the server measures.
    self_contained:
      partial.self_contained ?? partial.dependencies.every((row) => row.status === 'bundled'),
    granted_origins: partial.granted_origins ?? [],
    dependencies: partial.dependencies,
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

const remoteOlder = {
  status: 'fetched' as const,
  reason: 'version_outside_pin' as const,
  library: 'phaser',
  version: '3.90.0',
  url: NEWER_URL,
  origin: 'https://cdn.jsdelivr.net',
  sha256: null,
  bytes: null,
  note: 'asks for phaser@3.90.0; this product vendors phaser@3.80.1 and left the reference exactly as written',
};

const blockedByPolicy = {
  status: 'blocked' as const,
  reason: 'requested_by_application_code' as const,
  library: null,
  version: null,
  url: 'https://example.org/collect',
  origin: 'https://example.org',
  sha256: null,
  bytes: null,
  note:
    "this URL appears as a literal in the application's code text, which is not evidence that the " +
    'line ever runs',
  basis: 'code_text' as const,
  observed: null as boolean | null,
};

describe('the dependency disclosure a reviewer reads (KI-74)', () => {
  it('says no record exists instead of implying there were no dependencies', () => {
    // A version approved before disclosure existed is a gap in the record, not
    // evidence that the artifact fetches nothing.
    expect(dependencyView(null).summary).toBe(NOT_RECORDED_SUMMARY);
    expect(dependencyView(undefined).summary).toBe(NOT_RECORDED_SUMMARY);
    expect(dependencyView(null).rows).toEqual([]);
    expect(dependencyView(disclosure({ dependencies: [] })).summary).not.toBe(NOT_RECORDED_SUMMARY);
  });

  it('names a carried library as carried, and keeps the reference it replaced visible', () => {
    const view = dependencyView(disclosure({ dependencies: [bundled] }));
    expect(view.summary).toBe(SELF_CONTAINED_SUMMARY);
    expect(view.rows).toHaveLength(1);
    const row = view.rows[0] as (typeof view.rows)[number];
    expect(row.kind).toBe('bundled');
    expect(row.status).toBe(STATUS_LABELS.bundled);
    expect(row.subject).toBe('phaser 3.80.1');
    expect(row.explanation).toContain('carries its own pinned copy of phaser 3.80.1');
    expect(row.explanation).toContain('in place of the remote reference');
    expect(row.source).toContain('pinned sha256 666666666666…');
    expect(row.source).toContain('1181917 bytes');
    expect(row.source).toContain(PHASER_URL);
    expect(view.policy).toBe('verification granted no remote origin');
  });

  it('uses the approved warning for a dependency fetched at run time', () => {
    const view = dependencyView(
      disclosure({
        network_policy: 'cdn-allowlist',
        self_contained: false,
        granted_origins: ['https://cdn.jsdelivr.net'],
        dependencies: [remoteOlder],
      }),
    );
    const row = view.rows[0] as (typeof view.rows)[number];
    expect(row.kind).toBe('fetched');
    expect(row.status).toBe(STATUS_LABELS.fetched);
    // The sentence is the approved one, verbatim, naming the origin.
    expect(row.explanation).toContain(REMOTE_ENGINE_WARNING('https://cdn.jsdelivr.net'));
    expect(row.explanation).toContain('approve it knowing that host must answer');
    expect(row.explanation).toContain('or ask for a change to the pinned reference');
    // And it still says why nothing was substituted.
    expect(row.explanation).toContain('asks for phaser@3.90.0');
    expect(row.explanation).toContain('vendors phaser@3.80.1');
    expect(view.policy).toBe('verification permitted: https://cdn.jsdelivr.net');
  });

  it('warns when a remote reference survived alongside a carried copy', () => {
    const view = dependencyView(
      disclosure({
        dependencies: [
          bundled,
          {
            ...bundled,
            status: 'fetched',
            reason: 'vendored_copy_and_remote_copy',
            sha256: null,
            bytes: null,
          },
        ],
      }),
    );
    const dup = view.rows[1] as (typeof view.rows)[number];
    expect(dup.kind).toBe('fetched');
    expect(dup.explanation).toContain('carry a pinned copy and still reference the remote one');
  });

  it('names a blocked dependency as refused by verification, not merely absent', () => {
    const view = dependencyView(
      disclosure({
        self_contained: false,
        dependencies: [bundled, blockedByPolicy],
      }),
    );
    const row = view.rows[1] as (typeof view.rows)[number];
    expect(row.kind).toBe('blocked');
    expect(row.status).toBe(STATUS_LABELS.blocked);
    // A URL found in code text is reported as text, not as a request: Chromium
    // records no request at all for the same characters inside a comment or a
    // string literal, so claiming the application "asks the browser" for it is a
    // claim this reading cannot support.
    expect(row.explanation).toContain("appears as a literal in the application's code text");
    expect(row.explanation).toContain('no browser run was recorded against these bytes');
    expect(row.explanation).not.toContain('asks the browser for this URL when it runs');
    expect(row.source).toBe('https://example.org');
    // A no-network policy plus a remote row is stated in plain terms, because a
    // passed load check under that policy never saw the dependency.
    expect(view.notes.join(' ')).toContain('refused during verification');
    // And the reader is told which rows came from reading code text.
    expect(view.notes.join(' ')).toContain('found by reading the application');
  });

  it('never lets an empty list read as proof that nothing was fetched', () => {
    const withLimits = dependencyView(
      disclosure({
        dependencies: [],
        scan_limits: ['a request whose URL is assembled at run time will not appear here'],
      }),
    );
    expect(withLimits.summary).toContain('No remote reference was found in these bytes');
    expect(withLimits.notes.join(' ')).toContain('what this record cannot see');
    expect(withLimits.notes.join(' ')).toContain('assembled at run time');

    // A record written before the field existed gets the warning anyway: silence
    // is the reading that turns a scan into an assurance.
    const withoutLimits = dependencyView(disclosure({ dependencies: [] }));
    expect(withoutLimits.notes.join(' ')).toContain('never as "nothing was fetched"');
  });

  it('says a refusal was observed only when a check observed it', () => {
    const seen = dependencyView(
      disclosure({
        self_contained: false,
        dependencies: [{ ...blockedByPolicy, observed: true }],
      }),
    );
    expect((seen.rows[0] as (typeof seen.rows)[number]).explanation).toContain(
      'recorded a request for this origin being refused',
    );
    const predicted = dependencyView(
      disclosure({
        self_contained: false,
        network_policy: 'cdn-allowlist',
        granted_origins: ['https://cdn.jsdelivr.net'],
        dependencies: [{ ...blockedByPolicy, observed: false }],
      }),
    );
    const text = (predicted.rows[0] as (typeof predicted.rows)[number]).explanation;
    expect(text).toContain('no request for this origin was recorded during verification');
    expect(text).not.toContain('recorded a request for this origin being refused');
  });

  it('does not let a policy grant read as a fetch that did not happen', () => {
    // An application that references nothing outside itself still runs under a
    // policy that would have permitted the approved CDN. Stating only the grant
    // would read as a dependency; stating only the absence would hide that a
    // reach to that host would have been allowed.
    const view = dependencyView(
      disclosure({
        network_policy: 'cdn-allowlist',
        self_contained: true,
        granted_origins: ['https://cdn.jsdelivr.net'],
        dependencies: [],
      }),
    );
    expect(view.policy).toBe(
      'verification would have permitted https://cdn.jsdelivr.net; these bytes reference nothing remote',
    );
    expect(view.rows).toEqual([]);
  });

  it('separates approved image embedding from dependency fetching', () => {
    const view = dependencyView(
      disclosure({ dependencies: [bundled], pending_media_references: 3 }),
    );
    expect(view.notes.join(' ')).toContain('3 approved image reference(s)');
    expect(view.notes.join(' ')).toContain('adds bytes, not network requests');
  });

  it('reads the record for the approved version, and says when none was kept', () => {
    const versions = [
      { version: 1 },
      { version: 2, dependencies: disclosure({ dependencies: [bundled] }) },
    ];
    expect(disclosureForVersion(versions, 2)?.dependencies[0]?.status).toBe('bundled');
    // v1 was approved by an older build: the panel must not invent a picture.
    expect(disclosureForVersion(versions, 1)).toBeNull();
    expect(dependencyView(disclosureForVersion(versions, 1)).summary).toBe(NOT_RECORDED_SUMMARY);
    expect(disclosureForVersion(versions, null)).toBeNull();
  });
});
