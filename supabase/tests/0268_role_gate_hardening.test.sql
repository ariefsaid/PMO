-- 0268_role_gate_hardening.test.sql
-- #909 role-gate alignment batch. Each block proves the gate at its owning layer, both directions
-- (the refused caller AND the caller the ruling still admits, so no legitimate path is over-closed).
--   §1 OD-PROC-1     — Draft → Requested is the requester's act (Admin break-glass).
--   §2 FR-TS-008     — a line manager reads the entries of the sheets they may approve.
--   §3 OD-TS / FE    — save_timesheet_week admits the same role set as timesheet_entries_write.
--   §4 OD-SP-2       — pipeline_stage_config is Admin-configured.
begin;
select plan(18);

-- ── Fixtures (inserted as table owner) ───────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('02680000-0000-0000-0000-000000000001','RGH Org');

insert into auth.users (id, email) values
  ('02680000-0000-0000-0000-0000000000a1','rgh-admin@example.com'),
  ('02680000-0000-0000-0000-0000000000a2','rgh-pm@example.com'),
  ('02680000-0000-0000-0000-0000000000a3','rgh-fin@example.com'),
  ('02680000-0000-0000-0000-0000000000a4','rgh-exec@example.com'),
  ('02680000-0000-0000-0000-0000000000e1','rgh-eng-requester@example.com'),
  ('02680000-0000-0000-0000-0000000000e2','rgh-eng-other@example.com'),
  ('02680000-0000-0000-0000-0000000000e3','rgh-eng-manager@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('02680000-0000-0000-0000-0000000000a1','02680000-0000-0000-0000-000000000001','RGH Admin','rgh-admin@example.com','Admin'),
  ('02680000-0000-0000-0000-0000000000a2','02680000-0000-0000-0000-000000000001','RGH PM','rgh-pm@example.com','Project Manager'),
  ('02680000-0000-0000-0000-0000000000a3','02680000-0000-0000-0000-000000000001','RGH Finance','rgh-fin@example.com','Finance'),
  ('02680000-0000-0000-0000-0000000000a4','02680000-0000-0000-0000-000000000001','RGH Exec','rgh-exec@example.com','Executive'),
  ('02680000-0000-0000-0000-0000000000e1','02680000-0000-0000-0000-000000000001','RGH Eng Requester','rgh-eng-requester@example.com','Engineer'),
  ('02680000-0000-0000-0000-0000000000e2','02680000-0000-0000-0000-000000000001','RGH Eng Other','rgh-eng-other@example.com','Engineer'),
  ('02680000-0000-0000-0000-0000000000e3','02680000-0000-0000-0000-000000000001','RGH Eng Manager','rgh-eng-manager@example.com','Engineer');

-- e1's line manager is e3 (an Engineer — outside the org-wide read role set).
update profiles set manager_id = '02680000-0000-0000-0000-0000000000e3'
  where id = '02680000-0000-0000-0000-0000000000e1';

insert into projects (id, org_id, name, status) values
  ('02680000-0000-0000-0000-000000000010','02680000-0000-0000-0000-000000000001','RGH Project','Ongoing Project');

-- Two Draft requests raised by e1.
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('02680000-0000-0000-0000-000000000021','02680000-0000-0000-0000-000000000001','RGH Draft 1','Draft','02680000-0000-0000-0000-0000000000e1'),
  ('02680000-0000-0000-0000-000000000022','02680000-0000-0000-0000-000000000001','RGH Draft 2','Draft','02680000-0000-0000-0000-0000000000e1');

-- e1's Submitted sheet with two entries; a Draft sheet owned by Finance for the direct-write check.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('02680000-0000-0000-0000-000000000031','02680000-0000-0000-0000-000000000001','02680000-0000-0000-0000-0000000000e1','2026-06-01','Submitted'),
  ('02680000-0000-0000-0000-000000000032','02680000-0000-0000-0000-000000000001','02680000-0000-0000-0000-0000000000a3','2026-06-01','Draft');
insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours) values
  ('02680000-0000-0000-0000-000000000001','02680000-0000-0000-0000-000000000031','02680000-0000-0000-0000-000000000010','2026-06-01',8),
  ('02680000-0000-0000-0000-000000000001','02680000-0000-0000-0000-000000000031','02680000-0000-0000-0000-000000000010','2026-06-02',6);

insert into pipeline_stage_config (org_id, status, win_probability) values
  ('02680000-0000-0000-0000-000000000001','Leads',0.100);

set local role authenticated;

-- ══ §1 OD-PROC-1: submit is the requester's act ═════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"02680000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select throws_ok(
  $$ select transition_procurement('02680000-0000-0000-0000-000000000021','Requested') $$,
  '42501', null,
  'OD-PROC-1: a member who did not raise the request cannot submit it');

set local request.jwt.claims = '{"sub":"02680000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_procurement('02680000-0000-0000-0000-000000000021','Requested') $$,
  '42501', null,
  'OD-PROC-1: a Project Manager who did not raise the request cannot submit it');

