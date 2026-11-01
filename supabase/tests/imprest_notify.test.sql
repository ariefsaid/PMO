-- imprest_notify.test.sql — #1515 site imprest S3: who hears about plans, exceptions, replenishments and float records
-- ready to pay. AC-IMP-062 (spec FR-IMP-064; plan S3.5, S3.6, PQ-10). F1 + F2 + a Draft plan by PM1 on F, a Draft
-- out-of-plan float claim by Eng1 on F, and a Paid float claim on F whose receipts wait to be replenished. F2's numbers
-- are renamed REP-FIXTURE-* (the server mints REP-<yymmdd>0001 first, as in imprest_replenishment).
begin;
create extension if not exists pgtap;
select plan(11);
create extension if not exists dblink;


insert into organizations (id, name, default_currency, default_timezone) values
  ('15150000-0000-0000-0000-00000000000a', 'IMP Org',       'IDR', 'Asia/Jakarta'),
  ('15150000-0000-0000-0000-00000000000b', 'IMP Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15150000-0000-0000-0000-0000000000a1', 'imp-admin@example.com'),
  ('15150000-0000-0000-0000-0000000000a2', 'imp-fin1@example.com'),   -- Finance, custodian of float F (project P1)
  ('15150000-0000-0000-0000-0000000000a3', 'imp-fin2@example.com'),   -- Finance, not a custodian
  ('15150000-0000-0000-0000-0000000000a4', 'imp-pm1@example.com'),    -- PM, manages P1
  ('15150000-0000-0000-0000-0000000000a5', 'imp-pm2@example.com'),    -- PM, manages P2; custodian of float G
  ('15150000-0000-0000-0000-0000000000a6', 'imp-eng1@example.com'),   -- Engineer, claimant
  ('15150000-0000-0000-0000-0000000000a7', 'imp-exec@example.com'),   -- Executive, senior approver
  ('15150000-0000-0000-0000-0000000000b1', 'imp-xorg@example.com');   -- other-org Admin
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15150000-0000-0000-0000-0000000000a1', '15150000-0000-0000-0000-00000000000a', 'IMP Admin', 'imp-admin@example.com', 'Admin', 'active'),
  ('15150000-0000-0000-0000-0000000000a2', '15150000-0000-0000-0000-00000000000a', 'IMP Fin1',  'imp-fin1@example.com',  'Finance', 'active'),
  ('15150000-0000-0000-0000-0000000000a3', '15150000-0000-0000-0000-00000000000a', 'IMP Fin2',  'imp-fin2@example.com',  'Finance', 'active'),
  ('15150000-0000-0000-0000-0000000000a4', '15150000-0000-0000-0000-00000000000a', 'IMP PM1',   'imp-pm1@example.com',   'Project Manager', 'active'),
  ('15150000-0000-0000-0000-0000000000a5', '15150000-0000-0000-0000-00000000000a', 'IMP PM2',   'imp-pm2@example.com',   'Project Manager', 'active'),
  ('15150000-0000-0000-0000-0000000000a6', '15150000-0000-0000-0000-00000000000a', 'IMP Eng1',  'imp-eng1@example.com',  'Engineer', 'active'),
  ('15150000-0000-0000-0000-0000000000a7', '15150000-0000-0000-0000-00000000000a', 'IMP Exec',  'imp-exec@example.com',  'Executive', 'active'),
  ('15150000-0000-0000-0000-0000000000b1', '15150000-0000-0000-0000-00000000000b', 'IMP XOrg',  'imp-xorg@example.com',  'Admin', 'active');
-- P1 managed by PM1 (float F), P2 managed by PM2 (float G), P3 managed by PM1 (no float; establishment tests)
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15150000-0000-0000-0000-0000000000c1', '15150000-0000-0000-0000-00000000000a', 'IMP Site One',   'Ongoing Project', '15150000-0000-0000-0000-0000000000a4'),
  ('15150000-0000-0000-0000-0000000000c2', '15150000-0000-0000-0000-00000000000a', 'IMP Site Two',   'Ongoing Project', '15150000-0000-0000-0000-0000000000a5'),
  ('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-00000000000a', 'IMP Site Three', 'Ongoing Project', '15150000-0000-0000-0000-0000000000a4');
