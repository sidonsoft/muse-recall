import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  FORGE_PROJECT_ID_PATTERN,
  type ForgeApprovalVerification,
  type ForgeDiff,
  type ForgeState,
  ForgeStateSchema,
  type ForgeValidation,
  type ForgeVersion,
  ForgeVersionSchema,
} from '@mml/shared';
import { ensurePrivateDirectory, isMissingFile } from './fs-utils.js';

/**
 * The only code allowed to touch generated application files.
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
  | 'invalid_screenshot'
  | 'invalid_job_state'
  | 'version_conflict'
  | 'version_corrupt'
  | 'unsafe_file'
  | 'too_many_jobs'
  | 'runtime_failed'
  | 'nothing_to_rollback'
  | 'no_current_version'
  | 'staged_changed'
  | 'state_corrupt'
  | 'persistence_failed'
  | 'shutting_down'
  | 'decision_required';

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
/**
 * Bound the work a generated document can request from `node --check`.
 *
 * Each inline script costs one child process. Generated applications need a
 * handful; these caps stop a hostile or runaway document from spawning an
 * unbounded number of syntax checks while the server awaits them.
 */
export const MAX_INLINE_SCRIPTS = 32;
export const MAX_INLINE_SCRIPT_BYTES = 500_000;
const INLINE_SCRIPT_CHECK_TIMEOUT_MS = 10_000;

/**
 * Resolve the version a rollback should restore.
 *
 * `base_version` is the only trustworthy ancestry edge. Versions are appended
 * in creation order, so array adjacency is *not* ancestry: approving v3 from
 * v1 leaves v2 between them in the array, and undoing v3 must restore v1, not
 * v2. A recorded parent wins whenever it names a genuinely older version that
 * still exists.
 *
 * Legacy state files may predate `base_version`, or carry a parent that no
 * longer resolves. Those keep the historical behaviour (the immediately
 * preceding entry) as a bounded fallback, guarded so the target is always
 * older than the current version. Missing parents never invent a new version.
 */
