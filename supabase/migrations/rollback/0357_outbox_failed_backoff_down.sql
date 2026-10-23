-- Down for 0357: restore the 0131 body of outbox_reconcile_candidates (no retry backoff) and drop the
-- helpers. Roll back 0356 (the one-minute tick) before or together with this file: a one-minute tick
-- without the backoff spends a rejected command's five automatic retries in about five minutes.

create or replace function public.outbox_reconcile_candidates(p_org_id uuid)
  returns setof public.external_command_outbox
  language sql security definer set search_path = public as $$
  select * from public.external_command_outbox
   where org_id = p_org_id
     and (
           -- Finalize-only (no new ERP write): always converge, at any age.
           state = 'committed'
           -- F1 safety transitions: a stale claim must always be quarantinable, and a quarantined row
           -- must always be resolvable once its visibility window elapses (adopt-or-hold).
           or (state = 'committing' and updated_at < now() - interval '60 seconds')
           or (state = 'quarantined' and reconcile_after is not null and reconcile_after < now())
           -- Paths that may issue a NEW ERP write are bounded (BLOCK 3).
           or (state = 'pending' and created_at > now() - public.outbox_max_auto_age())
           or (
                state = 'failed'
                and operation <> 'transition'                       -- a rejected human decision is terminal
                and attempt_count < public.outbox_max_auto_attempts()
                and created_at > now() - public.outbox_max_auto_age()
              )
         );
  $$;

revoke all on function public.outbox_reconcile_candidates(uuid) from public;
grant execute on function public.outbox_reconcile_candidates(uuid) to service_role;

drop function if exists public.outbox_retry_pending(uuid);
drop function if exists public.outbox_failed_retry_due(int, timestamptz);
