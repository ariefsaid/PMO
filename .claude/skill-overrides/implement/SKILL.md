---
name: implement
description: "Implement one piece of work from a spec or set of tickets, test-first, to PMO Portal standards. Project-upgraded override — carries the implementer-agent discipline (TDD iron law, escalate-not-guess, verify with fresh evidence, self-review) into a user- or pi-invoked build session. In a Director session, the per-issue loop (CLAUDE.md) drives and dispatches this per task."
disable-model-invocation: true
---

Implement the work described in the spec or tickets — **exactly** what is asked, nothing more (YAGNI). Build one task to done before starting the next. This is loop step 4 (Build) of CLAUDE.md's per-issue loop; the spec (`docs/specs/*.spec.md`) and plan (`docs/plans/*.md`) are the contract.

## Iron law (TDD)
NO production code without a failing test first. **RED → GREEN → REFACTOR.** Tests assert real behavior, not mocks, and never bend to the app's current state to go green (BDD authoring rule, CLAUDE.md). Use `/tdd` at pre-agreed seams; prefer the highest existing seam, the fewest seams possible. The owning test names its `AC-###` in its title (AC-id tagging, CLAUDE.md).

## Loop
0. **Orient.** Read `docs/glossary.md` and any ADR touching the area. Read the matching "Read-before-you-touch" doc from CLAUDE.md's table if the task touches that surface (money paths, agent surface, e2e authoring, Supabase/deploy). Something that looks broken (a disabled test, an archived doc) is usually a settled decision — check `docs/decisions.md` (OD-*) before "repairing" it.
1. **Clarify first.** If requirements, acceptance criteria, approach, or dependencies are unclear, ask *before* writing code. Bad work is worse than no work.
2. **Red** — write the failing test that encodes the user's real journey to the goal, and prove it fails for the right reason.
3. **Green** — the minimal code that passes.
4. **Refactor** — improve what you touched; don't restructure beyond the task.
5. **Verify** — the FULL gate, not just touched files: `npm run verify` from `pmo-portal/` (**`npm run verify:locked` on a shared machine**). Read exit codes; no completion claim without fresh passing evidence. Wrap every DB-driving command in `scripts/with-db-lock.sh`; chain reset+test as ONE lock hold.
6. **Self-review** — completeness, naming, YAGNI, tests-verify-behavior, ≥80% coverage on changed lines.
7. **Review** — the loop's step-5 battery (3 reviewers, always) runs after; do not self-certify past it.
8. **Capture decisions.** Did this session settle anything a future agent would otherwise re-derive — a deviation, a deferral, a rejected approach, a constraint found the hard way? Append it to `docs/decisions.md` under the right group. A decision that lives only in the commit message is lost.
9. **Commit** to the current feature branch (worktree off `dev`, never the shared tree) with a clear message and the project commit trailer (CLAUDE.md).

## Code organization
- Follow the reference slice (`pages/Companies.tsx` + `src/lib/db/companies.ts`) and the binding architecture patterns (CLAUDE.md): repository seam, `can()` for UX + RLS as authority, shared form primitives, `DESIGN.md` tokens only.
- Improve code you touch, but if a file grows beyond the task's intent, **stop and report** — don't split files on your own.
- Production-grade: loading / empty / error / edge states, responsive, WCAG-AA a11y.

## Escalate (stop and report) when
architectural choices with multiple valid approaches arise; you need code beyond what was provided; you're unsure the approach is correct; or the task needs restructuring the plan didn't anticipate. Escalating is never penalized.

## Report
Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT — what you implemented; what you tested + results (fresh evidence); files changed; self-review findings; concerns.
