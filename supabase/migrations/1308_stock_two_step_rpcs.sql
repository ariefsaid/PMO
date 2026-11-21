-- 1308_stock_two_step_rpcs.sql — #2690 (spec docs/specs/stock-two-step-transfer.spec.md FR-TST-010..044). Proven by 1306_ and 1307_ pgTAP files.
--   Internal (no client grant): stock_post_leg, stock_transfer_actor_ok, stock_assert_not_self_receive, stock_insert_handover,
--   stock_proof_missing, stock_close_transit.
--   Client RPCs: send_stock_transfer, receive_stock_transfer, recall_stock_transfer, resolve_stock_transfer_shortfall, record_stock_handover.
-- ⚑ SINGLE WRITER holds: every ledger row is written by stock_write_entry, reached only through stock_apply_transfer or stock_post_leg's
--   write-off loop. The engine (0413) is not edited. Value is carried because each transfer has its own transit location.
-- Reversal: rollback/1308_stock_two_step_rpcs_down.sql.

-- §1 internal helpers ------------------------------------------------------------------------------------
-- Who may act on a transfer. side: 'send' = sender, a keeper of the source, Admin; 'receive' = a keeper of the destination, the named receiver, Admin;
-- 'any' = either side.
create or replace function public.stock_transfer_actor_ok(p_t public.stock_transfers, p_side text) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(
         coalesce(public.role_rank(public.auth_role()) >= 50, false)
      or (p_side in ('send', 'any') and (p_t.sent_by = auth.uid() or exists (select 1 from public.stock_warehouse_keepers k
            where k.org_id = p_t.org_id and k.user_id = auth.uid() and k.warehouse_id = p_t.from_warehouse_id)))
      or (p_side in ('receive', 'any') and (coalesce(p_t.to_user_id = auth.uid(), false) or exists (select 1 from public.stock_warehouse_keepers k
            where k.org_id = p_t.org_id and k.user_id = auth.uid() and k.warehouse_id = p_t.to_warehouse_id))), false) $$;

-- The sender may not receive their own transfer; an Admin may, and it is audited (FR-TST-024).
create or replace function public.stock_assert_not_self_receive(p_t public.stock_transfers) returns void
  language plpgsql volatile security definer set search_path = public as $$
begin
  if p_t.sent_by = auth.uid() then
    if not coalesce(public.role_rank(public.auth_role()) >= 50, false) then                        -- mut:self_receive
      raise exception 'STK_SELF_RECEIVE: the person who sent a transfer cannot be the one who receives it' using errcode = 'P0001'; end if;
    perform public.log_audit('stock.self_receive', p_t.org_id, auth.uid(), p_t.id, jsonb_build_object('number', p_t.number));
  end if;
end $$;

-- The proof the lines' tags still miss (comma list of rules), or null when every rule is met (FR-TST-040..053).
create or replace function public.stock_proof_missing(p_transfer uuid) returns text
  language plpgsql stable security definer set search_path = public as $$
declare v_rules text[]; v_paper boolean; v_app boolean; v_miss text[] := '{}';
begin
  select coalesce(array_agg(distinct tg.proof_required), '{}') into v_rules
    from public.stock_transfer_lines l join public.stock_items i on i.id = l.item_id join public.stock_tags tg on tg.id = i.tag_id
   where l.transfer_id = p_transfer and tg.proof_required <> 'none';
  select coalesce(bool_or(c.proof_type = 'paper'), false), coalesce(bool_or(c.proof_type = 'in_app' and c.stage = 'receive'), false)
    into v_paper, v_app from public.stock_handover_confirmations c where c.transfer_id = p_transfer;
  if 'paper' = any (v_rules) and not v_paper then v_miss := array_append(v_miss, 'paper'::text); end if;
  if 'confirmation' = any (v_rules) and not v_app then v_miss := array_append(v_miss, 'confirmation'::text); end if;
  if 'either' = any (v_rules) and not (v_paper or v_app) then v_miss := array_append(v_miss, 'either'::text); end if;
  return nullif(array_to_string(v_miss, ','), '');
