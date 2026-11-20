# Map #2516 acceptance-gap audit (2026-11-20)

Audit of every AC id in the specs behind the map #2516 feature branches against the tests that
exist on the same branch (searched under `pmo-portal/` and `supabase/tests/`, docs excluded).
An id counts as found when a test file names it, including slash lists such as `AC-IMT-003/005/006`.

Method and limits:
- The AC list and the intended layer come from each spec's AC table or bullet list (the layer the
  spec itself states). A name match proves a test cites the id, not that it asserts every clause.
- For ACs that name two layers (for example "Unit + pgTAP") the table lists up to three files with
  their layer, so a missing second layer can be read off. Only ids with no file at all are MISSING.
- Branches are stacked: a later branch carries its ancestors' tests, so a gap on an earlier
  branch can be closed by a later one (2524 by 2524b, 2526 by 2526b).
- The ticket-to-spec mapping: 2517 cost attribution, 2518 record page, 2519 plan vs actual,
  2520 unit rate catalogue, 2521 site issue log, 2522 billing stages and retention, 2523 stock site
  work, 2524/2524b material requests, 2525 three-way match, 2526/2526b equipment availability,
  2527 document expiry, 2528 crews roster, 2529 org terminology, 2530 import templates,
  2531 task work order proof, 2542 expiring documents edit, 2542b people register (plus the
  expiring documents edit spec it carries).

## Per-ticket tables

### 2517-work-order-cost-spine (spec `docs/specs/work-order-cost-attribution.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-WCA-001 | (unstated) | pgTAP: `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WCA-002 | (unstated) | pgTAP: `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WCA-003 | (unstated) | pgTAP: `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WCA-004 | (unstated) | pgTAP: `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WCA-005 | (unstated) | pgTAP: `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WCA-006 | (unstated) | pgTAP: `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WCA-007 | (unstated) | pgTAP: `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WCA-008 | (unstated) | pgTAP: `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WCA-009 | (unstated) | pgTAP: `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WCA-010 | (unstated) | pgTAP: `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WCA-011 | (unstated) | pgTAP: `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WCA-012 | (unstated) | vitest: `pmo-portal/src/lib/db/workOrderCosts.test.ts`; pgTAP: `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WCA-013 | (unstated) | vitest: `pmo-portal/src/components/workOrders/costAttributionError.test.ts`; vitest: `pmo-portal/src/lib/db/workOrderCosts.test.ts` |
| AC-WCA-014 | (unstated) | vitest: `pmo-portal/src/components/workOrders/CostAttributionFields.test.tsx` |
| AC-WCA-015 | (unstated) | pgTAP: `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WCA-016 | (unstated) | vitest: `pmo-portal/src/lib/timesheet-edit.test.ts` |

Totals: 16 ACs, 16 covered, 0 missing: none

### 2518-work-order-page (spec `docs/specs/work-order-record-page.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-WORP-001 | Unit (RTL) | vitest: `pmo-portal/pages/WorkOrderDetail.test.tsx` |
| AC-WORP-002 | pgTAP (read returns no row) + Unit | vitest: `pmo-portal/pages/WorkOrderDetail.test.tsx`; pgTAP: `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WORP-003 | E2E (one journey) | e2e: `pmo-portal/e2e/AC-WORP-003-open-work-order-page.spec.ts` |
| AC-WORP-004 | Unit per host, one E2E | e2e: `pmo-portal/e2e/AC-WORP-004-invoice-work-order.spec.ts`; vitest: `pmo-portal/pages/project-detail/WorkOrderAcceptances.test.tsx`; vitest: `pmo-portal/pages/sales-invoices/SalesInvoiceDetail.headerFacts.test.tsx` |
| AC-WORP-005 | Unit (derivation) | vitest: `pmo-portal/pages/WorkOrderDetail.test.tsx`; vitest: `pmo-portal/src/lib/workOrderProgress.test.ts`; vitest: `pmo-portal/src/lib/workOrderProgress.ts` |
| AC-WORP-006 | Unit + Layer-1 money test | vitest: `pmo-portal/pages/WorkOrderDetail.test.tsx`; vitest: `pmo-portal/src/lib/workOrderCostView.test.ts`; vitest: `pmo-portal/src/lib/workOrderCostView.ts` |
| AC-WORP-007 | Unit | vitest: `pmo-portal/pages/WorkOrderDetail.test.tsx`; vitest: `pmo-portal/src/lib/workOrderCostView.test.ts`; vitest: `pmo-portal/src/lib/workOrderCostView.ts` |
| AC-WORP-008 | Unit | vitest: `pmo-portal/pages/WorkOrderDetail.test.tsx` |
| AC-WORP-009 | Unit | vitest: `pmo-portal/pages/WorkOrderDetail.test.tsx` |
| AC-WORP-010 | ux-proof gate | MISSING |
| AC-WORP-011 | Unit (locale parity guard) | vitest: `pmo-portal/pages/WorkOrderDetail.test.tsx` |

Totals: 11 ACs, 10 covered, 1 missing: AC-WORP-010

### 2519-plan-vs-actual (spec `docs/specs/work-order-plan-vs-actual.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-WPVA-001 | pgTAP | vitest: `pmo-portal/src/auth/policy.test.ts`; pgTAP: `supabase/tests/0997_work_order_plan_vs_actual.test.sql` |
| AC-WPVA-002 | pgTAP | pgTAP: `supabase/tests/0997_work_order_plan_vs_actual.test.sql` |
| AC-WPVA-003 | Layer-1 money test (vitest on the read + pgTAP fixture) | vitest: `pmo-portal/src/lib/workOrderPlanVsActual.test.ts`; pgTAP: `supabase/tests/0997_work_order_plan_vs_actual.test.sql` |
| AC-WPVA-004 | Unit (pure function) + pgTAP | vitest: `pmo-portal/src/lib/db/workOrderFinance.test.ts`; vitest: `pmo-portal/src/lib/workOrderPlanVsActual.test.ts`; pgTAP: `supabase/tests/0997_work_order_plan_vs_actual.test.sql` |
| AC-WPVA-005 | Unit | vitest: `pmo-portal/src/lib/workOrderPlanVsActual.test.ts` |
| AC-WPVA-006 | pgTAP | vitest: `pmo-portal/pages/project-detail/__tests__/WorkOrderPlanModals.test.tsx`; pgTAP: `supabase/tests/0997_work_order_plan_vs_actual.test.sql` |
| AC-WPVA-007 | Unit | vitest: `pmo-portal/pages/project-detail/__tests__/WorkOrderPlanVsActual.test.tsx`; vitest: `pmo-portal/src/lib/workOrderPlanVsActual.test.ts` |
| AC-WPVA-008 | Unit | vitest: `pmo-portal/src/lib/workOrderPlanVsActual.test.ts` |
| AC-WPVA-009 | Unit + pgTAP (read denied) | vitest: `pmo-portal/pages/project-detail/__tests__/WorkOrderPlanVsActual.test.tsx`; vitest: `pmo-portal/src/lib/db/workOrderFinance.test.ts`; vitest: `pmo-portal/src/lib/workOrderPlanVsActual.test.ts` |
| AC-WPVA-010 | Unit | vitest: `pmo-portal/pages/project-detail/__tests__/WorkOrderPlanVsActual.test.tsx`; vitest: `pmo-portal/src/lib/workOrderPlanVsActual.test.ts`; pgTAP: `supabase/tests/0997_work_order_plan_vs_actual.test.sql` |
| AC-WPVA-011 | Layer-1 money test | vitest: `pmo-portal/src/lib/workOrderPlanVsActual.test.ts` |
| AC-WPVA-012 | Layer-1 money test + pgTAP | vitest: `pmo-portal/src/lib/workOrderPlanVsActual.test.ts`; pgTAP: `supabase/tests/0997_work_order_plan_vs_actual.test.sql` |
| AC-WPVA-013 | Unit | vitest: `pmo-portal/pages/project-detail/__tests__/WorkOrderPlanVsActual.test.tsx`; vitest: `pmo-portal/src/lib/workOrderPlanVsActual.test.ts` |
| AC-WPVA-014 | Unit | vitest: `pmo-portal/pages/project-detail/__tests__/WorkOrderPlanVsActual.test.tsx`; vitest: `pmo-portal/src/lib/workOrderPlanVsActual.test.ts` |
| AC-WPVA-015 | pgTAP | vitest: `pmo-portal/pages/project-detail/__tests__/WorkOrderPlanVsActual.test.tsx`; vitest: `pmo-portal/src/auth/policy.test.ts`; pgTAP: `supabase/tests/0997_work_order_plan_vs_actual.test.sql` |
| AC-WPVA-016 | E2E (one journey) | MISSING |

