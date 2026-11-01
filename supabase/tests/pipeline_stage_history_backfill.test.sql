-- pipeline_stage_history_backfill.test.sql — #1638 AC-PSH-009 (backfill) + AC-PSH-010 (import RPC).
begin;
select plan(11);
insert into organizations (id, name) values ('16380000-0000-0000-0000-000000000004','PSH Backfill Org');
insert into projects (id, org_id, code, name, status, created_at, contract_date) values
  ('16380000-0000-0000-0000-000000000040','16380000-0000-0000-0000-000000000004','PSH-BF1','PSH backfill',
   'Won, Pending KoM', now() - interval '120 days', current_date - 70),
  ('16380000-0000-0000-0000-000000000042','16380000-0000-0000-0000-000000000004','PSH-BF2','PSH clamp',
   'Won, Pending KoM', now() - interval '120 days', current_date - 100);
insert into projects (id, org_id, code, name, status, created_at, last_update) values
  ('16380000-0000-0000-0000-000000000043','16380000-0000-0000-0000-000000000004','PSH-BF3','PSH gap',
   'Negotiation', now() - interval '120 days', now() - interval '30 days');
-- Simulate pre-migration projects: no entries, recorded status changes only.
delete from project_stage_entries where project_id in
  ('16380000-0000-0000-0000-000000000040','16380000-0000-0000-0000-000000000042',
   '16380000-0000-0000-0000-000000000043');
insert into record_changes (org_id, entity_type, entity_id, op, changes, created_at) values
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000040','update',
   '{"status":{"old":"Leads","new":"Quotation Submitted"}}', now() - interval '90 days'),
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000040','update',
   '{"status":{"old":"Quotation Submitted","new":"Won, Pending KoM"}}', now() - interval '60 days'),
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000042','update',
   '{"status":{"old":"Leads","new":"Quotation Submitted"}}', now() - interval '90 days'),
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000042','update',
   '{"status":{"old":"Quotation Submitted","new":"Won, Pending KoM"}}', now() - interval '60 days'),
  -- 043's later move to Negotiation was never recorded.
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000043','update',
   '{"status":{"old":"Leads","new":"Quotation Submitted"}}', now() - interval '90 days');
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
insert into auth.users (id, email) values ('16380000-0000-0000-0000-0000000000d2','psh-imp@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16380000-0000-0000-0000-0000000000d2','16380000-0000-0000-0000-000000000004','PSH Imp','psh-imp@example.test','Project Manager','active');
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('16380000-0000-0000-0000-000000000041','16380000-0000-0000-0000-000000000004','PSH-IMP','PSH import','Leads',
   '16380000-0000-0000-0000-0000000000d2');
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select import_project_stage_history('16380000-0000-0000-0000-000000000041',
  '[{"stage":"PQ Submitted","entered_on":"2026-07-01"},{"stage":"Quotation Submitted","entered_on":"2026-07-15"}]');
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
select * from finish();
rollback;
