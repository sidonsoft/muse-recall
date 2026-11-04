/** Shared by setup readiness and approval-time browser verification. */
export type BrowserPolicy = 'managed' | 'chrome';

export function browserPolicy(env: NodeJS.ProcessEnv = process.env): BrowserPolicy | null {
  const configured =
    env.FORGE_RUNTIME_BROWSER ?? (env.FORGE_RUNTIME_CHANNEL === 'chrome' ? 'chrome' : 'managed');
  return configured === 'managed' || configured === 'chrome' ? configured : null;
}
