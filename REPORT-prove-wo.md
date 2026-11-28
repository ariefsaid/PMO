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


## Step 6 — BROWSER (affected-e2e vs origin/dev, `--allow-broad`: 480 of 545 specs; 329 chromium lane, 151 serial lane)
Run with `scripts/e2e-local.sh --project=<lane> --retries=0`, chunks of 40 files (chromium 2 workers, serial 1 worker).
Sandbox restarted once mid-run (chunk 1 was killed at 49/63 and re-run in full after a stack reset).
- chromium chunk 0: 60 passed (7.2m)
- chromium chunk 1: 59 passed, 4 skipped (7.0m)
- chromium chunk 2: 6 skipped,63 passed (7.4m),
- chromium chunk 3: 1 failed,2 did not run,76 passed (8.3m),
  - FAILED: 1) [chromium] › e2e/AC-S21-005-task-list-review.spec.ts:124:3 › S21 complete ordered task-link journey › Supporting proof: Admin reviews the ClickUp list, saves the source, and reads back the binding 
  - Re-run alone: `AC-S21-005-task-list-review.spec.ts` fails again (10 passed, 1 failed, 41s), same error `S21_HANDLER_SERVER_EXITED_EARLY`
    (the spec spawns `deno run --no-remote ...` as a child process, and the child exits before it reports ready). The same Deno module loads
    and starts in this sandbox when run by hand (Deno 2.7.11, same as CI), so the cause was not isolated here. Neither the spec nor its support
    files nor the external-link function are in the branch diff, and the test does not touch the work order page. Treat as sandbox/lane-specific, not a branch regression.
- chromium chunk 4: 57 passed (6.3m),
- chromium chunk 5: 58 passed (7.0m),
- chromium chunk 6: 57 passed (7.6m),
- chromium chunk 7 (40 files, 180 tests incl. layout sweeps): too long for one foreground call; re-run as four 10-file sub-chunks c70-c73:
- chromium c70 (10 files): 20 passed (2.4m),
- chromium c71 (10 files): 20 passed (2.2m),
- chromium c72 (10 files): 53 passed (4.1m),
- chromium c73 (10 files): 117 passed (9.3m),
- chromium c8 (9 files): 42 passed (3.2m),
- serial chunk 0: 1 failed,16 skipped,50 passed (8.9m),
  - FAILED: 1) [serial] › e2e/serial/AC-IXD-PROC-W5-3-approvals-inbox.spec.ts:510:1 › AC-IXD-PROC-W5-3-role: an Engineer with nothing to decide at /approvals is denied (AccessDenied surface rendered) 
  - Re-run alone on the polluted DB: fails again (page showed "You're all caught up" inbox for the Engineer, not the access-denied surface = the user had gained standing).
    Re-run after `supabase db reset` (fresh seed): the whole file passes, 15 passed (1.3m), including this test. So it is shared-DB state left by earlier chunks, not the branch (Approvals page is not in the diff).
    The DB was reset here, so serial chunks 1-3 ran on a fresh seed.
- serial chunk 1 (40 files, 69 tests): killed by my 10-minute foreground limit at test 67/69, no failures logged before that; the last 3 files (TERM-006, TIER-014, TSP-011) re-run below as s1tail:
- serial s1tail (3 files): 1 skipped,12 passed (1.4m),
- serial s2a (20 files): 1 skipped,29 passed (6.1m),
- serial s2b (20 files): 33 passed (6.7m),
- serial s3a (15 files): 26 passed (4.8m),
- serial s3b (16 files): 26 passed (6.7m),

Browser totals (480 specs, retries off): every chunk above passed except two failures, both shown not to come from the branch (see their notes).
Work-order journeys in the list (e.g. AC-WORP-003, AC-WORP-004, AC-WOD-008, AC-WOS-019, AC-WPVA-016, AC-WBS-012, AC-WCO-012, AC-WOMS-012, AC-WOR-001, JOB-PC2, JOB-PC3) all passed.
The consent project was not in the affected list and was not run.

## Step 7 — static
- `npm run typecheck`: exit 0 (all four tsc projects clean).
- `npm run check:guards`: exit 0 (read-state OK 3 allowlisted/0 new; layout-baseline 352 keys, none grew; self-tests passed).

## Verdict
No failure traced to the branch.
1. `src/lib/agent/checkEdgeFnErrorReporting.test.ts` (unit, shard 4): fails only because the sandbox runs as root (chmod 000 does not block reads). Not in the diff. CI runs unprivileged.
2. `e2e/AC-S21-005-task-list-review.spec.ts` (chromium chunk 3): the spec's own Deno child process exits before ready; fails alone too; cause not isolated here; spec, support files and the function are not in the diff. Unproven either way for CI — if it is red in CI on this branch, compare against a `dev` run of the same spec.
3. `e2e/serial/AC-IXD-PROC-W5-3-approvals-inbox.spec.ts` "Engineer with nothing to decide" (serial chunk 0): shared-DB state left by earlier chunks; passes on a fresh seed with the whole file (15 passed).
Not run: pgTAP (no `supabase/` change), the consent project, and ci.yml's non-test jobs (build, lint of the whole repo, deno job, coverage thresholds, supply-chain audits).
