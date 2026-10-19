# Browser test runner sharding

Status: v0.24 implementation queue, 2026-10-19; issue #1188. Offline contracts may build now.
Workflow fanout remains held pending the shared runner-capacity decision. No runner or branch-protection change is performed here.

## Job, evidence and decisions

When a maintainer waits for a full browser result, they need lower elapsed time without losing a
single test or accepting incomplete shard evidence. Preserve the required names `verify` and
`integration`, their event policy, all four unit shards and the whole existing browser portfolio.

Deciding source: `.github/workflows/ci.yml`, `pmo-portal/playwright.config.ts`,
`pmo-portal/package.json`, `scripts/ci-integration-order.test.mjs`, `scripts/ci-e2e.sh`,
`check-e2e-skips.mjs`, `check-e2e-time-budget.mjs`, and `verify-main-pr.sh`.
The installed Playwright runner's `createTestGroups` retains serial/default groups when native
sharding selects groups; the implementation must prove this for the locked version using collection
and a small synthetic grouping fixture, not assume every test can be assigned independently.

[Run 39172841168](https://github.com/ariefsaid/PMO/actions/runs/39172841168) at
`39dc2953f244c553f26d1545de910ab294c4188e` completed integration in **29m16s**. Its safe ordinary
summary is complete: 384 executed attempts, 67 allowed skips, zero timing warnings/failures.
Measured work: chromium 337 attempts / 5,179,778ms; serial 20 / 145,508ms; consent 7 / 28,389ms;
setup 20 / 34,369ms. Setup repeats because projects have dependencies. These are sums of attempt
durations, not wall time. The separately executed served smoke is outside this ordinary summary.

Initial candidate: **two Chromium shards, four workers each**. Work/8 is a theoretical lower bound
of about 10m47s for the measured Chromium work, before startup, dependency groups and imbalance.
There is no promised completion time or measured speedup. Two is the smallest useful fanout; a
larger fanout needs evidence from permitted runs and Root's resource-policy review. Retain one
serial invocation at one worker, one consent invocation, and served smoke last on the tail runner.
Four unit shards stay four. Do not raise any job/test timeout or add retries.

## Architecture

Keep one workflow owning the required names. Add a collection/planning job, a two-entry Chromium
matrix, a tail job and one final `integration` aggregator. The planning job prepares an ephemeral
stack exactly as current integration requires, runs full pgTAP under the existing trigger/input
rule, and collects complete project inventories plus both native shard inventories without
executing test bodies. Each executing runner prepares its own independent stack from the same
revision and seed. No stack, session, credentials, financial data or mutable fixture is shared
between runners. Do not transfer generated session files between runners.

Chromium matrix uses native `--shard=1/2` and `--shard=2/2`, with `fail-fast:false` and
`max-parallel:2`. The tail waits for both matrix entries to finish and starts its own stack; it
runs serial at `--workers=1`, then consent, audits all ordinary reports centrally with both
Chromium reports, and only then serves/runs the existing served smoke. After a failed ordinary
stage, independent later stages can still provide diagnostics; every such failure remains fatal.
A failed planning/setup stage means incomplete evidence and must fail the final aggregator.

Full-report artifacts are temporary, restricted to this run and the shortest supported retention;
they are never public documentation. Publish only the already allowlisted safe timing summary.
Failure traces follow the existing retention policy and unique shard names.

## Requirements (EARS)

**FR-BSH-001 — complete inventories.** When the workflow plans shards, it shall collect the full
unsharded ordinary inventories for chromium/serial/consent, full setup dependencies and the served
smoke inventory at the exact tested revision/configuration, plus the two selected Chromium shard
inventories. A canonical test identity is `[mode, project, relativeFile, fullTitlePath, repeatIndex]`.
Reject duplicate runnable identities, an empty requested lane, invalid collection, missing source
spec coverage, unknown projects and inconsistent revisions/configuration. Preserve the explicit
served-mode execution in addition to its intentional ordinary-mode skips. Compare identities,
not grep counts, static test declarations, line numbers or elapsed times.

**FR-BSH-002 — assignment proof.** When shard inventories are compared, their Chromium identity
sets shall be pairwise disjoint and their union shall equal the full Chromium inventory exactly.
Serial and consent identities shall remain in their own complete lanes. Setup dependencies are
expected once per recorded invocation, so compare their declared multiplicity separately rather
than silently deduplicating arbitrary tests. Native serial dependency groups in Chromium shall
remain intact; the `serial` project shall never be sharded or have workers above one.

**FR-BSH-003 — execution proof.** When a shard finishes, its artifact shall name its immutable
revision, workflow run/attempt, lane, shard number/total, selected inventory digest, command outcome,
actual report and collection outcome. The aggregator shall compare every reported identity/status
against the planned inventory; missing, extra, duplicate or unexecuted cases are failures. Allowed
ordinary test skips continue through the unchanged central skip allowlist. A skipped job/shard is
never equivalent to an allowed skipped test case.

**FR-BSH-004 — required result.** When required checks aggregate child jobs, success shall require
all expected jobs completed successfully, all exact artifacts present once, matching metadata and
complete inventory proof, and all policy gates green. A failed, missing, skipped, timed-out,
cancelled or unknown shard/job shall produce a non-successful required result; an aggregator
that can run shall explicitly fail it. Whole-workflow cancellation must never publish success.
Do not use `continue-on-error`, success stubs, `|| true`, optional artifact downloads or wildcard
matches that allow a missing shard. Diagnostic continuation cannot alter recorded outcomes.

**FR-BSH-005 — retained portfolio.** When integration runs, it shall retain complete pgTAP at the
existing automatic/dispatch rule, isolation and migration guards, real setup, all ordinary Chromium
checks including visual/a11y, the one-worker serial lane, analytics-enabled consent, the central
skip audit with all ordinary reports in one invocation, the central per-attempt timing audit, safe
timing retention and real served-function smoke after ordinary work. No portfolio stage is moved
into a non-required job without an explicit dependency in `integration`.

**FR-BSH-006 — unit completeness.** When `verify` aggregates the existing four unit shards, it
shall retain complete unit/coverage inventories and exact four reports before merging coverage.
Any failed/missing/skipped/cancelled unit shard fails verify; no successful partial report merge
can replace a missing shard. Retain changed-lines >=80%, guards, typecheck, lint, build, repository
process tests and every current Deno gate, including the separately owned #1176 additions.

**FR-BSH-007 — deliberate contract migration.** When CI's command layout changes, existing workflow
contract tests shall be updated to prove equivalent or stronger coverage and dependency ordering.
The current exact-three-commands assertions are deliberately superseded only by complete inventory,
serial/tail order, gate-presence, aggregate-negative and no-extra-execution tests. Keep local
`verify-main-pr.sh` sequential and complete; it remains a diagnostic reproduction, not a second
routine CI run. Preserve no-retry, no redirect-corrupted JSON and one workflow per required name.

**NFR-BSH-001 — resource/dispatch policy.** The shared logged dispatcher remains the sole dispatch
entry point. Preserve its per-branch/daily approvals and two concurrent workflow-run ceiling;
runner fanout does not authorize extra workflow dispatches. Root confirms the two-runner candidate
against account capacity before workflow fanout, with v0.23 priority. No new infra or paid service.
**NFR-BSH-002 — provenance and privacy.** Use built-ins and pinned existing dependencies/actions.
Record only safe projected metadata in public evidence; credentials, session state, responses and
absolute local paths never enter inventories, safe summaries or public reports.

## Acceptance: one lowest-sufficient owning test

| AC | Given / When / Then | Owner |
| --- | --- | --- |
| AC-BSH-001 | Given full and selected inventories, when partitioned, then every Chromium identity occurs exactly once and serial/consent/setup multiplicities retain their contract; missing/duplicate/empty/unknown/mismatched-revision inputs fail. | Node unit `scripts/browser-test-sharding.test.mjs` |
| AC-BSH-002 | Given planned inventories and result artifacts, when aggregated, then absent/extra/duplicate/unexecuted/malformed identities and every non-success shard status fail; allowed test skips remain the separate skip gate's concern. | Node unit same file |
| AC-BSH-003 | Given the actual workflow graph, when contract tests run, then all expected browser jobs and all four unit shards are mandatory inputs to the existing required names, cancellation cannot turn a skipped aggregate green, and every original policy gate remains reachable. | Node unit `scripts/ci-integration-order.test.mjs` |
| AC-BSH-004 | Given a native-shard synthetic suite with a dependent serial group, when both shards are collected, then dependent tests co-locate and union/disjointness holds; the real collected suite has the same denominator proof. | Lightweight Playwright collection fixture driven from `scripts/browser-test-sharding.test.mjs`; no browser/DB needed for the synthetic fixture |
| AC-BSH-005 | Given one permitted final-revision integration run, when all child jobs complete, then the aggregator proves full inventory equality and every retained DB/browser/consent/served/skip/timing gate passes with per-shard evidence. | Existing full CI integration workflow; no duplicate acceptance journey |
| AC-BSH-006 | Given four complete unit-shard inventories/reports, when verify merges them, then all expected cases/coverage contribute once; removal of any inventory/report or a cancelled shard prevents success. | Node unit `scripts/browser-test-sharding.test.mjs` using the unit manifest adapter |

## Dependencies and open decisions

1. #1176's minimal CI patch merges first; Root then transfers exclusive workflow ownership.
2. Issue #1188 tracks delivery. Root must record the shared runner-capacity decision before Task 3
   fanout. Guards and offline inventory fixtures can proceed first.
3. #1133 coordinates dispatch accounting separately; this design keeps its current limits. If the
   wrapper cannot reserve one fanout workflow safely, Root sequences #1133 before the first run.
4. Runner count is provisional until the first permitted full run supplies actual shard wall
   times and startup cost. No automatic count increase, extra run or timeout change follows.
