-- 1228_scheduled_report_rpcs.sql — #2714: the only write paths for scheduled reports. Admin of the caller's own organisation.
-- Reverse: rollback/1228_scheduled_report_rpcs_down.sql

create function public.save_scheduled_report(
  p_id uuid, p_name text, p_kind text, p_frequency text, p_weekday integer, p_send_time time,
  p_user_ids uuid[], p_roles text[], p_enabled boolean
) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_users uuid[]; v_roles text[]; v_id uuid;
begin
  perform public.assert_is_active_member();
  if public.auth_role() <> 'Admin' then raise exception 'admin only' using errcode = '42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then raise exception 'invalid name' using errcode = '22023'; end if;
  if p_kind not in ('daily_progress','overdue_tasks') then raise exception 'unknown report kind' using errcode = '22023'; end if;
  if p_frequency not in ('daily','weekly') then raise exception 'unknown frequency' using errcode = '22023'; end if;
  if (p_frequency = 'weekly') <> (p_weekday is not null) or (p_weekday is not null and p_weekday not between 1 and 7) then
    raise exception 'weekday is required for weekly and only then' using errcode = '22023';
  end if;
  if p_send_time is null or p_enabled is null then raise exception 'invalid setting' using errcode = '22023'; end if;
  -- recipients: people of this organisation only; roles trimmed and de-duplicated
  select coalesce(array_agg(distinct pr.id), '{}') into v_users from public.profiles pr
    where pr.org_id = v_org and pr.id = any (coalesce(p_user_ids, '{}'));
  select coalesce(array_agg(distinct btrim(x)), '{}') into v_roles from unnest(coalesce(p_roles, '{}')) x where btrim(x) <> '';
  if cardinality(v_users) + cardinality(v_roles) not between 1 and 50 then
    raise exception 'between 1 and 50 recipients are required' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.scheduled_reports (org_id, name, kind, frequency, weekday, send_time, recipient_user_ids, recipient_roles, enabled, created_by)
      values (v_org, btrim(p_name), p_kind, p_frequency, p_weekday, p_send_time, v_users, v_roles, p_enabled, auth.uid())
      returning id into v_id;
  else
    update public.scheduled_reports set name = btrim(p_name), kind = p_kind, frequency = p_frequency, weekday = p_weekday,
           send_time = p_send_time, recipient_user_ids = v_users, recipient_roles = v_roles, enabled = p_enabled, updated_at = now()
     where id = p_id and org_id = v_org and archived_at is null returning id into v_id;
    if v_id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.save_scheduled_report(uuid, text, text, text, integer, time, uuid[], text[], boolean) from public, anon;
grant execute on function public.save_scheduled_report(uuid, text, text, text, integer, time, uuid[], text[], boolean) to authenticated;

create function public.set_scheduled_report_enabled(p_id uuid, p_enabled boolean) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if public.auth_role() <> 'Admin' then raise exception 'admin only' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'invalid setting' using errcode = '22023'; end if;
  update public.scheduled_reports set enabled = p_enabled, updated_at = now()
   where id = p_id and org_id = public.auth_org_id() and archived_at is null;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.set_scheduled_report_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_scheduled_report_enabled(uuid, boolean) to authenticated;

create function public.archive_scheduled_report(p_id uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if public.auth_role() <> 'Admin' then raise exception 'admin only' using errcode = '42501'; end if;
  update public.scheduled_reports set archived_at = now(), enabled = false, updated_at = now()
   where id = p_id and org_id = public.auth_org_id() and archived_at is null;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.archive_scheduled_report(uuid) from public, anon;
grant execute on function public.archive_scheduled_report(uuid) to authenticated;
