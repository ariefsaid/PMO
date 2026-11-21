-- 1309_stock_proof_status_and_reorder_down.sql — reverse 1309: the 1030 stock_post_core and the 1300 get_reorder_suggestions are restored.
drop function if exists public.get_stock_movement_proof_status(text, date, date);
create or replace function public.stock_post_core(p_document_id uuid) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare d public.stock_documents; v_uid uuid := auth.uid(); v_override boolean := false;
begin
  select * into d from public.stock_documents x where x.id = p_document_id for update;                   -- lock order (1)
  if not found or d.org_id is distinct from public.auth_org_id() then
    raise exception 'STK_NOT_FOUND: the document is not in your organisation' using errcode = 'P0001'; end if;
  if d.status = 'Posted' then return; end if;                                                           -- replay-safe
  if d.status = 'Cancelled' then raise exception 'STK_IMMUTABLE: a cancelled document cannot be posted' using errcode = 'P0001'; end if;
  perform public.stock_assert_standalone(d.org_id);
  perform public.stock_assert_dates(d.org_id, d.occurred_on);
  if d.kind in ('receive','transfer','issue','return') then
    v_override := public.stock_assert_keeper(d.org_id, d.warehouse_id, v_uid);
  end if;
  -- Archive vs post (#1512 S2b): share-lock the document's warehouses and items before the check, so an archive in flight
  -- finishes first (the check then sees it) and an archive started now waits for this post (its stock guard then sees the stock).
  perform 1 from public.stock_warehouses w where w.id in (d.warehouse_id, coalesce(d.to_warehouse_id, d.warehouse_id)) order by w.id for share;   -- mut:archivelock_wh_v2
  perform 1 from public.stock_items i where i.id in (select l.item_id from public.stock_document_lines l where l.document_id = d.id) order by i.id for share;   -- mut:archivelock_item_v2
  if exists (select 1 from public.stock_warehouses w where w.id in (d.warehouse_id, coalesce(d.to_warehouse_id, d.warehouse_id)) and w.archived_at is not null)
     or exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id where l.document_id = d.id and i.archived_at is not null) then
    raise exception 'STK_ARCHIVED: a warehouse or item on this document was archived' using errcode = 'P0001'; end if;
  -- Retagging is allowed until the first movement; recheck any draft lines under item/tag locks.
  perform 1 from public.stock_tags t where t.id in (select i.tag_id from public.stock_document_lines l join public.stock_items i on i.id = l.item_id where l.document_id = d.id) order by t.id for share;
  if exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id
             join public.stock_tags t on t.id = i.tag_id where l.document_id = d.id and t.zero_cost and l.unit_cost <> 0) then
    raise exception 'STK_ZERO_COST: a client-supplied item is received at cost 0' using errcode = 'P0001';
  end if;
  -- Lock live evidence before checking it, so an archive cannot race the posting.
  perform 1 from public.stock_document_files f where f.document_id = d.id and f.archived_at is null order by f.id for share;
  -- FR-SSW-022: a transfer of a zero-cost item whose tag says "paper required" posts only with a live attachment.
  if d.kind = 'transfer'
     and exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id
                   join public.stock_tags t on t.id = i.tag_id
                  where l.document_id = d.id and t.zero_cost and t.paper_required)                     -- mut:paper
     and not exists (select 1 from public.stock_document_files f join storage.objects o on o.bucket_id = 'stock-documents' and o.name = f.file_path where f.document_id = d.id and f.archived_at is null) then
    raise exception 'STK_PAPER_REQUIRED: attach the delivery paper before posting this client-supplied transfer' using errcode = 'P0001';
  end if;
  perform public.stock_apply(d, true);
  update public.stock_documents set status = 'Posted', posted_by = v_uid, posted_at = now() where id = d.id;
  if v_override then
    perform public.log_audit('stock.admin_post', d.org_id, v_uid, d.id, jsonb_build_object('kind', d.kind, 'warehouse_id', d.warehouse_id, 'number', d.number));
  end if;
end $$;

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
                 l.kind = 'issue' or (l.kind = 'transfer' and l.qty_delta < 0 and not coalesce(dw.kind in ('central', 'vendor'), false)) as m   -- mut:central_excl
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