Totals: 16 ACs, 15 covered, 1 missing: AC-WPVA-016

### 2520-unit-rate-catalogue (spec `docs/specs/unit-rate-catalogue.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-RC-1 | pgTAP | pgTAP: `supabase/tests/rate_catalogue.test.sql` |
| AC-RC-2 | pgTAP; unit for sheet validation | vitest: `pmo-portal/src/lib/import/__tests__/rateCatalogueDescriptor.test.ts`; pgTAP: `supabase/tests/rate_catalogue.test.sql` |
| AC-RC-3 | pgTAP | pgTAP: `supabase/tests/rate_catalogue.test.sql` |
| AC-RC-4 | pgTAP; unit for `rateAt` | vitest: `pmo-portal/src/lib/import/__tests__/rateCatalogueDescriptor.test.ts`; pgTAP: `supabase/tests/rate_catalogue.test.sql` |
| AC-RC-5 | pgTAP; unit | vitest: `pmo-portal/src/lib/import/__tests__/rateCatalogueDescriptor.test.ts`; pgTAP: `supabase/tests/rate_catalogue.test.sql` |
| AC-RC-6 | pgTAP | pgTAP: `supabase/tests/rate_catalogue.test.sql` |
| AC-RC-7 | unit on the import wizard and descriptor; the repository call is the s | vitest: `pmo-portal/src/components/import/__tests__/rateCatalogueWizard.test.tsx` |
| AC-RC-8 | unit | vitest: `pmo-portal/src/components/import/__tests__/ImportWizard.test.tsx` |

Totals: 8 ACs, 8 covered, 0 missing: none

