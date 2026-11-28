# Proof run: perf/1129-home-figures-totals (f3f755c45) merged with origin/dev

Merge of origin/dev into the branch: clean, no conflicts. Local Supabase (Docker), clean db reset. Supabase CLI 2.122.1.
DB files changed (supabase/): yes (migrations 2814, 2815, their rollbacks and two pgTAP files).

## Step 4: pgtap job, every step in ci.yml order

| # | Step | Result |
|---|------|--------|
| 1 | Migration prefix collision check | exit 0  |
| 2 | Financial statement script tests | exit 0 ok 19 - 0318 project-before-absence authorization mutation changes foreign project denial ok 20 - 0318 project-staff company-label view mutation is detected by the read envelope  |
| 3 | Reset DB | exit 0  |
| 4 | Project short-name migration round trip | exit 0  |
| 5 | Isolation denominator guard self-test | exit 0  |
| 6 | Isolation denominator guard | exit 0  |
| 7 | Schema registration scratch proof | exit 0 ok 1 - schema registrations reports three scratch gaps and clears all three after registration  |
| 8 | Isolation proof self-test | exit 0  |
| 9 | Anon-definer inventory include | exit 0  |
| 10 | pgTAP integration tests (ALL files) | exit 1 Files=1180, Tests=29318, 467 wallclock secs ( 7.84 usr  1.92 sys + 12.14 cusr  7.77 csys = 29.67 CPU) Result: FAIL  |
| 11 | Receiving rollback proof | exit 0 Files=1, Tests=7,  0 wallclock secs ( 0.02 usr +  0.00 sys =  0.02 CPU) Result: PASS  |
| 12 | Isolation proof (read and write) | exit 0  |
| 13 | Capture rollback harness | exit 0 Files=1, Tests=46,  0 wallclock secs ( 0.03 usr  0.00 sys +  0.01 cusr  0.03 csys =  0.07 CPU) Result: PASS  |
| 14 | Assignment rollback harness | exit 0 Files=1, Tests=5,  0 wallclock secs ( 0.02 usr  0.01 sys +  0.01 cusr  0.00 csys =  0.04 CPU) Result: PASS  |
| 15 | 2277 order-family rollback proof | exit 0 Files=1, Tests=7,  0 wallclock secs ( 0.02 usr  0.01 sys +  0.01 cusr  0.00 csys =  0.04 CPU) Result: PASS  |
| 16 | Undo kind-order rollback harness | exit 0 Files=1, Tests=4,  0 wallclock secs ( 0.02 usr +  0.00 sys =  0.02 CPU) Result: PASS  |
| 17 | Contract quantities rollback harness | exit 0 Files=1, Tests=5,  0 wallclock secs ( 0.02 usr  0.00 sys +  0.02 cusr  0.02 csys =  0.06 CPU) Result: PASS  |
| 18 | Plans feature-enforcement rollback harness | exit 0 Files=1, Tests=7,  0 wallclock secs ( 0.02 usr  0.00 sys +  0.05 cusr  0.02 csys =  0.09 CPU) Result: PASS  |
| 19 | Plans limit rollback harness | exit 0 Files=1, Tests=9,  0 wallclock secs ( 0.01 usr  0.01 sys +  0.01 cusr  0.00 csys =  0.03 CPU) Result: PASS  |
| 20 | Watermarks per-org rollback harness | exit 0 Files=1, Tests=16,  0 wallclock secs ( 0.02 usr  0.00 sys +  0.01 cusr  0.00 csys =  0.03 CPU) Result: PASS  |
| 21 | Stock posting rollback harness | exit 0 Files=1, Tests=8,  0 wallclock secs ( 0.02 usr  0.00 sys +  0.00 cusr  0.01 csys =  0.03 CPU) Result: PASS  |
| 22 | Stock posting two-session race | exit 0  |
| 23 | Stock connect rollback harness | exit 0  |
| 24 | Stock connect two-session race | exit 0 ok 1 - scripts/stock-connect-race.test.mjs  |
| 25 | AI credit allocation two-session race | exit 0 ok 3 - AC-ALLOC-013 a direct write, then a re-split on one allocation row both commit, in lock order ok 4 - AC-ALLOC-013 a re-split, then a direct write on one allocation row both commit, in lock orde |
| 26 | Fiscal year ensure script tests | exit 0 ok 1 - scripts/fiscal-year-ensure-mutation.test.mjs ok 2 - scripts/fiscal-year-ensure-race.test.mjs  |

Step 4 note: first attempt failed only because my harness called it without scripts/with-db-lock.sh ("Run under scripts/with-db-lock.sh"); re-run under the lock passed. Not a branch defect.

