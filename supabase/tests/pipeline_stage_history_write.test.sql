-- pipeline_stage_history_write.test.sql — #1638 stage entries: append, key dates, win pull-back, re-date,
-- add-skipped, authority, audit. Spec docs/specs/pipeline-stage-history.spec.md.
begin;
select plan(38);

insert into organizations (id, name) values
  ('16380000-0000-0000-0000-000000000001','PSH Org A'),
  ('16380000-0000-0000-0000-000000000002','PSH Org B');
insert into auth.users (id, email) values
  ('16380000-0000-0000-0000-0000000000a2','psh-pm-a@example.test'),
  ('16380000-0000-0000-0000-0000000000a3','psh-ex-a@example.test'),
  ('16380000-0000-0000-0000-0000000000a4','psh-en-a@example.test'),
  ('16380000-0000-0000-0000-0000000000a5','psh-dis-a@example.test'),
  ('16380000-0000-0000-0000-0000000000b2','psh-pm-b@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16380000-0000-0000-0000-0000000000a2','16380000-0000-0000-0000-000000000001','PSH PM A','psh-pm-a@example.test','Project Manager','active'),
  ('16380000-0000-0000-0000-0000000000a3','16380000-0000-0000-0000-000000000001','PSH Ex A','psh-ex-a@example.test','Executive','active'),
  ('16380000-0000-0000-0000-0000000000a4','16380000-0000-0000-0000-000000000001','PSH En A','psh-en-a@example.test','Engineer','active'),
  ('16380000-0000-0000-0000-0000000000a5','16380000-0000-0000-0000-000000000001','PSH Dis A','psh-dis-a@example.test','Project Manager','disabled'),
  ('16380000-0000-0000-0000-0000000000b2','16380000-0000-0000-0000-000000000002','PSH PM B','psh-pm-b@example.test','Project Manager','active');
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('16380000-0000-0000-0000-000000000010','16380000-0000-0000-0000-000000000001','PSH-1','PSH journey','Leads','16380000-0000-0000-0000-0000000000a2'),
  ('16380000-0000-0000-0000-000000000020','16380000-0000-0000-0000-000000000002','PSH-B','PSH org B','Leads','16380000-0000-0000-0000-0000000000b2');
-- Created 60 days ago so Task 5 has room to backdate after its origination entry.
insert into projects (id, org_id, code, name, status, project_manager_id, created_at) values
  ('16380000-0000-0000-0000-000000000011','16380000-0000-0000-0000-000000000001','PSH-2','PSH dated','Leads',
   '16380000-0000-0000-0000-0000000000a2', now() - interval '60 days');

set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select transition_project('16380000-0000-0000-0000-000000000010','PQ Submitted');
select transition_project('16380000-0000-0000-0000-000000000010','Quotation Submitted');
select transition_project('16380000-0000-0000-0000-000000000010','Tender Submitted');
select transition_project('16380000-0000-0000-0000-000000000010','Quotation Submitted');

select results_eq(
  $$ select stage::text, source from project_stage_entries
     where project_id = '16380000-0000-0000-0000-000000000010' order by position $$,
  $$ values ('Leads','origination'),('PQ Submitted','transition'),('Quotation Submitted','transition'),
            ('Tender Submitted','transition'),('Quotation Submitted','transition') $$,
  'AC-PSH-001: every stage entry is kept in journey order, including the re-quote');
select is(
  (select count(*)::int from project_stage_entries
    where project_id = '16380000-0000-0000-0000-000000000010' and recorded_by = '16380000-0000-0000-0000-0000000000a2'),
  4, 'AC-PSH-001: each move records who made it');
