import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { nodeVersionProblem } from '../../scripts/check-node.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-node.mjs', import.meta.url));

/** Run the check as the root scripts do, pretending to be another Node release. */
function runAs(version: string) {
  const fake = `data:text/javascript,Object.defineProperty(process,'version',{value:'${version}'})`;
  return spawnSync(process.execPath, ['--import', fake, SCRIPT], { encoding: 'utf8' });
}

describe('nodeVersionProblem', () => {
  it('accepts Node 24 and newer', () => {
    expect(nodeVersionProblem('v24.0.0')).toBeNull();
    expect(nodeVersionProblem('v26.8.1')).toBeNull();
  });

  it('explains why an older or unreadable version is refused', () => {
    for (const version of ['v22.11.0', 'v18.20.4', 'not-a-version']) {
      const problem = nodeVersionProblem(version);
      expect(problem, version).toContain('Node.js 24 or newer');
      expect(problem, version).toContain('node:sqlite');
      expect(problem, version).toContain(version);
    }
  });
});

describe('scripts/check-node.mjs', () => {
  it('exits non-zero with a clear message on Node 22', () => {
    const result = runAs('v22.11.0');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Muse Recall needs Node.js 24 or newer; this is Node.js v22.11.0.',
    );
  });

  it('exits cleanly on Node 24', () => {
    const result = runAs('v24.11.1');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
