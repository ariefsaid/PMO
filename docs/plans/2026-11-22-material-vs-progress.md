# Plan: Material issued ahead of progress raises an alert (material-vs-progress)

> **REVISED (coordinator steering).** Build starts after usage-warning pushes migration 1860 (`work_orders.responsible_person_id`) and its alert path; this branch then merges `feat/gap-material-usage-warning`. Recipients = responsible person, else project manager (usage-warning's helper). Alert = a new kind on usage-warning's alert row and notify helper. DROP: `ahead_alert_roles`, `set_work_order_ahead_alert_roles`, `work_order_material_alerts`, the roles panel, `STK_ALERT_ROLE*` refusals, AC-MVP-009. KEEP: the 1341 measure, the event triggers and explicit skips, the quiet backfill, the card badge, the needs-you entry, the bell link, strings, glossary. ADD: the count on the work-order page header. Migrations 1870 to 1879 are used for the triggers and the backfill only; the committed 1870-1873 are WIP and get replaced. The sections below describe the first design.

Spec: `docs/specs/material-vs-progress.spec.md`. Branch `feat/gap-material-material-vs-progress`. Migrations 1870 to 1873 (assigned 1870-1879), each with a rollback in `supabase/migrations/rollback/`. Executor: Orca worker. Not money-path (reads the ledger, posts nothing); DB rules are still proved in pgTAP with mutation checks. The builder runs no DB, pgTAP, e2e or screenshot job.

## Migrations

1. `1870_work_order_ahead_alert_settings.sql`: `alter table work_order_stock_settings add column ahead_alert_roles text[] not null default '{}'`; `set_work_order_ahead_alert_roles(p_roles text[])` definer, `assert_is_active_member`, Admin only (42501), every role must exist in the built-in role enum (refusal `STK_ALERT_ROLE_UNKNOWN: ...`), upsert like `set_work_order_issue_threshold` (1340), `log_audit('work_order_ahead_alert_roles.set')`. Revoke from public/anon, grant authenticated. Rollback `rollback/1870_..._down.sql` drops the function and column.
2. `1871_work_order_material_alerts.sql`: table `work_order_material_alerts (id, org_id default-stamped via `stamp_org_id`, work_order_id, item_id, issued_pct, progress_pct, gap_pp, threshold_pct, notified_user_ids uuid[], opened_at, last_seen_at, resolved_at)` with a partial unique index `(work_order_id,item_id) where resolved_at is null`; RLS enabled and forced, select for active, non-light members of the org (shape of `material_request_usage_alerts` 1331 and the light-account read boundary 1462), `(select helper())` wrapped, no client write grants. Rollback drops the table.
3. `1872_work_order_ahead_alert_check.sql`: internal `wo_material_alert_check(p_work_order_id uuid) returns void` (definer, revoked from everyone): returns if `auth_org_id()` is null or differs from the work order's org (system actor), calls the existing `get_work_order_material_vs_progress` (1341, unchanged; no restated function), opens, refreshes or resolves alerts, resolves all when the threshold is null, resolves a vanished item, notifies controllers through `notify_workflow_user` (1224) for newly opened episodes only; recipients per FR-MVP-006 (excludes light-account roles). One-time backfill statement opens alerts for already-warning items with `notified_user_ids = '{}'` and no notification (AC-MVP-010). Triggers (additive, `after`, `when` guarded, errors are not swallowed; the system-actor skip is the only early exit): on `stock_documents` update to `Posted` where kind in ('issue','return') and work order set; on `daily_site_reports` when status, `superseded_at` or `archived_at` change; on `work_order_acceptances` when status becomes `Confirmed`. Rollback drops triggers and functions.
4. `1873_my_open_material_alerts.sql`: `my_open_material_alerts() returns table(work_order_id, project_id, wo_label, item_count)` definer, stable, the caller's controlled work orders only (same recipient rule, light accounts get zero rows). Rollback drops it.
5. Fragments: `supabase/tests/inventory/anon-executable-definers/1870-material-vs-progress-alerts.txt` (client-callable functions), `scripts/isolation-probe-denominator.d/<name>.json` for the new table (read the script header). Run `npm run check:restated-functions` (nothing restated; confirm it passes). Regenerate `pmo-portal/src/lib/supabase/database.types.ts` by hand-edit only if the generator cannot run offline (note in report); no casts.

## Tests (written first)

| File | Owns |
|---|---|
| `supabase/tests/1870_work_order_ahead_alert.test.sql` | AC-MVP-001 to 010 (fixture of 1341's test plus a project manager, an Admin, a Foreman, an inactive member, a second organisation, a system-actor posting) |
| `pmo-portal/src/lib/db/workOrderMaterialAlerts.test.ts` | repository mapping, roles save |
| `pmo-portal/pages/project-detail/tabs/WorkOrderAheadBadge.test.tsx` | AC-MVP-011 (EN and ID) |
| `pmo-portal/src/lib/materialAlertSteps.test.ts` and `useNeedsYou` addition test | AC-MVP-012 |
| `pmo-portal/pages/stock/WorkOrderAheadAlertRolesPanel.test.tsx` | AC-MVP-013 |
| `pmo-portal/e2e/AC-MVP-014-ahead-of-progress-alert.spec.ts` | AC-MVP-014, `@e2e-isolation` per `docs/e2e-parallel-conventions.md` |

## App code

- `pmo-portal/src/lib/db/workOrderMaterialAlerts.ts`, `src/lib/repositories/workOrderMaterialAlerts.ts` (ADR-0017), `src/hooks/useWorkOrderMaterialAlerts.ts` (alerts per project, roles read/save).
- Badge on the work-order card header in `pages/project-detail/tabs/WorkOrderCustomerOrderCard.tsx`: new small component `WorkOrderAheadBadge.tsx`, count only when open alerts exist, link opens the stock section; hidden under external inventory ownership.
- Needs-you entry: `src/lib/materialAlertSteps.ts` (pure summary like `waitingSteps.ts`) wired into `src/components/dashboard/restructure/useNeedsYou.ts` next to the billing-steps entry.
- `pages/stock/WorkOrderAheadAlertRolesPanel.tsx` in `StockSetup.tsx` beside `WorkOrderIssueThresholdPanel`, shared form primitives, `can()` Admin gate (UX only), read-only state says why, empty state says who is told by default.
- Refusals: `STK_ALERT_ROLE_UNKNOWN` sentence in English and Bahasa Indonesia in the `refusals` locale files (`pmo-portal/src/lib/refusals.ts` catalogue; `scripts/check-refusal-codes.mjs` must pass). Screen strings in `public/locales/{en,id}/stock.json` under `siteWork.materialProgress.alert.*`.
- `docs/glossary.md`: **Material alert** (open record per work order and item), **Alert episode**. Screens follow `.claude/skills/restructure/SKILL.md` and `DESIGN.md` tokens; 390px and 1440px.

## Gates (phase 2)

`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed sources>` plus the touched test files. pgTAP, mutation checks (the five in the spec) and e2e are run by the orchestrator.