reset role;
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('16380000-0000-0000-0000-000000000012','16380000-0000-0000-0000-000000000001','PSH-3','PSH win','Leads','16380000-0000-0000-0000-0000000000a2'),
  ('16380000-0000-0000-0000-000000000013','16380000-0000-0000-0000-000000000001','PSH-4','PSH lose','Leads','16380000-0000-0000-0000-0000000000a2'),
  ('16380000-0000-0000-0000-000000000015','16380000-0000-0000-0000-000000000001','PSH-6','PSH late win','Leads','16380000-0000-0000-0000-0000000000a2'),
  ('16380000-0000-0000-0000-000000000016','16380000-0000-0000-0000-000000000001','PSH-7','PSH person-dated','Leads','16380000-0000-0000-0000-0000000000a2'),
  ('16380000-0000-0000-0000-000000000017','16380000-0000-0000-0000-000000000001','PSH-8','PSH future win','Leads','16380000-0000-0000-0000-0000000000a2');
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select transition_project('16380000-0000-0000-0000-000000000012','PQ Submitted');
select transition_project('16380000-0000-0000-0000-000000000012','Quotation Submitted');
-- contract_value is 0 → the win SoD has nothing to ratify (0236 clause (i)).
select transition_project('16380000-0000-0000-0000-000000000012','Won, Pending KoM','PO-PSH-1', current_date);
select transition_project('16380000-0000-0000-0000-000000000013','Loss Tender');
-- Deal recorded after it was signed (spec T17): every earlier entry is dated today, the contract 10 days ago.
select transition_project('16380000-0000-0000-0000-000000000015','PQ Submitted');
select transition_project('16380000-0000-0000-0000-000000000015','Quotation Submitted');
select transition_project('16380000-0000-0000-0000-000000000015','Won, Pending KoM','PO-PSH-2', current_date - 10);
select transition_project('16380000-0000-0000-0000-000000000016','PQ Submitted');
select transition_project('16380000-0000-0000-0000-000000000016','Quotation Submitted');
select transition_project('16380000-0000-0000-0000-000000000017','PQ Submitted');
select transition_project('16380000-0000-0000-0000-000000000017','Quotation Submitted');
select transition_project('16380000-0000-0000-0000-000000000017','Won, Pending KoM','PO-PSH-4', current_date + 30);
reset role;
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000012'
    order by position desc limit 1), current_date,
  'AC-PSH-002: the Signed entry is dated with the contract date');
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000013'
    order by position desc limit 1),
  (select stage_org_date(org_id, decided_at) from projects where id = '16380000-0000-0000-0000-000000000013'),
  'AC-PSH-002: the Lost entry is dated with decided_at in the org timezone');
select results_eq(
  $$ select stage::text, entered_on, redated_at is not null from project_stage_entries
      where project_id = '16380000-0000-0000-0000-000000000015' order by position $$,
  $$ values ('Leads', current_date - 10, true), ('PQ Submitted', current_date - 10, true),
            ('Quotation Submitted', current_date - 10, true), ('Won, Pending KoM', current_date - 10, false) $$,
  'AC-PSH-002: a win dated before system-dated entries moves them back to the contract date, marked');
-- A person dated the Quoted entry 2 days ago (as stage_entry_set_date would); a win dated before it is refused.
-- The system-dated Leads/PQ entries move with it in one statement, so the journey stays in order.
update project_stage_entries
   set entered_on = current_date - 2,
       redated_at = case when stage = 'Quotation Submitted' then now() end
 where project_id = '16380000-0000-0000-0000-000000000016';
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ select transition_project('16380000-0000-0000-0000-000000000016','Won, Pending KoM','PO-PSH-3', current_date - 5) $$,
  '23514', null, 'AC-PSH-002: a win dated before a stage date a person set is refused');
reset role;
-- A win dated in the future: the next move (dated today) must neither drag Signed off contract_date nor land.
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ select transition_project('16380000-0000-0000-0000-000000000017','Ongoing Project') $$,
  '23514', null, 'AC-PSH-004: a move after a win dated in the future is refused, not allowed to re-date Signed');
reset role;
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000017'
     and stage = 'Won, Pending KoM'), current_date + 30,
  'AC-PSH-004: Signed still equals contract_date after the refused move');
update projects set contract_date = current_date - 1 where id = '16380000-0000-0000-0000-000000000012';
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000012'
     and stage = 'Won, Pending KoM'), current_date - 1,
  'AC-PSH-002: the Signed entry follows contract_date on any path (seed / server-side update)');
