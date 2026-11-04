import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Codespaces lifecycle contract.
 *
 * A judge's first contact with this repository is a container, and a container
 * regression looks different from a product regression: setup that deletes a
 * judge's generated versions, an attach hook that boots a second server onto
 * held ports, or a silent "latest" install of a channel-following binary all
 * fail for the person, not for the test suite. These are cheap structural
 * gates over the files that define that lifecycle — they pin the requirements,
 * not an implementation.
 */
const ROOT = join(__dirname, '..', '..');

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** devcontainer.json is JSONC: strip full-line `//` comments before parsing. */
function readJsonC(rel: string): unknown {
  const stripped = read(rel)
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  return JSON.parse(stripped);
}

describe('devcontainer lifecycle', () => {
  const config = readJsonC('.devcontainer/devcontainer.json') as {
    postCreateCommand: string;
    postStartCommand: string;
    postAttachCommand: string;
    forwardPorts: number[];
    portsAttributes: unknown;
  };

  it('creates with setup, starts once, and only reports on attach', () => {
    expect(config.postCreateCommand).toContain('setup.sh');
    expect(String(config.postStartCommand)).toContain('start.sh');
    expect(existsSync(join(ROOT, '.devcontainer/start.sh'))).toBe(true);
    expect(existsSync(join(ROOT, '.devcontainer/status.sh'))).toBe(true);
    // Attaching must never boot the server: no second `pnpm dev` on held
    // ports, and no start path reachable from the attach hook.
    expect(String(config.postAttachCommand)).not.toContain('pnpm dev');
    expect(String(config.postAttachCommand)).not.toContain('start.sh');
    expect(String(config.postAttachCommand)).toContain('status.sh');
  });

  it('keeps the ports private and the API loopback-only', () => {
    expect(config.forwardPorts).toEqual([5173, 8787]);
    const attrs = JSON.stringify(config.portsAttributes ?? {});
    expect(attrs).not.toMatch(/public/i);
    // No CORS widening or non-loopback bind may ride along with this task.
    expect(read('.devcontainer/devcontainer.json')).not.toContain('CORS_ORIGINS');
  });
});

describe('setup.sh preserves judge work', () => {
  const setup = read('.devcontainer/setup.sh');

  it('keeps an existing .env instead of rewriting it', () => {
    expect(setup).toContain('Keeping the existing .env');
  });

  it('delegates the seed decision to the guard and fails safe', () => {
    // The seed wipes forge-demo versions/staging/jobs, so an unconditional
    // run would delete generated work on every container start. The shell
    // must not re-implement path resolution: the guard owns it, and a guard
    // failure resolves to `skip`, never to a seed.
    expect(setup).toContain('codespaces-seed-check.ts');
    expect(setup).toContain('SEED_DECISION=skip');
    // The only seed invocation is inside the guard's `seed` branch.
    expect(setup).toContain('if [ "$SEED_DECISION" = "seed" ]');
    expect(setup.match(/pnpm demo:seed/g)?.length).toBe(1);
  });

  it('installs the pinned Playwright browser for the application user', () => {
    expect(setup).toContain('playwright-core install');
    expect(setup).toContain('chromium');
    // Only system libraries elevate, via Playwright's supported split; the
    // browser itself is downloaded and launch-checked as the app user, so its
    // files never land in root's cache.
    expect(setup).toContain('install-deps chromium');
    expect(setup).toContain('as_app_user');
    expect(setup).toContain('codespaces-verify-browser.ts');
  });

  it('leaves the Muse CLI to an explicit opt-in, never a silent latest', () => {
    expect(setup).toContain('INSTALL_MUSE_CLI');
    // The launcher follows the release channel: setup must not fetch it
    // behind the judge's back, and must not claim a pin it cannot make.
    expect(setup).not.toContain('muse-launcher.sh');
    expect(setup).not.toMatch(/install.*latest/i);
  });
});

