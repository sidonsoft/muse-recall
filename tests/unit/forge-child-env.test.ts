import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { forgeChildEnv } from '../../apps/server/src/forge/child-env.js';

describe('Forge child environment', () => {
  it('keeps the login/home and executable path the CLI needs', () => {
    const env = forgeChildEnv(
      {},
      {
        PATH: '/usr/bin',
        HOME: '/Users/local',
        USER: 'local',
        LANG: 'en_AU.UTF-8',
        LC_CTYPE: 'UTF-8',
      },
    );
    expect(env).toMatchObject({
      PATH: '/usr/bin',
      HOME: '/Users/local',
      USER: 'local',
      LANG: 'en_AU.UTF-8',
      LC_CTYPE: 'UTF-8',
    });
  });

  it('does not inherit application secrets or storage paths', () => {
    const env = forgeChildEnv(
      {},
      {
        PATH: '/usr/bin',
        HOME: '/Users/local',
        FORGE_MUSE_API_KEY: 'forge-secret',
        FORGE_FALLBACK_API_KEY: 'fallback-secret',
        META_API_KEY: 'meta-secret',
        DATABASE_PATH: '/Users/local/private/memory.db',
        WORKSPACE_ROOT: '/Users/local/private/workspaces',
        NODE_OPTIONS: '--require=/tmp/inject.cjs',
      },
    );
    expect(env).not.toHaveProperty('FORGE_MUSE_API_KEY');
    expect(env).not.toHaveProperty('FORGE_FALLBACK_API_KEY');
    expect(env).not.toHaveProperty('META_API_KEY');
    expect(env).not.toHaveProperty('DATABASE_PATH');
    expect(env).not.toHaveProperty('WORKSPACE_ROOT');
    expect(env).not.toHaveProperty('NODE_OPTIONS');
  });

  it('preserves certificate and platform configuration without allowing code injection', () => {
    const env = forgeChildEnv(
      {},
      {
        Path: 'C:\\Windows\\System32',
        PATHEXT: '.EXE;.CMD',
        SystemRoot: 'C:\\Windows',
        USERPROFILE: 'C:\\Users\\local',
        SSL_CERT_FILE: '/etc/ssl/cert.pem',
        NODE_EXTRA_CA_CERTS: '/etc/ssl/extra.pem',
        CURL_CA_BUNDLE: '/etc/ssl/curl.pem',
        MML_FAKE_MODE: 'ok',
        LD_PRELOAD: '/tmp/inject.so',
        DYLD_INSERT_LIBRARIES: '/tmp/inject.dylib',
        PYTHONPATH: '/tmp/python',
        NODE_OPTIONS: '--require=/tmp/inject.cjs',
      },
    );
    expect(env).toMatchObject({
      Path: 'C:\\Windows\\System32',
      PATHEXT: '.EXE;.CMD',
      SystemRoot: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\local',
      SSL_CERT_FILE: '/etc/ssl/cert.pem',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/extra.pem',
      CURL_CA_BUNDLE: '/etc/ssl/curl.pem',
      MML_FAKE_MODE: 'ok',
    });
    expect(env).not.toHaveProperty('LD_PRELOAD');
    expect(env).not.toHaveProperty('DYLD_INSERT_LIBRARIES');
    expect(env).not.toHaveProperty('PYTHONPATH');
    expect(env).not.toHaveProperty('NODE_OPTIONS');
  });

  it('applies explicit test overrides last', () => {
    const env = forgeChildEnv(
      { FAKE_MUSE_MODE: 'auto', PATH: '/fixture/bin' },
      { PATH: '/usr/bin', HOME: '/Users/local' },
    );
    expect(env.PATH).toBe('/fixture/bin');
    expect(env.FAKE_MUSE_MODE).toBe('auto');
  });

  it.runIf(process.platform !== 'win32')(
    'can resolve an executable through the allow-listed PATH',
    () => {
      const env = forgeChildEnv({}, process.env);
      const result = spawnSync('node', ['-e', 'process.stdout.write("ok")'], {
        env,
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('ok');
    },
  );
});
