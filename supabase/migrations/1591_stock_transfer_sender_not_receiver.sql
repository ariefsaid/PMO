-- 1591_stock_transfer_sender_not_receiver.sql
-- drops: receive_stock_transfer no longer lets a guest signature skip the sender-is-not-receiver check, so the guest flag and its guarded call are removed.
-- A transfer's count is recorded by someone other than its sender, whoever signs: receive_stock_transfer runs the not-self-receive
-- check for an account signer and for a guest signer alike (the logged-in host is the one counting), and send_stock_transfer
-- refuses to name its own sender as the receiver. Both restated from their newest definitions (1308 plus the field-account guard of 1480).
-- Reversal: rollback/1591_stock_transfer_sender_not_receiver_down.sql.

create or replace function public.send_stock_transfer(p_header jsonb, p_lines jsonb, p_draft_id uuid default null,
                                                      p_client_request_id uuid default null) returns uuid
  language plpgsql volatile security definer set search_path = public as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); v_id uuid; v_from uuid; v_to uuid; v_wo uuid; v_note text; v_recv uuid; v_override boolean;
  v_draft public.stock_documents; v_lines jsonb; v_num text; v_transit uuid; t public.stock_transfers; v_doc uuid;
  v_dproj uuid; v_dkind text; v_wo_org uuid; v_wo_project uuid; v_wo_status public.work_order_status;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if v_org is null then raise exception 'STK_NOT_FOUND: no organisation' using errcode = 'P0001'; end if;
  if public.stock_transfer_mode_of(v_org) <> 'two_step' then
    raise exception 'STK_TWO_STEP_OFF: two-step transfers are not turned on for your organisation' using errcode = 'P0001'; end if;
  perform public.stock_assert_standalone(v_org);
  if p_client_request_id is not null then
    select x.id into v_id from public.stock_transfers x where x.org_id = v_org and x.sent_by = v_uid and x.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  v_recv := nullif(p_header->>'to_user_id', '')::uuid;
  v_note := nullif(btrim(p_header->>'note'), '');
  if p_draft_id is not null then                                                                         -- FR-TST-011
    select * into v_draft from public.stock_documents d where d.id = p_draft_id and d.org_id = v_org for update;
    if not found or v_draft.kind <> 'transfer' or v_draft.status <> 'Draft' or v_draft.two_step_id is not null then
      raise exception 'STK_NOT_FOUND: that is not a Draft transfer of your organisation' using errcode = 'P0001'; end if;
    v_from := v_draft.warehouse_id; v_to := v_draft.to_warehouse_id; v_wo := v_draft.work_order_id; v_note := coalesce(v_note, v_draft.note);
    select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'quantity', l.quantity) order by l.line_no) into v_lines
      from public.stock_document_lines l where l.document_id = v_draft.id;
  else
    v_from := (p_header->>'warehouse_id')::uuid; v_to := nullif(p_header->>'to_warehouse_id', '')::uuid;
    v_wo := nullif(p_header->>'work_order_id', '')::uuid;
    perform public.stock_validate_payload(v_org, 'transfer', jsonb_build_object('warehouse_id', v_from, 'to_warehouse_id', v_to), p_lines);
    select jsonb_agg(jsonb_build_object('item_id', e->>'item_id', 'quantity', (e->>'quantity')::numeric)) into v_lines from jsonb_array_elements(p_lines) e;
  end if;
  if exists (select 1 from public.stock_warehouses w where w.id in (v_from, v_to) and w.kind = 'transit') then
    raise exception 'STK_TRANSIT_LOCATION: a transit location is not a source or destination' using errcode = 'P0001'; end if;
  v_override := public.stock_assert_keeper(v_org, v_from, v_uid);
  if v_recv is not null and not exists (select 1 from public.profiles p where p.id = v_recv and p.org_id = v_org and p.status = 'active') then
    raise exception 'STK_NOT_FOUND: the named receiver is not an active member of your organisation' using errcode = 'P0001'; end if;
  if v_recv is not null and v_recv = v_uid then                                                          -- mut:sender_not_receiver
    raise exception 'STK_SELF_RECEIVE: the person who sends a transfer cannot be named as its receiver' using errcode = 'P0001'; end if;
  if v_wo is not null then                                                                               -- validated now so a receive never fails on it late
    select w.org_id, w.project_id, w.status into v_wo_org, v_wo_project, v_wo_status from public.work_orders w where w.id = v_wo;
    select dw.project_id, dw.kind into v_dproj, v_dkind from public.stock_warehouses dw where dw.id = v_to;
    if v_dproj is null or v_dkind not in ('site', 'yard', 'staging') then
      raise exception 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order' using errcode = '23514'; end if;
    if v_wo_org is distinct from v_org or v_wo_project is distinct from v_dproj then
      raise exception 'COST_WO_PROJECT: the work order belongs to another project' using errcode = '23514'; end if;
    if v_wo_status = 'Cancelled' then raise exception 'COST_WO_CANCELLED: the work order is cancelled' using errcode = '23514'; end if;
  end if;

  perform set_config('pmo.stock_system_write', 'on', true);
  v_num := public.next_procurement_doc_number(v_org, 'TST');
  insert into public.stock_warehouses (org_id, code, name, kind) values (v_org, 'TRN-' || v_num, 'In transit ' || v_num, 'transit') returning id into v_transit;
  insert into public.stock_transfers (org_id, number, from_warehouse_id, to_warehouse_id, transit_warehouse_id, work_order_id, to_user_id, note, sent_by, client_request_id)
  values (v_org, v_num, v_from, v_to, v_transit, v_wo, v_recv, v_note, v_uid, p_client_request_id) returning * into t;
  insert into public.stock_transfer_lines (org_id, transfer_id, line_no, item_id, qty_sent)
  select v_org, t.id, x.n::int, (x.e->>'item_id')::uuid, (x.e->>'quantity')::numeric from jsonb_array_elements(v_lines) with ordinality as x(e, n);
  perform set_config('pmo.stock_system_write', 'off', true);
  v_doc := public.stock_post_leg(t, 'transfer', v_from, v_transit, v_lines, null, null, p_draft_id);   -- mut:transit_carry (value carried to the transit location)
  update public.stock_transfers set send_document_id = v_doc where id = t.id returning * into t;
  if v_override then
    perform public.log_audit('stock.admin_post', v_org, v_uid, v_doc, jsonb_build_object('kind', 'transfer', 'warehouse_id', v_from, 'number', v_num));
  end if;
  perform public.log_audit('stock.transfer.send', v_org, v_uid, t.id, jsonb_build_object('number', v_num, 'from', v_from, 'to', v_to));
  return t.id;
