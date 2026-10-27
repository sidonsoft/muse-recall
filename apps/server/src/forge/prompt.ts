import type { ForgeJobKind } from '@mml/shared';

/**
 * The one production prompt builder for Forge jobs.
 *
 * Muse Recall builds *browser applications*, not only games. The prompt keeps
 * the output contract narrow — one `index.html`, no build step, no network
 * beyond the approved CDN — while leaving the application kind to the request.
 * Games remain a supported case and keep Phaser 3 as their engine.
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
  /** A preview screenshot is attached to this modify request. */
  hasScreenshot?: boolean;
}

export function buildForgePrompt(input: ForgePromptInput): string {
  const memory = input.memoryBlock
    ? `\nProject design decisions from previous sessions (authoritative unless contradicted):\n${input.memoryBlock}\n`
    : '';
  if (input.kind === 'generate') {
    return [
      'Create a working browser application in this workspace.',
      'Write exactly one file: index.html. It must be a complete HTML document with its own CSS and JavaScript, and it must run immediately with no build step.',
      'Include a responsive layout, clear interaction states, and readable text. Keep the implementation self-contained: inline CSS and JavaScript, no other files, and no network assets other than the approved CDN https://cdn.jsdelivr.net.',
      'If the request is a game, use Phaser 3 from https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js with a canvas, start/restart, mouse and touch input, score or progress, a win condition, and responsive scaling.',
      'After writing, run node --check on every inline script and fix any syntax error.',
      memory,
      'Application request:',
      input.prompt,
    ].join('\n');
  }
  const screenshot = input.hasScreenshot
    ? 'The attached screenshot is the current rendered preview. Use it to understand the visual result.'
    : 'No screenshot is attached; read the current index.html source to understand the visual result.';
  return [
    'The current approved application is already in this workspace at index.html.',
    'Edit that file in place: keep every part of the existing implementation that the request does not ask you to change.',
    'Modify index.html only; do not regenerate the application from scratch.',
    screenshot,
    'Apply the requested change while preserving behaviour the request does not mention, including existing controls, state handling, and responsive layout.',
    'Keep the existing runtime and dependencies (including Phaser 3 if present). Do not add libraries or other files. After editing, run node --check on every inline script.',
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
