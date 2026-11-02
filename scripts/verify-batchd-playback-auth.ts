/**
 * Batch D — token-gated source playback for BOTH media kinds, verified in a
 * real browser against the production builds with NO provider involvement.
 *
 * The bug: `<audio src>`/`<video src>`/download `href` pointing straight at
 * `/api/forge/projects/:id/media/sources/:sourceId/bytes` cannot send the
 * bearer header, so under ACCESS_TOKEN every clip failed with 401 in the UI.
 *
 * What this proves, in secured mode (ACCESS_TOKEN + token in browser
 * localStorage) and again in tokenless loopback mode:
 * 1. The running server is the build the provenance gate verified.
 * 2. Byte route posture: a bare byte URL gets 401 `unauthorized` in secured
 *    mode (200 when no token is configured), and a bearer-bearing fetch returns
 *    the exact uploaded bytes with the media content type.
 * 3. Upload of a real WAV and a real, ffmpeg-encoded H.264 MP4 (a genuine
 *    video track, ffprobe-checked); the server-recorded sha256 matches the
 *    bytes the gate generated.
 * 4. Playback renders from a `blob:` URL for BOTH `<audio>` and `<video>`, and
 *    the bytes behind that blob hash to the uploaded source sha256.
 * 5. The `<video>` element actually decodes: intrinsic size, duration,
 *    readyState, advancing currentTime, and a canvas read-back of the current
 *    frame with multiple distinct colours (a decoded frame, not a black box).
 * 6. The browser's own byte requests carry `Authorization: Bearer …` in
 *    secured mode and no auth header when no token is configured.
 * 7. Download works from the same authenticated bytes: one browser download per
 *    source, named `<source_id>.wav` / `<source_id>.mp4`, from a URL that
 *    carries no credential; the previous source's blob URL is revoked when the
 *    selection changes.
 * 8. Zero HTTP failures, zero console errors, zero credential-in-URL, zero
 *    media/provider dispatches, and no token in the server log.
 *
 * Fixtures are generated in-script and kept small: a 2 400-sample mono WAV and
 * a 1-second 64×64 baseline H.264 MP4 (~2 KB) produced by local ffmpeg, so the
 * run stays offline and does not depend on the 12 MB demo videos. Override the
 * video fixture with BATCHD_VIDEO_MP4=/path/to/clip.mp4 if ffmpeg is absent;
 * either way ffprobe must report a real video track.
 *
 * Everything runs offline: temp database and workspace, loopback only, echo
 * provider, coding CLI pinned to /bin/false, no provider keys.
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, ConsoleMessage, Download, Page, Response } from 'playwright-core';
import {
  MEDIA_VIDEO_MAX_BYTES,
  MEDIA_VIDEO_MAX_DURATION_MS,
} from '../packages/shared/src/media.js';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';
import { describeBundleIdentity, verifyBuildProvenance } from './lib/build-provenance.js';

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
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
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

interface VideoFixture {
  bytes: Buffer;
  sha256: string;
  probe: Record<string, string>;
  origin: 'ffmpeg' | 'BATCHD_VIDEO_MP4';
  recipe: string[];
}

/**
 * A genuinely valid short MP4: one 1-second 64×64 baseline H.264 video track,
 * encoded locally by ffmpeg (never the 12 MB demo videos). `ffprobe` must
 * report a real `video` stream with the expected frame size and a duration
 * inside the product bound, so an empty container or an audio-only MP4 cannot
 * quietly become the fixture.
 */
