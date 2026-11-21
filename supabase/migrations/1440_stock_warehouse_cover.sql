-- 1440_stock_warehouse_cover.sql - #2694: the site cover recorded on a stock location.
-- Spec docs/specs/stock-at-risk.spec.md (FR-SAR-006, AC-SAR-106) · plan docs/plans/2026-11-21-stock-at-risk.md §1.
-- Reversal: supabase/migrations/rollback/1440_stock_warehouse_cover_down.sql (pre-production: supabase db reset).
-- ⚑ A plain recorded figure (OD-SCOPE-2: the client's setting, nothing computed): nullable, no default, no backfill,
--   so existing organisations see no change on any existing screen (NFR-SAR-004). Writes stay behind the shipped
--   stock_warehouses_update policy (rank >= 20, ADR-0070); this migration only widens the column grant.

alter table public.stock_warehouses
  add column cover_value numeric(14,2)
    constraint stock_warehouses_cover_value_check
    check (cover_value is null or (cover_value >= 0 and cover_value < 'Infinity'::numeric));

comment on column public.stock_warehouses.cover_value is
  'Site cover: the protection value recorded for this location (#2694). Null = not recorded; stock value above it reads as at risk.';

grant update (cover_value) on public.stock_warehouses to authenticated;   -- additive to 0412's column grants; RLS stays the authority
