-- Rollback of 0712: create_purchase_order exactly as migration 0538 defined it.
create or replace function public.create_purchase_order(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_external_ref text default null)
  returns purchase_orders language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_orders; v_currency text;                                      -- 0373
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id, currency into v_org, v_currency from public.procurements where id = p_procurement_id;  -- 0373
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Slice 5 addition (AC-ENA-052): a flipped org's PO writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — purchase orders route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  insert into public.purchase_orders
    (procurement_id, po_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at, external_ref, currency)                                   -- 0373
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PO'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at, nullif(btrim(p_external_ref), ''), v_currency) -- 0373
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function public.create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz, text) from public;
grant  execute on function public.create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz, text) to   authenticated;
revoke execute on function public.create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz, text) from anon;