### 2521-site-issue-log (spec `docs/specs/site-issue-log.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-SIL-001 | pgTAP | pgTAP: `supabase/tests/0979_site_issue_log.test.sql` |
| AC-SIL-002 | pgTAP | pgTAP: `supabase/tests/0979_site_issue_log.test.sql` |
| AC-SIL-003 | pgTAP | pgTAP: `supabase/tests/0979_site_issue_log.test.sql` |
| AC-SIL-004 | pgTAP (mutation-check) | vitest: `pmo-portal/pages/IncidentDetail.test.tsx`; pgTAP: `supabase/tests/0979_site_issue_log.test.sql` |
| AC-SIL-005 | pgTAP | pgTAP: `supabase/tests/0979_site_issue_log.test.sql` |
| AC-SIL-006 | pgTAP (calls the job function directly) | pgTAP: `supabase/tests/0979_site_issue_log.test.sql` |
| AC-SIL-007 | pgTAP | pgTAP: `supabase/tests/0979_site_issue_log.test.sql` |
| AC-SIL-008 | pgTAP | pgTAP: `supabase/tests/0979_site_issue_log.test.sql` |
| AC-SIL-009 | pgTAP + Unit | pgTAP: `supabase/tests/0979_site_issue_log.test.sql` |
| AC-SIL-010 | E2E (one journey) | vitest: `pmo-portal/components/IncidentFormModal.test.tsx`; e2e: `pmo-portal/e2e/AC-SIL-010-raise-issue-with-photo.spec.ts`; pgTAP: `supabase/tests/0979_site_issue_log.test.sql` |
| AC-SIL-011 | Unit | vitest: `pmo-portal/pages/IncidentDetail.test.tsx`; vitest: `pmo-portal/pages/Incidents.test.tsx`; vitest: `pmo-portal/src/lib/incidents/overdue.test.ts` |
| AC-SIL-012 | Unit | vitest: `pmo-portal/components/IncidentFormModal.test.tsx` |
| AC-SIL-013 | Unit (existing tests stay green) | vitest: `pmo-portal/pages/IncidentDetail.test.tsx`; vitest: `pmo-portal/src/lib/incidents/overdue.test.ts` |
| AC-SIL-014 | E2E (one journey, job invoked by a test hook) | e2e: `pmo-portal/e2e/AC-SIL-014-issue-lifecycle.spec.ts`; pgTAP: `supabase/tests/0979_site_issue_log.test.sql` |

Totals: 14 ACs, 14 covered, 0 missing: none

### 2522-billing-stages (spec `docs/specs/billing-stages.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-BST-001 | (unstated) | pgTAP: `supabase/tests/1021_billing_stages.test.sql` |
| AC-BST-002 | (unstated) | vitest: `pmo-portal/pages/project-detail/tabs/__tests__/BillingTermsModal.test.tsx`; vitest: `pmo-portal/src/auth/policy.billingStages.test.ts`; vitest: `pmo-portal/src/lib/db/billingStages.test.ts` |
| AC-BST-003 | (unstated) | vitest: `pmo-portal/pages/project-detail/tabs/__tests__/ClaimBillingStages.test.tsx`; vitest: `pmo-portal/src/auth/policy.billingStages.test.ts`; pgTAP: `supabase/tests/1021_billing_stages.test.sql` |
| AC-BST-004 | (unstated) | vitest: `pmo-portal/pages/project-detail/tabs/__tests__/ClaimBillingStages.test.tsx`; vitest: `pmo-portal/src/lib/db/billingStages.test.ts`; pgTAP: `supabase/tests/1021_billing_stages.test.sql` |
| AC-BST-005 | (unstated) | pgTAP: `supabase/tests/1021_billing_stages.test.sql`; pgTAP: `supabase/tests/1023_billing_reconciliation.test.sql` |
| AC-BST-006 | (unstated) | pgTAP: `supabase/tests/1021_billing_stages.test.sql` |
| AC-BST-010 | (unstated) | vitest: `pmo-portal/src/lib/billingStages.test.ts` |
| AC-BST-011 | (unstated) | vitest: `pmo-portal/src/lib/billingStages.test.ts` |
| AC-BST-020 | (unstated) | vitest: `pmo-portal/src/lib/db/billingStages.test.ts`; pgTAP: `supabase/tests/1023_billing_reconciliation.test.sql` |
| AC-RET-001 | (unstated) | pgTAP: `supabase/tests/0565_log_table_retention_purges.test.sql`; pgTAP: `supabase/tests/1022_retention.test.sql` |
| AC-RET-002 | (unstated) | vitest: `pmo-portal/src/lib/db/billingStages.test.ts`; pgTAP: `supabase/tests/1022_retention.test.sql` |
| AC-RET-003 | (unstated) | vitest: `pmo-portal/src/auth/policy.billingStages.test.ts`; pgTAP: `supabase/tests/1022_retention.test.sql` |
| AC-RET-004 | (unstated) | e2e: `pmo-portal/e2e/AC-RET-004-billing-reconciliation-retention.spec.ts` |
| AC-TRACE-001 | (unstated) | vitest: `pmo-portal/pages/project-detail/tabs/__tests__/ClaimBillingStages.test.tsx`; vitest: `pmo-portal/src/lib/db/billingStages.test.ts`; pgTAP: `supabase/tests/1023_billing_reconciliation.test.sql` |

Totals: 14 ACs, 14 covered, 0 missing: none

### 2523-stock-site-work (spec `docs/specs/stock-site-work.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-SSW-001 | pgTAP + E2E (one journey) | e2e: `pmo-portal/e2e/AC-SSW-001-yard-to-work-order.spec.ts`; pgTAP: `supabase/tests/stock_site_work.test.sql` |
| AC-SSW-002 | pgTAP (mutation-check: drop the rule → red) | pgTAP: `supabase/tests/stock_site_work.test.sql` |
| AC-SSW-003 | pgTAP | pgTAP: `supabase/tests/stock_site_work.test.sql` |
| AC-SSW-004 | pgTAP + Layer-1 money test | pgTAP: `supabase/tests/stock_site_work.test.sql` |
| AC-SSW-005 | pgTAP | pgTAP: `supabase/tests/stock_site_work.test.sql` |
| AC-SSW-006 | pgTAP | pgTAP: `supabase/tests/stock_site_work.test.sql` |
| AC-SSW-007 | pgTAP | pgTAP: `supabase/tests/stock_site_work.test.sql` |
| AC-SSW-008 | pgTAP | pgTAP: `supabase/tests/stock_site_work.test.sql` |
| AC-SSW-009 | pgTAP + Layer-1 money test | pgTAP: `supabase/tests/stock_site_work.test.sql` |
| AC-SSW-010 | Unit | vitest: `pmo-portal/pages/stock/WorkOrderStockBalance.test.tsx`; vitest: `pmo-portal/src/lib/db/stockSiteWork.test.ts`; pgTAP: `supabase/tests/stock_site_work.test.sql` |
| AC-SSW-011 | Unit | vitest: `pmo-portal/pages/stock/WorkOrderStockBalance.test.tsx`; vitest: `pmo-portal/src/lib/db/stockSiteWork.test.ts` |
| AC-SSW-012 | pgTAP | pgTAP: `supabase/tests/stock_site_work.test.sql` |
| AC-SSW-013 | pgTAP | pgTAP: `supabase/tests/stock_site_work.test.sql` |

