# Browser serial lane report

Branch under test: tmp/1129-prove-all @ 4f6cceffd. Command: `npx playwright test --project=serial --reporter=list` (CI=true, so the production-build webServer, as CI). Local Supabase stack (lean start, db reset, seed), `.env.local` as CI's step writes it. No edge functions served (CI's serial step does not serve them).

## Counts (first full run, 12.6 min wall)
- passed: 167 (includes the auth setup tests)
- failed: 17
- skipped: 66
- flaky: 0 reported (no retry-recovered tests)
- listed total: 250

## Re-run of the 17 failures
Step A: all 17 spec files together in one run (5.3 min): 11 passed, 6 failed. Step B: each of those 6 files alone (the run also executes the auth setup tests): 3 passed alone, 3 failed alone.

Caveat: the database was not reset between the full run and the re-runs, and failed runs can leave fixture rows behind. Treat the data-count failures with that in mind.

### Failed alone: real on this stack (3)
1. `e2e/serial/AC-1117-dashboard-pipeline.spec.ts:23` - "AC-1117: dashboard shows dual-lens KPIs and Sales Pipeline renders weighted stages from real data". Step: the Company figures "Contract on hand" tile title check. Error:
```
Error: expect(locator).toHaveAttribute(expected) failed
Locator: getByRole('region', { name: 'Company figures' }).getByText('Contract on hand · excl. tax', { exact: true }).locator('../..').locator('div.tabular > span[aria-hidden="true"]')
Expected: "$33,050,000"
Received: "$33,051,000"
Timeout: 5000ms
13 × locator resolved to <span aria-hidden="true" title="$33,051,000">
```
Page: the dashboard rendered; the contract-on-hand figure is $1,000 higher than the test expects. The same difference fails AC-701 (below): the tile reads "8 with a signed contract" where 7 is expected. Likely one extra signed-contract project in the data, either a leftover from an earlier failed spec or a seed change; not determined.

2. `e2e/serial/hide-prices-screens.spec.ts:57` - "Admin hides purchase and stock prices from a requester while a procurement manager still sees them". Step: requester page, `getByLabel('Deskripsi item baru')` (Bahasa locale pass) expected visible at line 130. Error: `expect(locator).toBeVisible() failed ... element(s) not found` after 5000ms. Page: the new-line-item description field was not found under that label.

3. `e2e/serial/JOB-HPG-plan-resave-keeps-rate.spec.ts:56` - "JOB-HPG the Engineer moves a date on their saved plan while prices are hidden, and the stored rate stays". Step: line 64, `getByTestId('plan-line').getByLabel('Rate')`. Error:
```
Error: expect(locator).toHaveValue(expected) failed
Expected: ""
Received: "1500"
Timeout: 5000ms
14 × locator resolved to <input type="text" value="1500" ... inputmode="decimal">
```
Page: with prices hidden, the Engineer's plan-line edit form still showed the Rate input holding 1500; the test expects it blank/hidden.

### Passed alone: load- or order-sensitive (14)
Passed in step A or B. Alone timings (whole file incl. setup) where measured:
- AC-701-dashboard-smoke: 19.7s alone (full-run failure: contract-on-hand tile showed "8 with a signed contract", expected 7; passed alone, so depends on leftover data from earlier specs in the lane)
- AC-CSP-016-project-performance-indices: 24.6s alone (full-run failure: fixture insert `project_number_client_segment_required`)
- JOB-E2-monthly-plan-becomes-rental-orders: 29.6s alone (full-run failure: `rental-panel` not found after 20s on /procurement/<id>)
- Passed in the grouped re-run only (not timed alone): AC-DNC-012 (fixture `project_number_client_segment_required`), AC-IHC-011 (`wo-page-pva-idle` count 1, expected 0), AC-NATIVE-EQU-role-job ($150 not found in equipment cost group), AC-RSV-018 (Approve button never appeared; 180s test timeout), AC-TAG-002 (120s test timeout, page closed), AC-TIER-014 (`scrollIntoViewIfNeeded`: element detached), JOB-HPG-requester-reads-no-price-any-way (unit-price field count 1, expected 0), JOB-M8-work-in-hand-capacity ($40,610,000 shown, expected 41,610,000: the same $1,000 offset), JOB-PU10 (`login cleanup: {}` in removeLogin), JOB-PU15 (`closed at 00:00` text not found), JOB-PU4 (status stayed "Quote Selected", expected "Ordered").

Note: JOB-HPG-requester-reads-no-price-any-way and hide-prices pass or fail on the same hidden-price theme as failure 3; and the three dashboard numbers (AC-1117, AC-701, JOB-M8) all differ by exactly $1,000 / one project, which points at shared leftover or seed state rather than three separate bugs.

