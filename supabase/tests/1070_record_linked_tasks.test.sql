-- 1070_record_linked_tasks.test.sql — #2587. Migrations under test: 1070 (columns, link guard, column pin) + 1071 (close, read).
-- AC-RLT-001..013, 018. Fixtures are written as the owner role; assertions run as the actor.
-- ⚑ Row-changing assertions COUNT ROWS where an RLS-denied write is a silent no-op.
begin;
select plan(61);

\set A '10700000-0000-0000-0000-00000000000a'
\set B '10700000-0000-0000-0000-00000000000b'

insert into organizations (id, name) values
  ('10700000-0000-0000-0000-00000000000a','RLT Org A'),
  ('10700000-0000-0000-0000-00000000000b','RLT Org B');
insert into auth.users (id, email) values
  ('10700000-0000-0000-0000-0000000000f1','rlt-pm@example.com'),
  ('10700000-0000-0000-0000-0000000000e1','rlt-eng1@example.com'),
  ('10700000-0000-0000-0000-0000000000e2','rlt-eng2@example.com'),
  ('10700000-0000-0000-0000-0000000000f2','rlt-fin@example.com'),
  ('10700000-0000-0000-0000-0000000000b1','rlt-pm-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('10700000-0000-0000-0000-0000000000f1','10700000-0000-0000-0000-00000000000a','PM A','rlt-pm@example.com','Project Manager','active'),
  ('10700000-0000-0000-0000-0000000000e1','10700000-0000-0000-0000-00000000000a','Eng1 A','rlt-eng1@example.com','Engineer','active'),
  ('10700000-0000-0000-0000-0000000000e2','10700000-0000-0000-0000-00000000000a','Eng2 A','rlt-eng2@example.com','Engineer','active'),
  ('10700000-0000-0000-0000-0000000000f2','10700000-0000-0000-0000-00000000000a','Fin A','rlt-fin@example.com','Finance','active'),
  ('10700000-0000-0000-0000-0000000000b1','10700000-0000-0000-0000-00000000000b','PM B','rlt-pm-b@example.com','Project Manager','active');
insert into projects (id, org_id, code, name, status) values
  ('10700000-0000-0000-0000-0000000000d1','10700000-0000-0000-0000-00000000000a','RL1','Project 1','Ongoing Project'),
  ('10700000-0000-0000-0000-0000000000d2','10700000-0000-0000-0000-00000000000a','RL2','Project 2','Ongoing Project');

-- Records. pr1: raised by eng1 (eng1 can read it), project 1. pr2: raised by the PM (eng1/eng2 cannot read it). pr3: Paid. prB: org B.
insert into procurements (id, org_id, code, title, project_id, requested_by_id, status) values
  ('10700000-0000-0000-0000-000000000201','10700000-0000-0000-0000-00000000000a','RLP1','Purchase 1','10700000-0000-0000-0000-0000000000d1','10700000-0000-0000-0000-0000000000e1','Draft'),
  ('10700000-0000-0000-0000-000000000202','10700000-0000-0000-0000-00000000000a','RLP2','Purchase 2',null,'10700000-0000-0000-0000-0000000000f1','Draft'),
  ('10700000-0000-0000-0000-000000000203','10700000-0000-0000-0000-00000000000a','RLP3','Purchase 3',null,'10700000-0000-0000-0000-0000000000e1','Draft'),
  ('10700000-0000-0000-0000-000000000204','10700000-0000-0000-0000-00000000000a','RLP4','Purchase 4',null,'10700000-0000-0000-0000-0000000000e1','Draft'),
  ('10700000-0000-0000-0000-000000000205','10700000-0000-0000-0000-00000000000a','RLP5','Purchase 5',null,'10700000-0000-0000-0000-0000000000e1','Draft'),
  ('10700000-0000-0000-0000-0000000002b1','10700000-0000-0000-0000-00000000000b','RLPB','Purchase B',null,'10700000-0000-0000-0000-0000000000b1','Draft');
set local session_replication_role = replica;
insert into procurements (id, org_id, code, title, project_id, requested_by_id, status, currency) values
  ('10700000-0000-0000-0000-000000000299','10700000-0000-0000-0000-00000000000a','RLP9','Purchase Paid',null,'10700000-0000-0000-0000-0000000000e1','Paid','USD');
set local session_replication_role = origin;

-- Expense claims (claimant eng1): ec1 Draft, ec2 Draft, ec3 Draft. Material requests: mr1 draft (project 1), mr2 draft.
insert into expense_claims (id, org_id, kind, claim_number, claimant_id, project_id, title, currency, amount, status) values
  ('10700000-0000-0000-0000-000000000301','10700000-0000-0000-0000-00000000000a','claim','EXP-RLT-1','10700000-0000-0000-0000-0000000000e1',null,'Claim 1','USD',0,'Draft'),
  ('10700000-0000-0000-0000-000000000302','10700000-0000-0000-0000-00000000000a','claim','EXP-RLT-2','10700000-0000-0000-0000-0000000000e1',null,'Claim 2','USD',0,'Draft'),
  ('10700000-0000-0000-0000-000000000303','10700000-0000-0000-0000-00000000000a','claim','EXP-RLT-3','10700000-0000-0000-0000-0000000000e1',null,'Claim 3','USD',0,'Draft');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('10700000-0000-0000-0000-0000000009a1','10700000-0000-0000-0000-00000000000a','10700000-0000-0000-0000-0000000000d1','WO','Issued',100,'exclusive',0);
set local session_replication_role = replica;
insert into material_requests (id, org_id, number, work_order_id, project_id, needed_by, status, created_by) values
  ('10700000-0000-0000-0000-000000000401','10700000-0000-0000-0000-00000000000a','MR-RLT-1','10700000-0000-0000-0000-0000000009a1','10700000-0000-0000-0000-0000000000d1',current_date,'draft','10700000-0000-0000-0000-0000000000e1'),
  ('10700000-0000-0000-0000-000000000402','10700000-0000-0000-0000-00000000000a','MR-RLT-2','10700000-0000-0000-0000-0000000009a1','10700000-0000-0000-0000-0000000000d1',current_date,'draft','10700000-0000-0000-0000-0000000000e1'),
  ('10700000-0000-0000-0000-000000000403','10700000-0000-0000-0000-00000000000a','MR-RLT-3','10700000-0000-0000-0000-0000000009a1','10700000-0000-0000-0000-0000000000d1',current_date,'draft','10700000-0000-0000-0000-0000000000e1');
set local session_replication_role = origin;

-- Tasks. t1: eng1's own task (created+assigned eng1); t2: PM-created, assigned eng2; t3: PM-created, assigned eng1 (Done target);
-- t4: project-2 task. All unlinked To Do.
insert into tasks (id, org_id, project_id, name, status, assignee_id, created_by) values
  ('10700000-0000-0000-0000-000000000101','10700000-0000-0000-0000-00000000000a','10700000-0000-0000-0000-0000000000d1','Eng1 own','To Do','10700000-0000-0000-0000-0000000000e1','10700000-0000-0000-0000-0000000000e1'),
  ('10700000-0000-0000-0000-000000000102','10700000-0000-0000-0000-00000000000a','10700000-0000-0000-0000-0000000000d1','PM task for eng2','To Do','10700000-0000-0000-0000-0000000000e2','10700000-0000-0000-0000-0000000000f1'),
  ('10700000-0000-0000-0000-000000000103','10700000-0000-0000-0000-00000000000a',null,'PM task no project','To Do','10700000-0000-0000-0000-0000000000e1','10700000-0000-0000-0000-0000000000f1'),
  ('10700000-0000-0000-0000-000000000104','10700000-0000-0000-0000-00000000000a','10700000-0000-0000-0000-0000000000d2','Project 2 task','To Do',null,'10700000-0000-0000-0000-0000000000f1');

-- ── AC-RLT-001: link rights and the one "choose a record you can open" answer ──────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"10700000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok($$update tasks set procurement_id = '10700000-0000-0000-0000-000000000201' where id = '10700000-0000-0000-0000-000000000101'$$,
  'AC-RLT-001 the creator links their own task to a purchase they can read');
