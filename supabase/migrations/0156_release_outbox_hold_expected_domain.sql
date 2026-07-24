-- 0156_release_outbox_hold_expected_domain.sql — FU-2 MEDIUM 6, re-homed out of shipped 0137.
--
-- ⚑ WHY THIS FILE EXISTS AT ALL (FU-2 round 2, SHOULD-FIX). The expected-domain guard was originally
-- added by EDITING `0137_budget_push_seam.sql` in place. `supabase db push` / `migration up` apply only
-- UNAPPLIED versions, so any database already at >= 0137 would never have re-run it: it would keep the
-- 2-arg `release_outbox_hold` while `repositories/budgetProjection.ts` always calls the 3-arg form, and
-- the Release affordance would die with PostgREST `PGRST202` (function not found) — invisible locally,
-- because `db reset` replays from scratch. A shipped migration is immutable; a redefinition goes in a
-- NEW one. (This branch already does exactly that twice: `record_outbox_ref` in 0154,
-- `get_budget_projection` in 0153.)
--
-- ⚑ THE DROP IS LOAD-BEARING, NOT TIDINESS. `create or replace function` matches on the ARGUMENT LIST,
-- so creating `(uuid, text, text default null)` beside 0137's `(uuid, text)` leaves BOTH in the
-- catalogue — and then every 2-arg call (`release_outbox_hold(id, reason)`, the timesheet lane and the
-- pgTAP tests) is ambiguous: `42725 function ... is not unique`. Dropping the 2-arg definition first is
-- what makes the overload a REPLACEMENT. 2-arg callers then resolve here through the default and are
-- byte-for-byte unaffected (`p_expected_domain is null` ⇒ no assertion at all).
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚑⚑ MERGE NOTE — READ BEFORE RECONCILING WITH `feat/timesheet-reopen`. ⚑⚑
--
-- That branch ALSO redefines `release_outbox_hold`, as the 2-arg `(uuid, text)`. If the two land as
-- SEPARATE function definitions, the database ends up holding both `release_outbox_hold(uuid, text)`
-- and `release_outbox_hold(uuid, text, text default null)`, and EVERY 2-arg call in the codebase starts
-- failing with `42725` (ambiguous). Whoever merges must land ONE definition: keep this file's
--
--     drop function if exists public.release_outbox_hold(uuid, text);
--
-- immediately before the reconciled 3-arg `create`, and fold the timesheet branch's body changes INTO
-- that single definition rather than re-creating the 2-arg form in a later migration.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚑ WHAT THE GUARD DOES. `p_expected_domain` defaults to NULL, which is byte-for-byte the shipped
-- behaviour. When a caller DOES state a domain (the budget banner passes 'budget'), the RPC verifies the
-- LOCKED row's domain matches before releasing — so a colliding held row from ANOTHER domain (a random
-- PMO-id collision) can never be released through the budget UI. Cross-domain identity safety enforced
-- at the authority (DEFINER) boundary, not only in the client's select. The check sits AFTER the
-- `FOR UPDATE` (so it cannot be read stale) and BEFORE the authz block (which is unchanged).
--
-- Everything else below is 0137's shipped body, verbatim.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual reverse — re-run 0137's own
-- definition after `drop function if exists public.release_outbox_hold(uuid, text, text);`.

drop function if exists public.release_outbox_hold(uuid, text);

create or replace function public.release_outbox_hold(p_outbox_id uuid, p_reason text, p_expected_domain text default null)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_org    uuid;
  v_state  text;
  v_domain text;
  v_actor  uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Load + LOCK the row: serializes a concurrent release against a live claimant's own fenced
  -- write-back, so the state check below cannot be read stale.
  select o.org_id, o.state, o.domain into v_org, v_state, v_domain
    from public.external_command_outbox o where o.id = p_outbox_id for update;
  if v_org is null then
    raise exception 'outbox command not found' using errcode = 'P0002';
  end if;

  -- ⚑ FU-2 MEDIUM 6: when the caller states which domain it believes it is releasing, the locked row
  -- MUST be that domain — never release another domain's colliding held command. NULL ⇒ no assertion
  -- (the shipped domain-general behaviour, retained for the timesheet lane's 2-arg callers).
  if p_expected_domain is not null and v_domain is distinct from p_expected_domain then
    raise exception 'outbox command is domain % — the caller expected %', v_domain, p_expected_domain using errcode = '42501';
  end if;

  -- Org + Admin + active-membership re-assertion — MUST STAY (0137's header: DEFINER bypasses RLS and
  -- this is directly reachable by any authenticated caller).
  if v_org is distinct from public.auth_org_id()
     or public.auth_role() is distinct from 'Admin'
     or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Only a HELD row has a hold to release. Never resurrect a confirmed/committing/failed row: a
  -- `confirmed` command already landed in the client's ERP, and re-opening it for the backstop would
  -- re-drive a settled money write.
  if v_state is distinct from 'held' then
    raise exception 'outbox command is % — only a held command can be released', v_state using errcode = 'P0001';
  end if;

  -- `failed`, never `pending`: the recovery machinery treats both identically as claimable, and `failed`
  -- preserves the fact that this command has a FAILURE HISTORY. `claim_generation` is bumped so any
  -- still-running claimant's late write-back is fenced out (F4).
  update public.external_command_outbox
     set state            = 'failed',
         last_error       = 'hold released by operator ' || v_actor::text || ': ' || coalesce(p_reason, ''),
         claim_generation = claim_generation + 1,
         updated_at       = now()
   where id = p_outbox_id;

  perform public.log_audit(
    'release_outbox_hold',
    v_org,
    v_actor,
    p_outbox_id,
    jsonb_build_object('reason', p_reason, 'released_from', v_state)
  );
end;
$$;

revoke all     on function public.release_outbox_hold(uuid, text, text) from public;
grant  execute on function public.release_outbox_hold(uuid, text, text) to   authenticated;
revoke execute on function public.release_outbox_hold(uuid, text, text) from anon;