end $$;

revoke all on function public.send_stock_transfer(jsonb, jsonb, uuid, uuid) from public, anon;
grant execute on function public.send_stock_transfer(jsonb, jsonb, uuid, uuid) to authenticated;

create or replace function public.receive_stock_transfer(p_transfer uuid, p_lines jsonb, p_confirmation jsonb default null) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  t public.stock_transfers; v_uid uuid := auth.uid(); e jsonb; l public.stock_transfer_lines; v_item record; v_c numeric; v_a numeric; v_r numeric;
  v_q text; v_reason text; v_acc jsonb := '[]'::jsonb; v_rej jsonb := '[]'::jsonb; v_open boolean; v_missing text; v_seen uuid[] := '{}';
begin
  perform public.assert_is_active_member();
  t := public.stock_lock_transfer(p_transfer, true);
  if t.status <> 'Sent' then raise exception 'STK_INVALID: this transfer was already received or cancelled' using errcode = 'P0001'; end if;
  if not public.stock_transfer_actor_ok(t, 'receive') then                                              -- mut:receiver_actor
    raise exception 'STK_NOT_RECEIVER: you do not keep the destination and the transfer is not addressed to you' using errcode = 'P0001'; end if;
  perform public.stock_assert_not_self_receive(t);                                                      -- mut:guest_self_receive (whoever signs, the logged-in person counting is not the sender)
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) <> (select count(*) from public.stock_transfer_lines x where x.transfer_id = t.id) then
    raise exception 'STK_INVALID: give a count for every line of the transfer' using errcode = 'P0001'; end if;
  for e in select x from jsonb_array_elements(p_lines) as x loop
    select * into l from public.stock_transfer_lines x where x.id = (e->>'line_id')::uuid and x.transfer_id = t.id for update;
    if not found or l.id = any (v_seen) then raise exception 'STK_INVALID: a count names an unknown or repeated line' using errcode = 'P0001'; end if;
    v_seen := v_seen || l.id;
    v_c := (e->>'counted')::numeric; v_a := (e->>'accepted')::numeric; v_r := coalesce((e->>'rejected')::numeric, v_c - v_a);
    if v_c is null or v_a is null or v_c <> round(v_c, 3) or v_a <> round(v_a, 3) or v_r <> round(v_r, 3) then
      raise exception 'STK_INVALID: a count needs counted and accepted quantities (3 decimals at most)' using errcode = 'P0001'; end if;
    select i.needs_quality_check, u.whole_only into v_item from public.stock_items i join public.stock_units u on u.id = i.unit_id where i.id = l.item_id;
    if v_item.whole_only and (v_c <> trunc(v_c) or v_a <> trunc(v_a)) then
      raise exception 'STK_FRACTION: this item is counted in whole units' using errcode = 'P0001'; end if;
    v_q := nullif(e->>'quality_result', '');
    if v_item.needs_quality_check then
      if v_q is null or v_q not in ('pass', 'fail') then
        raise exception 'STK_QUALITY: this item needs a quality check: record pass or fail' using errcode = 'P0001'; end if;
    else v_q := null; end if;
    v_reason := nullif(btrim(coalesce(e->>'reject_reason', '')), '');
    update public.stock_transfer_lines set qty_counted = v_c, qty_accepted = v_a, qty_rejected = v_r, reject_reason = case when v_r > 0 then v_reason end,
           quality_result = v_q where id = l.id;                                  -- the table checks bound counted, accepted + rejected and a failed quality check
    if v_a > 0 then v_acc := v_acc || jsonb_build_object('item_id', l.item_id, 'quantity', v_a); end if;
    if v_r > 0 then v_rej := v_rej || jsonb_build_object('item_id', l.item_id, 'quantity', v_r); end if;
  end loop;
  if p_confirmation is not null then
    perform public.stock_insert_handover(t, p_confirmation || jsonb_build_object('stage', 'receive'));
  end if;
  v_missing := public.stock_proof_missing(t.id);
  if v_missing is not null and public.stock_proof_timing_of(t.org_id) = 'before_posting' then           -- mut:proof_check
    raise exception 'STK_PROOF_REQUIRED: this transfer needs its proof (%) before it can be received', v_missing using errcode = 'P0001'; end if;
  if jsonb_array_length(v_acc) > 0 then perform public.stock_post_leg(t, 'transfer', t.transit_warehouse_id, t.to_warehouse_id, v_acc, t.work_order_id, null); end if;
  if jsonb_array_length(v_rej) > 0 then perform public.stock_post_leg(t, 'transfer', t.transit_warehouse_id, t.from_warehouse_id, v_rej, null, null); end if;
  select exists (select 1 from public.stock_transfer_lines x where x.transfer_id = t.id and x.qty_counted < x.qty_sent and x.short_resolution is null) into v_open;
  update public.stock_transfers set status = case when v_open then 'Received' else 'Closed' end, received_by = v_uid, received_at = now() where id = t.id;
  if not v_open then perform public.stock_close_transit(t); end if;
  perform public.log_audit('stock.transfer.receive', t.org_id, v_uid, t.id, jsonb_build_object('number', t.number, 'short_open', v_open));
end $$;

revoke all on function public.receive_stock_transfer(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.receive_stock_transfer(uuid, jsonb, jsonb) to authenticated;
