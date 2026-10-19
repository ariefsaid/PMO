# Browser Test Sharding Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Each independently reviewable slice
> receives a fresh Luna xhigh worker, full brief and exclusive file ownership from Root.

**Goal:** Reduce browser elapsed time while making full-suite completeness mechanically provable.
**Architecture:** First add pure manifest/aggregate guards and native collection fixtures without
changing CI. Then integrate reports and a two-runner Chromium matrix with isolated stacks and one
serial/consent/served tail. Keep `verify` and `integration` as the sole required result owners.
**Tech stack:** Node built-ins/node:test, locked Playwright/Vitest, existing GitHub Actions.
**Spec:** `docs/specs/browser-test-sharding.spec.md`.

## Global constraints

- Issue #1188; dev only. Root confirms shared capacity before workflow fanout.
- Wait for #1176 and Root's exclusive workflow handoff. Rebase onto its actual merged dev revision.
- Initial matrix is Chromium [1,2]/2, max-parallel 2, fail-fast false, four workers per shard.
- Serial is unsharded, `--workers=1`; consent retains its analytics-enabled server; served runs last.
- Four unit shards remain; no suite repetitions, skipped shard acceptance, retries or timeouts raised.
- All old guards, full applicable pgTAP, skip/time audits, process tests and Deno gates survive.
- Preserve the sole logged dispatcher, approval limits and two-workflow cap; v0.23 has priority.
- Keep local `verify-main-pr.sh` sequential. Run no full local portfolio to validate this plan.
- Each checkbox is a 2–5 minute edit/check action; existing CI jobs supply the long execution proof.

## Review focus

1. Missing one matrix artifact must fail even when all artifacts that arrived are green (Tasks 1/2).
2. Setup identities repeat by declared invocation; arbitrary deduplication must not hide lost tests (1).
3. A cancelled dependency must fail the required check instead of skipping it successfully (3).
4. A served-mode test also skipped in ordinary mode is two distinct expected executions (1/3).
5. Exact-command legacy tests need stronger graph/coverage assertions before migration (3).

## Task 1 — Offline inventory and aggregate contract (AC-BSH-001/002)

**Create:** `scripts/browser-test-sharding.mjs`, `scripts/browser-test-sharding.test.mjs`.
**No workflow/config/product edits in this first slice.**

**Interfaces:**
- `normalizePlaywrightList({ report, mode, revision, invocation }) -> Inventory`.
- `validatePartition({ full, selected, tail, served }) -> { ok, issues }`.
- `validateResults({ plan, artifacts, jobs }) -> { ok, complete, issues, counts }`.
- `Inventory` is `{ schemaVersion:1, revision, configDigest, mode, invocation, tests }`;
  `tests` entries have `{ project, file, titlePath, repeatIndex }`. Only relative normalized paths.
- `plan` records exact expected invocation IDs and each inventory digest, run ID/attempt/revision.
- `artifacts` record the matching metadata, explicit process outcome and projected test results.
- CLI subcommands: `plan --input <manifest-input.json> --output <plan.json>` and
  `check --plan <plan.json> --results <artifact-dir> --jobs <jobs.json> --summary <safe.json>`.
  Exit 0 complete success, 1 failed/incomplete evidence, 2 invalid usage or inability to write the required plan/summary output. Both failure classes remain nonzero. Write safe diagnostics
  before setting `process.exitCode`; no browser/process/network action at module import.

- [ ] Write failing AC-tagged pure fixtures: complete full set A/B/C/D, shards {A,B}/{C,D}; then
  missing D, duplicate B, extra E, empty shard, unknown project, mismatched revision/configDigest.
  Assert exact issue codes and `ok:false`, not merely absence of throw.
- [ ] Run `node --test scripts/browser-test-sharding.test.mjs`; capture intentional RED.
- [ ] Implement canonical identities via JSON tuple encoding, not delimiter concatenation. Validate
  every source field, reject traversal/absolute/control-character paths, preserve title arrays and
  multiplicity. Exclude setup from Chromium partition only after checking setup's separately
  declared per-invocation multiplicity. Do not silently deduplicate any other identity.
- [ ] Add complete result fixtures then each status: failure, skipped job, cancelled, timeout,
  unknown, missing job, missing/duplicate artifact, stale run attempt, malformed JSON, missing
  expected case, extra case and duplicate result. Each must return incomplete/failure. Include
  a passed result after a failed attempt: failure remains fatal. A legitimate ordinary skip is
  present in inventory/results and still awaits the existing central skip audit.