Full log (not committed): serial run 12.6 min; traces were in /tmp/pmo-portal-test-results on the runner.

## Attribution runs (fresh db reset + fresh build each; only the 17 spec files; serial project)

Runs: 1=dev @ 9f16436de; 2=dev+startup-single-read @ e9270800e; 3=dev+home-figures-totals @ 02fec4ee2; 4=dev+work-order-page-deferred-reads @ 8671a0f36

| spec | run1 | run2 | run3 | run4 |
|---|---|---|---|---|
| AC-1117-dashboard-pipeline.spec.ts | FAIL | FAIL | FAIL | FAIL |
| AC-701-dashboard-smoke.spec.ts | FAIL | FAIL | FAIL | FAIL |
| AC-CSP-016-project-performance-indices.spec.ts | pass | pass | pass | FAIL |
| AC-DNC-012-done-not-claimed-age.spec.ts | pass | pass | pass | pass |
| AC-IHC-011-idle-cost-switch.spec.ts | pass | pass | pass | pass |
| AC-NATIVE-EQU-role-job.spec.ts | pass | FAIL | pass | pass |
| AC-RSV-018-reservation-borrow.spec.ts | pass | pass | pass | pass |
| AC-TAG-002-project-classification.spec.ts | pass | pass | pass | pass |
| AC-TIER-014-amount-tier-approval.spec.ts | FAIL | FAIL | pass | pass |
| JOB-E2-monthly-plan-becomes-rental-orders.spec.ts | FAIL | pass | FAIL | FAIL |
| JOB-HPG-plan-resave-keeps-rate.spec.ts | pass | pass | pass | pass |
| JOB-HPG-requester-reads-no-price-any-way.spec.ts | pass | FAIL | pass | pass |
| JOB-M8-work-in-hand-capacity.spec.ts | pass | pass | pass | pass |
| JOB-PU10-senior-limit-role.spec.ts | pass | pass | pass | pass |
| JOB-PU15-morning-cutoff.spec.ts | pass | pass | pass | pass |
| JOB-PU4-quoted-buy.spec.ts | FAIL | pass | FAIL | FAIL |
| hide-prices-screens.spec.ts | pass | FAIL | pass | pass |
| totals | 5 failed  25 passed (5.6m) | 6 failed  24 passed (4.2m) | 4 failed  26 passed (3.3m) | 5 failed  25 passed (5.7m) |


## Trace analysis: passed on run 1 (dev), failed on a branch run
Runs 1-4 used Playwright's default worker count, not CI's `--workers=1`; the list output shows spec files interleaving, so shared org-level state (the Equipment account mapping, the hide-prices setting) may race. See the `--workers=1` section below, if present, for the CI-style runs.

Branch runs where nothing passing on dev failed: **run 3 (home-figures-totals)**. The two dashboard specs (AC-1117, AC-701) fail on dev and on all three branches with identical values (run 1 and run 3: "$7.06M" received where "$3.46M" is expected; "9 with a signed contract" where 7 is expected), so they are not caused by any branch. JOB-E2, JOB-PU4 fail on dev too; AC-TIER-014 failed on dev and run 2 only.

### Run 2 (startup-single-read): hide-prices-screens (pass on dev, FAIL here)
- Failing step: line 130, `getByLabel('Deskripsi item baru')` (Bahasa pass) not found after 5s, signed in as the Site Supervisor requester.
- Page showed: the requester's app shell (sidebar, navigation) with the request page; the new-item description field was absent.
- Calls in the trace (18 `rpc/shell_bootstrap` POSTs over the run, 200 each). Every answer for the requester (profile role Engineer, built-in role site_supervisor), including the last one at the failing moment (08:56:59.862Z): `hide_prices_enabled = true`, `may_see_prices = false`. The page also fetched `/catalogues/<hash>/en/priceVisibility.json` (answer `{"withheld":"Prices are hidden from requesters."}`) after each bootstrap. No separate `get_may_see_prices` / `get_hide_prices_enabled` call appears; the bootstrap answer replaces them. Other reads at the failing moment, all 200: `actor_may_order_purchases` = false, `actor_may_read_purchase_cases` = false, `get_procurement_gates` = all four gates false, `equipment_plan_purchase_submit_context` = {may_submit:false,is_submitter:false}, `get_purchase_line_planning` = true, `get_order_receiving_enabled` = false.
- Note: the bootstrap is called repeatedly (about every 1-2 s in the trace, 18 times in the run) while the page waits.

