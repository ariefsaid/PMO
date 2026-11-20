-- 1034_equipment_rental_check.sql — #2526 slice 4: the rental invoice check. MONEY: a deduction taken off a vendor's bill.
-- Spec FR-EAV-014..017, AC-EAV-008..010; proven by supabase/tests/equipment_rental_check.test.sql (mutation-checked: removing
-- the proven filter turns AC-EAV-009 red). It reads and compares; it never posts, pays or edits a bill (FR-EAV-015).
-- Exact arithmetic: each day's charge is kept as integer 1/377580ths of a cent, summed, then rounded half up to
-- cents once — the same steps as rentalDeduction() in pmo-portal/src/lib/equipmentMetrics.ts, so the two agree digit for digit.
-- A monthly rate is divided by the calendar days of that day's own month (OQ-EAV-1 default).
-- Reverse: rollback/1034_equipment_rental_check_down.sql

create table public.equipment_rental_checks (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  asset_id        uuid not null references public.equipment_assets(id) on delete restrict,
  period_from     date not null,
  period_to       date not null,
  invoice_amount  numeric(14,2),
  included_unproven_reason text not null check (char_length(btrim(included_unproven_reason)) between 1 and 500),
  deduction       numeric(14,2) not null,
  expected_amount numeric(14,2) not null,
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now()
);
create index equipment_rental_checks_asset on public.equipment_rental_checks (org_id, asset_id, created_at desc);
alter table public.equipment_rental_checks enable row level security;  alter table public.equipment_rental_checks force row level security;
create policy equipment_rental_checks_select on public.equipment_rental_checks for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) in ('Admin','Finance'));
revoke all on public.equipment_rental_checks from public, anon, authenticated;
grant select on public.equipment_rental_checks to authenticated;
grant all on public.equipment_rental_checks to service_role;

-- per in-service (rented) day: the charge in 1/377580ths of a cent. Internal (invoker); the definer below calls it.
create function public.equipment_rental_day_rates(p_org uuid, p_asset uuid, p_from date, p_to date)
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
revoke all on function public.equipment_rental_day_rates(uuid, uuid, date, date) from public, anon, authenticated;

create function public.equipment_rental_check(p_asset uuid, p_from date, p_to date, p_invoice_amount numeric default null,
                                              p_include_unproven_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_reason text := nullif(btrim(coalesce(p_include_unproven_reason, '')), '');
  v_rental_units numeric; v_deduct_units numeric; v_ccy int; v_cur text; v_rental numeric; v_deduct numeric; v_expected numeric;
  v_days jsonb; v_unproven jsonb;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Finance') then raise exception 'not authorized' using errcode = '42501'; end if;
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
alter function public.equipment_rental_check(uuid, date, date, numeric, text) owner to postgres;
revoke all on function public.equipment_rental_check(uuid, date, date, numeric, text) from public, anon, authenticated;
grant execute on function public.equipment_rental_check(uuid, date, date, numeric, text) to authenticated;