function videoFixture(): VideoFixture {
  const override = process.env.BATCHD_VIDEO_MP4 ?? '';
  let source = '';
  let recipe: string[] = [];
  let origin: VideoFixture['origin'] = 'ffmpeg';
  if (override !== '') {
    if (statSync(override, { throwIfNoEntry: false }) === undefined) {
      fail(`BATCHD_VIDEO_MP4 points at a missing file: ${override}`);
    }
    source = override;
    origin = 'BATCHD_VIDEO_MP4';
    recipe = ['(fixture supplied through BATCHD_VIDEO_MP4)'];
  } else {
    const out = join(EVIDENCE, 'fixture-clip.mp4');
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=64x64:rate=10:duration=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'baseline',
      '-level',
      '3.0',
      '-movflags',
      '+faststart',
      '-an',
      '-fflags',
      '+bitexact',
      '-y',
      out,
    ];
    try {
      execFileSync('ffmpeg', args, { stdio: 'pipe' });
    } catch (error) {
      // execFileSync attaches the child's stderr to the error it throws, which
      // the Error type does not declare; read it structurally rather than cast.
      const attached =
        error && typeof error === 'object' && 'stderr' in error
          ? Buffer.isBuffer(error.stderr)
            ? error.stderr.toString('utf8')
            : typeof error.stderr === 'string'
              ? error.stderr
              : ''
          : '';
      const detail = error instanceof Error ? `${error.message} ${attached}` : String(error);
      fail(
        `cannot build the video fixture with local ffmpeg (offline; install ffmpeg or set BATCHD_VIDEO_MP4): ${detail.slice(0, 300)}`,
      );
    }
    source = out;
    recipe = args;
  }
  const bytes = readFileSync(source);
  if (bytes.length === 0) fail('the video fixture is empty');
  if (bytes.length > MEDIA_VIDEO_MAX_BYTES) {
    fail(`the video fixture is ${String(bytes.length)} bytes, above the product bound`);
  }
  const probeText = (() => {
    try {
      return execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,codec_name,width,height,nb_frames:format=duration,format_name',
          '-of',
          'default=noprint_wrappers=1',
          source,
        ],
        { encoding: 'utf8' },
      );
    } catch (error) {
      fail(
        `cannot inspect the video fixture with ffprobe (install ffmpeg or set BATCHD_VIDEO_MP4): ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`,
      );
    }
  })();
  const probe: Record<string, string> = {};
  for (const line of probeText.split('\n')) {
    const [key, value] = line.split('=');
    if (key !== undefined && value !== undefined) probe[key.trim()] = value.trim();
  }
  if (probe.codec_type !== 'video') {
    fail(`the video fixture has no video track: ${JSON.stringify(probe)}`);
  }
  if (probe.codec_name === undefined || probe.width !== '64' || probe.height !== '64') {
    fail(`unexpected video stream in the fixture: ${JSON.stringify(probe)}`);
  }
  const durationMs = Number(probe.duration ?? Number.NaN);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    fail(`the video fixture has no measurable duration: ${JSON.stringify(probe)}`);
  }
  if (durationMs * 1_000 > MEDIA_VIDEO_MAX_DURATION_MS) {
    fail(
      `the video fixture is ${String(durationMs)}s, above the ${String(MEDIA_VIDEO_MAX_DURATION_MS)}ms bound`,
    );
  }
  // Keep the fixture beside the report so the run is reproducible by hand.
  if (origin === 'ffmpeg')
    writeFileSync(join(EVIDENCE, 'fixture-recipe.txt'), `${recipe.join(' ')}\n`);
  return { bytes, sha256: sha256(bytes), probe, origin, recipe };
}

interface SourceRecord {
  source_id: string;
  kind: 'audio' | 'video';
  mime: string;
  sha256: string;
  byte_size: number;
  duration_ms: number;
  original_name: string | null;
}

