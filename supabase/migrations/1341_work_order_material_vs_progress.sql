-- 1341_work_order_material_vs_progress.sql — #2674: issued share against progress share per work order.
-- Spec docs/specs/material-issued-vs-progress.spec.md (FR-MIP-010..016); proven by supabase/tests/1341_work_order_material_vs_progress.test.sql.
-- Reuses get_work_order_stock_balance (issued, net of returns; 1031/1102) and mrq_plan_quantity (planned; 1001). Writes nothing.
-- Progress = rate-weighted percent of allocated lines, done = greater of Confirmed accepted and validated live daily quantity, capped.
-- Threshold unset: returns an empty comparison (feature off). A warning is information only.
-- REVERSE: supabase/migrations/rollback/1341_work_order_material_vs_progress_down.sql.
create or replace function public.get_work_order_material_vs_progress(p_work_order_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_org uuid; v_thr numeric; v_progress numeric; v_items jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then   -- mut:org
    raise exception 'STK_NOT_FOUND: the work order is not in your organisation' using errcode = 'P0001';
  end if;
  select s.issue_progress_threshold_pct into v_thr from public.work_order_stock_settings s where s.org_id = v_org;
  if v_thr is null then
    return jsonb_build_object('threshold_pct', null, 'progress_pct', null, 'items', '[]'::jsonb);
  end if;

  select case when count(*) > 0 and bool_and(b.rate > 0) and sum(b.rate * l.quantity) > 0
              then round(100 * sum(b.rate * least(greatest(coalesce(acc.q, 0), coalesce(dly.q, 0)), l.quantity))
                         / sum(b.rate * l.quantity), 1) end
    into v_progress
    from public.work_order_lines l
    join public.boq_items b on b.id = l.boq_item_id and b.org_id = l.org_id
    left join lateral (
      select sum(al.quantity) q from public.work_order_acceptance_lines al
        join public.work_order_acceptances a on a.id = al.acceptance_id
       where a.work_order_id = l.work_order_id and a.org_id = l.org_id and a.status = 'Confirmed'
         and al.boq_item_id = l.boq_item_id) acc on true
    left join lateral (
      select sum(pl.quantity) q from public.dsr_progress_lines pl
        join public.daily_site_reports r on r.id = pl.report_id
       where pl.work_order_line_id = l.id and r.org_id = l.org_id
         and r.status = 'validated'   -- mut:draft
         and r.superseded_at is null and r.archived_at is null) dly on true
   where l.work_order_id = p_work_order_id and l.org_id = v_org;

  with issued as (
    select (e->>'item_id')::uuid as item_id, sum((e->>'issued_qty')::numeric) as q
      from jsonb_array_elements(public.get_work_order_stock_balance(p_work_order_id, null)) e group by 1
  ), allowed as (
    select distinct a.item_id from public.work_order_lines wl
      join public.boq_material_allowances a on a.boq_item_id = wl.boq_item_id and a.org_id = wl.org_id
     where wl.work_order_id = p_work_order_id and wl.org_id = v_org
  ), ids as (
    select item_id from issued union select item_id from allowed
  ), base as (
    select i.id as item_id, i.code, i.name, u.code as unit_code,
           public.mrq_plan_quantity(p_work_order_id, i.id) as planned, coalesce(x.q, 0) as net_issued
      from ids join public.stock_items i on i.id = ids.item_id and i.org_id = v_org
      join public.stock_units u on u.id = i.unit_id
      left join issued x on x.item_id = i.id
  ), calc as (
    select base.*, case when planned > 0 then round(100 * net_issued / planned, 1) end as issued_pct
      from base where planned > 0 or net_issued <> 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', item_id, 'item_code', code, 'item_name', name, 'unit_code', unit_code,
           'planned_qty', trim_scale(planned)::text, 'issued_qty', trim_scale(net_issued)::text,
           'issued_pct', issued_pct,
           'gap_pp', case when issued_pct is not null and v_progress is not null then issued_pct - v_progress end,
           'unplanned', planned <= 0,
           'warn', issued_pct is not null and v_progress is not null and issued_pct - v_progress > v_thr)   -- mut:gap
         order by code), '[]'::jsonb)
    into v_items from calc;
  return jsonb_build_object('threshold_pct', v_thr, 'progress_pct', v_progress, 'items', v_items);
end $$;
revoke all on function public.get_work_order_material_vs_progress(uuid) from public, anon;
grant execute on function public.get_work_order_material_vs_progress(uuid) to authenticated;
