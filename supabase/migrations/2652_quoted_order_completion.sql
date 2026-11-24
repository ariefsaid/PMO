-- Complete the issued order using the selected quotation amount.
-- drops: extend the declaration with the selected amount and the placeholder match to recognise a quotation-valued order; all authorization guards remain unchanged.
create or replace function public.create_purchase_order(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_external_ref text default null)
  returns purchase_orders language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_orders; v_currency text; v_po_number text; v_status public.procurement_status;
  v_quote_amount numeric;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id, currency, po_number, status into v_org, v_currency, v_po_number, v_status
    from public.procurements where id = p_procurement_id for update;   -- 0712: serializes with transition_procurement
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;
  -- 1842 roles-that-decide FR-RTD-009/010: today's four levels, or a person who fills an ordering job role on an approved purchase.
  if auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    if not public.actor_may_order_purchases() then                                                     -- mut:raise_gate
      raise exception 'PO_ORDER_FORBIDDEN: you cannot order purchases; ask an Admin to name your built-in role as one that orders'
        using errcode = '42501';
    end if;
    if v_status not in ('Approved', 'Vendor Quoted', 'Quote Selected', 'Ordered') then                 -- mut:raise_approved
      raise exception 'PO_ORDER_NOT_APPROVED: this purchase has not been approved yet, so it cannot be ordered'
        using errcode = '42501';
    end if;
  end if;
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — purchase orders route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  select q.total_amount into v_quote_amount from public.procurement_quotations q
    where q.procurement_id = p_procurement_id and q.is_selected;
  if found then p_amount := v_quote_amount; end if;
  -- 0712: the order the transition minted (this purchase's PO number, nothing captured on it) is completed, not duplicated.
  if v_po_number is not null and p_import_key is null then
    update public.purchase_orders
       set reference_number = p_reference_number, status = coalesce(p_status, 'Draft'), date = p_date, amount = p_amount,
           external_ref = nullif(btrim(p_external_ref), ''), currency = v_currency
     where id = (select o.id from public.purchase_orders o
                  where o.procurement_id = p_procurement_id and o.po_number = v_po_number
                    and o.reference_number is null and (o.amount is null or (v_quote_amount is not null and o.amount = v_quote_amount)) and o.import_key is null
                    and o.external_ref is null and o.status = 'Issued'
                  order by o.created_at limit 1 for update)
    returning * into v_row;
    if found then return v_row; end if;
  end if;
  insert into public.purchase_orders
    (procurement_id, po_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at, external_ref, currency)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PO'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at, nullif(btrim(p_external_ref), ''), v_currency)
    returning * into v_row;
  return v_row;
end; $$;

