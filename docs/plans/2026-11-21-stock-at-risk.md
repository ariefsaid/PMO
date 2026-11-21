# Plan: Stock at risk against site cover (#2694) — 2026-11-21

Spec: `docs/specs/stock-at-risk.spec.md` · Branch `feat/2694-stock-at-risk` · Migrations 1440–1441 (of 1440–1443).
Prior art: 0412/0413/0415/0418 (stock master, valuation, read RPCs, reorder), `StockOnHand.tsx` composition,
`stockReports.ts` DAL, `repositories/stock.ts`, `useStock.ts`.

## Slice 1 — Database (pgTAP owns AC-SAR-101..106)

1. **1440_stock_warehouse_cover.sql** — `alter table public.stock_warehouses add column cover_value numeric(14,2)`
   with check `cover_value is null or (cover_value >= 0 and cover_value < 'Infinity'::numeric)`; column comment;
   `grant update (cover_value) on public.stock_warehouses to authenticated` (select is already granted; RLS
   `stock_warehouses_update` rank ≥ 20 stays the authority). Rollback `1440_stock_warehouse_cover_down.sql` drops
   the column.
2. **1441_stock_at_risk_read.sql** — `get_stock_at_risk()` returns jsonb, stable, security definer,
   `set search_path = public`: `assert_is_active_member()`, org from `auth_org_id()`, cost keys behind
   `stock_can_see_cost()` (`-- mut:atrisk_cost` on that one line), rows = balances grouped per warehouse where
   `qty_on_hand > 0`, joined to `stock_warehouses`/`projects`; money keys only when cost allowed; order by at-risk
   desc then `w.code` (code-only order when money keys are absent). Revoke from public/anon; grant execute to
   authenticated. Rollback drops the function.
3. **`supabase/tests/stock_at_risk.test.sql`** — fixture in the `stock_valuation.test.sql` style (two orgs,
   Admin/PM/Engineer, central + two sites + other-org site, receives through `create_stock_document`); `plan(N)`
   with one `is()` per AC above; covers tenancy, rank gating, cover null/persisted, constraint refuses negative.
   Mutation proof (AC-SAR-104): replace the gate line with `true`, run on the VPS runner, watch AC-SAR-104 go red,
   restore, re-run green.

## Slice 2 — FE data path (Vitest owns AC-SAR-201)

1. `src/lib/db/stockReports.ts` — `StockAtRiskRow` + `getStockAtRisk()` (money keys optional, strings stay strings).
2. `src/lib/repositories/stock.ts` — `reports.atRisk`.
3. `src/hooks/useStock.ts` — `useStockAtRisk()` (org-scoped query key).
4. Tests first in `src/lib/db/stockReports.test.ts`: mapping, optional keys, error → AppError.

## Slice 3 — Screen (Vitest owns AC-SAR-301..304)

1. `pages/stock/StockAtRisk.tsx` — `ListPage` + `StockTabs` (new tab `tabs.atRisk` between Reorder and Setup) +
   `DataTable`; columns: Location (code + name, rowHeader), Kind, Project, Stock value, Cover (null →
   "Not recorded"), At risk (num, lead fact); summary line: total held, total at risk, count above cover;
   money columns render only when a row carries money keys (`showCost` pattern); phone cards via
   `mobileCardTitle`/`mobileCardDetails`; empty/error via `ListState`; table export values on every column.
2. `App.tsx` — lazy chunk, `/stock/at-risk` chunk route (namespaces `['stock']`) + gated route;
   `src/components/shell/routeMatch.ts` alias `/stock/at-risk` → `/stock`.
3. `src/components/stock/StockTabs.tsx` — the new tab.
4. Locales `public/locales/{en,id}/stock.json` — `tabs.atRisk`, `atRisk.*` (title, columns, summary, states,
   notRecorded); generic words only.
5. Tests first in `pages/stock/StockAtRisk.test.tsx`.

## Slice 4 — Setup cover field (Vitest owns AC-SAR-310)

1. `src/lib/db/stockMaster.ts` — `StockWarehouseInput.coverValue: string | null`; create/update send
   `cover_value` (null when blank).
2. `pages/stock/StockSetup.tsx` — warehouse form gains a cover TextField (decimal input, blank = not recorded,
   `0 or more, 2 decimals at most` client validation mirroring the column check).
3. Tests first in `pages/stock/StockSetup.test.tsx`.

## Gates (each result line quoted in the report)

- `npm run check:guards` · `npm run typecheck` · `npx eslint --max-warnings=0 <changed files>` ·
  `npx vitest related --run <changed source files>` (in `pmo-portal/`).
- Database: `/Users/ariefsaid/Coding/PMO/docs/private/vps-pgtap.sh feat/2694-stock-at-risk supabase/tests/stock_at_risk.test.sql`
  (shared local DB is never reset).
- `scripts/ux-proof.sh` on `/stock/at-risk` only if the app runs without a DB change locally; otherwise two
  screenshots are not required (the brief's alternative). The local dev server cannot exercise the new RPC without
  the migration, so the render proof is the Vitest states suite + Director's rendered review.
