-- 0160_alert_ops_tables_lockdown.test.sql
-- AC-HRD-011 [pgTAP, RATIFIED 2026-07-28 — FR-HRD-011, observability-analytics.spec.md §4.2]:
-- alert_send_log and ops_job_heartbeats are service-role-only — RLS enabled + forced, ZERO
-- policies, an authenticated JWT is denied SELECT/INSERT/UPDATE, AND service_role retains the
-- grants it needs (so a future over-broad `revoke` cannot leave this test green while actually
-- locking service_role out too). Mirrors the error_events posture (0071) and the m365 lockdown
-- pattern (0154).
--
-- Re-tagged from AC-HRD-002 (2026-07-28 review): this file proves TABLE LOCKDOWN, not FR-HRD-002's
-- "repeated alerts are bounded" behaviour — that bound is proven at the Unit layer
-- (pmo-portal/src/lib/agent/telegramDrain.test.ts, the "SAME group is not re-sent" test, currently
-- tagged AC-HRD-001 alongside the write-ahead invariant it shares a mechanism with). AC-HRD-002 was
-- never ratified in the spec itself (only PROPOSED in the plan) — nothing to rename there, so this
-- file's own tag (AC-HRD-011) is what got ratified instead.
begin;
select plan(19);

insert into organizations (id, name) values
  ('01600000-0000-0000-0000-000000000001','AC-HRD-011 Org');
insert into auth.users (id, email) values
  ('01600000-0000-0000-0000-0000000000a1','ops-lockdown@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01600000-0000-0000-0000-0000000000a1','01600000-0000-0000-0000-000000000001',
   'Ops Lockdown','ops-lockdown@example.com','Admin');

insert into public.alert_send_log (error_code, last_sent_at) values ('SEED_CODE', now());
insert into public.ops_job_heartbeats (job_name, last_run_at) values ('seed-job', now());

select is((select relrowsecurity     from pg_class where oid = 'public.alert_send_log'::regclass),
          true, 'AC-HRD-011 alert_send_log RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.alert_send_log'::regclass),
          true, 'AC-HRD-011 alert_send_log RLS forced');
select is((select count(*)::int from pg_policies
             where schemaname='public' and tablename='alert_send_log'),
          0, 'AC-HRD-011 alert_send_log has ZERO policies');
select is((select relrowsecurity     from pg_class where oid = 'public.ops_job_heartbeats'::regclass),
          true, 'AC-HRD-011 ops_job_heartbeats RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.ops_job_heartbeats'::regclass),
          true, 'AC-HRD-011 ops_job_heartbeats RLS forced');
select is((select count(*)::int from pg_policies
             where schemaname='public' and tablename='ops_job_heartbeats'),
          0, 'AC-HRD-011 ops_job_heartbeats has ZERO policies');

-- C1: the write-ahead/delivery split exists (delivered_at nullable — a row may be attempted but
-- never confirmed delivered).
select has_column('public', 'alert_send_log', 'delivered_at',
  'AC-HRD-011 / C1: alert_send_log.delivered_at exists (the write-ahead/delivery split)');
select col_not_null('public', 'alert_send_log', 'last_sent_at',
  'AC-HRD-011 alert_send_log.last_sent_at is NOT NULL (always written by the write-ahead)');

-- I4: the run/outbound split exists.
select has_column('public', 'ops_job_heartbeats', 'last_run_at',
  'AC-HRD-011 / I4: ops_job_heartbeats.last_run_at exists (unconditional run signal)');
select has_column('public', 'ops_job_heartbeats', 'last_outbound_at',
  'AC-HRD-011 / I4: ops_job_heartbeats.last_outbound_at exists (outbound-only signal)');
select col_not_null('public', 'ops_job_heartbeats', 'last_run_at',
  'AC-HRD-011 ops_job_heartbeats.last_run_at is NOT NULL (written every completed tick)');

-- M4: the drain's unnotified-rows query has a partial index to serve it (no LIMIT-free O(table) scan).
select has_index('error_events', 'error_events_unnotified_idx', array['created_at'],
  'AC-HRD-011 / M4: error_events (created_at) where notified_at is null partial index exists');

-- Positive: service_role retains the grants the drain actually needs (belt to the RLS braces — an
-- over-broad future `revoke all from service_role`-equivalent would fail THIS, not just silently
-- pass the authenticated-denial asserts below).
select ok(has_table_privilege('service_role', 'public.alert_send_log', 'SELECT'),
  'AC-HRD-011 service_role retains SELECT on alert_send_log');
select ok(has_table_privilege('service_role', 'public.alert_send_log', 'INSERT'),
  'AC-HRD-011 service_role retains INSERT on alert_send_log');
select ok(has_table_privilege('service_role', 'public.ops_job_heartbeats', 'UPDATE'),
  'AC-HRD-011 service_role retains UPDATE on ops_job_heartbeats');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01600000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok($$ select * from public.alert_send_log $$, '42501', null,
  'AC-HRD-011 authenticated SELECT on alert_send_log denied');
select throws_ok($$ insert into public.alert_send_log (error_code, last_sent_at)
                    values ('X', now()) $$, '42501', null,
  'AC-HRD-011 authenticated INSERT on alert_send_log denied');
select throws_ok($$ select * from public.ops_job_heartbeats $$, '42501', null,
  'AC-HRD-011 authenticated SELECT on ops_job_heartbeats denied');
select throws_ok($$ update public.ops_job_heartbeats set last_run_at = now() $$, '42501', null,
  'AC-HRD-011 authenticated UPDATE on ops_job_heartbeats denied');

reset role;
select * from finish();
rollback;
