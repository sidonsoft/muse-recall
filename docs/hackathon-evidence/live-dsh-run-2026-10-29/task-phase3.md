Continue the same run. Keep following BRIEF.md and keep appending to run-log.md. Version 1 is the current approved version.

Step 6 — Correct a decision. The owner has changed their mind about colours. Correct the palette
preference ea63df00-bbdb-4faa-99c9-4706e9e6db5b with POST /api/memories/ea63df00-bbdb-4faa-99c9-4706e9e6db5b/correct and body
{"type":"preference","scope":"project","project_id":"reading-nook","content":"Palette: cool — teal and navy on a soft white background. The warm orange palette is retired.","reason":"Owner prefers a calmer, cooler look for bedtime reading."}
Record the new memory id. Confirm with GET /api/memories/<old id> that the old record is superseded and see its history.

Step 7 — An unrelated change after the correction. Request this modification exactly (it deliberately does not mention colour):
"Add a Book notes box so a child can write one sentence about each finished book on My Shelf."
Wait, then review with the full standard. Check specifically: which memory ids were supplied (is the NEW palette decision among them?), what the Guard says about the palette, and which palette the staged source actually uses. Apply the review standard strictly: the current palette decision is the corrected cool one. APPROVE or REJECT. Do not retry Step 7.

Step 8 — Ask for the correction explicitly. Request this modification exactly:
"Apply the current palette decision from memory to the whole app."
Wait, review with the full standard, including whether any warm/orange colour remains and what the Guard reports. APPROVE or REJECT. If rejected, you may submit ONE further modification you write yourself naming the specific problems, then review and decide.

Finish by printing a short summary of steps 6–8: memory ids, job ids, supplied memory ids per job, guard verdicts, decisions.
