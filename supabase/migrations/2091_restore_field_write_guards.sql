-- Restore the field-account guard retained by the prior deployed function bodies.
create or replace function public.prepare_certificate_acceptance(p_certificate uuid, p_note text default null) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); c public.subcontract_certificates; v_lines jsonb; v_acc uuid; v_status text;
begin
  perform public.assert_is_active_member();
  perform public.assert_not_light();
  select * into c from public.subcontract_certificates where id = p_certificate and org_id = v_org;
  if c.id is null or not public.spc_may_prepare(c.project_id) then raise exception 'certificate not found' using errcode = 'P0002'; end if;
  if c.status in ('cancelled', 'billed') then raise exception 'this certificate is % already', c.status using errcode = '23514'; end if;
  if c.status in ('draft', 'returned') then
    select jsonb_agg(jsonb_build_object('boq_item_id', (l->>'boq_item_id')::uuid,
                     'quantity', coalesce(v.quantity, 0) + (l->>'measured_quantity')::numeric)) into v_lines
      from jsonb_array_elements(public.spc_derive(c.id)->'lines') l
      left join public.subcontract_verified(c.po_id) v on v.boq_item_id = (l->>'boq_item_id')::uuid;
  else
    select jsonb_agg(jsonb_build_object('boq_item_id', l.boq_item_id, 'quantity', coalesce(v.quantity, 0) + l.measured_quantity)) into v_lines
      from public.subcontract_certificate_lines l left join public.subcontract_verified(c.po_id) v on v.boq_item_id = l.boq_item_id
     where l.certificate_id = c.id;
  end if;
  if v_lines is null then raise exception 'there is nothing measured to accept' using errcode = '23514'; end if;
  v_acc := c.acceptance_id;
  if v_acc is not null then
    select a.status into v_status from public.subcontract_acceptances a where a.id = v_acc;
    if v_status is distinct from 'Draft' then v_acc := null; end if;
  end if;
  v_acc := public.prepare_subcontract_acceptance(c.po_id, public.native_org_today(v_org), v_lines, null,
             coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Prepared from the progress certificate for ' || to_char(c.period_start, 'YYYY-MM')), v_acc);
  update public.subcontract_certificates set acceptance_id = v_acc where id = c.id;
  perform public.log_audit('subcontract_certificate.acceptance_prepared', v_org, auth.uid(), c.id, jsonb_build_object('acceptance_id', v_acc));
  return v_acc;
end $$;

create or replace function public.csr_record_pickup(p_line_id uuid, p_quantity numeric, p_warehouse_id uuid, p_picked_up_on date default null,
    p_collector text default null, p_paper_reference text default null, p_client_request_id uuid default null) returns uuid
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); l public.client_requisition_lines; r public.client_requisitions; f record;
  v_zero boolean; v_whole boolean; v_on date; v_doc uuid; v_pickup uuid; v_still numeric; v_collector text; v_paper text;
begin
  perform public.assert_is_active_member();
  perform public.assert_not_light();
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
