-- pipeline_stage_history_backfill.test.sql — #1638 AC-PSH-009 (backfill) + AC-PSH-010 (import RPC).
begin;
select plan(18);
insert into organizations (id, name) values ('16380000-0000-0000-0000-000000000004','PSH Backfill Org');
insert into projects (id, org_id, code, name, status, created_at, contract_date) values
  ('16380000-0000-0000-0000-000000000040','16380000-0000-0000-0000-000000000004','PSH-BF1','PSH backfill',
   'Won, Pending KoM', now() - interval '120 days', current_date - 70),
  ('16380000-0000-0000-0000-000000000042','16380000-0000-0000-0000-000000000004','PSH-BF2','PSH clamp',
   'Won, Pending KoM', now() - interval '120 days', current_date - 100);
insert into projects (id, org_id, code, name, status, created_at, contract_date) values
  ('16380000-0000-0000-0000-000000000045','16380000-0000-0000-0000-000000000004','PSH-BF4','PSH future win',
   'Ongoing Project', now() - interval '120 days', current_date + 30);
insert into projects (id, org_id, code, name, status, created_at, last_update) values
  ('16380000-0000-0000-0000-000000000043','16380000-0000-0000-0000-000000000004','PSH-BF3','PSH gap',
   'Negotiation', now() - interval '120 days', now() - interval '30 days');
-- Simulate pre-migration projects: no entries, recorded status changes only.
delete from project_stage_entries where project_id in
  ('16380000-0000-0000-0000-000000000040','16380000-0000-0000-0000-000000000042',
   '16380000-0000-0000-0000-000000000043','16380000-0000-0000-0000-000000000045');
insert into record_changes (org_id, entity_type, entity_id, op, changes, created_at) values
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000040','update',
   '{"status":{"old":"Leads","new":"Quotation Submitted"}}', now() - interval '90 days'),
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000040','update',
   '{"status":{"old":"Quotation Submitted","new":"Won, Pending KoM"}}', now() - interval '60 days'),
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000042','update',
   '{"status":{"old":"Leads","new":"Quotation Submitted"}}', now() - interval '90 days'),
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000042','update',
   '{"status":{"old":"Quotation Submitted","new":"Won, Pending KoM"}}', now() - interval '60 days'),
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000045','update',
   '{"status":{"old":"Leads","new":"Won, Pending KoM"}}', now() - interval '60 days'),
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000045','update',
   '{"status":{"old":"Won, Pending KoM","new":"Ongoing Project"}}', now() - interval '10 days'),
  -- 043's later move to Negotiation was never recorded.
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000043','update',
   '{"status":{"old":"Leads","new":"Quotation Submitted"}}', now() - interval '90 days');
-- record_changes.actor_id has no FK: 043's recorded move was made by a user with no profile row.
update record_changes set actor_id = '16380000-0000-0000-0000-0000000000ee'
 where entity_id = '16380000-0000-0000-0000-000000000043';
select is(backfill_project_stage_entries('16380000-0000-0000-0000-000000000040'), 1,
  'AC-PSH-009: one project backfilled');
select results_eq(
  $$ select stage::text, entered_on, source from project_stage_entries
      where project_id = '16380000-0000-0000-0000-000000000040' order by position $$,
  $$ values ('Leads', stage_org_date('16380000-0000-0000-0000-000000000004', now() - interval '120 days'), 'backfill'),
            ('Quotation Submitted', stage_org_date('16380000-0000-0000-0000-000000000004', now() - interval '90 days'), 'backfill'),
            ('Won, Pending KoM', current_date - 70, 'backfill') $$,
  'AC-PSH-009: start + each recorded change, Signed dated by contract_date');
select is(backfill_project_stage_entries('16380000-0000-0000-0000-000000000040'), 0,
  'AC-PSH-009: a project that already has a journey is left alone');
select is(backfill_project_stage_entries('16380000-0000-0000-0000-000000000042'), 1, 'AC-PSH-009: clamp fixture backfilled');
select results_eq(
  $$ select entered_on from project_stage_entries
      where project_id = '16380000-0000-0000-0000-000000000042' order by position $$,
  $$ values (stage_org_date('16380000-0000-0000-0000-000000000004', now() - interval '120 days')),
            (current_date - 100), (current_date - 100) $$,
  'AC-PSH-009: an earlier contract date clamps the entries before it, so dates never go backwards');