### REAL FAILURE: step 10, supabase test db (all files)
Counts: Files=1180, Tests=29318, Result: FAIL. 1 file failed, 1 test of 24.

- File: supabase/tests/erp_purchase_documents.test.sql, test 24
- Test: "AC-EPR-006 (re-baselined by AC-PFE-005) ERP purchases never feed actuals; only named link/commitment readers and refresh triggers touch the table"
- Error (full): `# Failed test 24: ... ; # Looks like you failed 1 test of 24; Failed 1/24 subtests`
- What it checks: no public function whose body mentions erp_purchase_documents may exist outside a named allow-list.
- Root cause (confirmed in the database): the function public.get_supplier_payables_totals, added by migration 2814_supplier_payables_totals.sql line 53, reads public.erp_purchase_documents_linked (the CTE named erp). Its source matches the ilike '%erp_purchase_documents%' and it is not in the allow-list. The other new function (get_paid_receipt_months) does not match. The allow-list sits in supabase/tests/erp_purchase_documents.test.sql around lines 129-175; the branch did not touch that file, and origin/dev has no mention of the new function.
- Most likely responsible changed file: supabase/migrations/2814_supplier_payables_totals.sql (or the allow-list in the test, which needs an entry naming get_supplier_payables_totals with the "ages a supplier balance, never feeds actuals" reason).
- Page showed: not a browser test.

## Step 5: unit, whole suite as CI's full mode (8 shards, --coverage), run sequentially

| Shard | Test Files | Tests |
|-------|-----------|-------|
| 1/8 | 349 passed (349) | 3376 passed (3376) |
| 2/8 | 354 passed (354) | 3597 passed (3597) |
| 3/8 | 354 passed (354) | 3312 passed (3312) |
| 4/8 | 1 failed, 353 passed, 1 skipped (355) | 1 failed, 4024 passed, 2 skipped (4027) |
| 5/8 | 356 passed (356) | 3890 passed (3890) |
| 6/8 | 356 passed (356) | 3867 passed (3867) |
| 7/8 | 355 passed (355) | 3471 passed (3471) |
| 8/8 | 355 passed (355) | 3580 passed (3580) |

Totals: 2,833 of 2,834 files pass (1 failed + 1 skipped counted in shard 4); 1 test failed.

### Failure in shard 4 (environmental, not this branch)
- Test: src/lib/agent/checkEdgeFnErrorReporting.test.ts > "exits 1 and names the specific file when a function's index.ts cannot be read (unreadable-file case)..."
- Re-run alone: fails the same way (deterministic here, not load-sensitive).
- Error: `AssertionError: expected '✗ supabase/functions/erpnext-sweep/in…' to match /could not read this file/`
- Root cause: the test does chmodSync(file, 0o000) and expects the CLI to fail reading it. This sandbox runs as uid 0 (root), which can read a mode-000 file, so the CLI reads it normally and reports a different (wrapping) error. CI runs as a non-root user. The branch does not touch this file or src/lib/agent.
- Verdict: sandbox artifact; expected green on CI.

## Step 6: browser (affected-e2e vs origin/dev: 480 of 545 specs; 329 chromium lane, 151 serial lane), npm-equivalent project lanes via scripts/e2e-local.sh, retries 0, chunks of 40 files, chromium 3 workers, serial 1 worker

Note: a 40-file chunk runs longer than a foreground call can, so the runner ran in the background and was polled within the same turn.

Earlier probe (8 chromium specs at 4 workers): 4 failed (AC-002, AC-009, AC-1834, AC-1982); all four passed when re-run alone at 1 worker (15 passed, 1.9m). Load-sensitive, so the full run uses 3 workers.

