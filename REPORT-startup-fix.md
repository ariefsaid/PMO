# Start-up fix report (branch cloud/1129-startup-fix)

Base: origin/perf/1129-startup-single-read (bee771db8) merged with origin/dev. Fresh `supabase db reset` before each lane, CI-style build (`CI=true`, vite build + preview), local Supabase in Docker, `.env.local` as CI writes it. Chromium lane at CI's default 4 workers; serial lane at `--workers=1` as CI and `npm run e2e` run it.

## Job 1: Indonesian tests (test setup)
Cause (as briefed, confirmed): the profile now arrives in the `rpc/shell_bootstrap` answer, so a rewrite of the REST `profiles` read never applied and the page stayed English.
Change: one helper, `pmo-portal/e2e/support/profile-override.ts` (`overrideProfile(page, patch | () => patch)`, `localePatch('en'|'id')`). It rewrites the profile in BOTH the REST `profiles` GET and the `profile` section of the `shell_bootstrap` POST answer. All 21 places that rewrote the profile now call it (`helpers.ts` `pinEnglishLocale`, `figure-layout.ts`, `financial-statement-fixtures.ts`, `m365-documents-mocks.ts`, `sales-pipeline-fixtures.ts`, 5 layout specs, 4 serial specs, and 8 specs under `e2e/`). No assertion changed. No app code changed for this job.
Small difference to note: sites that previously only patched when the URL had `id=eq.` now patch any `profiles` GET row that has a `locale`; it only changes the language of rows the page reads, nothing else.

## Job 2: the three serial failures
- **JOB-HPG-requester-reads-no-price-any-way** and **AC-NATIVE-EQU-role-job**: not an app fault. I reproduced JOB-HPG at default workers (the reports' command had no `--workers=1`). The three files ran in parallel workers (list output shows test 11 finishing after 12-14). `hide-prices-screens` starts with `set_hide_prices_enabled(false)` while JOB-HPG has just set it true, so the Site Supervisor's direct read of `procurements` returned `{id, total_value: 12000}` because the org setting was off at that instant (RLS `price_hidden_deny` correctly let it through). AC-NATIVE-EQU shows a project-control user the `$150` equipment cost; the same org-wide hiding setting masks it when another worker has hiding on. With `--workers=1` the three specs together: 14 passed, 0 failed (both before and after the final fixes); JOB-HPG alone also passes at default workers. The "second bootstrap says hide=false" in the trace is the other worker's toggle, not a cache bug.
- **hide-prices-screens**: Job 1 only (Bahasa label). Passes at `--workers=1` with the shared helper.
- Suspect (seeding hides a setting change): rejected as the cause of these failures, because they pass with one worker, but it exposed a real latent gap, see Job 3b.

## Job 3: repeated start-up call
Counts (probe spec, removed afterwards): normal load as Engineer: 1 call at sign-in, still 1 after 15 s idle, 2 after one more full page load. In `hide-prices-screens` (passing run, one worker): 41 `shell_bootstrap` calls against 87 main-frame navigation events; each call follows exactly one full document load (`page.goto` / `reload` / the login redirect), none fire while a page idles. Cause: the test itself loads a new document about once a second (3 widths x 2 languages x several routes, 3 browser pages); the "18 calls every 1-2 s" in the trace is that navigation rate. The call is made from `AuthProvider.loadProfile` only on an auth event or a manual refresh; there is no polling. No app change.

## Job 3b: stale `may_see_prices` in the cache (real gap, fixed)
`shell_bootstrap` leaves `may_see_prices` out while hiding is off; `seedShellQueries` wrote the hide flag every time but kept an older cached `may_see_prices`. If the cache held `true` (hiding on, person allowed), a later answer set hiding off, and hiding then came on again by the hook's own read, the hook trusted the cached `true` (fresh 5 min) and showed prices the database now withholds.
Test first (`src/lib/db/shellBootstrap.test.tsx`): AC-SHELL-BOOT-001 and -002 failed (cached `true` survived; the hook never asked the server and showed prices), AC-SHELL-BOOT-003 (an explicit false is seeded as false) passed. Fix in `src/lib/db/shellBootstrap.ts`: when the answer carries the hide flag but no `may_see_prices`, remove the cached answer, so the hook asks the server. After fix: 3/3 green; `src/auth` + `useHidePrices` tests 756 passed.

## Proof
| Check | Result |
|---|---|
| Chromium lane, 45 specs (every spec grepping `rest/v1/profiles`, every spec using the layout/fixture/locale helpers, all of `e2e/layout`, AC-ECX-030, AC-SHELL-001, AC-SHELL-003), 4 workers, retries 0 | 248 passed, 1 failed |
| The 1 failure: `project-detail.layout` AC-008 "totals fit at 1440px" (id/dark in the full run) | Load-sensitive, not profile: label `Periode` renders late under 4-way CPU load. A different variant of the same test (en/light, id/light, en/dark) fails in ~3 of 24 runs at 4 workers; 26 of 26 pass at `--workers=1`; the failure screenshot shows the label present just below the fold at 900 px |
| Serial lane, `--workers=1`: 14 serial specs that use the helpers + AC-NATIVE-EQU + JOB-HPG-requester (16 files, fresh reset) | 29 passed (incl. 10 auth setups), 0 failed, 0 skipped |
| Three serial specs from the brief, `--workers=1` | 14 passed (incl. setups), 0 failed |
| Unit: touched files + `src/auth` + `useHidePrices` | 756 passed (68 files) |
| `npm run typecheck` | clean |
| `npm run check:guards` | exit 0 |
| `eslint --max-warnings=0` on changed files | clean |
