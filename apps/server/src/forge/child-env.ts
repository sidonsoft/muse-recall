import { buildChildEnv, CHILD_ENV_ALLOWLIST } from '@mml/shared';

/**
 * Environment for the Forge child process.
 *
 * Uses the shared child-environment policy so Forge and the chat provider
 * cannot drift on certificate, locale, platform or executable-lookup
 * variables. Credentials are not inherited; Forge passes its API key over
 * stdin. The deterministic fixture seams are explicit additions, not a return
 * to full environment inheritance.
 *
 * This reduces accidental disclosure. It is not an operating-system sandbox.
 * See docs/security.md for the residual risk and the CLI's own sandbox flags.
 */
const TEST_SEAMS = ['FAKE_MUSE_MODE', 'FAKE_MUSE_APP', 'FAKE_MUSE_HTML'] as const;

export function forgeChildEnv(
  overrides: NodeJS.ProcessEnv = {},
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return buildChildEnv({ source, overrides, extraKeys: TEST_SEAMS });
}

export const FORGE_CHILD_ENV_ALLOWLIST = [...CHILD_ENV_ALLOWLIST, ...TEST_SEAMS] as const;
