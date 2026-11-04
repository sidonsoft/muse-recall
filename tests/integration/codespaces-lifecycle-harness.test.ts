import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Lifecycle behaviour, executed — not just asserted as text.
 *
 * start.sh / stop.sh / status.sh run here for real, against disposable ports
 * and a stubbed start command, in disposable directories. The stubs never
 * touch the product, a database, a credential or the network beyond loopback.
 * What is pinned: one instance on first start, no second instance on repeat
 * or concurrent starts, status never spawns, partial/stale states recover with
 * a message, and stop reaches exactly the app tree.
 */
const DEVCONTAINER = join(__dirname, '..', '..', '.devcontainer');
const START = join(DEVCONTAINER, 'start.sh');
const STOP = join(DEVCONTAINER, 'stop.sh');
const STATUS = join(DEVCONTAINER, 'status.sh');

const STUB_APP = `
import http from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
// Mirrors pnpm dev: the API answers /api/live on one port, the web server
// answers / on the other. Both must listen or the app is not healthy.
const [apiPort, webPort, bootLog, childLog] = process.argv.slice(2);
if (childLog) {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['-e', (process.env.STUB_CHILD_STUBBORN ? "process.on('SIGTERM', () => {});" : '') + 'setInterval(() => {}, 3600000)'], { stdio: 'ignore' });
  child.unref();
  writeFileSync(childLog, String(child.pid));
}
let ready = 0;
const markReady = () => {
  ready += 1;
  if (ready === 2) appendFileSync(bootLog, process.pid + '\\n');
};
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
}).listen(Number(apiPort), '127.0.0.1', markReady);
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<html></html>');
}).listen(Number(webPort), '127.0.0.1', markReady);
`;

interface Harness {
  dir: string;
  logDir: string;
  pidFile: string;
  bootLog: string;
  childLog: string;
  apiPort: number;
  webPort: number;
  stub: string;
  stop: () => void;
}

let harnesses: Harness[] = [];

function freePort(): number {
  // Bind port 0, read the assignment back, release it. A different local
  // process could win the race before our stub binds; the stub boot check
  // below turns that into a loud test failure, not a silent pass.
  const out = execFileSync(
    process.execPath,
    [
      '-e',
      'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();});',
    ],
    { encoding: 'utf8' },
  );
  return Number(out.trim());
}

function setupHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-'));
  const logDir = join(dir, 'logs');
  const stub = join(dir, 'stub-app.mjs');
  writeFileSync(stub, STUB_APP, 'utf8');
  const harness: Harness = {
    dir,
    logDir,
    pidFile: join(dir, 'logs', 'dev.pid'),
    bootLog: join(dir, 'boot.log'),
    childLog: join(dir, 'child.pid'),
    apiPort: freePort(),
    webPort: freePort(),
    stub,
    stop: () => {},
  };
  harnesses.push(harness);
  return harness;
}

function scriptEnv(h: Harness, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    CODESPACES_APP_API: `http://127.0.0.1:${h.apiPort}/api/live`,
    CODESPACES_APP_WEB: `http://127.0.0.1:${h.webPort}`,
    CODESPACES_LOG_DIR: h.logDir,
    CODESPACES_PID_FILE: h.pidFile,
    CODESPACES_START_WAIT_SECS: '15',
    CODESPACES_STOP_WAIT_SECS: '5',
  };
}

function startCmd(h: Harness, withChild = false): string {
  return `node ${h.stub} ${h.apiPort} ${h.webPort} ${h.bootLog}${withChild ? ` ${h.childLog}` : ''}`;
}

function runScript(script: string, env: NodeJS.ProcessEnv): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('bash', [script], { env, encoding: 'utf8', timeout: 120_000 });
    return { stdout, status: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; status?: number };
    return { stdout: String(failure.stdout ?? ''), status: failure.status ?? -1 };
  }
}

