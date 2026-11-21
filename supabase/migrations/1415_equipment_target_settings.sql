-- 1415_equipment_target_settings.sql — #2701: the availability target, the use target and the breakdown escalation limit are
-- organisation settings. Spec docs/specs/equipment-target-settings.spec.md; plan docs/plans/2026-11-21-equipment-target-settings.md.
-- Same pattern as equipment_working_hours (1032): a column on organizations, written only by an Admin-only definer RPC.
-- Defaults keep today's behaviour: limit 2 (the value 1033 hard-coded), no target (none existed).
-- Reverse: rollback/1415_equipment_target_settings_down.sql

alter table public.organizations
  add column equipment_availability_target_pct numeric(4,1)
    check (equipment_availability_target_pct is null or (equipment_availability_target_pct >= 0 and equipment_availability_target_pct <= 100)),
  add column equipment_utilisation_target_pct numeric(4,1)
    check (equipment_utilisation_target_pct is null or (equipment_utilisation_target_pct >= 0 and equipment_utilisation_target_pct <= 100)),
  add column equipment_escalation_down_days int not null default 2
    check (equipment_escalation_down_days between 1 and 365);

-- FR-ETS-002/003: Admin only; both targets optional (null clears); the limit is a whole number of days.
create function public.set_equipment_targets(p_availability numeric, p_utilisation numeric, p_escalation_days int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if public.auth_role() <> 'Admin' then raise exception 'not authorized' using errcode = '42501'; end if;
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

-- FR-ETS-007: any active member reads the caller's own organisation's settings.
create function public.get_equipment_targets()
returns table (availability_target_pct numeric, utilisation_target_pct numeric, escalation_down_days int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  return query select o.equipment_availability_target_pct, o.equipment_utilisation_target_pct, o.equipment_escalation_down_days
    from public.organizations o where o.id = public.auth_org_id();
end $$;

alter function public.set_equipment_targets(numeric, numeric, int) owner to postgres;
alter function public.get_equipment_targets() owner to postgres;
revoke all on function public.set_equipment_targets(numeric, numeric, int), public.get_equipment_targets() from public, anon, authenticated;
grant execute on function public.set_equipment_targets(numeric, numeric, int), public.get_equipment_targets() to authenticated;