update projects set contract_date = current_date where id = '16380000-0000-0000-0000-000000000012';
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select transition_project('16380000-0000-0000-0000-000000000011','PQ Submitted');
reset role;
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000011'
    order by position desc limit 1),
  native_org_today('16380000-0000-0000-0000-000000000001'),
  'AC-PSH-003: a move is dated the org''s today');
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select redate_stage_entry((select id from project_stage_entries
  where project_id = '16380000-0000-0000-0000-000000000011' and stage = 'PQ Submitted'), current_date - 20);
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000011'
     and stage = 'PQ Submitted'), current_date - 20,
  'AC-PSH-003: an editor backdates the new entry');
select throws_ok(
  $$ select redate_stage_entry((select id from project_stage_entries
       where project_id = '16380000-0000-0000-0000-000000000011' and stage = 'Leads'), current_date - 10) $$,
  '23514', null, 'AC-PSH-003: an entry cannot be dated after the entry that follows it');
select throws_ok(
  $$ select redate_stage_entry((select id from project_stage_entries
       where project_id = '16380000-0000-0000-0000-000000000011' and stage = 'PQ Submitted'), current_date + 2) $$,
  '23514', null, 'AC-PSH-003: a future stage date is refused');
reset role;
update project_stage_entries set entered_on = current_date - 30
 where project_id = '16380000-0000-0000-0000-000000000012' and stage <> 'Won, Pending KoM';
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select redate_stage_entry(
  (select id from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000012'
     and stage = 'Won, Pending KoM'), current_date - 5);
select results_eq(
  $$ select e.entered_on, p.contract_date, p.decided_at::date
       from project_stage_entries e join projects p on p.id = e.project_id
      where e.project_id = '16380000-0000-0000-0000-000000000012' and e.stage = 'Won, Pending KoM' $$,
  $$ values (current_date - 5, current_date - 5, current_date - 5) $$,
  'AC-PSH-004: re-dating Signed moves the entry, contract_date and decided_at together');
select isnt((select redated_at from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000012'
   and stage = 'Won, Pending KoM'), null, 'AC-PSH-004: a re-dated entry is marked');
select throws_ok(
  $$ select redate_stage_entry((select id from project_stage_entries
       where project_id = '16380000-0000-0000-0000-000000000012' and stage = 'Won, Pending KoM'), current_date - 31) $$,
  '23514', null, 'AC-PSH-004: re-dating before the previous entry is refused');
select is((select contract_date from projects where id = '16380000-0000-0000-0000-000000000012'),
  current_date - 5, 'AC-PSH-004: the refused re-date changed nothing');
reset role;
insert into projects (id, org_id, code, name, status, project_manager_id, created_at) values
  ('16380000-0000-0000-0000-000000000014','16380000-0000-0000-0000-000000000001','PSH-5','PSH skip','Leads',
   '16380000-0000-0000-0000-0000000000a2', now() - interval '90 days');
-- Simulate a skipped stage: jump the status as postgres (the trigger appends Tender at position 2, dated
-- today), then date that entry 40 days ago as a backfilled one.
update projects set status = 'Tender Submitted' where id = '16380000-0000-0000-0000-000000000014';
update project_stage_entries set entered_on = current_date - 40, source = 'backfill'
 where project_id = '16380000-0000-0000-0000-000000000014' and stage = 'Tender Submitted';
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select add_skipped_stage_entry(
  (select id from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000014' and position = 2),
  'Quotation Submitted', current_date - 60);
select results_eq(
  $$ select stage::text, source from project_stage_entries
      where project_id = '16380000-0000-0000-0000-000000000014' order by position $$,
  $$ values ('Leads','origination'),('Quotation Submitted','added'),('Tender Submitted','backfill') $$,
  'AC-PSH-005: a skipped stage is inserted between its neighbours');
select is((select status::text from projects where id = '16380000-0000-0000-0000-000000000014'),
  'Tender Submitted', 'AC-PSH-005: adding a skipped stage never changes the status');
select throws_ok(
  $$ select add_skipped_stage_entry((select id from project_stage_entries
       where project_id = '16380000-0000-0000-0000-000000000014' and position = 2), 'PQ Submitted', current_date - 39) $$,
  '23514', null, 'AC-PSH-005: a skipped stage dated after the next entry is refused');
select throws_ok(
  $$ select add_skipped_stage_entry((select id from project_stage_entries
       where project_id = '16380000-0000-0000-0000-000000000014' and position = 2), 'Won, Pending KoM', current_date - 50) $$,
  'P0001', null, 'AC-PSH-005: only a pre-award stage can be added');
-- The target entry id is resolved as postgres: a caller who cannot read the entry (disabled, other org) would
-- otherwise pass NULL and get "not found" instead of exercising the gate.
reset role;
create temp table psh_target on commit drop as
  select id from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000010'
   order by position limit 1;
grant select on psh_target to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select redate_stage_entry((select id from psh_target), current_date) $$,
  '42501', null, 'AC-PSH-006: an Engineer cannot re-date a stage');
