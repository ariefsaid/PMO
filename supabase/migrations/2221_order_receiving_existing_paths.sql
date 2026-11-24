-- Latest bodies: create_stock_document 0534; stock_apply_receive 0413; bill_match_evaluate 1018. Additive guards and reversal exclusion only.
create or replace function public.create_stock_document(p_header jsonb, p_lines jsonb, p_post boolean default false, p_client_request_id uuid default null)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_kind text; v_wh uuid; v_occ date; v_doc public.stock_documents; v_id uuid; v_override boolean;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
  v_org := public.auth_org_id();
  if v_org is null then raise exception 'STK_NOT_FOUND: no organisation' using errcode = 'P0001'; end if;
  if p_client_request_id is not null then                                                               -- D7: replay returns the original
    select d.id into v_id from public.stock_documents d where d.org_id = v_org and d.created_by = v_uid and d.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if coalesce(p_post, false) then perform public.stock_assert_standalone(v_org); end if;                -- D6, before any write
  v_kind := p_header->>'kind';
  if v_kind = 'receive' and exists(select 1 from public.order_receiving_settings where org_id=v_org and enabled) then
    raise exception 'RGO_USE_ORDER: Receive these goods against their purchase order.' using errcode='23514';
  end if;
  perform public.stock_validate_payload(v_org, v_kind, p_header, p_lines);
  v_wh := (p_header->>'warehouse_id')::uuid;
  v_override := public.stock_assert_keeper(v_org, v_wh, v_uid);                                         -- PQ-1: authors are keepers (or Admin)
  v_occ := coalesce(nullif(p_header->>'occurred_on', '')::date, public.stock_org_today(v_org));
  perform public.stock_assert_dates(v_org, v_occ);
  insert into public.stock_documents (org_id, number, kind, warehouse_id, to_warehouse_id, project_id, procurement_id, reason, note,
                                      occurred_on, client_request_id, created_by)
  values (v_org, public.next_procurement_doc_number(v_org, public.stock_doc_prefix(v_kind)), v_kind, v_wh,
          nullif(p_header->>'to_warehouse_id', '')::uuid, case when v_kind = 'issue' then nullif(p_header->>'project_id', '')::uuid end,
          nullif(p_header->>'procurement_id', '')::uuid, nullif(btrim(p_header->>'reason'), ''), nullif(btrim(p_header->>'note'), ''),
          v_occ, p_client_request_id, v_uid)
  on conflict (org_id, created_by, client_request_id) where client_request_id is not null do nothing
  returning * into v_doc;
  if v_doc.id is null then                                                                               -- lost a race to a concurrent replay
    select d.id into v_id from public.stock_documents d where d.org_id = v_org and d.created_by = v_uid and d.client_request_id = p_client_request_id;
    return v_id;
  end if;
  perform public.stock_insert_lines(v_doc, p_lines);
  perform public.stock_apply(v_doc, false);                                                              -- static validation per kind
  if coalesce(p_post, false) then perform public.stock_post_core(v_doc.id);                              -- a post audits its own override
  elsif v_override then
    perform public.log_audit('stock.admin_author', v_org, v_uid, v_doc.id, jsonb_build_object('kind', v_kind, 'warehouse_id', v_wh, 'number', v_doc.number));
  end if;
  return v_doc.id;
end $$;

create or replace function public.stock_apply_receive(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record;
begin
  if exists(select 1 from public.order_receiving_settings s where s.org_id=p_doc.org_id and s.enabled)
     and not exists(select 1 from public.order_receiving_requests r where r.stock_document_id=p_doc.id and r.org_id=p_doc.org_id) then
    raise exception 'RGO_USE_ORDER: Receive these goods against their purchase order.' using errcode='23514';
  end if;
  if p_doc.procurement_id is not null
     and not exists (select 1 from public.procurements pr where pr.id = p_doc.procurement_id and pr.org_id = p_doc.org_id) then
    raise exception 'STK_NOT_FOUND: the procurement case is not in your organisation' using errcode = 'P0001';       -- AC-STK-029
  end if;
  if not p_post then return; end if;
  perform public.stock_lock_for_document(p_doc);
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, l.quantity, round(l.quantity * l.unit_cost, 2), null, null, null);
  end loop;                                        -- the procurement case itself is never touched (OQ-STK-9, AC-STK-029)
end $$;