-- senior approver set: the Executive only (PQ-5 route 'org')
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15150000-0000-0000-0000-00000000000a', null, '15150000-0000-0000-0000-0000000000a7');
insert into org_imprest_settings (org_id, procurement_limit, updated_by) values
  ('15150000-0000-0000-0000-00000000000a', 2000000, '15150000-0000-0000-0000-0000000000a1');
-- Float F: P1, custodian Fin1, 10,000,000. Float G: P2, custodian PM2 (the project's own PM), 5,000,000.
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15150000-0000-0000-0000-0000000000d1', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1',
   '15150000-0000-0000-0000-0000000000a2', 10000000, 'IDR', '15150000-0000-0000-0000-0000000000a1'),
  ('15150000-0000-0000-0000-0000000000d2', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c2',
   '15150000-0000-0000-0000-0000000000a5', 5000000, 'IDR', '15150000-0000-0000-0000-0000000000a1');

-- helper: act as a member (jwt claims are transaction-local)
create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by, approved_by, paid_by,
                                    requested_at, approved_at, paid_at, paid_on) values
  ('15150000-0000-0000-0000-0000000000e1', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   'funding', 'REP-FIXTURE-F', 'Paid', 10000000, '15150000-0000-0000-0000-0000000000a2', '15150000-0000-0000-0000-0000000000a3',
   '15150000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date),
  ('15150000-0000-0000-0000-0000000000e2', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d2',
   'funding', 'REP-FIXTURE-G', 'Paid', 5000000, '15150000-0000-0000-0000-0000000000a5', '15150000-0000-0000-0000-0000000000a3',
   '15150000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date);

insert into imprest_plans (id, org_id, float_id, month, author_id) values
  ('15150000-0000-0000-0000-000000000601', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   (date_trunc('month', now() at time zone 'Asia/Jakarta') + interval '1 month')::date, '15150000-0000-0000-0000-0000000000a4');
insert into imprest_plan_lines (org_id, plan_id, budget_category, planned_amount) values
  ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-000000000601', 'Vehicle', 1000000);
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, imprest_float_id) values
  ('15150000-0000-0000-0000-000000000602', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'Out of plan fuel', 0, 'Draft', '15150000-0000-0000-0000-0000000000d1');
insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount) values
  ('15150000-0000-0000-0000-000000000602', current_date, 'Local transport', 'Diesel', 100000);
insert into expense_claim_files (claim_id, org_id, file_path) values
  ('15150000-0000-0000-0000-000000000602', '15150000-0000-0000-0000-00000000000a',
   '15150000-0000-0000-0000-00000000000a/15150000-0000-0000-0000-000000000602/' || gen_random_uuid() || '/r.pdf');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, paid_by_id, paid_at, paid_on, imprest_float_id, imprest_month) values
  ('15150000-0000-0000-0000-000000000603', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'paid on F', 200000, 'Paid', 'EXP-2611010603', now(),
   '15150000-0000-0000-0000-0000000000a7', now(), '15150000-0000-0000-0000-0000000000a2', now(), current_date,
   '15150000-0000-0000-0000-0000000000d1', date_trunc('month', now() at time zone 'Asia/Jakarta')::date);

set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select transition_imprest_plan('15150000-0000-0000-0000-000000000601', 'Submitted');
reset role;
select is((select array_agg(owner_id order by owner_id) from notifications where metadata->'entity'->>'type' = 'imprest_plan'),
  array['15150000-0000-0000-0000-0000000000a7']::uuid[],
  'AC-IMP-062 a submitted plan notifies its routed approvers only, never the author or custodian');
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a7');
select transition_imprest_plan('15150000-0000-0000-0000-000000000601', 'Approved');
reset role;
select ok(exists (select 1 from notifications where owner_id = '15150000-0000-0000-0000-0000000000a4'
                    and title = 'Your site cash plan was approved'), 'AC-IMP-062 the plan''s author hears of the decision');
