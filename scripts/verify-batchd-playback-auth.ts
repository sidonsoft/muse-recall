/**
 * Batch D — token-gated source playback, verified in a real browser against
 * the production builds with NO provider involvement.
 *
 * The bug: `<audio src>`/`<video src>`/download `href` pointing straight at
 * `/api/forge/projects/:id/media/sources/:sourceId/bytes` cannot send the
 * bearer header, so under ACCESS_TOKEN every clip failed with 401 in the UI.
 *
 * What this proves:
 * 1. Secured mode (ACCESS_TOKEN set, token stored in the browser): playback
 *    renders from a `blob:` URL, zero 4xx responses, zero console errors.
 * 2. Download works from the same authenticated bytes: the browser reports a
 *    download whose URL carries no credential and whose name is the source id.
 * 3. Tokenless loopback mode behaves exactly as before: playback works with no
 *    stored token and no auth header.
 * 4. No credential ever appears in a request URL, and no media/provider
 *    dispatch happens at all (echo provider, coding CLI disabled).
 *
 * Everything runs offline: temp database and workspace, seeded by uploading a
 * generated WAV through the API, loopback only.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, ConsoleMessage, Download, Page, Response } from 'playwright-core';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';
import { verifyBuildProvenance } from './lib/build-provenance.js';

const ROOT = process.cwd();
const TOKEN = 'browser-check-shared-secret-1234567890';
const STAMP = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
const EVIDENCE = join(ROOT, 'test-results', 'batchd-playback-auth', STAMP);

const checks: string[] = [];
const observations: Record<string, unknown> = {};
let evidenceWritten = false;

function check(label: string): void {
  checks.push(label);
  console.log(`  ✓ ${label}`);
}
function fail(message: string): never {
  throw new Error(`batchd playback-auth verification failed: ${message}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function freePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no free port'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > timeoutMs) fail(`server did not become ready: ${url}`);
    await sleep(250);
  }
}
function start(
  name: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  log: string,
): ChildProcess {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const sink = (data: Buffer): void => {
    try {
      writeFileSync(log, data, { flag: 'a' });
    } catch {
      /* best effort */
    }
  };
  child.stdout?.on('data', sink);
  child.stderr?.on('data', sink);
  child.on('exit', (code) => sink(Buffer.from(`\n[${name}] exit ${String(code)}\n`)));
  return child;
}
async function stop(child: ChildProcess | null): Promise<void> {
  if (child === null) return;
  child.kill('SIGTERM');
  await sleep(800);
  if (child.exitCode === null) child.kill('SIGKILL');
}

