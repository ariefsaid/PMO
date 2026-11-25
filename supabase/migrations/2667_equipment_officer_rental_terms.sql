-- 2667_equipment_officer_rental_terms.sql — the Equipment Officer enters the rental terms (vendor, rate, basis, currency, dates) when
-- registering a rented asset in their own organisation, and edits the terms of an asset (extends DD-R1124-17). Deleting stays Admin-only;
-- no other cost read or write changes. equipment_can_edit_terms (called by save_equipment_rental_term, change_equipment_rental_rate,
-- end_equipment_rental_term and the atomic equipment import) gains the job-role test; create_rented_equipment_asset is restated from its
-- newest body (2620) with its role test widened the same way.
-- The officer also reads the rental terms of their own organisation's assets (equipment_rental_terms_select gains the job-role branch),
-- since they enter and edit them; no other table's read changes.
-- drops: nothing; create_rented_equipment_asset keeps every other line of the 2620 body.
-- Proven by supabase/tests/equipment_officer_rental_terms.test.sql. Reverse: rollback/2667_equipment_officer_rental_terms_down.sql

create or replace function public.equipment_can_edit_terms(p_role public.user_role) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select coalesce(p_role = 'Finance' or public.equipment_manager_rights(p_role)
                  or public.actor_holds_job_role('equipment_officer'), false) $$;   -- mut:officer_edit_terms

create or replace function public.create_rented_equipment_asset(
  p_code text, p_name text, p_unit text, p_vendor uuid, p_rate numeric,
  p_basis text, p_currency text, p_from date, p_to date default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_asset uuid;
  v_term uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if not ((public.auth_role() in ('Admin', 'Project Manager') and public.equipment_can_edit_terms(public.auth_role()))
          or public.actor_holds_job_role('equipment_officer')) then   -- mut:officer_register_rented
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_vendor is null or p_rate is null then raise exception 'a rented asset needs a vendor and a rate' using errcode = '22023'; end if;
  if p_rate::text in ('NaN','Infinity','-Infinity') or p_rate <= 0 or round(p_rate, 2) <> p_rate then raise exception 'rate must be positive with at most 2 decimals' using errcode = '22023'; end if;
  if p_basis is null or p_basis not in ('hour','day','month') then raise exception 'basis must be hour, day or month' using errcode = '22023'; end if;
  if p_currency is null or upper(p_currency) !~ '^[A-Z]{3}$' then raise exception 'currency must be a 3-letter code' using errcode = '22023'; end if;
  if p_from is null or (p_to is not null and p_to < p_from) then raise exception 'the rental period is invalid' using errcode = '22023'; end if;
  if not exists (select 1 from public.companies c where c.id = p_vendor and c.org_id = v_org) then
    raise exception 'vendor not found' using errcode = 'P0002';
  end if;
  insert into public.equipment_assets (org_id, code, name, default_unit, ownership, in_service_on)
    values (v_org, p_code, p_name, p_unit, 'rented', p_from) returning id into v_asset;
  insert into public.equipment_rental_terms (org_id, asset_id, vendor_id, rate, basis, currency, rented_from, rented_to)
    values (v_org, v_asset, p_vendor, p_rate, p_basis, upper(p_currency), p_from, p_to) returning id into v_term;
  perform public.log_audit('equipment_asset.ownership', v_org, auth.uid(), v_asset,
    jsonb_build_object('ownership', 'rented', 'in_service_on', p_from));
  perform public.log_audit('equipment_rental.create', v_org, auth.uid(), v_term,
    jsonb_build_object('asset_id', v_asset, 'vendor_id', p_vendor, 'rate', p_rate, 'basis', p_basis, 'currency', upper(p_currency), 'from', p_from, 'to', p_to));
  return v_asset;
end $$;

alter policy equipment_rental_terms_select on public.equipment_rental_terms
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and ((select public.auth_role()) in ('Admin', 'Finance', 'Executive', 'Project Manager')
              or (select public.actor_holds_job_role('equipment_officer'))));   -- mut:officer_read_terms
