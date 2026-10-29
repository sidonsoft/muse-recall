import type { MemoryCreateInput } from '@mml/shared';

/**
 * The six decisions saved in the 2026-10-29 live run
 * (`docs/hackathon-evidence/live-dsh-run-2026-10-29`, finding F1).
 *
 * Shared by the retrieval unit test and the API/Forge agreement test so both
 * describe the same real-world case rather than drifting fixtures.
 */
export const READING_NOOK_PROJECT_ID = 'reading-nook';

export const READING_NOOK_PROMPT =
  "Build Reading Nook, a reading log for children aged 7 to 10. A child can add books (title, author, total pages), log pages read each day, and see a weekly summary of pages read with a simple bar chart. Finished books move to a 'My Shelf' section with a small celebration message. Set a weekly page goal and show progress towards it. Everything works in one index.html. Follow the saved project decisions, including the colour palette and offline storage in localStorage so nothing is lost on reload.";

export const READING_NOOK_PREFERENCE =
  'Palette: warm — orange, gold and peach on a cream background.';

export const READING_NOOK_TECHNICAL_DECISION =
  'Offline only: store data in localStorage; no network requests and no external scripts, fonts or images.';

export const READING_NOOK_MEMORIES: MemoryCreateInput[] = [
  {
    type: 'constraint',
    scope: 'project',
    project_id: READING_NOOK_PROJECT_ID,
    content: 'No countdown timers or time pressure anywhere in the app.',
  },
  {
    type: 'constraint',
    scope: 'project',
    project_id: READING_NOOK_PROJECT_ID,
    content: 'No flashing or blinking animations.',
  },
  {
    type: 'constraint',
    scope: 'project',
    project_id: READING_NOOK_PROJECT_ID,
    content:
      'Never use colour-only cues: every status (goal met, in progress, finished) must also have a text label or icon, so it works without colour.',
  },
  {
    type: 'constraint',
    scope: 'project',
    project_id: READING_NOOK_PROJECT_ID,
    content:
      'Audience is children aged 7–10: tap targets at least 44px, plain words, an encouraging tone, and no scores or rankings that compare children.',
  },
  {
    type: 'preference',
    scope: 'project',
    project_id: READING_NOOK_PROJECT_ID,
    content: READING_NOOK_PREFERENCE,
  },
  {
    type: 'technical_decision',
    scope: 'project',
    project_id: READING_NOOK_PROJECT_ID,
    content: READING_NOOK_TECHNICAL_DECISION,
  },
];