select throws_ok($$update tasks set procurement_id = '10700000-0000-0000-0000-000000000202' where id = '10700000-0000-0000-0000-000000000103'$$,
  '42501', null, 'AC-RLT-001 a creator who is only the assignee cannot link at all (assignee allow-list)');
select throws_ok($$insert into tasks (org_id, project_id, name, procurement_id, assignee_id) values ('10700000-0000-0000-0000-00000000000a',null,'x','10700000-0000-0000-0000-000000000202','10700000-0000-0000-0000-0000000000e1')$$,
  '42501', 'choose a record you can open', 'AC-RLT-001 a purchase the caller cannot read gets the not-found answer');
select throws_ok($$insert into tasks (org_id, project_id, name, procurement_id, assignee_id) values ('10700000-0000-0000-0000-00000000000a',null,'x','10700000-0000-0000-0000-000000000999','10700000-0000-0000-0000-0000000000e1')$$,
  '42501', 'choose a record you can open', 'AC-RLT-001 a record that does not exist gets the same answer');
select lives_ok($$insert into tasks (id, org_id, project_id, name, expense_claim_id, assignee_id) values ('10700000-0000-0000-0000-000000000111','10700000-0000-0000-0000-00000000000a',null,'claim follow-up','10700000-0000-0000-0000-000000000301','10700000-0000-0000-0000-0000000000e1')$$,
  'AC-RLT-001 the claimant creates a task linked to their own claim');
