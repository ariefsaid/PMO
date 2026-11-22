-- 1221_email_real_producers.test.sql — #2711. Guards the title classifier (migration 1221): each REAL producer, driven through
-- its own entry point, must leave an email_outbox row with the right event. If a producer's title changes and the classifier
-- no longer recognises it, its case here goes red instead of the email silently stopping. AC-EML-006.
begin;
create extension if not exists pgtap;
select plan(8);

insert into organizations (id, name, default_currency, default_timezone) values ('27120000-0000-0000-0000-00000000000a', 'EMP Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('27120000-0000-0000-0000-0000000000a1', 'emp-admin@example.com'),
  ('27120000-0000-0000-0000-0000000000a2', 'emp-pm@example.com'),
  ('27120000-0000-0000-0000-0000000000a3', 'emp-eng@example.com'),
  ('27120000-0000-0000-0000-0000000000a4', 'emp-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27120000-0000-0000-0000-0000000000a1', '27120000-0000-0000-0000-00000000000a', 'EMP Admin', 'emp-admin@example.com', 'Admin', 'active'),
  ('27120000-0000-0000-0000-0000000000a2', '27120000-0000-0000-0000-00000000000a', 'EMP PM', 'emp-pm@example.com', 'Project Manager', 'active'),
  ('27120000-0000-0000-0000-0000000000a3', '27120000-0000-0000-0000-00000000000a', 'EMP Eng', 'emp-eng@example.com', 'Engineer', 'active'),
  ('27120000-0000-0000-0000-0000000000a4', '27120000-0000-0000-0000-00000000000a', 'EMP Fin', 'emp-fin@example.com', 'Finance', 'active');
update profiles set manager_id = '27120000-0000-0000-0000-0000000000a2' where id = '27120000-0000-0000-0000-0000000000a3';
insert into email_event_settings (org_id, event_key, enabled) values
  ('27120000-0000-0000-0000-00000000000a', 'approval_request', true),
  ('27120000-0000-0000-0000-00000000000a', 'overdue_item', true),
  ('27120000-0000-0000-0000-00000000000a', 'document_expiry', true);

-- "an email row with this event exists for a notification about this entity"
create function pg_temp.queued(p_entity uuid, p_event text) returns boolean language sql stable as $$
  select exists (select 1 from email_outbox o join notifications n on n.id = o.notification_id
                  where n.metadata->'entity'->>'id' = p_entity::text and o.event_key = p_event) $$;

insert into projects (id, org_id, name, status, project_manager_id) values
  ('27120000-0000-0000-0000-0000000000d1', '27120000-0000-0000-0000-00000000000a', 'EMP Site', 'Ongoing Project', '27120000-0000-0000-0000-0000000000a2');

-- 1. procurement: Draft -> Requested through transition_procurement (flat approver list, no routing configured)
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category) values
  ('27120000-0000-0000-0000-000000000401', '27120000-0000-0000-0000-00000000000a', 'EMP purchase', null, '27120000-0000-0000-0000-0000000000a3', 'Draft', 5, null);
set local role authenticated;
set local request.jwt.claims = '{"sub":"27120000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select transition_procurement('27120000-0000-0000-0000-000000000401', 'Requested');
reset role;
set local request.jwt.claims = '{}';
select ok(pg_temp.queued('27120000-0000-0000-0000-000000000401', 'approval_request'), 'AC-EML-006 the procurement approval hand-off queues an approval_request email');

-- 2. expense advance submitted (the expense claim trigger, as the claims test drives it)
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status) values
  ('27120000-0000-0000-0000-000000000402', '27120000-0000-0000-0000-00000000000a', 'advance', '27120000-0000-0000-0000-0000000000a3', 'EMP advance', 250, 'Draft');
update expense_claims set status = 'Submitted', submitted_at = now(), claim_number = 'ADV-2712000402' where id = '27120000-0000-0000-0000-000000000402';
select ok(pg_temp.queued('27120000-0000-0000-0000-000000000402', 'approval_request'), 'AC-EML-006 the expense hand-off queues an approval_request email');

-- 3. timesheet submitted (manager and Admin are the approvers)
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('27120000-0000-0000-0000-000000000403', '27120000-0000-0000-0000-00000000000a', '27120000-0000-0000-0000-0000000000a3', '2026-11-16', 'Draft');
update timesheets set status = 'Submitted' where id = '27120000-0000-0000-0000-000000000403';
select ok(pg_temp.queued('27120000-0000-0000-0000-000000000403', 'approval_request'), 'AC-EML-006 the timesheet hand-off queues an approval_request email');

-- 4. task reminder run (0442) as the manager
insert into tasks (id, org_id, project_id, name, status, end_date, assignee_id) values
  ('27120000-0000-0000-0000-000000000404', '27120000-0000-0000-0000-00000000000a', '27120000-0000-0000-0000-0000000000d1', 'EMP late task', 'In Progress', (now() at time zone 'UTC')::date - 3, '27120000-0000-0000-0000-0000000000a3');
set local role authenticated;
set local request.jwt.claims = '{"sub":"27120000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select send_task_reminders(array['27120000-0000-0000-0000-000000000404'::uuid]);
reset role;
set local request.jwt.claims = '{}';
select ok(pg_temp.queued('27120000-0000-0000-0000-000000000404', 'overdue_item'), 'AC-EML-006 the task reminder queues an overdue_item email');

-- 5. overdue site issue escalation (1028)
insert into incident_reports (id, org_id, incident_date, type, severity, project_id, reported_by, assignee_id, due_at) values
  ('27120000-0000-0000-0000-000000000405', '27120000-0000-0000-0000-00000000000a', '2026-11-10', 'Defect', 'Low',
   '27120000-0000-0000-0000-0000000000d1', '27120000-0000-0000-0000-0000000000a3', '27120000-0000-0000-0000-0000000000a3', now() - interval '2 hours');
select is(public.escalate_overdue_incidents('27120000-0000-0000-0000-000000000405'), 1, 'the overdue issue is escalated');
select ok(pg_temp.queued('27120000-0000-0000-0000-000000000405', 'overdue_item'), 'AC-EML-006 the overdue issue queues an overdue_item email');

-- 6. document expiry run (0971)
insert into people (id, org_id, code, name, manager_id) values
  ('27120000-0000-0000-0000-0000000000e1', '27120000-0000-0000-0000-00000000000a', 'P-1', 'EMP Person', '27120000-0000-0000-0000-0000000000a2');
insert into document_types (id, org_id, name, applies_to, is_medical) values
  ('27120000-0000-0000-0000-0000000000f1', '27120000-0000-0000-0000-00000000000a', 'Work permit', 'person', false);
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, number, expires_on) values
  ('27120000-0000-0000-0000-000000000406', '27120000-0000-0000-0000-00000000000a', 'person', '27120000-0000-0000-0000-0000000000e1', '27120000-0000-0000-0000-0000000000f1', 'WP-1', '2026-12-20');
select ok(public.run_document_expiry_warnings('2026-12-15') > 0, 'the expiry run sends notices');
select ok(pg_temp.queued('27120000-0000-0000-0000-000000000406', 'document_expiry'), 'AC-EML-006 the expiry run queues a document_expiry email');

select * from finish();
rollback;
