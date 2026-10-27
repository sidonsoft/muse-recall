# Phase 15B — human-coding disclosure

**Status: no per-run human coding table was preserved.** Nothing in this document reconstructs
one.

## What the protocol required

Protocol §4 required the same files to be "coded twice: once by script, once by a human against the
same rubric, with disagreements reported rather than resolved in favour of the hypothesis."

## What actually survives

A human pass did occur. Its findings are described **narratively** in
[`RESULTS.md`](RESULTS.md) §3:

1. The v1 penalty test matched the substring `penalt`, so it fired on text *advertising* compliance
   (`'STREAK BONUS • NO TIMERS • NO PENALTIES'`, `// never a penalty or timer`). All five
   memory-arm v1 flags were of this kind; none of those runs implemented a penalty.
2. The v1 timer test required a named game-over token (`gameOver`, `TIME UP`), so code that called
   its own end routine was missed, under-counting the no-memory arm.

Those findings motivated the v2 coder.

## What does not survive

- Any per-run human judgement (violation / no violation) for the 32 trial outputs.
- The human's evidence notes, the order in which runs were reviewed, or the time spent.
- Any record of disagreement resolution beyond the two defect descriptions above.
- Any blinding record. The protocol itself says the coder was not blind to condition.

## Search performed

During release integration the original worktree, the `video/` tree, the committed evidence
directory and the surrounding project directories were searched for a human-coding table, CSV,
spreadsheet or notes file. None was found. The only human-coding content is the narrative above.

## Why this matters

The narrative human review is **not** equivalent to blinded human coding:

- it is a description of two coder defects, not an independent per-run classification;
- it was produced by someone who could see the condition while reviewing;
- it is not reproducible run by run.

No claim in the release materials may describe the trial as "human coded" or as having a
"second blinded coder". The accurate description is: **automated coding with two preserved outputs
(v1 and a post-hoc v2), plus a narrative human review of the v1 defects.**

## Post-hoc review

No new independent per-run review is published here. If one is later commissioned, it must be dated,
labelled post-hoc and non-confirmatory, and kept separate from the 32-run result. It must not be
presented as the missing human-coding table.
