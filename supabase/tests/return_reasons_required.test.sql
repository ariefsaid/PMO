-- AC-RSN-001: rejection reasons required.
begin;
create extension if not exists pgtap;
select plan(32);

insert into organizations (id, name) values
  ('17110000-0000-0000-0000-000000000001','Timesheet Map Org (1710)'), ('17110000-0000-0000-0000-000000000002','Other Org');

insert into auth.users (id, email) values
  ('17110000-0000-0000-0000-0000000000a1','owner-map1710@example.com'),
  ('17110000-0000-0000-0000-0000000000a2','admin-map1710@example.com'),
  ('17110000-0000-0000-0000-0000000000a3','other-map1710@example.com'), ('17110000-0000-0000-0000-0000000000b1','foreign-map1710@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('17110000-0000-0000-0000-0000000000a1','17110000-0000-0000-0000-000000000001','Owner 1710','owner-map1710@example.com','Engineer'),
  ('17110000-0000-0000-0000-0000000000a2','17110000-0000-0000-0000-000000000001','Admin 1710','admin-map1710@example.com','Admin'),
  ('17110000-0000-0000-0000-0000000000a3','17110000-0000-0000-0000-000000000001','Other 1710','other-map1710@example.com','Engineer'), ('17110000-0000-0000-0000-0000000000b1','17110000-0000-0000-0000-000000000002','Foreign','foreign-map1710@example.com','Engineer');

-- The owner has NO manager_id, so the Admin/Exec fallback authorizes the approve/reject/reopen
-- arms (0023/0025 own that matrix — here it is only the map's gatekeeper).
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('17110000-0000-0000-0000-000000000010','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-06-01','Draft'),
  ('17110000-0000-0000-0000-000000000011','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-06-08','Submitted'),
  ('17110000-0000-0000-0000-000000000012','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-06-15','Submitted'),
  ('17110000-0000-0000-0000-000000000013','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-06-22','Rejected'),
  ('17110000-0000-0000-0000-000000000014','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-06-29','Approved'),
  ('17110000-0000-0000-0000-000000000015','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-07-06','Draft'),
  ('17110000-0000-0000-0000-000000000016','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-07-13','Submitted'),
  ('17110000-0000-0000-0000-000000000017','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-07-20','Approved');

set local role authenticated;
set local request.jwt.claims = '{"sub":"17110000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected',null) $$, '22023', 'A rejection reason is required', 'AC-RSN-001 null refused');
select throws_ok($$ select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected','') $$, '22023', 'A rejection reason is required', 'AC-RSN-001 empty refused');
select throws_ok($$ select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected','   ') $$, '22023', 'A rejection reason is required', 'AC-RSN-001 spaces refused');
select throws_ok($$ select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected', E'\t\n') $$, '22023', 'A rejection reason is required', 'AC-RSN-001 whitespace refused');
select throws_ok($$ select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected',repeat('x',1001)) $$, '22023', 'A rejection reason is required', 'AC-RSN-001 over limit refused');
select ok((select status = 'Submitted' and rejection_reason is null and rejected_by is null and rejected_at is null from timesheets where id='17110000-0000-0000-0000-000000000012'), 'AC-RSN-001 refusal is atomic');
select lives_ok($$ select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected',repeat('x',1000)) $$, 'AC-RSN-001 maximum accepted');
select ok((select rejection_reason=repeat('x',1000) and rejected_by='17110000-0000-0000-0000-0000000000a2'::uuid and rejected_at is not null from timesheets where id='17110000-0000-0000-0000-000000000012'), 'AC-RSN-001 timesheet reason actor and time recorded');


reset role;
insert into organizations (id, name, default_currency, default_timezone) values
  ('02472000-0000-0000-0000-00000000000a','EXP Txn Org','IDR','Asia/Jakarta');
insert into organizations (id, name, default_currency, default_timezone) values
  ('02472000-0000-0000-0000-00000000000b','EXP Txn Org B','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02472000-0000-0000-0000-0000000000a1','exp-t-e1@example.com'),
  ('02472000-0000-0000-0000-0000000000a2','exp-t-e2@example.com'),
  ('02472000-0000-0000-0000-0000000000a3','exp-t-pm@example.com'),
  ('02472000-0000-0000-0000-0000000000a4','exp-t-f1@example.com'),
  ('02472000-0000-0000-0000-0000000000a5','exp-t-f2@example.com'),
  ('02472000-0000-0000-0000-0000000000a6','exp-t-ad@example.com'),
  ('02472000-0000-0000-0000-0000000000b1','exp-t-bad@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02472000-0000-0000-0000-0000000000a1','02472000-0000-0000-0000-00000000000a','T Eng One','exp-t-e1@example.com','Engineer','active'),
  ('02472000-0000-0000-0000-0000000000a2','02472000-0000-0000-0000-00000000000a','T Eng Two','exp-t-e2@example.com','Engineer','active'),
  ('02472000-0000-0000-0000-0000000000a3','02472000-0000-0000-0000-00000000000a','T PM','exp-t-pm@example.com','Project Manager','active'),
  ('02472000-0000-0000-0000-0000000000a4','02472000-0000-0000-0000-00000000000a','T Fin One','exp-t-f1@example.com','Finance','active'),
  ('02472000-0000-0000-0000-0000000000a5','02472000-0000-0000-0000-00000000000a','T Fin Two','exp-t-f2@example.com','Finance','active'),
  ('02472000-0000-0000-0000-0000000000a6','02472000-0000-0000-0000-00000000000a','T Admin','exp-t-ad@example.com','Admin','active'),
  ('02472000-0000-0000-0000-0000000000b1','02472000-0000-0000-0000-00000000000b','T Admin B','exp-t-bad@example.com','Admin','active');
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id) values
  ('02472000-0000-0000-0000-000000000701','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T1 draft claim',0,'Draft',null,null),
  ('02472000-0000-0000-0000-000000000702','02472000-0000-0000-0000-00000000000a','advance','02472000-0000-0000-0000-0000000000a1','T2 draft advance',500,'Draft',null,null),
  ('02472000-0000-0000-0000-000000000703','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T3 empty claim',0,'Draft',null,null),
  ('02472000-0000-0000-0000-000000000704','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a6','T4 admin own',100,'Submitted','EXP-2610010004',null),
  ('02472000-0000-0000-0000-000000000705','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T5 submitted',200,'Submitted','EXP-2610010005',null),
  ('02472000-0000-0000-0000-000000000706','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T6 approved by F1',150,'Approved','EXP-2610010006','02472000-0000-0000-0000-0000000000a4'),
  ('02472000-0000-0000-0000-000000000707','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a5','T7 F2 own',80,'Approved','EXP-2610010007','02472000-0000-0000-0000-0000000000a6'),
  ('02472000-0000-0000-0000-000000000708','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T8 rejected',0,'Rejected','EXP-2610010008',null),
  ('02472000-0000-0000-0000-000000000709','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T9 submitted',60,'Submitted','EXP-2610010009',null),
  ('02472000-0000-0000-0000-000000000710','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T10 approved by PM',70,'Approved','EXP-2610010010','02472000-0000-0000-0000-0000000000a3'),
  ('02472000-0000-0000-0000-000000000711','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T11 submitted',50,'Submitted','EXP-2610010011',null),
  ('02472000-0000-0000-0000-000000000712','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T12 org A submitted',40,'Submitted','EXP-2610010012',null),
  ('02472000-0000-0000-0000-000000000713','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T13 org A approved',40,'Approved','EXP-2610010013','02472000-0000-0000-0000-0000000000a3'),
  ('02472000-0000-0000-0000-000000000714','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T14 org A approved',40,'Approved','EXP-2610010014','02472000-0000-0000-0000-0000000000a3'),
  ('02472000-0000-0000-0000-000000000715','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a6','T15 Admin own approved',40,'Approved','EXP-2610010015','02472000-0000-0000-0000-0000000000a3'),
  ('02472000-0000-0000-0000-000000000716','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T16 approved by Admin',40,'Approved','EXP-2610010016','02472000-0000-0000-0000-0000000000a6');
insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount) values
  ('02472000-0000-0000-0000-000000000701','2026-10-01','Travel','Bus',120),
  ('02472000-0000-0000-0000-000000000708','2026-10-01','Meals','Dinner',90);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000705','Rejected',null) $$, '22023', 'A rejection reason is required', 'AC-RSN-001 expense null refused');
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000705','Rejected','') $$, '22023', 'A rejection reason is required', 'AC-RSN-001 expense empty refused');
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000705','Rejected','   ') $$, '22023', 'A rejection reason is required', 'AC-RSN-001 expense spaces refused');
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000705','Rejected',E'\t\n') $$, '22023', 'A rejection reason is required', 'AC-RSN-001 expense whitespace refused');
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000705','Rejected',repeat('x',1001)) $$, '22023', 'A rejection reason is required', 'AC-RSN-001 expense over limit refused');
select ok((select status::text in ('Submitted','Requested') and rejection_notes is null and rejected_by is null and rejected_at is null from expense_claims where id='02472000-0000-0000-0000-000000000705'), 'AC-RSN-001 expense refusal atomic');
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000705','Rejected',repeat('x',1000)) $$, 'AC-RSN-001 expense limit accepted');
select ok((select rejection_notes=repeat('x',1000) and rejected_by='02472000-0000-0000-0000-0000000000a3'::uuid and rejected_at is not null from expense_claims where id='02472000-0000-0000-0000-000000000705'), 'AC-RSN-001 expense reason actor and time recorded');

reset role;
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
create or replace function pg_temp.paid_claim(p_id uuid, p_amount numeric) returns void language sql as $$
  insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                              submitted_at, approved_by_id, approved_at, paid_by_id, paid_at, paid_on, imprest_float_id, imprest_month)
  values (p_id, '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
          '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'receipts', p_amount, 'Paid', 'EXP-26110104' || right(p_id::text, 2),
          now(), '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000a2', now(), current_date,
          '15150000-0000-0000-0000-0000000000d1', date_trunc('month', now() at time zone 'Asia/Jakarta')::date)
$$;
select pg_temp.paid_claim('15150000-0000-0000-0000-000000000401', 400000);
select pg_temp.paid_claim('15150000-0000-0000-0000-000000000402', 250000);
select pg_temp.paid_claim('15150000-0000-0000-0000-000000000403', 150000);
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, imprest_float_id, imprest_month) values
  ('15150000-0000-0000-0000-000000000404', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'approved, unpaid', 90000, 'Approved', 'EXP-2611010404', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000d1',
   date_trunc('month', now() at time zone 'Asia/Jakarta')::date);
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15150000-0000-0000-0000-0000000000d3', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c3',
   '15150000-0000-0000-0000-0000000000a3', 10000000, 'IDR', '15150000-0000-0000-0000-0000000000a1');