function runScriptAsync(
  script: string,
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; status: number }> {
  return new Promise((resolve) => {
    execFile('bash', [script], { env, encoding: 'utf8', timeout: 120_000 }, (error, stdout) => {
      if (error) {
        const failure = error as { stdout?: string; code?: number };
        resolve({ stdout: String(stdout ?? failure.stdout ?? ''), status: failure.code ?? -1 });
      } else {
        resolve({ stdout: String(stdout), status: 0 });
      }
    });
  });
}

function bootCount(h: Harness): number {
  if (!existsSync(h.bootLog)) return 0;
  return readFileSync(h.bootLog, 'utf8').split('\n').filter(Boolean).length;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).includes(
      'Z',
    );
  } catch {
    return false;
  }
}

function recordedPid(h: Harness): number | null {
  try {
    return Number(readFileSync(h.pidFile, 'utf8').trim());
  } catch {
    return null;
  }
}

function killTree(h: Harness): void {
  for (const file of [h.pidFile, h.childLog]) {
    try {
      const pid = Number(readFileSync(file, 'utf8').trim());
      if (pid > 0) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          /* group may be gone */
        }
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already dead */
        }
      }
    } catch {
      /* no pid recorded */
    }
  }
}

beforeEach(() => {
  harnesses = [];
});

