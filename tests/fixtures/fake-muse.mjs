#!/usr/bin/env node
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const workspace = value('--workspace');
const promptPath = value('--prompt-file');
const prompt = promptPath ? readFileSync(promptPath, 'utf8') : '';
const requested = process.env.FAKE_MUSE_MODE ?? 'auto';
const mode =
  requested === 'auto'
    ? (prompt.includes('current approved game') && prompt.includes('index.html')
        ? 'modify'
        : 'generate')
    : requested;
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const usage = (calls, input = 100, output = 10) =>
  emit({
    payload_type: 'run.usage',
    payload: { calls, models: [{ input_tokens: input, output_tokens: output }] },
  });
const done = (text) =>
  emit({ payload_type: 'run.terminal', payload: { terminal: 'completed', text } });

function html(marker) {
  return `<!doctype html><html><head><title>Fake Game</title></head><body>
<canvas id="game"></canvas>
<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>
<script>const MARKER = '${marker}'; const FARM_MARKER = 'keep-me';</script>
</body></html>`;
}

if (!workspace) {
  process.stderr.write('missing --workspace\n');
  process.exit(2);
}

if (mode === 'sleep') {
  setTimeout(() => {
    usage(1);
    done('slow');
  }, 30_000);
} else if (mode === 'fail') {
  process.stderr.write('fake failure\n');
  process.exit(1);
} else if (mode === 'symlink') {
  symlinkSync('/etc/passwd', join(workspace, 'index.html'));
  usage(1);
  done('symlinked');
} else if (mode === 'invalid') {
  writeFileSync(join(workspace, 'index.html'), '<html><body>not a game</body></html>');
  usage(1);
  done('invalid');
} else if (mode === 'budget') {
  writeFileSync(join(workspace, 'index.html'), html('budget'));
  usage(99, 5_000_000);
  done('budget');
} else if (mode === 'modify') {
  const file = join(workspace, 'index.html');
  const existing = readFileSync(file, 'utf8');
  if (!existing.includes('FARM_MARKER')) {
    process.stderr.write('expected the approved game to be seeded into staging\n');
    process.exit(3);
  }
  const updated = existing
    .replace('<title>Fake Game</title>', '<title>Fake Game v2</title>')
    .replace('</body>', '<script>const CHANGE_MARKER = \'v2\';</script></body>');
  writeFileSync(file, updated);
  usage(2);
  done('modified');
} else {
  writeFileSync(join(workspace, 'index.html'), html('v1'));
  usage(2);
  done('generated');
}
