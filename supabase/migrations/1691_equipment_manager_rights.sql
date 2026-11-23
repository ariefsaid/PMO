-- 1691_equipment_manager_rights.sql — the rental, working-hours and target rights of DD-R1122-3 belong to the Equipment Manager
-- job role, Admin, and (so an organisation that has assigned no job roles keeps working) a Project Manager holding no job role;
-- Finance keeps the rental-term and invoice-check rights it has. Another manager-level job role holds none of them.
-- One deciding function, equipment_manager_rights, is called by equipment_can_edit_terms (save_equipment_rental_term,
-- change_equipment_rental_rate, end_equipment_rental_term, the atomic equipment import), set_equipment_working_hours,
-- set_equipment_targets and equipment_rental_check. Bodies restated from their newest definition (1600).
-- drops: equipment_can_edit_terms, set_equipment_working_hours, set_equipment_targets and equipment_rental_check each replace their one role-test line with a call to equipment_manager_rights; the light-account guard and every other line stay in each body.
-- Proven by supabase/tests/1691_equipment_manager_rights.test.sql. Reverse: rollback/1691_equipment_manager_rights_down.sql

create or replace function public.equipment_manager_rights(p_role public.user_role) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select coalesce(p_role = 'Admin'
                  or public.actor_built_in_role() = 'equipment_manager'
                  or (public.actor_built_in_role() is null and p_role = 'Project Manager'), false) $$;
revoke all on function public.equipment_manager_rights(public.user_role) from public, anon, authenticated;

create or replace function public.equipment_can_edit_terms(p_role public.user_role) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select coalesce(p_role = 'Finance' or public.equipment_manager_rights(p_role), false) $$;

create or replace function public.set_equipment_working_hours(p_hours numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if not public.equipment_manager_rights(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_hours is null or p_hours <= 0 or p_hours > 24 or round(p_hours, 2) <> p_hours then raise exception 'working hours must be between 0 and 24' using errcode = '22023'; end if;
  update public.organizations set equipment_working_hours = p_hours where id = public.auth_org_id();
end $$;

create or replace function public.set_equipment_targets(p_availability numeric, p_utilisation numeric, p_escalation_days int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if not public.equipment_manager_rights(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_availability is not null and (p_availability < 0 or p_availability > 100 or round(p_availability, 1) <> p_availability) then
    raise exception 'the availability target must be between 0 and 100 with at most one decimal' using errcode = '22023';
  end if;
  if p_utilisation is not null and (p_utilisation < 0 or p_utilisation > 100 or round(p_utilisation, 1) <> p_utilisation) then
    raise exception 'the use target must be between 0 and 100 with at most one decimal' using errcode = '22023';
  end if;
  if p_escalation_days is null or p_escalation_days < 1 or p_escalation_days > 365 then
    raise exception 'the escalation limit must be a whole number of days from 1 to 365' using errcode = '22023';
  end if;
  update public.organizations
     set equipment_availability_target_pct = p_availability,
         equipment_utilisation_target_pct = p_utilisation,
         equipment_escalation_down_days = p_escalation_days
   where id = public.auth_org_id();
end $$;

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

-- create or replace keeps owner and grants; restated so the file is self-contained.
revoke all on function public.set_equipment_working_hours(numeric), public.set_equipment_targets(numeric, numeric, int),
  public.equipment_rental_check(uuid, date, date, numeric, text) from public, anon, authenticated;
grant execute on function public.set_equipment_working_hours(numeric), public.set_equipment_targets(numeric, numeric, int),
  public.equipment_rental_check(uuid, date, date, numeric, text) to authenticated;