async function upload(options: {
  api: string;
  projectId: string;
  bearer: string | null;
  mime: 'audio/wav' | 'video/mp4';
  bytes: Buffer;
  originalName: string;
  expectedSha: string;
}): Promise<SourceRecord> {
  const { api, projectId, bearer, mime, bytes, originalName, expectedSha } = options;
  const response = await fetch(`${api}/api/forge/projects/${projectId}/media/sources`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify({
      mime,
      data_base64: bytes.toString('base64'),
      origin: 'upload',
      original_name: originalName,
    }),
  });
  const body = (await response.json()) as { ok: boolean; data?: SourceRecord; error?: unknown };
  if (!response.ok || body.data === undefined) {
    fail(
      `upload of ${originalName} to ${projectId} failed: HTTP ${String(response.status)} ${JSON.stringify(body.error ?? null).slice(0, 300)}`,
    );
  }
  const record = body.data;
  if (record.sha256 !== expectedSha) {
    fail(
      `${originalName}: server-recorded sha256 ${record.sha256.slice(0, 16)}… does not match the uploaded bytes ${expectedSha.slice(0, 16)}…`,
    );
  }
  if (record.byte_size !== bytes.length) {
    fail(
      `${originalName}: server-recorded byte_size ${String(record.byte_size)} != ${String(bytes.length)}`,
    );
  }
  return record;
}

/**
 * Route-level proof that the byte route really is gated and that an
 * authenticated fetch returns the exact source bytes. Done from node so the
 * browser's own console/HTTP logs stay clean.
 */
async function probeByteRoute(options: {
  api: string;
  projectId: string;
  sourceId: string;
  bearer: string | null;
  mime: string;
  expectedSha: string;
  secured: boolean;
}): Promise<{
  bareStatus: number;
  bareCode: string;
  authStatus: number;
  authType: string;
  authSha: string;
  authBytes: number;
}> {
  const { api, projectId, sourceId, bearer, mime, expectedSha, secured } = options;
  const url = `${api}/api/forge/projects/${projectId}/media/sources/${sourceId}/bytes`;
  const bare = await fetch(url);
  const bareBody = (await bare.json().catch(() => null)) as { error?: { code?: string } } | null;
  const authed = await fetch(url, {
    ...(bearer === null ? {} : { headers: { authorization: `Bearer ${bearer}` } }),
  });
  const authBytes = Buffer.from(await authed.arrayBuffer());
  const outcome = {
    bareStatus: bare.status,
    bareCode: bareBody?.error?.code ?? '',
    authStatus: authed.status,
    authType: authed.headers.get('content-type') ?? '',
    authSha: sha256(authBytes),
    authBytes: authBytes.length,
  };
  const expectedBare = secured ? 401 : 200;
  if (outcome.bareStatus !== expectedBare) {
    fail(
      `${projectId}/${sourceId}: bare byte URL returned ${String(outcome.bareStatus)}, expected ${String(expectedBare)}`,
    );
  }
  if (secured && outcome.bareCode !== 'unauthorized') {
    fail(
      `${projectId}/${sourceId}: bare byte URL error code is "${outcome.bareCode}", expected "unauthorized"`,
    );
  }
  if (outcome.authStatus !== 200) {
    fail(`${projectId}/${sourceId}: bearer byte fetch returned ${String(outcome.authStatus)}`);
  }
  if (!outcome.authType.startsWith(mime)) {
    fail(`${projectId}/${sourceId}: byte content-type "${outcome.authType}" is not ${mime}`);
  }
  if (outcome.authSha !== expectedSha) {
    fail(
      `${projectId}/${sourceId}: bearer fetch returned sha ${outcome.authSha.slice(0, 16)}…, expected ${expectedSha.slice(0, 16)}…`,
    );
  }
  return outcome;
}

interface ByteRequest {
  status: number;
  hasBearerHeader: boolean;
  sourceId: string;
}

interface PlaybackEvidence {
  elementTag: string;
  elementSrc: string;
  blobSha: string;
  blobBytes: number;
  decode: Record<string, unknown> | null;
  download: { url: string; suggestedFilename: string } | null;
}

/*
 * Both probes below are passed to page.evaluate as source STRINGS. A function
 * value would be re-emitted by the TypeScript runner, whose name-preserving
 * helper (`__name`) does not exist inside the page, so an in-page named
 * function would throw at evaluate time rather than test anything.
 */

