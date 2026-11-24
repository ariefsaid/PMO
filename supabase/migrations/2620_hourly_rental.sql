-- Hourly rental is opt-in per rental term. Daily/monthly arithmetic is preserved.
-- Field accounts: assert_not_light plus restrictive read policy; no payment writes.
-- Rollback: rollback/2620_hourly_rental_down.sql
create table public.hourly_rental_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  asset_id uuid not null references public.equipment_assets(id),
  period_from date not null,
  period_to date not null,
  result jsonb not null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.hourly_rental_checks enable row level security;
alter table public.hourly_rental_checks force row level security;
create policy hourly_rental_checks_read on public.hourly_rental_checks for select to authenticated
using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and ((select public.auth_role()) in ('Admin','Finance') or (select public.actor_built_in_role()) in ('equipment_officer','equipment_manager')));
create policy hourly_rental_checks_field on public.hourly_rental_checks as restrictive for select to authenticated
using ((select public.actor_is_light()) is not true);
revoke all on public.hourly_rental_checks from public, anon, authenticated;
grant select on public.hourly_rental_checks to authenticated;
grant all on public.hourly_rental_checks to service_role;

create function public.check_hourly_rental(p_asset uuid, p_from date, p_to date,
  p_contracted numeric, p_invoice numeric, p_broken jsonb, p_state text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_term public.equipment_rental_terms;
  v_day jsonb; v_date date; v_hours numeric; v_broken numeric := 0; v_billable numeric;
  v_proofs jsonb; v_days jsonb := '[]'; v_result jsonb; v_dates date[] := '{}';
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if not (public.auth_role() in ('Admin','Finance') or coalesce(public.actor_built_in_role() in ('equipment_officer','equipment_manager'), false)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 399 then
    raise exception 'invalid rental period' using errcode = '22023';
  end if;
  if p_contracted is null or p_invoice is null or p_contracted::text in ('NaN','Infinity','-Infinity')
    or p_invoice::text in ('NaN','Infinity','-Infinity') or p_contracted < 0 or p_invoice < 0
    or p_contracted > 9600 or p_invoice > 9600 or round(p_contracted,2) <> p_contracted or round(p_invoice,2) <> p_invoice then
    raise exception 'invalid hours' using errcode = '22023';
  end if;
  if p_state is not null and p_state not in ('checked','disputed') then
    raise exception 'invalid check outcome' using errcode = '22023';
  end if;
  if not exists (select 1 from public.equipment_assets where id = p_asset and org_id = v_org and ownership = 'rented' and archived_at is null) then
    raise exception 'rented asset not found' using errcode = 'P0002';
  end if;
  select * into v_term from public.equipment_rental_terms
    where org_id = v_org and asset_id = p_asset and basis = 'hour'
    and rented_from <= p_from and coalesce(rented_to,'infinity'::date) >= p_to;
  if not found then raise exception 'one hourly term must cover the entire check period' using errcode = '22023'; end if;
  if p_broken is null or jsonb_typeof(p_broken) <> 'array' or jsonb_array_length(p_broken) > 400 then
    raise exception 'invalid broken hours' using errcode = '22023';
  end if;
  for v_day in select value from jsonb_array_elements(p_broken) loop
    v_date := (v_day->>'date')::date; v_hours := (v_day->>'hours')::numeric;
    if v_date is null or v_date < p_from or v_date > p_to or v_date = any(v_dates)
      or v_hours is null or v_hours::text in ('NaN','Infinity','-Infinity') or v_hours <= 0 or v_hours > 24 or round(v_hours,2) <> v_hours then
      raise exception 'invalid dated broken hours' using errcode = '22023';
    end if;
    v_dates := array_append(v_dates,v_date);
    select coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'file_name',pr.file_name,'file_path',pr.file_path)), '[]') into v_proofs
      from public.equipment_downtime_proofs pr where pr.org_id = v_org and pr.asset_id = p_asset and pr.proof_date = v_date
      and exists (select 1 from storage.objects o where o.bucket_id = 'equipment-proof' and o.name = pr.file_path);
    if jsonb_array_length(v_proofs) > 0 then v_broken := v_broken + v_hours; end if;
    v_days := v_days || jsonb_build_array(jsonb_build_object('date',v_date,'hours',v_hours,'proven',jsonb_array_length(v_proofs)>0,'proofs',v_proofs));
  end loop;
  v_billable := greatest(0, p_contracted - v_broken);
  v_result := jsonb_build_object('contracted_hours',p_contracted::numeric(12,2)::text,
    'broken_hours',v_broken::numeric(12,2)::text,'billable_hours',v_billable::numeric(12,2)::text,
    'invoice_hours',p_invoice::numeric(12,2)::text,'rate',v_term.rate::text,'currency',v_term.currency,
    'deduction',round((p_contracted-v_billable)*v_term.rate,2)::numeric(14,2)::text,
    'expected_amount',round(v_billable*v_term.rate,2)::numeric(14,2)::text,'days',v_days,'state',p_state);
  if p_state is not null then
    insert into public.hourly_rental_checks(org_id,asset_id,period_from,period_to,result)
      values(v_org,p_asset,p_from,p_to,v_result);
    perform public.log_audit('equipment_rental.hourly_check',v_org,auth.uid(),p_asset,v_result);
  end if;
  return v_result;
end $$;
revoke all on function public.check_hourly_rental(uuid,date,date,numeric,numeric,jsonb,text) from public,anon,authenticated;
grant execute on function public.check_hourly_rental(uuid,date,date,numeric,numeric,jsonb,text) to authenticated;

-- drops: save_equipment_rental_term adds hour to the accepted bases; all other checks from 1032 stay.
alter table public.equipment_rental_terms drop constraint equipment_rental_terms_basis_check;
alter table public.equipment_rental_terms add constraint equipment_rental_terms_basis_check check (basis in ('hour','day','month'));
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
  if v_basis is null or v_basis not in ('hour','day','month') then raise exception 'basis must be hour, day or month' using errcode = '22023'; end if;
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

-- drops: equipment_rental_day_rates excludes hourly terms; their explicit hours use check_hourly_rental.
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
   where t.basis in ('day','month') and (a.in_service_on is null or g::date >= a.in_service_on)
     and (a.archived_at is null or g::date < (a.archived_at at time zone coalesce(o.default_timezone, 'UTC'))::date)
$$;

-- drops: equipment_rental_check admits Officer bounded read only; all existing checks and Finance-only unproven override are preserved from 1691.
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
  if not (public.auth_role() in ('Admin','Finance') or public.equipment_manager_rights(public.auth_role()) or coalesce(public.actor_built_in_role() = 'equipment_officer', false))
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
