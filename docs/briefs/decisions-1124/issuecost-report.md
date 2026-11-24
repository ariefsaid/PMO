# Issue-cost lane report

Branch: `feat/1124d-issue-cost` (ships alone). Migration range used: 2240 only; rollback included.

An Admin can set or clear the effective date through the authenticated `set_stock_issue_cost_date(date)` RPC. With no setting, existing organisations keep their current figures. On the PMO-paid basis, stock issued from the chosen date contributes its existing stock-ledger value to the work order; returns subtract their existing ledger value. The posted stock purchase is excluded from bill/payment cost once, while direct-delivery purchases keep their existing treatment.

The one whole-purchase classifier is `purchase_costs_as_stock(uuid)`: own-organisation Posted receive, linked by procurement ID, dated on or after the effective date. The common stock-value source is `stock_issue_cost_lines(uuid)`. No new costing rule or ERP write path was introduced.

Readers changed:
- `work_order_cost_amounts_unrounded`: feeds the existing canonical work-order money wrappers, plan versus actual, work-order and discipline profit, and `useWorkOrderDashboard` direct cost.
- `project_finance_actuals`: feeds project-finance totals and category totals.
- `project_pmo_spent_position`: the individual project spent figure.
- `project_pmo_positions`: the set-based dashboard and project-budget-position spent figures.

Existing UI consumers continue through their repositories. No frontend route or layout changed; no local browser journey or database reset was run. The configuration surface added in this lane is an Admin RPC, with an organisation-scoped settings table.

Spec: `docs/specs/stock-issue-direct-cost.spec.md`.
Owning proof: `supabase/tests/2240_stock_issue_cost.test.sql` (AC-ISC-001 through AC-ISC-005).
Regression proofs: `0997_work_order_plan_vs_actual.test.sql` and `0178_anon_executable_definers.test.sql`.

The ledger example has a 999 stocked purchase, issues of 300 and 200 to two work orders, and a return of 50. Work-order stock costs are 250 and 200, unissued stock is derived from the ledger as 549, and their sum is 999. With 1100 direct-delivery cost, both project readers and the work-order cost total are 1550. Mutation probes break the issue sign and the Admin restriction, verify the corresponding oracle changes, and restore the original function bodies. Initial red proof: the new setter was absent before implementation. A later harness-only failure came from savepoint rollback resetting pgTAP counters; explicit function-body restoration corrected it without changing the assertions.

Follow-ups, approved by the Director, are in `issuecost-open.md`: historical stock-cost migration; ERP reconciliation before ERP-ledger enablement; per-line distinction for mixed stocked/direct purchases. ERP-ledger enabling is refused, and historically costed pre-cutover purchase stock also refuses enabling. No dependency on another lane.

## Verification

Runtime-proven candidate: `8df7e199b` (the report-only commit carries no code/test changes).
- Spare-runner pgTAP: **PASS**, 3 files / 115 assertions: 2240 stock issue cost, 0997 work-order finance, 0178 definer ACL inventory. Runner command: `vps-pgtap.sh feat/1124d-issue-cost supabase/tests/2240_stock_issue_cost.test.sql supabase/tests/0997_work_order_plan_vs_actual.test.sql supabase/tests/0178_anon_executable_definers.test.sql`.
- `npm run check:guards`: PASS; restated-function guard also passed separately.
- `npm run typecheck`: PASS on Node 22.23.2.
- Targeted consumer Vitest: PASS, 3 files / 28 tests (`workOrderFinance`, `workOrderCostMoney`, `useWorkOrderDashboard`), Node 22.23.2. An initial Node 26 invocation was rejected by the existing engine guard, before any tests ran.
- `git diff --check origin/dev`: PASS. No changed JS/TS files requiring touched-file ESLint; no frontend layout changes requiring rendered captures. Local browser journeys and database resets were prohibited by the dispatch and were not run.
- The conservation test captures the raw balance in privileged fixture setup, then asserts it as the authenticated caller; ledger grants remain unchanged.

Execution ownership: lane branch / this worker is sole writer / guards, typecheck and targeted unit checks on the Mac; touched pgTAP on the spare runner / runtime proven above / coordinator owns review and CI acceptance. No PR, merge, dev push or production action was performed.

DONE: 1124d-issuecost
