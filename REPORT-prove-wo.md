# Proof run: perf/1129-work-order-page-deferred-reads (493c71e45)

Local, off CI. `origin/dev` merged into the branch locally: already up to date (no conflict).
Sandbox runs as root with 4 CPUs. Local Supabase stack reset from migrations + seed.

## Step 4 — DATABASE
Skipped: `git diff --name-only origin/dev...HEAD` lists no file under `supabase/`
(14 files, all under `pmo-portal/`: WorkOrderDetail page + test, App.preloads test, 4 hooks in `src/hooks`,
`workOrderFinance.ts`, `routeData.ts`, 4 files in `src/lib/routeQueries`, one new test).

## Step 5 — UNIT (full suite, 8 shards sequentially, `vitest run --shard=N/8`)
| Shard | Test Files | Tests |
|---|---|---|
| 1/8 | 349 passed | 3381 passed |
| 2/8 | 353 passed, 1 skipped (354) | 3587 passed, 2 skipped (3589) |
| 3/8 | 354 passed | 3335 passed |
| 4/8 | 354 passed, **1 failed** (355) | 4042 passed, **1 failed** (4043) |
| 5/8 | 356 passed | 3869 passed |
| 6/8 | 356 passed | 3937 passed |
| 7/8 | 355 passed | 3458 passed |
| 8/8 | 355 passed | 3504 passed |

Only failure: `src/lib/agent/checkEdgeFnErrorReporting.test.ts` > "exits 1 and names the specific file when a
function's index.ts cannot be read (unreadable-file case)". Error: `expected '✗ supabase/functions/erpnext-sweep/in…'
to match /could not read this file/`. Cause: the test does `chmodSync(index.ts, 0o000)` and this sandbox runs as
uid 0, which ignores file modes, so the read succeeds. Environmental, not in the diff, reproduced alone.
Not related to the branch.

