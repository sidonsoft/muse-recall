# Phase 15B — original run configuration, as found in the runner

This is a description of the configuration **actually used by the recovered runner**, not a
configuration file that existed separately. `tools/pilot-15b.mjs` hard-codes it. The runner is
published unchanged; this document records what it contains.

## Entry point and fixed inputs

| | |
|---|---|
| Command | `node node_modules/tsx/dist/cli.mjs video/tools/pilot-15b.mjs trial` |
| Trial branch | `agent/phase15b` @ `9f5eaa19698f6b969b53671cc7fca5fb0fafd415` |
| Model | `muse-spark-1.3-contributor` |
| Reasoning effort | `high` |
| Provider | Meta API via the Forge `muse-cli` path; key read from `~/.zshrc` (`FORGE_MUSE_API_KEY`) |
| Baseline | `video/probe/baseline/sky-pairs-high-cand2.html` |
| Baseline SHA-256 | `5385c5582dac572351c29ee0c1bba128609a49bc5ba171db03f656e065bdee03` |
| Request | `Make the game more exciting and challenging, like an arcade game.` |
| Replicates | 16 per condition (32 total) |
| Seed | `0x15B2026` (decimal 22 749 222) |

## Order formula actually used

```js
const TRIAL_SEED = 0x15B2026;
for (let i = 0; i < 16; i++) {
  for (const memory of [false, true]) {
    const digest = createHash('sha256')
      .update(`${TRIAL_SEED}:${i}:${memory}`)
      .digest('hex');
    // id = mem-<i+1> or nomem-<i+1>; sort ascending by digest
  }
}
```

The seed is interpolated in **decimal**, the run index is **0-based**, the condition is the
lower-case string `true` or `false`, and the fields are separated by `:`. The protocol text says
`sha256(seed || index)`. The actual input is therefore
`sha256("22749222:<i>:<true|false>")`. See `../DEVIATIONS.md` Deviation A.

Recomputing this order reproduces the order of `trial-results.json` exactly (verified during
integration).

## Server environment per run

Each run gets a fresh temporary database and workspace. The server is started on
`127.0.0.1:8919` with:

| Variable | Value |
|---|---|
| `HOST` | `127.0.0.1` |
| `PORT` | `8919` |
| `LOG_LEVEL` | `warn` |
| `DATABASE_PATH` | temporary file per run |
| `WORKSPACE_ROOT` | temporary directory per run |
| `SQLITE_WAL` | `false` |
| `MODEL_PROVIDER` | `muse-cli` |
| `MUSE_MODEL` | `muse-spark-1.3-contributor` |
| `MUSE_REASONING_EFFORT` | `high` |
| `FORGE_MUSE_API_KEY` | the funded key (not retained) |
| `FORGE_MUSE_MODEL` | `muse-spark-1.3-contributor` |
| `FORGE_FALLBACK_API_KEY` | the same key |
| `FORGE_FALLBACK_MODEL` | the same model |
| `FORGE_REASONING_EFFORT` | `high` |
| `FORGE_MAX_RUNTIME_MS` | `600000` |
| `FORGE_MAX_CALLS` | `40` |
| `FORGE_MAX_INPUT_TOKENS` | `6000000` |
| `TOOLS_ENABLED` | `false` |
| `CORS_ORIGINS` | `http://127.0.0.1:5219` |

`FORGE_FALLBACK_*` being set to the same key and model contradicts the protocol's "no failover"
line. Whether it ever activated cannot be established from retained records. See
`../DEVIATIONS.md` Deviation B.

## Condition setup

1. `seedForgeDemo()` creates project `forge-demo`, seeds the approved baseline as version 1 and
   inserts the demo decision set through the production memory engine.
2. **Memory arm:** the full seeded decision set is left in place — the child-safety rule, the
   active ocean palette decision and the superseded sunset palette decision.
3. **No-memory arm:** every memory row for the project is deleted with a direct SQL `DELETE`.
4. `POST /api/forge/projects/forge-demo/modify` with the fixed request and a PNG screenshot of the
   baseline.
5. The job is polled to a terminal state; the staged `index.html` is copied out and hashed.

## What the runner did not record

- No `run.model.configured` value, so the model is attributed by configuration only.
- No retrieved memory identifiers.
- No per-run timestamps.
- Diffs read from `diff.data.diff`, which the API does not return; every recorded diff is empty.
- The file header comment still describes a four-run pilot, although `trial` mode runs 32. The
  comment is stale; the code path above is what executed.

## Paths on this host

The recovered copies live under `docs/hackathon-evidence/phase15b/recovered/`. `analyze-15b.py`
resolves its inputs relative to `video/` and therefore will not run unmodified from this
directory; this is a path-layout difference, not a change to the analysis. Re-running it against
the preserved inputs reproduces the published `analysis.json` (verified during integration by
supplying the equivalent paths in a scratch copy).
