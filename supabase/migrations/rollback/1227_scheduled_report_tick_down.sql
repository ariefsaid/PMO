select cron.unschedule('scheduled-report-tick') where exists (select 1 from cron.job where jobname = 'scheduled-report-tick');
drop function if exists public.scheduled_report_tick();
-- restore the 1222 claim (notification-only join)
create or replace function public.claim_email_outbox(p_limit integer default 20, p_lease interval default '5 minutes')
returns table (id uuid, to_email text, event_key text, locale text, severity text, title text, body text, attempts integer)
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1..100' using errcode = '22023'; end if;
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
      returning o.id, o.org_id, o.notification_id, o.recipient_id, o.event_key, o.attempts
    )
    select upd.id, pr.email::text, upd.event_key, coalesce(os.locale, 'en')::text, n.severity::text, n.title::text, n.body::text, upd.attempts
      from upd
      join public.notifications n on n.id = upd.notification_id
      join public.profiles pr on pr.id = upd.recipient_id
      left join public.email_org_settings os on os.org_id = upd.org_id;
end $$;
