/**
 * Build both production bundles from the current reviewed source with
 * provenance baked in, then record build manifests.
 *
 * - Computes content hashes over the exact source inputs (never mtimes).
 * - Bakes `{commit, source_hash, built_at}` into the server bundle via
 *   esbuild `--define` so the running API can prove its identity through
 *   `/api/meta` (checked again after restart by the live smoke).
 * - Writes `.build-manifest.json` beside each dist output; the live
 *   smoke refuses to start when the tree or the outputs drift from the
 *   manifest. No provider calls happen here or anywhere in this script.
 *
 * The esbuild flags mirror `apps/server/package.json` `build` plus the
 * identity define; keep them in sync if that script changes.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  type BuildManifest,
  collectDistFiles,
  collectSourceFiles,
  describeCurrentTree,
  hashFiles,
  SERVER_SOURCE_DIRS,
  WEB_SOURCE_DIRS,
  writeManifest,
} from './lib/build-provenance.js';

const ROOT = join(import.meta.dirname, '..');

function sh(cmd: string, args: string[], cwd: string): void {
  execFileSync(cmd, args, { cwd, stdio: 'inherit', timeout: 600_000 });
}

function main(): void {
  const tree = describeCurrentTree(ROOT);
  const serverSources = collectSourceFiles(ROOT, SERVER_SOURCE_DIRS);
  const webSources = collectSourceFiles(ROOT, WEB_SOURCE_DIRS);
  const serverHash = hashFiles(ROOT, serverSources);
  const webHash = hashFiles(ROOT, webSources);
  const builtAt = new Date().toISOString();
  const identity = { commit: tree.commit, source_hash: serverHash.hash, built_at: builtAt };

  console.log(`commit ${tree.commit} treeClean=${String(tree.treeClean)}`);
  console.log(`server sources: ${serverHash.hash} (${serverHash.count} files)`);
  console.log(`web sources:    ${webHash.hash} (${webHash.count} files)`);

  // Server bundle with baked identity.
  const defineArg = `__BUILD_IDENTITY__=${JSON.stringify(JSON.stringify(identity))}`;
  sh(
    'pnpm',
    [
      '--filter',
      '@mml/server',
      'exec',
      'esbuild',
      'src/index.ts',
      '--bundle',
      '--platform=node',
      '--target=node22',
      '--format=esm',
      '--packages=external',
      '--alias:@mml/shared=../../packages/shared/src/index.ts',
      '--alias:@mml/memory-engine=../../packages/memory-engine/src/index.ts',
      '--alias:@mml/muse-provider=../../packages/muse-provider/src/index.ts',
      '--alias:@mml/agent-core=../../packages/agent-core/src/index.ts',
      '--alias:@mml/tool-runtime=../../packages/tool-runtime/src/index.ts',
      '--alias:@mml/ui-protocol=../../packages/ui-protocol/src/index.ts',
      '--alias:@mml/decision-guard=../../packages/decision-guard/src/index.ts',
      `--define:${defineArg}`,
      '--outfile=dist/index.js',
      '--sourcemap',
    ],
    join(ROOT, 'apps/server'),
  );

  // Web bundle (identity is proven through the dist manifest, which the
  // harness re-hashes before serving; the static preview exposes nothing).
  sh('pnpm', ['--filter', '@mml/web', 'build'], ROOT);

  const serverDist = join(ROOT, 'apps/server/dist');
  const webDist = join(ROOT, 'apps/web/dist');
  const serverBuilt = hashFiles(serverDist, collectDistFiles(serverDist));
  const webBuilt = hashFiles(webDist, collectDistFiles(webDist));

  const serverManifest: BuildManifest = {
    kind: 'batchc-build-manifest',
    component: 'server',
    commit: tree.commit,
    treeClean: tree.treeClean,
    treeStatus: tree.treeStatus,
    sourceHash: serverHash.hash,
    sourceFiles: serverHash.count,
    buildHash: serverBuilt.hash,
    buildFiles: serverBuilt.count,
    builtAt,
    identity,
  };
  const webManifest: BuildManifest = {
    kind: 'batchc-build-manifest',
    component: 'web',
    commit: tree.commit,
    treeClean: tree.treeClean,
    treeStatus: tree.treeStatus,
    sourceHash: webHash.hash,
    sourceFiles: webHash.count,
    buildHash: webBuilt.hash,
    buildFiles: webBuilt.count,
    builtAt,
    identity: null,
  };
  writeManifest(serverDist, serverManifest);
  writeManifest(webDist, webManifest);
  console.log(`server dist: ${serverBuilt.hash} (${serverBuilt.count} files)`);
  console.log(`web dist:    ${webBuilt.hash} (${webBuilt.count} files)`);
  console.log('manifests written beside each dist output');
}

main();