Totals: 13 ACs, 13 covered, 0 missing: none

### 2524-material-requests (spec `docs/specs/material-requests.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-MRQ-001 | pgTAP + Unit | vitest: `pmo-portal/src/lib/db/materialRequests.test.ts`; vitest: `pmo-portal/src/lib/db/materialRequests.ts`; pgTAP: `supabase/tests/mrq_submit_transfer.test.sql` |
| AC-MRQ-002 | pgTAP | pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-003 | pgTAP | vitest: `pmo-portal/src/auth/policy.materialRequest.test.ts`; vitest: `pmo-portal/src/lib/db/materialRequests.test.ts`; pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-004 | pgTAP | pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-005 | pgTAP | vitest: `pmo-portal/src/auth/policy.materialRequest.test.ts`; pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-006 | pgTAP | pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-007 | pgTAP | pgTAP: `supabase/tests/mrq_submit_transfer.test.sql` |
| AC-MRQ-008 | pgTAP | pgTAP: `supabase/tests/mrq_submit_transfer.test.sql` |
| AC-MRQ-009 | pgTAP | pgTAP: `supabase/tests/mrq_submit_transfer.test.sql` |
| AC-MRQ-010 | pgTAP + Unit | pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-011 | pgTAP | pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-012 | pgTAP | pgTAP: `supabase/tests/mrq_submit_transfer.test.sql` |
| AC-MRQ-013 | Unit + pgTAP | vitest: `pmo-portal/src/lib/db/materialRequests.test.ts`; pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-014 | pgTAP | pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-015 | E2E (one journey) | MISSING |

Totals: 15 ACs, 14 covered, 1 missing: AC-MRQ-015

### 2524b-material-requests-ui (spec `docs/specs/material-requests.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-MRQ-001 | pgTAP + Unit | vitest: `pmo-portal/pages/MaterialRequestNew.test.tsx`; vitest: `pmo-portal/src/lib/db/materialRequests.test.ts`; vitest: `pmo-portal/src/lib/db/materialRequests.ts` |
| AC-MRQ-002 | pgTAP | pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-003 | pgTAP | vitest: `pmo-portal/pages/MaterialRequestDetail.test.tsx`; vitest: `pmo-portal/src/auth/policy.materialRequest.test.ts`; vitest: `pmo-portal/src/lib/db/materialRequests.test.ts` |
| AC-MRQ-004 | pgTAP | pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-005 | pgTAP | vitest: `pmo-portal/src/auth/policy.materialRequest.test.ts`; pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-006 | pgTAP | pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-007 | pgTAP | vitest: `pmo-portal/pages/MaterialRequestDetail.test.tsx`; pgTAP: `supabase/tests/mrq_submit_transfer.test.sql` |
| AC-MRQ-008 | pgTAP | pgTAP: `supabase/tests/mrq_submit_transfer.test.sql` |
| AC-MRQ-009 | pgTAP | pgTAP: `supabase/tests/mrq_submit_transfer.test.sql` |
| AC-MRQ-010 | pgTAP + Unit | pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-011 | pgTAP | pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-012 | pgTAP | pgTAP: `supabase/tests/mrq_submit_transfer.test.sql` |
| AC-MRQ-013 | Unit + pgTAP | vitest: `pmo-portal/pages/MaterialRequestDetail.test.tsx`; vitest: `pmo-portal/pages/MaterialRequests.test.tsx`; vitest: `pmo-portal/src/lib/db/materialRequests.test.ts` |
| AC-MRQ-014 | pgTAP | pgTAP: `supabase/tests/mrq_approval.test.sql` |
| AC-MRQ-015 | E2E (one journey) | e2e: `pmo-portal/e2e/AC-MRQ-015-request-to-transfer.spec.ts` |

Totals: 15 ACs, 15 covered, 0 missing: none

### 2525-three-way-match (spec `docs/specs/three-way-match.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-TWM-001 | (unstated) | pgTAP: `supabase/tests/three_way_match.test.sql` |
| AC-TWM-002 | (unstated) | pgTAP: `supabase/tests/three_way_match.test.sql`; pgTAP: `supabase/tests/three_way_match_mutation.test.sql` |
| AC-TWM-003 | (unstated) | pgTAP: `supabase/tests/three_way_match.test.sql` |
| AC-TWM-004 | (unstated) | pgTAP: `supabase/tests/three_way_match.test.sql` |
| AC-TWM-005 | (unstated) | pgTAP: `supabase/tests/three_way_match.test.sql` |
| AC-TWM-006 | (unstated) | pgTAP: `supabase/tests/three_way_match.test.sql` |
| AC-TWM-007 | (unstated) | pgTAP: `supabase/tests/three_way_match.test.sql` |
| AC-TWM-008 | (unstated) | pgTAP: `supabase/tests/three_way_match.test.sql` |
| AC-TWM-009 | (unstated) | pgTAP: `supabase/tests/three_way_match.test.sql`; pgTAP: `supabase/tests/three_way_match_mutation.test.sql` |
| AC-TWM-010 | (unstated) | pgTAP: `supabase/tests/three_way_match.test.sql` |
| AC-TWM-011 | (unstated) | pgTAP: `supabase/tests/three_way_match.test.sql` |
| AC-TWM-012 | (unstated) | pgTAP: `supabase/tests/three_way_match.test.sql` |
| AC-TWM-013 | owning test `supabase/tests/three_way_match_mutation.test.sql` | pgTAP: `supabase/tests/three_way_match_mutation.test.sql` |

