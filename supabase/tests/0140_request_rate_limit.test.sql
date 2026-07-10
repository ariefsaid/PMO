-- 0140_request_rate_limit.test.sql
-- AC-RL-002..006 [pgTAP]: rate_limit_hit() (migration 0091) is an atomic fixed-window request-rate
-- limiter. It returns TRUE while the caller is under `limit` in the current window, FALSE once over;
-- distinct keys are isolated; bad args raise (22023). Backs the request-frequency throttle wired into
-- agent-chat (IG-audit 2026-07-10). Distinct from the credit/spend guard (reserve_credits, 0134).
--
-- Window-roll (a new window resets the count) is proven by construction — the counter row is keyed by
-- (bucket_key, floored window_start), so a later window is a different row — and by the opportunistic
-- prune (old windows for the key are deleted). now()-flooring cannot be advanced inside one pgTAP txn,
-- so the reset is asserted structurally below (a manually-inserted stale window is pruned on next hit).
begin;
select plan(9);

-- rate_limit_hit is service-role-callable (0091 grants execute to service_role); the pgTAP superuser
-- runs it directly. Table posture: RLS enable+force, no policy.
select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'public.request_rate_counters'::regclass),
  'AC-RL-002: request_rate_counters has RLS ENABLED + FORCED'
);
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'request_rate_counters'),
  0,
  'AC-RL-002: request_rate_counters has NO policy (default-deny; definer/service-role only)'
);

-- AC-RL-003: the first `limit` calls in a window are allowed; the (limit+1)th is throttled.
select is(public.rate_limit_hit('t:k1', 3, 3600), true,  'AC-RL-003: hit 1/3 allowed');
select is(public.rate_limit_hit('t:k1', 3, 3600), true,  'AC-RL-003: hit 2/3 allowed');
select is(public.rate_limit_hit('t:k1', 3, 3600), true,  'AC-RL-003: hit 3/3 allowed');
select is(public.rate_limit_hit('t:k1', 3, 3600), false, 'AC-RL-003: hit 4/3 THROTTLED');

-- AC-RL-004: a different key is counted independently (no cross-key bleed).
select is(public.rate_limit_hit('t:k2', 3, 3600), true, 'AC-RL-004: distinct key k2 starts fresh (1/3)');

-- AC-RL-005: a stale prior window for the key is pruned when a new hit lands (window roll resets).
-- Seed an old window row for k3 directly, then a live hit; assert the stale row is gone and the live
-- window holds exactly one hit.
insert into public.request_rate_counters (bucket_key, window_start, hits)
  values ('t:k3', to_timestamp(0), 99);
select public.rate_limit_hit('t:k3', 3, 3600);  -- lands in the current window + prunes to_timestamp(0)
select is(
  (select count(*)::int from public.request_rate_counters where bucket_key = 't:k3'),
  1,
  'AC-RL-005: stale window pruned — only the current window row remains for the key'
);

-- AC-RL-006: bad args raise 22023 (a wiring bug fails LOUD, never silently open).
select throws_ok(
  $$ select public.rate_limit_hit('t:k', 0, 60) $$,
  '22023',
  null,
  'AC-RL-006: limit < 1 raises 22023'
);

select * from finish();
rollback;
