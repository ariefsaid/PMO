# Factory workflow — how the loop, the Matt skills, and SSSF fit together

**One page, three systems, one operating model.** The per-issue loop (CLAUDE.md), the Matt Pocock
skill set (`/ask-matt` router), and SSSF ADWs (`adws/`, `/sssf`) are not competing workflows — they
are the front, middle, and floor of the same factory. Owner directive 2026-08-16.

## The model

```
OWNER-HEAVY                    FACTORY (autonomous)                   OWNER-HEAVY
──────────────                 ─────────────────────                  ────────────
wayfinding (/wayfinder)   →    per-issue loops, chained:         →    milestone review:
intake (/grill-with-docs)      build → test-fix → cross-family        traces + rendered demo
spec + ACs + evals             review → revise → green                + promote decision
milestone sign-off             (SSSF ADW or pi-dispatch)
```

- **Front (owner + Director):** requirements, wayfinding, ACs/evals. Tools: `/wayfinder` for foggy
  multi-issue efforts, `/grill-with-docs` + `feature-forge`/`/to-spec` per issue. Output: a signed
  **milestone brief**.
- **Middle (factory, no owner):** the Director chains issues through the executors below until the
  milestone's ACs are green. LLM-first QA — tests, cross-family review, and fix rounds run inside
  the machine before any human looks.
- **End (owner):** milestone review — the SSSF trace/visualizer, the PR(s), a rendered demo.
  Promotion gates unchanged: Director merges to `dev`/`main` within the signed scope; **`main` is
  the autonomous ceiling; production stays per-instance owner-gated** (CLAUDE.md).

## Milestone brief (the sign-off artifact)

A section in the anchoring GitHub issue (or `docs/plans/`), signed by an explicit owner reply:
**objective · milestones · ACs/evals per milestone · scope fences (do-NOT list) · issue list or
"Director decomposes via /to-tickets"**. Once signed, the Director does **not** pause at issue
boundaries inside it — only at milestone boundaries, or when something falls out of the signed
scope (then escalate, don't improvise). This supersedes the per-issue owner pause for work inside
a signed brief; unsigned/ad-hoc issues keep the classic per-issue checkpoints.

## Executor routing (which machine runs the middle)

| Issue shape | Executor |
|---|---|
| Bounded code slice, testable by the suite | **SSSF ADW — default chain `adws/adw_simple_sdlc.py`** (plan → build → test-fix ×3 → cross-family review-revise ×2 → retest → commit → document). Run per `/sssf` + `docs/pi-delegation.md` substrate rules. |
| UI/visual, money-path, RLS/RPC/security, or migration work | **Director-dispatched per-issue loop** (`pi-dispatch` per `docs/pi-delegation.md`) — the rendered taste lens, `review-money`, and DB-lock discipline can't ride the text-only ADW. |
| Foggy / multi-issue / decision-shaped | `/wayfinder` first; what exits enters the loop as ordinary issues. |
| Throwaway question | `/prototype`, bridged by `/handoff`. |

Either way the Director still runs the binding gates itself before ship: `npm run verify:locked`,
mutation checks, rendered verification, `verify-main-pr.sh` at promotes. The ADW's green is the
factory's inner loop, not the phase gate.

## Non-negotiables carried over (nothing here weakens them)

- Archive `adws/adw_data/` out of a worktree **before** `git worktree remove` — the trace is the
  owner's review surface (`docs/reviews/2026-08-06-sssf-trial-record.md`).
- Substrate ladder, briefs-as-files, background-dispatch mechanics: `docs/pi-delegation.md`.
- QA portfolio, BDD authoring rule, NOT-DONE-UNTIL-GREEN, DB locks: CLAUDE.md.
- Planner plans land in `docs/plans/` (config `writes:` re-aimed 2026-08-16, trial iterate item 1);
  the reviewer phase requirement (iterate item 2) is satisfied by using `adw_simple_sdlc` as the
  default chain.
