# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub:
**Security → Report a vulnerability** on
[sidonsoft/muse-recall](https://github.com/sidonsoft/muse-recall/security/advisories/new).

Don't open a public issue or pull request for a vulnerability. Include what you found, the
commit or tag you tested, and the steps to reproduce it. We aim to acknowledge reports within
three business days. This is a small project, so fixes may take longer; we'll keep you
updated in the advisory.

## What's in scope

Muse Recall is a local-first, single-user app. The server only binds to loopback and has no
authentication by design. The current threat model and its controls are in
[docs/security.md](docs/security.md). Reports are most useful when they show one of these:

- stored memory, tool results or generated HTML getting authority it shouldn't have
  (prompt injection that triggers an action without approval, sandbox escape, delimiter
  forgery);
- a write, correction or Forge promotion happening without the explicit approval it needs;
- the local API being reachable from another machine or origin;
- API keys or other secrets leaking into the browser, logs, child processes or exports;
- data loss or silent state reset after a crash or restart.

Model behaviour on its own (a model ignoring an instruction) is a known residual risk, not a
vulnerability, unless it lets the model do something the app should have blocked.

## Supported versions

| Version | Supported |
| --- | --- |
| `integration` (latest) | Yes, fixes land here first |
| `main` (latest) | Yes, through promotion from `integration` |
| `submission-2026-11-04` tag | No. It is the frozen hackathon submission and is never rewritten. Issues in it are fixed on `integration` and disclosed in an advisory. |
