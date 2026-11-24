-- Refuse rollback until hourly terms have been removed or converted deliberately.
alter table public.equipment_rental_terms drop constraint equipment_rental_terms_basis_check;
alter table public.equipment_rental_terms add constraint equipment_rental_terms_basis_check check (basis in ('day','month'));
drop function public.check_hourly_rental(uuid,date,date,numeric,numeric,jsonb,text);
drop table public.hourly_rental_checks;
create or replace function public.save_equipment_rental_term(p_term jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_asset uuid; v_vendor uuid; v_rate numeric; v_basis text; v_cur text;
  v_from date; v_to date; v_id uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if not public.equipment_can_edit_terms(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_term is null or jsonb_typeof(p_term) <> 'object' then raise exception 'term must be a JSON object' using errcode = '22023'; end if;
  begin
    v_asset := (p_term->>'asset_id')::uuid; v_vendor := (p_term->>'vendor_id')::uuid; v_rate := (p_term->>'rate')::numeric;
    v_from := (p_term->>'rented_from')::date; v_to := nullif(p_term->>'rented_to','')::date;
  exception when others then raise exception 'asset, vendor, rate or dates are malformed' using errcode = '22023';
  end;
  v_basis := p_term->>'basis'; v_cur := upper(coalesce(p_term->>'currency',''));
  if v_vendor is null or v_rate is null then raise exception 'a rented asset needs a vendor and a rate' using errcode = '22023'; end if;
  if v_rate::text in ('NaN','Infinity') or v_rate <= 0 or round(v_rate, 2) <> v_rate then raise exception 'rate must be positive with at most 2 decimals' using errcode = '22023'; end if;
  if v_basis is null or v_basis not in ('day','month') then raise exception 'basis must be day or month' using errcode = '22023'; end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'currency must be a 3-letter code' using errcode = '22023'; end if;
  if v_from is null or (v_to is not null and v_to < v_from) then raise exception 'the rental period is invalid' using errcode = '22023'; end if;
  if not exists (select 1 from public.equipment_assets a where a.id = v_asset and a.org_id = v_org and a.archived_at is null) then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.companies c where c.id = v_vendor and c.org_id = v_org) then
    raise exception 'vendor not found' using errcode = 'P0002';   -- SECURITY: the org re-assertion MUST stay
  end if;
  insert into public.equipment_rental_terms (org_id, asset_id, vendor_id, rate, basis, currency, rented_from, rented_to)
  values (v_org, v_asset, v_vendor, v_rate, v_basis, v_cur, v_from, v_to) returning id into v_id;   -- 23P01 on overlap
  update public.equipment_assets set ownership = 'rented' where id = v_asset and ownership <> 'rented';
  perform public.log_audit('equipment_rental.create', v_org, auth.uid(), v_id, jsonb_build_object('asset_id', v_asset, 'vendor_id', v_vendor,
    'rate', v_rate, 'basis', v_basis, 'currency', v_cur, 'from', v_from, 'to', v_to));
  return v_id;
end $$;
create or replace function public.equipment_rental_day_rates(p_org uuid, p_asset uuid, p_from date, p_to date)
returns table (d date, units numeric, currency text)
language sql stable set search_path = public, pg_temp as $$
  select g::date,
         t.rate * 100 * 377580 / case t.basis when 'day' then 1
              else extract(day from (date_trunc('month', g) + interval '1 month' - interval '1 day'))::int end,
         t.currency
    from generate_series(p_from, p_to, interval '1 day') g
    join public.equipment_rental_terms t on t.asset_id = p_asset and t.org_id = p_org
     and t.rented_from <= g::date and coalesce(t.rented_to, 'infinity'::date) >= g::date
    join public.equipment_assets a on a.id = p_asset and a.org_id = p_org
    join public.organizations o on o.id = p_org
   where (a.in_service_on is null or g::date >= a.in_service_on)
     and (a.archived_at is null or g::date < (a.archived_at at time zone coalesce(o.default_timezone, 'UTC'))::date)
$$;
create or replace function public.equipment_rental_check(p_asset uuid, p_from date, p_to date, p_invoice_amount numeric default null,
                                              p_include_unproven_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_reason text := nullif(btrim(coalesce(p_include_unproven_reason, '')), '');
  v_rental_units numeric; v_deduct_units numeric; v_ccy int; v_cur text; v_rental numeric; v_deduct numeric; v_expected numeric;
  v_days jsonb; v_unproven jsonb;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  -- 1600: the equipment manager reads the check; only Admin and Finance may state a reason to include
  -- unproven days, because that path stores a record and audits it. Nothing else here writes.
  if not (public.auth_role() in ('Admin','Finance') or public.equipment_manager_rights(public.auth_role()))
     or (public.auth_role() not in ('Admin','Finance') and p_include_unproven_reason is not null) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_include_unproven_reason is not null and v_reason is null then
    raise exception 'including unproven downtime needs a reason' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then raise exception 'the reason is at most 500 characters' using errcode = '22023'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 400 then raise exception 'the invoice period is invalid or too long' using errcode = '22023'; end if;
  if p_invoice_amount is not null and (p_invoice_amount::text in ('NaN','Infinity') or p_invoice_amount < 0 or round(p_invoice_amount, 2) <> p_invoice_amount) then
    raise exception 'the invoice amount must be zero or more, with at most 2 decimals' using errcode = '22023';
  end if;
  if not exists (select 1 from public.equipment_assets a where a.id = p_asset and a.org_id = v_org and a.ownership = 'rented') then
    raise exception 'rented asset not found' using errcode = 'P0002';   -- SECURITY: the org re-assertion MUST stay
  end if;

  select coalesce(sum(r.units), 0), count(distinct r.currency), min(r.currency) into v_rental_units, v_ccy, v_cur
    from public.equipment_rental_day_rates(v_org, p_asset, p_from, p_to) r;
  if v_ccy = 0 then raise exception 'no rental term covers the invoice period' using errcode = '22023'; end if;
  if v_ccy > 1 then raise exception 'the period mixes currencies' using errcode = '22023'; end if;

  -- every down day billed under a rental period, with its proof; deducted when proven (or when the user states a reason)
  with z as (
    select dd.status_date, dd.status, dd.proven, dd.period_start, r.units,
           (dd.proven or v_reason is not null) as deducted,   -- THE proof filter (AC-EAV-009): remove it and unproven days are deducted
           (select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'file_name', pr.file_name, 'file_path', pr.file_path) order by pr.created_at), '[]'::jsonb)
              from public.equipment_downtime_proofs pr
             where pr.org_id = v_org and pr.asset_id = p_asset and pr.proof_date >= dd.period_start
               and (dd.period_end is null or pr.proof_date < dd.period_end)
               and exists (select 1 from storage.objects o where o.bucket_id = 'equipment-proof' and o.name = pr.file_path)) as proofs
      from public.equipment_downtime_days(v_org, p_asset, p_from, p_to) dd
      join public.equipment_rental_day_rates(v_org, p_asset, p_from, p_to) r on r.d = dd.status_date
  )
  select coalesce(sum(z.units) filter (where z.deducted), 0),
         coalesce(jsonb_agg(jsonb_build_object('date', z.status_date, 'status', z.status, 'proven', z.proven, 'deducted', z.deducted, 'proofs', z.proofs)
                            order by z.status_date), '[]'::jsonb),
         coalesce(jsonb_agg(to_jsonb(z.status_date) order by z.status_date) filter (where not z.proven), '[]'::jsonb)
    into v_deduct_units, v_days, v_unproven
    from z;

  v_deduct_units := least(v_deduct_units, v_rental_units);            -- FR-EAV-017: never more than the period's rental amount
  v_rental := floor((v_rental_units + 188790) / 377580) / 100;
  v_deduct := least(floor((v_deduct_units + 188790) / 377580) / 100, v_rental);
  v_expected := v_rental - v_deduct;

  if v_reason is not null then   -- the stated reason is stored (AC-EAV-009) and audited
    insert into public.equipment_rental_checks (org_id, asset_id, period_from, period_to, invoice_amount, included_unproven_reason, deduction, expected_amount)
    values (v_org, p_asset, p_from, p_to, p_invoice_amount, v_reason, v_deduct, v_expected);
    perform public.log_audit('equipment_rental.check_unproven', v_org, auth.uid(), p_asset,
      jsonb_build_object('from', p_from, 'to', p_to, 'reason', v_reason, 'deduction', v_deduct));
  end if;

  return jsonb_build_object(
    'currency', v_cur,
    'rental_amount', to_char(v_rental, 'FM999999999990.00'),
    'deduction', to_char(v_deduct, 'FM999999999990.00'),
    'expected_amount', to_char(v_expected, 'FM999999999990.00'),
    'difference', case when p_invoice_amount is null then null else to_char(p_invoice_amount - v_expected, 'FM999999999990.00') end,
    'days', v_days, 'unproven_days', v_unproven, 'included_unproven_reason', v_reason);
end $$;

-- drops: create_rented_equipment_asset accepts hourly terms; original 1050 body plus 1530 field-account guard retained.
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
  if public.auth_role() not in ('Admin', 'Project Manager') or not public.equipment_can_edit_terms(public.auth_role()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_vendor is null or p_rate is null then raise exception 'a rented asset needs a vendor and a rate' using errcode = '22023'; end if;
  if p_rate::text in ('NaN','Infinity','-Infinity') or p_rate <= 0 or round(p_rate, 2) <> p_rate then raise exception 'rate must be positive with at most 2 decimals' using errcode = '22023'; end if;
  if p_basis is null or p_basis not in ('day','month') then raise exception 'basis must be day or month' using errcode = '22023'; end if;
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
