-- 0991_task_work_order_proof.test.sql — #2531. Migration under test: 0991_task_work_order_proof.sql.
-- AC-TWOP-001..006, 011, 012 (count). Fixtures are written as the owner role; assertions run as the actor.
-- ⚑ Row-changing assertions COUNT ROWS where an RLS-denied write is a silent no-op.
begin;
select plan(22);

insert into organizations (id, name) values
  ('09910000-0000-0000-0000-00000000000a','TWOP Org A'),
  ('09910000-0000-0000-0000-00000000000b','TWOP Org B');
insert into auth.users (id, email) values
  ('09910000-0000-0000-0000-0000000000f1','twop-pm@example.com'),
  ('09910000-0000-0000-0000-0000000000e1','twop-eng@example.com'),
  ('09910000-0000-0000-0000-0000000000b1','twop-pm-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('09910000-0000-0000-0000-0000000000f1','09910000-0000-0000-0000-00000000000a','PM A','twop-pm@example.com','Project Manager','active'),
  ('09910000-0000-0000-0000-0000000000e1','09910000-0000-0000-0000-00000000000a','Eng A','twop-eng@example.com','Engineer','active'),
  ('09910000-0000-0000-0000-0000000000b1','09910000-0000-0000-0000-00000000000b','PM B','twop-pm-b@example.com','Project Manager','active');
insert into projects (id, org_id, code, name, status) values
  ('09910000-0000-0000-0000-0000000000d1','09910000-0000-0000-0000-00000000000a','TWP','Project P','Ongoing Project'),
  ('09910000-0000-0000-0000-0000000000d2','09910000-0000-0000-0000-00000000000a','TWQ','Project Q','Ongoing Project');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('09910000-0000-0000-0000-000000000401','09910000-0000-0000-0000-00000000000a','09910000-0000-0000-0000-0000000000d1','WO of P','Issued',100,'exclusive',0),
  ('09910000-0000-0000-0000-000000000402','09910000-0000-0000-0000-00000000000a','09910000-0000-0000-0000-0000000000d2','WO of Q','Issued',100,'exclusive',0);
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, cancelled_at) values
  ('09910000-0000-0000-0000-000000000403','09910000-0000-0000-0000-00000000000a','09910000-0000-0000-0000-0000000000d1','WO cancelled','Cancelled',0,'exclusive',0,now());
set local session_replication_role = origin;
-- 101 free task (assignee Eng); 102 proof-required task (assignee Eng); 103 project-less; 104 Done+required+1 proof; 105 linked to WO of P
insert into tasks (id, org_id, project_id, name, status, assignee_id, created_by) values
  ('09910000-0000-0000-0000-000000000101','09910000-0000-0000-0000-00000000000a','09910000-0000-0000-0000-0000000000d1','Free','To Do','09910000-0000-0000-0000-0000000000e1','09910000-0000-0000-0000-0000000000f1'),
  ('09910000-0000-0000-0000-000000000102','09910000-0000-0000-0000-00000000000a','09910000-0000-0000-0000-0000000000d1','Needs proof','In Progress','09910000-0000-0000-0000-0000000000e1','09910000-0000-0000-0000-0000000000f1'),
  ('09910000-0000-0000-0000-000000000103','09910000-0000-0000-0000-00000000000a',null,'No project','To Do',null,'09910000-0000-0000-0000-0000000000f1'),
  ('09910000-0000-0000-0000-000000000105','09910000-0000-0000-0000-00000000000a','09910000-0000-0000-0000-0000000000d1','Linked','To Do',null,'09910000-0000-0000-0000-0000000000f1');
update tasks set proof_required = true where id = '09910000-0000-0000-0000-000000000102';

-- ── PM: link rule (AC-TWOP-001/002/011) ───────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"09910000-0000-0000-0000-0000000000f1","role":"authenticated"}';

select lives_ok($$update tasks set work_order_id = '09910000-0000-0000-0000-000000000401' where id = '09910000-0000-0000-0000-000000000101'$$,
  'AC-TWOP-001 a task links to a work order of its own project');
select throws_ok($$update tasks set work_order_id = '09910000-0000-0000-0000-000000000402' where id = '09910000-0000-0000-0000-000000000101'$$,
  '23514', null, 'AC-TWOP-001 a work order of another project is refused');
select throws_ok($$update tasks set work_order_id = '09910000-0000-0000-0000-000000000403' where id = '09910000-0000-0000-0000-000000000105'$$,
  '23514', null, 'AC-TWOP-001 a Cancelled work order takes no new task');
select throws_ok($$update tasks set work_order_id = '09910000-0000-0000-0000-000000000401' where id = '09910000-0000-0000-0000-000000000103'$$,
  '23514', null, 'AC-TWOP-002 a project-less task cannot name a work order');
