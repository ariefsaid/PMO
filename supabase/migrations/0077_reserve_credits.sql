-- 0077_reserve_credits.sql — atomic check-and-hold credit reservation (closes the TOCTOU overspend
-- race in the credit RateGuard — audit CRITICAL). The guard (supabase/functions/_shared/creditRateGuard.ts)
-- was a READ-ONLY preflight: it read org_credit_balance(org) BEFORE the model call and allowed the turn
-- when balance > 0; the agent_usage.cost row is written AFTER the call (insertUsageRow, _shared/usage.ts).
-- N concurrent turns for one org all read the SAME balance, all pass, all spend → the org goes negative
-- (unbounded overspend). Credits enforcement is still OFF in prod (AGENT_CREDITS_ENFORCED); this is the
-- pre-enablement hardening that must be correct before it ever flips on.
--
--   reserve_credits() holds a PER-ORG advisory transaction lock, counts UNRELEASED reservations against
--   `available`, and atomically inserts a hold only when available >= amount — so a concurrent second
--   reserve blocks on the lock, then sees the first's hold in `available` and is rejected (23514).
--   release_credits() drops the hold once the real agent_usage.cost row has landed, so the spend is
--   counted EXACTLY ONCE (as actual usage, not as a held reservation).
--
-- Reservation accounting (the money-path formula, same sums as org_credit_balance 0067 MINUS open holds):
--   available(org) = Σ credits.amount − Σ agent_usage.cost − Σ credit_reservations.amount(released_at IS NULL)
--
-- Posture (mirrors agent_dispatch_watermarks, 0048): RLS ENABLE+FORCE, NO policy → default-deny to every
-- JWT role; only the SECURITY-DEFINER functions here (run as their postgres owner, bypassing RLS) +
-- service_role (which bypasses RLS) ever touch the table. No grant to authenticated/anon
-- (`auto_expose_new_tables = false`, 0075 — a brand-new table is NOT auto-exposed, so omitting a GRANT
-- leaves it service-role-only by default, exactly the intent).
--
-- Reversibility (ADR-0006): `supabase db reset`. Manual reverse:
--   drop function if exists public.release_credits(uuid);
--   drop function if exists public.reserve_credits(uuid,numeric,uuid);
--   drop index    if exists public.credit_reservations_open_org_idx;
--   drop table    if exists public.credit_reservations;

create table public.credit_reservations (
  id          uuid        primary key default gen_random_uuid(),
  org_id      uuid        not null,
  run_id      uuid,                          -- the agent run this hold belongs to (nullable: a hold MAY
                                             -- be created without an agent_run; release_credits keys by it
                                             -- when present, so callers WITHOUT a run id must reconcile
                                             -- the hold another way — see creditRateGuard.ts note).
  amount      numeric     not null check (amount > 0),
  created_at  timestamptz not null default now(),
  released_at timestamptz                     -- NULL = held; set by release_credits once the real
                                             -- agent_usage.cost row has landed (the hold is then dropped
                                             -- so it isn't double-counted against available).
);

alter table public.credit_reservations enable row level security;
alter table public.credit_reservations force  row level security;
-- NO policy is created: default-deny to every JWT role (mirrors agent_dispatch_watermarks, 0048). Only
-- the security-definer functions below (run as their postgres owner, bypassing RLS) + service_role
-- (which bypasses RLS) ever read/write this table.

-- Available-balance sum fast path: the LIVE (unreleased) holds for an org, used by reserve_credits'
-- availability check. Partial index (released_at IS NULL) keeps it to just open holds.
create index credit_reservations_open_org_idx
  on public.credit_reservations (org_id) where released_at is null;

-- ── reserve_credits: atomically reserve p_amount against the org pool under a per-org txn advisory lock.
--    plpgsql + security definer so the function (owned by postgres, bypassing RLS) can INSERT into the
--    policy-less credit_reservations and read credits/agent_usage directly. The advisory lock +
--    counting UNRELEASED reservations is what closes the TOCTOU race: a concurrent second reserve for
--    the same org blocks on the lock, then sees the first's hold in `available` and is rejected. ──
create or replace function public.reserve_credits(
  p_org_id uuid,
  p_amount numeric,
  p_run_id uuid
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_available numeric;
  v_id        uuid;
begin
  -- Guards (identical spirit to org_credit_balance, 0067): an ACTIVE member reserves for their OWN org
  -- only, and the amount is positive. errcodes mirror 0067's (42501 auth; 23514 bad-amount) so the
  -- existing guard UX classifies them unchanged; the 23514 raised BELOW (insufficient_credits) is the
  -- out-of-credits signal the guard maps to reason:'out_of_credits'.
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if p_org_id is null or p_org_id <> public.auth_org_id() then
    raise exception 'org_mismatch' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_positive' using errcode = '23514';
  end if;

  -- Serialize ALL reservers for THIS org for the txn (one global-per-org lock). Reservations are
  -- sub-second, so the contention is negligible. hashtext is 32-bit — a cross-org hash collision only
  -- causes UNNECESSARY serialization (two orgs sharing a key wait for each other), never a correctness
  -- breach (the p_org_id = auth_org_id() guard + the per-org WHERE on every sum keep the books exact).
  perform pg_advisory_xact_lock(hashtext('credits:' || p_org_id::text));

  select coalesce((select sum(amount) from public.credits             where org_id = p_org_id), 0)
       - coalesce((select sum(cost)   from public.agent_usage         where org_id = p_org_id), 0)
       - coalesce((select sum(amount) from public.credit_reservations where org_id = p_org_id and released_at is null), 0)
    into v_available;

  if v_available >= p_amount then
    insert into public.credit_reservations (org_id, run_id, amount)
      values (p_org_id, p_run_id, p_amount)
      returning id into v_id;
    return v_id;
  end if;

  -- Insufficient credits: the caller (creditRateGuard) maps errcode 23514 to the EXISTING out-of-credits
  -- UX (the SAME errcode operator_grant_credits uses for amount<=0; the guard distinguishes it from a
  -- meter_error — any OTHER errcode is a genuine RPC failure).
  raise exception 'insufficient_credits' using errcode = '23514';
end $$;

-- ── release_credits: drop the hold for a run once the real agent_usage.cost row has landed (the spend
--    is then counted EXACTLY ONCE — as actual usage, not as a held reservation). Idempotent: a second
--    call is a 0-row update (the WHERE released_at IS NULL guard). Caller-org-scoped: a member can only
--    release their OWN org's holds (the p_org_id = auth_org_id() guard on reserve_credits guarantees a
--    cross-org run_id cannot exist, but the org_id predicate is re-asserted here as defense-in-depth). ──
create or replace function public.release_credits(p_run_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if p_run_id is null then
    -- Nothing to release. A reservation created WITHOUT a run id (run_id NULL) cannot be keyed by this
    -- function; such holds must be reconciled another way (a TTL reaper, or a keyed-by-reservation-id
    -- release path — a lifecycle decision deferred to the wiring issue, see creditRateGuard.ts note).
    return;
  end if;
  update public.credit_reservations
     set released_at = now()
   where run_id = p_run_id
     and org_id = public.auth_org_id()
     and released_at is null;
end $$;

revoke all on function public.reserve_credits(uuid,numeric,uuid) from public;
grant execute on function public.reserve_credits(uuid,numeric,uuid) to authenticated;
revoke all on function public.release_credits(uuid) from public;
grant execute on function public.release_credits(uuid) to authenticated;