### Run 2: JOB-HPG-requester-reads-no-price-any-way, test "adds, edits and removes a line on their own draft" (pass on dev, FAIL here)
- Failing step: `getByTestId('line-items-section').getByLabel(/new item unit price/i)` expected count 0, found 1 (a unit-price field showed while prices are meant to be hidden).
- Page showed: the requester's own draft request with the add-line row including a unit-price input.
- `shell_bootstrap` calls for this signed-in user (Engineer / site_supervisor), 2 in the trace, both 200:
  - 08:57:06.522Z: keys include `hide_prices_enabled = true` and `may_see_prices = false`.
  - 08:57:07.477Z (about 1 s later, same session): `hide_prices_enabled = false` and **no `may_see_prices` key at all**.
  The function (2810_shell_bootstrap.sql) adds `may_see_prices` only when hiding is on; the client (`shellBootstrap.ts`) writes `hide_prices_enabled` into the query cache on every call but writes `may_see_prices` only when the key is present. So the second answer flips the cached hide flag to false while the earlier cached may-see answer stays; the add-line row then shows the price field.
- Other calls in the last 3 s: `my_decision_standing` = false; `actor_may_order_purchases` = false; `actor_may_read_purchase_cases` = false; `get_procurement_gates` all false; `org_reads_erp_ledger` = false; `get_purchase_line_planning` = true; `get_order_receiving_enabled` = false. No `get_hide_prices_enabled` call is visible after the second bootstrap.
- Why the second bootstrap answered `hide_prices_enabled = false` is not established from the trace: nothing in the trace shows the Admin setting being switched at that moment. Compare: the JOB-HPG-plan-resave test (same hide-prices theme) passed on all four runs.

### Run 2: AC-NATIVE-EQU-role-job (pass on dev, FAIL here)
- Failing step: test timeout (180 s) at line 55: after signing in as the project manager and opening the Approvals tab on `/equipment?week=2026-11-21`, `getByRole('button', { name: 'Approve week' })` never appeared (the tab panel and the "Hours log" heading rendered). No approve call was made. Only the periodic notification count and timesheets reads continued every 60 s.
- Equipment/shell reads: not a hide-prices or totals read; the earlier steps (add row, submit week) succeeded.

### Run 4 (work-order-page-deferred-reads): AC-CSP-016-project-performance-indices (pass on dev, FAIL here)
- Failing step: the test's own steps passed or its first error was swallowed; what the run reports is the cleanup error `AC-CSP-016 cleanup failed: restore bindings: map an account to the Equipment category first` (spec line 142). The first underlying failure, if any, is not in the log (the test's `failure` variable would have produced an AggregateError; it did not, so the body itself finished and only the cleanup step failed).
- Page showed: the signed-in shell (sidebar with "11 pending" approvals), no error banner.
- Totals/performance reads: none relevant to the error; the failure is in the cleanup write to the Equipment-category account mapping, which AC-NATIVE-EQU also edits (run 4 interleaved the two specs in time).

## CI-style runs: same four runs with --workers=1 (as CI runs the serial project); fresh db reset + build each

Runs: 1=dev @ 9f16436de; 2=dev+startup-single-read @ 7dcf6e41e; 3=dev+home-figures-totals @ 17b6104bc; 4=dev+work-order-page-deferred-reads @ c979e6c2b

| spec | run1 | run2 | run3 | run4 |
|---|---|---|---|---|
| AC-1117-dashboard-pipeline.spec.ts | pass | pass | pass | pass |
| AC-701-dashboard-smoke.spec.ts | pass | pass | pass | pass |
| AC-CSP-016-project-performance-indices.spec.ts | pass | pass | pass | pass |
| AC-DNC-012-done-not-claimed-age.spec.ts | pass | pass | pass | pass |
| AC-IHC-011-idle-cost-switch.spec.ts | pass | pass | pass | pass |
| AC-NATIVE-EQU-role-job.spec.ts | pass | pass | pass | pass |
| AC-RSV-018-reservation-borrow.spec.ts | pass | pass | pass | pass |
| AC-TAG-002-project-classification.spec.ts | pass | pass | pass | pass |
| AC-TIER-014-amount-tier-approval.spec.ts | pass | pass | pass | pass |
| JOB-E2-monthly-plan-becomes-rental-orders.spec.ts | pass | pass | pass | pass |
| JOB-HPG-plan-resave-keeps-rate.spec.ts | pass | pass | pass | pass |
| JOB-HPG-requester-reads-no-price-any-way.spec.ts | pass | pass | pass | pass |
| JOB-M8-work-in-hand-capacity.spec.ts | pass | pass | pass | pass |
| JOB-PU10-senior-limit-role.spec.ts | pass | pass | pass | pass |
| JOB-PU15-morning-cutoff.spec.ts | pass | pass | pass | pass |
| JOB-PU4-quoted-buy.spec.ts | pass | pass | pass | pass |
| hide-prices-screens.spec.ts | pass | FAIL | pass | pass |
| totals | 30 passed (4.2m) | 1 failed  29 passed (3.7m) | 30 passed (4.4m) | 30 passed (4.3m) |