Totals: 13 ACs, 13 covered, 0 missing: none

### 2526-equipment-availability (spec `docs/specs/equipment-availability.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-EAV-001 | Unit (pure function) + pgTAP (read model) | vitest: `pmo-portal/src/lib/__tests__/equipmentMetrics.test.ts`; pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-002 | Unit | vitest: `pmo-portal/src/lib/__tests__/equipmentMetrics.test.ts`; pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-003 | pgTAP | pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-004 | pgTAP | pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-005 | pgTAP | pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-006 | pgTAP | pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-007 | pgTAP | pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-008 | Unit + pgTAP | MISSING |
| AC-EAV-009 | pgTAP | MISSING |
| AC-EAV-010 | Unit | MISSING |
| AC-EAV-011 | Unit | vitest: `pmo-portal/src/lib/__tests__/equipmentMetrics.test.ts`; pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-012 | pgTAP | pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-013 | E2E (one journey) | e2e: `pmo-portal/e2e/AC-EAV-013-set-status-with-proof.spec.ts`; vitest: `pmo-portal/pages/equipment/EquipmentAvailability.test.tsx`; pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-014 | E2E (one journey) | vitest: `pmo-portal/pages/equipment/EquipmentAvailability.test.tsx` |

Totals: 14 ACs, 11 covered, 3 missing: AC-EAV-008, AC-EAV-009, AC-EAV-010

### 2526b-rental-deduction (spec `docs/specs/equipment-availability.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-EAV-001 | Unit (pure function) + pgTAP (read model) | vitest: `pmo-portal/src/lib/__tests__/equipmentMetrics.test.ts`; pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-002 | Unit | vitest: `pmo-portal/src/lib/__tests__/equipmentMetrics.test.ts`; pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-003 | pgTAP | pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-004 | pgTAP | pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-005 | pgTAP | pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-006 | pgTAP | pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-007 | pgTAP | pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-008 | Unit + pgTAP | vitest: `pmo-portal/src/lib/__tests__/equipmentMetrics.test.ts`; pgTAP: `supabase/tests/equipment_rental_check.test.sql` |
| AC-EAV-009 | pgTAP | vitest: `pmo-portal/src/lib/__tests__/equipmentMetrics.test.ts`; pgTAP: `supabase/tests/equipment_rental_check.test.sql` |
| AC-EAV-010 | Unit | vitest: `pmo-portal/src/lib/__tests__/equipmentMetrics.test.ts`; pgTAP: `supabase/tests/equipment_rental_check.test.sql` |
| AC-EAV-011 | Unit | vitest: `pmo-portal/src/lib/__tests__/equipmentMetrics.test.ts`; pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-012 | pgTAP | pgTAP: `supabase/tests/equipment_rental_check.test.sql`; pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-013 | E2E (one journey) | e2e: `pmo-portal/e2e/AC-EAV-013-set-status-with-proof.spec.ts`; vitest: `pmo-portal/pages/equipment/EquipmentAvailability.test.tsx`; pgTAP: `supabase/tests/equipment_status.test.sql` |
| AC-EAV-014 | E2E (one journey) | e2e: `pmo-portal/e2e/AC-EAV-014-rental-invoice-deduction.spec.ts`; vitest: `pmo-portal/pages/equipment/EquipmentAvailability.test.tsx`; vitest: `pmo-portal/pages/equipment/RentalInvoiceCheck.test.tsx` |

Totals: 14 ACs, 14 covered, 0 missing: none

### 2527-document-expiry (spec `docs/specs/document-expiry.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-DEX-001 | pgTAP | pgTAP: `supabase/tests/document_expiry.test.sql` |
| AC-DEX-002 | pgTAP | pgTAP: `supabase/tests/document_expiry.test.sql` |
| AC-DEX-003 | pgTAP | pgTAP: `supabase/tests/document_expiry.test.sql` |
| AC-DEX-004 | pgTAP | pgTAP: `supabase/tests/document_expiry.test.sql` |
| AC-DEX-005 | pgTAP | pgTAP: `supabase/tests/document_expiry.test.sql` |
| AC-DEX-006 | pgTAP; page render: Vitest | vitest: `pmo-portal/pages/equipment/ExpiringDocuments.test.tsx`; pgTAP: `supabase/tests/document_expiry.test.sql` |
| AC-DEX-007 | pgTAP | pgTAP: `supabase/tests/document_expiry.test.sql` |
| AC-DEX-008 | pgTAP | pgTAP: `supabase/tests/document_expiry.test.sql` |

Totals: 8 ACs, 8 covered, 0 missing: none

