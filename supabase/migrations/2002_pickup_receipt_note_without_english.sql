-- 2002_pickup_receipt_note_without_english.sql — walk 24 Nov: the receipt a client-material pickup posts carried the English words
-- "Client requisition <number> pickup" for every reader, and the delivery slip number the keeper typed was kept only on the pickup,
-- so the receipt did not show it. The receipt note is now the requisition number, the delivery paper reference and the collector,
-- joined by dots: no words to translate, and the slip number sits on the receipt.
-- csr_record_pickup is restated from 1163 (the latest); the note line is the only change. Receipts already posted keep their note.
-- drops: the note expression 'Client requisition <number> pickup - <collector>' (now <number> · <paper reference> · <collector>); nothing else changes.
-- Proven by supabase/tests/csr_pickup.test.sql (AC-CSR-008).
-- Rollback: supabase/migrations/rollback/2002_pickup_receipt_note_without_english_down.sql.

create or replace function public.csr_record_pickup(p_line_id uuid, p_quantity numeric, p_warehouse_id uuid, p_picked_up_on date default null,
    p_collector text default null, p_paper_reference text default null, p_client_request_id uuid default null) returns uuid
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); l public.client_requisition_lines; r public.client_requisitions; f record;
  v_zero boolean; v_whole boolean; v_on date; v_doc uuid; v_pickup uuid; v_still numeric; v_collector text; v_paper text;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  if p_client_request_id is not null then                                                                      -- FR-CSR-015: a replay returns the original
    select p.id into v_pickup from public.client_requisition_pickups p
     where p.org_id = v_org and p.recorded_by = v_uid and p.client_request_id = p_client_request_id;
    if v_pickup is not null then return v_pickup; end if;
  end if;
  perform public.stock_assert_standalone(v_org);                                                               -- FR-CSR-016: before any row
  l := public.csr_lock_line(v_org, p_line_id);
  select * into r from public.client_requisitions x where x.id = l.requisition_id;
  select coalesce(t.zero_cost, false), u.whole_only into v_zero, v_whole
    from public.stock_items i join public.stock_units u on u.id = i.unit_id left join public.stock_tags t on t.id = i.tag_id
   where i.id = l.stock_item_id;
  if not coalesce(v_zero, false) then                                                                          -- mut:zero_cost_tag
    raise exception 'CSR_NOT_CLIENT_SUPPLIED: This item is not client-supplied' using errcode = 'P0001'; end if;
  if not public.csr_valid_quantity(p_quantity, coalesce(v_whole, false)) then
    raise exception 'CSR_INVALID: a pickup needs a quantity above 0 (3 decimals at most, whole units where the unit demands it)' using errcode = 'P0001'; end if;
  v_collector := nullif(btrim(p_collector), '');
  v_paper := nullif(btrim(p_paper_reference), '');
  if length(coalesce(v_collector, '')) > 200 or length(coalesce(v_paper, '')) > 200 then
    raise exception 'CSR_INVALID: the collector and the delivery paper reference are 200 characters at most' using errcode = 'P0001'; end if;
  select * into f from public.csr_line_figures(l.id);
  v_still := f.reserved - f.collected;
  if p_quantity > v_still then                                                                                 -- mut:still_to_collect
    raise exception 'CSR_OVER_COLLECT: only % is still to collect', trim_scale(greatest(v_still, 0))::text using errcode = 'P0001'; end if;
  v_on := coalesce(p_picked_up_on, public.stock_org_today(v_org));
  -- The receipt goes through the shipped path: keeper-or-Admin, item/warehouse validation, numbering, dates (0413/0534).
  -- Unit cost is 0 by construction (spec FR-CSR-012); the payload carries no client cost.
  v_doc := public.create_stock_document(
    jsonb_build_object('kind', 'receive', 'warehouse_id', p_warehouse_id, 'occurred_on', v_on,
                       'note', left(concat_ws(' · ', r.number, v_paper, v_collector), 500)),
    jsonb_build_array(jsonb_build_object('item_id', l.stock_item_id, 'quantity', p_quantity, 'unit_cost', 0)),
    false, null);
  -- Check 1161's rule trigger: the receiving location's project must be the work order's.
  update public.stock_documents set work_order_id = r.work_order_id where id = v_doc;
  perform public.post_stock_document(v_doc);
  insert into public.client_requisition_pickups (org_id, requisition_id, line_id, quantity, picked_up_on, collector, paper_reference,
                                                 warehouse_id, stock_document_id, client_request_id, recorded_by)
  values (v_org, r.id, l.id, p_quantity, v_on, v_collector, v_paper, p_warehouse_id, v_doc, p_client_request_id, v_uid)
  returning id into v_pickup;
  perform public.csr_log(v_org, r.id, l.id, 'pickup', p_quantity, null, v_on, null, v_pickup, p_client_request_id);
  return v_pickup;
end $$;
