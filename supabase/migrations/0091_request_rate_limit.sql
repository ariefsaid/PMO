-- 0091_request_rate_limit.sql — per-caller REQUEST-rate throttle for the public/expensive edge fns
-- (IG-audit 2026-07-10, backlog P1). DISTINCT from the CREDIT RateGuard (creditRateGuard.ts / 0067
-- org_credit_balance / 0077 reserve_credits): that bounds SPEND (money); this bounds REQUEST
-- FREQUENCY. reserve_credits closes the overspend race, so a burst can't drain credits — but it CAN
-- still burn function invocations and hammer the upstream model provider (OpenRouter latency/cost),
-- and admin-invite-user abuse can email-bomb / pollute the auth-user table. There was no
-- request-frequency limit on the public edge fns beyond Supabase platform defaults; this adds one.
--
-- Design: a FIXED-WINDOW counter — the laziest limiter that is actually correct for ephemeral edge
-- isolates. An in-memory bucket per isolate does NOT limit (isolates are short-lived and plural), so
-- the counter must be SHARED state = Postgres. rate_limit_hit(key, limit, window_secs) atomically
-- bumps the current window's counter and returns whether the caller is still under the limit.
--
-- ponytail: fixed-window, not sliding-window / token-bucket. Ceiling: allows up to ~2×limit across a
-- window boundary (a burst at one window's end + a burst at the next window's start). Fine for
-- abuse/cost defense at this scale; upgrade to a sliding-window log or GCRA only if a real client
-- ever hits the boundary edge.
--
-- Posture (mirrors credit_reservations 0077 / agent_dispatch_watermarks 0048): UNLOGGED (throwaway
-- counter — safe to lose on crash; the limiter just fails open briefly), RLS ENABLE+FORCE + NO policy
-- = default-deny to every JWT role; only the SECURITY-DEFINER function below + service_role touch it.
-- No grant to authenticated/anon (auto_expose_new_tables=false, 0075 → service-role-only by default);
-- the edge fns call rate_limit_hit via their service-role verifier client (non-bypassable, pre-trust).
--
-- Reversibility (ADR-0006): `supabase db reset`. Manual reverse:
--   drop function if exists public.rate_limit_hit(text,int,int);
--   drop table    if exists public.request_rate_counters;

create unlogged table public.request_rate_counters (
  bucket_key   text        not null,
  window_start timestamptz not null,
  hits         int         not null default 0,
  primary key (bucket_key, window_start)
);

alter table public.request_rate_counters enable row level security;
alter table public.request_rate_counters force  row level security;
-- NO policy: default-deny to every JWT role. Only rate_limit_hit (security definer, runs as its
-- postgres owner → bypasses RLS) + service_role (bypasses RLS) ever read/write this table.

-- rate_limit_hit: atomically record one hit against the caller's CURRENT fixed window and report
-- whether they are still within `p_limit`. Returns TRUE = allowed (still under limit), FALSE =
-- throttled. SECURITY DEFINER so it can write the policy-less table; callable by the edge fns'
-- service-role client. Bad args raise (22023) so a wiring bug fails loud in tests, not silently open.
create or replace function public.rate_limit_hit(
  p_key         text,
  p_limit       int,
  p_window_secs int
) returns boolean
  language plpgsql security definer set search_path = public as $$
declare
  v_window_start timestamptz;
  v_hits         int;
begin
  if p_key is null or p_limit < 1 or p_window_secs < 1 then
    raise exception 'rate_limit_hit: bad args (key=%, limit=%, window=%)', p_key, p_limit, p_window_secs
      using errcode = '22023';
  end if;

  -- Floor now() to the window boundary: every hit in the same window_secs slice shares one row.
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_secs) * p_window_secs);

  insert into public.request_rate_counters (bucket_key, window_start, hits)
    values (p_key, v_window_start, 1)
  on conflict (bucket_key, window_start)
    do update set hits = public.request_rate_counters.hits + 1
  returning hits into v_hits;

  -- Opportunistic prune of THIS key's stale windows (cheap — bounded by how many windows one key has
  -- outlived — keeps the unlogged table from growing without a separate reaper). ponytail: no cron
  -- reaper; if key cardinality ever explodes, add a periodic `delete ... where window_start < now()-…`.
  delete from public.request_rate_counters
    where bucket_key = p_key and window_start < v_window_start;

  return v_hits <= p_limit;
end;
$$;

revoke all     on function public.rate_limit_hit(text,int,int) from public;
grant  execute on function public.rate_limit_hit(text,int,int) to service_role;
