-- 1901_opening_stock_history_rpcs.sql — opening stock with movement history (docs/specs/opening-stock-history.spec.md, FR-OSH-001..013).
-- drops: load_stock_opening posts through opening_post_location now (the document, line, write and audit statements moved into it unchanged
--   in effect, so the old inline copies are gone); every guard line before the posting stays. Existing proof: supabase/tests/opening_balances.test.sql.
-- ⚑ One posting path: opening_post_location is the only code here that writes an opening document, and it writes the ledger only through
--   stock_write_entry (scripts/stock-single-writer.test.mjs). Counted lines (load_stock_opening) and dated movements (load_stock_opening_history) share it.
-- ⚑ Preview and confirm run one validator, opening_history_plan, so the preview is the oracle for the confirm.
-- ⚑ Zero cost (FR-OSH-004): a blank cost on a client-supplied item is stored as 0; a non-zero cost is refused (the 1029 trigger is the second layer).
-- Bodies restated: load_stock_opening and reverse_opening_balance from 1046, plus the field-account guard 1530 added to both bodies.
-- `-- mut:<id>` marks the line the mutation check breaks (supabase/tests/1900_opening_stock_history.test.sql header).
-- Reversal: rollback/1901_opening_stock_history_rpcs_down.sql.

-- §1 the validator and running balance (internal; no client grant) -----------------------------------------------------
create or replace function public.opening_history_plan(p_org uuid, p_as_of date, p_lines jsonb)
  returns table (row_no integer, verdict text, message text, location_code text, item_code text, warehouse_id uuid, item_id uuid,
                 occurred_on date, direction text, quantity numeric, unit_cost numeric, reference text, zero_cost boolean,
                 run_qty numeric, run_val numeric)
  language plpgsql stable security definer set search_path = public as $$
declare
  r record; v_loc text; v_itm text; v_dir text; v_ref text; v_date date; v_q numeric; v_c numeric; v_wh uuid; v_it uuid;
  v_zero boolean; v_whole boolean; v_msg text; v_key text; v_st jsonb := '{}'::jsonb; v_sq numeric; v_sv numeric; v_dv numeric;
  v_block jsonb := '{}'::jsonb; v_b text;
