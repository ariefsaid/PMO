-- Reverse of 1299: restore the 1250 bodies of labour_rate_locked, save_labour_cost_settings, end_labour_cost_rate
-- and archive_labour_cost_rate exactly — with the literal active-member gate merge r1 added to every definer writer.
create or replace function public.labour_rate_locked(p_org uuid, p_rate uuid, p_kind text, p_person uuid, p_role text, p_from date)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.labour_cost_enabled(p_org) and exists (
    select 1 from public.timesheet_entries e
      join public.timesheets t on t.id = e.timesheet_id and t.org_id = p_org and t.status = 'Approved'
     where e.org_id = p_org and e.hours > 0 and e.entry_date >= p_from
       and (case when p_rate is not null then
                   exists (select 1 from public.labour_rate_for(p_org, t.user_id, e.entry_date) x where x.id = p_rate)
                 when p_kind = 'person' then t.user_id = p_person
                 else exists (select 1 from public.profiles pr where pr.id = t.user_id and pr.role::text = p_role) end)
       and (p_rate is not null or exists (select 1 from public.labour_rate_for(p_org, t.user_id, e.entry_date)))
  )
$$;
revoke all on function public.labour_rate_locked(uuid, uuid, text, uuid, text, date) from public, anon, authenticated;

create or replace function public.save_labour_cost_settings(p_enabled boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.labour_cost_gate();
begin
  perform public.assert_is_active_member();
  if p_enabled is null then raise exception 'enabled is required' using errcode = '22023'; end if;
  insert into public.labour_cost_settings (org_id, enabled, updated_by) values (v_org, p_enabled, auth.uid())
    on conflict (org_id) do update set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
  if p_enabled and not exists (select 1 from public.labour_cost_classes c where c.org_id = v_org) then
    insert into public.labour_cost_classes (org_id, code, name)
      values (v_org, 'direct', 'Direct'), (v_org, 'indirect', 'Indirect'), (v_org, 'guard', 'Guard');
  end if;
end $$;
revoke all on function public.save_labour_cost_settings(boolean) from public, anon;
grant execute on function public.save_labour_cost_settings(boolean) to authenticated;

create or replace function public.end_labour_cost_rate(p_id uuid, p_end date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.labour_cost_gate(); r public.labour_cost_rates;
begin
  perform public.assert_is_active_member();
  select * into r from public.labour_cost_rates where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'rate not found' using errcode = 'P0002'; end if;
  if p_end is null or p_end < r.effective_from then raise exception 'end date is before the start date' using errcode = '22023'; end if;
  if public.labour_rate_locked(v_org, p_id, null, null, null, p_end + 1) then
    raise exception 'LCM_RATE_LOCKED: hours after that date are already priced by this rate' using errcode = '23514';
  end if;
  update public.labour_cost_rates set effective_to = p_end where id = p_id;
end $$;
revoke all on function public.end_labour_cost_rate(uuid, date) from public, anon;
grant execute on function public.end_labour_cost_rate(uuid, date) to authenticated;

create or replace function public.archive_labour_cost_rate(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.labour_cost_gate();
begin
  perform public.assert_is_active_member();
  if not exists (select 1 from public.labour_cost_rates where id = p_id and org_id = v_org and archived_at is null) then
    raise exception 'rate not found' using errcode = 'P0002';
  end if;
  if public.labour_rate_locked(v_org, p_id, null, null, null, date '0001-01-01') then
    raise exception 'LCM_RATE_LOCKED: hours are already priced by this rate' using errcode = '23514';
  end if;
  update public.labour_cost_rates set archived_at = now() where id = p_id;
end $$;
revoke all on function public.archive_labour_cost_rate(uuid) from public, anon;
grant execute on function public.archive_labour_cost_rate(uuid) to authenticated;
