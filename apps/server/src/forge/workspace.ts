import { spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  FORGE_PROJECT_ID_PATTERN,
  type ForgeDiff,
  type ForgeState,
  ForgeStateSchema,
  type ForgeValidation,
  ForgeVersionSchema,
} from '@mml/shared';

/**
 * The only code allowed to touch generated game files.
 *
 * Every path is resolved against the project root and re-checked after
 * `realpath`, so a symlink planted inside a staging directory cannot escape.
 * Approved versions are immutable; promotion copies a validated staging file
 * into a new version and then flips a pointer atomically.
 */

export type ForgeErrorCode =
  | 'invalid_project_id'
  | 'invalid_job_id'
  | 'path_escape'
  | 'invalid_staged'
  | 'invalid_job_state'
  | 'nothing_to_rollback'
  | 'no_current_version';

export class ForgeError extends Error {
  constructor(
    readonly code: ForgeErrorCode,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_BYTES = 1_500_000;

export class ForgeWorkspace {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root, 'forge');
  }

  getRoot(): string {
    return this.root;
  }

  projectDir(projectId: string): string {
    if (!FORGE_PROJECT_ID_PATTERN.test(projectId)) {
      throw new ForgeError('invalid_project_id', 'Invalid Forge project id.');
    }
    return this.within(this.root, projectId);
  }

  async ensureProject(projectId: string): Promise<void> {
    const dir = this.projectDir(projectId);
    await mkdir(join(dir, 'versions'), { recursive: true });
    await mkdir(join(dir, 'staging'), { recursive: true });
    await mkdir(join(dir, 'jobs'), { recursive: true });
    try {
      await readFile(join(dir, 'state.json'), 'utf8');
    } catch {
      await this.writeState(projectId, { current: null, versions: [] });
    }
  }

  async state(projectId: string): Promise<ForgeState> {
    const dir = this.projectDir(projectId);
    try {
      const parsed = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')) as unknown;
      const state = ForgeStateSchema.parse({
        project_id: projectId,
        can_rollback: false,
        ...(parsed as object),
      });
      const currentIndex = state.versions.findIndex(
        (entry) => entry.version === state.current_version,
      );
      return {
        ...state,
        project_id: projectId,
        can_rollback: currentIndex > 0,
      };
    } catch {
      return { project_id: projectId, current_version: null, versions: [], can_rollback: false };
    }
  }

  async currentHtml(projectId: string): Promise<string | null> {
    const state = await this.state(projectId);
    if (state.current_version === null) return null;
    try {
      return await readFile(this.versionFile(projectId, state.current_version), 'utf8');
    } catch {
      return null;
    }
  }

  async createStaging(projectId: string, jobId: string): Promise<string> {
    this.assertJobId(jobId);
    const dir = this.within(join(this.projectDir(projectId), 'staging'), jobId);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    return dir;
  }

  stagingFile(projectId: string, jobId: string): string {
    this.assertJobId(jobId);
    return this.within(join(this.projectDir(projectId), 'staging'), jobId, 'index.html');
  }

  async stagedHtml(projectId: string, jobId: string): Promise<string | null> {
    try {
      return await readFile(this.stagingFile(projectId, jobId), 'utf8');
    } catch {
      return null;
    }
  }

  async reject(projectId: string, jobId: string): Promise<void> {
    this.assertJobId(jobId);
    const dir = this.within(join(this.projectDir(projectId), 'staging'), jobId);
    await rm(dir, { recursive: true, force: true });
  }

  /**
   * Structural and syntactic validation. Returns issues rather than throwing so
   * the diff review can show exactly why a change is not applicable.
   */
  async validateStaged(projectId: string, jobId: string): Promise<ForgeValidation> {
    const issues: string[] = [];
    let file: string;
    try {
      file = this.stagingFile(projectId, jobId);
    } catch (error) {
      return { ok: false, issues: [(error as Error).message] };
    }

    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(file);
    } catch {
      return { ok: false, issues: ['Staging file index.html is missing.'] };
    }

    if (stat.isSymbolicLink()) return { ok: false, issues: ['index.html is a symlink.'] };
    if (!stat.isFile()) return { ok: false, issues: ['index.html is not a regular file.'] };
    if (stat.size < 100) issues.push('index.html is suspiciously small.');
    if (stat.size > MAX_BYTES) issues.push(`index.html exceeds ${MAX_BYTES} bytes.`);

    // Re-resolve after the fact: a symlinked parent would change realpath.
    const stagingDir = this.within(join(this.projectDir(projectId), 'staging'), jobId);
    const projectDir = this.projectDir(projectId);
    const [realFile, realStaging, realProject] = await Promise.all([
      realpath(file),
      realpath(stagingDir),
      realpath(projectDir),
    ]);
    if (!realStaging.startsWith(realProject + sep)) {
      issues.push('Staging directory resolves outside the project.');
    }
    if (!realFile.startsWith(realProject + sep)) {
      issues.push('Resolved file escapes the project workspace.');
    }

    const html = await readFile(file, 'utf8');
    if (!/<canvas[\s>]/i.test(html)) issues.push('No <canvas> element found.');
    if (!/phaser/i.test(html)) issues.push('No Phaser reference found.');