set local role authenticated;

select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select transition_expense_claim('15150000-0000-0000-0000-000000000602', 'Submitted');
reset role;
select ok(exists (select 1 from notifications where owner_id = '15150000-0000-0000-0000-0000000000a7'
                    and title = 'Out-of-plan site cash item awaiting your approval'), 'AC-IMP-062 an exception notifies the senior set');
set local role authenticated;

select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');  -- Fin1 = F's custodian
select throws_ok($$ select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d1', 'funding') $$,
  'P0001', null, 'AC-IMP-062 (setup) F is fully funded, so a funding request is refused');
select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d1', 'replenishment');
reset role;
select is((select array_agg(owner_id order by owner_id) from notifications where metadata->'entity'->>'id' =
            (select id::text from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Requested')),
  array['15150000-0000-0000-0000-0000000000a3']::uuid[],
  'AC-IMP-062 a replenishment request notifies Finance other than the custodian and requester');
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');  -- Fin2 approves
select transition_imprest_replenishment((select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1'
                                           and status = 'Requested'), 'Approved');
reset role;
select ok(exists (select 1 from notifications where owner_id = '15150000-0000-0000-0000-0000000000a2'
                    and title = 'Site cash replenishment approved'), 'AC-IMP-062 the custodian hears of approval');
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');  -- Admin pays
select transition_imprest_replenishment((select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1'
                                           and status = 'Approved'), 'Paid');
reset role;
select ok(exists (select 1 from notifications where owner_id = '15150000-0000-0000-0000-0000000000a2'
                    and title = 'Site cash replenishment paid'), 'AC-IMP-062 the custodian hears of payment');
set local role authenticated;

select pg_temp.act_as('15150000-0000-0000-0000-0000000000a7');  -- Exec approves the exception item
select transition_expense_claim('15150000-0000-0000-0000-000000000602', 'Approved');
reset role;
select is((select array_agg(owner_id order by owner_id) from notifications
            where title = 'Expense claim ready to pay' and metadata->'entity'->>'id' = '15150000-0000-0000-0000-000000000602'),
  array['15150000-0000-0000-0000-0000000000a2']::uuid[], 'AC-IMP-062 a float record ready to pay notifies only its custodian');
set local role authenticated;
reset role;
select is((select count(*)::int from notifications where owner_id = '15150000-0000-0000-0000-0000000000a3'
            and metadata->'entity'->>'id' = '15150000-0000-0000-0000-000000000602'), 0,
  'AC-IMP-062 Finance who is not the custodian hears nothing of a float record');
set local role authenticated;
reset role;

-- The trigger's own exclusions, bound directly: through the RPC the requester is always the custodian and the acting user
-- (whom notify_workflow_user already skips), so seed requests as superuser (no acting user) to prove each exclusion.
insert into imprest_replenishments (id, org_id, float_id, kind, number, amount, requested_by) values
  ('15150000-0000-0000-0000-0000000006a1', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   'replenishment', 'REP-FIXTURE-N1', 1, '15150000-0000-0000-0000-0000000000a4'),
  ('15150000-0000-0000-0000-0000000006a2', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d2',
   'replenishment', 'REP-FIXTURE-N2', 1, '15150000-0000-0000-0000-0000000000a3');
select is((select array_agg(owner_id) from notifications where metadata->'entity'->>'id' = '15150000-0000-0000-0000-0000000006a1'),
  array['15150000-0000-0000-0000-0000000000a3']::uuid[], 'AC-IMP-062 a request never notifies the float''s custodian');
select is((select array_agg(owner_id) from notifications where metadata->'entity'->>'id' = '15150000-0000-0000-0000-0000000006a2'),
  array['15150000-0000-0000-0000-0000000000a2']::uuid[], 'AC-IMP-062 a request never notifies its requester');

select * from finish();
rollback;