begin
  -- Rows are applied in date order, ties in file order; a row that is not a dated object sorts last and is refused.
  for r in select t.n::integer as n, t.e as e from jsonb_array_elements(p_lines) with ordinality t(e, n)
            order by case when jsonb_typeof(t.e) = 'object' and (t.e->>'date') ~ '^\d{4}-\d{2}-\d{2}$' then t.e->>'date' end nulls last, t.n
  loop
    v_msg := null; v_date := null; v_q := null; v_c := null; v_wh := null; v_it := null; v_zero := null; v_whole := false;
    v_dir := null; v_ref := null; v_loc := null; v_itm := null; v_key := null; v_sq := null; v_sv := null;
    if jsonb_typeof(r.e) is distinct from 'object' then
      v_msg := 'OPN_ROW_INVALID: row ' || r.n;
    else
      v_loc := nullif(btrim(r.e->>'location'), ''); v_itm := nullif(btrim(r.e->>'item'), '');
      v_dir := lower(btrim(coalesce(r.e->>'direction', ''))); v_ref := nullif(btrim(r.e->>'reference'), '');
      begin
        v_date := (r.e->>'date')::date; v_q := (r.e->>'quantity')::numeric; v_c := nullif(btrim(coalesce(r.e->>'unit_cost', '')), '')::numeric;
      exception when others then v_msg := 'OPN_ROW_INVALID: row ' || r.n; end;
      if v_msg is null and (v_loc is null or v_itm is null or v_dir not in ('in', 'out') or v_date is null or v_q is null
          or v_q <= 0 or v_q >= 100000000000 or v_q <> round(v_q, 3)
          or (v_c is not null and (v_c < 0 or v_c >= 10000000000 or v_c <> round(v_c, 4)))
          or (v_ref is not null and length(v_ref) > 100)) then
        v_msg := 'OPN_ROW_INVALID: row ' || r.n; end if;
      if v_msg is null then
        select w.id into v_wh from public.stock_warehouses w where w.org_id = p_org and lower(w.code) = lower(v_loc) and w.archived_at is null;
        if v_wh is null then v_msg := 'OPN_UNKNOWN_LOCATION: row ' || r.n; end if;
      end if;
      if v_msg is null then
        select i.id, coalesce(t.zero_cost, false), u.whole_only into v_it, v_zero, v_whole
          from public.stock_items i join public.stock_units u on u.id = i.unit_id left join public.stock_tags t on t.id = i.tag_id
         where i.org_id = p_org and lower(i.code) = lower(v_itm) and i.archived_at is null;
        if v_it is null then v_msg := 'OPN_UNKNOWN_ITEM: row ' || r.n;
        elsif v_whole and v_q <> trunc(v_q) then v_msg := 'OPN_ROW_INVALID: row ' || r.n; end if;
      end if;
      if v_msg is null and v_date > p_as_of then v_msg := 'OPN_DATE_AFTER_GO_LIVE: row ' || r.n; end if;
      if v_msg is null then
        v_b := v_wh::text;
        if not (v_block ? v_b) then
          v_block := v_block || jsonb_build_object(v_b, case
            when exists (select 1 from public.opening_balances o where o.warehouse_id = v_wh and o.reversed_at is null) then 'A'
            when public.opening_location_has_movement(p_org, v_wh, null) then 'M' else '' end);
        end if;
        if v_block->>v_b = 'A' then v_msg := 'OPN_ALREADY_LOADED: row ' || r.n;
        elsif v_block->>v_b = 'M' then v_msg := 'OPN_LOCATION_MOVED: row ' || r.n; end if;
      end if;
      if v_msg is null then
        v_key := v_wh::text || '|' || v_it::text;
        v_sq := coalesce((v_st->v_key->>'q')::numeric, 0); v_sv := coalesce((v_st->v_key->>'v')::numeric, 0);
        if v_dir = 'in' then
          if v_zero then
            if coalesce(v_c, 0) <> 0 then v_msg := 'STK_ZERO_COST: row ' || r.n;                      -- mut:zero_cost
            else v_c := 0; end if;
          elsif v_c is null then v_msg := 'OPN_COST_NEEDED: row ' || r.n; end if;
          if v_msg is null then v_sq := v_sq + v_q; v_sv := v_sv + round(v_q * v_c, 2); end if;
        else
          v_c := null;
          if v_q > v_sq then v_msg := 'OPN_OVER_ISSUE: row ' || r.n;                                  -- mut:over_issue
          else
            v_dv := case when v_q = v_sq then v_sv else round(v_q * v_sv / v_sq, 2) end;
            v_sq := v_sq - v_q; v_sv := v_sv - v_dv;
          end if;
        end if;
        if v_msg is null then v_st := jsonb_set(v_st, array[v_key], jsonb_build_object('q', v_sq, 'v', v_sv), true); end if;
      end if;
    end if;
    row_no := r.n; verdict := case when v_msg is null then 'ok' else 'refused' end; message := v_msg;
    location_code := v_loc; item_code := v_itm; warehouse_id := v_wh; item_id := v_it; occurred_on := v_date; direction := v_dir;
    quantity := v_q; unit_cost := v_c; reference := v_ref; zero_cost := v_zero;
    run_qty := case when v_key is null then null else coalesce((v_st->v_key->>'q')::numeric, 0) end;
    run_val := case when v_key is null then null else coalesce((v_st->v_key->>'v')::numeric, 0) end;
    return next;
  end loop;
end $$;