select is(backfill_project_stage_entries('16380000-0000-0000-0000-000000000043'), 1, 'AC-PSH-009: gap fixture backfilled');
select results_eq(
  $$ select stage::text, entered_on from project_stage_entries
      where project_id = '16380000-0000-0000-0000-000000000043' order by position $$,
  $$ values ('Leads', stage_org_date('16380000-0000-0000-0000-000000000004', now() - interval '120 days')),
            ('Quotation Submitted', stage_org_date('16380000-0000-0000-0000-000000000004', now() - interval '90 days')),
            ('Negotiation', stage_org_date('16380000-0000-0000-0000-000000000004', now() - interval '30 days')) $$,
  'AC-PSH-009: a move missing from record_changes is closed with the current status, dated last_update');
select is((select recorded_by from project_stage_entries
   where project_id = '16380000-0000-0000-0000-000000000043' and stage = 'Quotation Submitted'), null,
  'AC-PSH-009: a recorded move whose actor has no profile backfills with no recorder instead of aborting');
select is(backfill_project_stage_entries('16380000-0000-0000-0000-000000000045'), 1, 'AC-PSH-009: future-win fixture backfilled');
select results_eq(
  $$ select stage::text, entered_on from project_stage_entries
      where project_id = '16380000-0000-0000-0000-000000000045' and stage <> 'Leads' order by position $$,
  $$ values ('Won, Pending KoM', current_date + 30), ('Ongoing Project', current_date + 30) $$,
  'AC-PSH-009: Signed stays on a future contract date and the later move follows it, never the reverse');
insert into auth.users (id, email) values ('16380000-0000-0000-0000-0000000000d2','psh-imp@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16380000-0000-0000-0000-0000000000d2','16380000-0000-0000-0000-000000000004','PSH Imp','psh-imp@example.test','Project Manager','active');
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('16380000-0000-0000-0000-000000000041','16380000-0000-0000-0000-000000000004','PSH-IMP','PSH import','Leads',
   '16380000-0000-0000-0000-0000000000d2'),
  ('16380000-0000-0000-0000-000000000044','16380000-0000-0000-0000-000000000004','PSH-IMP2','PSH lead only','Leads',
   '16380000-0000-0000-0000-0000000000d2');
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select import_project_stage_history('16380000-0000-0000-0000-000000000041',
  '[{"stage":"PQ Submitted","entered_on":"2026-07-01","note":"x"},{"stage":"Quotation Submitted","entered_on":"2026-07-15"}]');
select results_eq($$ select stage::text, source from project_stage_entries
   where project_id = '16380000-0000-0000-0000-000000000041' order by position $$,
  $$ values ('Leads','origination'),('PQ Submitted','import'),('Quotation Submitted','import') $$,
  'AC-PSH-010: import records one entry per dated stage');
select is((select entered_on from project_stage_entries
   where project_id = '16380000-0000-0000-0000-000000000041' and stage = 'Leads'), date '2026-07-01',
  'AC-PSH-010: with no Lead date, the lead takes the first imported date so the past dates can land');
select is((select status::text from projects where id = '16380000-0000-0000-0000-000000000041'),
  'Quotation Submitted', 'AC-PSH-010: the project lands at the latest dated stage');
select throws_ok($$ select import_project_stage_history('16380000-0000-0000-0000-000000000041',
  '[{"stage":"PQ Submitted","entered_on":"2026-07-01"}]') $$, 'P0001', null,
  'AC-PSH-010: a second import call is refused');
select import_project_stage_history('16380000-0000-0000-0000-000000000044', '[{"stage":"Leads","entered_on":"2026-07-01"}]');
reset role;
select is((select detail -> 'entries' from audit_events
   where action = 'project.transition' and entity_id = '16380000-0000-0000-0000-000000000041'),
  '[{"stage":"PQ Submitted","entered_on":"2026-07-01"},{"stage":"Quotation Submitted","entered_on":"2026-07-15"}]'::jsonb,
  'AC-PSH-010: the audit trail keeps the normalized stages and dates, not the caller''s raw payload');
select is((select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000044'),
  date '2026-07-01', 'AC-PSH-010: a lead-only import dates the lead');
select isnt((select redated_at from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000044'),
  null, 'AC-PSH-010: the imported lead date is marked as changed');
select ok(exists (select 1 from audit_events where entity_id = '16380000-0000-0000-0000-000000000044'
   and action like 'project.%' and actor_id = '16380000-0000-0000-0000-0000000000d2'),
  'AC-PSH-010: a lead-only import is on the audit trail');
select * from finish();
rollback;