afterEach(() => {
  for (const h of harnesses) {
    killTree(h);
    try {
      rmSync(h.dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  harnesses = [];
});

describe('lifecycle behaviour', () => {
  it('first start launches exactly one instance', () => {
    const h = setupHarness();
    const result = runScript(START, scriptEnv(h, { CODESPACES_START_CMD: startCmd(h) }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('is up');
    expect(bootCount(h)).toBe(1);
    expect(recordedPid(h)).toBeGreaterThan(0);
  }, 60_000);

  it('a healthy repeated start launches nothing new', () => {
    const h = setupHarness();
    const env = scriptEnv(h, { CODESPACES_START_CMD: startCmd(h) });
    expect(runScript(START, env).status).toBe(0);
    const pidBefore = recordedPid(h);
    const second = runScript(START, env);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('already running');
    expect(bootCount(h)).toBe(1);
    expect(recordedPid(h)).toBe(pidBefore);
  }, 60_000);

  it('reattachment only reports: no process, no pid change', () => {
    const h = setupHarness();
    const env = scriptEnv(h, { CODESPACES_START_CMD: startCmd(h) });
    expect(runScript(START, env).status).toBe(0);
    const pidBefore = recordedPid(h);
    const status = runScript(STATUS, scriptEnv(h));
    expect(status.status).toBe(0);
    expect(status.stdout).toContain('ready');
    expect(bootCount(h)).toBe(1);
    expect(recordedPid(h)).toBe(pidBefore);
  }, 60_000);

  it('concurrent starts do not create duplicate instances', async () => {
    const h = setupHarness();
    const env = scriptEnv(h, { CODESPACES_START_CMD: startCmd(h) });
    const results = await Promise.all([
      runScriptAsync(START, env),
      runScriptAsync(START, env),
      runScriptAsync(START, env),
      runScriptAsync(START, env),
    ]);
    for (const result of results) expect(result.status).toBe(0);
    expect(bootCount(h)).toBe(1);
  }, 120_000);

  it('concurrent stale-lock recovery still launches exactly one instance', async () => {
    const h = setupHarness();
    mkdirSync(join(h.logDir, 'start.lock'), { recursive: true });
    writeFileSync(join(h.logDir, 'start.lock', 'pid'), 'not-a-pid');
    const env = scriptEnv(h, { CODESPACES_START_CMD: startCmd(h) });
    const results = await Promise.all(Array.from({ length: 4 }, () => runScriptAsync(START, env)));
    for (const result of results) expect(result.status).toBe(0);
    expect(bootCount(h)).toBe(1);
  }, 120_000);

  it('stop kills a stubborn child after its parent exits', () => {
    const h = setupHarness();
    const env = scriptEnv(h, { CODESPACES_START_CMD: startCmd(h, true), STUB_CHILD_STUBBORN: '1' });
    expect(runScript(START, env).status).toBe(0);
    const child = Number(readFileSync(h.childLog, 'utf8'));
    const stopped = runScript(STOP, { ...env, CODESPACES_STOP_WAIT_SECS: '1' });
    expect(stopped.status).toBe(0);
    expect(pidAlive(child)).toBe(false);
    expect(existsSync(h.pidFile)).toBe(false);
  }, 60_000);

  it('a start that never becomes healthy fails with the log location', () => {
    const h = setupHarness();
    const env = scriptEnv(h, {
      CODESPACES_START_CMD: 'node -e "setTimeout(() => {}, 30000)"',
      CODESPACES_START_WAIT_SECS: '4',
    });
    const result = runScript(START, env);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('did not become healthy');
    expect(result.stdout).toContain('dev.log');
  }, 60_000);

  it('a stale pid file is removed and start proceeds', () => {
    const h = setupHarness();
    const env = scriptEnv(h, { CODESPACES_START_CMD: startCmd(h) });
    // Non-numeric content can never name a live process: deterministically stale
    // (a numeric dead pid could be recycled between the check and the write).
    mkdirSync(h.logDir, { recursive: true });
    writeFileSync(h.pidFile, 'not-a-pid\n', 'utf8');
    const result = runScript(START, env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('stale pid');
    expect(bootCount(h)).toBe(1);
    expect(recordedPid(h)).toBeGreaterThan(0);
  }, 60_000);

  it('stop reaches exactly the app tree and leaves unrelated processes alone', async () => {
    const h = setupHarness();
    const env = scriptEnv(h, { CODESPACES_START_CMD: startCmd(h, true) });
    expect(runScript(START, env).status).toBe(0);
    const appPid = recordedPid(h);
    expect(appPid).toBeGreaterThan(0);
    const childPid = Number(readFileSync(h.childLog, 'utf8').trim());
    expect(childPid).toBeGreaterThan(0);
    expect(pidAlive(childPid)).toBe(true);

    // An unrelated development process: never pattern-matched, must survive.
    const { spawn } = await import('node:child_process');
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 3600000)'], {
      stdio: 'ignore',
      detached: true,
    });
    sentinel.unref();
    const sentinelPid = sentinel.pid;
    expect(sentinelPid).toBeGreaterThan(0);

    const stopped = runScript(STOP, scriptEnv(h));
    expect(stopped.status).toBe(0);
    expect(existsSync(h.pidFile)).toBe(false);
    expect(pidAlive(appPid as number)).toBe(false);
    expect(pidAlive(childPid)).toBe(false);
    // The unrelated process survives: stop signals the app tree, not a name.
    expect(pidAlive(sentinelPid as number)).toBe(true);
    try {
      process.kill(sentinelPid as number, 'SIGKILL');
    } catch {
      /* cleanup */
    }
  }, 120_000);

  it('refuses a live PID belonging to a different process identity', async () => {
    const h = setupHarness();
    const { spawn } = await import('node:child_process');
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 3600000)'], {
      stdio: 'ignore',
      detached: true,
    });
    sentinel.unref();
    mkdirSync(h.logDir, { recursive: true });
    writeFileSync(h.pidFile, String(sentinel.pid));
    writeFileSync(`${h.pidFile}.identity`, 'different-container-and-process');
    const stopped = runScript(STOP, scriptEnv(h));
    expect(stopped.status).toBe(1);
    expect(stopped.stdout).toContain('identity');
    expect(pidAlive(sentinel.pid as number)).toBe(true);
  }, 30_000);

  it('stopping an already-stopped app is a no-op success', () => {
    const h = setupHarness();
    const result = runScript(STOP, scriptEnv(h));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('nothing to stop');
  }, 30_000);
});
