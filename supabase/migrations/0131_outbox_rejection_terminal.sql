-- 0131_outbox_rejection_terminal.sql — BLOCK 3 (money-safety audit): a classified REJECTION is
-- TERMINAL for AUTOMATIC recovery.
--
-- The defect: `outbox_reconcile_candidates` (0096) offered every `failed` row, forever and unbounded.
-- The sweep's recovery pass rebuilds the command from the FROZEN payload and calls `dispatchMoneyWrite`
-- directly, so the replay bypasses every dispatch gate (`checkErpnextCommandAuthorization`,
-- `enforceSiSubmitSod`, `get_process_gates`, `checkTransitionTargetBinding`,
-- `checkCreateTargetUnmapped`) and the original caller may since have been demoted or deactivated.
-- Sequence: Finance clicks "Cancel invoice"; ERP rejects it (a linked submitted doc); the org decides to
-- KEEP the invoice. Days later somebody cancels the blocking doc for unrelated reasons — the next tick
-- replays the frozen cancel, it now succeeds, and a live invoice is cancelled (AR reversed) with nobody
-- asking. The same shape mints a doc the user was told was rejected, or posts revenue with no click.
--
-- The rule this migration enforces, in the ONE place the sweep selects its work:
--   • a `transition` (submit/cancel/amend) rejection is NEVER auto-reissued — it encodes a human
--     decision at a point in time, not a durable intent;
--   • any other rejection is bounded by an attempt budget AND a max row age;
--   • a stale `pending` row (never claimed ⇒ no ERP doc) is bounded by the same max row age, so a
--     command whose moment has passed is not replayed days later;
--   • rows that involve NO new ERP write — `committed` (finalize-only: ref + mirror + confirm) — and
--     the F1 safety transitions (`committing`-past-lease → quarantine, `quarantined`-past-window)
--     keep converging unbounded.
-- The SYNCHRONOUS human-retry path is deliberately untouched: `claim_outbox_for_commit` still claims a
-- `failed` row, because a person clicking "try again" IS making the decision now. Only the automatic
-- (sweep) path is bounded. An abandoned row stays exactly as it is — org-member-SELECT-able with its
-- `last_error` — for an operator, and is never silently dropped.
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback = re-create the 0096 body (the version
-- immediately above this one in git history).

-- The automatic-reissue budget: how many recovery attempts an ERP-rejected command may consume before
-- it is left to an operator. `attempt_count` is bumped by every `claim_outbox_for_commit` win (0096) —
-- it was written but never read until now.
create or replace function public.outbox_max_auto_attempts() returns int
  language sql immutable set search_path = public as $$ select 5 $$;

-- How old an outbox row may be and still be driven by the AUTOMATIC path. Past it, replaying a frozen
-- money command is no longer "finishing what the user started" — the world has moved on.
create or replace function public.outbox_max_auto_age() returns interval
  language sql immutable set search_path = public as $$ select interval '24 hours' $$;

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
revoke all on function public.outbox_max_auto_attempts() from public;
revoke all on function public.outbox_max_auto_age() from public;
