# round2-prove-2 — verification report

Target: `origin/land/1215-r2` @ `7a15cc0d3` merged with `origin/dev` @ `8c55b4b8f`.
`git merge --no-ff origin/dev` reported **"Already up to date"** (dev is already an ancestor), so there were no conflicts and the tested tree is exactly `7a15cc0d3`.
Duplicate migration numbers: **none** (checked `supabase/migrations/*.sql`).
Stack: local Supabase 2.122.1 (`-x imgproxy,logflare,vector,studio,realtime`, Mailpit on). Playwright 1.61.0, Chromium from `/opt/pw-browsers`. No code changed, nothing committed to a work branch.

## Summary
| Step | Result |
|---|---|
| `supabase db reset` | PASS (all migrations incl. 1045-1122 apply, seed OK) |
| Full pgTAP | **PASS** — 868 files, 19,433 tests, fresh reset |
| `npm ci` / `typecheck` / `check:guards` | PASS / PASS (exit 0) / PASS (exit 0) |
| Vitest, full (8 shards) | 2,257 files; **1 fail, a sandbox artifact (running as root)**, everything else passes |
| Playwright chromium (477 tests, 12 slices, reset per slice) | 3 failures: 1 deterministic (JOB-BQ5), 2 order/load-dependent (AC-IMT-014 reproducible in-slice, JOB-W10 flaky) |
| Playwright consent (7) | PASS 7/7 |
| Playwright serial (116, workers=1, 8 slices) | PASS — 0 failures, 63 skipped (same skip classes as CI's allowlisted ones; `check-e2e-skips` not run) |
| served-fn smoke | NOT RUN (needs the `SUPABASE_SECRETS` CI secret) |

## Deviations from CI (stated plainly)
- **pg_prove image unpullable** (GHCR/ECR/Docker Hub blocked or rate-limited by the sandbox proxy), so `supabase test db` could not run. I ran the same suite with the distro `pg_prove` (3.36) against the local DB: `pg_prove --ext .pg --ext .sql -r supabase/tests`, after `create extension pgtap`, and after `node scripts/anon-definer-inventory.mjs` (needed for 0178's generated include; CI does the same step).
- pgTAP is **not re-runnable without `db reset`**: a second run on the same DB failed 3 files (`0133_audit_events` #20, `0351_member_status_audit`, `m365_document_link_audit` #16) because earlier tests commit rows (e.g. two `company.delete` audit rows with null actor). All 3 pass on a fresh reset, in the full run and isolated. Not a defect of the branch; same behaviour class on origin/dev (dev passes on a fresh reset).
- Origin/dev alone, fresh reset, full pgTAP: PASS (862 files / 19,335 tests).
- Vitest ran sharded (`--shard=i/8`, `CI=true`) because one `npm test` exceeds the 10-minute call limit on 4 cores.
- Playwright ran in 12 `--shard=i/12` slices of the chromium project, DB reset before each slice, instead of CI's 3 shards.
- Deno npm cache had to be primed once (`deno cache ...`) for AC-S21-005 (see below).

## Failures

### 1. Vitest: `src/lib/agent/checkEdgeFnErrorReporting.test.ts` — "exits 1 and names the specific file when a function's index.ts cannot be read (unreadable-file case)"
- Error: the CLI does not exit 1. The test `chmod 000`s a file; this sandbox runs as **uid 0**, which ignores file modes, so the file stays readable.
- Merged branch: none (test predates the branch). Not re-run on dev: it is environmental and root-only. Passes in CI (non-root runner). Isolated re-run as root: fails the same way.

### 2. Chromium: `AC-S21-005-task-list-review.spec.ts:124` "Admin reviews the ClickUp list, saves the source, and reads back the binding" (+2 "did not run")
- Error: `S21_HANDLER_SERVER_EXITED_EARLY` (`support/AC-S21-005-runtime.mjs:18`).
- Root cause: the spec spawns `deno run --no-remote` with a scrubbed env (PATH/HOME/TMPDIR only, no proxy vars); the `npm:jose` / `npm:@supabase/*` packages were not in the sandbox's Deno cache and the child cannot reach npm. Reproduced by hand: the child tries to download from registry.npmjs.org. After `deno cache` of the handler graph (proxy env allowed), the spec **passes 13/13 isolated**.
- Sandbox artifact; CI has direct npm access. Touches no merged branch.

### 3. Chromium: `JOB-BQ5-reconcile-item-through-stages.spec.ts:16` — **deterministic, fails isolated too**
- Error line 31: `expect(cells.nth(1)).toHaveText('10')` — received `"6"` (Playwright, 14 retries, value stable).
- Root cause (from the page snapshot and the component): `pages/project-detail/tabs/BillingReconciliation.tsx` renders the item as `<th scope="row">` (a `rowheader`) followed by `<td>`s, and `getByRole('cell')` does **not** include a rowheader. So `cells.nth(0)` is already Scope (10), `nth(1)` Progress (6), `nth(2)` Measured (12), `nth(3)` Billed. The spec's four index assertions (1..3, expecting 10/6/12) are all shifted by one. The app values (scope 10, progress 6, claimed 12) are correct; the assertion indices are wrong. Fix is in the test: index 0/1/2 (or select by `getByRole('rowheader')` + named columns), not in the app.
- Merged branch: the spec and `support/billingFixture.ts` were added on the land branch (commits `46f4ff40b` "contractor job journeys", then `3f9f87dc8`, `7a15cc0d3`); they do not exist on origin/dev, so "fails on dev alone" is not applicable. Component is on dev.

### 4. Chromium: `AC-IMT-014-rate-import-failed-rows.spec.ts:44` — order-dependent
- Error: `locator.click` timeout (180 s) waiting for `getByRole('button', { name: /^rate catalogue$/i })` at line 48. Failed in slice 2/12 **twice** (two full slice runs), passes **isolated** (with JOB-BQ5/W10 in a 3-file run).
- Root cause (page snapshot of the second failure): the spec opens `/projects/<first non-archived project by created_at>/billing`, and in-slice that project is "Northgate Mills 3.5 MW Rooftop PV", which shows only the Overview/Budget/Tasks/Documents tabs, so there is no Billing tab and no "Rate catalogue" button. The spec depends on whichever project sorts first in the org at that moment, which depends on what earlier specs created/archived in the same DB. Spec should create/pick a project that has the billing tab (like the JOB-BQ5 fixture does).
- Merged branch: spec is new on the land branch, not on dev; dev-alone N/A.

### 5. Chromium: `JOB-W10-return-leftover.spec.ts:11` — flaky
- Error: `getByRole('row').filter({ hasText: 'Return' }).first()` not visible within 15 s on `/stock/ledger?item=...`.
- Failed once in slice 7/12 under load; **passes isolated** and **passes on a full re-run of slice 7/12 (49/49)**. Not reproduced. Spec not on dev. Candidate cause: ledger row appearing after the 15 s budget on a loaded 4-core box (the return write is async); not proven — no trace captured of the failing run (the artifact dir was overwritten by later runs).

## Skips observed
Chromium lane skips are the QUARANTINE (incidents flag off), JWT-005 / INV-001 / LEG-024 served-function or env-gated cases. Serial lane 63 skipped. `scripts/check-e2e-skips.mjs` was not run against the JSON reports.

## What this proves
Schema/RLS (full pgTAP), types, guards, unit and 99% of the browser suite are green on the merged tree. The only product-facing finding is **JOB-BQ5's index shift (test bug)**; AC-IMT-014 needs a fixture that does not depend on global project order.