set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');
select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d3', 'funding');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select throws_ok($$ select transition_imprest_replenishment((select id from imprest_replenishments where float_id='15150000-0000-0000-0000-0000000000d3'),'Rejected',null) $$, '22023', 'A rejection reason is required', 'AC-RSN-001 imprest null refused');
select throws_ok($$ select transition_imprest_replenishment((select id from imprest_replenishments where float_id='15150000-0000-0000-0000-0000000000d3'),'Rejected','') $$, '22023', 'A rejection reason is required', 'AC-RSN-001 imprest empty refused');
select throws_ok($$ select transition_imprest_replenishment((select id from imprest_replenishments where float_id='15150000-0000-0000-0000-0000000000d3'),'Rejected','   ') $$, '22023', 'A rejection reason is required', 'AC-RSN-001 imprest spaces refused');
select throws_ok($$ select transition_imprest_replenishment((select id from imprest_replenishments where float_id='15150000-0000-0000-0000-0000000000d3'),'Rejected',E'\t\n') $$, '22023', 'A rejection reason is required', 'AC-RSN-001 imprest whitespace refused');
select throws_ok($$ select transition_imprest_replenishment((select id from imprest_replenishments where float_id='15150000-0000-0000-0000-0000000000d3'),'Rejected',repeat('x',1001)) $$, '22023', 'A rejection reason is required', 'AC-RSN-001 imprest over limit refused');
select ok((select status::text in ('Submitted','Requested') and decided_notes is null and rejected_by is null and rejected_at is null from imprest_replenishments where float_id='15150000-0000-0000-0000-0000000000d3'), 'AC-RSN-001 imprest refusal atomic');
select lives_ok($$ select transition_imprest_replenishment((select id from imprest_replenishments where float_id='15150000-0000-0000-0000-0000000000d3'),'Rejected',repeat('x',1000)) $$, 'AC-RSN-001 imprest limit accepted');
select ok((select decided_notes=repeat('x',1000) and rejected_by='15150000-0000-0000-0000-0000000000a1'::uuid and rejected_at is not null from imprest_replenishments where float_id='15150000-0000-0000-0000-0000000000d3'), 'AC-RSN-001 imprest reason actor and time recorded');

