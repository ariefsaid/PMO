-- expense_claims_notify.test.sql — #775 hand-offs (the #788 pattern): submit → the route's approvers; approve →
-- claimant + Finance; reject/pay → claimant. Never the claimant on submit. AC-EXP-040..041.
begin;
select plan(16);

insert into organizations (id, name, default_currency) values ('02476000-0000-0000-0000-00000000000a','EXP Notify Org','IDR');
insert into auth.users (id, email) values
  ('02476000-0000-0000-0000-0000000000a1','exp-n-e1@example.com'),
  ('02476000-0000-0000-0000-0000000000a2','exp-n-pma@example.com'),
  ('02476000-0000-0000-0000-0000000000a3','exp-n-pmb@example.com'),
  ('02476000-0000-0000-0000-0000000000a4','exp-n-f1@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02476000-0000-0000-0000-0000000000a1','02476000-0000-0000-0000-00000000000a','N Eng','exp-n-e1@example.com','Engineer','active'),
  ('02476000-0000-0000-0000-0000000000a2','02476000-0000-0000-0000-00000000000a','N PM A','exp-n-pma@example.com','Project Manager','active'),
  ('02476000-0000-0000-0000-0000000000a3','02476000-0000-0000-0000-00000000000a','N PM B','exp-n-pmb@example.com','Project Manager','active'),
  ('02476000-0000-0000-0000-0000000000a4','02476000-0000-0000-0000-00000000000a','N Fin','exp-n-f1@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('02476000-0000-0000-0000-000000000101','02476000-0000-0000-0000-00000000000a','N Project','Ongoing Project');
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('02476000-0000-0000-0000-000000000201','02476000-0000-0000-0000-00000000000a','02476000-0000-0000-0000-000000000101','v1',1,'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('02476000-0000-0000-0000-00000000000a','02476000-0000-0000-0000-000000000201','Materials',1000);
update budget_versions set status = 'Active' where id = '02476000-0000-0000-0000-000000000201';
insert into spend_approvers (org_id, project_id, profile_id) values
  ('02476000-0000-0000-0000-00000000000a','02476000-0000-0000-0000-000000000101','02476000-0000-0000-0000-0000000000a2');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status) values
  ('02476000-0000-0000-0000-000000000401','02476000-0000-0000-0000-00000000000a','claim','02476000-0000-0000-0000-0000000000a1','02476000-0000-0000-0000-000000000101','Materials','Notify claim',0,'Draft'),
  ('02476000-0000-0000-0000-000000000402','02476000-0000-0000-0000-00000000000a','advance','02476000-0000-0000-0000-0000000000a1',null,null,'Notify advance',300,'Draft'),
  ('02476000-0000-0000-0000-000000000403','02476000-0000-0000-0000-00000000000a','claim','02476000-0000-0000-0000-0000000000a1','02476000-0000-0000-0000-000000000101','Materials','Notify reject',0,'Draft');
insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount) values
  ('02476000-0000-0000-0000-000000000401','2026-10-01','Travel','Train',200),
  ('02476000-0000-0000-0000-000000000403','2026-10-01','Meals','Lunch',50);

-- The claimant here is itself in the approval-rank set (a Project Manager). Submitted with no acting user
-- (table owner, auth.uid() null) so notify_workflow_user's own drop-the-actor guard cannot hide the claimant:
-- only the trigger's claimant exclusion keeps them out. Other members of the set still hear it.
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status) values
  ('02476000-0000-0000-0000-000000000404','02476000-0000-0000-0000-00000000000a','advance','02476000-0000-0000-0000-0000000000a2','Notify PM advance',250,'Draft');
update expense_claims set status = 'Submitted', submitted_at = now(), claim_number = 'ADV-2610060404'
 where id = '02476000-0000-0000-0000-000000000404';
select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a2'
            and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000404'), 0,
  'AC-EXP-040: a claimant who is in the approval set is still not told to approve their own advance');
select is((select count(*)::int from notifications where owner_id in ('02476000-0000-0000-0000-0000000000a3','02476000-0000-0000-0000-0000000000a4')
            and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000404'), 2,
  'AC-EXP-040: the rest of the approval set is');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02476000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02476000-0000-0000-0000-000000000401','Submitted') $$, 'AC-EXP-040: submit the claim');
select lives_ok($$ select transition_expense_claim('02476000-0000-0000-0000-000000000402','Submitted') $$, 'AC-EXP-040: submit the advance');
select lives_ok($$ select transition_expense_claim('02476000-0000-0000-0000-000000000403','Submitted') $$, 'AC-EXP-041: submit the claim to reject');
reset role;

select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a2'
            and title = 'Expense claim awaiting your approval' and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000401'), 1,
  'AC-EXP-040: the named project approver is told');
select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a3'
            and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000401'), 0,
  'AC-EXP-040: a Project Manager who is not named is not');
select is((select count(*)::int from notifications where title = 'Cash advance awaiting your approval'
            and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000402'
            and owner_id in ('02476000-0000-0000-0000-0000000000a2','02476000-0000-0000-0000-0000000000a3','02476000-0000-0000-0000-0000000000a4')), 3,
  'AC-EXP-040: an unrouted advance goes to every approval-rank member');
select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a1'
            and metadata->'entity'->>'id' in ('02476000-0000-0000-0000-000000000401','02476000-0000-0000-0000-000000000402')), 0,
  'AC-EXP-040: never the claimant');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02476000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02476000-0000-0000-0000-000000000401','Approved') $$, 'AC-EXP-041: approve');
select lives_ok($$ select transition_expense_claim('02476000-0000-0000-0000-000000000403','Rejected', 'No receipt') $$, 'AC-EXP-041: reject');
set local request.jwt.claims = '{"sub":"02476000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02476000-0000-0000-0000-000000000401','Paid') $$, 'AC-EXP-041: pay');
reset role;

select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a1'
            and title = 'Your expense claim was approved' and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000401'), 1,
  'AC-EXP-041: the claimant hears it was approved');
select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a4'
            and title = 'Expense claim ready to pay' and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000401'), 1,
  'AC-EXP-041: Finance hears it is ready to pay');
select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a1'
            and title = 'Your expense claim was rejected' and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000403'), 1,
  'AC-EXP-041: the claimant hears it was rejected');
select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a1'
            and title = 'Your expense claim was paid' and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000401'), 1,
  'AC-EXP-041: the claimant hears it was paid');

select * from finish();
rollback;
