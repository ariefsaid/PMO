---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.

---

<!-- Below is the PMO project hardening. ADDITIVE by design: upstream's text above is kept verbatim,
     so a re-vendor surfaces real upstream drift rather than our delta. -->

## PMO specifics

- **Redaction is the public-repo rule, not a nicety** (CLAUDE.md banner): no unpatched-weakness
  detail, no secret coordinates (vault/item/env-var names, hostnames), no PII — even though the
  handoff lives outside the repo, it gets pasted into sessions whose output may be committed.
- Never read or quote `.env` / `op.*.env` contents into a handoff.
- Point the next session at the project's standing state docs instead of restating them:
  `docs/backlog.md` (live status — read first), `docs/decisions.md` (locked OD-*), the
  "Read-before-you-touch" table in CLAUDE.md for whatever surface the work touches.

## End with the prompt that starts the next session

Upstream does not ask for this; it is the single thing most often missing.

The final section is the **literal text the user pastes into a fresh session** — fenced, nothing to
fill in, and **including this file's own absolute path**. The handoff lives outside the repo, so
that path is the only thing connecting it to anything; a handoff the user must translate into an
opening prompt is half-finished.

Name in it: the docs to read *before* touching anything odd (`docs/backlog.md`,
`docs/decisions.md`), any artifact worth reading first (an open PR, a spec), and the skill to run.
Close by saying nothing in the handoff is load-bearing — every decision it cites lives in
`docs/decisions.md` and every status claim in `docs/backlog.md`, so if the file is lost the next
session is slower, not wrong.