### 2528-crews-roster (spec `docs/specs/crews-roster-attendance.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-CRW-001 | pgTAP | vitest: `pmo-portal/src/lib/db/crews.test.ts`; pgTAP: `supabase/tests/crews_roster.test.sql` |
| AC-CRW-002 | pgTAP | vitest: `pmo-portal/src/lib/db/crews.test.ts`; pgTAP: `supabase/tests/crews_roster.test.sql` |
| AC-CRW-003 | pgTAP | vitest: `pmo-portal/src/lib/db/crews.test.ts`; pgTAP: `supabase/tests/crews_roster.test.sql` |
| AC-CRW-004 | Unit + pgTAP | vitest: `pmo-portal/pages/crews/WorkOrderRoster.test.tsx`; vitest: `pmo-portal/src/lib/db/crews.test.ts`; pgTAP: `supabase/tests/crews_roster.test.sql` |
| AC-CRW-005 | Unit + E2E | vitest: `pmo-portal/pages/crews/AttendanceTick.test.tsx`; vitest: `pmo-portal/src/lib/attendanceTick.test.ts`; vitest: `pmo-portal/src/lib/attendanceTick.ts` |
| AC-CRW-006 | pgTAP | vitest: `pmo-portal/pages/crews/AttendanceTick.test.tsx`; vitest: `pmo-portal/src/lib/attendanceTick.test.ts`; vitest: `pmo-portal/src/lib/attendanceTick.ts` |
| AC-CRW-007 | pgTAP | pgTAP: `supabase/tests/attendance_days.test.sql` |
| AC-CRW-008 | pgTAP | pgTAP: `supabase/tests/attendance_days.test.sql` |
| AC-CRW-009 | pgTAP | vitest: `pmo-portal/pages/crews/AttendanceTick.test.tsx`; vitest: `pmo-portal/src/lib/db/crews.test.ts`; pgTAP: `supabase/tests/attendance_timesheet.test.sql` |
| AC-CRW-010 | pgTAP (+ mutation check) | vitest: `pmo-portal/src/auth/policy.test.ts`; pgTAP: `supabase/tests/attendance_timesheet.test.sql` |
| AC-CRW-011 | pgTAP | e2e: `pmo-portal/e2e/AC-CRW-015-crew-day-to-approved-hours.spec.ts`; vitest: `pmo-portal/pages/crews/AttendanceTick.test.tsx`; vitest: `pmo-portal/src/lib/db/crews.test.ts` |
| AC-CRW-012 | pgTAP | vitest: `pmo-portal/pages/crews/AttendanceTick.test.tsx`; vitest: `pmo-portal/src/lib/db/crews.test.ts`; pgTAP: `supabase/tests/attendance_timesheet.test.sql` |
| AC-CRW-013 | pgTAP | pgTAP: `supabase/tests/attendance_days.test.sql` |
| AC-CRW-014 | pgTAP | vitest: `pmo-portal/pages/crews/AttendanceTick.test.tsx`; vitest: `pmo-portal/src/auth/policy.test.ts`; pgTAP: `supabase/tests/attendance_days.test.sql` |
| AC-CRW-015 | E2E (one journey) | e2e: `pmo-portal/e2e/AC-CRW-015-crew-day-to-approved-hours.spec.ts` |

Totals: 15 ACs, 15 covered, 0 missing: none

### 2529-org-terminology (spec `docs/specs/org-terminology.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-TERM-001 | pgTAP, `0975_org_terminology_rls.test.sql` | pgTAP: `supabase/tests/0975_org_terminology_rls.test.sql` |
| AC-TERM-002 | unit, `orgTerms.test.ts` | vitest: `pmo-portal/src/lib/i18n/orgTerms.test.ts` |
| AC-TERM-003 | unit, `orgTerms.i18next.test.ts` | vitest: `pmo-portal/src/lib/i18n/orgTerms.i18next.test.ts` |
| AC-TERM-004 | unit, `AdministrationTerminology.test.tsx` | vitest: `pmo-portal/pages/AdministrationTerminology.test.tsx` |
| AC-TERM-005 | guard, `scripts/check-org-terms.mjs --self-test` + repo run | MISSING |
| AC-TERM-006 | e2e | e2e: `pmo-portal/e2e/serial/AC-TERM-006-org-terminology.spec.ts` |
| AC-TERM-007 | unit | vitest: `pmo-portal/src/lib/i18n/notificationCopy.test.ts` |
| AC-TERM-008 | pgTAP | pgTAP: `supabase/tests/0976_org_terminology_notifications.test.sql`; pgTAP: `supabase/tests/budget_archive_cancel_intents.test.sql` |

Totals: 8 ACs, 7 covered, 1 missing: AC-TERM-005

### 2530-import-templates (spec `docs/specs/field-data-import-templates.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-IMT-001 | Unit (per descriptor) | vitest: `pmo-portal/src/lib/import/__tests__/fieldDataDescriptors.test.ts`; vitest: `pmo-portal/src/lib/import/__tests__/templateFile.test.ts` |
| AC-IMT-002 | Unit + pgTAP/e2e per entity | vitest: `pmo-portal/src/components/import/__tests__/templateWizard.test.tsx`; vitest: `pmo-portal/src/lib/import/__tests__/fieldDataDescriptors.test.ts`; vitest: `pmo-portal/src/lib/import/__tests__/templateFile.test.ts` |
| AC-IMT-003 | Unit | vitest: `pmo-portal/src/components/import/__tests__/templateWizard.test.tsx`; vitest: `pmo-portal/src/lib/import/__tests__/templateFile.test.ts` |
| AC-IMT-004 | Unit | vitest: `pmo-portal/src/components/import/__tests__/templateWizard.test.tsx`; vitest: `pmo-portal/src/lib/import/__tests__/templateFile.test.ts` |
| AC-IMT-005 | Unit | vitest: `pmo-portal/src/lib/import/__tests__/templateFile.test.ts` |
| AC-IMT-006 | Unit | vitest: `pmo-portal/src/lib/import/__tests__/templateFile.test.ts` |
| AC-IMT-007 | Unit | vitest: `pmo-portal/src/components/import/__tests__/templateWizard.test.tsx`; vitest: `pmo-portal/src/lib/import/__tests__/templateFile.test.ts` |
| AC-IMT-008 | pgTAP + Unit | MISSING |
| AC-IMT-009 | Unit | vitest: `pmo-portal/src/lib/import/__tests__/fieldDataDescriptors.test.ts` |
| AC-IMT-010 | Unit + pgTAP | MISSING |
| AC-IMT-011 | Unit | vitest: `pmo-portal/src/lib/import/__tests__/fieldDataDescriptors.test.ts` |
| AC-IMT-012 | Unit | vitest: `pmo-portal/src/lib/import/__tests__/fieldDataDescriptors.test.ts` |
| AC-IMT-013 | Unit + pgTAP | MISSING |
| AC-IMT-014 | E2E (one journey, rates; others by unit layer) | MISSING |

