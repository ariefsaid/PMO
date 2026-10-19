# v0.24 Engineering Health Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for one assigned issue at a time.
> Executor is a fresh Luna xhigh worker with its complete bounded brief. Do not reassign a worker.

**Goal:** Improve the meaning of coverage, timing and operational evidence without changing product behavior.
**Architecture:** Keep coverage scoring pure; reuse accepted atomic test-fixture cleanup and existing
browser journeys. Diagnose unconfirmed editor observations before choosing any source correction.
Operational tooling is a separately reviewed private delivery. Do not combine issue PRs.
**Tech stack:** Node built-ins/node:test, Istanbul coverage JSON, TypeScript, Playwright, local Postgres.
**Spec:** `docs/specs/v024-engineering-health.spec.md`; approved reused `docs/specs/test-hygiene.spec.md`.

## Global constraints

- Dev only. No main/production, schema, dependency, lockfile or business-rule changes.
- No timeout increase, retry, skip, assertion weakening or console suppression.
- Four unit shards, pgTAP, verify, integration, existing skip/timing/consent/served gates remain.
- v0.23 work has shared-resource priority. Builders use their own worktree off fresh dev.
- This plan grants no push, merge, dispatch or infrastructure permission to its author/worker.
- Each checkbox is one 2–5 minute action; test execution can wait on the existing locks.
- Tests that prove source changes must be RED before implementation. Reuse valid existing gates.
- Primary private evidence goes to the issue-specific run directory assigned by Root.

## Review focus

1. Source-map insertion order must not decide whether a skipped inner assignment is covered (Task A1).
2. Identical/same-line statement peers must keep line semantics rather than become branch coverage (A1).
3. Historical warnings may refer to journeys already split and currently fast enough (B1).
4. A UI write may succeed before fixture readback fails; cleanup must still find only owned rows (C1).
5. An editor diagnostic without observable impact must not be promoted to a guessed product fix (D1).

## A — #1125, first bounded implementation PR

### Task A1 — Specificity regressions (AC-EH-001/002)

**Files:** Modify `scripts/changed-lines-coverage.test.mjs` only.
**Consumes:** exported `computeChangedLinesCoverage({ changedLinesByFile, coverage, min, root })`.
**Produces:** failing tests against the real existing function, no replacement scorer.

- [ ] Add `AC-EH-001 hit outer does not cover zero-hit inner` using the existing `makeCoverage`:
  outer lines 5–20 hits 4, inner line 10 hits 0; changed line 10 must give total 1, covered 0,
  pct 0 and ok false. Repeat with the coverage statement entries reversed.
- [ ] Run `node --test scripts/changed-lines-coverage.test.mjs`; retain the real RED output.
- [ ] Add `AC-EH-002 multiline interior retains its own execution`: outer lines 5–20 hits 4,
  inner lines 10–12 hits 0, changed lines 8/10/11/12/15 => total 5, covered 2. A hit multiline
  statement at 10–12 with no inner ranges covers 10/11/12 (3/3).
- [ ] Add `AC-EH-002 identical and same-line peers retain max hits`: duplicate equal ranges with
  hits 0/4 cover that range; two disjoint column spans on line 10 with hits 0/4 cover line 10.
  Add explicit nested column spans with one zero-hit smallest range and a hit ancestor; the
  smallest range's line is uncovered unless another incomparable smallest peer on that line hits.
- [ ] Retain the existing ANY-hit test: its zero-hit outer/hit inner is still covered. Retain all
  existing boundary, exclusion, absent-entry and collision tests. Run the same command; inspect
  that the new nested-zero controls fail for the intended reason, not a malformed fixture.

### Task A2 — Correct the pure scorer (AC-EH-001/002)

**Files:** Modify `scripts/changed-lines-coverage.mjs` and its same test file.
**Interface:** Keep the existing exported function arguments and result fields unchanged.

- [ ] In `computeChangedLinesCoverage`, gather ranges containing the changed line; remove a range
  when another candidate is properly contained in it, using lexicographic start/end positions.
  Equal positions are peers. For line-only records use start-column 0/end-column infinity.
  Executable means at least one candidate; covered means a remaining peer has hits >0. Count
  each changed line once. Keep all path filtering, raw-threshold math and CLI handling untouched.
- [ ] Run `node --test scripts/changed-lines-coverage.test.mjs`; every original and new assertion
  must pass. Temporarily restore the original broad ANY-hit loop: AC-EH-001 must fail. Restore
  the correction and capture green. This is a binding regression check, not a new production seam.
- [ ] Inspect the diff for changed expectations in existing tests. No original oracle may be
  deleted or relaxed; any actual contradiction goes to Root with the exact fixture and outcome.

