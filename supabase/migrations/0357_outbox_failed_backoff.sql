-- 0357_outbox_failed_backoff.sql — space out automatic retries of rejected money commands.
--
-- The erpnext-sweep now ticks every minute (0356). A `failed` row (ERP rejected the write) was offered
-- to the sweep on every tick, so the five-attempt budget (0131) would be spent in about five minutes
-- instead of the half hour or more it used to span. A failed row is now due again only 2^n minutes
-- after its last failure (n = its attempt count, exponent capped at 10): 2, 4, 8 and 16 minutes after
-- attempts 1–4. A failed row never attempted (n = 0) is due at once. The delay runs from `updated_at`,
-- which every outbox state change stamps (markOutboxFailed included).
--
-- A failed row waiting out its delay is NOT the same as one that has run out of attempts: the budget,
-- timesheet and expense passes hold a mirror whose outbox row is no longer a candidate. So the rows
-- waiting out a delay are listed separately (`outbox_retry_pending`) and those passes leave them alone,
-- as they already do for a committing row inside its lease or a quarantined row inside its window.
--
-- `outbox_reconcile_candidates` is 0131's body with one extra conjunct on the `failed` branch.
-- Rollback: rollback/0357_outbox_failed_backoff_down.sql (roll back 0356 first or together — a
-- one-minute tick without this backoff spends the retry budget in minutes).

create or replace function public.outbox_failed_retry_due(p_attempt_count int, p_updated_at timestamptz)
  returns boolean
  language sql stable set search_path = public as $$
  select p_attempt_count <= 0
      or p_updated_at <= now() - interval '1 minute' * power(2, least(p_attempt_count, 10));
  $$;

revoke all on function public.outbox_failed_retry_due(int, timestamptz) from public, anon, authenticated;
grant execute on function public.outbox_failed_retry_due(int, timestamptz) to service_role;

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
                and public.outbox_failed_retry_due(attempt_count, updated_at)   -- 0357 backoff
              )
         );
  $$;

revoke all on function public.outbox_reconcile_candidates(uuid) from public;
grant execute on function public.outbox_reconcile_candidates(uuid) to service_role;

-- The failed rows that WILL be candidates once their delay passes: within budget and age, not yet due.
create or replace function public.outbox_retry_pending(p_org_id uuid)
  returns setof uuid
  language sql stable security definer set search_path = public as $$
  select id from public.external_command_outbox
   where org_id = p_org_id
     and state = 'failed'
     and operation <> 'transition'
     and attempt_count < public.outbox_max_auto_attempts()
     and created_at > now() - public.outbox_max_auto_age()
     and not public.outbox_failed_retry_due(attempt_count, updated_at);
  $$;

revoke all on function public.outbox_retry_pending(uuid) from public, anon, authenticated;
grant execute on function public.outbox_retry_pending(uuid) to service_role;
