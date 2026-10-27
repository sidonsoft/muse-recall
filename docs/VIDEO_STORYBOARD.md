# Video storyboard — 3 minutes

> **SUPERSEDED — historical document.** The canonical storyboard is
> [submission/V2_DEMO_RECORDING_PLAN.md](submission/V2_DEMO_RECORDING_PLAN.md). This file is
> retained for history and must not be used for the V2 recording.

Not recorded yet. This is the shot list and narration. Record on a fresh database with
`pnpm dev`, browser at 1440×900, zoom 100%, no personal data on screen.

| Time | Screen action | Narration |
| --- | --- | --- |
| 0:00–0:12 | System screen, live Muse check already verified | "Every AI assistant forgets your project between sessions. You re-explain, it drifts, stale advice piles up." |
| 0:12–0:20 | Cut to Conversations, empty state | "Muse Recall gives Meta Muse persistent, correctable project memory — and lets it act on that memory with your authorization." |
| 0:20–0:55 | New conversation `montys-memory-meadow`; send the requirements message; show the green "Saved 3 memory records"; open a **new** conversation; ask the recall question; expand **Memory used** | "Three requirements, stated once. A brand-new session answers with Phaser, mobile web, and the art direction — and the retrieval panel shows exactly which memories were provided, with zero conversation history." |
| 0:55–1:20 | New conversation; correction message; Memories view showing `superseded` + chain; new conversation asks about the platform | "When a decision changes, the old memory is superseded, not overwritten. Its history stays auditable, but only the current fact is ever retrieved. Muse answers desktop browsers — and can explain what changed." |
| 1:20–1:55 | Ask Muse to plan the first milestone; the 8-field form appears; fill two fields; submit; show the plan + "saved as project memory" | "Instead of a wall of text, Muse designs the interface it needs — a validated planning form rendered by a fixed component registry. No model-written code runs. The submission returns structured data, becomes project memory, and drives the next turn." |
| 1:55–2:25 | Tool activity shows two `pending` calls; click Approve twice; show `executed` and task list; new conversation asks for a summary | "Submitting the plan asks Muse to create tasks. Writes are held for explicit approval; reads are not. Every call is audited. A fresh session summarises the project, the current platform, and the planned tasks." |
| 2:25–2:45 | Cut to `docs/EVALUATION_REPORT.md` table and `showcase.json` | "We measured it: n equals four per configuration, four of four correct in both, with memory adding about sixty-eight tokens per call and removing setup turns entirely. Tool approval and isolation are covered by integration tests." |
| 2:45–3:00 | README / repository | "Muse Recall: memory that persists, corrects itself, explains itself, and turns plans into authorized action. Open source, local-first, built on Meta Muse." |

## Recording notes

- Pre-warm the app: run the live check once before recording so streaming starts quickly.
- Keep each Muse call's latency visible where possible (the UI shows token/latency stats).
- If a generation call is slow, cut the wait — do not fake the result.
- Do not show `.env`, terminal secrets, or personal notifications.
