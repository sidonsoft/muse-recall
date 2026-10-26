# Hackathon requirements review

**Reviewed:** 2026-10-27
**Event:** Meta Global AI Developer Hackathon (Meta + Cerebral Valley)

## Sources consulted

| Source | URL | Status |
| --- | --- | --- |
| Official event page | https://cerebralvalley.ai/e/meta-ai-developer-hackathon | Retrieved (HTTP 200) |
| Event waiver page | https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver | Returned a client-side “Loading…” shell; text not retrievable |
| Official rules page (`/rules`, `/official-rules`, `/terms`) | same host | 404 — not published at these paths |

Third-party summaries were seen in search results but were **not** used as requirements.
Only the official event page is treated as a source of fact.

## What the official page states

- Event dates: **Oct 26 – Nov 4, 2026**, remote; submissions due **Nov 4, 9:00 PM ET**.
- Two tracks (indie developer, startup) and two themes.
- Applications were reviewed for selection; participation was capped.
- **“Official Rules will be published before the Hackathon begins on October 26, 2026 and
  must be accepted by the selected participants.”**

## What the official page does **not** state

As of this review, the page does not say whether:

- the repository must be **public**;
- a **new** repository is required;
- **private** repositories are acceptable during development or at submission;
- development must occur **entirely within** the event window;
- pre-existing code or libraries are permitted (beyond ordinary open-source dependency use);
- specific **GitHub evidence** (commit activity, timestamps) is required.

## Consequence: documented uncertainty

Because the Official Rules were not retrievable, this repository does **not** assert
compliance with any of the points above. The following decisions were made conservatively:

| Decision | Rationale |
| --- | --- |
| Repository created **private** initially | The checkpoint instructions prefer private initially, subject to rules; the rules are unavailable. |
| Existing Phase 1–2 history pushed **unchanged** | Rewriting would destroy authentic history; the instructions forbid it. |
| No claim that commit timestamps prove event-window work | GitHub publication time does not prove authoring time. |
| No claim of eligibility | Selection/eligibility is determined by the organisers. |

## Open questions to resolve before submission

1. **Visibility.** If the submission requires judges to read the repository, it must be made
   public or shared with the judging accounts. Confirm from the Official Rules or the
   submission form before Nov 4.
2. **Repository naming.** The submission is named `muse-recall`; internal identifiers still
   use the working name “Muse Memory Lab”. Confirm which name should appear in the
   submission.
3. **Pre-existing code.** If development must be entirely within the event window, confirm
   that a project started at kickoff (Oct 26) and committed on Oct 27 is acceptable — the
   history shows all commits dated within the event window.
4. **Required submission artifacts** (demo video, written description, deployed URL) are not
   documented on the page that was reachable.

## References

- Meta Global AI Developer Hackathon event page — https://cerebralvalley.ai/e/meta-ai-developer-hackathon
- Event waiver (content not retrievable) — https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver
