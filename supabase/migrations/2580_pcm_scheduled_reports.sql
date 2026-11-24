-- 2580_pcm_scheduled_reports.sql — TC-PC-19: Project Control Manager manages scheduled reports created by that role for readable kinds.
-- Latest restated bodies: save_scheduled_report, set_scheduled_report_enabled, archive_scheduled_report (1228 + 1530 assert_not_light),
-- scheduled_report_content (1971), scheduled_report_tick (1463), claim_email_outbox (1905).
-- drops: replaces Admin-only guard in save_scheduled_report, set_scheduled_report_enabled, archive_scheduled_report with Admin or
-- active Project Control Manager (owning PCM-created readable schedules only; Admin schedules stay read-only to PCM);
-- widens scheduled_report_content may_see_revenue for active PCM and checks scheduled_report_may_read on all recipients;
-- replaces 1463's role-only light-account filter in scheduled_report_tick with scheduled_report_may_read across both user and role arms.
-- Reverse: rollback/2580_pcm_scheduled_reports_down.sql

alter table public.organizations add column pcm_scheduled_reports_enabled boolean not null default true;
grant update(pcm_scheduled_reports_enabled) on public.organizations to authenticated;
create policy organizations_update_pcm_scheduled_reports on public.organizations for update to authenticated
  using (id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');

create policy scheduled_reports_pcm_read on public.scheduled_reports for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.is_active_member())
    and (select public.actor_holds_job_role('project_control_manager'))
    and kind in ('daily_progress', 'overdue_tasks')
    and coalesce((select o.pcm_scheduled_reports_enabled from public.organizations o where o.id = org_id), false)
  );

create or replace function public.scheduled_report_may_read(p_kind text, p_org uuid, p_recipient uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.profiles pr
     where pr.id = p_recipient
       and pr.org_id = p_org
       and public.is_active_member(pr.id)
       and not public.is_light_role_key(pr.built_in_role)
       and (
         (p_kind in ('daily_progress', 'overdue_tasks')
          and pr.role::text in ('Admin', 'Project Manager', 'Finance', 'Executive', 'Engineer'))
         or pr.role = 'Admin'
       )
  )
