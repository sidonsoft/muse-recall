import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ForgeDependencyDisclosureSchema } from '@mml/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bundledDependencyCatalogue,
  dependencyDisclosure,
} from '../../apps/server/src/forge/dependencies.js';
import { vendorScripts } from '../../apps/server/src/forge/vendored-scripts.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';

const JOB = '11111111-1111-4111-8111-111111111111';
const PHASER_URL = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js';
/** A version the product does not carry, on the same CDN path shape. */
const NEWER_PHASER_URL = 'https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js';

function documentWithTag(tag: string, extra = ''): string {
  return `<!doctype html><html><body><canvas id="game"></canvas>
${tag}
<script>const score = 0; console.log(score);</script>${extra}</body></html>`;
}

/** The bytes the product would actually promote for that source view. */
function shipped(html: string): string {
  return vendorScripts(html).html;
}

describe('dependency disclosure measured from promoted bytes (KI-74)', () => {
  it('names the engine the product carries as bundled, with the pin behind it', () => {
    const disclosure = dependencyDisclosure(
      shipped(documentWithTag(`<script src="${PHASER_URL}"></script>`)),
    );
    expect(disclosure.network_policy).toBe('vendored');
    // Self-contained is a measurement over the whole document, not a claim
    // derived from which policy was chosen.
    expect(disclosure.self_contained).toBe(true);
    expect(disclosure.granted_origins).toEqual([]);
    expect(disclosure.dependencies).toHaveLength(1);
    const row = disclosure.dependencies[0] as (typeof disclosure.dependencies)[number];
    expect(row.status).toBe('bundled');
    expect(row.reason).toBe('bundled_pinned_copy');
    expect(row.library).toBe('phaser');
    expect(row.version).toBe('3.80.1');
    // The row still names the reference the copy replaced, so "we carry Phaser"
    // cannot be read as "this document never mentioned a remote engine".
    expect(row.url).toBe(PHASER_URL);
    expect(row.origin).toBeNull();
    expect(row.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((row.bytes as number) > 1_000_000).toBe(true);
    expect(disclosure.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('leaves a version it does not carry remote and says so, instead of substituting one', () => {
    const source = documentWithTag(`<script src="${NEWER_PHASER_URL}"></script>`);
    const outcome = vendorScripts(source);
    // The refusal to substitute is the reason the disclosure exists at all.
    expect(outcome.applied).toHaveLength(0);
    expect(outcome.html).toContain(NEWER_PHASER_URL);
    const disclosure = dependencyDisclosure(outcome.html);
    const row = disclosure.dependencies[0] as (typeof disclosure.dependencies)[number];
    expect(row.status).toBe('fetched');
    expect(row.reason).toBe('version_outside_pin');
    expect(row.library).toBe('phaser');
    expect(row.version).toBe('3.90.0');
    expect(row.origin).toBe('https://cdn.jsdelivr.net');
    expect(row.note).toContain('vendors phaser@3.80.1');
    expect(row.note).toContain('left the reference exactly as written');
  });

  it('reports a pinned reference left remote because of its tag form, not a version gap', () => {
    const source = documentWithTag(`<script defer src="${PHASER_URL}"></script>`);
    const outcome = vendorScripts(source);
    expect(outcome.html).toContain(PHASER_URL);
    const row = dependencyDisclosure(outcome.html).dependencies[0] as {
      status: string;
      reason: string;
      version: string | null;
      note: string;
    };
    expect(row.status).toBe('fetched');
    expect(row.reason).toBe('tag_form_not_replaced');
    expect(row.version).toBe('3.80.1');
    expect(row.note).toContain('defer');
    expect(row.note).toContain('left as written');
  });

  it('separates a dependency verification refused from one it allowed, per document', () => {
    // A document that carries the engine and still reaches for the network is
    // verified with no remote origin at all, so the reach is refused — the case a
    // passed check must not hide behind a green result.
    const phoningHome = shipped(
      documentWithTag(
        `<script src="${PHASER_URL}"></script>`,
        '<script>fetch("https://example.org/collect");</script>',
      ),
    );
    const strict = dependencyDisclosure(phoningHome);
    expect(strict.network_policy).toBe('vendored');
    expect(strict.granted_origins).toEqual([]);
    const refused = strict.dependencies.find(
      (row) => row.reason === 'requested_by_application_code',
    );
    if (!refused) throw new Error('a literal URL in the application code was not disclosed');
    expect(refused.status).toBe('blocked');
    expect(refused.origin).toBe('https://example.org');
    expect(refused.url).toBe('https://example.org/collect');
    expect(strict.self_contained).toBe(false);

    // The same host under the allowlist policy is permitted, and the disclosure
    // records that it was permitted rather than leaving the reader to infer it.
    const dependent = dependencyDisclosure(
      documentWithTag(
        `<script src="${NEWER_PHASER_URL}"></script>`,
        '<img src="https://cdn.jsdelivr.net/other/lib/icon.png" alt="">',
      ),
    );
    expect(dependent.network_policy).toBe('cdn-allowlist');
    expect(dependent.granted_origins).toEqual(['https://cdn.jsdelivr.net']);
    expect(dependent.dependencies.filter((row) => row.status === 'fetched')).toHaveLength(2);
    expect(dependent.self_contained).toBe(false);

    // A document that carries the engine but also references a remote asset keeps
    // the CDN grant rather than the no-network one: carrying a copy is not the
    // same as asking for nothing. Pinned here because it is the case a reviewer
    // is most likely to misread as "bundled, therefore nothing is fetched".
    const carriesAndFetches = shipped(
      documentWithTag(
        `<script src="${PHASER_URL}"></script>`,
        '<img src="https://cdn.jsdelivr.net/other/lib/icon.png" alt="">',
      ),
    );
    const mixed = dependencyDisclosure(carriesAndFetches);
    expect(mixed.network_policy).toBe('cdn-allowlist');
    expect(mixed.dependencies.map((row) => row.status)).toEqual(['bundled', 'fetched']);
    expect(mixed.self_contained).toBe(false);
  });

  it('hashes the bytes it describes, so the panel cannot be shown a different document', () => {
    const source = documentWithTag(`<script src="${PHASER_URL}"></script>`);
    const bytes = shipped(source);
    const disclosure = dependencyDisclosure(bytes);
    expect(disclosure.html_sha256).toBe(createHash('sha256').update(bytes, 'utf8').digest('hex'));
    // The source view and the promoted bytes are different documents, and the
    // disclosure tells them apart: the source fetches, the artifact carries.
    const sourceDisclosure = dependencyDisclosure(source);
    expect(sourceDisclosure.dependencies[0]?.status).toBe('fetched');
    expect(sourceDisclosure.html_sha256).not.toBe(disclosure.html_sha256);
    expect(disclosure.dependencies[0]?.status).toBe('bundled');
    expect(disclosure.dependencies[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('counts approved image references separately from dependencies', () => {
    // The placeholders go in before vendoring: the carried engine is over a
    // megabyte of minified bytes that can contain tag-shaped text, so a test that
    // spliced into the finished bytes would have been editing the engine.
    const withPlaceholders = documentWithTag(
      `<script src="${PHASER_URL}"></script>`,
      '<img src="muse-asset://22222222-2222-4222-8222-222222222222/v3" alt=""><img src="muse-asset://22222222-2222-4222-8222-222222222222/v4" alt="">',
    );
    const disclosure = dependencyDisclosure(shipped(withPlaceholders));
    expect(disclosure.pending_media_references).toBe(2);
    // Embedding adds bytes, not requests: the placeholders are not dependencies.
    expect(disclosure.dependencies).toHaveLength(1);
    expect(disclosure.self_contained).toBe(true);
  });

  it('carries the same version of a library that is both bundled and referenced', () => {
    // A reference that survived vendoring must not be reported as if the copy
    // covered it silently: the row says both facts are present.
    const doubled = documentWithTag(`<script src="${PHASER_URL}"></script>`);
    const bytes = shipped(doubled).replace(
      '<script>const score = 0;',
      `<script src="${PHASER_URL}"></script><script>const score = 0;`,
    );
    const disclosure = dependencyDisclosure(bytes);
    const dup = disclosure.dependencies.find(
      (row) => row.reason === 'vendored_copy_and_remote_copy',
    );
    if (!dup) throw new Error('a document carrying a copy and a remote reference reported neither');
    expect(dup.status === 'fetched' || dup.status === 'blocked').toBe(true);
    expect(dup.note).toContain('still reference it over the network');
  });

  it('parses under the shared contract, so a stored record cannot drift', () => {
    const parsed = ForgeDependencyDisclosureSchema.safeParse(
      dependencyDisclosure(shipped(documentWithTag(`<script src="${PHASER_URL}"></script>`))),
    );
    expect(parsed.success).toBe(true);
    // The catalogue is what messages and documents quote; it must name the pin.
    const pin = bundledDependencyCatalogue()[0] as { name: string; version: string; url: string };
    expect(pin.name).toBe('phaser');
    expect(pin.version).toBe('3.80.1');
    expect(pin.url).toBe(PHASER_URL);
  });
});

describe('the disclosure the approval interface reads (KI-74)', () => {
  let root: string;
  let workspace: ForgeWorkspace;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'forge-deps-'));
    workspace = new ForgeWorkspace(root);
    await workspace.ensureProject('demo-game');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function stage(html: string): Promise<void> {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), html, 'utf8');
  }

  it('describes the staged bytes promotion would write, not the file on disk', async () => {
    await stage(documentWithTag(`<script src="${PHASER_URL}"></script>`));
    const snapshot = await workspace.stagedSnapshot('demo-game', JOB);
    const disclosure = await workspace.stagedDependencies('demo-game', JOB);
    if (!snapshot || !disclosure) throw new Error('the staged change was not readable');
    // Same bytes: the hash in the disclosure is the hash promotion is fenced by.
    expect(disclosure.html_sha256).toBe(snapshot.sha256);
    expect(disclosure.dependencies.map((row) => row.status)).toEqual(['bundled']);
    expect(disclosure.self_contained).toBe(true);
    // The stored file keeps the one-line reference — that is the source view — so
    // a panel that read the file would report a remote dependency the artifact
    // does not actually have.
    expect(await readFile(workspace.stagingFile('demo-game', JOB), 'utf8')).toContain(PHASER_URL);
  });

  it('records the disclosure with the version it describes', async () => {
    await stage(documentWithTag(`<script src="${PHASER_URL}"></script>`));
    const snapshot = await workspace.stagedSnapshot('demo-game', JOB);
    if (!snapshot) throw new Error('no staged snapshot');
    const promoted = await workspace.promote('demo-game', JOB, 'first version', {
      baseVersion: null,
      jobId: JOB,
      expectedSha256: snapshot.sha256,
      html: snapshot.html,
      dependencies: dependencyDisclosure(snapshot.html, { recordedAt: '2026-11-03T09:00:00.000Z' }),
    });
    const recorded = await workspace.approvedDependencyDisclosure('demo-game', promoted.version);
    if (!recorded) throw new Error('the promoted version kept no dependency record');
    expect(recorded.dependencies.map((row) => row.status)).toEqual(['bundled']);
    // The record describes the promoted artifact byte for byte.
    expect(recorded.html_sha256).toBe(promoted.sha256);
    expect(recorded.recorded_at).toBe('2026-11-03T09:00:00.000Z');
  });

  it('says "not recorded" for a version approved before disclosure existed, and rewrites nothing', async () => {
    await stage(documentWithTag(`<script src="${PHASER_URL}"></script>`));
    const snapshot = await workspace.stagedSnapshot('demo-game', JOB);
    if (!snapshot) throw new Error('no staged snapshot');
    // A promotion without a disclosure is what an older build left behind; the
    // artifact must not be touched to make the panel look complete.
    const promoted = await workspace.promote('demo-game', JOB, 'approved by an older build', {
      baseVersion: null,
      jobId: JOB,
      expectedSha256: snapshot.sha256,
      html: snapshot.html,
    });
    expect(await workspace.approvedDependencyDisclosure('demo-game', promoted.version)).toBeNull();
    const before = await workspace.currentHtml('demo-game');
    const state = await workspace.state('demo-game');
    const entry = state.versions.find((version) => version.version === promoted.version);
    if (!entry) throw new Error('the promoted version is missing from state');
    // Reading the gap must not rewrite the artifact or its record.
    expect(await workspace.approvedDependencyDisclosure('demo-game', promoted.version)).toBeNull();
    expect(await workspace.currentHtml('demo-game')).toBe(before);
    const again = await workspace.state('demo-game');
    const after = again.versions.find((version) => version.version === promoted.version);
    expect(after?.sha256).toBe(entry.sha256);
    expect(after?.dependencies === undefined).toBe(true);
  });

  it('labels a URL found in code text as text, not as a request the application makes', () => {
    /*
     * Measured in a real browser during the review round: a comment and a string
     * literal containing the same `fetch("https://…")` call produce **zero**
     * requests, yet both used to be reported as dependencies verification refused.
     * They are still worth showing — the policy would refuse such a reach — but
     * only as what they are: text in the file.
     */
    const commented = documentWithTag(
      `<script src="${PHASER_URL}"></script>`,
      [
        '<script>',
        `// TODO swap back to fetch("https://example.org/collect") once the endpoint exists`,
        'new Phaser.Game();',
        '</script>',
      ].join('\n'),
    );
    const rows = dependencyDisclosure(shipped(commented)).dependencies;
    const text = rows.find((row) => row.reason === 'requested_by_application_code');
    expect(text?.basis).toBe('code_text');
    expect(text?.observed).toBeNull();
    expect(text?.note).toContain('not evidence');
    // The document is not self-contained: a remote reach is named somewhere in it.
    expect(dependencyDisclosure(shipped(commented)).self_contained).toBe(false);
  });

  it('marks a refusal as observed only when the check reported that origin', () => {
    const html = shipped(
      documentWithTag(
        `<script src="${PHASER_URL}"></script>`,
        '<script>fetch("https://example.org/collect");new Phaser.Game();</script>',
      ),
    );
    const seen = dependencyDisclosure(html, {
      observations: { blockedOrigins: ['https://example.org'] },
    });
    const row = seen.dependencies.find((entry) => entry.origin === 'https://example.org');
    expect(row?.observed).toBe(true);

    const notSeen = dependencyDisclosure(html, { observations: { blockedOrigins: [] } });
    expect(
      notSeen.dependencies.find((entry) => entry.origin === 'https://example.org')?.observed,
    ).toBe(false);

    // No check recorded: nothing is claimed either way.
    expect(
      dependencyDisclosure(html).dependencies.find(
        (entry) => entry.origin === 'https://example.org',
      )?.observed,
    ).toBeNull();
  });

  it('states the limits of the reading on every record, including a quiet one', () => {
    const plain = dependencyDisclosure(
      '<!doctype html><html><body><button type="button">go</button><script>const host="https://example.org";fetch(host+"/collect");</script></body></html>',
    );
    // A request assembled at run time is invisible to this scan, and the record
    // must say so instead of reporting "no dependencies" as if that settled it.
    expect(plain.dependencies).toEqual([]);
    expect(plain.scan_limits?.length ?? 0).toBeGreaterThan(0);
    expect((plain.scan_limits ?? []).join(' ')).toContain('assembled at run time');

    const noisy = dependencyDisclosure(
      shipped(documentWithTag(`<script src="${PHASER_URL}"></script>`)),
    );
    expect(noisy.scan_limits).toEqual(plain.scan_limits);
  });

  it('reads a remote reference written without quotes, like the browser does', () => {
    // A quoted-only scan made an unquoted `src=` invisible to the policy, the gap
    // list and the preview, while the browser loaded it anyway.
    const unquoted = dependencyDisclosure(
      '<!doctype html><html><body><script src=https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js></script><button type="button">go</button></body></html>',
    );
    expect(unquoted.dependencies.length).toBe(1);
    const row = unquoted.dependencies[0] as (typeof unquoted.dependencies)[number];
    expect(row.status).toBe('fetched');
    expect(row.origin).toBe('https://cdn.jsdelivr.net');
    expect(row.basis).toBe('document_reference');
    expect(unquoted.self_contained).toBe(false);
    expect(unquoted.network_policy).toBe('cdn-allowlist');
  });
});
