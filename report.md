# release-2606-verify

Branch `fix/release-2606-e2e` at `05c27844f16da40d5c6404cc5651bdd0bccbe22c`, local Supabase 2.122.1 stack (studio, realtime, vector excluded, as CI), Chromium via `/opt/pw-browsers`. No code changed.

## Step 3: the 9 release-run journeys (`E2E_WORKERS=1`, one run)
`26 passed (5.1m)` — 0 failed, 0 skipped, 0 flaky. (26 = 10 auth-setup tests + 16 journey tests across the 9 fragments.)

## Step 4: full suite as the `integration` jobs run it (CI=true, DB reset before each lane)
| Lane (CI command) | Summary line |
|---|---|
| chromium shard 1/3 (`--project=chromium --shard=1/3`, CI workers=4) | `14 skipped`, `142 passed (7.1m)`, 0 failed, 0 flaky |
| chromium shard 2/3 | `1 failed`, `2 did not run`, `153 passed (6.1m)`, 0 skipped |
| chromium shard 3/3 | `1 failed`, `2 skipped`, `153 passed (4.7m)` |
| consent (`--project=consent`) | `1 failed`, `6 passed (18.9s)` |
| serial (`--project=serial --workers=1`) | `63 skipped`, `48 passed (3.8m)`, 0 failed |

Retries are 0 in `playwright.config.ts`, so no test was reported "flaky" by Playwright; flakiness below is from re-running. All 9 step-3 journeys also passed inside the full run (none appears in a failure list).

Not run: the served-fn smoke (needs the `SUPABASE_SECRETS` CI secret), pgTAP and the nightly-intent race (not browser). Shards ran one after another on one DB, not three runners in parallel.

## Failures (3), each re-run on this branch and on origin/dev (`d71cca3c`)
1. `e2e/AC-S21-005-task-list-review.spec.ts:124` "S21 complete ordered task-link journey › Supporting proof: Admin reviews the ClickUp list, saves the source, and reads back the binding" (2 dependents did not run). Error: `S21_HANDLER_SERVER_EXITED_EARLY` (`support/AC-S21-005-runtime.mjs:18`).
   - Cause (from the Deno stderr, captured with a PATH shim): `Failed caching npm package '@supabase/auth-js@2.110.0' ... invalid peer certificate: UnknownIssuer`. This sandbox's proxy CA is not trusted by Deno, and the test strips env, so it cannot download packages. It is a sandbox gap, not the branch.
   - After `DENO_CERT=/root/.ccr/ca-bundle.crt deno cache ...` pre-warmed the cache: branch `13 passed`; origin/dev `13 passed`. Fails identically here only without the warm cache, so not dev-specific and not a branch regression.
2. `e2e/layout/project-detail.layout.spec.ts:700` "@layout AC-008 support: project totals fit at 1440px in id/light". Error: `expect(getByRole('heading', { name: 'Laba rugi proyek', level: 2 })).toBeVisible()` timed out at 5000ms, line 710.
   - Re-run alone on the branch: `18 passed`; on origin/dev: `18 passed`. Looks like load flake in a 4-worker shard (5s heading timeout); did not reproduce.
3. `e2e/AC-CON-003-analytics-opt-out.spec.ts:101` "AC-CON-003: after opting out, navigation makes ZERO PostHog requests and the choice survives a reload" (consent). Error line 115: `expected no PostHog traffic, got: https://ph-e2e.invalid/array/phc_e2econsentlanefakekey00000/config?...`.
   - Re-run on the branch: 1 fail then 2 passes (`3 passed` x2 for the 3-test file); on origin/dev: `3 passed` x3. Intermittent; failed on the first run after a fresh build both times. A single `config` request leaking before opt-out is applied looks like a race, not tied to this branch's diff, but I did not root-cause it. If it recurs in release CI, trace it before patching.

## Verdict
No deterministic failure on this commit. Step 3 is fully green. In the full run, 1 failure is a sandbox artifact (S21, passes once Deno's cache is warm), and 2 are intermittent (layout `:700`, AC-CON-003) and passed on re-run on both the branch and origin/dev. The 3 failures were not root-caused beyond this; AC-CON-003 is the one to watch.
