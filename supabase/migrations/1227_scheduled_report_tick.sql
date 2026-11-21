-- 1227_scheduled_report_tick.sql — #2714: the tick that queues due scheduled reports, and the claim that delivers them.
-- A report is due when, in the organisation's timezone, its local send time has passed for the current local date (and, if
-- weekly, today is its weekday) and no run exists for that period. The run row and the outbox rows are written in one
-- transaction; the unique (report, period) run key and the unique (report, period, recipient) outbox key make a re-run or an
-- overlapping tick a no-op. A report created after its time today waits for the next period (no retroactive send).
-- Recipients: listed people plus every active member holding a listed role, same organisation only, with an address, not
-- opted out. Reverse: rollback/1227_scheduled_report_tick_down.sql

create function public.scheduled_report_tick() returns integer
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
select cron.schedule('scheduled-report-tick', '*/5 * * * *', 'select public.scheduled_report_tick()');

-- Claim: same contract as 1222. Report rows carry their own subject and body; a report row still pending after 48 hours is
-- failed rather than sent late (the sender was off or the function down).
create or replace function public.claim_email_outbox(p_limit integer default 20, p_lease interval default '5 minutes')
returns table (id uuid, to_email text, event_key text, locale text, severity text, title text, body text, attempts integer)
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1..100' using errcode = '22023'; end if;
  update public.email_outbox o set status = 'failed', last_error = 'stale'
   where o.report_id is not null and o.status in ('pending','sending') and o.created_at < now() - interval '48 hours';
  update public.email_outbox o set status = 'failed', last_error = coalesce(o.last_error, 'lease expired')
   where o.status = 'sending' and o.lease_until < now() and o.attempts >= 5;
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
           coalesce(n.severity::text, 'info'), coalesce(upd.subject, n.title)::text, coalesce(upd.body, n.body)::text, upd.attempts
      from upd
      join public.profiles pr on pr.id = upd.recipient_id
      left join public.notifications n on n.id = upd.notification_id
      left join public.email_org_settings os on os.org_id = upd.org_id;
end $$;