end $$;

create or replace function public.stock_close_transit(p_t public.stock_transfers) returns void
  language plpgsql volatile security definer set search_path = public as $$
begin
  perform set_config('pmo.stock_system_write', 'on', true);
  update public.stock_warehouses set archived_at = now() where id = p_t.transit_warehouse_id and archived_at is null;
  perform set_config('pmo.stock_system_write', 'off', true);
end $$;

-- One leg through the unchanged engine: a Posted 'transfer' document (or a write-off 'adjustment' out of the transit location).
create or replace function public.stock_post_leg(p_t public.stock_transfers, p_kind text, p_from uuid, p_to uuid, p_lines jsonb,
                                                 p_wo uuid, p_reason text, p_doc uuid default null) returns uuid
  language plpgsql volatile security definer set search_path = public as $$
declare d public.stock_documents; l record; v_today date;
begin
  perform set_config('pmo.stock_system_write', 'on', true);
  v_today := public.stock_org_today(p_t.org_id);
  if p_doc is null then
    insert into public.stock_documents (org_id, number, kind, warehouse_id, to_warehouse_id, reason, occurred_on, created_by, two_step_id, work_order_id)
    values (p_t.org_id, public.next_procurement_doc_number(p_t.org_id, public.stock_doc_prefix(p_kind)), p_kind, p_from,
            case when p_kind = 'transfer' then p_to end, case when p_kind = 'adjustment' then p_reason end, v_today, auth.uid(), p_t.id,
            case when p_kind = 'transfer' then p_wo end)
    returning * into d;
    perform public.stock_insert_lines(d, p_lines);
  else                                                                                                  -- a material-request draft, sent in place
    update public.stock_documents set to_warehouse_id = p_to, work_order_id = null, two_step_id = p_t.id where id = p_doc returning * into d;
  end if;
  perform 1 from public.stock_warehouses w where w.id in (p_from, coalesce(p_to, p_from)) order by w.id for share;
  perform 1 from public.stock_items i where i.id in (select x.item_id from public.stock_document_lines x where x.document_id = d.id) order by i.id for share;
  if exists (select 1 from public.stock_warehouses w where w.id in (p_from, coalesce(p_to, p_from)) and w.archived_at is not null and w.kind <> 'transit')
     or exists (select 1 from public.stock_document_lines x join public.stock_items i on i.id = x.item_id where x.document_id = d.id and i.archived_at is not null) then
    raise exception 'STK_ARCHIVED: a location or item of this transfer was archived' using errcode = 'P0001'; end if;
  if p_kind = 'transfer' then
    perform public.stock_apply_transfer(d, true);                                                      -- the engine: out of p_from, into p_to, value carried
  else
    perform public.stock_lock_for_document(d);
    for l in select * from public.stock_document_lines where document_id = d.id order by line_no loop
      perform public.stock_write_entry(d, l.id, l.item_id, d.warehouse_id, -l.quantity, null, null, null, null);
    end loop;
  end if;
  update public.stock_documents set status = 'Posted', posted_by = auth.uid(), posted_at = now() where id = d.id;
  perform set_config('pmo.stock_system_write', 'off', true);                                          -- the system switch never outlives the RPC
  return d.id;
end $$;

-- Records a handover confirmation (FR-TST-040..044). The counts are copied from the transfer lines, never taken from the client.
create or replace function public.stock_insert_handover(p_t public.stock_transfers, p_conf jsonb) returns uuid
  language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_stage text; v_type text; v_kind text; v_name text; v_counts jsonb; v_uid uuid := auth.uid();
