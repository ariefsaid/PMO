# v0.24 engineering health

Status: planning handoff, 2026-10-19. Implementation is separate; current release ceiling is dev.

## Job and scope

When maintainers accept CI evidence or resume an operational task, they need accurate coverage,
complete results and reliable completion reports so that a green result has a clear meaning.
This specification covers #1125, #1106, #1107 and #1108, and records the disposition of #1170,
#1133, #1113 and #1103. Browser fanout has its own `browser-test-sharding.spec.md`.
One code PR per issue. No changes to money rules, permissions, schema, dependencies or timeouts.

## Deciding artifacts and reuse

- `scripts/changed-lines-coverage.mjs` and its test file decide current coverage scoring. Its
  public `computeChangedLinesCoverage` return shape and exact-path matching remain compatible.
- `docs/specs/test-hygiene.spec.md` and `docs/plans/2026-10-17-test-hygiene.md` are approved prior art;
  reuse their timing audit and fixture-preservation rules rather than reopen #1071.
- `pmo-portal/e2e/AC-BUPOT-021-vendor-withholding-slip-visual.spec.ts` supplies the checked atomic,
  exact-fixture cleanup pattern accepted in #1104. Reuse that behavior for #1107.
- Current `AC-911-timesheet-approval.spec.ts` already has separate submit/approve tests; current
  `AC-ADMIA-001-administration-navigation.spec.ts` already has independent navigation edges.
  Historical combined-journey titles are not instructions to split those same journeys again.
- Successful integration [39172841168](https://github.com/ariefsaid/PMO/actions/runs/39172841168),
  revision `39dc2953f244c553f26d1545de910ab294c4188e`, has a complete safe timing summary:
  384 executed ordinary attempts, 67 audited skips, zero timing warnings/failures.
  This is evidence at that revision; it does not close every historical issue automatically.
- Issue #1108 establishes an observation, not a confirmed production defect. The shipped
  `MinutesEditor.tsx`, its host callbacks and the six current surface cases decide behavior.
- #1170 is owned by the separately assigned minimal CI delivery (#1176). Consume its actual
  final proof; do not make another workflow edit for it in this lane.
- Operational maintenance #1133/#1113/#1103 follows the private operating brief and review.
  This document records scope only; local operational artifacts are not publication inputs.

## Requirements (EARS)

**FR-EH-001 — changed-line specificity (#1125).** When a changed executable line lies inside
nested statement ranges, the checker shall use the most specific containing statement ranges;
a covered enclosing range shall not make a distinct zero-hit inner statement covered. Statements
with identical source ranges share their maximum hit count. If multiple incomparable smallest
ranges touch the same source line, any hit among those peers covers the line, retaining line
rather than branch semantics. Proper containment uses start/end line and column positions, with
missing columns treated consistently as line-only ranges. A multiline statement shall continue
to cover its interior changed lines where no more-specific statement covers that line.

**FR-EH-002 — retained coverage contract.** When scoring the changed lines, the checker shall
retain the 80% raw-ratio boundary, display-only rounding, one count per executable changed line,
source exclusions, exact file identity, root-level source handling and existing CLI/output shape.
The change shall not add exclusions or reinterpret missing coverage files as new successes.

**FR-EH-003 — timing disposition (#1106).** When assessing historical timing warnings, the
maintainer shall map each old expanded goal to its current collected identity and use a complete
safe summary at the tested revision. Where current complete evidence has no warning, the
maintainer shall record that fact instead of inventing a remediation. Where a warning recurs,
the change shall preserve every goal, dimension, isolation class and existing timeout; a split
shall give each independent journey its own valid starting state and exact cleanup.

**FR-EH-004 — fixture teardown (#1107).** When either sibling withholding fixture finishes or
partially fails, its teardown shall atomically remove only fixture-owned rows, leave normal
integrity behavior enabled, check every operation and prove zero remaining owned rows. When
both journey and cleanup fail, both errors shall survive. Consecutive targeted runs shall keep
all existing cross-case, persistence, correction, void and concurrency oracles.

**FR-EH-005 — diagnostic investigation (#1108).** When heading entry or theme switching is
investigated, the investigator shall use an isolated unsaved meeting fixture, record the actual
runtime diagnostic and observable impact, and retain all heading, right/left overflow and handle
oracles. Where a causal defect is reproduced, a minimal regression shall fail against shipped
code before a source correction; absence of reproduction shall be reported as inconclusive.
Console filtering, swallowed diagnostics, new skips or changed geometry tolerances are forbidden.

**FR-EH-006 — operational scope.** When #1133/#1113/#1103 are implemented, they shall follow
separate bounded issue briefs, isolated fake-process tests and the existing release ceiling.
A successful completed delivery is terminal; operational completion means all required verified
steps succeeded. Further operational detail remains in the private handoff pending review.

**NFR-EH-001 — resource policy.** All implementation shall preserve four unit shards, pgTAP,
verify and integration coverage, the shared dispatch limits and audit trail. v0.23 work retains
priority. No repeated full local suite or unapproved browser dispatch is acceptance evidence.
**NFR-EH-002 — public hygiene.** Only synthetic fixtures and safe relative test metadata may be
published. Local evidence, process configuration and operational details stay local.

## Acceptance and one owning proof per AC

| AC | Given / When / Then | Lowest sufficient owner |
| --- | --- | --- |
| AC-EH-001 | Given a hit outer range containing a zero-hit inner range, when its inner executable line is scored, then it is uncovered; reversing object iteration order has the same result. | Node unit: `scripts/changed-lines-coverage.test.mjs` |
| AC-EH-002 | Given multiline ranges, identical ranges, same-line peer statements and nested ranges with columns, when changed lines are scored, then specificity, peer maximum hits, original denominators and the exact 80% boundary hold. | Node unit: same file; retain every existing test |
| AC-EH-003 | Given historical warning identities and a complete final-revision summary, when timing follow-up is accepted, then every historical goal is mapped to retained current proof, and each actually changed journey retains its goal and timeout with permitted CI evidence. | Existing E2E journeys plus their safe timing entries; no duplicate journey |
| AC-EH-004 | Given the owned concurrency fixture and an unrelated control, when cleanup runs after success or partial failure twice, then owned rows are zero, control rows survive, integrity checks remain enabled and dual failures are reported. | Local DB integration: `vendorWithholdingSlips.concurrent.integration.mjs` |
| AC-EH-006 | Given the browser journey's own two-case fixture, when its real record/correct/void/focus journey completes or fails after a partial write, then checked teardown removes its own rows, leaves other fixtures intact and reports both journey/cleanup failures; consecutive runs succeed. | Existing E2E: `AC-BUPOT-020-vendor-withholding-slip.spec.ts`, retaining its original AC and goals |
| AC-EH-005 | Given an isolated unsaved minutes document, when the observed heading/theme sequence runs, then diagnostics and actual impact are recorded while all six surface cases retain their assertions; a confirmed correction has a minimal failing regression. | Existing E2E surface cases; any confirmed pure callback regression is additional unit proof, not a replacement owner |

#1170 is accepted only from its separate CI run plus the four process tests. Operational ACs and
concrete local paths are in the private handoff, not duplicated in tracked documents.

## Decisions and boundaries

No product semantics remain to invent here. #1106 can be evidence-only if its present goals are
already below the warning boundary. #1108 is diagnosis-first: Root adjudicates its causal evidence
before any build scope expands. Root routes cross-repository or publication decisions to Claude;
the implementation worker does not ask the owner directly. No implementation or release is
claimed complete by this planning artifact.
