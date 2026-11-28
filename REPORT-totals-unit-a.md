# Unit proof (a): perf/1129-home-figures-totals @68d6da109 + merge origin/dev

Merge with origin/dev: clean, no conflicts. `npm ci` ok. Shards run as CI's unit job does (`vitest run --coverage --shard=N/8 --reporter=default ...`, full mode).
Note: `tmp/1129-totals-unit-a` already existed on the remote (another session's partial shard-1 note), so this report is on **tmp/1129-totals-unit-a-2**; the other branch was left untouched.
Sandbox runs as **root (uid 0)** -- relevant to the two failures below.

| Run | Result |
|---|---|
| Shard 1/8 | exit 0 -- Test Files 349 passed, 1 skipped (350); Tests 3354 passed, 2 skipped (3356) |
| Shard 2/8 | exit 1 -- Test Files 1 failed, 354 passed (355); Tests 1 failed, 3474 passed (3475) |
| Shard 3/8 | exit 0 -- Test Files 354 passed (354); Tests 3440 passed (3440) |
| Shard 4/8 | exit 0 -- Test Files 355 passed (355); Tests 3806 passed (3806) |
| Script tests (self-test ok, then run) | tests 1072, pass 1071, fail 1 |

## Failures, each re-run alone once
Both still fail alone (so not load-sensitive), but both are root-environment artifacts, not caused by this branch. The branch changes no edge-function files and nothing under `scripts/`.

1. `pmo-portal/src/lib/agent/checkEdgeFnErrorReporting.test.ts` -- "exits 1 and names the specific file when a function's index.ts cannot be read (unreadable-file case)..."
   Alone: 1 failed | 17 passed. Error:
   ```
   AssertionError: expected '✗ supabase/functions/erpnext-sweep/in…' to match /could not read this file/
   Received: "✗ supabase/functions/erpnext-sweep/index.ts
       is a registered job: its handler must be wrapped in withJobRun('erpnext-sweep', …) ... (#1532)
   Every edge function must route its entry point through serveWithErrorReporting (docs/adr/0066)."
   at src/lib/agent/checkEdgeFnErrorReporting.test.ts:165
   ```
   Cause: the test does `chmodSync(indexPath, 0o000)`; root can still read the file, so the "could not read" path never fires. Most likely responsible file: none changed by the branch (the test file itself relies on non-root).
2. `scripts/ci-e2e-coordination.test.mjs:664` -- "AC-OPS-1133-2 outcomes: one dispatch attempt leaves durable uncertainty on nonzero or interrupted transport"
   Alone: fails identically. Error: `Expected "actual" to be strictly unequal to: 0` (ERR_ASSERTION, notStrictEqual, expected 0 actual 0) at line 719 -- the `chmodRootAfterDispatch` fixture; root ignores the chmod so the coordinator exits 0.
   Most likely responsible file: none changed by the branch.

Verdict: no failure traces to the branch's changed files (revenue.ts, procurement repository/contracts, database.types.ts, supplierTotalsFromRows.ts, migrations 2814/2815). Both reds should pass on CI's non-root runner; not proven here (could not run as non-root).
