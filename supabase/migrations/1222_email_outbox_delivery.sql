-- 1222_email_outbox_delivery.sql — #2711: the delivery side of the email channel.
-- claim_email_outbox: lease-claims pending rows (skip locked, so two runs never take the same row) and returns what the
-- edge function needs to render one email. complete_email_outbox: marks the outcome. Both service_role only.
-- email_notify_tick: pg_cron -> the edge function; a no-op until the vault url + secret exist (same shape as 0083).
-- Reverse: rollback/1222_email_outbox_delivery_down.sql

create function public.claim_email_outbox(p_limit integer default 20, p_lease interval default '5 minutes')
returns table (id uuid, to_email text, event_key text, locale text, severity text, title text, body text, attempts integer)
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1..100' using errcode = '22023'; end if;
  -- A lease that expired on the last allowed attempt is a failure, not a retry.
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
revoke all on function public.claim_email_outbox(integer, interval) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(integer, interval) to service_role;

-- ok -> sent. Otherwise a permanent failure (a 4xx) or the last allowed attempt -> failed; else back to pending.
create function public.complete_email_outbox(p_id uuid, p_ok boolean, p_error text default null, p_permanent boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.email_outbox o set
    status = case when p_ok then 'sent' when p_permanent or o.attempts >= 5 then 'failed' else 'pending' end,
    sent_at = case when p_ok then now() end,
    lease_until = null,
    last_error = case when p_ok then null else left(coalesce(p_error, 'send failed'), 300) end
   where o.id = p_id and o.status = 'sending';
end $$;
revoke all on function public.complete_email_outbox(uuid, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.complete_email_outbox(uuid, boolean, text, boolean) to service_role;

create function public.email_notify_tick() returns void
  language plpgsql security definer set search_path = public, vault, net as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'email_notify_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'email_notify_secret';
  if v_url is not null and v_url <> '' and v_secret is not null and v_secret <> '' then
    perform net.http_post(url := v_url, headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret));
  end if;
end $$;
revoke all on function public.email_notify_tick() from public, anon, authenticated;
select cron.schedule('email-notify-tick', '*/5 * * * *', 'select public.email_notify_tick()');