select lives_ok($$insert into tasks (id, org_id, project_id, name, material_request_id, assignee_id) values ('10700000-0000-0000-0000-000000000112','10700000-0000-0000-0000-00000000000a',null,'mr follow-up','10700000-0000-0000-0000-000000000401','10700000-0000-0000-0000-0000000000e1')$$,
  'AC-RLT-001 a task links to a material request');
-- the assignee (eng2, task 102 created by the PM) may not set a link
set local request.jwt.claims = '{"sub":"10700000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select throws_ok($$update tasks set procurement_id = '10700000-0000-0000-0000-000000000203' where id = '10700000-0000-0000-0000-000000000102'$$,
  '42501', 'only the task status may be changed by its assignee', 'AC-RLT-001 / FR-RLT-004 the assignee cannot set a link');
-- a project mismatch: task in project 2 linked to the project-1 purchase
set local request.jwt.claims = '{"sub":"10700000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok($$update tasks set procurement_id = '10700000-0000-0000-0000-000000000201' where id = '10700000-0000-0000-0000-000000000104'$$,
  '23514', null, 'AC-RLT-001 a record of another project than the task is refused');
select lives_ok($$update tasks set procurement_id = '10700000-0000-0000-0000-000000000202' where id = '10700000-0000-0000-0000-000000000104'$$,
  'AC-RLT-001 the PM links any task (project-less record, any project task)');
select lives_ok($$update tasks set procurement_id = null where id = '10700000-0000-0000-0000-000000000104'$$,
  'AC-RLT-001 the PM clears a link');

-- ── AC-RLT-008: another organisation ───────────────────────────────────────────────────────────────────
reset role;
select is((select count(*)::int from tasks where procurement_id = '10700000-0000-0000-0000-0000000002b1'), 0, 'AC-RLT-008 fixture: nothing linked to the org-B record yet');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10700000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok($$update tasks set procurement_id = '10700000-0000-0000-0000-0000000002b1' where id = '10700000-0000-0000-0000-000000000104'$$,
  '42501', 'choose a record you can open', 'AC-RLT-008 an org-B record id is never accepted (same answer as missing)');
set local request.jwt.claims = '{"sub":"10700000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from task_linked_records(array['10700000-0000-0000-0000-000000000101'::uuid])), 0,
  'AC-RLT-008 a user of another organisation reads no linked status for our task');

-- ── AC-RLT-009: two links, and AC-RLT-012: proof-required ──────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"10700000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok($$update tasks set procurement_id = '10700000-0000-0000-0000-000000000202', expense_claim_id = '10700000-0000-0000-0000-000000000302' where id = '10700000-0000-0000-0000-000000000104'$$,
  '23514', null, 'AC-RLT-009 a task with two record links is refused');