- [ ] Implement result/provenance checking and safe summary projection. Summary fields: schema,
  revision, lane/shard, expected/reported counts, explicit completion, outcomes and safe issue
  codes. No stdout/stderr/attachments/raw bodies/session data/absolute paths. Sentinel tests must
  prove excluded fields cannot appear. Run green, then remove one expected artifact: guard RED.
- [ ] Add CLI subprocess fixtures using temporary directories, names with spaces, invalid input,
  unreadable files and unwritable summary. Run the same focused Node test; cleanup temporary data.

## Task 2 — Native collection and four-unit adapter (AC-BSH-004/006)

**Create:** `pmo-portal/test/fixtures/browser-sharding/playwright.config.ts`,
`pmo-portal/test/fixtures/browser-sharding/sharding.fixture.ts`,
`pmo-portal/test/unitShardReporter.ts`.
**Modify:** the two new sharding scripts only. No app/global test-config/workflow edit yet.

- [ ] Create a no-webServer Playwright fixture config selecting only `sharding.fixture.ts`,
  `fullyParallel:true`, retries 0. Its fixture has standalone cases plus a serial describe with
  dependent names `serial-first`/`serial-second`. Test bodies need no browser and are not run.
  The filename deliberately avoids Vitest's test/spec discovery and e2e isolation denominator.
- [ ] In the Node test, invoke the installed Playwright CLI using `process.execPath` with that
  exact config, `--list --reporter=json`, once unsharded and once each `--shard=1/2`/`2/2`.
  Assert no body ran, full set equals disjoint union and serial-first/second co-locate. Normalize
  its actual locked JSON schema; malformed or absent list output must fail collection.
- [ ] Add a Vitest-list adapter using installed 4.1 list fields `name/file/projectName`; note the
  locked list formatter excludes already declared skipped cases. Do not treat that CLI as an
  inventory of skipped declarations. Compare the full active list with both the per-shard active
  lists and actual active results. Existing skipped declarations remain visible in the result
  evidence, with no new skip permission or inferred execution success.
- [ ] Implement `unitShardReporter.ts` with Vitest's typed Reporter API to emit projected module
  project, relative file, full title, mode and final outcome for **all** collected result tasks,
  including skips/todos, without bodies/logs. Consume `TestModule`/test entities, not reimplemented
  discovery or copied test assertions. Emit one artifact even on failed run; collection failure
  marks it incomplete. Default and blob coverage reporters stay configured on the command line.
- [ ] Add small synthetic unit/report fixtures in the Node tests for two projects, parameterized
  names, filenames with spaces, skipped result visibility and missing one of four shard files.
  Active list names and reporter names must match exactly; module/file ownership disambiguates
  projects. Reject ambiguous mapping instead of guessing from a flattened display name.
- [ ] Run `node --test scripts/browser-test-sharding.test.mjs` plus locked app typecheck and lint
  only the new TypeScript files. Run changed-importer Vitest under the test lock; no full suite,
  DB or real browser is needed. Record complete contract evidence before Root reviews this slice.

## Task 3 — Workflow fanout and required aggregates (AC-BSH-003)

**Modify:** `.github/workflows/ci.yml`, `scripts/ci-integration-order.test.mjs`;
new sharding scripts/reporter only as needed by their declared interfaces.
**Read-only:** `scripts/ci-e2e.sh`, `scripts/verify-main-pr.sh`, current Playwright config/package scripts.
**Entry:** #1176 merged and Root hands over workflow ownership/capacity decision/new issue number.

- [ ] First add failing workflow contract tests for: exactly two Chromium matrix entries, four
  unit shards, one serial one-worker invocation, consent, served-after-ordinary dependency,
  mandatory full pgTAP rule, pinned runtime retention, metadata/artifact completeness, central
  skip+timing audits and aggregate `always()` plus explicit all-success checks. Keep the one
  workflow owner and no-retry checks unchanged. Run the focused repository contract test RED.
- [ ] Replace only the exact-three-ordinary-command assumptions with the stronger assertions above.
  Retain sequential command/order checks for `verify-main-pr.sh`. Record each replaced assertion
  next to its new oracle; deletion without an equivalent stronger oracle fails review.
- [ ] Add `browser-plan` under the existing integration event predicate. Reuse current pinned
  checkout/Node/Deno/CLI/actions, dependency setup, ephemeral stack, migration/isolation checks,
  env preparation and **full** pgTAP conditional (`automatic OR dispatch run_pgtap`). After setup,
  collect full chromium/serial/consent plus two chromium shard lists and the dedicated served-smoke
  list using the exact same locked configuration/flags; run the manifest guard. Transfer safe
  plan metadata; credentials/session state never leave this runner. No test body executes here.
