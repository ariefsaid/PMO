# Stock count difference booked to a work order

IDs: `FR-SCW-###`, `AC-SCW-###`. Money-adjacent: affects work-order and project cost when stock-issue costing (OD-R1124-9) is enabled.

**Job story.** When closing a work order, I want to name that work order on a stock count taken at its project location, so that any counted difference appears on the work order's material completion report and, when issued stock counts as work-order cost, in the work order's cost.

## As is
`stock_documents` carries `work_order_id`, `get_work_order_material_completion` (2101) already computes `counted_difference` for count documents that carry `work_order_id`, and `StockDocumentDetail` already links `d.work_order_id`. However, `check_cost_attribution` (1580) has no branch for `kind = 'count'`, `create_stock_document` (2228) and `save_stock_draft` (0534/1461) ignore `work_order_id`, `StockCount.tsx` offers no work-order picker, and `stock_issue_cost_lines` (2240) selects only `issue` and `return`.

## Requirements (EARS)
- FR-SCW-001 When creating or saving a draft stock count (`kind = 'count'`), the system shall accept an optional `work_order_id`. A count with no work order shall behave identically to today.
- FR-SCW-002 While a stock count names a work order, the database shall require the count's warehouse to be a `site`, `yard`, or `staging` location of that work order's project, and the work order to belong to the same organisation and not be `Cancelled` (`check_cost_attribution`). Moving or retyping a warehouse that has a work-order-attributed count shall be refused (`guard_warehouse_move_with_work_orders`).
- FR-SCW-003 Count separation of duties (`stock_assert_writeoff_approver`: counter is not approver; Material Coordinator or rank >= 20 posts a non-zero difference) shall remain unchanged.
- FR-SCW-004 Once a work-order-attributed count is posted, `get_work_order_material_completion` shall report its signed `counted_difference` and updated `balance` on that work order only.
- FR-SCW-005 While stock-issue costing (`stock_issue_cost_settings.effective_on`) is enabled on the PMO-paid basis, `stock_issue_cost_lines` shall include posted `count` documents with `work_order_id IS NOT NULL` and `occurred_on >= effective_on` at `-sum(stock_ledger.value_delta)` (a shortage adds cost; a gain reduces cost), so every work-order and project cost reader reflects the variance at the stock ledger's valuation. While stock-issue costing is off, or when a count has no work order, cost totals shall remain unchanged.
- FR-SCW-006 On the Stock Count form (`StockCount.tsx`), when a project `site`, `yard`, or `staging` warehouse is selected, the user shall be able to optionally pick an active work order of that project (and clear or change it on a draft).

## Acceptance criteria (owning layer)
- AC-SCW-001 (pgTAP `2590`): Creating/saving a draft count naming a work order on its project's site/yard/staging warehouse succeeds; central warehouse (`COST_WO_NO_PROJECT`), other project/org (`COST_WO_PROJECT`), Cancelled work order (`COST_WO_CANCELLED`), and moving the warehouse away (`COST_WO_PROJECT_MOVE`) are refused.
- AC-SCW-002 (pgTAP `2590`): The count author cannot post a count with a difference (`STK_SELF_APPROVE`); a Material Coordinator (another user) posts it, and `get_work_order_material_completion` shows the counted difference and balance on that work order only.
- AC-SCW-003 (pgTAP `2590`): With stock-issue costing off, work-order and project costs are unchanged. With stock-issue costing on (effective_on <= occurred_on), a shortage adds `-value_delta` and a gain subtracts it in `work_order_cost_amounts` and `project_finance_actuals`, conserving purchase = cost + remaining stock; counts without a work order and counts before `effective_on` are excluded.
- AC-SCW-004 (unit `StockCount.test.tsx`): The work-order picker appears for project site/yard/staging warehouses, hides for central warehouses, clears on warehouse change, and passes `workOrderId` on create and draft save.
- AC-SCW-005 (E2E `stock-count-work-order.spec.ts`): Signed in as Storekeeper to draft a count for a work order with a variance and reason, then Material Coordinator to post it and view the work order's Material completion report showing the counted difference and balance.

- FR-SCW-007 When issued-stock costing includes a posted linked count, the work-order cost-record read shall include that count with its document number and work-order project, so the existing cost-money read prices it with the same signed amount as actuals.
- AC-SCW-006 Given a posted linked count and issued-stock costing enabled, when a cost reader opens cost records, then its labelled record is present and priced lines sum to the total; switching costing off removes both count record and amount.
- AC-SCW-007 Given a paid stock purchase, issue, shortage and gain, when Finance or Project Manager reads costs, then count records retain ledger-valued signs and receipt value equals remaining stock plus attributed cost plus unassigned loss.
- AC-SCW-008 Given linked posted and draft counts, when migrations 2591 and 2590 are rolled back, then links remain and cost reads return to issue/return behavior.
