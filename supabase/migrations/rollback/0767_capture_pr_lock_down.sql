-- 0767 down: back to the 0238 body (no purchase lock on capture).
create or replace function public.create_purchase_request(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_external_ref text default null)
  returns purchase_requests language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_requests;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.purchase_requests
    (procurement_id, pr_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at, external_ref)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PR'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at, nullif(btrim(p_external_ref), ''))
    returning * into v_row;
  return v_row;
end; $$;
