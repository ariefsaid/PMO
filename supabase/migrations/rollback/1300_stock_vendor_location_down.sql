-- 1300_stock_vendor_location_down.sql — reverse 1300. Vendor locations (and the documents on them) must be removed or re-kinded first,
-- or the kind check below fails.
drop trigger if exists stock_warehouses_zz_vendor_kind on public.stock_warehouses;
drop function if exists public.guard_warehouse_to_vendor();
drop trigger if exists stock_documents_zz_vendor_kind on public.stock_documents;
drop function if exists public.guard_vendor_location_document();

-- the 0418 and 0415 bodies, restored
create or replace function public.get_reorder_suggestions(p_warehouse_id uuid, p_item_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid; v_today date; prm record; v_lead int; v_whole boolean; v_first date; v_history int; v_window int;
  v_usage numeric; v_moves int; v_avg numeric; v_level numeric; v_qty numeric; v_scale numeric; v_cur jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into prm from public.stock_reorder_params();
  select coalesce(i.lead_time_days, prm.default_lead_days), u.whole_only into v_lead, v_whole
    from public.stock_items i join public.stock_units u on u.id = i.unit_id where i.id = p_item_id and i.org_id = v_org;   -- mut:suggest_item_org
  if v_lead is null or not exists (select 1 from public.stock_warehouses w where w.id = p_warehouse_id and w.org_id = v_org) then   -- mut:suggest_org
    raise exception 'STK_NOT_FOUND: item or warehouse is not in your organisation' using errcode = 'P0001'; end if;
  v_today := public.stock_org_today(v_org);
  select jsonb_build_object('reorder_level', trim_scale(r.reorder_level)::text, 'reorder_quantity', trim_scale(r.reorder_quantity)::text) into v_cur      -- the level in force, beside the suggestion
    from public.stock_reorder_levels r where r.item_id = p_item_id and r.warehouse_id = p_warehouse_id and r.org_id = v_org;
  select min(l.occurred_on) into v_first from public.stock_ledger l where l.org_id = v_org and l.item_id = p_item_id and l.warehouse_id = p_warehouse_id;
  v_history := case when v_first is null then 0 else v_today - v_first end;
  v_window := least(prm.window_days, v_history);
  -- m = a usage movement (an issue, or a transfer out that is not a hand-back into a central warehouse); a return into the warehouse reduces usage.
  select coalesce(sum(case when x.m or x.kind = 'return' then -x.qty_delta else 0 end), 0), count(*) filter (where x.m)
    into v_usage, v_moves
    from (select l.kind, l.qty_delta,
                 l.kind = 'issue' or (l.kind = 'transfer' and l.qty_delta < 0 and not coalesce(dw.kind = 'central', false)) as m   -- mut:central_excl
            from public.stock_ledger l
            join public.stock_documents d on d.id = l.document_id
            left join public.stock_warehouses dw on dw.id = d.to_warehouse_id
           where l.org_id = v_org and l.item_id = p_item_id and l.warehouse_id = p_warehouse_id and l.occurred_on > v_today - v_window and l.occurred_on <= v_today
             and l.kind in ('issue','transfer','return')) x;
  if v_history < prm.min_history_days or v_moves < prm.min_movements or v_usage <= 0 then                                -- mut:min_history (v_usage <= 0: returns of older issues can net usage to nothing, no negative level)
    return jsonb_build_object('status', 'insufficient_history', 'suggestion', null, 'current', v_cur,
      'inputs', jsonb_build_object('history_days', v_history, 'usage_movements', v_moves, 'min_history_days', prm.min_history_days, 'min_movements', prm.min_movements));
  end if;
  v_avg := v_usage / v_window;
  v_scale := case when v_whole then 1 else 1000 end;                                                      -- PQ-5
  v_level := ceil(v_avg * (v_lead + prm.safety_days) * v_scale) / v_scale;
  v_qty   := ceil(v_avg * prm.order_cycle_days * v_scale) / v_scale;
  return jsonb_build_object('status', 'ok', 'current', v_cur,
    'suggestion', jsonb_build_object('reorder_level', trim_scale(v_level)::text, 'reorder_quantity', trim_scale(v_qty)::text),
    'inputs', jsonb_build_object('window_days', v_window, 'usage', trim_scale(v_usage)::text, 'avg_daily_usage', round(v_avg, 4)::text, 'lead_time_days', v_lead,
                                 'safety_days', prm.safety_days, 'order_cycle_days', prm.order_cycle_days, 'usage_movements', v_moves, 'history_days', v_history));
end $$;

create or replace function public.get_stock_on_hand(p_warehouse_id uuid default null, p_item_id uuid default null, p_include_zero boolean default false)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_cost boolean; v_n integer; v_rows jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_cost := public.stock_can_see_cost();                                                                -- mut:cost
  select count(*) into v_n from public.stock_balances b
   where b.org_id = v_org and (p_warehouse_id is null or b.warehouse_id = p_warehouse_id) and (p_item_id is null or b.item_id = p_item_id)
     and (b.qty_on_hand > 0 or coalesce(p_include_zero, false));
  if v_n > 5000 then raise exception 'STK_TOO_MANY: narrow the filter (more than 5000 rows)' using errcode = 'P0001'; end if;
  select coalesce(jsonb_agg(
           jsonb_build_object('item_id', i.id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code, 'whole_only', u.whole_only,
                              'warehouse_id', w.id, 'warehouse_code', w.code, 'warehouse_name', w.name, 'warehouse_kind', w.kind,
                              'qty_on_hand', trim_scale(b.qty_on_hand)::text)
           || case when v_cost then jsonb_build_object('value_on_hand', b.value_on_hand::text,
                                                       'avg_cost', case when b.qty_on_hand > 0 then round(b.value_on_hand / b.qty_on_hand, 4)::text end)
                   else '{}'::jsonb end
           order by w.code, i.code), '[]'::jsonb)
    into v_rows
    from public.stock_balances b
    join public.stock_items i on i.id = b.item_id join public.stock_units u on u.id = i.unit_id join public.stock_warehouses w on w.id = b.warehouse_id
   where b.org_id = v_org and (p_warehouse_id is null or b.warehouse_id = p_warehouse_id) and (p_item_id is null or b.item_id = p_item_id)
     and (b.qty_on_hand > 0 or coalesce(p_include_zero, false));
  return v_rows;
end $$;

create or replace function public.check_stock_warehouse_parent() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.project_id is not null
     and (select p.org_id from public.projects p where p.id = new.project_id) is distinct from new.org_id then
    raise exception 'STK_NOT_FOUND: the project is not in your organisation' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke update (vendor_company_id), insert (vendor_company_id) on public.stock_warehouses from authenticated;
alter table public.stock_warehouses drop constraint stock_warehouses_vendor_shape;
drop index if exists public.stock_warehouses_vendor_company_idx;
alter table public.stock_warehouses drop column vendor_company_id;
alter table public.stock_warehouses drop constraint stock_warehouses_kind_check;
alter table public.stock_warehouses add constraint stock_warehouses_kind_check check (kind in ('central','site','yard','staging'));