-- §2 the one posting routine (internal) -----------------------------------------------------------------------------
-- p_counted true: p_rows are the balance lines of load_stock_opening ({item_id, counted_quantity, unit_cost}).
-- p_counted false: p_rows are plan rows ({item_id, direction, quantity, unit_cost, occurred_on, reference}) in posting order.
create or replace function public.opening_post_location(p_org uuid, p_warehouse uuid, p_as_of date, p_rows jsonb, p_note text, p_counted boolean, p_request uuid)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_doc public.stock_documents; v_e public.stock_documents; v_id uuid := gen_random_uuid(); l record;
begin
  insert into public.stock_documents (org_id, number, kind, warehouse_id, note, occurred_on, created_by)
  values (p_org, public.next_procurement_doc_number(p_org, public.stock_doc_prefix('opening')), 'opening', p_warehouse,
          coalesce(nullif(btrim(p_note), ''), 'Opening balance at go-live'), p_as_of, v_uid)
  returning * into v_doc;
  if p_counted then
    insert into public.stock_document_lines (org_id, document_id, line_no, item_id, counted_quantity, unit_cost)
    select p_org, v_doc.id, t.n::int, (t.e->>'item_id')::uuid, (t.e->>'counted_quantity')::numeric, (t.e->>'unit_cost')::numeric
      from jsonb_array_elements(p_rows) with ordinality t(e, n);
  else
    insert into public.stock_document_lines (org_id, document_id, line_no, item_id, quantity, direction, unit_cost, occurred_on, reference)
    select p_org, v_doc.id, t.n::int, (t.e->>'item_id')::uuid, (t.e->>'quantity')::numeric, t.e->>'direction',
           case when t.e->>'direction' = 'in' then (t.e->>'unit_cost')::numeric end, (t.e->>'occurred_on')::date, t.e->>'reference'
      from jsonb_array_elements(p_rows) with ordinality t(e, n);
  end if;
  perform public.stock_lock_for_document(v_doc);
  for l in select * from public.stock_document_lines where document_id = v_doc.id order by line_no loop
    if p_counted then
      if l.counted_quantity > 0 then
        perform public.stock_write_entry(v_doc, l.id, l.item_id, p_warehouse, l.counted_quantity, round(l.counted_quantity * l.unit_cost, 2), null, null, null);
      end if;
    else
      v_e := v_doc; v_e.occurred_on := l.occurred_on;                                             -- the ledger row carries the movement's own date
      if l.direction = 'in' then
        perform public.stock_write_entry(v_e, l.id, l.item_id, p_warehouse, l.quantity, round(l.quantity * l.unit_cost, 2), null, null, null);
      else
        perform public.stock_write_entry(v_e, l.id, l.item_id, p_warehouse, -l.quantity, null, null, null, null);
      end if;
    end if;
  end loop;
  update public.stock_documents set status = 'Posted', posted_by = v_uid, posted_at = now() where id = v_doc.id;
  insert into public.opening_balances (id, org_id, kind, as_of, warehouse_id, stock_document_id, note, loaded_by, client_request_id)
  values (v_id, p_org, 'stock', p_as_of, p_warehouse, v_doc.id, nullif(btrim(p_note), ''), v_uid, p_request);
  perform public.log_audit('opening_balance.load', p_org, v_uid, v_id, jsonb_build_object('kind', 'stock', 'warehouse_id', p_warehouse,
    'as_of', p_as_of, 'stock_document_id', v_doc.id, 'number', v_doc.number,
    case when p_counted then 'lines' else 'history_rows' end, case when p_counted then p_rows else to_jsonb(jsonb_array_length(p_rows)) end));
  return v_id;
end $$;

-- §3 the two client entry points ---------------------------------------------------------------------------------------
create or replace function public.preview_stock_opening_history(p_as_of date, p_lines jsonb)
  returns table (row_no integer, verdict text, message text, location_code text, item_code text, warehouse_id uuid, item_id uuid,
                 occurred_on date, direction text, quantity numeric, unit_cost numeric, reference text, zero_cost boolean,
                 run_qty numeric, run_val numeric)
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_n integer;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then                                                   -- mut:admin
    raise exception 'OPN_NOT_ADMIN: only an Admin loads opening stock' using errcode = '42501'; end if;
  v_n := case when jsonb_typeof(p_lines) = 'array' then jsonb_array_length(p_lines) else 0 end;
  if v_n < 1 or v_n > 5000 then raise exception 'OPN_TOO_MANY_ROWS: a file holds 1 to 5000 rows' using errcode = '23514'; end if;
  if p_as_of is null or p_as_of > public.stock_org_today(v_org) then
    raise exception 'the go-live date is required and cannot be in the future' using errcode = '23514'; end if;
  if exists (select 1 from public.opening_balances o where o.org_id = v_org and o.reversed_at is null and o.as_of <> p_as_of) then
    raise exception 'every opening balance is dated at the one go-live date: %', (select min(o.as_of) from public.opening_balances o where o.org_id = v_org and o.reversed_at is null)
      using errcode = '23514'; end if;
  perform public.assert_feature_on(v_org, 'stock');
  perform public.stock_assert_standalone(v_org);
  return query select p.* from public.opening_history_plan(v_org, p_as_of, p_lines) p order by p.row_no;
end $$;

