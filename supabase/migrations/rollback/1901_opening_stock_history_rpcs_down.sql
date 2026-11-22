-- 1901_opening_stock_history_rpcs_down.sql — reverses 1901: the two bodies return to their 1046 text (plus the 1530 field-account guard), the new functions go.
-- Run only with no opening history loaded; a reversal of such a document by the 1046 body would leave its balance in place.
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

  insert into public.stock_documents (org_id, number, kind, warehouse_id, note, occurred_on, created_by)
  values (v_org, public.next_procurement_doc_number(v_org, public.stock_doc_prefix('opening')), 'opening', p_warehouse_id,
          coalesce(nullif(btrim(p_note), ''), 'Opening balance at go-live'), p_as_of, v_uid)
  returning * into v_doc;
  insert into public.stock_document_lines (org_id, document_id, line_no, item_id, counted_quantity, unit_cost)
  select v_org, v_doc.id, t.n::int, (t.e->>'item_id')::uuid, (t.e->>'counted_quantity')::numeric, (t.e->>'unit_cost')::numeric
    from jsonb_array_elements(p_lines) with ordinality t(e, n);
  perform public.stock_lock_for_document(v_doc);
  for l in select * from public.stock_document_lines where document_id = v_doc.id and counted_quantity > 0 order by line_no loop
    perform public.stock_write_entry(v_doc, l.id, l.item_id, p_warehouse_id, l.counted_quantity, round(l.counted_quantity * l.unit_cost, 2), null, null, null);
  end loop;
  update public.stock_documents set status = 'Posted', posted_by = v_uid, posted_at = now() where id = v_doc.id;
  insert into public.opening_balances (id, org_id, kind, as_of, warehouse_id, stock_document_id, note, loaded_by)
  values (v_id, v_org, 'stock', p_as_of, p_warehouse_id, v_doc.id, nullif(btrim(p_note), ''), v_uid);
  perform public.log_audit('opening_balance.load', v_org, v_uid, v_id, jsonb_build_object('kind', 'stock', 'warehouse_id', p_warehouse_id,
    'as_of', p_as_of, 'stock_document_id', v_doc.id, 'number', v_doc.number, 'lines', p_lines));
  return v_id;
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
  end if;
  update public.opening_balances set reversed_by = v_uid, reversed_at = now() where id = o.id;
  perform public.log_audit('opening_balance.reverse', v_org, v_uid, o.id, jsonb_build_object('kind', o.kind, 'work_order_id', o.work_order_id,
    'warehouse_id', o.warehouse_id, 'acceptance_lines', v_lines, 'claimed_amount', o.claimed_amount));
end $$;


drop function if exists public.load_stock_opening_history(date, jsonb, uuid, text);
drop function if exists public.preview_stock_opening_history(date, jsonb);
drop function if exists public.opening_post_location(uuid, uuid, date, jsonb, text, boolean, uuid);
drop function if exists public.opening_history_plan(uuid, date, jsonb);
