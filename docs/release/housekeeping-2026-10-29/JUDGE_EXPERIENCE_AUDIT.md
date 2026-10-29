# Judge experience audit — 29 October 2026

Perspective: a judge who has never heard of Muse Recall, has a few minutes, and does not want to
install anything.

## The 30-second test

| Surface | What a judge learns in 30 s | Verdict |
| --- | --- | --- |
| **Website** (sidonsoft.github.io/muse-recall-website) | Headline, the problem, the loop, an interactive memory on/off/corrected widget, and the video above the fold. Lighthouse-grade performance (LCP 488 ms), works on phones and without JS. | **Pass** |
| **GitHub README** | Title, one-line promise, a three-sentence problem statement, the Studio screenshot and the video poster, then "For judges" with the three ideas and the headline 37/57 → 0/58 result. | **Pass** — after this cleanup the first line no longer carries a stale "goes live with one Pages toggle". |
| **Demo video** (2:50) | Memory saved, change rejected, decision corrected, Guard flags the reintroduced palette, v2 approved. Captions and transcript provided. | **Pass** |

README, website hero and website `<title>` lead with the same line ("Correctable
project memory for AI-built software"); the app header says "Build with Muse Spark. Remember what
matters." The release brief's phrase "The memory your project
keeps" does not appear anywhere yet; adopting it is a copy decision for the owner and is listed
in [DEFERRED_IMPROVEMENTS.md](DEFERRED_IMPROVEMENTS.md).

## The three-minute test

| Path | Effort | What works |
| --- | --- | --- |
| Watch the video | None | Whole story, live Muse Spark session |
| **Codespaces badge** | One click, a few minutes of setup | Seeded project, memory with provenance and a superseded decision, retrieval explanation, Guard, version history, rollback. Offline provider is clearly labelled; generation needs the Muse CLI. **Not yet opened in a real codespace.** |
| Local clone | Node 24 + pnpm, five commands | Same as Codespaces |

There is no hosted copy of the app and there should not be: the API is loopback-only with no
authentication. The README and guide say so plainly, which reads as deliberate rather than
missing.

## The seven README questions

| Question | Where it is answered | OK |
| --- | --- | --- |
| What is it? | Title + first paragraph | ✓ |
| What problem? | "AI app builders forget…" | ✓ |
| What's different? | "For judges" 1–3: provenance, supersession, review-before-publish | ✓ |
| How can I try it? | "Try it": Codespaces badge, local five-liner, user guide | ✓ |
| How does it work? | Architecture, Memory engine, API sections; `docs/guide/architecture.md` | ✓ |
| Where is the evidence? | "What the evidence shows", Phase 17 results, evidence map | ✓ |
| How do I run it myself? | Quickstart | ✓ |

Prominent links present: live website, video (mp4, captions, transcript), research results,
architecture, quick start, user guide.

## Application walk-through (seeded demo, offline provider)

- **Studio (desktop):** clean three-panel layout, approved v1 game in the preview, active and
  superseded decisions visible with strikethrough, Guard explains what it does and does not
  check, version history with hash. Strong first impression.
- **Studio (tablet/phone):** panels overlapped before this cleanup; now stack cleanly.
- **Memory:** filters, counts, provenance, history, retrieval explanation tab. Clear.
- **Conversations:** in offline mode the reply echoes the assembled prompt, including the system
  rules. Honest and labelled, but technical; a judge in Codespaces should be steered to the Studio
  and Memory views first (the guide already does this).
- **System:** amber banner "The deterministic offline provider is active — this is not Muse Spark".
  Good disclosure.
- **Failure states:** API unreachable shows a clear recovery card with the command to run.

## Consistency of the story

Website, README, video and app all tell the same loop: remember → correct → review/approve →
roll back, with Guard advisory only. Research evidence (Phase 17, 480 runs) is kept in its own
section and labelled by evidence class, separate from product claims. Internal phase names
appear in the README's status table and evidence section but not in the opening screen.

## Recommendations before submitting

1. Open the Codespaces badge once and click through Studio → Memory.
2. Confirm the GitHub Wiki tab is disabled (docs live in `docs/`).
3. Keep the website URL stable through the website move, or update the README link in the same PR.