- [ ] Add `browser-chromium` matrix [1,2], fail-fast false, max-parallel 2. Each runner checks out
  the same revision and independently repeats only runtime/stack/seed setup needed for its tests,
  not pgTAP or the unit suite. Collect its selected inventory and check planned digest before
  executing `npx playwright test --project=chromium --shard=${{ matrix.shard }}/2 --reporter=list,json`.
  Route JSON through the reporter output setting; keep human-readable output on stdout.
- [ ] Upload exact `browser-chromium-1`/`browser-chromium-2` metadata, selected inventory and JSON
  even on test failure where available. Use unique HTML/trace names per shard and retention as
  specified. A missing artifact is fatal downstream; no `continue-on-error` or tolerated download.
- [ ] Add `browser-tail` needing plan and the whole matrix. After matrix terminal states, run it
  when the plan succeeded under `always()` so a Chromium failure can still yield tail diagnostics.
  Prepare its own stack, collect/verify serial and consent, run each in separate steps:
  `npx playwright test --project=serial --workers=1 --reporter=list,json`, then
  `npx playwright test --project=consent --reporter=list,json`. Keep existing consent configuration.
  Record each process outcome independently; failure must not be overwritten by a later success.
- [ ] Download exact ordinary artifacts into a run-private directory on tail. Invoke unchanged
  `check-e2e-skips.mjs` once with BOTH Chromium reports plus serial and consent. Invoke unchanged
  `check-e2e-time-budget.mjs` once with the same set and safe-summary output. Run audits on all
  available evidence after failures; missing input still fails and incomplete summary is honest.
  Upload only the safe timing summary for ordinary public-facing retention as before.
- [ ] Run the existing served smoke after those ordinary stages on tail through the same shared
  serve wrapper. Record its selected inventory/results and exit status; do not serve a runner
  before its ordinary tests. Its expected dedicated-mode inventory is distinct from ordinary
  skipped instances. No new served suite, bench dependency or schema changes.
- [ ] Rename the old heavy job implementation to its new internal jobs, keeping `integration`
  only for the final aggregate. It needs plan, entire matrix and tail, runs `always()` for the
  original integration event predicate, checks **every** dependency result equals success, then
  exact artifact/provenance/inventory and every policy-stage status. `jobs.json` is constructed
  from structured `needs` metadata, never human log grep. Missing/skipped/cancelled means failure;
  whole-workflow cancellation leaves a non-success required result. No successful stub is allowed.
- [ ] Strengthen `verify` similarly for non-dispatch events: `always()` plus explicit unit result
  success, exact four inventories/reports and union proof before coverage merge. Unit jobs collect
  full/per-shard active lists without executing the suite twice; add the typed inventory reporter
  alongside default+blob during the one actual run. Preserve exact four blob files and merged
  coverage before changed-line scoring. Preserve #1176's four Python tests and all other gates.
- [ ] Run `node --test scripts/browser-test-sharding.test.mjs scripts/ci-integration-order.test.mjs scripts/deno-inventory.test.mjs`.
  Perform focused fixture mutations (remove matrix member, remove artifact, change serial workers,
  skip aggregate on cancellation, move served earlier): each relevant contract must RED; restore
  and capture GREEN. No outer full-suite repetition.

## Task 4 — Final evidence and acceptance (AC-BSH-005)

- [ ] Run final locked app typecheck/changed-importer Vitest, lint the touched TypeScript files,
  and `git diff --check`. Existing root tooling tests provide the script checks. No local full
  browser run, DB reset or full verify is necessary for this workflow-only delivery.
- [ ] Root obtains the standard spec/quality/security review with builder evidence and the explicit
  old→new contract map. Root then releases one PR to dev; its usual four unit shards/pgTAP/verify
  must pass before any closing integration dispatch. No second workflow owner or protection edit.
- [ ] Root dispatches once through `scripts/ci-e2e.sh <assigned-branch>` when its reservation and
  v0.23 priority permit. Record final revision, all job statuses and exact expected/actual inventories,
  skip/timing/pgTAP/served outcomes and shard artifact names. Any missing stage keeps acceptance red.
- [ ] Compare this run's child wall times and aggregate completion with the historical 29m16s
  baseline, labelling revision/portfolio/setup differences. No statistical speed claim from a
  single run, automatic count increase or extra timing-only dispatch. Root decides acceptance;
  the mechanism's complete green proof is mandatory even if speedup is smaller than expected.

## Gate-to-task map

AC-BSH-001/002 → Task 1; AC-BSH-004/006 → Task 2; AC-BSH-003 → Task 3;
AC-BSH-005 → Task 4. #1176 and resource ownership are entry conditions, not work silently absorbed.
The plan changes no source or CI by itself and makes no implementation-complete claim.
