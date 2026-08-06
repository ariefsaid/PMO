---
name: ask-matt
description: Ask which skill or flow fits your situation. A router over the skills in this repo. Project-upgraded override — the main flow here is PMO's per-issue loop, and in a Director session the Director drives it; this router serves humans and dispatched agents needing orientation.
disable-model-invocation: true
---

# Ask Matt (PMO edition)

You don't remember every skill, so ask.

A **flow** is a path through the skills. In this repo most work travels **the per-issue loop**
(CLAUDE.md "Operating model"), driven by the **Director** — the human owner does not schedule
sessions or carry context between them; the Director dispatches each phase and the owner decides at
checkpoints. Two on-ramps merge onto the loop. Everything else is standalone, or a vocabulary layer
underneath.

## The main flow: the per-issue loop (idea → ship)

1. **Intake** — `/grill-with-docs` sharpens the issue against the domain docs (glossary at
   `docs/glossary.md`, ADRs, `docs/decisions.md`). Owner answers land here, batched — this is the
   owner's main hands-on moment.
2. **Spec** — `feature-forge` (new behavior, interview workshop) / `spec-miner` (existing code,
   reverse-engineering) / `/to-spec` (the thread already holds the requirements — synthesis, no
   interview). All three emit `docs/specs/<feature>.spec.md` in EARS + `AC-###` form.
3. **Design+Plan** — `eng-planner` (role agent) → `docs/plans/`, ADRs as needed.
4. **Build** — `/implement` per task, `/tdd` at pre-agreed seams. Dispatched per task with fresh
   context (a worktree off `dev`); nobody hand-clears context between tickets — session boundaries
   do it.
5. **Review** — `/code-review` = the 3-axis battery (Spec, Quality, Security — always).
6. **Discover** — rendered pass on UI changes (`docs/qa-portfolio.md`).
7. **Cover/Accept** — each `AC-###` proven at its owning layer (ADR-0010).
8. **Ship** — `release-engineer` (role agent): branch → PR to `dev`. Promotion `dev`→`main` is
   gated (`scripts/verify-main-pr.sh`); `main`→production is owner-only.

**Branch — does a question need a runnable answer** (state, business logic, a UI you must see)?
Detour through **`/prototype`** (throwaway code, exempt from TDD), bridged by **`/handoff`** in both
directions, then fold what you learned back into the issue thread.

## On-ramps

- **`/wayfinder`** — the effort is **too big for one issue and wrapped in fog**. Charts a shared map
  of **decision tickets** on GitHub issues (`wayfinder:map` label) and resolves them one at a time
  until the way is clear; what exits wayfinder enters the loop as ordinary issues. The Director runs
  ticket-resolution sessions; only genuinely-owner decisions escalate to the owner (same rule as the
  loop). Frontier = any open ticket whose blockers are closed — a work queue, not a human's memory.
- **`/triage`** — inbound issues get the five canonical labels (`docs/agents/triage-labels.md`)
  before they enter the loop. **Public-repo rule applies to every label and comment** (CLAUDE.md
  banner).

## Standalone

- **`/diagnosing-bugs`** — systematic root-cause work before any fix (Claude sessions may use
  superpowers' systematic-debugging instead; same discipline).
- **`/research`** — time-boxed reading with a written conclusion; feeds Intake or an ADR.
- **`/resolving-merge-conflicts`**, **`/teach`**, **`/writing-for-agents`** — what they say.
- **`/wizard`** — generate an interactive bash walkthrough for steps only a human can perform
  (dashboards, credentials). **`/to-questionnaire`** — turn an unanswerable decision into a
  questionnaire for someone else. **`/wait-what`** — re-pitch a message that didn't land.
- **`/improve-codebase-architecture`** — standards-driven refactor proposals; lands as ordinary
  issues, never as drive-by restructuring inside a feature branch.

## The vocabulary layer

**`/domain-modeling`** maintains the glossary (`docs/glossary.md`) and flags ADR conflicts. Reached
via `/grill-with-docs` — created lazily, never scaffolded upfront. Use the glossary's terms in issue
titles, test names, and specs; drift to synonyms is a signal.

## Not in this router

The design/UI skill family (impeccable, taste, ui-ux-pro-max, design-review…) is owned per
CLAUDE.md's skill-ownership table; gstack's `/qa` `/cso` `/ship` own browser-QA/security/deploy.
When two skills could own a concern, the CLAUDE.md table wins.