begin
  if p_conf is null or jsonb_typeof(p_conf) <> 'object' then raise exception 'STK_INVALID: the confirmation is malformed' using errcode = 'P0001'; end if;
  v_id := coalesce(nullif(p_conf->>'id', '')::uuid, gen_random_uuid());
  v_stage := p_conf->>'stage'; v_type := coalesce(nullif(p_conf->>'proof_type', ''), 'in_app'); v_kind := coalesce(nullif(p_conf->>'signer_kind', ''), 'account');
  if v_stage not in ('send', 'receive') or v_type not in ('in_app', 'paper') or v_kind not in ('account', 'guest') then
    raise exception 'STK_INVALID: the confirmation names an unknown stage, proof or signer' using errcode = 'P0001'; end if;
  if p_t.status = 'Cancelled' then raise exception 'STK_INVALID: a cancelled transfer takes no confirmation' using errcode = 'P0001'; end if;
  if v_stage = 'receive' and exists (select 1 from public.stock_transfer_lines l where l.transfer_id = p_t.id and l.qty_counted is null) then
    raise exception 'STK_INVALID: a receive confirmation needs the count first' using errcode = 'P0001'; end if;
  if v_kind = 'guest' then v_name := btrim(coalesce(p_conf->>'signer_name', ''));
  else select p.full_name into v_name from public.profiles p where p.id = v_uid; end if;
  select jsonb_agg(jsonb_build_object('line_id', l.id, 'item_id', l.item_id,
                                      'quantity', case when v_stage = 'send' then l.qty_sent else l.qty_counted end) order by l.line_no)
    into v_counts from public.stock_transfer_lines l where l.transfer_id = p_t.id;
  insert into public.stock_handover_confirmations (id, org_id, transfer_id, stage, proof_type, signer_kind, signer_name, signer_user_id, recorded_by,
                                                   counts, goods_photo_path, signer_photo_path, paper_photo_path)
  values (v_id, p_t.org_id, p_t.id, v_stage, v_type, v_kind, coalesce(v_name, ''), case when v_kind = 'account' then v_uid end, v_uid, v_counts,
          nullif(p_conf->>'goods_photo_path', ''), nullif(p_conf->>'signer_photo_path', ''), nullif(p_conf->>'paper_photo_path', ''));
  perform public.log_audit('stock.handover', p_t.org_id, v_uid, p_t.id,
            jsonb_build_object('confirmation_id', v_id, 'stage', v_stage, 'proof_type', v_type, 'signer_kind', v_kind));
  return v_id;
end $$;

-- Common entry checks of the four state-changing RPCs; returns the locked transfer.
create or replace function public.stock_lock_transfer(p_transfer uuid, p_need_two_step boolean) returns public.stock_transfers
  language plpgsql volatile security definer set search_path = public as $$
declare t public.stock_transfers;
begin
  perform public.assert_is_active_member();
  select * into t from public.stock_transfers x where x.id = p_transfer for update;
  if not found or t.org_id is distinct from public.auth_org_id() then
    raise exception 'STK_NOT_FOUND: the transfer is not in your organisation' using errcode = 'P0001'; end if;
  if p_need_two_step then
    perform public.stock_assert_standalone(t.org_id);
    if public.stock_transfer_mode_of(t.org_id) <> 'two_step' then
      raise exception 'STK_TWO_STEP_OFF: two-step transfers are not turned on for your organisation' using errcode = 'P0001'; end if;
  end if;
  return t;
end $$;

-- §2 client RPCs ---------------------------------------------------------------------------------------
create or replace function public.send_stock_transfer(p_header jsonb, p_lines jsonb, p_draft_id uuid default null,
                                                      p_client_request_id uuid default null) returns uuid
  language plpgsql volatile security definer set search_path = public as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); v_id uuid; v_from uuid; v_to uuid; v_wo uuid; v_note text; v_recv uuid; v_override boolean;
  v_draft public.stock_documents; v_lines jsonb; v_num text; v_transit uuid; t public.stock_transfers; v_doc uuid;
  v_dproj uuid; v_dkind text; v_wo_org uuid; v_wo_project uuid; v_wo_status public.work_order_status;
begin
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

create or replace function public.receive_stock_transfer(p_transfer uuid, p_lines jsonb, p_confirmation jsonb default null) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  t public.stock_transfers; v_uid uuid := auth.uid(); e jsonb; l public.stock_transfer_lines; v_item record; v_c numeric; v_a numeric; v_r numeric;
  v_q text; v_reason text; v_acc jsonb := '[]'::jsonb; v_rej jsonb := '[]'::jsonb; v_open boolean; v_missing text; v_seen uuid[] := '{}';
  v_guest boolean;
