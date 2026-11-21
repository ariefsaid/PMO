-- 1312_stock_wo_transfer_post.sql — #2691. post_stock_wo_transfer: a return from work order A and an issue to work order B under one document, atomically.
-- Proven by supabase/tests/1310_stock_wo_transfer.test.sql. The ledger is written only by the unchanged engine (stock_post_core -> stock_apply -> stock_write_entry).
-- Mutation notes (marked below): mut:wot_net_cap · mut:wot_same_project · mut:wot_location_kind · mut:wot_keeper · mut:wot_atomic · mut:wot_pair_check.
-- ── REVERSE: drop constraint trigger stock_wo_transfers_pair_check, functions check_stock_wo_transfer_pair(uuid) and post_stock_wo_transfer(jsonb, jsonb, uuid).

create or replace function public.post_stock_wo_transfer(p_header jsonb, p_lines jsonb, p_client_request_id uuid default null) returns uuid
  language plpgsql volatile security definer set search_path = public as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); v_id uuid; v_wh uuid; v_a uuid; v_b uuid; v_proj uuid; v_occ date; v_note text; v_disc uuid;
  a_org uuid; a_proj uuid; a_st public.work_order_status; b_org uuid; b_proj uuid; b_st public.work_order_status;
  v_wh_kind text; v_wh_proj uuid; v_wh_org uuid;
  e jsonb; s record; v_item uuid; v_q numeric; v_held numeric; v_left numeric; v_take numeric; v_seen uuid[] := '{}';
  v_ret_lines jsonb := '[]'::jsonb; v_iss_lines jsonb := '[]'::jsonb; v_simple jsonb := '[]'::jsonb;
  v_boq uuid; v_boqs uuid[]; v_discs text[] := '{}'; v_num text; v_wot public.stock_wo_transfers;
  v_ret public.stock_documents; v_iss public.stock_documents;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if v_org is null then raise exception 'STK_NOT_FOUND: no organisation' using errcode = 'P0001'; end if;
  if not public.stock_wo_transfers_on(v_org) then
    raise exception 'STK_WOT_OFF: work-order transfers are not turned on for your organisation' using errcode = 'P0001'; end if;
  if p_client_request_id is not null then                                                               -- replay returns the original
    select x.id into v_id from public.stock_wo_transfers x where x.org_id = v_org and x.created_by = v_uid and x.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  perform public.stock_assert_standalone(v_org);
  v_wh := nullif(p_header->>'warehouse_id', '')::uuid;
  v_a := nullif(p_header->>'from_work_order_id', '')::uuid;
  v_b := nullif(p_header->>'to_work_order_id', '')::uuid;
  v_disc := nullif(p_header->>'discipline_id', '')::uuid;
  v_note := nullif(btrim(p_header->>'note'), '');
  if v_wh is null or v_a is null or v_b is null then
    raise exception 'STK_INVALID: name the location and both work orders' using errcode = 'P0001'; end if;
  if v_a = v_b then raise exception 'STK_INVALID: the two work orders must be different' using errcode = 'P0001'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'STK_INVALID: a transfer needs 1 to 200 lines' using errcode = 'P0001'; end if;
  for e in select x from jsonb_array_elements(p_lines) as x loop                                        -- one line per item
    v_item := nullif(e->>'item_id', '')::uuid;
    if v_item is null or v_item = any (v_seen) then raise exception 'STK_INVALID: name each item once' using errcode = 'P0001'; end if;
    v_seen := v_seen || v_item;
    v_simple := v_simple || jsonb_build_array(jsonb_build_object('item_id', v_item, 'quantity', e->'quantity'));
  end loop;
  perform public.stock_validate_payload(v_org, 'return', jsonb_build_object('warehouse_id', v_wh), v_simple);   -- items, quantities, location exists and is not archived

  select w.org_id, w.project_id, w.status into a_org, a_proj, a_st from public.work_orders w where w.id = v_a;
  select w.org_id, w.project_id, w.status into b_org, b_proj, b_st from public.work_orders w where w.id = v_b;
  if a_org is distinct from v_org or b_org is distinct from v_org then
    raise exception 'STK_NOT_FOUND: a work order is not in your organisation' using errcode = 'P0001'; end if;
  if a_proj is distinct from b_proj then                                                                -- mut:wot_same_project
    raise exception 'STK_WOT_PROJECT: both work orders must belong to the same project' using errcode = 'P0001'; end if;
  v_proj := a_proj;
  if a_st = 'Cancelled' or b_st = 'Cancelled' then                                                      -- the existing rule, stated up front
    raise exception 'COST_WO_CANCELLED: the work order is cancelled' using errcode = '23514'; end if;
  select w.kind, w.project_id, w.org_id into v_wh_kind, v_wh_proj, v_wh_org from public.stock_warehouses w where w.id = v_wh;
  if v_wh_kind not in ('site', 'yard', 'staging') or v_wh_proj is distinct from v_proj or v_wh_org is distinct from v_org then   -- mut:wot_location_kind
    raise exception 'STK_WOT_LOCATION: the stock must sit at a site, yard or staging location of the work orders'' project' using errcode = 'P0001'; end if;
  perform public.stock_assert_keeper(v_org, v_wh, v_uid);                                               -- mut:wot_keeper (Admin override is audited by the two posts)
  v_occ := coalesce(nullif(p_header->>'occurred_on', '')::date, public.stock_org_today(v_org));
  perform public.stock_assert_dates(v_org, v_occ);

  -- Serialise against other moves and returns of A's issue lines (the engine's lock mode), then allocate oldest first.
  perform 1 from public.stock_document_lines sl join public.stock_documents sd on sd.id = sl.document_id
   where sd.kind = 'issue' and sd.status = 'Posted' and sd.work_order_id = v_a and sd.org_id = v_org and sl.item_id = any (v_seen)
   order by sl.id for no key update of sl;
  for e in select x from jsonb_array_elements(p_lines) as x loop
    v_item := (e->>'item_id')::uuid;  v_q := (e->>'quantity')::numeric;
    select coalesce(sum(s2.remaining_qty), 0) into v_held from public.stock_wo_issue_sources(v_org, v_a, v_item) s2;
    if v_q > v_held then                                                                                -- mut:wot_net_cap
      raise exception 'STK_WOT_EXCEEDS: the work order holds % of this item, requested %', trim_scale(v_held)::text, trim_scale(v_q)::text
        using errcode = 'P0001', detail = jsonb_build_object('held', trim_scale(v_held)::text, 'requested', trim_scale(v_q)::text)::text; end if;
    v_left := v_q;  v_boqs := '{}';
    for s in select * from public.stock_wo_issue_sources(v_org, v_a, v_item) loop
      exit when v_left <= 0;
      v_take := least(v_left, s.remaining_qty);
      v_ret_lines := v_ret_lines || jsonb_build_array(jsonb_build_object('item_id', v_item, 'quantity', v_take, 'source_line_id', s.source_line_id));
      v_boqs := v_boqs || s.boq_item_id;
      v_discs := v_discs || coalesce(s.discipline_id::text, '-');
      v_left := v_left - v_take;
    end loop;
    v_boq := coalesce(nullif(e->>'boq_item_id', '')::uuid,
                      case when (select count(distinct x) from unnest(v_boqs) x) = 1 then v_boqs[1] end);
    if v_boq is null then
      raise exception 'STK_BOQ_MISMATCH: name the work item for each line (the returned lines have more than one)' using errcode = 'P0001'; end if;
    v_iss_lines := v_iss_lines || jsonb_build_array(jsonb_build_object('item_id', v_item, 'quantity', v_q, 'boq_item_id', v_boq));
  end loop;

  v_num := public.next_procurement_doc_number(v_org, 'WOT');
  insert into public.stock_wo_transfers (org_id, number, project_id, warehouse_id, from_work_order_id, to_work_order_id, note, occurred_on, client_request_id, created_by)
  values (v_org, v_num, v_proj, v_wh, v_a, v_b, v_note, v_occ, p_client_request_id, v_uid) returning * into v_wot;

  perform set_config('pmo.stock_system_write', 'on', true);                                             -- lets the two linked drafts carry wo_transfer_id
  insert into public.stock_documents (org_id, number, kind, warehouse_id, project_id, work_order_id, discipline_id, note, occurred_on, created_by, wo_transfer_id)
  values (v_org, public.next_procurement_doc_number(v_org, public.stock_doc_prefix('return')), 'return', v_wh, v_proj, v_a,
          case when (select count(distinct x) from unnest(v_discs) x) = 1 and v_discs[1] <> '-' then v_discs[1]::uuid end, v_note, v_occ, v_uid, v_wot.id)
  returning * into v_ret;
  perform public.stock_insert_lines(v_ret, v_ret_lines);
  insert into public.stock_documents (org_id, number, kind, warehouse_id, project_id, work_order_id, discipline_id, note, occurred_on, created_by, wo_transfer_id)
  values (v_org, public.next_procurement_doc_number(v_org, public.stock_doc_prefix('issue')), 'issue', v_wh, v_proj, v_b, v_disc, v_note, v_occ, v_uid, v_wot.id)
  returning * into v_iss;
  perform public.stock_insert_lines(v_iss, v_iss_lines);
  perform set_config('pmo.stock_system_write', 'off', true);                                            -- never outlives the linking; the posts below run without it

  perform public.stock_post_core(v_ret.id);                                                             -- return first: the issue then takes from the stock it put back
  perform public.stock_post_core(v_iss.id);                                                             -- mut:wot_atomic (an error here must roll the return back too)
  perform public.log_audit('stock.wo_transfer', v_org, v_uid, v_wot.id,
    jsonb_build_object('number', v_num, 'from_work_order_id', v_a, 'to_work_order_id', v_b, 'warehouse_id', v_wh));
  return v_wot.id;
