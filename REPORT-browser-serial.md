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

Runs: 1=dev @ 9f16436de

| spec | run1 |
|---|---|
| AC-1117-dashboard-pipeline.spec.ts | FAIL |
| AC-701-dashboard-smoke.spec.ts | FAIL |
| AC-CSP-016-project-performance-indices.spec.ts | pass |
| AC-DNC-012-done-not-claimed-age.spec.ts | pass |
| AC-IHC-011-idle-cost-switch.spec.ts | pass |
| AC-NATIVE-EQU-role-job.spec.ts | pass |
| AC-RSV-018-reservation-borrow.spec.ts | pass |
| AC-TAG-002-project-classification.spec.ts | pass |
| AC-TIER-014-amount-tier-approval.spec.ts | FAIL |
| JOB-E2-monthly-plan-becomes-rental-orders.spec.ts | FAIL |
| JOB-HPG-plan-resave-keeps-rate.spec.ts | pass |
| JOB-HPG-requester-reads-no-price-any-way.spec.ts | pass |
| JOB-M8-work-in-hand-capacity.spec.ts | pass |
| JOB-PU10-senior-limit-role.spec.ts | pass |
| JOB-PU15-morning-cutoff.spec.ts | pass |
| JOB-PU4-quoted-buy.spec.ts | FAIL |
| hide-prices-screens.spec.ts | pass |
| totals | 5 failed  25 passed (5.6m) |
