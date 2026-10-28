/**
 * Shared child-process environment policy.
 *
 * Both the chat provider and Forge spawn the Muse CLI. The child needs the
 * user's login/home, executable lookup, locale, temporary directories and
 * certificate configuration; it does not need the server's database path,
 * provider keys, or arbitrary code-injection variables. Credentials are
 * delivered over stdin by the adapters, not inherited here.
 *
 * This is a security boundary, not a complete sandbox. It deliberately does
 * not include `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, `NODE_OPTIONS`,
 * `PYTHONPATH`, `PERL5LIB`, or similar executable-injection variables.
 */

const ALLOWED_KEYS = [
  'PATH',
  // Windows preserves the spelling it was given; Node also consults the parent
  // PATH when resolving a child, so both spellings are retained rather than
  // relying on one casing.
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
  // Certificate stores used by Node, curl, Python, OpenSSL and enterprise
  // wrappers. These are configuration, not credentials.
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'GIT_SSL_CAINFO',
  'NIX_SSL_CERT_FILE',
  // Outbound proxy settings are not secrets and may be required on a managed
  // network.
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'all_proxy',
  'no_proxy',
  // Deterministic test seam used by the scripted provider fixture.
  'MML_FAKE_MODE',
] as const;

export const CHILD_ENV_ALLOWLIST = [...ALLOWED_KEYS] as const;

export function buildChildEnv(input: {
  source?: NodeJS.ProcessEnv;
  overrides?: NodeJS.ProcessEnv;
  extraKeys?: readonly string[];
}): NodeJS.ProcessEnv {
  const { source = process.env, overrides = {}, extraKeys = [] } = input;
  const allowed = new Set<string>([...ALLOWED_KEYS, ...extraKeys]);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (allowed.has(key) || key.startsWith('LC_')) env[key] = value;
  }
  // Overrides are trusted application/test values and are applied last.
  return { ...env, ...overrides };
}
