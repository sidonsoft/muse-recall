import type { ForgeJobKind } from '@mml/shared';

/**
 * The one production prompt builder for Forge jobs.
 *
 * The evaluation harness imports this function instead of mirroring it, so a
 * change to production wording cannot silently diverge from what the tests
 * measure. Output ordering is part of the contract (see the byte fixtures).
 */
export interface ForgePromptInput {
  kind: ForgeJobKind;
  prompt: string;
  request?: string | null;
  memoryBlock?: string;
}

export function buildForgePrompt(input: ForgePromptInput): string {
  const memory = input.memoryBlock
    ? `\nProject design decisions from previous sessions (authoritative unless contradicted):\n${input.memoryBlock}\n`
    : '';
  if (input.kind === 'generate') {
    return [
      'Create a playable browser game in this workspace.',
      'Write exactly one file: index.html. Use Phaser 3 from https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js.',
      'It must be a complete single-file game: canvas, start/restart, mouse and touch input, score or progress, a win condition, responsive scaling, and readable text.',
      'Do not add other files, do not use a build step, and do not load assets from the network other than Phaser.',
      'After writing, run node --check on the inline script and fix any syntax error.',
      memory,
      'Game description:',
      input.prompt,
    ].join('\n');
  }
  return [
    'The current approved game is already in this workspace at index.html.',
    'Edit that file in place: keep every part of the existing implementation that the request does not ask you to change.',
    'Modify index.html only; do not regenerate the game from scratch.',
    'The attached screenshot is the current rendered preview. Use it to understand the visual result.',
    'Apply the requested visual change while preserving gameplay: cards, matching, score, restart, win condition, mouse/touch, and responsive layout.',
    'Keep the existing Phaser 3 CDN and Phaser.Game initialisation. Do not replace the engine with vanilla JavaScript and do not add libraries.',
    'Do not add other files or dependencies. After editing, run node --check on the inline script.',
    memory,
    'Requested change:',
    input.request ?? input.prompt,
  ].join('\n');
}

/**
 * Retrieval query for a job. The project id scopes retrieval; the task text is
 * the request, not a duplicated copy of it. Shared with the evaluation harness
 * so retrieval cannot drift from production.
 */
export function buildRetrievalQuery(input: {
  projectId: string;
  kind: ForgeJobKind;
  prompt: string;
  request?: string | null;
}): string {
  const task = input.kind === 'modify' ? (input.request ?? input.prompt) : input.prompt;
  return `${input.projectId}\n${task}`;
}
