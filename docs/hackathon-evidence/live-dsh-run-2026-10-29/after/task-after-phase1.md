Read BRIEF.md in this directory first and follow it exactly.

Project id: `reading-nook`. App: **Reading Nook**, a reading log for children aged 7–10.

Step 1 — Set up the project and its decisions.
- Create the project: POST /api/forge/projects with {"project_id":"reading-nook","name":"Reading Nook"}.
- Save these six project decisions verbatim (scope project, project_id reading-nook, confidence 0.95, validation_status verified). Record each memory id.
  1. constraint: "No countdown timers or time pressure anywhere in the app."
  2. constraint: "No flashing or blinking animations."
  3. constraint: "Never use colour-only cues: every status (goal met, in progress, finished) must also have a text label or icon, so it works without colour."
  4. preference: "Palette: warm — orange, gold and peach on a cream background."
  5. technical_decision: "Offline only: store data in localStorage; no network requests and no external scripts, fonts or images."
  6. constraint: "Audience is children aged 7–10: tap targets at least 44px, plain words, an encouraging tone, and no scores or rankings that compare children."
- Run a retrieval preview for query "build the reading log app" and note which decisions it would supply.

Step 2 — Generate v1. Submit exactly this generate prompt:
"Build Reading Nook, a reading log for children aged 7 to 10. A child can add books (title, author, total pages), log pages read each day, and see a weekly summary of pages read with a simple bar chart. Finished books move to a 'My Shelf' section with a small celebration message. Set a weekly page goal and show progress towards it. Everything works in one index.html."
Wait for the job.

Step 3 — Review v1 using the review standard and APPROVE or REJECT. If you reject, write in run-log.md exactly what was wrong; do not retry yet.

Finish by printing a short summary: memory ids, job id, guard verdicts, your decision.

Protocol rule for every step: immediately before and immediately after each approve or reject, GET the job and confirm its server status, and record both in run-log.md. Never write that an action happened unless calls.log shows it.
