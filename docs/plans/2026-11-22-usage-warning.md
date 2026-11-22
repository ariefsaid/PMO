# Plan: usage warning on installed material (spec `docs/specs/usage-warning.spec.md`)

Migrations 1860-1862 only. Rollbacks in `supabase/migrations/rollback/`. Builder runs no DB job; the orchestrator runs reset and pgTAP once per wave. Restated bodies come from the latest definition at head: `mrq_submit` = 1333; `mrq_usage_check` is dropped (1331); `mrq_set_usage_thresholds` = 1330 body as rewritten by the 1480 light-account sweep (orchestrator confirms with `pg_get_functiondef`); `notify_workflow_user` = 1224.

## Migrations

1. `1860_usage_threshold_single.sql` — on `material_request_settings`: rename `usage_warn_pct_1` to `usage_warn_pct`, drop `usage_warn_pct_2` and the order/`_2` range constraints, rename the `_1` range constraint. Drop `mrq_set_usage_thresholds(numeric, numeric)`; create `set_material_usage_threshold(p_pct numeric)`: Admin only (`MRQ_ADMIN_ONLY`), range (`MRQ_INVALID`), audit row, `assert_not_light()` first, revoke from public/anon, grant authenticated. Rollback restores the two columns (second null) and the old function body.
2. `1861_usage_warning_installed.sql` — reshape `material_request_usage_alerts`: delete slot-2 rows, drop `slot`, `pct`-pair uniqueness, `request_id`; add `report_id`; unique `(work_order_id, item_id)`. Add `usage_installed_qty(p_work_order, p_item)` (sum of `dsr_consumables` over validated, unsuperseded, unarchived reports) and `usage_check_work_order(p_work_order)` (definer, internal: for each item on live validated reports, compare with `mrq_plan_quantity`; insert once, notify the author of the latest validated live report carrying the item via `notify_workflow_user`; exceptions caught so validation never fails). Triggers on `daily_site_reports` `after update of status, superseded_at` firing when a report becomes validated (original) or a validated report is superseded (the correction's validation, after `superseded_at` is set at 1041:266, so the old version is not double counted). Drop `mrq_usage_check(uuid)`. Add client read `mrq_installed_for(p_work_order, p_item_ids[])` (org-scoped, `assert_not_light()`, 200-item cap) returning `item_id, installed_qty`. Rollback restores 1331's table shape and function.
3. `1862_mrq_submit_drop_usage_check.sql` — restate `mrq_submit` from the 1333 body with the `mrq_usage_check` call removed. Rollback restores the 1333 body.

## Code (paths)

- `pmo-portal/src/lib/db/materialRequests.ts`, `src/lib/repositories/materialRequests.ts`: `getUsageThreshold` (one value), `setUsageThreshold`, installed quantity folded into `getLinePlans`, `listUsageWarnings`; `lineUsageWarning` takes installed and plan. Generated types updated by the orchestrator after reset (no casts).
- `pmo-portal/src/hooks/useUsageThresholds.ts` becomes `useUsageThreshold.ts`.
- `pmo-portal/pages/materialRequests/UsageWarning.tsx` (installed vs plan), `UsageThresholdsEditor.tsx` (one field), used from `MaterialRequestNew.tsx`, `MaterialRequestDetail.tsx`, `MaterialRequestSettings.tsx`; the work-order card shows the recorded warning as `pages/materialRequests/WorkOrderUsageWarningBanner.tsx`, rendered in `pages/project-detail/tabs/WorkOrderCustomerOrderCard.tsx` outside the stock expander so it is visible without opening anything.
- Locale files (`materialRequests` namespace) English + Bahasa Indonesia; `refusals` namespace sentences for `MRQ_ADMIN_ONLY`, `MRQ_INVALID` if absent. New screens: `restructure` skill, tokens, phone 390px and desktop 1440px; disabled control says why.
- Glossary: add **Installed material** and **Usage warning** to `docs/glossary.md`.

## Tests (owning layer, ADR-0010)

| AC | File | Layer |
|---|---|---|
| UW-001..009 | `supabase/tests/usage_warning.test.sql` (replaces `mrq_usage_thresholds.test.sql`); mutation checks: count requests (UW-002), drop unset test (UW-005), drop admin test (UW-008) each go red | pgTAP |
| UW-010 | `pages/materialRequests/UsageWarning.test.tsx`, `MaterialRequestNew.usage.test.tsx`, `MaterialRequestDetail.usage.test.tsx` | Unit |
| UW-011 | `pages/MaterialRequestSettings.usage.test.tsx` | Unit |
| UW-012 | `pmo-portal/e2e/serial/AC-UW-012-installed-usage-warning.spec.ts` (serial lane: sets an org-wide setting) | e2e |

Refusals: `MRQ_USAGE_ADMIN_ONLY` and `MRQ_USAGE_INVALID` (the shared `MRQ_ADMIN_ONLY`/`MRQ_INVALID` carry delivery-note sentences). Also touched: `scripts/isolation-fixtures.sql`, `scripts/isolation-probe-denominator.d/2686-mrq-usage-thresholds.json`, `supabase/tests/inventory/anon-executable-definers/1330-mrq-usage-thresholds.txt`, hand-edited `database.types.ts` (the orchestrator regenerates after reset).

Gates in `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed>`; `npm run check:restated-functions`.