export function rollbackTarget(state: ForgeState): ForgeVersion | null {
  if (state.current_version === null) return null;
  const index = state.versions.findIndex((entry) => entry.version === state.current_version);
  if (index < 0) return null;
  const current = state.versions[index];
  if (!current) return null;

  const byVersion = new Map(state.versions.map((entry) => [entry.version, entry]));
  const base = current.base_version;
  if (typeof base === 'number' && base < current.version) {
    const recorded = byVersion.get(base);
    if (recorded) return recorded;
  }

  const previous = index > 0 ? state.versions[index - 1] : undefined;
  if (previous && previous.version < current.version) return previous;
  return null;
}

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
    // Only a genuinely missing state file is initialised. A present file is
    // validated through the same path used by `state()`; malformed content is
    // left byte-for-byte intact so it can be repaired or inspected.
    const found = await this.readStateFile(projectId);
    if (found.kind === 'missing') {
      // Version and job records without their state file mean a previous
      // write was lost. Writing empty state would orphan those records and
      // present a false empty project, so refuse until it is restored.
      await this.assertNoOrphanedContent(projectId);
      await this.createProjectDirs(dir);
      await this.writeState(projectId, { current: null, versions: [] });
      return;
    }
    await this.createProjectDirs(dir);
    this.parseState(projectId, found.raw);
  }

  async state(projectId: string): Promise<ForgeState> {
    const found = await this.readStateFile(projectId);
    if (found.kind === 'missing') {
      // Reads are side-effect free, but they must not hide records that a
      // missing state file no longer points at.
      await this.assertNoOrphanedContent(projectId);
      return { project_id: projectId, current_version: null, versions: [], can_rollback: false };
    }
    return this.parseState(projectId, found.raw);
  }

  private async createProjectDirs(dir: string): Promise<void> {
    await ensurePrivateDirectory(this.root);
    await ensurePrivateDirectory(dir);
    await ensurePrivateDirectory(join(dir, 'versions'));
    await ensurePrivateDirectory(join(dir, 'staging'));
    await ensurePrivateDirectory(join(dir, 'jobs'));
  }

  /**
   * A missing state file is only a new project when no approved version data
   * survives. Version directories are the only data empty state would orphan;
   * job records stay on disk and are recovered normally after initialisation.
   */
  private async assertNoOrphanedContent(projectId: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(join(this.projectDir(projectId), 'versions'));
    } catch (error) {
      if (isMissingFile(error)) return;
      throw new ForgeError(
        'state_corrupt',
        'The Forge versions directory could not be read. Restore it before continuing.',
      );
    }
    // Temporary promotion copies and moved-aside interrupted promotions are
    // non-numeric, dot-prefixed entries; they are not approved version data.
    const versions = entries.filter((entry) => /^\d+$/.test(entry));
    if (versions.length === 0) return;
    throw new ForgeError(
      'state_corrupt',
      'The Forge state file is missing while approved version data remains. Restore or repair state.json before continuing.',
      [`Found versions/${versions.sort().join(', versions/')} without state.json.`],
    );
  }

  /**
   * Shared validation path for a present state file.
   *
   * JSON `null` and arrays are explicitly rejected: spreading `null` would
   * otherwise produce an empty state object and make a corrupt file look like
   * a fresh project.
   */
  private parseState(projectId: string, raw: unknown): ForgeState {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new ForgeError(
        'state_corrupt',
        'The Forge state file is not a state object. Restore or repair state.json before continuing.',
      );
    }
    try {
      const state = ForgeStateSchema.parse({
        can_rollback: false,
        ...raw,
        project_id: projectId,
      });
      const versions = new Set<number>();
      for (const entry of state.versions) {
        if (versions.has(entry.version)) {
          throw new Error(`duplicate version v${entry.version}`);
        }
        versions.add(entry.version);
      }
      if (state.current_version !== null && !versions.has(state.current_version)) {
        throw new Error(`current_version v${state.current_version} is not in versions`);
      }
      return {
        ...state,
        project_id: projectId,
        can_rollback: rollbackTarget(state) !== null,
      };
    } catch (error) {
      if (error instanceof ForgeError) throw error;
      throw new ForgeError(
        'state_corrupt',
        'The Forge state file is malformed. Restore or repair state.json before reviewing this project.',
      );
    }
  }

  /**
   * Read the state file with a distinct missing-file sentinel.
   *
   * `null` cannot be the sentinel because JSON.parse("null") is a valid
   * (but invalid state) document. Missing is structural; the caller decides
   * whether to initialise it.
   */
  private async readStateFile(
    projectId: string,
  ): Promise<{ kind: 'missing' } | { kind: 'present'; raw: unknown }> {
    let raw: string;
    try {
      raw = await readFile(join(this.projectDir(projectId), 'state.json'), 'utf8');
    } catch (error) {
      if (isMissingFile(error)) return { kind: 'missing' };
      throw new ForgeError(
        'state_corrupt',
        'The Forge state file could not be read. Restore it before continuing.',
      );
    }
    try {
      return { kind: 'present', raw: JSON.parse(raw) as unknown };
    } catch {
      throw new ForgeError(
        'state_corrupt',
        'The Forge state file is not valid JSON. Restore or repair state.json before continuing.',
      );
    }
  }

  async currentHtml(projectId: string): Promise<string | null> {
    const state = await this.state(projectId);
    if (state.current_version === null) return null;
    const entry = state.versions.find((version) => version.version === state.current_version);
    const file = this.versionFile(projectId, state.current_version);
    try {
      await lstat(file);
    } catch {
      return null;
    }
    const bytes = await this.readContainedBuffer(projectId, file);
    if (entry) this.assertVersionHash(entry, bytes);
    return bytes.toString('utf8');
  }

  /** Refuse a version file whose bytes no longer match its recorded hash. */
  private assertVersionHash(entry: ForgeVersion, bytes: Buffer): void {
    if (!entry.sha256) return;
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== entry.sha256) {
      throw new ForgeError(
        'version_corrupt',
        `v${entry.version} no longer matches its recorded hash.`,
      );
    }
  }

  /** Read a recorded version and verify it before using it as a base. */
  private async requireVersionIntegrity(projectId: string, entry: ForgeVersion): Promise<void> {
    if (!entry.sha256) return;
    let bytes: Buffer;
    try {
      bytes = await this.readContainedBuffer(projectId, this.versionFile(projectId, entry.version));
    } catch (error) {
      if (error instanceof ForgeError) throw error;
      if (isMissingFile(error)) {
        throw new ForgeError('version_corrupt', `v${entry.version} is missing from the workspace.`);
      }
      throw error;
    }
    this.assertVersionHash(entry, bytes);
  }

  async createStaging(projectId: string, jobId: string): Promise<string> {
    this.assertJobId(jobId);
    const dir = this.within(join(this.projectDir(projectId), 'staging'), jobId);
    await rm(dir, { recursive: true, force: true });
    await ensurePrivateDirectory(dir);
    return dir;
  }

  stagingFile(projectId: string, jobId: string): string {
    this.assertJobId(jobId);
    return this.within(join(this.projectDir(projectId), 'staging'), jobId, 'index.html');
  }

  async stagedHtml(projectId: string, jobId: string): Promise<string | null> {
    const file = this.stagingFile(projectId, jobId);
    try {
      await lstat(file);
    } catch {
      return null;
    }
    // Preview and diff never read a symlink, even before validation runs.
    return this.readContained(projectId, file);
  }

  /**
   * Read the staged bytes once, together with their sha256.
   *
   * Runtime verification and promotion share this snapshot: the promoted file
   * must be the exact byte sequence that passed the browser check, not whatever
   * happens to be on disk when approval completes.
   */
  async stagedSnapshot(
    projectId: string,
    jobId: string,
  ): Promise<{ html: string; sha256: string } | null> {
    const file = this.stagingFile(projectId, jobId);
    try {
      await lstat(file);
    } catch {
      return null;
    }
    const bytes = await this.readContainedBuffer(projectId, file);
    return {
      html: bytes.toString('utf8'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
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
    // Games keep the Phaser contract they were built with. Phaser may create its
    // canvas at runtime, so accept either a canvas element or an explicit
    // Phaser.Game initialisation. Every other request is a general browser
    // application: require a real document body with renderable content, so an
    // empty shell cannot pass validation.
    const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? '';
    if (/phaser/i.test(html)) {
      if (!/<canvas[\s>]/i.test(html) && !/new\s+Phaser\.Game|Phaser\.AUTO/i.test(html)) {
        issues.push(
          'Phaser is referenced but no <canvas> or Phaser.Game initialisation was found.',
        );
      }
    } else if (!/<body[\s>]/i.test(html)) {
      issues.push('No <body> element found.');
    } else {
      const visibleText = body
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .trim();
      const hasElement =
        /<(main|section|div|canvas|svg|form|table|ul|ol|button|input|h1|h2|p)\b/i.test(body);
      if (visibleText.length === 0 && !hasElement) {
        issues.push('No renderable application content found in <body>.');
      }
    }

    const scripts = extractInlineScripts(html);
    const scriptBytes = scripts.reduce((total, script) => total + Buffer.byteLength(script), 0);
    if (scripts.length > MAX_INLINE_SCRIPTS) {
      issues.push(
        `Too many inline scripts: ${String(scripts.length)} exceeds the limit of ${String(
          MAX_INLINE_SCRIPTS,
        )}.`,
      );
    }
    if (scriptBytes > MAX_INLINE_SCRIPT_BYTES) {
      issues.push(
        `Inline script source is ${String(scriptBytes)} bytes, above the ${String(
          MAX_INLINE_SCRIPT_BYTES,
        )}-byte limit.`,
      );
    }
    // Skip the syntax checks when a cap already failed: running them would
    // defeat the bound the cap exists to enforce.
    if (scripts.length <= MAX_INLINE_SCRIPTS && scriptBytes <= MAX_INLINE_SCRIPT_BYTES) {
      for (const script of scripts) {
        const check = await checkInlineScript(script);
        if (!check.ok) {
          issues.push(`Inline script failed syntax check: ${check.stderr.slice(0, 300)}`);
        }
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
      // The manager attaches the job's advisory snapshot; the workspace never
      // evaluates decisions and never lets one influence validation.
      decision_guard: null,
    };
  }

  /** Copy a validated staging file into a new immutable version. */
  async promote(
    projectId: string,
    jobId: string,
    summary: string,
    options: {
      baseVersion: number | null;
      jobId: string;
      /** sha256 of the bytes that passed runtime verification, when known. */
      expectedSha256?: string;
      /** Approval-time checks to record with this immutable version. */
      verification?: ForgeApprovalVerification;
    },
  ): Promise<{
    version: number;
    previous: number | null;
    sha256: string;
    note: string | null;
  }> {
    const validation = await this.validateStaged(projectId, jobId);
    if (!validation.ok) {
      throw new ForgeError(
        'invalid_staged',
        'The staged application failed validation.',
        validation.issues,
      );
    }

    const state = await this.state(projectId);
    const previous = state.current_version;
    if (previous !== options.baseVersion) {
      throw new ForgeError(
        'version_conflict',
        `The approved application moved to v${String(previous)} while this change was staged.`,
      );
    }
    if (previous !== null) {
      // A promotion builds on the approved file. Never promote over a version
      // whose bytes no longer match its recorded hash.
      const current = state.versions.find((entry) => entry.version === previous);
      if (current) await this.requireVersionIntegrity(projectId, current);
    }

    const staged = await this.readContainedBuffer(projectId, this.stagingFile(projectId, jobId));
    const sha256 = createHash('sha256').update(staged).digest('hex');
    // Bind promotion to the exact bytes runtime verification approved. Without
    // this, a staging rewrite between the browser check and approval would be
    // promoted under a verification result that never saw it.
    if (options.expectedSha256 !== undefined && options.expectedSha256 !== sha256) {
      throw new ForgeError(
        'staged_changed',
        'The staged source changed after runtime verification. Request the change again.',
      );
    }
    const next = state.versions.reduce((max, entry) => Math.max(max, entry.version), 0) + 1;
    const versionsDir = this.within(this.projectDir(projectId), 'versions');
    const dir = this.within(versionsDir, String(next));
    const temp = this.within(versionsDir, `.promote-${process.pid}-${randomUUID()}`);
    await ensurePrivateDirectory(versionsDir);
    let note: string | null = null;
    // Stage the immutable copy in a temporary directory and rename it into
    // place. A crash before the rename leaves no version directory. A crash
    // after it leaves a directory state never referenced, which the next retry
    // moves aside instead of failing on COPYFILE_EXCL forever.
    try {
      // Owner-only from creation; the rename keeps the mode on the version dir.
      await mkdir(temp, { mode: 0o700 });
      await copyFile(
        this.stagingFile(projectId, jobId),
        join(temp, 'index.html'),
        fsConstants.COPYFILE_EXCL,
      );

      const written = await readFile(join(temp, 'index.html'));
      if (createHash('sha256').update(written).digest('hex') !== sha256) {
        throw new ForgeError(
          'version_corrupt',
          'The promoted file did not match the staged bytes.',
        );
      }

      // State is not proof that older version bytes are absent, so never delete
      // a version directory. Only the destination can block this rename; move
      // an existing one to a non-numeric name so the bytes remain recoverable.
      let destinationExists = false;
      try {
        await lstat(dir);
        destinationExists = true;
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
      if (destinationExists) {
        const stamp = new Date().toISOString().replaceAll(':', '-');
        const asideName = `.orphaned-${next}-${stamp}-${randomUUID().slice(0, 8)}`;
        await rename(dir, this.within(versionsDir, asideName));
        note = `Moved an interrupted promotion directory for v${next} aside to versions/${asideName}; no version data was deleted.`;
      }
      await rename(temp, dir);
    } catch (error) {
      await rm(temp, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    const version = ForgeVersionSchema.parse({
      version: next,
      created_at: new Date().toISOString(),
      summary: summary.slice(0, 500),
      base_version: options.baseVersion,
      job_id: options.jobId,
      sha256,
      ...(options.verification ? { approval_verification: options.verification } : {}),
    });
    await this.writeState(projectId, {
      current: next,
      versions: [...state.versions, version],
    });
    // The staged copy has been promoted; do not keep a second writable copy.
    await rm(this.within(join(this.projectDir(projectId), 'staging'), jobId), {
      recursive: true,
      force: true,
    });
    return { version: next, previous, sha256, note };
  }

  async rollback(projectId: string): Promise<{ version: number; previous: number }> {
    const state = await this.state(projectId);
    if (state.current_version === null) {
      throw new ForgeError('no_current_version', 'There is no approved version to roll back from.');
    }
    const target = rollbackTarget(state);
    if (!target)
      throw new ForgeError('nothing_to_rollback', 'There is no earlier version to restore.');

    // Never restore bytes that no longer match the recorded hash.
    await this.requireVersionIntegrity(projectId, target);

    await this.writeState(projectId, { current: target.version, versions: state.versions });
    return { version: target.version, previous: state.current_version };
  }

  /** Read a file only if it is a regular file contained by the project. */
  private async readContained(projectId: string, file: string): Promise<string> {
    return (await this.readContainedBuffer(projectId, file)).toString('utf8');
  }

  private async readContainedBuffer(projectId: string, file: string): Promise<Buffer> {
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new ForgeError('unsafe_file', 'Refusing to read a symlink or non-regular file.');
    }
    const projectDir = this.projectDir(projectId);
    const [realFile, realProject] = await Promise.all([realpath(file), realpath(projectDir)]);
    if (!realFile.startsWith(realProject + sep)) {
      throw new ForgeError('unsafe_file', 'Resolved file escapes the project workspace.');
    }
    return readFile(file);
  }

  private versionFile(projectId: string, version: number): string {
    return this.within(join(this.projectDir(projectId), 'versions'), String(version), 'index.html');
  }

  private async writeState(
    projectId: string,
    input: { current: number | null; versions: unknown[] },
  ): Promise<void> {
    const dir = this.projectDir(projectId);
    await ensurePrivateDirectory(dir);
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
    const temp = join(dir, `.state-${process.pid}-${randomUUID()}.tmp`);
    await writeFile(temp, `${payload}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
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
 * Syntax-check one inline script without blocking the event loop.
 *
 * Same pass/fail contract as `spawnSync`: exit status 0 passes, anything else
 * reports stderr. A timeout or spawn failure is a failed check, never a throw.
 */
function checkInlineScript(script: string): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--check', '-'], {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: { ok: boolean; stderr: string }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, INLINE_SCRIPT_CHECK_TIMEOUT_MS);
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 4_000) stderr += chunk;
    });
    child.on('error', (error) => {
      finish({ ok: false, stderr: error.message });
    });
    child.on('close', (code) => {
      finish({
        ok: code === 0 && !timedOut,
        stderr: timedOut
          ? `syntax check timed out after ${String(INLINE_SCRIPT_CHECK_TIMEOUT_MS)} ms`
          : stderr,
      });
    });
    // A timed-out child closes stdin before it is killed; that is expected.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(script);
  });
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
