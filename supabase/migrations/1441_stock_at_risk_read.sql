-- 1441_stock_at_risk_read.sql - #2694: the stock-at-risk read RPC (value held per location against its cover).
-- Spec docs/specs/stock-at-risk.spec.md (FR-SAR-001..005,007; AC-SAR-101..105) · plan docs/plans/2026-11-21-stock-at-risk.md §1.
-- Reversal: supabase/migrations/rollback/1441_stock_at_risk_read_down.sql (pre-production: supabase db reset).
-- ⚑ Definer like the 0415 read RPCs: balances have no client grant (D5). One location per row with stock on hand;
--   money keys only behind stock_can_see_cost() (rank >= 20, ADR-0070) — mut:atrisk_cost marks that decision.
--   Numerics return as text (NFR-STK-007).

create or replace function public.get_stock_at_risk()
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
  v_cost boolean;
  v_rows jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_cost := public.stock_can_see_cost();                                                                -- mut:atrisk_cost
  with held as (
    select b.warehouse_id, sum(b.value_on_hand) as value_held
      from public.stock_balances b
     where b.org_id = v_org and b.qty_on_hand > 0
     group by b.warehouse_id)
  select coalesce(jsonb_agg(
           jsonb_build_object('warehouse_id', w.id, 'warehouse_code', w.code, 'warehouse_name', w.name,
                              'warehouse_kind', w.kind, 'project_id', w.project_id, 'project_name', p.name)
           || case when v_cost then jsonb_build_object(
                    'stock_value', h.value_held::text,
                    'cover_value', w.cover_value::text,
                    'at_risk', (case when w.cover_value is null then h.value_held
                                     else greatest(h.value_held - w.cover_value, 0::numeric) end)::text)
                  else '{}'::jsonb end
           order by (case when v_cost then
                       case when w.cover_value is null then h.value_held
                            else greatest(h.value_held - w.cover_value, 0::numeric) end end) desc nulls last,
                    w.code, w.id), '[]'::jsonb)
    into v_rows
    from held h
    join public.stock_warehouses w on w.id = h.warehouse_id and w.org_id = v_org
    left join public.projects p on p.id = w.project_id;
  return v_rows;
end $$;

revoke all on function public.get_stock_at_risk() from public, anon;
grant execute on function public.get_stock_at_risk() to authenticated;
