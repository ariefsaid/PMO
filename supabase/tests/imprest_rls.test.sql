-- imprest_rls.test.sql — #1515 site imprest S1: who sees the float tables, and that no client writes them except plan
-- drafts and their lines (S1 half of AC-IMP-061; plan S1.11). F1 + F2 + one Draft plan by PM1 on float F.
begin;
create extension if not exists pgtap;
select plan(22);

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
   'funding', 'REP-2611010001', 'Paid', 10000000, '15150000-0000-0000-0000-0000000000a2', '15150000-0000-0000-0000-0000000000a3',
   '15150000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date),
  ('15150000-0000-0000-0000-0000000000e2', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d2',
   'funding', 'REP-2611010002', 'Paid', 5000000, '15150000-0000-0000-0000-0000000000a5', '15150000-0000-0000-0000-0000000000a3',
   '15150000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date);
insert into imprest_plans (id, org_id, float_id, month, author_id) values
  ('15150000-0000-0000-0000-000000000101', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   (date_trunc('month', now() at time zone 'Asia/Jakarta') + interval '1 month')::date, '15150000-0000-0000-0000-0000000000a4');
insert into imprest_plan_lines (plan_id, budget_category, planned_amount) values
  ('15150000-0000-0000-0000-000000000101', 'Vehicle', 1000000);
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from imprest_floats), 0, 'AC-IMP-061 an Engineer sees no float');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from imprest_floats), 2, 'AC-IMP-061 a Project Manager sees the org''s floats');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from imprest_floats), 0, 'AC-IMP-061 another org sees none');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select throws_ok($$ insert into imprest_floats (org_id, project_id, custodian_id, currency, created_by)
  values ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1', '15150000-0000-0000-0000-0000000000a2', 'IDR',
          '15150000-0000-0000-0000-0000000000a1') $$, '42501', null, 'AC-IMP-061 no client inserts a float');
select throws_ok($$ update imprest_floats set float_amount = 1 $$, '42501', null, 'AC-IMP-061 no client writes a float amount');
select throws_ok($$ insert into imprest_plans (float_id, month, org_id) values
  ('15150000-0000-0000-0000-0000000000d1', date_trunc('month', now())::date, '15150000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'AC-IMP-061 a client cannot write org_id on a plan');
select throws_ok($$ update imprest_plans set status = 'Approved' $$, '42501', null, 'AC-IMP-061 no client writes plan status');
select throws_ok($$ insert into imprest_replenishments (org_id, float_id, kind, number, amount, requested_by)
  values ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1', 'funding', 'X', 1,
          '15150000-0000-0000-0000-0000000000a1') $$, '42501', null, 'AC-IMP-061 no client inserts a replenishment');
-- plan and line writes: approval rank, own org, the author only
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select throws_ok($$ insert into imprest_plans (float_id, month) values
  ('15150000-0000-0000-0000-0000000000d2', date_trunc('month', now())::date) $$,
  '42501', null, 'AC-IMP-061 an Engineer cannot draft a plan');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000b1');
select throws_ok($$ insert into imprest_plans (float_id, month) values
  ('15150000-0000-0000-0000-0000000000d2', date_trunc('month', now())::date) $$,
  '42501', null, 'AC-IMP-061 another org cannot draft a plan on this float');
select is((select count(*)::int from imprest_plans), 0, 'AC-IMP-061 another org sees no plan');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a5');
select lives_ok($$ insert into imprest_plans (float_id, month) values
  ('15150000-0000-0000-0000-0000000000d2', date_trunc('month', now())::date) $$,
  'AC-IMP-061 a Project Manager drafts a plan on an org float');
select is((select count(*)::int from imprest_plan_lines), 1, 'AC-IMP-061 a Project Manager sees the org''s plan lines');
select throws_ok($$ insert into imprest_plan_lines (plan_id, budget_category, planned_amount)
  values ('15150000-0000-0000-0000-000000000101', 'Materials', 1) $$,
  '42501', null, 'AC-IMP-061 only the plan''s author writes its lines');
update imprest_plan_lines set planned_amount = 1 where plan_id = '15150000-0000-0000-0000-000000000101';
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select is((select total from imprest_plans where id = '15150000-0000-0000-0000-000000000101'), 1000000::numeric,
  'AC-IMP-061 another member''s line update matches no row');
select lives_ok($$ insert into imprest_plan_lines (plan_id, budget_category, planned_amount)
  values ('15150000-0000-0000-0000-000000000101', 'Materials', 500000) $$, 'AC-IMP-061 the author adds a line to a draft');
select throws_ok($$ update imprest_plans set total = 1 $$, '42501', null, 'AC-IMP-061 no client writes a plan total');

-- S3.4 (PQ-4): the expense form's narrow float chooser.
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select is((select array_agg(row(float_id, remaining)::text) from imprest_float_choices('15150000-0000-0000-0000-0000000000c2', 'Vehicle')),
  array[row('15150000-0000-0000-0000-0000000000d2'::uuid, 0::numeric)::text],
  'AC-IMP-061 an Engineer picks a float through the narrow chooser and still reads no float row');
select is((select count(*)::int from imprest_floats), 0, 'AC-IMP-061 the chooser leaves the float table hidden from an Engineer');
select is((select row(currency, float_amount, project_name)::text from imprest_float_choices('15150000-0000-0000-0000-0000000000c2', 'Vehicle')),
  row('IDR'::text, 5000000.00::numeric, 'IMP Site Two'::text)::text,
  '#1635 the chooser hands an Engineer the float currency, amount and project name while the float table stays hidden');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from imprest_float_choices('15150000-0000-0000-0000-0000000000c2', 'Vehicle')), 0,
  'AC-IMP-061 another org''s caller gets no float choices');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from imprest_float_choices('15150000-0000-0000-0000-0000000000c2', 'Vehicle')), 0,
  'AC-IMP-061 DD-IMP-7.2 a custodian is never offered their own float');

select * from finish();
rollback;