create or replace function public.bill_match_evaluate(p_invoice_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_inv public.procurement_invoices; v_proc public.procurements; v_set public.org_three_way_match_settings;
        v_match public.procurement_bill_matches; v_exc public.bill_match_exceptions;
        v_q numeric; v_a numeric; v_lines jsonb := '[]'::jsonb; v_reasons text[] := '{}'; v_line_held boolean := false;
        v_lines_total numeric; v_net numeric; v_status text;
begin
  select * into v_inv from public.procurement_invoices where id = p_invoice_id;
  if not found then return null; end if;
  select * into v_proc from public.procurements where id = v_inv.procurement_id;
  select * into v_set from public.org_three_way_match_settings where org_id = v_inv.org_id;
  if v_set.org_id is null or not v_set.enabled or v_inv.created_at < v_set.enabled_at
     or v_proc.is_subcontract or v_proc.record_only
     or coalesce(public.domain_externally_owned(v_inv.org_id, 'procurement'), false)
     or v_inv.erp_docstatus is not null or v_inv.erp_cancelled_at is not null or v_inv.voided_at is not null then
    return jsonb_build_object('status', 'not_applicable', 'reasons', '[]'::jsonb, 'lines', '[]'::jsonb);
  end if;
  v_q := v_set.quantity_tolerance_pct / 100.0;
  v_a := v_set.amount_tolerance_pct / 100.0;
  select * into v_match from public.procurement_bill_matches where invoice_id = v_inv.id;
  if v_match.invoice_id is null then
    v_reasons := array['no_lines'];
  else
    with earlier as (                       -- live bills on this purchase matched no later than this one
      select m.invoice_id
        from public.procurement_bill_matches m
        join public.procurement_invoices i on i.id = m.invoice_id
       where i.procurement_id = v_inv.procurement_id and m.seq <= v_match.seq
         and i.erp_docstatus is null and i.erp_cancelled_at is null and i.voided_at is null),
    billed as (
      select l.item_id, sum(l.quantity) as q
        from public.procurement_bill_match_lines l join earlier e on e.invoice_id = l.invoice_id
       group by l.item_id),
    received as (
      select rl.item_id, sum(rl.quantity) as q
        from public.procurement_receipt_lines rl
        join public.procurement_receipts r on r.id = rl.receipt_id
       where r.procurement_id = v_inv.procurement_id
         and coalesce(r.erp_docstatus, 1) <> 2 and r.erp_cancelled_at is null
         and not exists (select 1 from public.order_receiving_requests req
                           join public.order_receiving_reversals rev on rev.request_id=req.id
                          where req.receipt_id=r.id)
       group by rl.item_id),
    lines as (
      select l.item_id, pi.name as item_name, pi.quantity as ordered, pi.rate as order_rate,
             coalesce(rc.q, 0) as received, coalesce(b.q, 0) as billed_to_date,
             l.quantity as bill_quantity, l.rate as bill_rate, l.amount as bill_amount,
             array_remove(array[
               case when pi.id is null then 'not_on_order' end,
               case when pi.id is not null and coalesce(b.q, 0) > coalesce(rc.q, 0) * (1 + v_q) then 'over_received' end,
               case when pi.id is not null and coalesce(b.q, 0) > pi.quantity * (1 + v_q) then 'over_ordered' end,
               case when pi.id is not null and l.rate > pi.rate * (1 + v_a) then 'price_variance' end
             ], null) as reasons
        from public.procurement_bill_match_lines l
        left join public.procurement_items pi on pi.id = l.item_id and pi.procurement_id = v_inv.procurement_id
        left join received rc on rc.item_id = l.item_id
        left join billed b on b.item_id = l.item_id
       where l.invoice_id = v_inv.id)
    select coalesce(jsonb_agg(jsonb_build_object(
             'item_id', item_id, 'item_name', item_name, 'ordered', ordered, 'order_rate', order_rate,
             'received', received, 'billed_to_date', billed_to_date, 'bill_quantity', bill_quantity,
             'bill_rate', bill_rate, 'bill_amount', bill_amount, 'reasons', to_jsonb(reasons))
             order by item_name nulls first, item_id), '[]'::jsonb),
           coalesce(bool_or(cardinality(reasons) > 0), false),
           coalesce(sum(bill_amount), 0)
      into v_lines, v_line_held, v_lines_total
      from lines;
    -- The bill's own pre-tax amount must agree with its lines within the amount tolerance (FR-TWM-005).
    v_net := v_inv.amount - case when v_inv.tax_treatment = 'inclusive' then coalesce(v_inv.tax_amount, 0) else 0 end;
    if v_net is null or abs(v_net - v_lines_total) > round(v_lines_total * v_a, 2) then
      v_reasons := array_append(v_reasons, 'amount_mismatch');
    end if;
  end if;
  select * into v_exc from public.bill_match_exceptions where invoice_id = v_inv.id;
  v_status := case
    when v_exc.invoice_id is not null then 'exception_approved'
    when cardinality(v_reasons) = 0 and not v_line_held then 'matched'
    else 'held'
  end;
  return jsonb_build_object(
    'status', v_status, 'reasons', to_jsonb(v_reasons), 'lines', v_lines,
    'quantity_tolerance_pct', v_set.quantity_tolerance_pct, 'amount_tolerance_pct', v_set.amount_tolerance_pct,
    'exception', case when v_exc.invoice_id is null then null else jsonb_build_object(
      'approved_by', v_exc.approved_by, 'approved_at', v_exc.approved_at, 'reason', v_exc.reason) end);
end $$;