/** Hash the bytes reachable through the element's own blob URL, in-page. */
async function hashBlobUrl(
  page: Page,
  url: string,
): Promise<{ sha256: string; bytes: number; error: string | null }> {
  return page.evaluate(`(async (target) => {
    try {
      const response = await fetch(target);
      const buffer = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const hex = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      return { sha256: hex, bytes: buffer.byteLength, error: null };
    } catch (error) {
      return { sha256: '', bytes: 0, error: error instanceof Error ? error.message : String(error) };
    }
  })(${JSON.stringify(url)})`);
}

/**
 * Ask the real `<video>` element whether it decoded the bytes: metadata,
 * intrinsic size, advancing playback position, and a canvas read-back of the
 * current frame. A container that parses but cannot be decoded shows up here as
 * readyState 0 / zero size / a failed play, so playback is never assumed.
 */
async function videoDecodeProof(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(`(async () => {
    const video = document.querySelector('video');
    if (video === null) return { found: false };
    const metadata = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      if (video.readyState >= 1) finish('already');
      video.addEventListener('loadedmetadata', () => finish('loadedmetadata'), { once: true });
      video.addEventListener('error', () => finish('element-error'), { once: true });
      setTimeout(() => finish('timeout'), 8000);
    });
    // The panel's element is unmuted, so autoplay policy would block play();
    // muting lets the probe drive it without changing the product UI.
    video.muted = true;
    let playError = null;
    try {
      await video.play();
    } catch (error) {
      playError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    const width = video.videoWidth;
    const height = video.videoHeight;
    let frame = { drawn: false, distinctColors: 0, error: 'no frame read attempted' };
    const canvas = document.createElement('canvas');
    canvas.width = width > 0 ? width : 1;
    canvas.height = height > 0 ? height : 1;
    const context = canvas.getContext('2d');
    if (context === null) {
      frame.error = 'canvas 2d context unavailable';
    } else {
      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set();
        for (let index = 0; index < data.length; index += 4) {
          colors.add(String(data[index]) + ',' + String(data[index + 1]) + ',' + String(data[index + 2]));
        }
        frame = { drawn: true, distinctColors: colors.size, error: null };
      } catch (error) {
        frame = {
          drawn: false,
          distinctColors: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return {
      found: true,
      metadata,
      playError,
      readyState: video.readyState,
      videoWidth: width,
      videoHeight: height,
      duration: Number.isFinite(video.duration) ? video.duration : null,
      currentTime: video.currentTime,
      paused: video.paused,
      ended: video.ended,
      frame,
    };
  })()`);
}