select lives_ok($$update tasks set proof_required = true where id = '10700000-0000-0000-0000-000000000104'$$, 'AC-RLT-012 fixture: PM makes a task proof-required');
select throws_ok($$update tasks set procurement_id = '10700000-0000-0000-0000-000000000202' where id = '10700000-0000-0000-0000-000000000104'$$,
  '23514', null, 'AC-RLT-012 a proof-required task cannot be linked');
select lives_ok($$update tasks set proof_required = false where id = '10700000-0000-0000-0000-000000000104'$$, 'AC-RLT-012 fixture: reset');
select lives_ok($$update tasks set procurement_id = '10700000-0000-0000-0000-000000000202' where id = '10700000-0000-0000-0000-000000000104'$$, 'AC-RLT-012 fixture: link again');
select throws_ok($$update tasks set proof_required = true where id = '10700000-0000-0000-0000-000000000104'$$,
  '23514', null, 'AC-RLT-012 a linked task cannot require proof (the reverse)');
select lives_ok($$update tasks set procurement_id = null where id = '10700000-0000-0000-0000-000000000104'$$, 'AC-RLT-012 fixture: unlink');

-- ── AC-RLT-006: a finished record cannot be linked ─────────────────────────────────────────────────────
select throws_ok($$update tasks set procurement_id = '10700000-0000-0000-0000-000000000299' where id = '10700000-0000-0000-0000-000000000104'$$,
  '23514', 'this record is already finished', 'AC-RLT-006 a Paid purchase cannot be linked');

-- ── AC-RLT-002: one open task per link ─────────────────────────────────────────────────────────────────
-- t1 holds pr1 (open). A second open task for pr1 is refused, naming the first.
select throws_ok($$insert into tasks (org_id, project_id, name, procurement_id) values ('10700000-0000-0000-0000-00000000000a',null,'second','10700000-0000-0000-0000-000000000201')$$,
  '23505', 'an open task already exists for this record', 'AC-RLT-002 a second open task for the same purchase is refused');
select throws_ok($$update tasks set procurement_id = '10700000-0000-0000-0000-000000000201' where id = '10700000-0000-0000-0000-000000000103'$$,
  '23505', 'an open task already exists for this record', 'AC-RLT-002 relinking another task to a held record is refused');
select throws_ok($$insert into tasks (org_id, project_id, name, expense_claim_id) values ('10700000-0000-0000-0000-00000000000a',null,'second','10700000-0000-0000-0000-000000000301')$$,
  '23505', 'an open task already exists for this record', 'AC-RLT-002 same for an expense claim');
select throws_ok($$insert into tasks (org_id, project_id, name, material_request_id) values ('10700000-0000-0000-0000-00000000000a',null,'second','10700000-0000-0000-0000-000000000401')$$,
  '23505', 'an open task already exists for this record', 'AC-RLT-002 same for a material request');
-- the unique index is the backstop: bypass the guard (replica skips triggers) and the index still refuses
reset role;
set local session_replication_role = replica;
select throws_ok($$insert into tasks (org_id, name, procurement_id) values ('10700000-0000-0000-0000-00000000000a','dup','10700000-0000-0000-0000-000000000201')$$,
  '23505', null, 'AC-RLT-002 the partial unique index is the concurrency backstop');
set local session_replication_role = origin;
-- Done, archived and tombstoned tasks do not count (FR-RLT-007)
update tasks set status = 'Done' where id = '10700000-0000-0000-0000-000000000101';
select lives_ok($$insert into tasks (id, org_id, project_id, name, procurement_id) values ('10700000-0000-0000-0000-000000000121','10700000-0000-0000-0000-00000000000a',null,'after done','10700000-0000-0000-0000-000000000201')$$,
  'AC-RLT-002 after the first is Done a new task for the record is accepted');