| Chunk | Files | Result line | Failures | Re-run alone |
|---|---|---|---|---|
| chunk-chromium-00 | 40 | 1 failed 59 passed (7.0m) | 1 | AC-ADMIA-001-administration-navigation.spec.ts rc=0 17 passed (1.4m) |
| chunk-chromium-01 | 40 | 4 failed 4 skipped 55 passed (7.0m) | 4 | AC-ECX-030-direct-cost-account.spec.ts rc=0 12 passed (54.1s); AC-EPR-008-erp-purchases.spec.ts rc=0 11 passed (48.1s); AC-HRE-004-hourly-rental.spec.ts rc=0 11 passed (57.1s) |
| chunk-chromium-02 | 40 | 2 failed 6 skipped 61 passed (7.9m) | 2 | AC-NBR-020-invoice-deep-link.spec.ts rc=0 11 passed (52.3s); AC-PCH-001-purchase-payment-channel.spec.ts rc=0 11 passed (58.6s) |
| chunk-chromium-03 | 40 | 7 failed 70 passed (8.7m) | 7 | AC-RET-004-billing-reconciliation-retention.spec.ts rc=0 11 passed (1.3m); AC-S21-005-task-list-review.spec.ts rc=1 1 failed 10 passed (43.2s); AC-SCH-013-pcm-scheduled-reports.spec.ts rc=0 11 passed (52.5s); AC-SITE-012-construction-completion.spec.ts rc=0 11 passed (58.4s); AC-SITE-BQ10-quality-evidence.spec.ts rc=0 11 passed (1.0m); AC-SSW-001-yard-to-work-order.spec.ts rc=0 11 passed (1.2m); AC-TPI-015-inspection-journey.spec.ts rc=0 11 passed (51.1s) |
| chunk-chromium-04 | 40 | 4 failed 53 passed (7.6m) | 4 | AC-VSR-015-set-supply-risk.spec.ts rc=0 11 passed (57.0s); AC-WBS-012-wo-billing-steps.spec.ts rc=0 11 passed (1.1m); AC-WOS-019-sections-rollup.spec.ts rc=0 12 passed (1.3m) |
| chunk-chromium-05 | 40 | 58 passed (7.7m) | 0 | - |
| chunk-chromium-06 | 40 | 1 failed 56 passed (8.4m) | 1 | JOB-SR-target-entry.spec.ts rc=0 12 passed (1.3m) |
| chunk-chromium-07 | 40 | 34 failed 146 passed (17.6m) | 34 | JOB-T3-billing-step-in-needs.spec.ts rc=0 11 passed (1.1m); JOB-T9-task-groups-milestone.spec.ts rc=0 11 passed (1.1m); administration.layout.spec.ts rc=0 15 passed (1.8m); meeting-detail.layout.spec.ts rc=0 17 passed (1.8m); project-detail.layout.spec.ts rc=0 72 passed (10.0m); figure-layout.ts rc=1  |
| chunk-chromium-08 | 9 | 1 failed 41 passed (3.6m) | 1 | notice-never-blocks-the-control.spec.ts rc=0 16 passed (1.8m) |
| chunk-serial-00 | 40 | 3 failed 16 skipped 48 passed (10.3m) | 3 | AC-IXD-PROC-W5-3-approvals-inbox.spec.ts rc=1 1 failed 14 passed (1.5m); AC-AUTH-005.spec.ts rc=0 (Mailpit started) 11 passed (56.8s); AC-AUTHF-005-password-reset.spec.ts rc=0 (Mailpit started) 11 passed (1.0m) |
| chunk-serial-01 | 40 | 8 skipped 61 passed (12.9m) | 0 | - |
| chunk-serial-02 | 40 | 1 failed 1 skipped 51 passed (13.4m) | 1 | JOB-BQ9-buyer-inspection-handoff.spec.ts rc=0 11 passed (1.2m) |
Note: an entry for e2e/support/figure-layout.ts in a chunk (chunk-chromium-07) is a parser artifact (a helper file in a stack trace, not a spec); the layout specs that use it all passed alone. The 28 project-detail.layout failures in that chunk came from one spec file that took 10.0m alone (72 passed), so they are load/timeout-sensitive.

### Real browser failures (still failing when re-run alone)

- e2e/AC-S21-005-task-list-review.spec.ts (chunk-chromium-03)
```
Error: S21_HANDLER_SERVER_EXITED_EARLY

       at support/AC-S21-005-runtime.mjs:18

      16 |
      17 | function safeFailure(code) {
    > 18 |   return new Error(code);
         |          ^
      19 | }
      20 |
      21 | export async function findPort() {
        at safeFailure (/home/user/PMO/pmo-portal/e2e/support/AC-S21-005-runtime.mjs:18:10)
        at ChildProcess.<anonymous> (/home/user/PMO/pmo-portal/e2e/support/AC-S21-005-runtime.mjs:99:40)

    Error Context: ../../../../tmp/claude-0/-home-user-PMO/a160afea-aa91-52d7-83a5-3494273ab535/scratchpad/e2e/out-chunk-chromium-03-rerun/AC-S21-005-task-list-revie-de223--and-reads-back-the-binding-chromium/error-context.md
```
- e2e/serial/AC-IXD-PROC-W5-3-approvals-inbox.spec.ts (chunk-serial-00)
```
Error: expect(locator).toBeVisible() failed

    Locator: getByText(/you don.t have access to approvals/i)
    Expected: visible
    Timeout: 15000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" with timeout 15000ms
      - waiting for getByText(/you don.t have access to approvals/i)


      516 |     // Goal: the AccessDenied surface is shown (not just an empty inbox).
      517 |     // Approvals.tsx renders AccessDenied with a "Back" / navigation affordance.
    > 518 |     await expect(page.getByText(/you don.t have access to approvals/i)).toBeVisible({ timeout: 15_000 });
```