end $$;

-- The move is whole or absent: at commit, one Posted return naming A and one Posted issue naming B at the same location and project,
-- equal quantity per item, and net zero ledger quantity at the location (FR-WOT-008).
create or replace function public.check_stock_wo_transfer_pair(p_wot uuid) returns void
  language plpgsql stable security definer set search_path = public as $$
declare t public.stock_wo_transfers; v_ok boolean;
begin
  select * into t from public.stock_wo_transfers where id = p_wot;
  v_ok := (select count(*) = 2 and count(*) filter (where d.kind = 'return' and d.work_order_id = t.from_work_order_id) = 1
                and count(*) filter (where d.kind = 'issue' and d.work_order_id = t.to_work_order_id) = 1
                and bool_and(d.status = 'Posted' and d.warehouse_id = t.warehouse_id and d.project_id = t.project_id and d.org_id = t.org_id)
            from public.stock_documents d where d.wo_transfer_id = p_wot);
  if coalesce(v_ok, false) then
    v_ok := not exists (                                                                                -- equal quantity per item, net zero at the location
      select 1 from (select l.item_id, sum(case when d.kind = 'return' then l.quantity else -l.quantity end) as diff
                       from public.stock_document_lines l join public.stock_documents d on d.id = l.document_id
                      where d.wo_transfer_id = p_wot group by l.item_id) q where q.diff <> 0)
            and not exists (select 1 from public.stock_ledger g join public.stock_documents d on d.id = g.document_id
                             where d.wo_transfer_id = p_wot group by g.item_id, g.warehouse_id having sum(g.qty_delta) <> 0);
  end if;
  if not coalesce(v_ok, false) then                                                                     -- mut:wot_pair_check
    raise exception 'STK_WOT_INCOMPLETE: a work-order transfer needs its posted return and its posted issue, equal and at one location' using errcode = 'P0001'; end if;
end $$;
create or replace function public.trg_stock_wo_transfer_pair() returns trigger
  language plpgsql security definer set search_path = public as $$
begin perform public.check_stock_wo_transfer_pair(new.id); return null; end $$;
revoke all on function public.check_stock_wo_transfer_pair(uuid), public.trg_stock_wo_transfer_pair() from public, anon, authenticated;
create constraint trigger stock_wo_transfers_pair_check after insert on public.stock_wo_transfers
  deferrable initially deferred for each row execute function public.trg_stock_wo_transfer_pair();

revoke all on function public.post_stock_wo_transfer(jsonb, jsonb, uuid) from public, anon;
grant execute on function public.post_stock_wo_transfer(jsonb, jsonb, uuid) to authenticated;