    for (const script of extractInlineScripts(html)) {
      const check = spawnSync(process.execPath, ['--check', '-'], {
        input: script,
        encoding: 'utf8',
        timeout: 10_000,
      });
      if (check.status !== 0) {
        issues.push(`Inline script failed syntax check: ${String(check.stderr).slice(0, 300)}`);
      }
    }

    return { ok: issues.length === 0, issues };
  }

  async diffStaged(projectId: string, jobId: string): Promise<ForgeDiff> {
    const before = (await this.currentHtml(projectId)) ?? '';
    const after = (await this.stagedHtml(projectId, jobId)) ?? '';
    const validation = await this.validateStaged(projectId, jobId);
    const diff = unifiedDiff(before, after);
    const added = after.split('\n').length - before.split('\n').length;
    return {
      job_id: jobId,
      summary:
        before === ''
          ? `New file index.html (${after.split('\n').length} lines).`
          : `index.html changed (${added >= 0 ? '+' : ''}${added} lines).`,
      files: [{ path: 'index.html', before, after, diff }],
      validation,
    };
  }

  /** Copy a validated staging file into a new immutable version. */
  async promote(
    projectId: string,
    jobId: string,
    summary: string,
  ): Promise<{ version: number; previous: number | null }> {
    const validation = await this.validateStaged(projectId, jobId);
    if (!validation.ok) {
      throw new ForgeError(
        'invalid_staged',
        'The staged game failed validation.',
        validation.issues,
      );
    }

    const state = await this.state(projectId);
    const previous = state.current_version;
    const next = state.versions.reduce((max, entry) => Math.max(max, entry.version), 0) + 1;
    const dir = this.within(join(this.projectDir(projectId), 'versions'), String(next));
    await mkdir(dir, { recursive: true });
    await copyFile(
      this.stagingFile(projectId, jobId),
      join(dir, 'index.html'),
      fsConstants.COPYFILE_EXCL,
    );

    const version = ForgeVersionSchema.parse({
      version: next,
      created_at: new Date().toISOString(),
      summary: summary.slice(0, 500),
    });
    await this.writeState(projectId, {
      current: next,
      versions: [...state.versions, version],
    });
    return { version: next, previous };
  }

  async rollback(projectId: string): Promise<{ version: number; previous: number }> {
    const state = await this.state(projectId);
    if (state.current_version === null) {
      throw new ForgeError('no_current_version', 'There is no approved version to roll back from.');
    }
    const index = state.versions.findIndex((entry) => entry.version === state.current_version);
    if (index <= 0) {
      throw new ForgeError('nothing_to_rollback', 'There is no earlier version to restore.');
    }
    const target = state.versions[index - 1];
    if (!target)
      throw new ForgeError('nothing_to_rollback', 'There is no earlier version to restore.');
    await this.writeState(projectId, { current: target.version, versions: state.versions });
    return { version: target.version, previous: state.current_version };
  }

  private versionFile(projectId: string, version: number): string {
    return this.within(join(this.projectDir(projectId), 'versions'), String(version), 'index.html');
  }

  private async writeState(
    projectId: string,
    input: { current: number | null; versions: unknown[] },
  ): Promise<void> {
    const dir = this.projectDir(projectId);
    await mkdir(dir, { recursive: true });
    const parsed = ForgeStateSchema.parse({
      project_id: projectId,
      current_version: input.current,
      versions: input.versions,
      can_rollback: false,
    });
    const payload = JSON.stringify(
      { current_version: parsed.current_version, versions: parsed.versions },
      null,
      2,
    );
    const temp = join(dir, `.state-${process.pid}-${Date.now()}.tmp`);
    await writeFile(temp, `${payload}\n`, 'utf8');
    await rename(temp, join(dir, 'state.json'));
  }

  private within(base: string, ...parts: string[]): string {
    const target = resolve(base, ...parts);
    const rel = relative(base, target);
    if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
      throw new ForgeError('path_escape', 'Resolved path escapes the workspace.');
    }
    return target;
  }

  private assertJobId(jobId: string): void {
    if (!JOB_ID_PATTERN.test(jobId)) throw new ForgeError('invalid_job_id', 'Invalid job id.');
  }
}

export function extractInlineScripts(html: string): string[] {
  const scripts: string[] = [];
  const pattern = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null = pattern.exec(html);
  while (match) {
    if (match[1] && match[1].trim().length > 0) scripts.push(match[1]);
    match = pattern.exec(html);
  }
  return scripts;
}

/**
 * Compact review diff: common prefix/suffix around the changed block. Enough to
 * review a single generated file without pulling in a diff dependency.
 */
export function unifiedDiff(before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const contextStart = Math.max(0, start - 3);
  const contextEndA = Math.min(a.length, endA + 3);
  const removed = a.slice(start, endA).map((line) => `-${line}`);
  const added = b.slice(start, endB).map((line) => `+${line}`);
  const contextBefore = a.slice(contextStart, start).map((line) => ` ${line}`);
  const contextAfter = a.slice(endA, contextEndA).map((line) => ` ${line}`);
  const lines = [
    '--- a/index.html',
    '+++ b/index.html',
    `@@ -${contextStart + 1},${contextEndA - contextStart} +${contextStart + 1},${Math.min(b.length, endB + 3) - contextStart} @@`,
    ...contextBefore,
    ...removed,
    ...added,
    ...contextAfter,
  ];
  const text = lines.join('\n');
  return text.length > 40_000 ? `${text.slice(0, 40_000)}\n… diff truncated` : text;
}
