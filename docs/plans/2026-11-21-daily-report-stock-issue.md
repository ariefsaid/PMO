# Plan: material on a validated daily report posts a stock issue (#2676)

Spec `docs/specs/daily-report-stock-issue.spec.md`. Branch `feat/2676-daily-report-stock-issue`, stacked on `feat/2693-stock-reservations`. Migrations 1320-1324 only; each has a rollback in `supabase/migrations/rollback/`. Tests are written, not run here (orchestrator runs DB, pgTAP, mutation, e2e).

## Restated functions (latest body = the one cited)
| Function | Latest body | Change |
|---|---|---|
| `stock_assert_keeper(uuid,uuid,uuid)` | 0413 (only definition) | one clause: return false when `current_setting('pmo.dsr_stock_post', true) = 'on'` |
| `dsr_replace_lines(daily_site_reports, jsonb)` | 1041 (only definition) | consumables accept optional `work_order_line_id` (must be a line of the same work order) |
| `dsr_correct(uuid, text)` | 1041 (only definition) | the consumables copy carries `work_order_line_id` |
Not restated: `dsr_validate`, `mrq_submit`, `create_procurement_with_items`, `record_*_match_lines`, `stock_post_core`, the engine.

## Migrations
| File | Content |
|---|---|
| `1320_dsr_stock_issue_settings.sql` | `organizations.dsr_stock_issue`, `dsr_stock_issue_items`; `set_dsr_stock_issue` (Admin, audited, ERP refusal); `stock_items.consumable`; `work_orders.site_warehouse_id` + guard trigger (`DRS_LOCATION`); `dsr_consumables.work_order_line_id` |
| `1321_dsr_stock_postings.sql` | `dsr_stock_postings`, `dsr_stock_posting_lines` (uniques, org RLS, select-only), added to the isolation denominator |
| `1322_dsr_stock_restated.sql` | the three restated functions |
| `1323_dsr_post_stock.sql` | `dsr_post_stock`, `dsr_reverse_stock` (internal, revoked), trigger `daily_site_reports_zz_post_stock`, `dsr_retry_stock` (client) |
| `1324_dsr_stock_status_read.sql` | `dsr_stock_status(report)` read; `dsr_stock_flagged(uuid[])` for list/queue markers |
Rollbacks: `rollback/132{0..4}_*_down.sql`.

## Tests (written, owning layer per AC)
- pgTAP `supabase/tests/1320_dsr_stock_issue.test.sql` (AC-001..017), `1321_dsr_stock_issue_access.test.sql` (AC-014..016 org isolation); also run with 0178 and 0646.
- Inventory fragment `supabase/tests/inventory/anon-executable-definers/2676-dsr-stock-issue.txt`; denominator fragment `scripts/isolation-probe-denominator.d/2676-dsr-stock-issue.json`.
- Vitest: `pmo-portal/src/lib/db/dsrStockIssue.test.ts` (AC-020), `pmo-portal/pages/siteReports/SiteReportStock.test.tsx` (AC-018), extension of `siteReportForm.test.ts` for the line's work item.
- e2e: `pmo-portal/e2e/AC-DRS-019-daily-report-stock-issue.spec.ts` (phone + desktop, EN + ID), isolation tag per `docs/e2e-parallel-conventions.md`.

## Code (phase 2)
`src/lib/db/dsrStockIssue.ts` (DAL + repository), `dailySiteReports.ts` (material line `work_order_line_id`), `pages/siteReports/SiteReportStock.tsx` (section + warning + retry), `SiteReportDetail.tsx`/`SiteReports.tsx` (marker), `WorkOrderDetail.tsx` (site location field), stock item form (consumable flag), settings card; strings in both locale files; `docs/glossary.md` (material line, site location, stock flag); `docs/qa-portfolio.md` routes x oracles row; rollback files.

## Order
1320 -> 1321 -> 1322 -> 1323 -> 1324; pgTAP first (red), SQL, then DAL, UI, e2e. Mutation marks as in spec section 7.
