-- 1309_stock_proof_status_and_reorder.sql — #2690 (spec docs/specs/stock-two-step-transfer.spec.md FR-TST-053, 056, 061, 070).
-- Proven by supabase/tests/1309_stock_movement_proof_status.test.sql (and 1305 / 1306 for the timing rule).
--   §1 stock_post_core: the 1030 body with ONE added clause: the one-step paper block applies only while the organisation's proof timing is
--      before_posting (default, so identical to today). Under may_follow the transfer posts and the paper may follow.
--   §2 get_reorder_suggestions: a send into a transit location counts as usage by the transfer's final destination kind; a leg back to the source undoes it.
--   §3 get_stock_movement_proof_status: the single read of outstanding and complete proof per movement (what #2689 lists from).
-- ── REVERSE (rollback/1309_stock_proof_status_and_reorder_down.sql): restore the 1030 stock_post_core and the 1300 get_reorder_suggestions; drop the function.

-- §1 -----------------------------------------------------------------------------------------------------
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
     and public.stock_proof_timing_of(d.org_id) = 'before_posting'                                   -- mut:timing_block
     and not exists (select 1 from public.stock_document_files f join storage.objects o on o.bucket_id = 'stock-documents' and o.name = f.file_path where f.document_id = d.id and f.archived_at is null) then
    raise exception 'STK_PAPER_REQUIRED: attach the delivery paper before posting this client-supplied transfer' using errcode = 'P0001';
  end if;
  perform public.stock_apply(d, true);
  update public.stock_documents set status = 'Posted', posted_by = v_uid, posted_at = now() where id = d.id;
  if v_override then
    perform public.log_audit('stock.admin_post', d.org_id, v_uid, d.id, jsonb_build_object('kind', d.kind, 'warehouse_id', d.warehouse_id, 'number', d.number));
  end if;
end $$;

-- §2 -----------------------------------------------------------------------------------------------------
-- get_reorder_suggestions (1300): usage = issues + transfers out whose FINAL destination is not central or vendor, less legs back to the source.
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
  select coalesce(sum(case when x.m or x.kind = 'return' or x.ret then -x.qty_delta else 0 end), 0), count(*) filter (where x.m)
    into v_usage, v_moves
    from (select l.kind, l.qty_delta,
                 l.kind = 'issue' or (l.kind = 'transfer' and l.qty_delta < 0 and not coalesce(coalesce(fw.kind, dw.kind) in ('central', 'vendor'), false)) as m,   -- mut:central_excl (a send into transit counts by the transfer's final destination)
                 l.kind = 'transfer' and l.qty_delta > 0 and ts.id is not null and d.to_warehouse_id = ts.from_warehouse_id
                   and not coalesce(fw.kind in ('central', 'vendor'), false) as ret                                                      -- a rejected, returned or recalled leg back to the source undoes that usage
            from public.stock_ledger l
            join public.stock_documents d on d.id = l.document_id
            left join public.stock_transfers ts on ts.id = d.two_step_id
            left join public.stock_warehouses fw on fw.id = ts.to_warehouse_id
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

-- §3 ---------------------------------------------------------------------------------------------------
-- One row per movement that carries a proof rule: every Posted one-step transfer of an item whose tag requires paper, and every two-step transfer
-- (Sent, Received, Closed) whose tags require any proof. Complete is computed from the live evidence, so an archived paper reads outstanding again.
-- One-step transfers can only be proved by paper; confirmation and either rules apply to two-step transfers.
create or replace function public.get_stock_movement_proof_status(p_status text default null, p_from date default null, p_to date default null)
  returns table (
    movement_id uuid, movement_number text, mode text, transfer_status text, movement_date date,
    from_warehouse_id uuid, from_warehouse_name text, to_warehouse_id uuid, to_warehouse_name text,
    tag_rules text[], required_proof text, has_paper boolean, has_confirmation boolean,
    proof_status text, missing text, proof_completed_at timestamptz)
  language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_org uuid;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if p_status is not null and p_status not in ('outstanding', 'complete') then
    raise exception 'STK_INVALID: the proof status is outstanding or complete' using errcode = 'P0001'; end if;
  return query
  with one as (
    select d.id as movement_id, d.number as movement_number, 'one_step'::text as mode, d.status as transfer_status, d.occurred_on as movement_date,
           d.warehouse_id as from_id, d.to_warehouse_id as to_id, array['paper']::text[] as tag_rules,
           exists (select 1 from public.stock_document_files f join storage.objects o on o.bucket_id = 'stock-documents' and o.name = f.file_path
                    where f.document_id = d.id and f.archived_at is null) as has_paper,
           false as has_confirmation,
           (select max(f.created_at) from public.stock_document_files f join storage.objects o on o.bucket_id = 'stock-documents' and o.name = f.file_path
             where f.document_id = d.id and f.archived_at is null) as last_evidence
      from public.stock_documents d
     where d.org_id = v_org and d.kind = 'transfer' and d.status = 'Posted' and d.two_step_id is null
       and exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id join public.stock_tags t on t.id = i.tag_id
                    where l.document_id = d.id and t.zero_cost and t.paper_required)
  ), two as (
    select t.id as movement_id, t.number as movement_number, 'two_step'::text as mode, t.status as transfer_status, sd.occurred_on as movement_date,
           t.from_warehouse_id as from_id, t.to_warehouse_id as to_id,
           (select array_agg(distinct tg.proof_required order by tg.proof_required) from public.stock_transfer_lines l
              join public.stock_items i on i.id = l.item_id join public.stock_tags tg on tg.id = i.tag_id
             where l.transfer_id = t.id and tg.proof_required <> 'none') as tag_rules,
           exists (select 1 from public.stock_handover_confirmations c where c.transfer_id = t.id and c.proof_type = 'paper') as has_paper,
           exists (select 1 from public.stock_handover_confirmations c where c.transfer_id = t.id and c.proof_type = 'in_app' and c.stage = 'receive') as has_confirmation,
           (select max(c.confirmed_at) from public.stock_handover_confirmations c where c.transfer_id = t.id) as last_evidence
      from public.stock_transfers t join public.stock_documents sd on sd.id = t.send_document_id
     where t.org_id = v_org and t.status <> 'Cancelled'
  ), u as (
    select * from one union all select * from two where tag_rules is not null
  )
  select x.movement_id, x.movement_number, x.mode, x.transfer_status, x.movement_date,
         x.from_id, fw.name, x.to_id, tw.name,
         x.tag_rules, case when cardinality(x.tag_rules) = 1 then x.tag_rules[1] else 'mixed' end,
         x.has_paper, x.has_confirmation,
         case when m.missing is null then 'complete' else 'outstanding' end, m.missing,
         case when m.missing is null then x.last_evidence end
    from u x
    join public.stock_warehouses fw on fw.id = x.from_id
    join public.stock_warehouses tw on tw.id = x.to_id
    cross join lateral (
      select nullif(array_to_string(array_remove(array[
          case when 'paper' = any (x.tag_rules) and not x.has_paper then 'paper' end,
          case when 'confirmation' = any (x.tag_rules) and not x.has_confirmation then 'confirmation' end,
          case when 'either' = any (x.tag_rules) and not (x.has_paper or x.has_confirmation) then 'either' end], null), ','), '') as missing) m
   where (p_from is null or x.movement_date >= p_from) and (p_to is null or x.movement_date <= p_to)
     and (p_status is null or p_status = case when m.missing is null then 'complete' else 'outstanding' end)
   order by x.movement_date desc, x.movement_number desc;
end $$;
revoke all on function public.get_stock_movement_proof_status(text, date, date) from public, anon;
grant execute on function public.get_stock_movement_proof_status(text, date, date) to authenticated;