/** Mono 16-bit PCM WAV at 24 kHz, long enough to pass server-side probing. */
function wavBytes(samples = 2_400): Buffer {
  const data = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    data.writeInt16LE(index % 2 === 0 ? 1_000 : -1_000, index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24_000, 24);
  header.writeUInt32LE(48_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

interface RunResult {
  sourceId: string;
  elementTag: string;
  elementSrc: string;
  httpFailures: string[];
  consoleErrors: string[];
  credentialInUrl: string[];
  downloads: Array<{ url: string; suggestedFilename: string }>;
  bytesReturned: number;
}

async function upload(api: string, projectId: string, bearer: string | null): Promise<string> {
  const response = await fetch(`${api}/api/forge/projects/${projectId}/media/sources`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify({
      mime: 'audio/wav',
      data_base64: wavBytes().toString('base64'),
      origin: 'upload',
      original_name: 'note.wav',
    }),
  });
  const body = (await response.json()) as {
    ok: boolean;
    data?: { source_id: string };
    error?: { code: string; message: string };
  };
  if (!response.ok || body.data === undefined) {
    fail(
      `upload to ${projectId} failed: HTTP ${String(response.status)} ${JSON.stringify(body.error ?? null)}`,
    );
  }
  return body.data.source_id;
}

async function exerciseStudio(options: {
  webBase: string;
  apiBase: string;
  projectId: string;
  sourceId: string;
  storedToken: string | null;
  browser: Browser;
}): Promise<RunResult> {
  const { webBase, projectId, sourceId, storedToken } = options;
  const context = await options.browser.newContext({ viewport: { width: 1400, height: 950 } });
  if (storedToken !== null) {
    await context.addInitScript(
      `localStorage.setItem('mml.access_token', ${JSON.stringify(storedToken)});`,
    );
  }
  const page: Page = await context.newPage();
  const consoleErrors: string[] = [];
  const httpFailures: string[] = [];
  const credentialInUrl: string[] = [];
  const downloads: Array<{ url: string; suggestedFilename: string }> = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.toLowerCase().includes('favicon')) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (error: Error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('response', (response: Response) => {
    if (response.status() < 400) return;
    httpFailures.push(`HTTP ${String(response.status())} ${response.url()}`);
  });
  page.on('request', (request) => {
    // A credential in a URL would leak into history, logs, and Referer.
    if (request.url().includes('browser-check-shared-secret')) credentialInUrl.push(request.url());
  });
  page.on('download', (download: Download) => {
    downloads.push({
      url: download.url(),
      suggestedFilename: download.suggestedFilename(),
    });
  });

  await page.goto(webBase, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.getByRole('button', { name: 'HTML Studio', exact: true }).waitFor({ timeout: 20_000 });
  await page.locator('button[title^="Project:"]').click();
  const dialog = page.getByRole('dialog', { name: 'Switch project' });
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.getByLabel('Project id').fill(projectId);
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  // The panel auto-selects the first source on load, which triggers the
  // authenticated byte fetch; the element may only exist once it resolves.
  try {
    await page.locator('audio, video').first().waitFor({ timeout: 15_000 });
  } catch {
    await page
      .screenshot({ path: join(EVIDENCE, `no-media-${projectId}.png`), fullPage: true })
      .catch(() => undefined);
    fail(
      `no media element for project ${projectId}; console: ${consoleErrors.join(' | ').slice(0, 400) || '(none)'}; failures: ${httpFailures.join(' | ').slice(0, 400) || '(none)'}`,
    );
  }
  const element = page.locator('audio, video').first();
  // Tag name comes from the locator itself: this script typechecks without a
  // DOM lib, so reading node properties directly is not available here.
  const elementTag = (await page.locator('audio').count()) > 0 ? 'audio' : 'video';
  const elementSrc = (await element.getAttribute('src')) ?? '';
  // Show the player in the evidence: the panel continues below the fold.
  await element.scrollIntoViewIfNeeded().catch(() => undefined);
  await page.screenshot({ path: join(EVIDENCE, `playback-${projectId}.png`), fullPage: true });

  // Bytes are reachable for playback: the blob URL resolves in-page.
  const bytesReturned = await page.evaluate(async (url: string) => {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    return buffer.byteLength;
  }, elementSrc);

  const downloadButton = page.getByRole('button', { name: /^Download (WAV|MP4)$/ });
  await downloadButton.waitFor({ timeout: 10_000 });
  await downloadButton.click();
  await sleep(600);
  await page.screenshot({ path: join(EVIDENCE, `download-${projectId}.png`), fullPage: true });
  await context.close();
  return {
    sourceId,
    elementTag,
    elementSrc,
    httpFailures,
    consoleErrors,
    credentialInUrl,
    downloads,
    bytesReturned,
  };
}

function writeEvidence(): void {
  if (evidenceWritten) return;
  evidenceWritten = true;
  mkdirSync(EVIDENCE, { recursive: true });
  const report = {
    kind: 'Batch D token-gated source playback (production builds, offline, no provider)',
    status: checks.length > 0 ? 'live browser results' : 'no checks completed',
    generated_at: new Date().toISOString(),
    calls: { vision: 0, sam: 0, coding: 0, imageGeneration: 0, transcription: 0, clip: 0 },
    scope: 'offline-browser',
    checks,
    observations,
  };
  writeFileSync(join(EVIDENCE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nevidence: ${EVIDENCE}`);
}

async function main(): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true });
  const provenance = verifyBuildProvenance({ root: ROOT });
  observations.buildProvenance = {
    commit: provenance.commit,
    treeClean: provenance.treeClean,
    serverBuildHash: provenance.server.buildHash,
    webBuildHash: provenance.web.buildHash,
  };
  check(
    `production builds match the tested source (server ${provenance.server.buildHash.slice(0, 12)}…, web ${provenance.web.buildHash.slice(0, 12)}…)`,
  );

  const launched = await launchVerificationBrowser();
  const browser: Browser = launched.browser;
  reportBrowserSelection(launched.selection);
  const wav = wavBytes();

  const servers: ChildProcess[] = [];
  const runs: Record<string, RunResult> = {};
  const dataDirs: string[] = [];
  try {
    for (const mode of ['secured', 'tokenless'] as const) {
      const dataRoot = mkdtempSync(join(tmpdir(), `batchd-playback-${mode}-`));
      dataDirs.push(dataRoot);
      const serverPort = await freePort();
      const webPort = await freePort();
      const apiBase = `http://127.0.0.1:${serverPort}`;
      const webBase = `http://127.0.0.1:${webPort}`;
      const serverLog = join(EVIDENCE, `server-${mode}.log`);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(serverPort),
        DATABASE_PATH: join(dataRoot, 'memory.db'),
        WORKSPACE_ROOT: join(dataRoot, 'workspaces'),
        CORS_ORIGINS: webBase,
        MODEL_PROVIDER: 'echo',
        MUSE_BIN: '/bin/false',
        FORGE_MUSE_BIN: '/bin/false',
        FORGE_MEDIA_TRACE: '1',
        LOG_LEVEL: 'warn',
        ...(mode === 'secured' ? { ACCESS_TOKEN: TOKEN } : {}),
      };
      delete env.FORGE_MUSE_API_KEY;
      delete env.FORGE_FALLBACK_API_KEY;
      const server = start(
        'api',
        process.execPath,
        [join(ROOT, 'apps/server/dist/index.js')],
        ROOT,
        env,
        serverLog,
      );
      servers.push(server);
      await waitForHttp(`${apiBase}/api/health`);
      // /api/meta is a gated route in secured mode, so the probe must present
      // the token the same way the browser client does.
      const metaResponse = await fetch(`${apiBase}/api/meta`, {
        ...(mode === 'secured' ? { headers: { authorization: `Bearer ${TOKEN}` } } : {}),
      });
      const meta = (await metaResponse.json()) as {
        data?: { build?: { commit?: string; source_hash?: string } | null };
      };
      const identity = meta.data?.build ?? null;
      if (
        identity === null ||
        identity.commit !== provenance.server.identity?.commit ||
        identity.source_hash !== provenance.server.identity?.source_hash
      ) {
        fail(
          `${mode}: running server identity does not match the verified build: ${JSON.stringify(identity)}`,
        );
      }
      check(
        `${mode}: running server proves the verified build identity (commit ${String(identity.commit).slice(0, 12)})`,
      );

      const projectId = `playback-${mode}`;
      const sourceId = await upload(apiBase, projectId, mode === 'secured' ? TOKEN : null);
      const webLog = join(EVIDENCE, `web-${mode}.log`);
      const web = start(
        'web',
        process.execPath,
        [
          join(ROOT, 'apps/web/node_modules/vite/bin/vite.js'),
          'preview',
          '--host',
          '127.0.0.1',
          '--port',
          String(webPort),
          '--strictPort',
        ],
        join(ROOT, 'apps/web'),
        { ...process.env, VITE_PROXY_TARGET: apiBase },
        webLog,
      );
      servers.push(web);
      await waitForHttp(webBase);

      runs[mode] = await exerciseStudio({
        webBase,
        apiBase,
        projectId,
        sourceId,
        storedToken: mode === 'secured' ? TOKEN : null,
        browser,
      });
      const run = runs[mode] as RunResult;
      observations[mode] = {
        sourceId,
        elementTag: run.elementTag,
        elementSrcScheme: run.elementSrc.split(':')[0] ?? '',
        elementSrcLength: run.elementSrc.length,
        playbackBytes: run.bytesReturned,
        uploads: 1,
        httpFailures: run.httpFailures,
        consoleErrors: run.consoleErrors,
        credentialInUrl: run.credentialInUrl,
        downloads: run.downloads,
      };
      if (!run.elementSrc.startsWith('blob:')) {
        fail(`${mode}: media element src is not a blob URL: ${run.elementSrc.slice(0, 120)}`);
      }
      if (run.bytesReturned !== wav.length) {
        fail(
          `${mode}: playback URL returned ${String(run.bytesReturned)} bytes, expected ${String(wav.length)}`,
        );
      }
      if (run.httpFailures.length > 0)
        fail(`${mode}: HTTP failures observed: ${run.httpFailures.join(' | ').slice(0, 400)}`);
      if (run.consoleErrors.length > 0)
        fail(`${mode}: console errors: ${run.consoleErrors.join(' | ').slice(0, 400)}`);
      if (run.credentialInUrl.length > 0)
        fail(`${mode}: credential appeared in a URL: ${run.credentialInUrl.join(' | ')}`);
      check(
        `${mode}: media element plays from a blob URL (${String(run.bytesReturned)} bytes, ${run.elementTag})`,
      );
      if (run.downloads.length !== 1) {
        fail(`${mode}: expected one browser download, saw ${String(run.downloads.length)}`);
      }
      const download = run.downloads[0] as { url: string; suggestedFilename: string };
      if (!download.url.startsWith('blob:'))
        fail(`${mode}: download URL is not a blob URL: ${download.url.slice(0, 120)}`);
      if (download.suggestedFilename !== `${sourceId}.wav`) {
        fail(`${mode}: download name is ${download.suggestedFilename}, expected ${sourceId}.wav`);
      }
      check(
        `${mode}: download offers ${download.suggestedFilename} from a credential-free blob URL`,
      );

      const trace = readFileSync(serverLog, 'utf8')
        .split('\n')
        .filter((line) => line.includes('[media-trace]'));
      if (trace.length > 0)
        fail(`${mode}: media/provider dispatches observed: ${String(trace.length)}`);
      const tokenLeak = readFileSync(serverLog, 'utf8').includes(TOKEN);
      if (mode === 'secured' && tokenLeak)
        fail(`${mode}: the shared token appeared in the server log`);
      check(`${mode}: zero media/provider dispatches and no credential in logs`);
    }
    observations.wavBytes = wav.length;
    console.log(`\nBatch D playback-auth: PASS (${checks.length} checks)`);
  } finally {
    try {
      writeEvidence();
    } catch (error) {
      console.error(
        `evidence write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const server of servers.splice(0).reverse()) await stop(server);
    await browser.close().catch(() => undefined);
    for (const dir of dataDirs) rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  observations.error = error instanceof Error ? error.message : String(error);
  evidenceWritten = false;
  try {
    writeEvidence();
  } catch {
    /* evidence is best effort on failure */
  }
  process.exitCode = 1;
});
