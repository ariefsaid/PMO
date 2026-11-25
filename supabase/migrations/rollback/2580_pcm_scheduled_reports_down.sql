-- Rollback 2580_pcm_scheduled_reports.sql: restore 1463 scheduled_report_tick,
-- 1971 scheduled_report_content, 1228+1530 RPCs; drop both helpers, the PCM policy, the managing-role column and the switch column.

create or replace function public.scheduled_report_tick() returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record; v_local timestamp; v_date date; v_key text; v_from date; v_rows integer; v_total integer := 0;
begin
  for r in
    select sr.*, o.default_timezone as tz, coalesce(os.locale, 'en') as loc
      from public.scheduled_reports sr
      join public.organizations o on o.id = sr.org_id
      left join public.email_org_settings os on os.org_id = sr.org_id
     where sr.enabled and sr.archived_at is null
  loop
    v_local := now() at time zone r.tz;
    v_date  := v_local::date;
    continue when v_local::time < r.send_time;
    continue when r.frequency = 'weekly' and extract(isodow from v_date)::int <> r.weekday;
    continue when r.created_at > ((v_date + r.send_time) at time zone r.tz);
    v_key  := r.kind || ':' || v_date::text;
    v_from := case when r.frequency = 'weekly' then v_date - 6 else v_date end;
    insert into public.scheduled_report_runs (report_id, period_key, org_id) values (r.id, v_key, r.org_id)
      on conflict do nothing;
    get diagnostics v_rows = row_count;
    continue when v_rows = 0;
    insert into public.email_outbox (org_id, recipient_id, event_key, report_id, period_key, subject, body)
    select r.org_id, p.id, 'scheduled_report', r.id, v_key, c.subject, c.body
      from public.profiles p
      cross join lateral public.scheduled_report_content(r.kind, r.org_id, p.id, v_from, v_date, r.loc, r.name) c
     where p.org_id = r.org_id
       and (p.id = any (r.recipient_user_ids)
            or (p.role::text = any (r.recipient_roles) and not public.is_light_role_key(p.built_in_role)))
       and nullif(btrim(p.email), '') is not null
       and public.is_active_member(p.id)
       and not exists (select 1 from public.email_user_prefs u where u.user_id = p.id and u.opted_out)
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    update public.scheduled_report_runs set queued = v_rows where report_id = r.id and period_key = v_key;
    v_total := v_total + v_rows;
  end loop;
  -- Retention: finished report rows and run records are kept 90 days.
  delete from public.email_outbox where report_id is not null and status in ('sent','failed') and created_at < now() - interval '90 days';
  delete from public.scheduled_report_runs where created_at < now() - interval '90 days';
  return v_total;
end $$;
revoke all on function public.scheduled_report_tick() from public, anon, authenticated;
grant execute on function public.scheduled_report_tick() to service_role;

create or replace function public.scheduled_report_content(
  p_kind text, p_org uuid, p_recipient uuid, p_from date, p_to date, p_locale text, p_name text
) returns table (subject text, body text)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role   text;
  v_cur    text;
  v_lines  text[] := '{}';
  v_head   text;
  r        record;
