import { loadConfig, loadDotEnv } from '../config.js';
import { ForgeWorkspace } from '../forge/workspace.js';
import { restoreMedia } from '../media/backup.js';

/** `pnpm media:restore <bundle> [--force]` — isolated restore by default. */
async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const bundle = process.argv[2];
  if (!bundle) throw new Error('usage: media:restore <bundle-directory> [--force]');
  const workspace = new ForgeWorkspace(config.workspaceRoot);
  const restored = await restoreMedia(bundle, workspace, {
    force: process.argv.includes('--force'),
  });
  console.log(`bundle: ${restored.source}`);
  console.log(`workspace: ${restored.target}`);
  console.log(`projects: ${restored.projects.join(', ')}`);
  console.log(`files: ${String(restored.files)} (${String(restored.bytes)} bytes)`);
  for (const warning of restored.warnings) console.log(`warning: ${warning}`);
}

main().catch((error: unknown) => {
  console.error('Media restore failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