set local request.jwt.claims = '{"sub":"02680000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok(
  $$ select transition_procurement('02680000-0000-0000-0000-000000000021','Requested') $$,
  'OD-PROC-1: the requester (Engineer) submits their own Draft');

set local request.jwt.claims = '{"sub":"02680000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_procurement('02680000-0000-0000-0000-000000000022','Requested') $$,
  'OD-PROC-1: Admin break-glass may submit a request on the requester''s behalf');

reset role;
select is(
  (select array_agg(status::text order by id) from procurements
    where id in ('02680000-0000-0000-0000-000000000021','02680000-0000-0000-0000-000000000022')),
  array['Requested','Requested'],
  'OD-PROC-1: both admitted submits moved their request to Requested');
set local role authenticated;

-- ══ §2 FR-TS-008: the line manager reads what they approve ══════════════════════════════════════
set local request.jwt.claims = '{"sub":"02680000-0000-0000-0000-0000000000e3","role":"authenticated"}';
select is(
  (select count(*)::int from timesheet_entries where timesheet_id = '02680000-0000-0000-0000-000000000031'),
  2,
  'FR-TS-008: an Engineer line manager reads the entries of their report''s sheet');
select is(
  (select coalesce(sum(hours), 0)::numeric from timesheet_entries where timesheet_id = '02680000-0000-0000-0000-000000000031'),
  14::numeric,
  'FR-TS-008: the line manager sees the full hours they are asked to approve');

set local request.jwt.claims = '{"sub":"02680000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(
  (select count(*)::int from timesheet_entries where timesheet_id = '02680000-0000-0000-0000-000000000031'),
  0,
  'FR-TS-008: an Engineer who does not manage the owner reads none of the entries');

set local request.jwt.claims = '{"sub":"02680000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is(
  (select count(*)::int from timesheet_entries where timesheet_id = '02680000-0000-0000-0000-000000000031'),
  2,
  'FR-TS-008: the owner still reads their own entries');

-- ══ §3 the week-save RPC and the entries policy admit the same roles ════════════════════════════
set local request.jwt.claims = '{"sub":"02680000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ select save_timesheet_week(null, '2026-06-08'::date,
       '[{"project_id":"02680000-0000-0000-0000-000000000010","entry_date":"2026-06-08","hours":8}]'::jsonb) $$,
  '42501', null,
  'timesheet entry: a Finance member cannot save a week through the RPC (matches the entries policy)');
select throws_ok(
  $$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
       values (auth_org_id(), '02680000-0000-0000-0000-000000000032',
               '02680000-0000-0000-0000-000000000010', '2026-06-01', 8) $$,
  '42501', null,
  'timesheet entry: a Finance member cannot write entries directly either');

set local request.jwt.claims = '{"sub":"02680000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select lives_ok(
  $$ select save_timesheet_week(null, '2026-06-08'::date,
       '[{"project_id":"02680000-0000-0000-0000-000000000010","entry_date":"2026-06-08","hours":8}]'::jsonb) $$,
  'timesheet entry: an Engineer still saves their own week through the RPC');

-- ══ §4 OD-SP-2: stage win-probabilities are Admin-configured ════════════════════════════════════
set local request.jwt.claims = '{"sub":"02680000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ insert into pipeline_stage_config (org_id, status, win_probability)
     values ('02680000-0000-0000-0000-000000000001','Negotiation',0.900) $$,
  '42501', null,
  'OD-SP-2: a Project Manager cannot add a stage probability');

set local request.jwt.claims = '{"sub":"02680000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ insert into pipeline_stage_config (org_id, status, win_probability)
     values ('02680000-0000-0000-0000-000000000001','Negotiation',0.900) $$,
  '42501', null,
  'OD-SP-2: a Finance member cannot add a stage probability');

set local request.jwt.claims = '{"sub":"02680000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok(
  $$ insert into pipeline_stage_config (org_id, status, win_probability)
     values ('02680000-0000-0000-0000-000000000001','Negotiation',0.900) $$,
  '42501', null,
  'OD-SP-2: an Executive cannot add a stage probability');
-- An UPDATE outside the policy matches no row (RLS filters, no error); checked as owner below.
update pipeline_stage_config set win_probability = 0.990
  where org_id = '02680000-0000-0000-0000-000000000001' and status = 'Leads';

set local request.jwt.claims = '{"sub":"02680000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ insert into pipeline_stage_config (org_id, status, win_probability)
     values ('02680000-0000-0000-0000-000000000001','Negotiation',0.800) $$,
  'OD-SP-2: an Admin adds a stage probability');

reset role;
select is(
  (select win_probability from pipeline_stage_config
    where org_id = '02680000-0000-0000-0000-000000000001' and status = 'Leads'),
  0.100,
  'OD-SP-2: an Executive''s update changed nothing');
select is(
  (select win_probability from pipeline_stage_config
    where org_id = '02680000-0000-0000-0000-000000000001' and status = 'Negotiation'),
  0.800,
  'OD-SP-2: the Admin''s row is the one stored');

select * from finish();
rollback;