reset role;
insert into organizations (id, name, default_currency, default_timezone) values
  ('15190000-0000-0000-0000-00000000000a', 'EQU Org',   'IDR', 'Asia/Jakarta'),
  ('15190000-0000-0000-0000-00000000000b', 'EQU Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15190000-0000-0000-0000-0000000000a1', 'equ-admin@example.com'),
  ('15190000-0000-0000-0000-0000000000a2', 'equ-fin@example.com'),
  ('15190000-0000-0000-0000-0000000000a3', 'equ-pm1@example.com'),   -- manages P1 and P3
  ('15190000-0000-0000-0000-0000000000a4', 'equ-pm2@example.com'),   -- manages P2
  ('15190000-0000-0000-0000-0000000000a5', 'equ-exec@example.com'),
  ('15190000-0000-0000-0000-0000000000a6', 'equ-eng1@example.com'),
  ('15190000-0000-0000-0000-0000000000a7', 'equ-eng2@example.com'),
  ('15190000-0000-0000-0000-0000000000b1', 'equ-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15190000-0000-0000-0000-0000000000a1', '15190000-0000-0000-0000-00000000000a', 'EQU Admin', 'equ-admin@example.com', 'Admin', 'active'),
  ('15190000-0000-0000-0000-0000000000a2', '15190000-0000-0000-0000-00000000000a', 'EQU Fin',   'equ-fin@example.com',   'Finance', 'active'),
  ('15190000-0000-0000-0000-0000000000a3', '15190000-0000-0000-0000-00000000000a', 'EQU PM1',   'equ-pm1@example.com',   'Project Manager', 'active'),
  ('15190000-0000-0000-0000-0000000000a4', '15190000-0000-0000-0000-00000000000a', 'EQU PM2',   'equ-pm2@example.com',   'Project Manager', 'active'),
  ('15190000-0000-0000-0000-0000000000a5', '15190000-0000-0000-0000-00000000000a', 'EQU Exec',  'equ-exec@example.com',  'Executive', 'active'),
  ('15190000-0000-0000-0000-0000000000a6', '15190000-0000-0000-0000-00000000000a', 'EQU Eng1',  'equ-eng1@example.com',  'Engineer', 'active'),
  ('15190000-0000-0000-0000-0000000000a7', '15190000-0000-0000-0000-00000000000a', 'EQU Eng2',  'equ-eng2@example.com',  'Engineer', 'active'),
  ('15190000-0000-0000-0000-0000000000b1', '15190000-0000-0000-0000-00000000000b', 'EQU XOrg',  'equ-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15190000-0000-0000-0000-0000000000c1', '15190000-0000-0000-0000-00000000000a', 'EQU P1', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a3'),
  ('15190000-0000-0000-0000-0000000000c2', '15190000-0000-0000-0000-00000000000a', 'EQU P2', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a4'),
  ('15190000-0000-0000-0000-0000000000c3', '15190000-0000-0000-0000-00000000000a', 'EQU P3', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a3'),
  ('15190000-0000-0000-0000-0000000000cb', '15190000-0000-0000-0000-00000000000b', 'EQU PX', 'Ongoing Project', null);
-- A1 loader (hours), A2 truck (days), A3/A4 hire-rate machines (hours), A9 foreign (ids are hex: d1..d4, d9)
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('15190000-0000-0000-0000-0000000000d1', '15190000-0000-0000-0000-00000000000a', 'LDR-1', 'Loader 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d2', '15190000-0000-0000-0000-00000000000a', 'TRK-1', 'Truck 1',  'days'),
  ('15190000-0000-0000-0000-0000000000d3', '15190000-0000-0000-0000-00000000000a', 'GEN-1', 'Generator 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d4', '15190000-0000-0000-0000-00000000000a', 'EXC-1', 'Excavator 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d9', '15190000-0000-0000-0000-00000000000b', 'LDR-X', 'Foreign loader', 'hours');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- approved usage straight into the table (superuser; allocation tests only — S1 tests drive the RPCs)
create or replace function pg_temp.usage(p_asset text, p_project text, p_date date, p_qty numeric, p_unit text,
                                         p_kind text default 'work', p_status text default 'Approved',
                                         p_fuel numeric default null, p_trips int default null) returns void language sql as $$
  insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, fuel_litres, trips,
                                       status, author_id, approver_id, approved_at)
  values ('15190000-0000-0000-0000-00000000000a', p_asset::uuid, p_project::uuid, p_date, p_qty, p_unit, p_kind, p_fuel, p_trips,
          p_status, '15190000-0000-0000-0000-0000000000a6',
          case when p_status in ('Approved','Rejected') then '15190000-0000-0000-0000-0000000000a3'::uuid end,
          case when p_status = 'Approved' then now() end);
$$;

-- extension of F1 for this file: a disabled Finance member (the active-member gate)
insert into auth.users (id, email) values ('15190000-0000-0000-0000-0000000000a8', 'equ-gone@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15190000-0000-0000-0000-0000000000a8', '15190000-0000-0000-0000-00000000000a', 'EQU Gone', 'equ-gone@example.com', 'Finance', 'disabled');

create temp table _e (k text primary key, v uuid) on commit drop;
create temp table _j (k text primary key, v jsonb) on commit drop;
grant all on _e, _j to authenticated;
set local role authenticated;

select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');
insert into _e select 'reason', (save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d1","project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-10","quantity":6,"unit":"hours"}'::jsonb)->>'id')::uuid;
select transition_equipment_usage((select v from _e where k='reason'), 'Submitted');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');
select throws_ok($$ select transition_equipment_usage((select v from _e where k='reason'),'Rejected',null) $$, '22023', 'A rejection reason is required', 'AC-RSN-001 equipment null refused');
select throws_ok($$ select transition_equipment_usage((select v from _e where k='reason'),'Rejected','') $$, '22023', 'A rejection reason is required', 'AC-RSN-001 equipment empty refused');
select throws_ok($$ select transition_equipment_usage((select v from _e where k='reason'),'Rejected','   ') $$, '22023', 'A rejection reason is required', 'AC-RSN-001 equipment spaces refused');
select throws_ok($$ select transition_equipment_usage((select v from _e where k='reason'),'Rejected',E'\t\n') $$, '22023', 'A rejection reason is required', 'AC-RSN-001 equipment whitespace refused');
select throws_ok($$ select transition_equipment_usage((select v from _e where k='reason'),'Rejected',repeat('x',501)) $$, '23514', null, 'AC-RSN-001 equipment over limit refused');
select ok((select status::text in ('Submitted','Requested') and decision_notes is null and rejected_by is null and rejected_at is null from equipment_usage_entries where id=(select v from _e where k='reason')), 'AC-RSN-001 equipment refusal atomic');
select lives_ok($$ select transition_equipment_usage((select v from _e where k='reason'),'Rejected',repeat('x',500)) $$, 'AC-RSN-001 equipment limit accepted');
select ok((select decision_notes=repeat('x',500) and rejected_by='15190000-0000-0000-0000-0000000000a3'::uuid and rejected_at is not null from equipment_usage_entries where id=(select v from _e where k='reason')), 'AC-RSN-001 equipment reason actor and time recorded');
select * from finish();
rollback;
