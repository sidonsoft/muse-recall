import { buildChildEnv, CHILD_ENV_ALLOWLIST } from '@mml/shared';
import { describe, expect, it } from 'vitest';
import { FORGE_CHILD_ENV_ALLOWLIST, forgeChildEnv } from '../../apps/server/src/forge/child-env.js';

/**
 * Direct unit witness for the SHARED child-env policy that both spawn paths
 * (chat provider, Forge) consume. Each path's own suite pins a few named
 * negatives through a live fake binary; nothing tested the policy itself:
 * the injection-variable family the header promises to exclude, the LC_*
 * passthrough rule, overrides-applied-last, or the allowlist as a CLOSED set.
 */

describe('buildChildEnv (shared policy)', () => {
  it('excludes the executable-injection family named in the policy header', () => {
    const source: NodeJS.ProcessEnv = {
      LD_PRELOAD: '/tmp/inject.so',
      DYLD_INSERT_LIBRARIES: '/tmp/inject.dylib',
      NODE_OPTIONS: '--require=/tmp/inject.cjs',
      PYTHONPATH: '/tmp/malicious',
      PERL5LIB: '/tmp/malicious',
      PERL5OPT: '-T',
      RUBYOPT: '-r/tmp/inject',
      HOME: '/home/operator',
    };
    const env = buildChildEnv({ source });
    for (const key of [
      'LD_PRELOAD',
      'DYLD_INSERT_LIBRARIES',
      'NODE_OPTIONS',
      'PYTHONPATH',
      'PERL5LIB',
      'PERL5OPT',
      'RUBYOPT',
    ]) {
      expect(env).not.toHaveProperty(key);
    }
    expect(env.HOME).toBe('/home/operator'); // the policy is selective, not empty
  });

  it("excludes this application's own secrets — including ACCESS_TOKEN", () => {
    // ACCESS_TOKEN arrived with D045 token mode; the spawn-policy pair for a
    // new secret is a named negative here, which did not exist yet.
    const source: NodeJS.ProcessEnv = {
      ACCESS_TOKEN: 'shared-bearer-secret',
      DATABASE_PATH: '/srv/muse/data.db',
      FORGE_MUSE_API_KEY: 'forge-key',
      FORGE_MUSE_BIN: '/opt/private/muse',
      PATH: '/usr/bin',
    };
    const env = buildChildEnv({ source });
    expect(env.PATH).toBe('/usr/bin');
    for (const key of ['ACCESS_TOKEN', 'DATABASE_PATH', 'FORGE_MUSE_API_KEY', 'FORGE_MUSE_BIN']) {
      expect(env).not.toHaveProperty(key);
    }
  });

  it('passes the LC_* prefix through and applies overrides last', () => {
    const env = buildChildEnv({
      source: { LC_ALL: 'en_US.UTF-8', LC_CTYPE: 'UTF-8', PATH: '/parent' },
      overrides: { PATH: '/override', EXTRA_APP: 'yes' },
    });
    expect(env.LC_ALL).toBe('en_US.UTF-8');
    expect(env.LC_CTYPE).toBe('UTF-8');
    expect(env.PATH).toBe('/override');
    expect(env.EXTRA_APP).toBe('yes');
  });

  it('treats the allowlist as a CLOSED set — changes need a deliberate test edit', () => {
    // Drift guard in the spirit of the error-catalogue lockstep: adding a key
    // to the shared policy must fail loudly until reviewed (what could drift
    // is a "convenient" addition of a secret-bearing name).
    expect(CHILD_ENV_ALLOWLIST).toEqual([
      'PATH',
      'Path',
      'PATHEXT',
      'SystemRoot',
      'WINDIR',
      'COMSPEC',
      'USERPROFILE',
      'HOMEDRIVE',
      'HOMEPATH',
      'APPDATA',
      'LOCALAPPDATA',
      'PROGRAMDATA',
      'ProgramFiles',
      'ProgramFiles(x86)',
      'CommonProgramFiles',
      'HOME',
      'USER',
      'LOGNAME',
      'SHELL',
      'TMPDIR',
      'TMP',
      'TEMP',
      'LANG',
      'LANGUAGE',
      'TERM',
      'COLORTERM',
      'NO_COLOR',
      'FORCE_COLOR',
      'XDG_CONFIG_HOME',
      'XDG_CACHE_HOME',
      'XDG_DATA_HOME',
      'XDG_STATE_HOME',
      'XDG_RUNTIME_DIR',
      'SSL_CERT_FILE',
      'SSL_CERT_DIR',
      'NODE_EXTRA_CA_CERTS',
      'REQUESTS_CA_BUNDLE',
      'CURL_CA_BUNDLE',
      'GIT_SSL_CAINFO',
      'NIX_SSL_CERT_FILE',
      'HTTPS_PROXY',
      'HTTP_PROXY',
      'ALL_PROXY',
      'NO_PROXY',
      'https_proxy',
      'http_proxy',
      'all_proxy',
      'no_proxy',
      'MML_FAKE_MODE',
    ]);
  });
});

describe('forgeChildEnv', () => {
  it('extends the shared policy with the three test seams and nothing else', () => {
    expect(FORGE_CHILD_ENV_ALLOWLIST).toEqual([
      ...CHILD_ENV_ALLOWLIST,
      'FAKE_MUSE_MODE',
      'FAKE_MUSE_APP',
      'FAKE_MUSE_HTML',
    ]);
    const env = forgeChildEnv({}, { FAKE_MUSE_MODE: 'scripted', ACCESS_TOKEN: 'nope', HOME: '/h' });
    expect(env.FAKE_MUSE_MODE).toBe('scripted');
    expect(env.HOME).toBe('/h');
    expect(env).not.toHaveProperty('ACCESS_TOKEN');
  });
});
