-- 0357_outbox_failed_backoff.sql — space out automatic retries of rejected money commands.
--
-- The erpnext-sweep now ticks every minute (0356). A `failed` row (ERP rejected the write) was offered
-- to the sweep on every tick, so the five-attempt budget (0131) would be spent in about five minutes
-- instead of the half hour or more it used to span. A failed row is now offered again only after
-- 2^n minutes since its last failure, where n is its attempt count: 2, 4, 8 and 16 minutes after
-- attempts 1–4, about 30 minutes across the budget. A failed row never attempted (n = 0) is offered at
-- once. The delay is measured from `updated_at`, which every outbox state change stamps.
--
-- Body is 0131's with that one extra conjunct on the `failed` branch; every other condition is kept.
-- Rollback: rollback/0357_outbox_failed_backoff_down.sql

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
                -- 0357: exponential backoff since the last failure (2^attempt_count minutes).
                and (attempt_count = 0 or updated_at <= now() - make_interval(mins => power(2, attempt_count)::int))
              )
         );
  $$;

revoke all on function public.outbox_reconcile_candidates(uuid) from public;
grant execute on function public.outbox_reconcile_candidates(uuid) to service_role;
