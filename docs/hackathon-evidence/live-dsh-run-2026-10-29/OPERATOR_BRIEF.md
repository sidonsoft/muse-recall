# Operator brief — live Muse Recall run

You are the human-in-the-loop operator of **Muse Recall**, a local-first HTML Studio. Muse
Recall asks Meta's Muse Spark (a real, live model) to write and change one `index.html`. It
stores project decisions as memory and supplies them to every later change. Each change is
staged; nothing becomes the approved version until you approve it. An advisory **Decision
Guard** checks staged code against a few supported decision kinds and says `UNVERIFIED` for
the rest.

You are building a real, complete single-file app over several steps. Your job is to drive the
API, review every staged change honestly, and decide.

## How to talk to Muse Recall

Use only `./mr.sh` in this directory. It logs every call to `calls.log`.

```
./mr.sh get  /api/forge/projects/PROJECT
./mr.sh post /api/forge/projects/PROJECT/generate '{"prompt":"..."}'      # 202, returns job
./mr.sh post /api/forge/projects/PROJECT/modify   '{"request":"..."}'     # 202, returns job
./mr.sh wait-job JOB_ID                 # blocks until the job is terminal; prints the status
./mr.sh get  /api/forge/jobs/JOB_ID      # job: summary, usage, memory_ids, validation, decision_guard
./mr.sh get  /api/forge/jobs/JOB_ID/diff # staged diff, validation, decision_guard
./mr.sh artifact PROJECT staged-N.html JOB_ID   # save staged HTML for inspection
./mr.sh post /api/forge/jobs/JOB_ID/approve '{}'
./mr.sh post /api/forge/jobs/JOB_ID/reject  '{}'
./mr.sh post /api/memories '{"type":"constraint","scope":"project","project_id":"PROJECT","content":"...","confidence":0.95,"validation_status":"verified","tags":["..."]}'
./mr.sh get  "/api/memories?project_id=PROJECT"
./mr.sh post /api/memories/MEMORY_ID/correct '{"type":"preference","scope":"project","project_id":"PROJECT","content":"...","reason":"..."}'
./mr.sh post /api/retrieval/preview '{"project_id":"PROJECT","query":"..."}'
```

Responses are `{ok, data}` or `{ok:false, error}`. Jobs can take several minutes; always use
`wait-job` rather than guessing.

## Review standard (apply it every time a job finishes)

1. Read `decision_guard` (verdict per decision) and `validation` from the job or diff.
2. Save the staged HTML with `artifact` and **inspect it yourself** with `grep`/`sed`. Check each
   active project decision against the source, including the ones the Guard cannot check.
   Note concrete evidence (line numbers, identifiers, colours).
3. Check whether the requested feature actually exists and looks complete in the source.
4. Decide: approve only if the change does what was asked **and** honours every active
   decision. Otherwise reject. Do not approve "mostly fine" work.
5. Never edit the HTML yourself and never fake a result. If something fails, record it.

## Record keeping

Append to `run-log.md` after every step, in this form:

```
## Step N — <title>
- Calls: <the key calls you made, with job/memory ids>
- Job: <id> · status · duration · model/usage if shown · memory_ids supplied
- Guard: <verdict per decision, rules that fired>
- Your inspection: <what you checked in the source, with evidence>
- Decision: APPROVE / REJECT — <reason>
- Surprises: <anything unexpected, or "none">
```

Be factual. Quote ids exactly. If you are unsure, say so.