update tasks set archived_at = now() where id = '10700000-0000-0000-0000-000000000121';
select lives_ok($$insert into tasks (id, org_id, project_id, name, procurement_id) values ('10700000-0000-0000-0000-000000000122','10700000-0000-0000-0000-00000000000a',null,'after archived','10700000-0000-0000-0000-000000000201')$$,
  'AC-RLT-002 an archived task does not count');
update tasks set tombstoned_at = now() where id = '10700000-0000-0000-0000-000000000122';
select lives_ok($$insert into tasks (id, org_id, project_id, name, procurement_id) values ('10700000-0000-0000-0000-000000000123','10700000-0000-0000-0000-00000000000a',null,'after tombstoned','10700000-0000-0000-0000-000000000201')$$,
  'AC-RLT-002 a tombstoned task does not count');

-- ── AC-RLT-004: non-end moves change nothing ───────────────────────────────────────────────────────────
-- open tasks: t111 (claim ec301), t112 (mr 401), t123 (procurement 201)
update expense_claims set status = 'Submitted' where id = '10700000-0000-0000-0000-000000000301';
update expense_claims set status = 'Approved'  where id = '10700000-0000-0000-0000-000000000301';
update expense_claims set status = 'Rejected'  where id = '10700000-0000-0000-0000-000000000301';
update procurements   set status = 'Rejected'  where id = '10700000-0000-0000-0000-000000000201';
update material_requests set status = 'pending'  where id = '10700000-0000-0000-0000-000000000401';
update material_requests set status = 'approved' where id = '10700000-0000-0000-0000-000000000401';
select is((select count(*)::int from tasks where id in ('10700000-0000-0000-0000-000000000111','10700000-0000-0000-0000-000000000112','10700000-0000-0000-0000-000000000123') and status <> 'Done'), 3,
  'AC-RLT-004 Submitted/Approved/Rejected claim, Rejected purchase, approved request: no task closes');
select is((select count(*)::int from tasks where closed_by_record_type is not null), 0, 'AC-RLT-004 and no close reason is stored');
update expense_claims set status = 'Draft' where id = '10700000-0000-0000-0000-000000000301';  -- rework path
update procurements   set status = 'Draft' where id = '10700000-0000-0000-0000-000000000201';

-- ── AC-RLT-003: each type closes at each end state, with reason and completed_at ───────────────────────
-- Hand check: expense claim Draft -> Submitted -> Approved -> Paid closes that task alone.
update expense_claims set status = 'Submitted' where id = '10700000-0000-0000-0000-000000000301';
update expense_claims set status = 'Approved'  where id = '10700000-0000-0000-0000-000000000301';
select is((select status::text from tasks where id = '10700000-0000-0000-0000-000000000111'), 'To Do', 'AC-RLT-003 hand check: still open at Approved');
update expense_claims set status = 'Paid' where id = '10700000-0000-0000-0000-000000000301';
select results_eq($$select status::text, completed_at is not null, closed_by_record_type, closed_by_record_status, closed_by_record_at is not null
                      from tasks where id = '10700000-0000-0000-0000-000000000111'$$,
  $$values ('Done', true, 'expense_claim', 'Paid', true)$$,
  'AC-RLT-003 the claim task is Done with completed_at and the closing reason');
select is((select count(*)::int from tasks where id in ('10700000-0000-0000-0000-000000000112','10700000-0000-0000-0000-000000000123') and status <> 'Done'), 2,
  'AC-RLT-003 hand check: the other two tasks stay open');
update procurements set status = 'Cancelled' where id = '10700000-0000-0000-0000-000000000201';
select results_eq($$select status::text, closed_by_record_type, closed_by_record_status from tasks where id = '10700000-0000-0000-0000-000000000123'$$,
  $$values ('Done', 'procurement', 'Cancelled')$$, 'AC-RLT-003 a Cancelled purchase closes its task');
update material_requests set status = 'fulfilled' where id = '10700000-0000-0000-0000-000000000401';
select results_eq($$select status::text, closed_by_record_type, closed_by_record_status from tasks where id = '10700000-0000-0000-0000-000000000112'$$,
  $$values ('Done', 'material_request', 'fulfilled')$$, 'AC-RLT-003 a fulfilled material request closes its task');
