# CI Dispatch Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task, through the executor assigned by the Director. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PMO admissions account for durable reservations and definitive remote evidence while preserving the approved dispatch policy.

**Architecture:** Keep the Bash entry point and its existing machine lock; delegate the locked transaction to a dependency-free Node module. Pure reconciliation/admission functions operate on validated data; the CLI adapter performs read-only remote collection, atomic local persistence, compatible audit append and at most one dispatch write. A separate ledger avoids changing the peer's audit reader.

**Tech Stack:** Existing Bash/Python lock, Node 22.22+ ESM and built-in `node:test`, installed `gh`; no dependencies or lockfile change.

**Spec:** `docs/specs/ci-dispatch-coordination.spec.md` (#1133; FR-OPS-001–005, NFR-OPS-001).

## Global constraints

- Release ceiling: `dev`. This plan authorizes no real dispatch, merge, production action or operational installation.
- Temporary capacity is two for v0.23.0 only; #1134 owns restoration to one. `--owner-ok` cannot override capacity.
- UTC daily cap is three. One branch dispatch is ordinary; the second needs `--bugfix-proof` or `--owner-ok`; later ones need `--owner-ok`.
- Preserve the existing public wrapper CLI, shared machine lock, five-column audit format and `run_pgtap` choice.
- The peer wrapper and its one-run policy remain unchanged. The PMO ledger is not a claim of cross-writer adoption.
- Unknown acceptance consumes capacity without a timeout release. Failed/malformed/incomplete required reads refuse admission. No automatic dispatch retries or other API writes.
- Tests use fake `gh`, temporary logs/locks/state and synthetic data only. No API, browser, provider, database, Docker or shared operational-state calls.
- Builder writes only the three files below. The Director separately owns CI registration, peer agreement and release gates. Statements retain shared-capacity priority.

## Review focus

1. Overlapping run candidates: neither reservation steals a run; reciprocal uniqueness is tested in Task 3.
2. Process interruption between persistence and response: the durable uncertainty survives; Tasks 5 and 7 test it.
3. Pagination or schema surprises: partial evidence never becomes an empty queue/history; Task 6 tests it.
4. Legacy audit rows at a UTC boundary: aliases and linked identities preserve accounting; Task 4 tests it.
5. An audit/rename failure after admission: no false completion or lost busy slot; Tasks 5 and 7 test it.

## File boundaries and interfaces

| File | Responsibility |
|---|---|
| Create `scripts/lib/ci-dispatch-reservations.mjs` | Pure validated model plus a guarded CLI transaction adapter; no work at import |
| Create `scripts/ci-e2e-coordination.test.mjs` | Pure subtests and fake-process acceptance suite, temporary fixture generation |
| Modify `scripts/ci-e2e.sh` | Preserve argument parsing/self-test/locking; invoke the coordinator inside that lock |

Do not edit `scripts/lib/flock-run.sh`, the peer repository, workflow configuration, product code,
local launchers or tracked configuration. The Director adds the new owning test to CI separately
before the code PR's final gates; registration is not part of this builder's ownership.

Use these exports consistently (JSDoc types suffice; no TypeScript compilation layer):

```js
canonicalRepo(value, aliases) // string -> canonical string; explicit aliases only
parseAudit(text, aliases) // string -> AuditRow[]; five columns, reject malformed nonblank rows
parseLedger(text) // string -> Ledger; reject unsupported versions/invalid fields
loadLedger(file) // -> Ledger; only ENOENT starts empty; other read errors reject
reconcile({ reservations, remoteRuns, queryComplete, observedAt }) // -> State
// State: { reservations, remoteRuns, queryComplete, observedAt }
decide({ state, policy, request }) // -> { allowed, reason, reservation }
// state additionally has auditRows and now, attached by the caller
// policy: { capacity: 2, dailyCap: 3 }
// request: { requestId, repo, workflow, branch, head, startedAt,
//            baselineRunIds, kind, quote, pr }
saveLedger(file, ledger) // -> void; fsync temp file, rename in same directory
appendAudit(file, row) // -> void; sanitize operator text, append and flush
collectObservation(options) // -> Promise<{ remoteRuns, queryComplete, observedAt, head, pr }>
coordinate(options) // -> Promise<number>; checked process adapter; no work on import
```

`Ledger` is `{ schemaVersion: 1, reservations: Reservation[] }`. A `Reservation` contains the
request metadata above, `status`, nullable `runId` and nullable `finishedAt`. Persist only ledger
fields, not the collected remote response. Status is one of `reserved`, `accepted-unresolved`,
`linked-active`, `linked-terminal`, `rejected`, `unknown`. Request IDs are fresh UUIDs. Run IDs
are positive safe integers. Times are valid UTC ISO strings. Branch/head/workflow/repository
identities must be present and consistent; malformed or duplicate/conflicting IDs refuse.
`RemoteRun` has `repo`, `workflow`, `runId`, `event`, `branch`, `head`, `createdAt`, `status`.
`AuditRow` has `at`, `repo`, `branchPr`, `kind`, `quote`. Refusal is an explicit result, never a
zero fallback. Filesystem/adapter errors become nonzero CLI results, not empty data.

The module CLI is `coordinate` with required arguments `--repo`, `--workflow`, `--branch`,
`--kind`, `--quote`, `--log`, `--capacity`, `--daily-cap`, repeated `--observe <repo>:<workflow>`,
and optional `--dry-run`. It derives the ledger path by appending `.reservations.json` to the
log argument. Repository/workflow values come from the wrapper's existing constants. The helper
resolves the head and PR itself through checked reads. Export functions without running the CLI
unless the module is the process entry point. The wrapper passes an argument array, never shell
source assembled from branch or quote text.

The adapter uses argument-vector subprocesses, not `sh -c`. Every API request other than the one
`gh workflow run` is explicitly a GET. Collection uses `gh api --method GET --paginate --slurp`,
workflow-run list endpoints, dispatch-event filters and validated page bodies. Gather configured
active-workflow observations, PMO UTC-day and branch history, the pre-dispatch baseline and direct
GETs for linked identities. Require each successful collection's unique IDs to cover its advertised
`total_count`; a page error, inconsistent count or capped/incomplete result refuses. De-duplicate
identical run observations and reject contradictory identity/status data. Resolve a branch head
through the read-only Git reference endpoint, encoding branch text as data. Keep the existing
checked PR lookup and its absent-PR result. No reads happen from an imported module.

## Transaction and accounting decisions

Under the existing lock: read/validate state and audit; collect complete remote evidence; reconcile;
evaluate capacity and history. Dry-run returns this decision without saving reconciliation or
creating either file. For an allowed real invocation:

1. Atomically persist `reserved` before any dispatch attempt.
2. Append and flush one sanitized five-column audit row. An append failure prevents dispatch.
3. Atomically persist `unknown` with the pre-dispatch start sample before starting the child.
4. Call `gh workflow run` exactly once with the existing branch ref and `run_pgtap` value.
5. Record the first post-process end sample and `accepted-unresolved` for rc0, otherwise `unknown`.
6. Make one read-only post-attempt observation, reconcile and atomically save. No polling/retry loop.

Known pre-process refusal may save `rejected`. Once the dispatch child has started, a nonzero
exit is conservatively unknown, even if its text looks reassuring. If a later save fails, the
previous durable `unknown` still consumes capacity. A partially written audit row is not silently
repaired or discarded; the next read refuses until the Director resolves it. History is retained.
Only after all required writes succeed may rc0 print `dispatch accepted` (with `run pending`
when unresolved). An uncertain outcome or any required read/write error returns nonzero and
prints no success message. A linked terminal run releases only its busy identity.

Candidate creation times must fall between `startedAt` and `observedAt`, the current complete
observation cutoff, rounded outward to whole seconds. The upper bound advances only with complete
read evidence; `finishedAt` records process outcome and never limits remote creation. A run created
after the command finishes may link on a later complete observation. IDs in `baselineRunIds` are
excluded. Linking requires exactly one candidate and reciprocal uniqueness across unresolved
reservations. Missing finish metadata after interruption does not prevent such a definitive match;
ambiguity or absence still consumes capacity. There is no aging or guessed recovery command.
Branch movement or clock skew may leave a conservative unresolved request; neither permits
substitution of a different immutable head.

Busy count is a set union: remote identities plus one request identity for each unlinked unresolved
request. Linked run identities never add a second count. For each history bucket, collapse ledger
requests linked to remote identities and retain all terminal attempts; take the greater of this
union's size and the legacy audit-row count. Explicitly rejected unsent ledger requests add no
new ledger history; any existing legacy row stays. Support the existing short peer alias and
canonical repository forms through an explicit map copied from the existing readers, not suffix
or substring matching. UTC-day accounting uses the attempt start for an unlinked request and the
run creation time after linking; it never counts the same identity on both days after reconciliation.

## Tasks

Each task is a 2–5 minute increment; code changes follow TDD. Tests call shipped exports/the shipped CLI, never a copied
implementation. Test helpers stay in the one test file. All commands below run from the repository
root unless shown otherwise. A behavior change requires its named RED before its code
step; a coverage-only assertion that already passes requires no artificial break or code change. A
selection matching zero tests is not evidence. Do not commit during a failed intermediate
increment. The Director supplies a fresh executor brief and the actual feature branch.

### Task 1 (5 min): establish isolated ledger parsing fixtures

**Files:** create helper and test files. **Proof:** AC-OPS-1133-2, NFR-OPS-001.
**Interface:** `parseLedger(text)`, `loadLedger(file)` and the fixture builder `makeFixture(t, options)` in the test file.

- [ ] Add `AC-OPS-1133-2 ledger` tests: absent-file adapter behavior is empty version 1; malformed JSON, version 2, duplicate IDs, invalid times and missing immutable head reject. Assert failed parsing preserves original bytes.
- [ ] Run `node --test --test-name-pattern='AC-OPS-1133-2 ledger' scripts/ci-e2e-coordination.test.mjs`; expect RED from the missing export/behavior.
- [ ] Implement strict parsing and safe missing-file handling. Fixture setup creates a temporary home/bin/log/ledger/lock, a synthetic `fixture/alpha` workflow and fake `gh` before spawning anything; remove operational lock-held markers from child environments. Fake `gh` rejects every unlisted command; fixture teardown awaits all children before removing its directory.
- [ ] Run the same command; expect the selected tests PASS. Importing the helper must leave the fixture journal empty.

### Task 2 (4 min): model capacity as an identity union

**Files:** helper and test file. **Proof:** AC-OPS-1133-1.
**Interface:** `reconcile(...) -> State`, `decide(...) -> decision` from the shared contract.

- [ ] Add `AC-OPS-1133-1 capacity` tests with zero/one/two occupied identities; include `reserved`, `unknown` and `accepted-unresolved`, a linked active identity observed remotely, and duplicate identical remote rows. Assert two refuses even with owner approval; the linked identity counts once.
- [ ] Run `node --test --test-name-pattern='AC-OPS-1133-1 capacity' scripts/ci-e2e-coordination.test.mjs`; expect RED.
- [ ] Implement the busy set and explicit capacity-first admission result. Keep unresolved age irrelevant; reject `queryComplete=false` instead of deriving a count.
- [ ] Repeat the command; expect PASS, including the linked-identity non-duplication assertion.

### Task 3 (5 min): reconcile only uniquely attributable runs

**Files:** helper and test file. **Proof:** AC-OPS-1133-1 and AC-OPS-1133-2.
**Interface:** extend `reconcile`, preserving Task 2's result shape.

- [ ] Add `AC-OPS-1133-1 identity` and `AC-OPS-1133-2 reconciliation` subtests: wrong repository/workflow/event/head/branch/window, pre-existing run ID, two candidates, one run eligible for two requests, missing finish metadata, a unique run created after process finish, repeated observation, definitive terminal state, absent linked run and failed linked-run GET. Assert only reciprocal unique matches link; terminal history remains; ambiguity/absence releases nothing.
- [ ] Run `node --test --test-name-pattern='AC-OPS-1133-(1 identity|2 reconciliation)' scripts/ci-e2e-coordination.test.mjs`; expect RED.
- [ ] Implement candidate-set construction before transitions (no greedy first-match selection). A known linked run with a failed/absent read refuses new admission; definitive nonterminal/terminal evidence determines its slot.
- [ ] Repeat the command; expect PASS and unchanged results after a second reconciliation.

### Task 4 (5 min): preserve approval and legacy history accounting

**Files:** helper and test file. **Proof:** AC-OPS-1133-3.
**Interface:** `canonicalRepo`, `parseAudit`, and the history portion of `decide`.

- [ ] Add `AC-OPS-1133-3 history` cases for canonical/short aliases, three UTC-day attempts, a linked run present in both stores, terminal history, old five-column rows and a midnight boundary. Assert normal second branch request refuses; bugfix proof permits exactly the second; third needs owner approval; daily fourth needs owner approval; capacity still refuses all flags.
- [ ] Run `node --test --test-name-pattern='AC-OPS-1133-3 history' scripts/ci-e2e-coordination.test.mjs`; expect RED.
- [ ] Implement the explicit alias map, strict five-column reader and per-bucket history maximum over the identity union and legacy rows. Preserve legacy rows byte-for-byte; do not migrate the shared log or infer run IDs from free text.
- [ ] Repeat the command; expect PASS, including no double-count after linking and no cross-day double count.

### Task 5 (5 min): persist conservative state and audit before dispatch

**Files:** helper and test file. **Proof:** AC-OPS-1133-2 and AC-OPS-1133-3.
**Interface:** `saveLedger(file, ledger)` and `appendAudit(file, row)`.

- [ ] Add `AC-OPS-1133-2 persistence` cases for initial write, atomic replacement, existing destination directory, unwritable parent and audit append failure. Assert old bytes survive failed rename, filesystem errors propagate and imports make no process calls. Task 7 proves CLI refusal before dispatch. Add `AC-OPS-1133-3 audit` for tab/CR/LF text becoming one five-column row.
- [ ] Run `node --test --test-name-pattern='AC-OPS-1133-(2 persistence|3 audit)' scripts/ci-e2e-coordination.test.mjs`; expect RED.
- [ ] Write a uniquely named temporary file beside the ledger, flush it and rename; never truncate the original. Clean only the current attempt's temporary file on error. Implement append/flush of a sanitized five-column row. Leave orchestration of these primitives to Task 7, which enforces reserved/audit/unknown order and the conservative failure result.
- [ ] Repeat the command; expect PASS. Restore temporary directory permissions during fixture teardown; do not depend on permissions of operational files.

### Task 6 (5 min): collect complete checked read evidence

**Files:** helper and test file. **Proof:** AC-OPS-1133-2.
**Interface:** exported `collectObservation(options) -> Promise<{ remoteRuns, queryComplete, observedAt, head, pr }>` consumed by `coordinate`.

- [ ] Add `AC-OPS-1133-2 reads` fake-process cases for two valid pages, queued/in-progress/history/head/PR/linked-run nonzero exits, invalid JSON, missing fields, contradictory observations, incomplete pagination and changed immutable head. Call this shipped adapter directly against the fake executable; assert rejection, zero dispatch calls and unchanged ledger/log on pre-admission read errors. Task 7 maps rejection to nonzero CLI refusal.
- [ ] Run `node --test --test-name-pattern='AC-OPS-1133-2 reads' scripts/ci-e2e-coordination.test.mjs`; expect RED.
- [ ] Implement explicit GET argument vectors and strict page validation as specified above. The fake journal asserts GET on every API command. Snapshot prior eligible run IDs before reservation, resolve the immutable head, record `observedAt` for each complete observation, and make a failed required read fatal. Do not use command-output text or numeric fallbacks as empty observations.
- [ ] Repeat the command; expect PASS. The fixture fails if a real `gh` binary or unlisted command could be reached.

### Task 7 (5 min): perform one dispatch with honest outcome reporting

**Files:** helper and test file. **Proof:** AC-OPS-1133-2 and AC-OPS-1133-3.
**Interface:** `coordinate(options) -> Promise<number>` and CLI entry-point guard.

- [ ] Add `AC-OPS-1133-2 outcomes` fake-process cases: rc0 delayed visibility with remote creation after the process finish time; nonzero dispatch; process interruption after durable `unknown`; failed post-dispatch read; failed post-dispatch rename; failed audit append; failed reserved/unknown pre-dispatch persistence. Assert exactly one attempted write after a started attempt, zero writes on pre-dispatch refusal, nonzero on uncertain/error results, no success claim and durable capacity retained. Add `AC-OPS-1133-3 pgtap` for present versus absent PR and branch/quote characters passed literally.
- [ ] Run `node --test --test-name-pattern='AC-OPS-1133-(2 outcomes|3 pgtap)' scripts/ci-e2e-coordination.test.mjs`; expect RED.
- [ ] Implement the ordered transaction, attempt timestamps and single read-only reconciliation after the command. Pass only the existing `run_pgtap` field to dispatch; do not alter workflow inputs or retry. Save rc0 as accepted-unresolved until a unique run is linked; an interrupted command cannot clear uncertainty.
- [ ] Repeat the command; expect PASS. Synchronize interruption/fault injection with explicit fake-process journal markers rather than guessed sleep delays.

### Task 8 (4 min): wire the existing locked wrapper and dry-run

**Files:** modify wrapper; extend test file. **Proof:** AC-OPS-1133-1 and AC-OPS-1133-3.
**Interface:** existing wrapper CLI -> helper CLI contract; keep self-test available without remote access.

- [ ] Add `AC-OPS-1133-3 wrapper` process cases for ordinary/approval arguments, dry-run with and without an existing ledger, accepted and refused decisions, and the isolated `--self-test`. Assert dry-run leaves byte-identical files or both absent, dispatch count zero, and no ledger outside the fixture directory.
- [ ] Run `node --test --test-name-pattern='AC-OPS-1133-3 wrapper' scripts/ci-e2e-coordination.test.mjs`; expect RED.
- [ ] Preserve the existing lock acquisition/re-entrant entry, constants, parsing and self-test; replace the locked read/dispatch tail with `exec node` and the defined argument vector. Keep one approval-kind interpretation and the original capacity-two self-test cases. Any adapter lock assumption is documented: the wrapper holds it; direct test invocations acquire the same temporary lock first.
- [ ] Repeat the command and `bash -n scripts/ci-e2e.sh`; expect PASS and syntax rc0. The process fixture tests lock participation, not just a source-string match.

### Task 9 (5 min): prove delayed visibility and lock lifetime across processes

**Files:** test file; helper/wrapper only if a new failing assertion requires a fix. **Proof:** AC-OPS-1133-1.
**Interface:** two synthetic CLI writers use the same fixture ledger/log and existing lock core.

- [ ] Add `AC-OPS-1133-1 process` with synthetic `fixture/alpha` and `fixture/beta` writers. Keep both fake dispatches invisible, then attempt a third and assert exactly two dispatch journal entries. Reveal run IDs with creation times after their dispatch processes finished and assert each links only to its tuple; a third still refuses until one definitively completes. Add an observed nonparticipating peer run case.
- [ ] Run `node --test --test-name-pattern='AC-OPS-1133-1 process' scripts/ci-e2e-coordination.test.mjs`; expect RED if the boundary is not enforced.
- [ ] Hold fake dispatch A at a journal barrier, start B, and prove B cannot perform its admission read until A's state-write and lock release. Use the existing `flock-run.sh` with temporary paths; set its optional slot configuration to one in the fixture. Assert journal ordering, never elapsed time. Fix only the three owned files if the control fails.
- [ ] Repeat the command; expect PASS. Label the second writer a protocol participant, not the unchanged peer wrapper. No actual peer file is invoked or modified.

### Task 10 (4 min): prove stale uncertainty, negative controls and coverage

**Files:** test file and helper; transient mutations restored before completion. **Proof:** all three ACs.
**Interface:** full owning suite against the shipped implementation.

- [ ] Add `AC-OPS-1133-2 stale` with a years-old unknown request and ambiguous overlap; assert neither age nor owner approval erases capacity. Run `node --test --test-name-pattern='AC-OPS-1133-2 stale' scripts/ci-e2e-coordination.test.mjs`; if it fails, record RED before fixing the helper, then require GREEN. If already green, retain the coverage without changing code.
- [ ] Run `node --test scripts/ci-e2e-coordination.test.mjs`; expect all AC cases PASS. Temporarily omit unresolved reservations from the capacity union and rerun `node --test --test-name-pattern='AC-OPS-1133-1 process' scripts/ci-e2e-coordination.test.mjs`; require RED, restore and require GREEN.
- [ ] Temporarily treat a required read failure as empty and run `node --test --test-name-pattern='AC-OPS-1133-2 reads' scripts/ci-e2e-coordination.test.mjs`; require RED, restore and require GREEN. Record exact failing test names, not only return codes.
- [ ] Run `node --experimental-test-coverage --test --test-coverage-include=scripts/lib/ci-dispatch-reservations.mjs --test-coverage-lines=80 scripts/ci-e2e-coordination.test.mjs`; require PASS and at least 80% helper lines. Do not weaken assertions or count copied implementation as evidence.

### Task 11 (5 min): scoped verification and build handoff

**Files:** three owned files only. **Proof:** acceptance matrix and gate evidence; no new behavior.
**Interface:** report to Director with exact current head/diff and outputs.

- [ ] Run `node --check scripts/lib/ci-dispatch-reservations.mjs`, `node --check scripts/ci-e2e-coordination.test.mjs`, `bash -n scripts/ci-e2e.sh`, and `bash scripts/ci-e2e.sh --self-test`; require syntax success and the self-test success body. Self-test must remain before any operational state/read path.
- [ ] Run `node --test scripts/ci-e2e-coordination.test.mjs scripts/ci-integration-order.test.mjs`; require all tests PASS. The existing lock core is unchanged; do not rerun its full heavy fixture battery without a specific new concern.
- [ ] From `pmo-portal`, run `npx eslint --no-config-lookup --max-warnings=0 --rule 'no-unused-vars:error' --rule 'no-undef:error' --global process --global console --global Buffer --global setTimeout --global clearTimeout ../scripts/lib/ci-dispatch-reservations.mjs ../scripts/ci-e2e-coordination.test.mjs`; require zero errors/warnings. The app's normal lint configuration scopes TypeScript, so use these explicit Node rules for the new ESM files rather than accepting an ignored-file result.
- [ ] From repository root, run `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'`, then `git diff --check`; require zero type errors, no failing changed-importer tests and clean whitespace. Report a zero-test changed-importer result honestly for the Director to assess; do not introduce a skip or change the gate. The scripts are owned by the Node suite, which must actually run. No application journey or DB surface is touched, so do not invoke local e2e, DB reset or cloud dry-run.
- [ ] Report the three AC rows, coverage, mutation names/results, changed files and precise PMO-only guarantee to the Director. Director obtains spec/quality/security reviews, adds CI registration, and inspects the four unit shards + pgTAP + verify for the PR to `dev`. A real browser dispatch is neither a feature proof nor authorized by this plan.

## Traceability and release handoff

| Requirement / acceptance | Tasks | Owning proof |
|---|---|---|
| FR-OPS-001; AC-OPS-1133-1 | 2, 3, 8, 9 | Node process suite: capacity/identity/process |
| FR-OPS-002; AC-OPS-1133-2 | 1, 2, 5, 6, 7, 10 | Node process suite: ledger/reads/outcomes/stale |
| FR-OPS-003; AC-OPS-1133-1/2 | 3, 6, 9 | Node process suite: identity/reconciliation/process |
| FR-OPS-004; AC-OPS-1133-2 | 5, 7 | Node process suite: persistence/outcomes |
| FR-OPS-005; AC-OPS-1133-3 | 4, 5, 7, 8 | Node process suite: history/audit/pgtap/wrapper |
| NFR-OPS-001 | 1, 6, 9, 11 | All fixtures use temporary state and fake process journal |

The Director's build brief should give the fresh executor this plan and its spec, an isolated
feature branch off `dev`, the three-file ownership list and the signed IDs unchanged. Preserve
all earlier WIP; no broad staging, lockfile regeneration, peer edits or workflow edits. Executor
routing follows `docs/factory-workflow.md`; this document does not start an executor.

The PMO slice is build-ready. Whole-issue closure still needs explicit peer coordination agreement:
the unchanged peer is not a reservation writer, so the implementation proves PMO admission
accounting rather than full cross-repository atomic admission. The Director owns that coordination,
CI registration and any future real dispatch permission. This plan introduces no ADR, because it
implements the existing bounded policy without a new platform or irreversible architectural choice.
