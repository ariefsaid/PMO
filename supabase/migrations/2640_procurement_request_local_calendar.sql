-- drops: replace the request creation-day cast with the shared org-calendar conversion;
-- native_org_today delegates its equivalent timezone expression to native_org_date.
-- Calendar conversion shared by document creation and later capture.
create or replace function public.native_org_date(p_org uuid, p_at timestamptz) returns date
  language sql stable set search_path = public as $$
  select (p_at at time zone coalesce(
    (select o.default_timezone from public.organizations o where o.id = p_org), 'UTC'))::date
$$;
revoke all on function public.native_org_date(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.native_org_today(p_org uuid) returns date
  language sql stable set search_path = public as $$
  select public.native_org_date(p_org, now())
$$;

create or replace function public.create_purchase_request(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_external_ref text default null)
  returns purchase_requests language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_requests; v_pr_number text;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id, pr_number into v_org, v_pr_number
    from public.procurements where id = p_procurement_id for update;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_pr_number is not null and p_import_key is null then
    update public.purchase_requests
       set reference_number = p_reference_number, status = coalesce(p_status, 'Draft'), date = p_date, amount = p_amount,
           external_ref = nullif(btrim(p_external_ref), '')
     where id = (select r.id from public.purchase_requests r
                  where r.procurement_id = p_procurement_id and r.pr_number = v_pr_number
                    and r.reference_number is null and r.amount is null and r.import_key is null
                    and r.external_ref is null and r.status = 'Submitted' and r.date = public.native_org_date(v_org, r.created_at)
                  order by r.created_at limit 1 for update)
    returning * into v_row;
    if found then return v_row; end if;
  end if;
  insert into public.purchase_requests
    (procurement_id, pr_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at, external_ref)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PR'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at, nullif(btrim(p_external_ref), ''))
    returning * into v_row;
  return v_row;
end; $$;