Totals: 14 ACs, 10 covered, 4 missing: AC-IMT-008, AC-IMT-010, AC-IMT-013, AC-IMT-014

### 2531-task-work-order (spec `docs/specs/task-work-order-proof.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-TWOP-001 | pgTAP | pgTAP: `supabase/tests/0991_task_work_order_proof.test.sql` |
| AC-TWOP-002 | pgTAP | pgTAP: `supabase/tests/0991_task_work_order_proof.test.sql` |
| AC-TWOP-003 | pgTAP | pgTAP: `supabase/tests/0991_task_work_order_proof.test.sql` |
| AC-TWOP-004 | pgTAP (mutation-check: remove the trigger check → red) | pgTAP: `supabase/tests/0991_task_work_order_proof.test.sql` |
| AC-TWOP-005 | pgTAP | pgTAP: `supabase/tests/0991_task_work_order_proof.test.sql` |
| AC-TWOP-006 | pgTAP | pgTAP: `supabase/tests/0991_task_work_order_proof.test.sql` |
| AC-TWOP-007 | Unit (repository + page) | vitest: `pmo-portal/src/lib/db/tasks.workOrder.test.ts` |
| AC-TWOP-008 | Unit (RTL) | vitest: `pmo-portal/src/components/tasks/TaskProofPanel.test.tsx` |
| AC-TWOP-009 | Unit | vitest: `pmo-portal/src/components/tasks/WorkOrderOpenTasks.test.tsx`; vitest: `pmo-portal/src/lib/db/tasks.workOrder.test.ts` |
| AC-TWOP-010 | E2E (one journey) | e2e: `pmo-portal/e2e/AC-TWOP-010-proof-before-done.spec.ts` |
| AC-TWOP-011 | pgTAP | pgTAP: `supabase/tests/0991_task_work_order_proof.test.sql` |
| AC-TWOP-012 | Unit + pgTAP (count) | vitest: `pmo-portal/src/lib/db/taskProofs.test.ts`; vitest: `pmo-portal/src/lib/db/taskProofs.ts`; pgTAP: `supabase/tests/0991_task_work_order_proof.test.sql` |

Totals: 12 ACs, 12 covered, 0 missing: none

### 2542-expiring-documents-edit (spec `docs/specs/expiring-documents-edit.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-DEE-001 | Vitest; repository call asserted | vitest: `pmo-portal/pages/equipment/ExpiryDocumentsCard.test.tsx` |
| AC-DEE-002 | Vitest | vitest: `pmo-portal/pages/equipment/ExpiryDocumentsCard.test.tsx` |
| AC-DEE-003 | Vitest | vitest: `pmo-portal/pages/equipment/ExpiryDocumentsCard.test.tsx` |
| AC-DEE-004 | Vitest | vitest: `pmo-portal/pages/equipment/ExpiryDocumentsCard.test.tsx` |
| AC-DEE-005 | Vitest | vitest: `pmo-portal/pages/equipment/ExpiryDocumentsCard.test.tsx`; vitest: `pmo-portal/src/auth/expiryDocumentPolicy.test.ts` |
| AC-DEE-006 | Vitest | vitest: `pmo-portal/pages/equipment/ExpiryDocumentsCard.test.tsx` |
| AC-DEE-007 | pgTAP | pgTAP: `supabase/tests/expiry_documents_storage.test.sql` |
| AC-DEE-008 | pgTAP | pgTAP: `supabase/tests/expiry_documents_storage.test.sql` |

Totals: 8 ACs, 8 covered, 0 missing: none

### 2542b-people-register (spec `docs/specs/people-register.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-PPL-001 | pgTAP | pgTAP: `supabase/tests/people_register.test.sql` |
| AC-PPL-002 | pgTAP | pgTAP: `supabase/tests/people_register.test.sql` |
| AC-PPL-003 | pgTAP | pgTAP: `supabase/tests/people_register.test.sql` |
| AC-PPL-004 | pgTAP; second-org probe rows | pgTAP: `supabase/tests/people_register.test.sql` |
| AC-PPL-005 | Vitest | vitest: `pmo-portal/pages/admin/People.test.tsx`; vitest: `pmo-portal/src/lib/db/__tests__/people.test.ts` |
| AC-PPL-006 | Vitest | vitest: `pmo-portal/pages/admin/People.test.tsx`; vitest: `pmo-portal/src/lib/db/__tests__/people.test.ts` |
| AC-PPL-007 | Vitest | vitest: `pmo-portal/pages/admin/People.test.tsx`; vitest: `pmo-portal/src/lib/db/__tests__/people.test.ts` |
| AC-PPL-008 | Vitest | vitest: `pmo-portal/pages/AdministrationShell.test.tsx`; vitest: `pmo-portal/pages/admin/People.test.tsx`; vitest: `pmo-portal/src/auth/personPolicy.test.ts` |
| AC-PPL-009 | Vitest | vitest: `pmo-portal/pages/admin/People.test.tsx`; vitest: `pmo-portal/src/lib/db/__tests__/people.test.ts` |
| AC-PPL-010 | Playwright, one journey | e2e: `pmo-portal/e2e/AC-PPL-010-people-register.spec.ts` |
| AC-PPL-011 | Vitest bahasa test | vitest: `pmo-portal/pages/admin/People.bahasa.test.tsx` |