$$;
revoke all on function public.scheduled_report_may_read(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.scheduled_report_may_read(text, uuid, uuid) to service_role;

create or replace function public.save_scheduled_report(
  p_id uuid, p_name text, p_kind text, p_frequency text, p_weekday integer, p_send_time time,
  p_user_ids uuid[], p_roles text[], p_enabled boolean
) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_is_admin boolean;
  v_is_pcm boolean;
  v_users uuid[];
  v_roles text[];
  v_id uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_is_admin := public.auth_role() = 'Admin';
  v_is_pcm := public.actor_holds_job_role('project_control_manager')
    and coalesce((select o.pcm_scheduled_reports_enabled from public.organizations o where o.id = v_org), false);
  if not (v_is_admin or v_is_pcm) then raise exception 'admin only' using errcode = '42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then raise exception 'invalid name' using errcode = '22023'; end if;
  if not v_is_admin and p_kind not in ('daily_progress','overdue_tasks') then raise exception 'admin only' using errcode = '42501'; end if;
  if p_kind not in ('daily_progress','overdue_tasks') then raise exception 'unknown report kind' using errcode = '22023'; end if;
  if p_frequency not in ('daily','weekly') then raise exception 'unknown frequency' using errcode = '22023'; end if;
  if (p_frequency = 'weekly') <> (p_weekday is not null) or (p_weekday is not null and p_weekday not between 1 and 7) then
    raise exception 'weekday is required for weekly and only then' using errcode = '22023';
  end if;
  if p_send_time is null or p_enabled is null then raise exception 'invalid setting' using errcode = '22023'; end if;
  -- PCM may pick only active (non-banned), non-light members of their own organisation who can read this report, and non-light base roles.
  if not v_is_admin then
    if exists (
      select 1 from unnest(coalesce(p_user_ids, '{}')) u
       where not public.scheduled_report_may_read(p_kind, v_org, u)
    ) then
      raise exception 'SCH_RECIPIENT_FORBIDDEN: every recipient must be an active member of your organisation who can read this report' using errcode = '42501';
    end if;
    if exists (
      select 1 from unnest(coalesce(p_roles, '{}')) x
       where btrim(x) <> ''
         and btrim(x) not in ('Admin', 'Project Manager', 'Finance', 'Executive', 'Engineer')
    ) then
      raise exception 'SCH_RECIPIENT_FORBIDDEN: every recipient role must be a non-field role that can read this report' using errcode = '42501';
    end if;
  end if;
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
    -- PCM manages only schedules created by the project_control_manager role; Admin-created schedules remain read-only to PCM.
    if not v_is_admin and exists (
      select 1 from public.scheduled_reports sr
       where sr.id = p_id and sr.org_id = v_org and sr.archived_at is null
         and (
           sr.kind not in ('daily_progress','overdue_tasks')
           or not exists (
             select 1 from public.profiles c
              where c.id = sr.created_by
                and c.org_id = v_org
                and c.built_in_role = 'project_control_manager'
                and c.role <> 'Admin'
           )
         )
    ) then
      raise exception 'admin only' using errcode = '42501';
    end if;
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
declare
  v_org uuid := public.auth_org_id();
  v_is_admin boolean;
  v_is_pcm boolean;
  v_kind text;
  v_users uuid[];
  v_roles text[];
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_is_admin := public.auth_role() = 'Admin';
  v_is_pcm := public.actor_holds_job_role('project_control_manager')
    and coalesce((select o.pcm_scheduled_reports_enabled from public.organizations o where o.id = v_org), false);
  if not (v_is_admin or v_is_pcm) then raise exception 'admin only' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'invalid setting' using errcode = '22023'; end if;
  if not v_is_admin and exists (
    select 1 from public.scheduled_reports sr
     where sr.id = p_id and sr.org_id = v_org and sr.archived_at is null
       and (
         sr.kind not in ('daily_progress','overdue_tasks')
         or not exists (
           select 1 from public.profiles c
            where c.id = sr.created_by
              and c.org_id = v_org
              and c.built_in_role = 'project_control_manager'
              and c.role <> 'Admin'
         )
       )
  ) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if not v_is_admin and p_enabled then
    select sr.kind, sr.recipient_user_ids, sr.recipient_roles
      into v_kind, v_users, v_roles
      from public.scheduled_reports sr
     where sr.id = p_id and sr.org_id = v_org and sr.archived_at is null;
    if v_kind is not null then
      if exists (
        select 1 from unnest(coalesce(v_users, '{}')) u
         where not public.scheduled_report_may_read(v_kind, v_org, u)
      ) or exists (
        select 1 from unnest(coalesce(v_roles, '{}')) x
         where btrim(x) <> ''
           and btrim(x) not in ('Admin', 'Project Manager', 'Finance', 'Executive', 'Engineer')
      ) then
        raise exception 'SCH_RECIPIENT_FORBIDDEN: every recipient must be an active member of your organisation who can read this report' using errcode = '42501';
      end if;
    end if;
  end if;
  update public.scheduled_reports set enabled = p_enabled, updated_at = now()
   where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.set_scheduled_report_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_scheduled_report_enabled(uuid, boolean) to authenticated;

create or replace function public.archive_scheduled_report(p_id uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_is_admin boolean;
  v_is_pcm boolean;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_is_admin := public.auth_role() = 'Admin';
  v_is_pcm := public.actor_holds_job_role('project_control_manager')
    and coalesce((select o.pcm_scheduled_reports_enabled from public.organizations o where o.id = v_org), false);
  if not (v_is_admin or v_is_pcm) then raise exception 'admin only' using errcode = '42501'; end if;
  if not v_is_admin and exists (
    select 1 from public.scheduled_reports sr
     where sr.id = p_id and sr.org_id = v_org and sr.archived_at is null
       and (
         sr.kind not in ('daily_progress','overdue_tasks')
         or not exists (
           select 1 from public.profiles c
            where c.id = sr.created_by
              and c.org_id = v_org
              and c.built_in_role = 'project_control_manager'
              and c.role <> 'Admin'
         )
       )
  ) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.scheduled_reports set archived_at = now(), enabled = false, updated_at = now()
   where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.archive_scheduled_report(uuid) from public, anon;
grant execute on function public.archive_scheduled_report(uuid) to authenticated;

create or replace function public.scheduled_report_content(
  p_kind text, p_org uuid, p_recipient uuid, p_from date, p_to date, p_locale text, p_name text
) returns table (subject text, body text)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role          text;
  v_built_in_role text;
  v_cur           text;
  v_lines         text[] := '{}';
  v_head          text;
  r               record;
begin
  select pr.role::text, pr.built_in_role into v_role, v_built_in_role
    from public.profiles pr where pr.id = p_recipient and pr.org_id = p_org;
  if v_role is null then return; end if;   -- not a member of this organisation: no figures at all
  if not public.scheduled_report_may_read(p_kind, p_org, p_recipient) then return; end if;
  select o.default_currency into v_cur from public.organizations o where o.id = p_org;
  v_head := p_name || E'\n' || public.scheduled_report_text(p_locale, p_kind) || E'\n' || public.scheduled_report_text(p_locale, 'period') || ': '
            || case when p_from = p_to then p_to::text else p_from::text || ' - ' || p_to::text end;

  if p_kind = 'daily_progress' then
    for r in
      select p.name as project, count(distinct d.id) as reports,
             count(distinct d.id) filter (where d.status = 'validated') as validated,
             count(distinct l2.id) as lines,
             sum(l2.frozen_amount) filter (where d.status = 'validated') as revenue,
             (v_role in ('Admin','Finance','Executive')
              or (v_role = 'Project Manager' and p.project_manager_id = p_recipient)
              or (v_built_in_role = 'project_control_manager' and public.is_active_member(p_recipient))) as may_see_revenue
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
       and (p.id = any (r.recipient_user_ids) or p.role::text = any (r.recipient_roles))
       and nullif(btrim(p.email), '') is not null
       and public.is_active_member(p.id)
       and public.scheduled_report_may_read(r.kind, r.org_id, p.id)
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

create or replace function public.claim_email_outbox(p_limit integer default 20, p_lease interval default '5 minutes')
returns table (id uuid, to_email text, event_key text, locale text, severity text, title text, body text, attempts integer, org_id uuid)
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1..100' using errcode = '22023'; end if;
  update public.email_outbox o set status = 'failed', last_error = 'stale'
   where o.report_id is not null and o.status in ('pending','sending') and o.created_at < now() - interval '48 hours';
  update public.email_outbox o set status = 'failed', last_error = coalesce(o.last_error, 'lease expired')
   where o.status = 'sending' and o.lease_until < now() and o.attempts >= 5;
  update public.email_outbox o set status = 'failed', last_error = 'ineligible'
    from public.scheduled_reports sr
   where o.report_id = sr.id
     and o.status in ('pending','sending')
     and (
       not sr.enabled
       or sr.archived_at is not null
       or not public.scheduled_report_may_read(sr.kind, o.org_id, o.recipient_id)
       or exists (select 1 from public.email_user_prefs u where u.user_id = o.recipient_id and u.opted_out)
     );
  return query
    with picked as (
      select o.id from public.email_outbox o
       where (o.status = 'pending' or (o.status = 'sending' and o.lease_until < now())) and o.attempts < 5
       order by o.created_at limit p_limit for update skip locked
    ), upd as (
      update public.email_outbox o set status = 'sending', lease_until = now() + p_lease, attempts = o.attempts + 1
        from picked where o.id = picked.id
      returning o.id, o.org_id, o.notification_id, o.recipient_id, o.event_key, o.attempts, o.subject, o.body
    )
    select upd.id, pr.email::text, upd.event_key, coalesce(os.locale, 'en')::text,
           coalesce(n.severity::text, 'info'), coalesce(upd.subject, n.title)::text, coalesce(upd.body, n.body)::text, upd.attempts, upd.org_id
      from upd
      join public.profiles pr on pr.id = upd.recipient_id
      left join public.notifications n on n.id = upd.notification_id
      left join public.email_org_settings os on os.org_id = upd.org_id;
end $$;
revoke all on function public.claim_email_outbox(integer, interval) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(integer, interval) to service_role;