describe('install-muse-cli.sh uses the official launcher, honestly', () => {
  const installer = read('.devcontainer/install-muse-cli.sh');

  it('fetches only the official launcher over pinned HTTPS', () => {
    expect(installer).toContain('https://api.meta.ai/muse-launcher.sh');
    expect(installer).toContain("--proto '=https'");
    // The launcher applies this same check to its own updates.
    expect(installer).toContain('bash -n');
  });

  it('records the channel-tip version instead of claiming a pin', () => {
    expect(installer).toContain('muse --version');
    expect(installer).toContain('channel tip');
    // No version-pinning mechanism exists: there must be no MUSE_VERSION-style
    // assignment pretending otherwise (mentioning that no pin exists is fine).
    expect(installer).not.toMatch(/MUSE_VERSION\s*=/);
  });

  it('refuses unsupported platforms instead of assuming Linux works', () => {
    expect(installer).toContain('not a platform the Muse launcher supports');
  });

  it('never authenticates and never pays for a call', () => {
    // Documenting 'muse login' as the human next step is required; executing
    // it (or any model call) during install is forbidden.
    expect(installer).not.toMatch(/^\s*muse\s+login\b/m);
    expect(installer).not.toMatch(/muse\s+exec\b/i);
  });
});

describe('start.sh and status.sh are safe to re-run', () => {
  const start = read('.devcontainer/start.sh');
  const status = read('.devcontainer/status.sh');

  it('start checks health first and never piles onto held ports', () => {
    expect(start).toContain('/api/live');
    expect(start).toContain('already running');
    expect(start).toContain('nohup');
    // Lock and stale-pid cleanup are the only removals: never user data.
    expect(start).not.toMatch(/rm\s+.*(data|workspaces|\.env|\/\s*$)/);
    // Concurrent starts serialise on an atomic lock, and the app detaches
    // into its own process group so stop can signal exactly the app tree.
    expect(start).toContain('start.lock');
    expect(start).toContain('setsid');
  });

  it('stop signals the app tree, never a process name', () => {
    expect(existsSync(join(ROOT, '.devcontainer/stop.sh'))).toBe(true);
    const stop = read('.devcontainer/stop.sh');
    // No name-based signalling anywhere: pgrep is used only with -P (parent
    // pid), never -f (command-line pattern). Mentioning `pnpm dev` in a
    // comment as an example of what is spared is documentation, not a target.
    expect(stop).not.toMatch(/pkill\s+-f/);
    expect(stop).not.toMatch(/pgrep\s+-f/);
    expect(stop).not.toContain('killall');
    expect(stop).toContain('process group');
  });

  it('status only reports, with bounded probes that cannot hang an attach', () => {
    // No command-position process control: the stop hint is documentation
    // inside an echo line, not something the hook executes.
    expect(status).not.toMatch(/^\s*(pnpm|nohup|kill)\s/m);
    // Naming the start script in a hint is documentation; executing it from
    // the attach hook would defeat the no-restart guarantee.
    expect(status).not.toMatch(/^\s*bash\s+.*start\.sh/m);
    expect(status).toContain('--max-time');
    expect(status).toContain('.devcontainer/README.md');
  });
});

describe('judge walkthrough stays accurate', () => {
  const walkthrough = read('.devcontainer/README.md');

  it('names the published demo URL and the beat the Guard evidence is on', () => {
    // The submission URL is frozen: link it, never move it.
    expect(walkthrough).toContain(
      'https://sidonsoft.github.io/muse-recall/video/muse-recall-demo.mp4',
    );
    // The Guard flagging the retired palette is the 0:43 beat per V21_QA.md.
    expect(walkthrough).toContain('0:43');
    expect(walkthrough).not.toContain('1:20');
  });

  it('keeps text generation, media credentials and models separate', () => {
    expect(walkthrough).toContain('FORGE_MUSE_API_KEY');
    expect(walkthrough).toContain('FORGE_MUSE_MODEL');
    expect(walkthrough).toContain('MUSE_MODEL');
    expect(walkthrough).toContain('MODEL_PROVIDER');
  });

  it('labels the live path experimental and separates install, login and inference', () => {
    // Launcher platform support is not verified authentication or execution.
    expect(walkthrough).toMatch(/unverified in codespaces/i);
    expect(walkthrough).toMatch(/experimental/i);
    // Switching providers stops the background app first — never a second
    // server over the first.
    expect(walkthrough).toContain('.devcontainer/stop.sh');
    expect(walkthrough).not.toContain('pkill -f');
  });
});
