-- 1463 (#2711): a scheduled report chosen by role leaves the field accounts out.
-- Rollback: supabase/migrations/rollback/1463_scheduled_report_light_recipients_down.sql
-- Recipients are resolved twice in the tick: by explicit user id (an Admin named that person) and by base role. A field
-- account has no project page and no list, so the organisation-wide project summary must not reach it by email either.
-- The role arm therefore skips a light account (`is_light_role_key(built_in_role)`); a person named explicitly keeps the
-- report the Admin asked for, and nothing else about the tick changes (due time, one run per period, opted-out, address,
-- same organisation).

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