### Task A3 — Scoped gate and review handoff

- [ ] From `pmo-portal/` run `../scripts/with-test-lock.sh npm run typecheck` and
  `../scripts/with-test-lock.sh npx vitest run --changed origin/dev`.
- [ ] From repo root run `node --test scripts/changed-lines-coverage.test.mjs` only if A2 evidence
  predates the final edit; otherwise reuse its exact final evidence. Run
  `git diff --check`. These repository scripts are outside the app ESLint source target;
  do not change lint configuration to include/exclude them. Root applies the existing repository
  tooling checks. No browser/DB journey is touched, so no local e2e/DB run is needed.
- [ ] Return exact head, source diff, RED/GREEN output and retained-test evidence. Root dispatches
  the usual spec/quality/security review, then the release engineer; required PR CI remains
  four unit shards + verify + pgTAP. No full local verify or extra browser sampling.

## B — #1106, evidence-led headroom follow-up

### Task B1 — Reconcile historical goals before editing (AC-EH-003)

**Read:** the issue body; `docs/specs/test-hygiene.spec.md`; current
`pmo-portal/e2e/AC-911-timesheet-approval.spec.ts`, `AC-ADMIA-001-administration-navigation.spec.ts`,
`AC-CONFIRM-001-procurement-confirm.spec.ts`, `AC-VB-E01-view-builder-compose-save.spec.ts`,
`UIP-005-project-tab-work-fold.spec.ts`, `AC-MTG-022-minutes-editor-surface.spec.ts`.
**Write:** private issue evidence only until a current warning and a useful split are established.

- [ ] Map each old warning to current test titles/dimensions. Include both warned UIP-005 PM/light
  viewport cases, all original six warned attempts, and the later minutes-surface addition.
  The seven historical dimensions must not be lost when titles become one-to-many mappings.
- [ ] Read the complete safe final-revision summary, including its revision and executed/skipped
  counts; use run 39172841168 as historical green evidence, not proof of a later head. Do not
  rerun CI to sample a faster machine. Record current source changes since the measured revision.
- [ ] If no warning remains, hand Root an evidence-only closure recommendation for #1106; do not
  create a cosmetic test PR. The observed baseline has zero warnings, so this is the default path.
- [ ] If a warning recurs on an already required run, propose exactly the affected independent
  journey boundary, old→new goal map and fixture setup to Root. Never split a goal's causal chain
  into UI-independent assertions or fabricate a new case purely to reduce a timer. Source change
  is conditional on that concrete evidence; the diagnostic task is independently complete here.

### Task B2 — Conditional bounded split and proof

**Potential files:** only the six current spec files listed in B1; Root assigns one affected file
per fresh task and names the exact warning identity. No shared helper/config edit by default.

- [ ] Snapshot old collected full identities and expanded goal/dimension map privately. Add the
  independent starting-state regression before moving its journey. Preserve AC ownership.
- [ ] Move only complete independent goals, retaining timeouts (UIP-005 120000 with budget 90000;
  default 30000 elsewhere), assertions, fixtures and cleanup. Current AC-911 and Administration
  splits are accepted prior art, not a request to redo them.
- [ ] Run the touched spec through `scripts/e2e-local.sh <exact-assigned-filename> --project=chromium`
  under its own DB lock, then use the existing timing audit on that run's actual JSON. Root's
  final dispatch uses `scripts/ci-e2e.sh <assigned-branch>` only when policy permits; acceptance
  requires its final-revision complete summary. Do not start B2 without B1's concrete assignment.

## C — #1107, sibling fixture teardown

### Task C1 — Atomic exact-fixture cleanup (AC-EH-004/006)

**Modify:** `pmo-portal/e2e/AC-BUPOT-020-vendor-withholding-slip.spec.ts` and
`pmo-portal/src/lib/db/vendorWithholdingSlips.concurrent.integration.mjs` only.
**Read-only template:** current `AC-BUPOT-021-vendor-withholding-slip-visual.spec.ts` cleanup and
`runWithFixture`; accepted #1104 private plan is retained by Root.
**Produces:** one transaction per cleanup with active integrity behavior and exact owned-ID zero proof.

- [ ] Before edits, record each file's full goal/assertion map. Retain the original AC-BUPOT-020
  title/goal and add AC-EH-006 as a traceability reference; AC-EH-004 belongs to the concurrency
  helper's cleanup control, not a duplicate browser acceptance owner. The browser goal includes cross-case
  record/correct/void, unchanged money/outbox, released evidence and destination-row focus. The
  concurrency goal includes observable lock wait, duplicate refusal and void/re-record interleave.
