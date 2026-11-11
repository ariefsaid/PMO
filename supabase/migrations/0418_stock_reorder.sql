-- #1512 S6: reorder levels, the usage-based suggestion and the below-level worklist (AC-STK-025..027, FR-STK-051..054, OQ-STK-8).
-- Plan docs/plans/2026-10-31-inventory-project-consumption.md S6.2. Nothing here posts stock or creates a purchase request.

create table public.stock_reorder_levels (
  org_id           uuid not null references public.organizations(id),
  item_id          uuid not null references public.stock_items(id),
  warehouse_id     uuid not null references public.stock_warehouses(id),
  reorder_level    numeric(14,3) not null check (reorder_level >= 0 and reorder_level < 'Infinity'::numeric),
  reorder_quantity numeric(14,3) check (reorder_quantity is null or (reorder_quantity > 0 and reorder_quantity < 'Infinity'::numeric)),
  set_by           uuid not null references public.profiles(id),
  set_at           timestamptz not null default now(),
  primary key (item_id, warehouse_id)
);
alter table public.stock_reorder_levels enable row level security; alter table public.stock_reorder_levels force row level security;
create policy stock_reorder_levels_select on public.stock_reorder_levels for select using (org_id = public.auth_org_id() and public.is_active_member());
revoke all on public.stock_reorder_levels from authenticated, anon;
grant select on public.stock_reorder_levels to authenticated;          -- written only by set_stock_reorder_level

-- OQ-STK-8: the constants live in ONE place.
create or replace function public.stock_reorder_params() returns table (window_days int, safety_days int, order_cycle_days int, default_lead_days int, min_history_days int, min_movements int)
  language sql immutable as $$ select 90, 7, 30, 14, 28, 3 $$;

create or replace function public.set_stock_reorder_level(p_warehouse_id uuid, p_item_id uuid, p_level numeric, p_quantity numeric default null) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_ok boolean; v_before public.stock_reorder_levels;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_ok := coalesce(public.role_rank(public.auth_role()) >= 20, false);                                    -- mut:reorder_rank (PQ-6)
  if not v_ok then raise exception 'only a Project Manager or above sets a reorder level' using errcode = '42501'; end if;
  if not exists (select 1 from public.stock_items i where i.id = p_item_id and i.org_id = v_org)   -- mut:set_item_org
     or not exists (select 1 from public.stock_warehouses w where w.id = p_warehouse_id and w.org_id = v_org) then   -- mut:set_org
    raise exception 'STK_NOT_FOUND: item or warehouse is not in your organisation' using errcode = 'P0001'; end if;
  select * into v_before from public.stock_reorder_levels where item_id = p_item_id and warehouse_id = p_warehouse_id;
  if p_level is null then                                                                                 -- clearing
    delete from public.stock_reorder_levels where item_id = p_item_id and warehouse_id = p_warehouse_id;
  else
    if p_level < 0 or p_level >= 1e11 or p_level <> round(p_level, 3) then raise exception 'STK_INVALID: a reorder level is 0 or more, 3 decimals at most' using errcode = 'P0001'; end if;
    if p_quantity is not null and (p_quantity <= 0 or p_quantity >= 1e11 or p_quantity <> round(p_quantity, 3)) then
      raise exception 'STK_INVALID: an order quantity is more than 0, 3 decimals at most' using errcode = 'P0001'; end if;
    insert into public.stock_reorder_levels (org_id, item_id, warehouse_id, reorder_level, reorder_quantity, set_by, set_at)
      values (v_org, p_item_id, p_warehouse_id, p_level, p_quantity, v_uid, now())
      on conflict (item_id, warehouse_id) do update set reorder_level = excluded.reorder_level, reorder_quantity = excluded.reorder_quantity, set_by = excluded.set_by, set_at = excluded.set_at;
  end if;
  perform public.log_audit('stock.reorder_level.set', v_org, v_uid, p_item_id,
    jsonb_build_object('warehouse_id', p_warehouse_id,
      'before', case when v_before.item_id is null then null else jsonb_build_object('reorder_level', trim_scale(v_before.reorder_level), 'reorder_quantity', v_before.reorder_quantity) end,
      'after',  case when p_level is null then null else jsonb_build_object('reorder_level', trim_scale(p_level), 'reorder_quantity', p_quantity) end));
end $$;

-- The suggestion (FR-STK-051/052). Changes nothing. usage = issues + transfers out (excluding transfers INTO a central warehouse) - returns in.
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

-- FR-STK-054: the worklist. Items at or below a SET level, per warehouse. Creates nothing.
create or replace function public.get_stock_below_reorder() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  return coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
            'warehouse_id', w.id, 'warehouse_code', w.code, 'qty_on_hand', trim_scale(coalesce(b.qty_on_hand, 0))::text,
            'reorder_level', trim_scale(r.reorder_level)::text, 'reorder_quantity', trim_scale(r.reorder_quantity)::text) order by w.code, i.code)
       from public.stock_reorder_levels r join public.stock_items i on i.id = r.item_id join public.stock_units u on u.id = i.unit_id
       join public.stock_warehouses w on w.id = r.warehouse_id
       left join public.stock_balances b on b.item_id = r.item_id and b.warehouse_id = r.warehouse_id
      where r.org_id = v_org /* mut:below_org */ and i.archived_at is null and w.archived_at is null and coalesce(b.qty_on_hand, 0) <= r.reorder_level), '[]'::jsonb);   -- mut:below_cmp
end $$;
revoke all on function public.stock_reorder_params() from public, anon, authenticated;
revoke all on function public.set_stock_reorder_level(uuid, uuid, numeric, numeric), public.get_reorder_suggestions(uuid, uuid), public.get_stock_below_reorder() from public, anon;
grant execute on function public.set_stock_reorder_level(uuid, uuid, numeric, numeric), public.get_reorder_suggestions(uuid, uuid), public.get_stock_below_reorder() to authenticated;
