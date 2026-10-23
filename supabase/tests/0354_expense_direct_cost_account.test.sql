-- 0354_expense_direct_cost_account.test.sql — OD-EXP-PB-1 (owner 2026-10-07, confirmed 2026-10-23): the sweep's gate
-- reports whether the claim's project is an Internal Project, read from the org's own project row at call time, and
-- the account map admits the project direct-cost key (FR-EXP-119, NFR-EXP-016). AC-EXP-106. Migration under test: 0354.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, default_currency, default_timezone) values
  ('03540000-0000-0000-0000-00000000000a','EXP-DC Org','IDR','Asia/Jakarta'),
  ('03540000-0000-0000-0000-00000000000b','EXP-DC Org B','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('03540000-0000-0000-0000-0000000000a1','expdc-e1@example.com'),
  ('03540000-0000-0000-0000-0000000000a3','expdc-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03540000-0000-0000-0000-0000000000a1','03540000-0000-0000-0000-00000000000a','DC Eng','expdc-e1@example.com','Engineer','active'),
  ('03540000-0000-0000-0000-0000000000a3','03540000-0000-0000-0000-00000000000a','DC PM','expdc-pm@example.com','Project Manager','active');
insert into projects (id, org_id, name, status) values
  ('03540000-0000-0000-0000-000000000101','03540000-0000-0000-0000-00000000000a','DC Internal','Internal Project'),
  ('03540000-0000-0000-0000-000000000102','03540000-0000-0000-0000-00000000000a','DC Delivery','Ongoing Project'),
  ('03540000-0000-0000-0000-000000000103','03540000-0000-0000-0000-00000000000b','DC Other Org','Ongoing Project');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, title, amount, status, claim_number, approved_by_id, approved_at) values
  ('03540000-0000-0000-0000-000000000501','03540000-0000-0000-0000-00000000000a','claim','03540000-0000-0000-0000-0000000000a1','03540000-0000-0000-0000-000000000101','Internal trip',0,'Approved','EXP-2610230001','03540000-0000-0000-0000-0000000000a3','2026-10-23 02:00:00+00'),
  ('03540000-0000-0000-0000-000000000502','03540000-0000-0000-0000-00000000000a','claim','03540000-0000-0000-0000-0000000000a1','03540000-0000-0000-0000-000000000102','Site trip',0,'Approved','EXP-2610230002','03540000-0000-0000-0000-0000000000a3','2026-10-23 02:00:00+00'),
  ('03540000-0000-0000-0000-000000000503','03540000-0000-0000-0000-00000000000a','claim','03540000-0000-0000-0000-0000000000a1',null,'Office trip',0,'Approved','EXP-2610230003','03540000-0000-0000-0000-0000000000a3','2026-10-23 02:00:00+00'),
  ('03540000-0000-0000-0000-000000000504','03540000-0000-0000-0000-00000000000a','claim','03540000-0000-0000-0000-0000000000a1','03540000-0000-0000-0000-000000000103','Cross-org trip',0,'Approved','EXP-2610230004','03540000-0000-0000-0000-0000000000a3','2026-10-23 02:00:00+00');
insert into expense_posting_erp_mirror (id, org_id, claim_id, posting, posting_identity, state_stamp, actor_id) values
  ('03540000-0000-0000-0000-000000000601','03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000501','approval','03540000-0000-0000-0000-000000000501:approval','2026-10-23 02:00:00+00','03540000-0000-0000-0000-0000000000a3'),
  ('03540000-0000-0000-0000-000000000602','03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000502','approval','03540000-0000-0000-0000-000000000502:approval','2026-10-23 02:00:00+00','03540000-0000-0000-0000-0000000000a3'),
  ('03540000-0000-0000-0000-000000000603','03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000503','approval','03540000-0000-0000-0000-000000000503:approval','2026-10-23 02:00:00+00','03540000-0000-0000-0000-0000000000a3'),
  ('03540000-0000-0000-0000-000000000604','03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000504','approval','03540000-0000-0000-0000-000000000504:approval','2026-10-23 02:00:00+00','03540000-0000-0000-0000-0000000000a3');

select lives_ok($$ insert into expense_account_map (org_id, account_key, erp_account)
                   values ('03540000-0000-0000-0000-00000000000a','project_direct_cost','Project Direct Cost - EX') $$,
  'AC-EXP-106: the account map admits the project direct-cost key');
select throws_ok($$ insert into expense_account_map (org_id, account_key, erp_account)
                    values ('03540000-0000-0000-0000-00000000000a','project_direct_costs','X') $$,
  '23514', 'new row for relation "expense_account_map" violates check constraint "expense_account_map_key"',
  'AC-EXP-106: the key list stays closed (a near-miss key is refused)');

set local role service_role;
select is((expense_posting_for_push('03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000601') ->> 'project_is_internal')::boolean,
  true, 'AC-EXP-106: a claim on an Internal Project reads project_is_internal = true');
select is((expense_posting_for_push('03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000602') ->> 'project_is_internal')::boolean,
  false, 'AC-EXP-106: a claim on a delivery (Ongoing) project reads false');
select is(expense_posting_for_push('03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000603') -> 'project_is_internal',
  'false'::jsonb, 'AC-EXP-106: an untagged claim reads false, never null or absent');
select throws_ok($$ select expense_posting_for_push('03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000604') $$,
  'P0001', 'expense-posting-precondition-failed', 'AC-EXP-106: a project outside the claim''s org fails closed');
reset role;
update expense_claims set project_id = '03540000-0000-0000-0000-000000000102' where id = '03540000-0000-0000-0000-000000000501';
set local role service_role;
select is((expense_posting_for_push('03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000601') ->> 'project_is_internal')::boolean,
  false, 'AC-EXP-106: the status is read at call time — re-tagged to a delivery project, the next read is false');
reset role;
select ok(not has_function_privilege('anon', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE'),
  'AC-EXP-106: no client can execute the gate after its replacement');
select ok(has_function_privilege('service_role', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE'),
  'AC-EXP-106: the sweep (service_role) still executes the gate');

select * from finish();
rollback;
