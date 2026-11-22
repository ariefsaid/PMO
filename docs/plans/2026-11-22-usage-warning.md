# Plan: usage warning on installed material (spec `docs/specs/usage-warning.spec.md`)

Migrations 1860-1862 only, each with a rollback in `supabase/migrations/rollback/`. No migration restates an existing function: the request-time warning (1330-1333) and `mrq_submit` are untouched, so `npm run check:restated-functions` has nothing new to check. The builder runs no database job; the orchestrator runs reset and pgTAP once per wave.

## Migrations (order)

1. `1860_work_order_responsible_person.sql` (own early migration; later items stack on it): `work_orders.responsible_person_id`, same-organisation guard trigger, definer setter `set_work_order_responsible_person`, change-history registry entry. Rollback drops them.
2. `1861_usage_installed_source_setting.sql`: `material_request_settings.usage_installed_source` (default `site_reports`) and Admin-only `set_usage_installed_source`.
3. `1862_usage_installed_check.sql`: `material_installed_usage_alerts` (unique per work order and item); `usage_installed_qty` (by source), `usage_warning_recipient` (responsible person, else project manager), `usage_check_work_order`, `usage_check_safe` (swallows and logs every error), triggers on `daily_site_reports` (validated, superseded, archived) and `stock_documents` (issue or return posted to a work order).

## Code (paths)

- `pmo-portal/src/lib/db/workOrderResponsible.ts`, `src/hooks/useWorkOrderResponsible.ts`, `pages/work-order-detail/ResponsiblePersonSection.tsx` (rendered in `pages/WorkOrderDetail.tsx`).
- `src/lib/db/materialRequests.ts` (+ repository, hook): installed source get/set, recorded warnings list. `pages/materialRequests/UsageInstalledSourceEditor.tsx` (in `MaterialRequestSettings.tsx`, Admin only), `WorkOrderUsageWarningBanner.tsx` (in `pages/project-detail/tabs/WorkOrderCustomerOrderCard.tsx`, outside the stock expander).
- Locale files: `materialRequests`, `workOrders`, `refusals` (`MRQ_USAGE_ADMIN_ONLY`, `MRQ_USAGE_INVALID`, `RSP_FORBIDDEN`, `RSP_PERSON`), English and Bahasa Indonesia. Hand-edited `database.types.ts` (the orchestrator regenerates after reset). Isolation fixtures and denominator, anon-definer inventory files updated.
- `docs/glossary.md`: Installed material, Usage warning, Responsible person.

## Tests (owning layer, ADR-0010)

| AC | File | Layer |
|---|---|---|
| UW-013..016 | `supabase/tests/work_order_responsible.test.sql` | pgTAP |
| UW-001..009, 017, 018 | `supabase/tests/usage_warning.test.sql` (mutation checks in the header) | pgTAP |
| UW-010 | `pages/materialRequests/UsageInstalledSourceEditor.test.tsx`, `pages/MaterialRequestSettings.usage.test.tsx` | Unit |
| UW-011 | `pages/work-order-detail/ResponsiblePersonSection.test.tsx` | Unit |
| UW-006 (card) | `pages/materialRequests/WorkOrderUsageWarningBanner.test.tsx` | Unit |
| UW-012 | `pmo-portal/e2e/serial/AC-UW-012-installed-usage-warning.spec.ts` (serial: sets an org-wide setting) | e2e |

Gates in `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed source>`.