create or replace function public.load_stock_opening_history(p_as_of date, p_lines jsonb, p_client_request_id uuid, p_note text default null)
  returns setof uuid language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_n integer; v_plan jsonb; v_msg text; w record; v_ids uuid[] := '{}';
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then                                                   -- mut:admin
    raise exception 'OPN_NOT_ADMIN: only an Admin loads opening stock' using errcode = '42501'; end if;
  if p_client_request_id is null then raise exception 'a request id is required' using errcode = '23514'; end if;
  v_n := case when jsonb_typeof(p_lines) = 'array' then jsonb_array_length(p_lines) else 0 end;
  if v_n < 1 or v_n > 5000 then raise exception 'OPN_TOO_MANY_ROWS: a file holds 1 to 5000 rows' using errcode = '23514'; end if;
  perform public.opening_assert_load(v_org, p_as_of);                                                   -- org lock, go-live date rules
  perform public.assert_feature_on(v_org, 'stock');
  perform public.stock_assert_standalone(v_org);
  -- The same file again: the openings it made are returned, nothing is posted twice (FR-OSH-006).
  if exists (select 1 from public.opening_balances o where o.org_id = v_org and o.client_request_id = p_client_request_id) then   -- mut:idempotent
    return query select o.id from public.opening_balances o where o.org_id = v_org and o.client_request_id = p_client_request_id order by o.warehouse_id;
    return;
  end if;
  perform 1 from public.stock_warehouses sw where sw.org_id = v_org
     and lower(sw.code) in (select lower(btrim(e->>'location')) from jsonb_array_elements(p_lines) e) order by sw.id for update;
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_plan from public.opening_history_plan(v_org, p_as_of, p_lines) p;
  select x.message into v_msg from jsonb_to_recordset(v_plan) x(row_no integer, verdict text, message text)
   where x.verdict = 'refused' order by x.row_no limit 1;
  if v_msg is not null then raise exception '%', v_msg using errcode = 'P0001'; end if;                -- nothing posts when any row is refused
  for w in select x.warehouse_id as wh,
                  jsonb_agg(jsonb_build_object('item_id', x.item_id, 'direction', x.direction, 'quantity', x.quantity, 'unit_cost', x.unit_cost,
                                               'occurred_on', x.occurred_on, 'reference', x.reference) order by x.occurred_on, x.row_no) as rows
             from jsonb_to_recordset(v_plan) x(row_no integer, warehouse_id uuid, item_id uuid, occurred_on date, direction text, quantity numeric, unit_cost numeric, reference text)
            group by x.warehouse_id order by x.warehouse_id
  loop
    v_ids := v_ids || public.opening_post_location(v_org, w.wh, p_as_of, w.rows, p_note, false, p_client_request_id);
  end loop;
  return query select unnest(v_ids);
end $$;

-- §4 restated bodies (1046 + the 1530 field-account guard) ---------------------------------------------------------------
create or replace function public.load_stock_opening(p_warehouse_id uuid, p_as_of date, p_lines jsonb, p_note text default null)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_doc public.stock_documents; v_id uuid := gen_random_uuid(); l record;
begin
  perform public.assert_not_light();                                                                   -- 1530 (field accounts)
  perform public.assert_is_active_member();
  perform public.opening_assert_load(v_org, p_as_of);
  perform public.assert_feature_on(v_org, 'stock');
  perform public.stock_assert_standalone(v_org);
  perform 1 from public.stock_warehouses w where w.id = p_warehouse_id and w.org_id = v_org for update;   -- serialises two loads of one location
  if not found then raise exception 'STK_NOT_FOUND: the warehouse is not in your organisation' using errcode = 'P0002'; end if;
  -- The count shape (item in org, not archived, 0+ with 3 decimals, whole units, cost 0+ with 4 decimals).
  perform public.stock_validate_payload(v_org, 'count', jsonb_build_object('warehouse_id', p_warehouse_id), p_lines);
  if exists (select 1 from jsonb_to_recordset(p_lines) x(item_id uuid, counted_quantity numeric, unit_cost numeric) where x.counted_quantity > 0 and x.unit_cost is null) then
    raise exception 'STK_INVALID: an opening count above 0 needs a unit cost' using errcode = 'P0001'; end if;
  if (select count(*) from jsonb_to_recordset(p_lines) x(item_id uuid)) <> (select count(distinct x.item_id) from jsonb_to_recordset(p_lines) x(item_id uuid)) then
    raise exception 'STK_INVALID: an item appears once per location' using errcode = 'P0001'; end if;
  if exists (select 1 from public.opening_balances o where o.warehouse_id = p_warehouse_id and o.reversed_at is null) then
    raise exception 'this location already has an opening balance' using errcode = 'P0001'; end if;
  if public.opening_location_has_movement(v_org, p_warehouse_id, null) then                                -- mut:stock_activity
    raise exception 'an opening balance is loaded before the location''s first stock movement' using errcode = 'P0001'; end if;

  -- One posting path with the history load (FR-OSH-012): the counted lines are posted by the shared routine.
  return public.opening_post_location(v_org, p_warehouse_id, p_as_of, p_lines, p_note, true, null);
