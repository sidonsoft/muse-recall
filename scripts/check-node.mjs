#!/usr/bin/env node
/**
 * Refuse to start on a Node.js release older than 24.
 *
 * Muse Recall stores memory with the built-in `node:sqlite` module. On older
 * releases that import fails deep inside a workspace package with an error
 * that does not mention the Node version, so the root scripts run this first.
 *
 * Plain JavaScript with no imports, so it runs before `pnpm install` and on any
 * Node release that can parse an ES module.
 */
export const MINIMUM_NODE_MAJOR = 24;

/** Return a human-readable problem for an unsupported version, or null. */
export function nodeVersionProblem(version) {
  const major = Number(/^v?(\d+)\./.exec(version)?.[1]);
  if (Number.isInteger(major) && major >= MINIMUM_NODE_MAJOR) return null;
  return [
    `Muse Recall needs Node.js ${MINIMUM_NODE_MAJOR} or newer; this is Node.js ${version}.`,
    'It stores memory with the built-in node:sqlite module, which older releases lack.',
    `Install Node.js ${MINIMUM_NODE_MAJOR} (for example \`nvm install ${MINIMUM_NODE_MAJOR}\`), or open the`,
    'repository in GitHub Codespaces, which provides it.',
  ].join('\n');
}

const problem = nodeVersionProblem(process.version);
if (problem !== null) {
  console.error(`\nError: ${problem}\n`);
  process.exit(1);
}
