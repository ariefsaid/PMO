# Prove startup single-read (branch perf/1129-startup-single-read @ aa6c13e78, merged with origin/dev, no conflicts)

Sandbox: Docker, local Supabase stack, supabase db reset. DB files changed (migration 2810, its rollback, pgTAP 2810).

## Step 4 — pgtap job (every step, CI order): ALL PASS
- Migration prefix collision check | exit=0 | 
- Financial statement script tests | exit=0 | # tests 20 # pass 20 # fail 0 
- Reset DB | exit=0 | 
- Project short-name migration round trip | exit=0 | 
- Isolation denominator guard self-test | exit=0 | 
- Isolation denominator guard | exit=0 | 
- Schema registration scratch proof | exit=0 | # tests 1 # pass 1 # fail 0 
- Isolation proof self-test | exit=0 | 
- Anon-definer inventory | exit=0 | 
- pgTAP supabase test db (all) | exit=0 | Files=1179, Tests=29324, 450 wallclock secs ( 6.97 usr  1.84 sys + 11.41 cusr  7.04 csys = 27.26 CPU) Result: PASS 
- Receiving rollback proof | exit=0 | Files=1, Tests=7,  0 wallclock secs ( 0.01 usr +  0.01 sys =  0.02 CPU) Result: PASS 
- Isolation proof read+write | exit=0 | 
- Capture rollback harness | exit=0 | Files=1, Tests=46,  1 wallclock secs ( 0.03 usr  0.00 sys +  0.02 cusr  0.02 csys =  0.07 CPU) Result: PASS 
- Assignment rollback harness | exit=0 | Files=1, Tests=5,  0 wallclock secs ( 0.01 usr  0.01 sys +  0.01 cusr  0.00 csys =  0.03 CPU) Result: PASS 
- 2277 order-family rollback proof | exit=0 | Files=1, Tests=7,  0 wallclock secs ( 0.02 usr  0.00 sys +  0.01 cusr  0.00 csys =  0.03 CPU) Result: PASS 
- Undo kind-order rollback harness | exit=0 | Files=1, Tests=4,  0 wallclock secs ( 0.02 usr  0.00 sys +  0.01 cusr  0.00 csys =  0.03 CPU) Result: PASS 
- Contract quantities rollback harness | exit=0 | Files=1, Tests=5,  0 wallclock secs ( 0.01 usr  0.01 sys +  0.01 cusr  0.01 csys =  0.04 CPU) Result: PASS 
- Plans feature-enforcement rollback harness | exit=0 | Files=1, Tests=7,  1 wallclock secs ( 0.01 usr  0.02 sys +  0.04 cusr  0.03 csys =  0.10 CPU) Result: PASS 
- Plans limit rollback harness | exit=0 | Files=1, Tests=9,  0 wallclock secs ( 0.02 usr +  0.01 sys =  0.03 CPU) Result: PASS 
- Watermarks per-org rollback harness | exit=0 | Files=1, Tests=16,  0 wallclock secs ( 0.01 usr  0.01 sys +  0.01 cusr  0.00 csys =  0.03 CPU) Result: PASS 
- Stock posting rollback harness | exit=0 | Files=1, Tests=8,  0 wallclock secs ( 0.02 usr  0.00 sys +  0.00 cusr  0.01 csys =  0.03 CPU) Result: PASS 
- Stock posting two-session race | exit=0 | 
- Stock connect rollback harness | exit=0 | 
- Stock connect two-session race | exit=0 | # tests 1 # pass 1 # fail 0 
- AI credit allocation race | exit=0 | # tests 4 # pass 4 # fail 0 
- Fiscal year ensure script tests | exit=0 | # tests 2 # pass 2 # fail 0 

## Step 5 — unit (CI command `vitest run --coverage --shard=i/6`, sequential)
Shards 1,2,3,6 as 6-way shards; shards 4 and 5 timed out at my 10-minute foreground limit, so they were run as 12-way shards 7-10 (same slices). Union = 2834 files, matching `vitest list`.
| shard | Test Files | Tests |
|---|---|---|
| 1/6 | 468 passed | 4748 passed |
| 2/6 | 472 passed | 4579 passed |
| 3/6 | 471 passed, 1 skipped (472) | 5194 passed, 2 skipped |
| 7/12 | 237 passed | 2543 passed |
| 8/12 | 237 passed | 2573 passed |
| 9/12 | 237 passed | 2598 passed |
| 10/12 | 1 failed, 236 passed (237) | 1 failed, 2305 passed (2306) |
| 6/6 | 474 passed | 4801 passed |

One failure: `src/lib/agent/checkEdgeFnErrorReporting.test.ts` > "exits 1 and names the specific file when a function's index.ts cannot be read (unreadable-file case)". Error: `expected '✗ supabase/functions/erpnext-sweep/in…' to match /could not read this file/`. The test does `chmod 000` on a file and expects a read error; this sandbox runs as uid 0, which ignores file modes, so the file was read normally. Not in the changed files; an artifact of running as root, expected to pass on CI (non-root). Not re-run as non-root.

## Step 7 — typecheck and guards
- `npm run typecheck`: exit 0, no errors.
- `npm run check:guards`: **RED** at `check:typed-dals` (exit 1):
  ```
  UNTYPED DB ACCESS: src/lib/db/shellBootstrap.ts:33
    return data as unknown as ShellBootstrap;
    call the generated type instead: drop the cast, or regenerate database.types.ts.
  check-typed-dals: 1 new cast(s), 0 stale exemption(s).
  ```
  Changed file responsible: `pmo-portal/src/lib/db/shellBootstrap.ts` (line 33; the `supabase.rpc('shell_bootstrap')` result is cast instead of typed from `database.types.ts`). The chain stops at the first red, so I ran every later guard in the chain on its own (check:migrations through check:layout-baseline, 24 guards): all exit 0. Guards before typed-dals (anon-definer-inventory, shadow-types) passed in the chain.

## Step 6 — browser (affected-e2e vs origin/dev, --allow-broad: 480 of 545 specs; 329 chromium lane, 151 serial lane; retries 0; chunks of 40; run per lane via scripts/e2e-local.sh --project=<lane>, the command affected-e2e.mjs --run itself uses)
| chunk | exit | secs | result |
|---|---|---|---|
| chromium.chunk.00 | 0 | 496 |  60 passed (8.2m), |
| chromium.chunk.01 | 1 | 487 |  2 failed, 4 skipped, 57 passed (8.1m), |
| chromium.chunk.02 | 1 | 548 |  2 failed, 6 skipped, 61 passed (9.1m), |
| chromium.chunk.03 | 1 | 590 |  1 failed, 2 did not run, 76 passed (9.8m), |