end $$;

create or replace function public.reverse_opening_balance(p_id uuid) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); o public.opening_balances; v_doc public.stock_documents; l record; v_lines jsonb;
begin
  perform public.assert_not_light();                                                                   -- 1530 (field accounts)
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin loads or reverses an opening balance' using errcode = '42501'; end if;
  select * into o from public.opening_balances x where x.id = p_id and x.org_id = v_org;
  if not found then raise exception 'opening balance not found' using errcode = 'P0002'; end if;
  if o.kind = 'work_order' then
    perform public.lock_work_order_billing(o.work_order_id);
    perform 1 from public.work_orders w where w.id = o.work_order_id for update;                        -- mut:wo_row_lock (acceptance prepare takes this row)
  else
    perform public.assert_feature_on(v_org, 'stock');
    perform public.stock_assert_standalone(v_org);
    perform 1 from public.stock_warehouses w where w.id = o.warehouse_id for update;
  end if;
  select * into o from public.opening_balances x where x.id = p_id for update;
  if o.reversed_at is not null then raise exception 'this opening balance was already reversed' using errcode = 'P0001'; end if;

  if o.kind = 'work_order' then
    if public.opening_work_order_has_activity(o.work_order_id, o.id) then                               -- mut:wo_reverse
      raise exception 'an opening balance can be reversed only before the first real transaction' using errcode = 'P0001'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('boq_item_id', x.boq_item_id, 'quantity', x.quantity)), '[]'::jsonb) into v_lines
      from public.work_order_acceptance_lines x where x.acceptance_id = o.acceptance_id;
    perform set_config('pmo.reverse_opening', 'on', true);
    delete from public.work_order_acceptance_lines where acceptance_id = o.acceptance_id;
    delete from public.work_order_acceptances where id = o.acceptance_id and confirm_basis = 'opening';
    perform set_config('pmo.reverse_opening', '', true);
  else
    select * into v_doc from public.stock_documents d where d.id = o.stock_document_id;
    if public.opening_location_has_movement(v_org, o.warehouse_id, o.stock_document_id) then           -- mut:stock_reverse
      raise exception 'an opening balance can be reversed only before the first real transaction' using errcode = 'P0001'; end if;
    perform public.stock_lock_for_document(v_doc);
    v_doc.kind := 'opening_reversal';                                                                    -- the ledger rows' kind, not the document's
    for l in select * from public.stock_document_lines where document_id = o.stock_document_id and counted_quantity > 0 order by line_no loop
      perform public.stock_write_entry(v_doc, l.id, l.item_id, o.warehouse_id, -l.counted_quantity, null, null, null, null);
    end loop;
    -- A history document (lines with quantity and direction): one netting entry per item takes the whole remaining balance out.
    for l in select (array_agg(d.id order by d.line_no))[1] as id, d.item_id,
                    sum(case d.direction when 'in' then d.quantity else -d.quantity end) as net
               from public.stock_document_lines d where d.document_id = o.stock_document_id and d.quantity is not null
              group by d.item_id having sum(case d.direction when 'in' then d.quantity else -d.quantity end) > 0 order by d.item_id loop
      perform public.stock_write_entry(v_doc, l.id, l.item_id, o.warehouse_id, -l.net, null, null, null, null);
    end loop;
  end if;
  update public.opening_balances set reversed_by = v_uid, reversed_at = now() where id = o.id;
  perform public.log_audit('opening_balance.reverse', v_org, v_uid, o.id, jsonb_build_object('kind', o.kind, 'work_order_id', o.work_order_id,
    'warehouse_id', o.warehouse_id, 'acceptance_lines', v_lines, 'claimed_amount', o.claimed_amount));
end $$;


-- §5 grants ---------------------------------------------------------------------------------------------------------------
revoke all on function public.opening_history_plan(uuid, date, jsonb), public.opening_post_location(uuid, uuid, date, jsonb, text, boolean, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.preview_stock_opening_history(date, jsonb), public.load_stock_opening_history(date, jsonb, uuid, text) from public, anon;
grant execute on function public.preview_stock_opening_history(date, jsonb), public.load_stock_opening_history(date, jsonb, uuid, text) to authenticated;