-- remaining end states, one task each; written with no caller at all (a service-role style sync)
reset request.jwt.claims;
insert into tasks (id, org_id, name, procurement_id) values ('10700000-0000-0000-0000-000000000131','10700000-0000-0000-0000-00000000000a','p paid','10700000-0000-0000-0000-000000000203');
insert into tasks (id, org_id, name, expense_claim_id) values ('10700000-0000-0000-0000-000000000132','10700000-0000-0000-0000-00000000000a','c cancelled','10700000-0000-0000-0000-000000000302');
insert into tasks (id, org_id, name, material_request_id) values ('10700000-0000-0000-0000-000000000133','10700000-0000-0000-0000-00000000000a','m rejected','10700000-0000-0000-0000-000000000402');
insert into tasks (id, org_id, name, material_request_id) values ('10700000-0000-0000-0000-000000000134','10700000-0000-0000-0000-00000000000a','m cancelled','10700000-0000-0000-0000-000000000403');
update procurements set status = 'Paid' where id = '10700000-0000-0000-0000-000000000203';
update expense_claims set status = 'Cancelled' where id = '10700000-0000-0000-0000-000000000302';
update material_requests set status = 'rejected' where id = '10700000-0000-0000-0000-000000000402';
update material_requests set status = 'cancelled' where id = '10700000-0000-0000-0000-000000000403';
select is((select count(*)::int from tasks where id in ('10700000-0000-0000-0000-000000000131','10700000-0000-0000-0000-000000000132','10700000-0000-0000-0000-000000000133','10700000-0000-0000-0000-000000000134') and status = 'Done' and closed_by_record_status is not null), 4,
  'AC-RLT-003 Paid, Cancelled, rejected and cancelled all close their tasks');
-- a Done task is not re-closed, and moving between end states changes nothing (FR-RLT-016)
select is((select closed_by_record_status from tasks where id = '10700000-0000-0000-0000-000000000111'), 'Paid', 'AC-RLT-003 close reason stable');
update material_requests set status = 'fulfilled' where id = '10700000-0000-0000-0000-000000000403';   -- cancelled -> fulfilled (end to end)
select is((select closed_by_record_status from tasks where id = '10700000-0000-0000-0000-000000000134'), 'cancelled',
  'AC-RLT-016 moving between end states does not re-close or alter a Done task');

-- ── AC-RLT-011: leaving an end state does not reopen; a new task is accepted ───────────────────────────
update material_requests set status = 'draft' where id = '10700000-0000-0000-0000-000000000402';
select is((select status::text from tasks where id = '10700000-0000-0000-0000-000000000133'), 'Done', 'AC-RLT-011 the task stays Done when the record leaves its end state');
select lives_ok($$insert into tasks (org_id, name, material_request_id) values ('10700000-0000-0000-0000-00000000000a','fresh follow-up','10700000-0000-0000-0000-000000000402')$$,
  'AC-RLT-011 a new task for the same record is accepted');

-- ── AC-RLT-005: a non-editor closes through the record; a client cannot forge it ───────────────────────
-- Finance is not the creator or assignee of task 141; the claim is paid inside Finance's own JWT context.
insert into expense_claims (id, org_id, kind, claim_number, claimant_id, title, currency, amount, status) values
  ('10700000-0000-0000-0000-000000000304','10700000-0000-0000-0000-00000000000a','claim','EXP-RLT-4','10700000-0000-0000-0000-0000000000e1','Claim 4','USD',0,'Draft');
update expense_claims set status = 'Approved' where id = '10700000-0000-0000-0000-000000000304';
insert into tasks (id, org_id, name, expense_claim_id, assignee_id, created_by) values
  ('10700000-0000-0000-0000-000000000141','10700000-0000-0000-0000-00000000000a','pay follow-up','10700000-0000-0000-0000-000000000304','10700000-0000-0000-0000-0000000000e2','10700000-0000-0000-0000-0000000000f1');