begin
  t := public.stock_lock_transfer(p_transfer, true);
  if t.status <> 'Sent' then raise exception 'STK_INVALID: this transfer was already received or cancelled' using errcode = 'P0001'; end if;
  if not public.stock_transfer_actor_ok(t, 'receive') then                                              -- mut:receiver_actor
    raise exception 'STK_NOT_RECEIVER: you do not keep the destination and the transfer is not addressed to you' using errcode = 'P0001'; end if;
  v_guest := p_confirmation is not null and coalesce(p_confirmation->>'signer_kind', 'account') = 'guest';
  if not v_guest then perform public.stock_assert_not_self_receive(t); end if;
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

create or replace function public.recall_stock_transfer(p_transfer uuid, p_reason text) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare t public.stock_transfers; v_lines jsonb;
begin
  t := public.stock_lock_transfer(p_transfer, true);
  if t.status <> 'Sent' then raise exception 'STK_INVALID: only a transfer still in transit can be recalled' using errcode = 'P0001'; end if;
  if not public.stock_transfer_actor_ok(t, 'send') then
    raise exception 'STK_NOT_KEEPER: only the sender, a keeper of the source or an Admin can recall this transfer' using errcode = 'P0001'; end if;
  if nullif(btrim(p_reason), '') is null or length(p_reason) > 500 then raise exception 'STK_INVALID: a recall needs a reason' using errcode = 'P0001'; end if;
  select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'quantity', l.qty_sent) order by l.line_no) into v_lines from public.stock_transfer_lines l where l.transfer_id = t.id;
  perform public.stock_post_leg(t, 'transfer', t.transit_warehouse_id, t.from_warehouse_id, v_lines, null, null);
  update public.stock_transfers set status = 'Cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = btrim(p_reason) where id = t.id;
  perform public.stock_close_transit(t);
  perform public.log_audit('stock.transfer.recall', t.org_id, auth.uid(), t.id, jsonb_build_object('number', t.number, 'reason', btrim(p_reason)));
end $$;

create or replace function public.resolve_stock_transfer_shortfall(p_line uuid, p_resolution text, p_reason text default null) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare t public.stock_transfers; l public.stock_transfer_lines; v_short numeric; v_lines jsonb; v_open boolean; v_tid uuid;
begin
  perform public.assert_is_active_member();
  select x.transfer_id into v_tid from public.stock_transfer_lines x where x.id = p_line and x.org_id = public.auth_org_id();
  if v_tid is null then raise exception 'STK_NOT_FOUND: the line is not in your organisation' using errcode = 'P0001'; end if;
  t := public.stock_lock_transfer(v_tid, true);
  select * into l from public.stock_transfer_lines x where x.id = p_line for update;
  if t.status <> 'Received' or l.qty_counted is null or l.qty_counted >= l.qty_sent or l.short_resolution is not null then
    raise exception 'STK_INVALID: there is no open shortfall on this line' using errcode = 'P0001'; end if;
  if p_resolution is null or p_resolution not in ('delivered', 'returned', 'written_off') then
    raise exception 'STK_INVALID: resolve a shortfall as delivered, returned or written_off' using errcode = 'P0001'; end if;
  if not public.stock_transfer_actor_ok(t, 'any') then
    raise exception 'STK_NOT_KEEPER: you do not keep either end of this transfer' using errcode = 'P0001'; end if;
  if p_resolution = 'written_off' and (not coalesce(public.role_rank(public.auth_role()) >= 50, false)) then                  -- mut:writeoff_admin
    raise exception 'STK_FORBIDDEN: only an Admin writes a shortfall off' using errcode = '42501'; end if;
  if p_resolution = 'written_off' and (nullif(btrim(p_reason), '') is null or length(p_reason) > 500) then
    raise exception 'STK_INVALID: a write-off needs a reason' using errcode = 'P0001'; end if;
  v_short := l.qty_sent - l.qty_counted;
  v_lines := jsonb_build_array(jsonb_build_object('item_id', l.item_id, 'quantity', v_short) ||
                               case when p_resolution = 'written_off' then jsonb_build_object('direction', 'out') else '{}'::jsonb end);
  if p_resolution = 'delivered' then perform public.stock_post_leg(t, 'transfer', t.transit_warehouse_id, t.to_warehouse_id, v_lines, t.work_order_id, null);
  elsif p_resolution = 'returned' then perform public.stock_post_leg(t, 'transfer', t.transit_warehouse_id, t.from_warehouse_id, v_lines, null, null);
  else perform public.stock_post_leg(t, 'adjustment', t.transit_warehouse_id, null, v_lines, null, btrim(p_reason)); end if;
  update public.stock_transfer_lines set short_resolution = p_resolution, short_reason = nullif(btrim(p_reason), ''), short_resolved_by = auth.uid(), short_resolved_at = now()
   where id = l.id;
  select exists (select 1 from public.stock_transfer_lines x where x.transfer_id = t.id and x.qty_counted < x.qty_sent and x.short_resolution is null) into v_open;
  if not v_open then
    update public.stock_transfers set status = 'Closed' where id = t.id;
    perform public.stock_close_transit(t);
  end if;
  perform public.log_audit(case when p_resolution = 'written_off' then 'stock.transfer.write_off' else 'stock.transfer.shortfall' end, t.org_id, auth.uid(), t.id,
            jsonb_build_object('number', t.number, 'line_id', l.id, 'resolution', p_resolution, 'quantity', v_short, 'reason', nullif(btrim(p_reason), '')));