Totals: 11 ACs, 11 covered, 0 missing: none

### 2542b-people-register (spec `docs/specs/expiring-documents-edit.spec.md`)

| AC | Intended layer (per spec) | Test found on branch |
|---|---|---|
| AC-DEE-001 | Vitest; repository call asserted | vitest: `pmo-portal/pages/equipment/ExpiryDocumentsCard.test.tsx` |
| AC-DEE-002 | Vitest | vitest: `pmo-portal/pages/equipment/ExpiryDocumentsCard.test.tsx` |
| AC-DEE-003 | Vitest | vitest: `pmo-portal/pages/equipment/ExpiryDocumentsCard.test.tsx` |
| AC-DEE-004 | Vitest | vitest: `pmo-portal/pages/equipment/ExpiryDocumentsCard.test.tsx` |
| AC-DEE-005 | Vitest | vitest: `pmo-portal/pages/equipment/ExpiryDocumentsCard.test.tsx`; vitest: `pmo-portal/src/auth/expiryDocumentPolicy.test.ts` |
| AC-DEE-006 | Vitest | vitest: `pmo-portal/pages/equipment/ExpiryDocumentsCard.test.tsx` |
| AC-DEE-007 | pgTAP | pgTAP: `supabase/tests/expiry_documents_storage.test.sql` |
| AC-DEE-008 | pgTAP | pgTAP: `supabase/tests/expiry_documents_storage.test.sql` |

Totals: 8 ACs, 8 covered, 0 missing: none

## Summary: ACs with no test on their branch

| Ticket | ACs | Covered | Missing | Missing ids (intended layer) |
|---|---|---|---|---|
| 2517 | 16 | 16 | 0 | none |
| 2518 | 11 | 10 | 1 | AC-WORP-010 (ux-proof gate) |
| 2519 | 16 | 15 | 1 | AC-WPVA-016 (e2e) |
| 2520 | 8 | 8 | 0 | none |
| 2521 | 14 | 14 | 0 | none |
| 2522 | 14 | 14 | 0 | none |
| 2523 | 13 | 13 | 0 | none |
| 2524 | 15 | 14 | 1 | AC-MRQ-015 (e2e); found on 2524b |
| 2524b | 15 | 15 | 0 | none |
| 2525 | 13 | 13 | 0 | none |
| 2526 | 14 | 11 | 3 | AC-EAV-008 (unit + pgTAP), AC-EAV-009 (pgTAP), AC-EAV-010 (unit); all found on 2526b |
| 2526b | 14 | 14 | 0 | none |
| 2527 | 8 | 8 | 0 | none |
| 2528 | 15 | 15 | 0 | none |
| 2529 | 8 | 7 | 1 | AC-TERM-005 (repo guard `check-org-terms.mjs`, not a test file under the searched paths) |
| 2530 | 14 | 10 | 4 | AC-IMT-008 (pgTAP + unit), AC-IMT-010 (unit + pgTAP), AC-IMT-013 (unit + pgTAP), AC-IMT-014 (e2e) |
| 2531 | 12 | 12 | 0 | none |
| 2542 | 8 | 8 | 0 | none |
| 2542b | 11 + 8 | 11 + 8 | 0 | none |

Open after the stack is considered: AC-WORP-010, AC-WPVA-016, AC-TERM-005 (check whether the guard
script's own self-test names it), AC-IMT-008/010/013/014. The 2530 branch merges 2526 and 2527 and
the rate catalogue, so its missing ids are genuine gaps on the merged stack.

## Tests written on this branch

None. Every missing id is either not a unit-layer item (e2e, pgTAP, ux-proof gate, repo guard)
or needs code that exists only on an unmerged feature branch. A search of `origin/dev` for the
code under test (rental deduction, import descriptors, org-terms guard) found nothing to test.

## Needs feature-branch code, not written

Unit-layer items (to write on the owning branch once it is the base):
- AC-EAV-008 and AC-EAV-010 (unit half): rental deduction maths (3,000 off 30,000; capped at the
  period amount) needs the code on `feat/2526b-rental-deduction`. Already cited there.
- AC-IMT-008 (unit half): rate-file key conflict fails the row, unchanged rate, identical re-import
  skipped; needs the rate descriptor on `feat/2530-import-templates`.
- AC-IMT-010 (unit half): crew workbook member overlap fails only the Members row; needs the crews
  descriptor on `feat/2530-import-templates` (and the crews code from 2528).
- AC-IMT-013 (unit half): import entry point absent without create permission; needs the import
  mount points on `feat/2530-import-templates`.

Not unit layer, so out of scope for this worker (listed for the owners):
- pgTAP: AC-EAV-008 (SQL half), AC-EAV-009, AC-IMT-008, AC-IMT-010, AC-IMT-013 (RLS half).
- e2e: AC-WPVA-016, AC-MRQ-015 (present on 2524b), AC-IMT-014.
- Gate or guard: AC-WORP-010 (`scripts/ux-proof.sh`), AC-TERM-005 (`scripts/check-org-terms.mjs`).