set local request.jwt.claims = '{"sub":"10700000-0000-0000-0000-0000000000f2","role":"authenticated"}';
update expense_claims set status = 'Paid' where id = '10700000-0000-0000-0000-000000000304';
select results_eq($$select status::text, closed_by_record_type from tasks where id = '10700000-0000-0000-0000-000000000141'$$,
  $$values ('Done', 'expense_claim')$$, 'AC-RLT-005 Finance (not the task''s editor) pays the claim and the task closes');
reset request.jwt.claims;

-- the client cannot call the close function, and no session value does anything
insert into tasks (id, org_id, name, expense_claim_id, assignee_id, created_by) values
  ('10700000-0000-0000-0000-000000000142','10700000-0000-0000-0000-00000000000a','spoof target','10700000-0000-0000-0000-000000000303','10700000-0000-0000-0000-0000000000e2','10700000-0000-0000-0000-0000000000f1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10700000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$select close_tasks_for_record('expense_claim','10700000-0000-0000-0000-000000000303','Paid')$$,
  '42501', null, 'AC-RLT-005 the close function is not executable by a client');
select throws_ok($$select close_tasks_for_record('expense_claim','10700000-0000-0000-0000-000000000303','Paid')$$,
  '42501', null, 'AC-RLT-005 not even with a session value set');
set local app.actor_id = '10700000-0000-0000-0000-0000000000f2';
set local "app.system_close" = 'on';
set local request.jwt.claims = '{"sub":"10700000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok($$update tasks set status = 'Done', closed_by_record_type = 'expense_claim', closed_by_record_status = 'Paid', closed_by_record_at = now()
                    where id = '10700000-0000-0000-0000-000000000142'$$,
  '42501', 'the close reason is set by the system only', 'AC-RLT-005 even a manager cannot write the close columns (session values change nothing)');
select throws_ok($$insert into tasks (org_id, name, closed_by_record_type, closed_by_record_status, closed_by_record_at) values ('10700000-0000-0000-0000-00000000000a','forged','expense_claim','Paid',now())$$,
  '42501', 'the close reason is set by the system only', 'AC-RLT-005 nor on insert');
set local request.jwt.claims = '{"sub":"10700000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select throws_ok($$update tasks set closed_by_record_type = 'expense_claim', closed_by_record_status = 'Paid', closed_by_record_at = now()
                    where id = '10700000-0000-0000-0000-000000000142'$$,
  '42501', null, 'AC-RLT-005 an assignee cannot write the close columns either');
reset role;
reset request.jwt.claims;
select is((select status::text from tasks where id = '10700000-0000-0000-0000-000000000142'), 'To Do', 'AC-RLT-005 the spoof target is untouched');

-- ── AC-RLT-007: the live-status read respects the record table's row security ──────────────────────────
-- t151 links purchase 202 (raised by the PM; engineers cannot read it) and t152 links claim 303 (claimant eng1).
insert into tasks (id, org_id, name, procurement_id, assignee_id, created_by) values
  ('10700000-0000-0000-0000-000000000151','10700000-0000-0000-0000-00000000000a','sees task not purchase','10700000-0000-0000-0000-000000000202','10700000-0000-0000-0000-0000000000e2','10700000-0000-0000-0000-0000000000f1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10700000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select results_eq($$select link_type, readable, record_id is null, label is null, status is null, is_end_state is null
                      from task_linked_records(array['10700000-0000-0000-0000-000000000151'::uuid, '10700000-0000-0000-0000-000000000142'::uuid]) order by link_type$$,
  $$values ('expense_claim', false, true, true, true, true), ('procurement', false, true, true, true, true)$$,
  'AC-RLT-007 a user who sees the task but cannot read the record gets only the type: no label, status or end-state flag');
set local request.jwt.claims = '{"sub":"10700000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select results_eq($$select link_type, readable, label, status, is_end_state
                      from task_linked_records(array['10700000-0000-0000-0000-000000000142'::uuid])$$,
  $$values ('expense_claim', true, 'EXP-RLT-3', 'Draft', false)$$, 'AC-RLT-007 the claimant sees the number and live status');