end $$;

-- A confirmation given after the send or the receive (the paper arrived later, the receiver confirms later). FR-TST-044.
create or replace function public.record_stock_handover(p_transfer uuid, p_confirmation jsonb) returns uuid
  language plpgsql volatile security definer set search_path = public as $$
declare t public.stock_transfers; v_stage text;
begin
  t := public.stock_lock_transfer(p_transfer, false);
  v_stage := p_confirmation->>'stage';
  if v_stage not in ('send', 'receive') then raise exception 'STK_INVALID: the confirmation names a stage' using errcode = 'P0001'; end if;
  if not public.stock_transfer_actor_ok(t, case when v_stage = 'send' then 'send' else 'receive' end) then              -- mut:late_actor
    raise exception 'STK_NOT_RECEIVER: you cannot confirm this handover' using errcode = 'P0001'; end if;
  if v_stage = 'receive' and coalesce(p_confirmation->>'signer_kind', 'account') = 'account' and coalesce(p_confirmation->>'proof_type', 'in_app') = 'in_app' then
    perform public.stock_assert_not_self_receive(t);
  end if;
  return public.stock_insert_handover(t, p_confirmation);
end $$;

-- §3 ACL ---------------------------------------------------------------------------------------------------
revoke all on function
  public.stock_transfer_actor_ok(public.stock_transfers, text), public.stock_assert_not_self_receive(public.stock_transfers),
  public.stock_proof_missing(uuid), public.stock_close_transit(public.stock_transfers),
  public.stock_post_leg(public.stock_transfers, text, uuid, uuid, jsonb, uuid, text, uuid),
  public.stock_insert_handover(public.stock_transfers, jsonb), public.stock_lock_transfer(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.send_stock_transfer(jsonb, jsonb, uuid, uuid), public.receive_stock_transfer(uuid, jsonb, jsonb),
  public.recall_stock_transfer(uuid, text), public.resolve_stock_transfer_shortfall(uuid, text, text), public.record_stock_handover(uuid, jsonb)
  from public, anon;
grant execute on function public.send_stock_transfer(jsonb, jsonb, uuid, uuid), public.receive_stock_transfer(uuid, jsonb, jsonb),
  public.recall_stock_transfer(uuid, text), public.resolve_stock_transfer_shortfall(uuid, text, text), public.record_stock_handover(uuid, jsonb)
  to authenticated;