- [ ] Add a focused failure control in the existing concurrency harness that leaves a valid own
  header/link pair for teardown and records an unrelated synthetic control outside that ownership.
  Its final oracle requires own row counts zero, control survives and integrity remains enabled.
  Execute only the helper under `scripts/with-db-lock.sh node pmo-portal/src/lib/db/vendorWithholdingSlips.concurrent.integration.mjs`;
  retain RED. No reset is needed because no migration or seed changes.
- [ ] In browser finally, reuse #1104's validated-UUID, parameterized, local-target transaction;
  support arrays for its two case/bill IDs. Locate own slips by owned vendor as well as known IDs
  so successful UI writes with failed readback are covered. Delete links/header/bills/cases/vendor
  in one transaction, check command success and verify all five own counts are zero. Keep normal
  integrity behavior enabled. Report journey+cleanup errors together using `AggregateError`.
- [ ] In the concurrency helper, put initial setup inside the protected try/finally so partial
  setup is cleaned; scope each delete to its owned IDs, and remove only its own audit/identity/
  organization fixture rows after business rows. Use the same transactional principle without
  schema changes. Preserve both original race sequences and their active/released counts.
- [ ] Add/execute a deliberate cleanup failure control without touching shared fixtures: use the
  helper's isolated synthetic fixture/transaction, force a local rollback, require nonzero output
  and both journey+cleanup diagnostics. Restore normal cleanup and prove own rows zero. Record
  the exact injected failure privately; no global trigger/config alteration is an acceptable test.

### Task C2 — Consecutive proof and handoff

- [ ] Run the exact helper command twice consecutively under the DB lock; record both original
  race outcomes and zero-owned-row/control-preserved proof. No broad DB suite or reset.
- [ ] Run `scripts/e2e-local.sh AC-BUPOT-020-vendor-withholding-slip.spec.ts --project=chromium`
  twice consecutively, keeping all original user-goal assertions and exact cleanup proof. This
  repeat is required by #1107's retry-safety AC, not an extra full portfolio run.
- [ ] From `pmo-portal/`, run locked typecheck/changed-importer Vitest and
  `npx eslint --max-warnings=0 e2e/AC-BUPOT-020-vendor-withholding-slip.spec.ts`.
  From root run `bash scripts/check-e2e-isolation.sh`, `git diff --check`; reuse valid final
  helper/browser evidence. Root schedules any final portfolio run under the shared policy.

## D — #1108, investigation before source correction

### Task D1 — Reproduction packet (AC-EH-005)

**Read:** `pmo-portal/src/components/meetings/MinutesEditor.tsx`, `MinutesEditor.test.tsx`,
`pmo-portal/pages/MeetingDetail.tsx` and its editor callback handling, current six surface cases.
**Owned changes:** private evidence only during this bounded diagnostic task.

- [ ] Record the exact current revision and the six existing heading/handle goals. Inspect callback
  identity, readiness/dirty baseline and theme subscription before formulating a cause.
- [ ] Under `scripts/e2e-local.sh AC-MTG-022-minutes-editor-surface.spec.ts --project=chromium`,
  use its unsaved editor sequence on an isolated seeded meeting. Capture pageerror/console message,
  stack, reproduction steps and visible edit/theme behavior privately; do not change assertions,
  save the document, suppress diagnostics or raise the existing 30000 timeout.
- [ ] Separate actual recursive updates from browser layout notifications using the captured stack
  and visible behavior. Report reproducible/absent/inconclusive for each observed message. A green
  geometry result alone neither establishes nor refutes a runtime defect.
- [ ] Return Root a causal evidence card. If no reproducible source defect exists, recommend
  observation status with the exact scope checked. If confirmed, name the smallest source path,
  failing regression and retained user goal. Root supplies a fresh bounded correction brief;
  this plan intentionally does not guess a production fix from the issue's diagnostics.

## E — already assigned and private operations

- #1170: Root owns #1176's minimal CI addition and pinned-runtime setup; do not duplicate it.
  Acceptance is actual CI execution of `python3 -m unittest discover -s scripts/tests -v`, four
  process tests, retained preservation mutation proof and all previous CI gates green.
- #1133, #1113, #1103: separate private operations specification/plan held by Root. No private
  launcher or operational configuration may be copied into the public repository unreviewed.
- Browser runner changes: `docs/plans/2026-10-19-browser-test-sharding.md`; wait for Root's
  workflow ownership handoff after #1176. Inventory/aggregate guard comes before workflow fanout.

## Completion evidence for this plan

The planning author read issue bodies, current source, prior art and the complete safe browser
summary. No implementation, test execution, DB/browser operation, CI dispatch or release was run.
Each implementation deliverable requires its own fresh evidence; this plan is not a green claim.