async function exerciseStudio(options: {
  webBase: string;
  projectId: string;
  audio: SourceRecord;
  video: SourceRecord;
  storedToken: string | null;
  browser: Browser;
}): Promise<{
  audio: PlaybackEvidence;
  video: PlaybackEvidence;
  byteRequests: ByteRequest[];
  httpFailures: string[];
  consoleErrors: string[];
  credentialInUrl: string[];
  previousBlobStillReadable: { url: string; bytes: number; error: string | null };
  probeConsoleErrors: string[];
}> {
  const { webBase, projectId, audio, video, storedToken } = options;
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
  const byteRequests: ByteRequest[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.toLowerCase().includes('favicon')) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (error: Error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('response', (response: Response) => {
    if (response.status() >= 400)
      httpFailures.push(`HTTP ${String(response.status())} ${response.url()}`);
    const url = response.url();
    if (!url.endsWith('/bytes')) return;
    // Playwright's request.headers() is synchronous here; a throw inside an
    // event handler would take the whole run down, so it is contained.
    try {
      const authorization = response.request().headers().authorization ?? '';
      byteRequests.push({
        status: response.status(),
        hasBearerHeader: authorization.startsWith('Bearer '),
        sourceId: (url.match(/sources\/([0-9a-f-]{36})\/bytes/) ?? ['', 'unknown'])[1] as string,
      });
    } catch (error) {
      consoleErrors.push(`byte request capture failed: ${String(error).slice(0, 120)}`);
    }
  });
  page.on('request', (request) => {
    // A credential in a URL would leak into history, logs, and Referer.
    if (request.url().includes('browser-check-shared-secret')) credentialInUrl.push(request.url());
  });

  const downloads: Download[] = [];
  page.on('download', (download: Download) => downloads.push(download));

  await page.goto(webBase, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.getByRole('button', { name: 'HTML Studio', exact: true }).waitFor({ timeout: 20_000 });
  await page.locator('button[title^="Project:"]').click();
  const dialog = page.getByRole('dialog', { name: 'Switch project' });
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.getByLabel('Project id').fill(projectId);
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();

  async function capture(kind: 'audio' | 'video'): Promise<PlaybackEvidence> {
    const wanted = kind === 'audio' ? audio : video;
    const label = String(wanted.original_name ?? wanted.source_id).replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );
    const row = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
    await row.waitFor({ timeout: 10_000 });
    await row.click();
    try {
      await page.locator(kind).first().waitFor({ timeout: 15_000 });
    } catch {
      await page
        .screenshot({ path: join(EVIDENCE, `no-${kind}-${projectId}.png`), fullPage: true })
        .catch(() => undefined);
      fail(
        `no <${kind}> element for ${wanted.original_name ?? wanted.source_id} in ${projectId}; console: ${consoleErrors.join(' | ').slice(0, 300) || '(none)'}; failures: ${httpFailures.join(' | ').slice(0, 300) || '(none)'}`,
      );
    }
    const element = page.locator(kind).first();
    const elementSrc = (await element.getAttribute('src')) ?? '';
    await element.scrollIntoViewIfNeeded().catch(() => undefined);
    const blob = await hashBlobUrl(page, elementSrc);
    const decode = kind === 'video' ? await videoDecodeProof(page) : null;
    await page.screenshot({
      path: join(EVIDENCE, `playback-${projectId}-${kind}.png`),
      fullPage: true,
    });

    const downloadButton = page.getByRole('button', {
      name: kind === 'audio' ? /^Download WAV$/ : /^Download MP4$/,
    });
    await downloadButton.waitFor({ timeout: 10_000 });
    const before = downloads.length;
    await downloadButton.click();
    await sleep(600);
    await page.screenshot({
      path: join(EVIDENCE, `download-${projectId}-${kind}.png`),
      fullPage: true,
    });
    const fresh = downloads.slice(before);
    if (fresh.length !== 1) {
      fail(`${kind}: expected exactly one browser download, saw ${String(fresh.length)}`);
    }
    const download = fresh[0] as Download;
    return {
      elementTag: kind,
      elementSrc,
      blobSha: blob.sha256,
      blobBytes: blob.bytes,
      decode,
      download: { url: download.url(), suggestedFilename: download.suggestedFilename() },
    };
  }

  // The panel auto-selects one source on load; select each explicitly so both
  // branches are exercised, and confirm the other element type disappears.
  const audioEvidence = await capture('audio');
  if ((await page.locator('video').count()) !== 0)
    fail(`${projectId}: a <video> element appeared for an audio source`);
  const previousBlobUrl = audioEvidence.elementSrc;
  const videoEvidence = await capture('video');
  if ((await page.locator('audio').count()) !== 0)
    fail(`${projectId}: an <audio> element survived after selecting the video source`);
  if (videoEvidence.elementSrc === audioEvidence.elementSrc) {
    fail(`${projectId}: the video element reused the audio blob URL`);
  }
  // Switching selection must revoke the previous source's object URL. Chromium
  // logs a load failure for a revoked blob URL, so probe last and keep those
  // deliberate errors out of the clean-console gate (recorded separately).
  const consoleMark = consoleErrors.length;
  const previousBlobStillReadable = await hashBlobUrl(page, previousBlobUrl).then((result) => ({
    url: previousBlobUrl,
    bytes: result.bytes,
    error: result.error,
  }));
  const probeConsoleErrors = consoleErrors.slice(consoleMark);
  consoleErrors.length = consoleMark;

  await context.close();
  return {
    audio: audioEvidence,
    video: videoEvidence,
    byteRequests,
    httpFailures,
    consoleErrors,
    credentialInUrl,
    previousBlobStillReadable,
    probeConsoleErrors,
  };
}

function writeEvidence(): void {
  if (evidenceWritten) return;
  evidenceWritten = true;
  mkdirSync(EVIDENCE, { recursive: true });
  const report = {
    kind: 'Batch D token-gated source playback, audio + video (production builds, offline, no provider)',
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
  const identity = describeBundleIdentity(provenance);
  observations.buildProvenance = {
    commit: provenance.commit,
    treeClean: provenance.treeClean,
    serverBuildHash: provenance.server.buildHash,
    webBuildHash: provenance.web.buildHash,
    bundlesBuiltAtCommit: identity.builtAtCommit,
    bundlesBuiltAtHead: identity.builtAtHead,
    bundlesBuiltFromCleanTree: identity.builtFromCleanTree,
    supportsCommitIdentity: identity.supportsCommitIdentity,
    serverBuiltAt: identity.serverBuiltAt,
    webBuiltAt: identity.webBuiltAt,
    identity_note: identity.note,
  };
  check(
    `production builds match the tested source (server ${provenance.server.buildHash.slice(0, 12)}…, web ${provenance.web.buildHash.slice(0, 12)}…)`,
  );
  if (!identity.supportsCommitIdentity) {
    // Say it out loud rather than letting a newer commit in the report imply the bundle
    // bytes came from it.
    check(identity.note);
  }

  const wav = wavBytes();
  const clip = videoFixture();
  observations.audioFixture = { bytes: wav.length, sha256: sha256(wav), kind: 'audio/wav' };
  observations.videoFixture = {
    bytes: clip.bytes.length,
    sha256: clip.sha256,
    kind: 'video/mp4',
    origin: clip.origin,
    ffprobe: clip.probe,
    ffmpegArgs: clip.recipe,
  };
  console.log(
    `  fixture: ${String(clip.bytes.length)} bytes H.264 MP4 (${clip.probe.codec_name} ${clip.probe.width}x${clip.probe.height}, ${String(clip.probe.duration)}s, sha ${clip.sha256.slice(0, 12)}…)`,
  );

  const launched = await launchVerificationBrowser();
  const browser: Browser = launched.browser;
  reportBrowserSelection(launched.selection);

  const servers: ChildProcess[] = [];
  const dataDirs: string[] = [];
  try {
    for (const mode of ['secured', 'tokenless'] as const) {
      const secured = mode === 'secured';
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
        ...(secured ? { ACCESS_TOKEN: TOKEN } : {}),
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
        ...(secured ? { headers: { authorization: `Bearer ${TOKEN}` } } : {}),
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
      const audio = await upload({
        api: apiBase,
        projectId,
        bearer: secured ? TOKEN : null,
        mime: 'audio/wav',
        bytes: wav,
        originalName: 'note.wav',
        expectedSha: sha256(wav),
      });
      const video = await upload({
        api: apiBase,
        projectId,
        bearer: secured ? TOKEN : null,
        mime: 'video/mp4',
        bytes: clip.bytes,
        originalName: 'clip.mp4',
        expectedSha: clip.sha256,
      });
      observations[`${mode}Uploads`] = {
        audio: {
          sourceId: audio.source_id,
          kind: audio.kind,
          sha256: audio.sha256,
          byteSize: audio.byte_size,
          durationMs: audio.duration_ms,
        },
        video: {
          sourceId: video.source_id,
          kind: video.kind,
          sha256: video.sha256,
          byteSize: video.byte_size,
          durationMs: video.duration_ms,
        },
      };

      const route = {
        audio: await probeByteRoute({
          api: apiBase,
          projectId,
          sourceId: audio.source_id,
          bearer: secured ? TOKEN : null,
          mime: 'audio/wav',
          expectedSha: audio.sha256,
          secured,
        }),
        video: await probeByteRoute({
          api: apiBase,
          projectId,
          sourceId: video.source_id,
          bearer: secured ? TOKEN : null,
          mime: 'video/mp4',
          expectedSha: video.sha256,
          secured,
        }),
      };
      observations[`${mode}ByteRoute`] = route;
      check(
        secured
          ? `${mode}: both byte routes answer a bare URL with 401 unauthorized, and the same URLs return the exact uploaded bytes to a bearer fetch (${String(route.audio.authBytes)} audio + ${String(route.video.authBytes)} video bytes)`
          : `${mode}: both byte routes return the exact uploaded bytes with no credential at all (${String(route.audio.authBytes)} audio + ${String(route.video.authBytes)} video bytes)`,
      );

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

      const run = await exerciseStudio({
        webBase,
        projectId,
        audio,
        video,
        storedToken: secured ? TOKEN : null,
        browser,
      });
      observations[mode] = {
        audioSourceId: audio.source_id,
        videoSourceId: video.source_id,
        audioSrcScheme: run.audio.elementSrc.split(':')[0] ?? '',
        videoSrcScheme: run.video.elementSrc.split(':')[0] ?? '',
        audioPlaybackBytes: run.audio.blobBytes,
        videoPlaybackBytes: run.video.blobBytes,
        videoDecode: run.video.decode,
        byteRequests: run.byteRequests,
        uploads: 2,
        httpFailures: run.httpFailures,
        consoleErrors: run.consoleErrors,
        credentialInUrl: run.credentialInUrl,
        downloads: [run.audio.download, run.video.download],
        previousBlobAfterSwitch: run.previousBlobStillReadable,
        probeConsoleErrors: run.probeConsoleErrors,
      };

      for (const kind of ['audio', 'video'] as const) {
        const evidence = run[kind];
        const record = kind === 'audio' ? audio : video;
        const expectedBytes = kind === 'audio' ? wav.length : clip.bytes.length;
        if (!evidence.elementSrc.startsWith('blob:')) {
          fail(
            `${mode}/${kind}: element src is not a blob URL: ${evidence.elementSrc.slice(0, 120)}`,
          );
        }
        if (evidence.blobBytes !== expectedBytes) {
          fail(
            `${mode}/${kind}: the blob URL returned ${String(evidence.blobBytes)} bytes, expected ${String(expectedBytes)}`,
          );
        }
        if (evidence.blobSha !== record.sha256) {
          fail(
            `${mode}/${kind}: playback bytes hash to ${evidence.blobSha.slice(0, 16)}…, expected the uploaded sha ${record.sha256.slice(0, 16)}…`,
          );
        }
        const download = evidence.download as { url: string; suggestedFilename: string };
        if (!download.url.startsWith('blob:')) {
          fail(`${mode}/${kind}: download URL is not a blob URL: ${download.url.slice(0, 120)}`);
        }
        if (download.url.includes('browser-check-shared-secret')) {
          fail(`${mode}/${kind}: the download URL carried a credential`);
        }
        if (
          download.suggestedFilename !== `${record.source_id}.${kind === 'audio' ? 'wav' : 'mp4'}`
        ) {
          fail(`${mode}/${kind}: download name is ${download.suggestedFilename}`);
        }
      }

      if (run.httpFailures.length > 0) {
        fail(`${mode}: HTTP failures observed: ${run.httpFailures.join(' | ').slice(0, 400)}`);
      }
      if (run.consoleErrors.length > 0) {
        fail(`${mode}: console errors: ${run.consoleErrors.join(' | ').slice(0, 400)}`);
      }
      if (run.credentialInUrl.length > 0) {
        fail(`${mode}: credential appeared in a URL: ${run.credentialInUrl.join(' | ')}`);
      }
      check(
        `${mode}: <audio> and <video> both render from blob URLs whose bytes hash to the uploaded sources (${String(run.audio.blobBytes)} + ${String(run.video.blobBytes)} bytes)`,
      );

      const decode = run.video.decode as Record<string, unknown>;
      const frame = (decode.frame ?? {}) as Record<string, unknown>;
      if (
        decode.found !== true ||
        decode.metadata === 'timeout' ||
        decode.metadata === 'element-error'
      ) {
        fail(
          `${mode}: the <video> element never reported metadata: ${JSON.stringify(decode).slice(0, 300)}`,
        );
      }
      if (decode.videoWidth !== 64 || decode.videoHeight !== 64) {
        fail(
          `${mode}: decoded frame size is ${String(decode.videoWidth)}x${String(decode.videoHeight)}, expected 64x64`,
        );
      }
      if (Number(decode.readyState) < 2) {
        fail(
          `${mode}: <video> readyState ${String(decode.readyState)} shows no decodable current data`,
        );
      }
      if (decode.playError !== null) {
        fail(`${mode}: <video> play() failed: ${String(decode.playError)}`);
      }
      if (!(Number(decode.currentTime) > 0)) {
        fail(
          `${mode}: <video> playback position did not advance (currentTime ${String(decode.currentTime)})`,
        );
      }
      if (frame.drawn !== true || Number(frame.distinctColors) < 3) {
        fail(
          `${mode}: the decoded frame read-back is not real pixel data: ${JSON.stringify(frame).slice(0, 300)}`,
        );
      }
      check(
        `${mode}: <video> decodes the H.264 track (64x64, ${String(decode.duration)}s, currentTime ${String(Number(decode.currentTime).toFixed(2))}, ${String(frame.distinctColors)} distinct colours in the drawn frame)`,
      );

      check(
        `${mode}: downloads offer ${String((run.audio.download as { suggestedFilename: string }).suggestedFilename)} and ${String((run.video.download as { suggestedFilename: string }).suggestedFilename)} from credential-free blob URLs`,
      );

      const byteForSource = (sourceId: string): ByteRequest | undefined =>
        run.byteRequests.find((entry) => entry.sourceId === sourceId);
      const audioRequest = byteForSource(audio.source_id);
      const videoRequest = byteForSource(video.source_id);
      if (audioRequest === undefined || videoRequest === undefined) {
        fail(
          `${mode}: the app never fetched both byte routes through its API client: ${JSON.stringify(run.byteRequests)}`,
        );
      }
      if (secured) {
        if (!audioRequest.hasBearerHeader || !videoRequest.hasBearerHeader) {
          fail(`${mode}: a byte request went out without the bearer header`);
        }
        if (audioRequest.status !== 200 || videoRequest.status !== 200) {
          fail(`${mode}: authorized byte requests did not return 200`);
        }
      } else {
        if (audioRequest.hasBearerHeader || videoRequest.hasBearerHeader) {
          fail(`${mode}: a byte request sent an authorization header with no token configured`);
        }
      }
      check(
        `${mode}: every one of the ${String(run.byteRequests.length)} byte requests for both sources went through the API client ${
          secured
            ? 'with the bearer header and returned 200'
            : 'with no authorization header (tokenless loopback)'
        }`,
      );

      const revoked = run.previousBlobStillReadable;
      if (revoked.bytes === wav.length && revoked.error === null) {
        fail(
          `${mode}: the previous source's blob URL is still readable after the selection changed`,
        );
      }

      const serverText = readFileSync(serverLog, 'utf8');
      const trace = serverText.split('\n').filter((line) => line.includes('[media-trace]'));
      if (trace.length > 0)
        fail(`${mode}: media/provider dispatches observed: ${String(trace.length)}`);
      if (secured && serverText.includes(TOKEN))
        fail(`${mode}: the shared token appeared in the server log`);
      check(`${mode}: zero media/provider dispatches and no credential in logs`);
    }
    observations.fixtures = {
      audioBytes: wav.length,
      audioSha256: sha256(wav),
      videoBytes: clip.bytes.length,
      videoSha256: clip.sha256,
      videoCodec: `${String(clip.probe.codec_name)} ${String(clip.probe.width)}x${String(clip.probe.height)}`,
    };
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
