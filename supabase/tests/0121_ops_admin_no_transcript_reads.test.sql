-- 0121_ops_admin_no_transcript_reads.test.sql
-- AC-PRIV-001 [pgTAP]: the privacy line — no /administration surface reads
-- agent_events/agent_runs/agent_threads. Pins FR-USE-003/NFR-PRIV-001: (a) under an Operator JWT
-- and an org-Admin JWT, SELECT from agent_events/agent_runs/agent_threads yields 0 rows (RLS
-- owner-only, unaffected by this feature); (b) org_usage_summary/operator_usage_summary's function
-- BODY never references agent_events/agent_runs/agent_threads (a prosrc text scan) — the aggregate
-- RPCs are provably agent_usage-only, not merely "0 rows today because no fixture".
begin;
select plan(8);

insert into organizations (id, name) values
  ('01210000-0000-0000-0000-000000000001','AC-PRIV-001 Org X');
insert into auth.users (id, email) values
  ('01210000-0000-0000-0000-0000000000a1','priv001-admin@example.com'),
  ('01210000-0000-0000-0000-0000000000e1','priv001-eng@example.com'),
  ('01210000-0000-0000-0000-0000000000f1','priv001-operator@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01210000-0000-0000-0000-0000000000a1','01210000-0000-0000-0000-000000000001','X Admin','priv001-admin@example.com','Admin'),
  ('01210000-0000-0000-0000-0000000000e1','01210000-0000-0000-0000-000000000001','X Eng','priv001-eng@example.com','Engineer'),
  ('01210000-0000-0000-0000-0000000000f1','01210000-0000-0000-0000-000000000001','Operator','priv001-operator@example.com','Admin');
insert into platform_operators (user_id) values ('01210000-0000-0000-0000-0000000000f1');

-- Engineer owns a thread/run/event (their own agent conversation).
insert into agent_threads (id, owner_id, title) values
  ('01210000-0000-0000-0000-000000000010','01210000-0000-0000-0000-0000000000e1','Eng Thread');
insert into agent_runs (id, thread_id, owner_id, status) values
  ('01210000-0000-0000-0000-000000000020','01210000-0000-0000-0000-000000000010','01210000-0000-0000-0000-0000000000e1','completed');
insert into agent_events (id, run_id, owner_id, seq, type, payload) values
  ('01210000-0000-0000-0000-000000000030','01210000-0000-0000-0000-000000000020','01210000-0000-0000-0000-0000000000e1',0,'status','{}'::jsonb);

-- (a) Neither org-Admin nor Operator reads the Engineer's transcript rows (owner-only RLS, unaffected).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01210000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from agent_threads), 0, 'AC-PRIV-001 org-Admin reads 0 agent_threads rows');
select is((select count(*)::int from agent_runs),    0, 'AC-PRIV-001 org-Admin reads 0 agent_runs rows');
select is((select count(*)::int from agent_events),  0, 'AC-PRIV-001 org-Admin reads 0 agent_events rows');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01210000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is((select count(*)::int from agent_threads), 0, 'AC-PRIV-001 Operator reads 0 agent_threads rows');
select is((select count(*)::int from agent_runs),    0, 'AC-PRIV-001 Operator reads 0 agent_runs rows');
select is((select count(*)::int from agent_events),  0, 'AC-PRIV-001 Operator reads 0 agent_events rows');
reset role;

-- (b) prosrc text scan: the usage-summary RPC bodies never reference the transcript tables.
select ok(
  (select prosrc from pg_proc where proname = 'org_usage_summary' and pronamespace = 'public'::regnamespace)
    !~* 'agent_events|agent_runs|agent_threads',
  'AC-PRIV-001 org_usage_summary() body never references agent_events/agent_runs/agent_threads');
select ok(
  (select prosrc from pg_proc where proname = 'operator_usage_summary' and pronamespace = 'public'::regnamespace)
    !~* 'agent_events|agent_runs|agent_threads',
  'AC-PRIV-001 operator_usage_summary() body never references agent_events/agent_runs/agent_threads');

select * from finish();
rollback;