select throws_ok($$update tasks set project_id = '09910000-0000-0000-0000-0000000000d2' where id = '09910000-0000-0000-0000-000000000101'$$,
  '23514', 'task is linked to a work order of its current project; clear the work order before moving it',
  'AC-TWOP-011 moving a linked task is refused with the way out');
select lives_ok($$update tasks set work_order_id = null, project_id = '09910000-0000-0000-0000-0000000000d2' where id = '09910000-0000-0000-0000-000000000101'$$,
  'AC-TWOP-011 clearing the link first lets the task move');

-- ── Engineer assignee: structure columns (AC-TWOP-003) and Done guard (AC-TWOP-004) ───────────────
set local request.jwt.claims = '{"sub":"09910000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$update tasks set work_order_id = '09910000-0000-0000-0000-000000000401' where id = '09910000-0000-0000-0000-000000000102'$$,
  '42501', 'only the task status may be changed by its assignee', 'AC-TWOP-003 an assignee cannot set work_order_id');
select throws_ok($$update tasks set proof_required = false where id = '09910000-0000-0000-0000-000000000102'$$,
  '42501', 'only the task status may be changed by its assignee', 'AC-TWOP-003 an assignee cannot clear proof_required');
select throws_ok($$insert into tasks (org_id, project_id, name, proof_required, assignee_id) values ('09910000-0000-0000-0000-00000000000a','09910000-0000-0000-0000-0000000000d1','sneaky',true,'09910000-0000-0000-0000-0000000000e1')$$,
  '42501', null, 'AC-TWOP-003 an Engineer cannot create a task that requires proof');
select throws_ok($$update tasks set status = 'Done' where id = '09910000-0000-0000-0000-000000000102'$$,
  '23514', 'proof of completion is required before this task can be Done', 'AC-TWOP-004 assignee: Done refused without proof');

select lives_ok($$insert into task_proofs (id, task_id, file_path, file_name) values ('09910000-0000-0000-0000-000000000501','09910000-0000-0000-0000-000000000102','09910000-0000-0000-0000-00000000000a/09910000-0000-0000-0000-000000000102/09910000-0000-0000-0000-000000000501/site.jpg','site.jpg')$$,
  'AC-TWOP-004 the assignee adds a proof');
select lives_ok($$update tasks set status = 'Done' where id = '09910000-0000-0000-0000-000000000102'$$,
  'AC-TWOP-004 with a proof attached, Done succeeds');
select throws_ok($$update task_proofs set archived_at = now() where id = '09910000-0000-0000-0000-000000000501'$$,
  '23514', 'proof of a completed task cannot be removed; reopen the task first', 'AC-TWOP-005 proof of a Done proof-required task cannot be removed');
select lives_ok($$update tasks set status = 'In Progress' where id = '09910000-0000-0000-0000-000000000102'$$, 'AC-TWOP-005 reopening is allowed');
select is((with u as (update task_proofs set archived_at = now() where id = '09910000-0000-0000-0000-000000000501' returning 1) select count(*)::int from u), 1,
  'AC-TWOP-005 once reopened the proof can be removed');

-- PM: Done guard covers the structure policy too (AC-TWOP-004)
set local request.jwt.claims = '{"sub":"09910000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok($$update tasks set status = 'Done' where id = '09910000-0000-0000-0000-000000000102'$$,
  '23514', null, 'AC-TWOP-004 PM: Done refused when the only proof was removed');
select throws_ok($$update tasks set status = 'Done', proof_required = true where id = '09910000-0000-0000-0000-000000000101'$$,
  '23514', null, 'AC-TWOP-004 PM: requiring proof in the same write as Done is refused');

-- ── Cap (AC-TWOP-012) ─────────────────────────────────────────────────────────────────────────────
reset role;
insert into task_proofs (task_id, file_path) select '09910000-0000-0000-0000-000000000105', 'p'||g from generate_series(1,10) g;
select throws_ok($$insert into task_proofs (task_id, file_path) values ('09910000-0000-0000-0000-000000000105','p11')$$,
  '23514', 'a task holds at most 10 proof attachments', 'AC-TWOP-012 the 11th proof is refused');

-- ── Tenancy (AC-TWOP-006) ─────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"09910000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from task_proofs), 0, 'AC-TWOP-006 another org reads no proofs');
select throws_ok($$insert into task_proofs (task_id, file_path) values ('09910000-0000-0000-0000-000000000101','x')$$,
  '42501', null, 'AC-TWOP-006 another org cannot add a proof to a task');
select is((select count(*)::int from storage.objects where bucket_id = 'task-proofs'), 0, 'AC-TWOP-006 another org reads no proof objects');

select * from finish();
rollback;