begin
  select pr.role::text into v_role from public.profiles pr where pr.id = p_recipient and pr.org_id = p_org;
  if v_role is null then return; end if;   -- not a member of this organisation: no figures at all
  select o.default_currency into v_cur from public.organizations o where o.id = p_org;
  v_head := p_name || E'\n' || public.scheduled_report_text(p_locale, p_kind) || E'\n' || public.scheduled_report_text(p_locale, 'period') || ': '
            || case when p_from = p_to then p_to::text else p_from::text || ' - ' || p_to::text end;

  if p_kind = 'daily_progress' then
    for r in
      select p.name as project, count(distinct d.id) as reports,
             count(distinct d.id) filter (where d.status = 'validated') as validated,
             count(distinct l2.id) as lines,
             sum(l2.frozen_amount) filter (where d.status = 'validated') as revenue,
             (v_role in ('Admin','Finance','Executive') or (v_role = 'Project Manager' and p.project_manager_id = p_recipient)) as may_see_revenue
        from public.daily_site_reports d
        join public.projects p on p.id = d.project_id and p.org_id = p_org
        left join public.dsr_progress_lines l2 on l2.report_id = d.id and l2.org_id = p_org
       where d.org_id = p_org and d.work_date between p_from and p_to
         and d.archived_at is null and d.superseded_at is null and d.status <> 'draft'
       group by p.id, p.name, p.project_manager_id
       order by p.name
    loop
      v_lines := v_lines || (r.project || ': ' || r.reports || ' ' || public.scheduled_report_text(p_locale, 'reports')
        || ' (' || r.validated || ' ' || public.scheduled_report_text(p_locale, 'validated') || '), '
        || r.lines || ' ' || public.scheduled_report_text(p_locale, 'lines')
        || case when r.may_see_revenue and r.revenue is not null
                then ', ' || public.scheduled_report_text(p_locale, 'revenue') || ' ' || to_char(r.revenue, 'FM999999999990.00') || ' ' || v_cur
                else '' end);
    end loop;
    if cardinality(v_lines) = 0 then v_lines := array[public.scheduled_report_text(p_locale, 'nothing_progress')]; end if;
    return query select p_name, v_head || E'\n\n' || array_to_string(v_lines, E'\n');

  elsif p_kind = 'overdue_tasks' then
    for r in
      select p.name as project, count(*) as n
        from public.tasks t
        join public.projects p on p.id = t.project_id and p.org_id = p_org
       where t.org_id = p_org and t.status <> 'Done' and t.tombstoned_at is null and t.end_date < p_to
         and not exists (select 1 from public.tasks c where c.parent_task_id = t.id and c.archived_at is null and c.tombstoned_at is null)   -- #2807: leaves only
       group by p.id, p.name order by p.name
    loop
      v_lines := v_lines || (r.project || ': ' || r.n || ' ' || public.scheduled_report_text(p_locale, 'overdue'));
    end loop;
    if cardinality(v_lines) = 0 then v_lines := array[public.scheduled_report_text(p_locale, 'nothing_overdue')]; end if;
    return query select p_name, v_head || E'\n\n' || array_to_string(v_lines, E'\n');
  end if;
end $$;
revoke all on function public.scheduled_report_content(text, uuid, uuid, date, date, text, text) from public, anon, authenticated;

create or replace function public.save_scheduled_report(
  p_id uuid, p_name text, p_kind text, p_frequency text, p_weekday integer, p_send_time time,
  p_user_ids uuid[], p_roles text[], p_enabled boolean
) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_users uuid[]; v_roles text[]; v_id uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() <> 'Admin' then raise exception 'admin only' using errcode = '42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then raise exception 'invalid name' using errcode = '22023'; end if;
  if p_kind not in ('daily_progress','overdue_tasks') then raise exception 'unknown report kind' using errcode = '22023'; end if;
  if p_frequency not in ('daily','weekly') then raise exception 'unknown frequency' using errcode = '22023'; end if;
  if (p_frequency = 'weekly') <> (p_weekday is not null) or (p_weekday is not null and p_weekday not between 1 and 7) then
    raise exception 'weekday is required for weekly and only then' using errcode = '22023';
  end if;
  if p_send_time is null or p_enabled is null then raise exception 'invalid setting' using errcode = '22023'; end if;
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

create or replace function public.set_scheduled_report_enabled(p_id uuid, p_enabled boolean) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() <> 'Admin' then raise exception 'admin only' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'invalid setting' using errcode = '22023'; end if;
  update public.scheduled_reports set enabled = p_enabled, updated_at = now()
   where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.set_scheduled_report_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_scheduled_report_enabled(uuid, boolean) to authenticated;

create or replace function public.archive_scheduled_report(p_id uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() <> 'Admin' then raise exception 'admin only' using errcode = '42501'; end if;
  update public.scheduled_reports set archived_at = now(), enabled = false, updated_at = now()
   where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.archive_scheduled_report(uuid) from public, anon;
grant execute on function public.archive_scheduled_report(uuid) to authenticated;

drop function if exists public.scheduled_report_may_read(text, uuid, uuid);
drop function if exists public.scheduled_report_pcm_may_change(uuid, uuid);
drop policy if exists scheduled_reports_pcm_read on public.scheduled_reports;
revoke update(pcm_scheduled_reports_enabled) on public.organizations from authenticated;
drop policy if exists organizations_update_pcm_scheduled_reports on public.organizations;
alter table public.organizations drop column if exists pcm_scheduled_reports_enabled;
alter table public.scheduled_reports drop column if exists managed_by;
