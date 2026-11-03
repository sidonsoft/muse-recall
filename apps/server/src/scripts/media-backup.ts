import { loadConfig, loadDotEnv } from '../config.js';
import { ForgeWorkspace } from '../forge/workspace.js';
import { backupMedia, defaultMediaBackupPath } from '../media/backup.js';

/** `pnpm media:backup [destination]` — hash-verified media bundle. */
async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const workspace = new ForgeWorkspace(config.workspaceRoot);
  const destination = process.argv[2] ?? defaultMediaBackupPath(workspace);
  const backup = await backupMedia(workspace, destination);
  console.log(`workspace: ${backup.source}`);
  console.log(`backup: ${backup.destination}`);
  console.log(`projects: ${String(backup.projects.length)}`);
  console.log(`files: ${String(backup.totals.files)} (${String(backup.totals.bytes)} bytes)`);
}

main().catch((error: unknown) => {
  console.error('Media backup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