set local request.jwt.claims = '{"sub":"10700000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select results_eq($$select link_type, readable, label, status
                      from task_linked_records(array['10700000-0000-0000-0000-000000000151'::uuid])$$,
  $$values ('procurement', true, 'RLP2', 'Draft')$$, 'AC-RLT-007 a reader of the purchase sees it');
select is((select count(*)::int from task_linked_records(array['10700000-0000-0000-0000-000000000151'::uuid, '10700000-0000-0000-0000-000000000102'::uuid])), 1,
  'AC-RLT-007 an unlinked task yields no row; one query serves a page');
reset role;
reset request.jwt.claims;
select is((select prosecdef from pg_proc where proname = 'task_linked_records'), false, 'AC-RLT-007 / FR-RLT-011 the read function is security invoker');

-- ── AC-RLT-010: history of a system close ──────────────────────────────────────────────────────────────
-- Task 141 closed inside Finance's own write: attributed to Finance, with the reason and the record type.
select results_eq($$select actor_id, changes -> 'status' ->> 'new', changes -> 'closed_by_record_status' ->> 'new', changes -> 'closed_by_record_type' ->> 'new'
                      from record_changes where entity_type = 'task' and entity_id = '10700000-0000-0000-0000-000000000141' and op = 'update'$$,
  $$values ('10700000-0000-0000-0000-0000000000f2'::uuid, 'Done', 'Paid', 'expense_claim')$$,
  'AC-RLT-010 the close shows the actor who moved the record, the closing reason and the record type');
-- Task 131 closed by a write with no caller (a service-role sync): no actor, reason present.
select results_eq($$select actor_id is null, changes -> 'closed_by_record_status' ->> 'new'
                      from record_changes where entity_type = 'task' and entity_id = '10700000-0000-0000-0000-000000000131' and op = 'update'$$,
  $$values (true, 'Paid')$$, 'AC-RLT-010 a sync-driven close has no actor and carries the reason');
-- A person's own close shows the person and no reason.
update tasks set status = 'Done' where id = '10700000-0000-0000-0000-000000000104';
select results_eq($$select changes ? 'closed_by_record_status' from record_changes where entity_type = 'task' and entity_id = '10700000-0000-0000-0000-000000000104' and changes ? 'status'$$,
  $$values (false)$$, 'AC-RLT-010 a person''s close stores no closing reason');

-- ── AC-RLT-013: hard delete of a linked record is blocked until the link is cleared ───────────────────
select throws_ok($$delete from procurements where id = '10700000-0000-0000-0000-000000000202'$$, '23503', null,
  'AC-RLT-013 a record with a linked task cannot be hard-deleted');
update tasks set archived_at = now() where id = '10700000-0000-0000-0000-000000000151';
select throws_ok($$delete from procurements where id = '10700000-0000-0000-0000-000000000202'$$, '23503', null,
  'AC-RLT-013 archiving the task does not release the record');
update tasks set procurement_id = null where id = '10700000-0000-0000-0000-000000000151';
select lives_ok($$delete from procurements where id = '10700000-0000-0000-0000-000000000202'$$, 'AC-RLT-013 clearing the link releases it');

-- ── AC-RLT-018: an externally-owned task domain is skipped, and the record write still succeeds ────────
insert into tasks (id, org_id, project_id, name, procurement_id) values
  ('10700000-0000-0000-0000-000000000181','10700000-0000-0000-0000-00000000000a','10700000-0000-0000-0000-0000000000d1','ext-owned','10700000-0000-0000-0000-000000000204');
insert into external_domain_ownership (org_id, external_tier, domain) values ('10700000-0000-0000-0000-00000000000a','clickup','tasks');
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id)
  values ('10700000-0000-0000-0000-00000000000a','10700000-0000-0000-0000-0000000000d1','clickup','rlt-list');
select lives_ok($$update procurements set status = 'Paid' where id = '10700000-0000-0000-0000-000000000204'$$,
  'AC-RLT-018 the record''s own write succeeds');
select is((select status::text from tasks where id = '10700000-0000-0000-0000-000000000181'), 'To Do',
  'AC-RLT-018 the externally-owned task is skipped, not closed and not raised');

select * from finish();
rollback;