select throws_ok($$ select add_skipped_stage_entry((select id from psh_target), 'PQ Submitted', current_date) $$,
  '42501', null, 'AC-PSH-006: an Engineer cannot add a skipped stage');
select throws_ok($$ select import_project_stage_history('16380000-0000-0000-0000-000000000010', '[]') $$,
  '42501', null, 'AC-PSH-006: an Engineer cannot import stage history');
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select redate_stage_entry((select id from psh_target), current_date) $$,
  '42501', null, 'AC-PSH-006: a disabled PM cannot re-date a stage');
select throws_ok($$ select add_skipped_stage_entry((select id from psh_target), 'PQ Submitted', current_date) $$,
  '42501', null, 'AC-PSH-006: a disabled PM cannot add a skipped stage');
select throws_ok($$ select import_project_stage_history('16380000-0000-0000-0000-000000000010', '[]') $$,
  '42501', null, 'AC-PSH-006: a disabled PM cannot import stage history');
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($$ select redate_stage_entry((select id from psh_target), current_date) $$,
  '42501', null, 'AC-PSH-006: an org-B PM cannot re-date an org-A entry (the definer finds it; the gate refuses)');
select throws_ok($$ select add_skipped_stage_entry((select id from psh_target), 'PQ Submitted', current_date) $$,
  '42501', null, 'AC-PSH-006: an org-B PM cannot add a stage to an org-A journey');
select throws_ok($$ select import_project_stage_history('16380000-0000-0000-0000-000000000010', '[]') $$,
  '42501', null, 'AC-PSH-006: an org-B PM cannot import into an org-A project');
select is((select count(*)::int from project_stage_entries
  where project_id = '16380000-0000-0000-0000-000000000010'), 0, 'AC-PSH-006: org-B reads zero org-A entries');
select throws_ok($$ insert into project_stage_entries (org_id, project_id, stage, entered_on, position, source)
  values ('16380000-0000-0000-0000-000000000002','16380000-0000-0000-0000-000000000020','PQ Submitted', current_date, 9, 'added') $$,
  '42501', null, 'AC-PSH-006: a direct INSERT is refused');
select throws_ok($$ update project_stage_entries set entered_on = current_date
  where project_id = '16380000-0000-0000-0000-000000000020' $$,
  '42501', null, 'AC-PSH-006: a direct UPDATE is refused');
select throws_ok($$ delete from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000020' $$,
  '42501', null, 'AC-PSH-006: a direct DELETE is refused');
reset role;
select ok(exists (select 1 from record_changes where entity_type = 'project_stage_entry'
   and parent_type = 'project' and parent_id = '16380000-0000-0000-0000-000000000012'
   and op = 'update' and changes -> 'entered_on' ->> 'new' = (current_date - 5)::text
   and actor_id = '16380000-0000-0000-0000-0000000000a3'),
  'AC-PSH-007: a re-date is in record_changes under the project');
select ok(exists (select 1 from record_changes where entity_type = 'project_stage_entry'
   and parent_id = '16380000-0000-0000-0000-000000000014' and op = 'insert'),
  'AC-PSH-007: an added stage is in record_changes under the project');
select ok(exists (select 1 from audit_events where action = 'project.stage_entry.redate'
   and actor_id = '16380000-0000-0000-0000-0000000000a3' and entity_id = '16380000-0000-0000-0000-000000000012'
   and detail->>'to' = (current_date - 5)::text),
  'AC-PSH-007: the re-date is on the audit trail with actor and new date');
select ok(exists (select 1 from audit_events where action = 'project.stage_entry.add'
   and entity_id = '16380000-0000-0000-0000-000000000014'),
  'AC-PSH-007: the added stage is on the audit trail');
select * from finish();
rollback;
