-- 0160_alert_ops_tables_lockdown.test.sql
-- AC-HRD-002 [pgTAP, PROPOSED]: alert_send_log and ops_job_heartbeats are service-role-only —
-- RLS enabled + forced, ZERO policies, and an authenticated JWT is denied SELECT/INSERT/UPDATE.
-- Mirrors the error_events posture (0071) and the m365 lockdown pattern (0154).
begin;
select plan(10);

insert into organizations (id, name) values
  ('01600000-0000-0000-0000-000000000001','AC-HRD-002 Org');
insert into auth.users (id, email) values
  ('01600000-0000-0000-0000-0000000000a1','ops-lockdown@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01600000-0000-0000-0000-0000000000a1','01600000-0000-0000-0000-000000000001',
   'Ops Lockdown','ops-lockdown@example.com','Admin');

insert into public.alert_send_log (error_code, last_sent_at) values ('SEED_CODE', now());
insert into public.ops_job_heartbeats (job_name, last_success_at) values ('seed-job', now());

select is((select relrowsecurity     from pg_class where oid = 'public.alert_send_log'::regclass),
          true, 'AC-HRD-002 alert_send_log RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.alert_send_log'::regclass),
          true, 'AC-HRD-002 alert_send_log RLS forced');
select is((select count(*)::int from pg_policies
             where schemaname='public' and tablename='alert_send_log'),
          0, 'AC-HRD-002 alert_send_log has ZERO policies');
select is((select relrowsecurity     from pg_class where oid = 'public.ops_job_heartbeats'::regclass),
          true, 'AC-HRD-002 ops_job_heartbeats RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.ops_job_heartbeats'::regclass),
          true, 'AC-HRD-002 ops_job_heartbeats RLS forced');
select is((select count(*)::int from pg_policies
             where schemaname='public' and tablename='ops_job_heartbeats'),
          0, 'AC-HRD-002 ops_job_heartbeats has ZERO policies');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01600000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok($$ select * from public.alert_send_log $$, '42501', null,
  'AC-HRD-002 authenticated SELECT on alert_send_log denied');
select throws_ok($$ insert into public.alert_send_log (error_code, last_sent_at)
                    values ('X', now()) $$, '42501', null,
  'AC-HRD-002 authenticated INSERT on alert_send_log denied');
select throws_ok($$ select * from public.ops_job_heartbeats $$, '42501', null,
  'AC-HRD-002 authenticated SELECT on ops_job_heartbeats denied');
select throws_ok($$ update public.ops_job_heartbeats set last_success_at = now() $$, '42501', null,
  'AC-HRD-002 authenticated UPDATE on ops_job_heartbeats denied');

reset role;
select * from finish();
rollback;
