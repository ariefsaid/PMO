-- 1905_email_outbox_claim_org.sql — claim_email_outbox also returns the row's org_id (terminology reach, #2799), so the email
-- function can look up the recipient organisation's own words once per org. Body restated from the 1227 definition, one
-- column added to the return type and to the final select; revoke/grant as in 1222.
-- The return type changes, so the function is dropped and created.
-- drops: claim_email_outbox rewrites its final select line to append upd.org_id; no read or write is removed.
-- Reversal: supabase/migrations/rollback/1905_email_outbox_claim_org_down.sql

drop function if exists public.claim_email_outbox(integer, interval);
create function public.claim_email_outbox(p_limit integer default 20, p_lease interval default '5 minutes')
returns table (id uuid, to_email text, event_key text, locale text, severity text, title text, body text, attempts integer, org_id uuid)
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
           coalesce(n.severity::text, 'info'), coalesce(upd.subject, n.title)::text, coalesce(upd.body, n.body)::text, upd.attempts, upd.org_id
      from upd
      join public.profiles pr on pr.id = upd.recipient_id
      left join public.notifications n on n.id = upd.notification_id
      left join public.email_org_settings os on os.org_id = upd.org_id;
end $$;
revoke all on function public.claim_email_outbox(integer, interval) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(integer, interval) to service_role;
