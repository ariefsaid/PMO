-- expense_claims_routing.test.sql — #775 claims are decided by spend_approval_route (#803) and count on the
-- budget line; advances do not (DD-EXP-2); Special expenses is just a category (DD-EXP-8). AC-EXP-020..025.
-- Budget version is activated by plain UPDATE as postgres: activated_at stays NULL and no audit row names a
-- decider, so DD-APR-3 never fires here.
begin;
select plan(9);

insert into organizations (id, name, default_currency) values
  ('02473000-0000-0000-0000-00000000000a','EXP Route Org A','IDR'),
  ('02473000-0000-0000-0000-00000000000b','EXP Route Org B','IDR');
insert into auth.users (id, email) values
  ('02473000-0000-0000-0000-0000000000a1','exp-r-e1@example.com'),
  ('02473000-0000-0000-0000-0000000000a2','exp-r-pma@example.com'),
  ('02473000-0000-0000-0000-0000000000a3','exp-r-pmb@example.com'),
  ('02473000-0000-0000-0000-0000000000a4','exp-r-ad@example.com'),
  ('02473000-0000-0000-0000-0000000000a5','exp-r-f1@example.com'),
  ('02473000-0000-0000-0000-0000000000b1','exp-r-ba@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02473000-0000-0000-0000-0000000000a1','02473000-0000-0000-0000-00000000000a','R Eng','exp-r-e1@example.com','Engineer','active'),
  ('02473000-0000-0000-0000-0000000000a2','02473000-0000-0000-0000-00000000000a','R PM A','exp-r-pma@example.com','Project Manager','active'),
  ('02473000-0000-0000-0000-0000000000a3','02473000-0000-0000-0000-00000000000a','R PM B','exp-r-pmb@example.com','Project Manager','active'),
  ('02473000-0000-0000-0000-0000000000a4','02473000-0000-0000-0000-00000000000a','R Admin','exp-r-ad@example.com','Admin','active'),
  ('02473000-0000-0000-0000-0000000000a5','02473000-0000-0000-0000-00000000000a','R Fin','exp-r-f1@example.com','Finance','active'),
  ('02473000-0000-0000-0000-0000000000b1','02473000-0000-0000-0000-00000000000b','R B Admin','exp-r-ba@example.com','Admin','active');
insert into projects (id, org_id, name, status) values
  ('02473000-0000-0000-0000-000000000101','02473000-0000-0000-0000-00000000000a','R Project','Ongoing Project');
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('02473000-0000-0000-0000-000000000201','02473000-0000-0000-0000-00000000000a','02473000-0000-0000-0000-000000000101','v1',1,'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('02473000-0000-0000-0000-00000000000a','02473000-0000-0000-0000-000000000201','Overheads',1000),
  ('02473000-0000-0000-0000-00000000000a','02473000-0000-0000-0000-000000000201','Special expenses',500);
update budget_versions set status = 'Active' where id = '02473000-0000-0000-0000-000000000201';
insert into spend_approvers (org_id, project_id, profile_id) values
  ('02473000-0000-0000-0000-00000000000a','02473000-0000-0000-0000-000000000101','02473000-0000-0000-0000-0000000000a2'),
  ('02473000-0000-0000-0000-00000000000a',null,'02473000-0000-0000-0000-0000000000a5');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number, submitted_at, paid_on) values
  ('02473000-0000-0000-0000-000000000401','02473000-0000-0000-0000-00000000000a','claim','02473000-0000-0000-0000-0000000000a1','02473000-0000-0000-0000-000000000101','Overheads','R1 within',400,'Submitted','EXP-2610020001',now() + interval '1 hour',null),
  ('02473000-0000-0000-0000-000000000402','02473000-0000-0000-0000-00000000000a','claim','02473000-0000-0000-0000-0000000000a1','02473000-0000-0000-0000-000000000101','Special expenses','R3 special',300,'Submitted','EXP-2610020002',now() + interval '1 hour',null),
  ('02473000-0000-0000-0000-000000000403','02473000-0000-0000-0000-00000000000a','claim','02473000-0000-0000-0000-0000000000a1','02473000-0000-0000-0000-000000000101','Overheads','R4 admin',100,'Submitted','EXP-2610020003',now() + interval '1 hour',null),
  ('02473000-0000-0000-0000-000000000404','02473000-0000-0000-0000-00000000000a','advance','02473000-0000-0000-0000-0000000000a1','02473000-0000-0000-0000-000000000101','Overheads','Paid advance',900,'Paid','ADV-2610020004',now(),current_date);
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category) values
  ('02473000-0000-0000-0000-000000000501','02473000-0000-0000-0000-00000000000a','PR on the line','02473000-0000-0000-0000-000000000101','02473000-0000-0000-0000-0000000000a1','Requested',700,'Overheads');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02473000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02473000-0000-0000-0000-000000000401','Approved') $$,
  '42501', 'approval routing: within_budget requires a named approver',
  'AC-EXP-020: a Project Manager who is not the named approver cannot approve');

set local request.jwt.claims = '{"sub":"02473000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02473000-0000-0000-0000-000000000401','Approved') $$,
  'AC-EXP-020: the named project approver approves');
select is((select route || '/' || reason || '/' || line_used::text
             from get_procurement_approval_routes(array['02473000-0000-0000-0000-000000000501']::uuid[])),
  'org/exceeds_line/400.00',
  'AC-EXP-021: the approved 400 claim is spend on the line, so a 700 request now exceeds 1000');
select is((select route || '/' || reason || '/' || line_used::text
             from get_expense_claim_approval_routes(array['02473000-0000-0000-0000-000000000403']::uuid[])),
  'project/within_budget/400.00',
  'AC-EXP-022: the paid 900 advance is not on the line; only the approved claim is');
select is((select route || '/' || reason || '|' || (approvers->0->>'id')
             from get_expense_claim_approval_routes(array['02473000-0000-0000-0000-000000000402']::uuid[])),
  'project/within_budget|02473000-0000-0000-0000-0000000000a2',
  'AC-EXP-023: a Special expenses claim routes like any other category');
select is((select count(*)::int from get_expense_claim_approval_routes(
             array['02473000-0000-0000-0000-000000000401','02473000-0000-0000-0000-000000000402']::uuid[])), 1,
  'AC-EXP-025: only Submitted ids return a route');

set local request.jwt.claims = '{"sub":"02473000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02473000-0000-0000-0000-000000000403','Approved') $$,
  'AC-EXP-024: an Admin who is not named approves (break-glass)');

set local request.jwt.claims = '{"sub":"02473000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from get_expense_claim_approval_routes(array['02473000-0000-0000-0000-000000000402']::uuid[])), 0,
  'AC-EXP-025: another org''s caller gets no route');
reset role;

select is((select (detail->>'break_glass')::boolean from audit_events
            where action = 'expense_claim.approval_route' and entity_id = '02473000-0000-0000-0000-000000000403'), true,
  'AC-EXP-024: the break-glass approval is marked in the audit trail');

select * from finish();
rollback;
