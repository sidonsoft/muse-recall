import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The release documents name commands by name. When a document says
 * `pnpm run vendor:phaser` and no such script exists, the document is not
 * describing the product — and this happened: the vendoring change documented a
 * refresh command in six places while `package.json` never gained it, so every
 * one of those instructions failed for the person trying to follow them.
 *
 * This is a cheap drift gate over the documents that describe a release, not a
 * general style rule: archived documents and research notes are deliberately out
 * of scope, because they record what was true when they were written.
 */
const ROOT = join(__dirname, '..', '..');

const RELEASE_DOCS = [
  'docs/MULTIMODAL_STUDIO_STATUS.md',
  'docs/KNOWN_ISSUES.md',
  'docs/DECISIONS.md',
  'docs/Fresh-Install-Rehearsal.md',
  'docs/guide/html-studio.md',
  'docs/guide/limitations.md',
  'docs/guide/architecture.md',
  'docs/guide/getting-started.md',
  'docs/review-apps/README.md',
  'docs/beta/READINESS.md',
  'docs/beta/RELEASE-GATE.md',
  'docs/beta/RELEASE-NOTES.md',
  'docs/beta/DEMO-CHECKLIST.md',
];

const packageScripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  .scripts as Record<string, string>;

/** `pnpm` subcommands that are not project scripts. */
const PNM_BUILTINS = new Set([
  'run',
  'exec',
  'dlx',
  'install',
  'i',
  'add',
  'remove',
  'uninstall',
  'list',
  'ls',
  'why',
  'view',
  'store',
  'prune',
  'outdated',
  'rebuild',
  'audit',
  'dedupe',
  'import',
  'init',
  'link',
  'patch',
  'test',
  'start',
  'build',
  'version',
  'pack',
  'publish',
  'config',
  'setup',
  'create',
  'up',
  'update',
]);

/** Script names that the documents name, per document. */
function scriptsNamedIn(doc: string): string[] {
  const text = readFileSync(join(ROOT, doc), 'utf8');
  const names = new Set<string>();
  // `pnpm run verify:runtime`, `pnpm run vendor:phaser`
  for (const match of text.matchAll(/pnpm run ([A-Za-z0-9][A-Za-z0-9:_-]*)/g)) {
    names.add(match[1] ?? '');
  }
  // `pnpm verify:runtime` — a colon always means a project script in this repo.
  for (const match of text.matchAll(
    /pnpm (?!run\b|exec\b|-[A-Za-z])([a-z0-9][A-Za-z0-9_-]*:[A-Za-z0-9:_-]+)/g,
  )) {
    const name = match[1] ?? '';
    if (!PNM_BUILTINS.has(name)) names.add(name);
  }
  return [...names].filter(Boolean);
}

/** `tsx scripts/<file>.ts` targets that the documents name, per document. */
function scriptFilesNamedIn(doc: string): string[] {
  const text = readFileSync(join(ROOT, doc), 'utf8');
  const files = new Set<string>();
  for (const match of text.matchAll(/tsx (scripts\/[A-Za-z0-9_./-]+\.ts)/g)) {
    files.add(match[1] ?? '');
  }
  return [...files].filter(Boolean);
}

describe('the release documents only name commands the product has', () => {
  it('every script named in a release document exists in package.json', () => {
    const missing: string[] = [];
    for (const doc of RELEASE_DOCS) {
      for (const name of scriptsNamedIn(doc)) {
        if (!(name in packageScripts)) missing.push(`${doc}: pnpm ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every gate script path named in a release document exists on disk', () => {
    const missing: string[] = [];
    for (const doc of RELEASE_DOCS) {
      for (const file of scriptFilesNamedIn(doc)) {
        if (!existsSync(join(ROOT, file))) missing.push(`${doc}: ${file}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('the documented vendor refresh commands are the ones the script implements', () => {
    // A document can name a script that exists and still name a mode that does
    // not: `--check` and `--against-remote` are the two modes promised by the
    // guides and the decision record.
    const source = readFileSync(join(ROOT, 'scripts/vendor-phaser.ts'), 'utf8');
    expect(source).toContain("'--check'");
    expect(source).toContain("'--against-remote'");
    expect(packageScripts['vendor:phaser']).toContain('scripts/vendor-phaser.ts');
  });
});

describe('the documented integrity check runs against the committed bytes', () => {
  it('verifies the committed engine against the pin, reading only the repository', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/vendor-phaser.ts', '--', '--check'],
      { cwd: ROOT, encoding: 'utf8', timeout: 120_000 },
    );
    expect(result.status, result.stderr.slice(0, 400)).toBe(0);
    expect(result.stdout).toContain('hashes to the pin');
    expect(result.stdout).toContain('1181917');
    /*
     * What this proves is that the mode reads the committed module: the command
     * the guides promise works without asking anything of the network, and it
     * reports the byte length the pin claims. It does not prove the absence of a
     * request at the socket level — the `--against-remote` mode is the one that
     * talks to the pinned URL, and it is never run here.
     */
    expect(result.stdout).toContain('No network was used');
  });
});
