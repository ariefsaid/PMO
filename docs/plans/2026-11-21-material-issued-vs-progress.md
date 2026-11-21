# Plan: Material issued against progress (#2674)

Spec: `docs/specs/material-issued-vs-progress.spec.md`. Branch `feat/2674-material-issued-vs-progress`. Migrations 1340 and 1341 only. Gates in this lane: `npm run check:guards`, `npm run typecheck`, eslint on changed files, the touched vitest files. pgTAP, mutation and e2e are written, not run; the orchestrator runs them.

## Migrations

1. `supabase/migrations/1340_work_order_stock_settings.sql`
   - `work_order_stock_settings (org_id uuid primary key references organizations(id) on delete cascade, issue_progress_threshold_pct numeric(5,2) check (null or between 0 and 100), updated_by uuid references profiles(id), updated_at timestamptz not null default now())`. RLS enabled and forced; select policy `org_id = (select auth_org_id()) and (select is_active_member())`; all table privileges revoked from clients, select granted to authenticated.
   - `set_work_order_issue_threshold(p_threshold_pct numeric) returns numeric`: security definer, `assert_is_active_member`, Admin only (42501 otherwise), range check (22023), upsert for the caller's org, one `log_audit('work_order_issue_threshold.set', ...)` with before and after. Revoked from public and anon, granted to authenticated.
   - Rollback `supabase/migrations/rollback/1340_work_order_stock_settings_down.sql`.
2. `supabase/migrations/1341_work_order_material_vs_progress.sql`
   - `get_work_order_material_vs_progress(p_work_order_id uuid) returns jsonb`: security definer, stable, `assert_is_active_member`, work order must be on `auth_org_id()` (else `STK_NOT_FOUND`, P0001, as 1031). Reads the threshold; when null returns `{threshold_pct:null, progress_pct:null, items:[]}`. Otherwise: progress CTE over `work_order_lines` x `boq_items` (rate) with accepted from Confirmed `work_order_acceptance_lines` and validated, live `dsr_progress_lines` (`daily_site_reports.status='validated' and superseded_at is null and archived_at is null`), `least(greatest(accepted, daily), allocated)`; issued CTE sums `issued_qty` by item from `get_work_order_stock_balance(p_work_order_id, null)`; planned from `mrq_plan_quantity` for the union of issued items and allowance items of the work order's BoQ lines. Output per spec FR-MIP-010; `warn = gap > threshold`.
   - Rollback `supabase/migrations/rollback/1341_work_order_material_vs_progress_down.sql`.
3. Fragments: `supabase/tests/inventory/anon-executable-definers/1340-work-order-issue-progress.txt` (both client-callable functions, header comment as in 1045); `scripts/isolation-probe-denominator.d/2674-work-order-stock-settings.json` for the new public table (read the script header for the exact shape).

## Tests (written first)

| File | Owns |
|---|---|
| `supabase/tests/1340_work_order_issue_threshold.test.sql` | AC-MIP-001, 002, 003 (Admin ok; Finance, PM, Storekeeper refused; range) |
| `supabase/tests/1341_work_order_material_vs_progress.test.sql` | AC-MIP-004 to 011 (fixture: one org, allowance 100, issue 60, return 20, two lines of unequal rate, a draft and a superseded daily report, second org and an anon call for tenancy) |
| `pmo-portal/src/lib/db/workOrderMaterialProgress.test.ts` | repository mapping and threshold save (AC-MIP-015 repository half) |
| `pmo-portal/pages/stock/WorkOrderMaterialProgressBanner.test.tsx` | AC-MIP-012, 013, 014 (EN and ID) |
| `pmo-portal/pages/stock/WorkOrderIssueThresholdPanel.test.tsx` | AC-MIP-015 (Admin only, range error) |
| `pmo-portal/e2e/AC-MIP-016-issued-ahead-of-progress-warning.spec.ts` | AC-MIP-016, tagged `@e2e-isolation` per `docs/e2e-parallel-conventions.md` |

## App code

- `pmo-portal/src/lib/db/workOrderMaterialProgress.ts` (read + `setIssueThreshold`, decimal strings kept), `pmo-portal/src/lib/repositories/workOrderMaterialProgress.ts` (repository seam, ADR-0017), `pmo-portal/src/hooks/useWorkOrderMaterialProgress.ts` (`useQuery`, invalidated by the threshold save).
- `pmo-portal/pages/stock/WorkOrderMaterialProgressBanner.tsx`, rendered by `WorkOrderStockBalance.tsx` above the table only when the ownership state is standalone and a warning exists (no change to its existing output otherwise).
- `pmo-portal/pages/stock/WorkOrderIssueThresholdPanel.tsx` in `StockSetup.tsx`, behind `can()` Admin (UX only; the RPC is the authority), shared form primitives, field error on range.
- Strings in the stock namespace, English and Bahasa Indonesia (`siteWork.materialProgress.*`).
- Types: regenerate the Supabase types block by hand-edit only if the repo's generator cannot run offline (note in report).
- `docs/glossary.md`: add **Issued share**, **Progress share**, **Issue-progress gap**.

## Evidence / gates (phase 2)

`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest run <the three vitest files + WorkOrderStockBalance.test.tsx + StockSetup tests>`. No DB, e2e or screenshots in this lane.
