-- #1102 — ledger read-role contract and snapshot-backed operational compatibility.
begin;
create extension if not exists pgtap;
select no_plan();

insert into public.organizations (id, name, default_currency, default_timezone) values
  ('03110000-0000-0000-0000-000000000001','LRR synthetic organization A','USD','UTC'),
  ('03110000-0000-0000-0000-000000000002','LRR synthetic organization B','USD','UTC');
insert into auth.users (id, email) values
  ('03110000-0000-0000-0000-0000000000a1','finance-a@lrr.test'),
  ('03110000-0000-0000-0000-0000000000a2','admin-a@lrr.test'),
  ('03110000-0000-0000-0000-0000000000a3','executive-a@lrr.test'),
  ('03110000-0000-0000-0000-0000000000a4','pm-a@lrr.test'),
  ('03110000-0000-0000-0000-0000000000a5','engineer-a@lrr.test'),
  ('03110000-0000-0000-0000-0000000000a6','finance-b@lrr.test'),
  ('03110000-0000-0000-0000-0000000000a7','disabled-finance@lrr.test'),
  ('03110000-0000-0000-0000-0000000000a8','banned-finance@lrr.test'),
  ('03110000-0000-0000-0000-0000000000a9','expired-ban-finance@lrr.test'),
  ('03110000-0000-0000-0000-0000000000aa','profileless-user@lrr.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('03110000-0000-0000-0000-0000000000a1','03110000-0000-0000-0000-000000000001','Synthetic Finance A','finance-a@lrr.test','Finance','active'),
  ('03110000-0000-0000-0000-0000000000a2','03110000-0000-0000-0000-000000000001','Synthetic Admin A','admin-a@lrr.test','Admin','active'),
  ('03110000-0000-0000-0000-0000000000a3','03110000-0000-0000-0000-000000000001','Synthetic Executive A','executive-a@lrr.test','Executive','active'),
  ('03110000-0000-0000-0000-0000000000a4','03110000-0000-0000-0000-000000000001','Synthetic PM A','pm-a@lrr.test','Project Manager','active'),
  ('03110000-0000-0000-0000-0000000000a5','03110000-0000-0000-0000-000000000001','Synthetic Engineer A','engineer-a@lrr.test','Engineer','active'),
  ('03110000-0000-0000-0000-0000000000a6','03110000-0000-0000-0000-000000000002','Synthetic Finance B','finance-b@lrr.test','Finance','active'),
  ('03110000-0000-0000-0000-0000000000a7','03110000-0000-0000-0000-000000000001','Synthetic Disabled Finance','disabled-finance@lrr.test','Finance','disabled'),
  ('03110000-0000-0000-0000-0000000000a8','03110000-0000-0000-0000-000000000001','Synthetic Banned Finance','banned-finance@lrr.test','Finance','active'),
  ('03110000-0000-0000-0000-0000000000a9','03110000-0000-0000-0000-000000000001','Synthetic Expired-ban Finance','expired-ban-finance@lrr.test','Finance','active');

insert into public.erp_gl_entry_mirror
  (id,org_id,erp_name,account,party_type,party,voucher_type,voucher_no,debit,credit,erp_modified)
values
  ('03110000-0000-0000-0000-0000000000c1','03110000-0000-0000-0000-000000000001','LRR-A-GL-EMP','Synthetic payable','Employee','synthetic-employee-a','Journal Entry','LRR-A-VOUCHER-EMP',0,101.25,'2026-10-17'),
  ('03110000-0000-0000-0000-0000000000c2','03110000-0000-0000-0000-000000000001','LRR-A-GL-CUST','Synthetic receivable','Customer','synthetic-customer-a','Sales Invoice','LRR-A-VOUCHER-CUST',202.50,0,'2026-10-17'),
  ('03110000-0000-0000-0000-0000000000c3','03110000-0000-0000-0000-000000000001','LRR-A-GL-SUP','Synthetic payable','Supplier','synthetic-supplier-a','Purchase Invoice','LRR-A-VOUCHER-SUP',0,303.75,'2026-10-17'),
  ('03110000-0000-0000-0000-0000000000c4','03110000-0000-0000-0000-000000000001','LRR-A-GL-NULL','Synthetic expense',null,null,'Journal Entry','LRR-A-VOUCHER-NULL',404.00,0,'2026-10-17'),
  ('03110000-0000-0000-0000-0000000000c5','03110000-0000-0000-0000-000000000002','LRR-B-GL-EMP','Synthetic payable','Employee','synthetic-employee-b','Journal Entry','LRR-B-VOUCHER-EMP',0,1001.25,'2026-10-17'),
  ('03110000-0000-0000-0000-0000000000c6','03110000-0000-0000-0000-000000000002','LRR-B-GL-CUST','Synthetic receivable','Customer','synthetic-customer-b','Sales Invoice','LRR-B-VOUCHER-CUST',1002.50,0,'2026-10-17'),
  ('03110000-0000-0000-0000-0000000000c7','03110000-0000-0000-0000-000000000002','LRR-B-GL-SUP','Synthetic payable','Supplier','synthetic-supplier-b','Purchase Invoice','LRR-B-VOUCHER-SUP',0,1003.75,'2026-10-17'),
  ('03110000-0000-0000-0000-0000000000c8','03110000-0000-0000-0000-000000000002','LRR-B-GL-NULL','Synthetic expense',null,null,'Journal Entry','LRR-B-VOUCHER-NULL',1004.00,0,'2026-10-17');
insert into public.erp_payment_ledger_mirror
  (id,org_id,erp_name,account,party_type,party,against_voucher_type,against_voucher_no,amount,erp_modified)
values
  ('03110000-0000-0000-0000-0000000000d1','03110000-0000-0000-0000-000000000001','LRR-A-PLE-EMP','Synthetic payable','Employee','synthetic-employee-a','Journal Entry','LRR-A-PLE-VOUCHER-EMP',101.25,'2026-10-17'),
  ('03110000-0000-0000-0000-0000000000d2','03110000-0000-0000-0000-000000000001','LRR-A-PLE-CUST','Synthetic receivable','Customer','synthetic-customer-a','Sales Invoice','LRR-A-PLE-VOUCHER-CUST',202.50,'2026-10-17'),
  ('03110000-0000-0000-0000-0000000000d3','03110000-0000-0000-0000-000000000001','LRR-A-PLE-SUP','Synthetic payable','Supplier','synthetic-supplier-a','Purchase Invoice','LRR-A-PLE-VOUCHER-SUP',303.75,'2026-10-17'),
  ('03110000-0000-0000-0000-0000000000d4','03110000-0000-0000-0000-000000000001','LRR-A-PLE-NULL','Synthetic expense',null,null,'Journal Entry','LRR-A-PLE-VOUCHER-NULL',404.00,'2026-10-17'),
  ('03110000-0000-0000-0000-0000000000d5','03110000-0000-0000-0000-000000000002','LRR-B-PLE-EMP','Synthetic payable','Employee','synthetic-employee-b','Journal Entry','LRR-B-PLE-VOUCHER-EMP',1001.25,'2026-10-17'),
  ('03110000-0000-0000-0000-0000000000d6','03110000-0000-0000-0000-000000000002','LRR-B-PLE-CUST','Synthetic receivable','Customer','synthetic-customer-b','Sales Invoice','LRR-B-PLE-VOUCHER-CUST',1002.50,'2026-10-17'),
  ('03110000-0000-0000-0000-0000000000d7','03110000-0000-0000-0000-000000000002','LRR-B-PLE-SUP','Synthetic payable','Supplier','synthetic-supplier-b','Purchase Invoice','LRR-B-PLE-VOUCHER-SUP',1003.75,'2026-10-17'),
  ('03110000-0000-0000-0000-0000000000d8','03110000-0000-0000-0000-000000000002','LRR-B-PLE-NULL','Synthetic expense',null,null,'Journal Entry','LRR-B-PLE-VOUCHER-NULL',1004.00,'2026-10-17');

-- A separate snapshot-backed operational fixture exercises the existing PM and Engineer outputs.
insert into public.organizations (id,name,default_currency,default_timezone) values
  ('03110307-0000-0000-0000-000000000001','LRR operational organization','USD','UTC'),
  ('03110307-0000-0000-0000-000000000002','LRR foreign operational organization','USD','UTC');
insert into auth.users (id,email) values
  ('03110307-0000-0000-0000-0000000000a1','admin@operations-lrr.test'),
  ('03110307-0000-0000-0000-0000000000a2','pm@operations-lrr.test'),
  ('03110307-0000-0000-0000-0000000000a3','engineer@operations-lrr.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
  ('03110307-0000-0000-0000-0000000000a1','03110307-0000-0000-0000-000000000001','Operations Admin','admin@operations-lrr.test','Admin','active'),
  ('03110307-0000-0000-0000-0000000000a2','03110307-0000-0000-0000-000000000001','Operations PM','pm@operations-lrr.test','Project Manager','active'),
  ('03110307-0000-0000-0000-0000000000a3','03110307-0000-0000-0000-000000000001','Operations Engineer','engineer@operations-lrr.test','Engineer','active');
insert into public.projects
  (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,tax_base_numerator,tax_base_denominator,subject_to_vat,project_manager_id)
values
  ('03110307-0000-0000-0000-0000000000d1','03110307-0000-0000-0000-000000000001','LRR operational project','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'03110307-0000-0000-0000-0000000000a2'),
  ('03110307-0000-0000-0000-0000000000d2','03110307-0000-0000-0000-000000000002','LRR foreign project','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,null);
insert into public.external_org_bindings (org_id,external_tier,site_url,secret_ref,status,connected_by,connected_at)
values ('03110307-0000-0000-0000-000000000001','erpnext','https://erp.example.test','synthetic-test-reference','active','03110307-0000-0000-0000-0000000000a1','2026-10-17');
set local request.jwt.claims='{}';
set local role service_role;
insert into public.budget_category_account_map (org_id,category,erp_account,is_push_target)
values ('03110307-0000-0000-0000-000000000001','Labor','LRR-OP-LABOR',true);
insert into public.erp_actuals_snapshot (org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at)
values ('03110307-0000-0000-0000-000000000001','03110307-0000-0000-0000-0000000000d1','LRR-OP-LABOR','FY-2026',120,'2026-10-16 12:00:00+00','03110307-0000-0000-0000-0000000000b1','2026-10-16 12:00:00+00');
insert into public.budget_versions (id,org_id,project_id,version,name,status,currency,created_at)
values ('03110307-0000-0000-0000-0000000000c1','03110307-0000-0000-0000-000000000001','03110307-0000-0000-0000-0000000000d1',1,'LRR active budget','Draft','USD','2026-10-16');
insert into public.budget_line_items (org_id,budget_version_id,category,description,budgeted_amount,fiscal_year)
values ('03110307-0000-0000-0000-000000000001','03110307-0000-0000-0000-0000000000c1','Labor','Synthetic mapped category',200,'FY-2026');
update public.budget_versions set status='Active' where id='03110307-0000-0000-0000-0000000000c1';
reset role;

-- AC-LRR-001: exact own-organization ledger facts for each allowed role; the second org is a control.
set local role authenticated;
set local request.jwt.claims='{"sub":"03110000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq(
  $$select id,erp_name,party_type,debit,credit from public.erp_gl_entry_mirror order by id$$,
  $$values
    ('03110000-0000-0000-0000-0000000000c1'::uuid,'LRR-A-GL-EMP','Employee',0.00::numeric,101.25::numeric),
    ('03110000-0000-0000-0000-0000000000c2'::uuid,'LRR-A-GL-CUST','Customer',202.50::numeric,0.00::numeric),
    ('03110000-0000-0000-0000-0000000000c3'::uuid,'LRR-A-GL-SUP','Supplier',0.00::numeric,303.75::numeric),
    ('03110000-0000-0000-0000-0000000000c4'::uuid,'LRR-A-GL-NULL',null::text,404.00::numeric,0.00::numeric)$$,
  'AC-LRR-001 Admin reads exact own-org GL IDs and values');
select is((select count(*)::int from public.erp_gl_entry_mirror),4,'AC-LRR-001 Admin sees exactly four own-org GL rows');
select results_eq(
  $$select id,erp_name,party_type,amount from public.erp_payment_ledger_mirror order by id$$,
  $$values
    ('03110000-0000-0000-0000-0000000000d1'::uuid,'LRR-A-PLE-EMP','Employee',101.25::numeric),
    ('03110000-0000-0000-0000-0000000000d2'::uuid,'LRR-A-PLE-CUST','Customer',202.50::numeric),
    ('03110000-0000-0000-0000-0000000000d3'::uuid,'LRR-A-PLE-SUP','Supplier',303.75::numeric),
    ('03110000-0000-0000-0000-0000000000d4'::uuid,'LRR-A-PLE-NULL',null::text,404.00::numeric)$$,
  'AC-LRR-001 Admin reads exact own-org PLE IDs and values');
select is((select count(*)::int from public.erp_payment_ledger_mirror),4,'AC-LRR-001 Admin sees exactly four own-org PLE rows');
set local request.jwt.claims='{"sub":"03110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq(
  $$select id,erp_name,party_type,debit,credit from public.erp_gl_entry_mirror order by id$$,
  $$values
    ('03110000-0000-0000-0000-0000000000c1'::uuid,'LRR-A-GL-EMP','Employee',0.00::numeric,101.25::numeric),
    ('03110000-0000-0000-0000-0000000000c2'::uuid,'LRR-A-GL-CUST','Customer',202.50::numeric,0.00::numeric),
    ('03110000-0000-0000-0000-0000000000c3'::uuid,'LRR-A-GL-SUP','Supplier',0.00::numeric,303.75::numeric),
    ('03110000-0000-0000-0000-0000000000c4'::uuid,'LRR-A-GL-NULL',null::text,404.00::numeric,0.00::numeric)$$,
  'AC-LRR-001 Finance reads exact own-org GL IDs and values');
select results_eq(
  $$select id,erp_name,party_type,amount from public.erp_payment_ledger_mirror order by id$$,
  $$values
    ('03110000-0000-0000-0000-0000000000d1'::uuid,'LRR-A-PLE-EMP','Employee',101.25::numeric),
    ('03110000-0000-0000-0000-0000000000d2'::uuid,'LRR-A-PLE-CUST','Customer',202.50::numeric),
    ('03110000-0000-0000-0000-0000000000d3'::uuid,'LRR-A-PLE-SUP','Supplier',303.75::numeric),
    ('03110000-0000-0000-0000-0000000000d4'::uuid,'LRR-A-PLE-NULL',null::text,404.00::numeric)$$,
  'AC-LRR-001 Finance reads exact own-org PLE IDs and values');
set local request.jwt.claims='{"sub":"03110000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select results_eq(
  $$select id,erp_name,party_type,debit,credit from public.erp_gl_entry_mirror order by id$$,
  $$values
    ('03110000-0000-0000-0000-0000000000c1'::uuid,'LRR-A-GL-EMP','Employee',0.00::numeric,101.25::numeric),
    ('03110000-0000-0000-0000-0000000000c2'::uuid,'LRR-A-GL-CUST','Customer',202.50::numeric,0.00::numeric),
    ('03110000-0000-0000-0000-0000000000c3'::uuid,'LRR-A-GL-SUP','Supplier',0.00::numeric,303.75::numeric),
    ('03110000-0000-0000-0000-0000000000c4'::uuid,'LRR-A-GL-NULL',null::text,404.00::numeric,0.00::numeric)$$,
  'AC-LRR-001 Executive reads exact own-org GL IDs and values');
select results_eq(
  $$select id,erp_name,party_type,amount from public.erp_payment_ledger_mirror order by id$$,
  $$values
    ('03110000-0000-0000-0000-0000000000d1'::uuid,'LRR-A-PLE-EMP','Employee',101.25::numeric),
    ('03110000-0000-0000-0000-0000000000d2'::uuid,'LRR-A-PLE-CUST','Customer',202.50::numeric),
    ('03110000-0000-0000-0000-0000000000d3'::uuid,'LRR-A-PLE-SUP','Supplier',303.75::numeric),
    ('03110000-0000-0000-0000-0000000000d4'::uuid,'LRR-A-PLE-NULL',null::text,404.00::numeric)$$,
  'AC-LRR-001 Executive reads exact own-org PLE IDs and values');
set local request.jwt.claims='{"sub":"03110000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select results_eq(
  $$select id,erp_name,party_type,debit,credit from public.erp_gl_entry_mirror order by id$$,
  $$values
    ('03110000-0000-0000-0000-0000000000c5'::uuid,'LRR-B-GL-EMP','Employee',0.00::numeric,1001.25::numeric),
    ('03110000-0000-0000-0000-0000000000c6'::uuid,'LRR-B-GL-CUST','Customer',1002.50::numeric,0.00::numeric),
    ('03110000-0000-0000-0000-0000000000c7'::uuid,'LRR-B-GL-SUP','Supplier',0.00::numeric,1003.75::numeric),
    ('03110000-0000-0000-0000-0000000000c8'::uuid,'LRR-B-GL-NULL',null::text,1004.00::numeric,0.00::numeric)$$,
  'AC-LRR-001 Finance in organization B reads exact own-org GL IDs and values');
select results_eq(
  $$select id,erp_name,party_type,amount from public.erp_payment_ledger_mirror order by id$$,
  $$values
    ('03110000-0000-0000-0000-0000000000d5'::uuid,'LRR-B-PLE-EMP','Employee',1001.25::numeric),
    ('03110000-0000-0000-0000-0000000000d6'::uuid,'LRR-B-PLE-CUST','Customer',1002.50::numeric),
    ('03110000-0000-0000-0000-0000000000d7'::uuid,'LRR-B-PLE-SUP','Supplier',1003.75::numeric),
    ('03110000-0000-0000-0000-0000000000d8'::uuid,'LRR-B-PLE-NULL',null::text,1004.00::numeric)$$,
  'AC-LRR-001 Finance in organization B reads exact own-org PLE IDs and values');

-- AC-LRR-002: real active project staff subjects cannot read any party class from either mirror.
set local request.jwt.claims='{"sub":"03110000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from public.erp_gl_entry_mirror),0,'AC-LRR-002 Project Manager reads no raw GL rows');
select is((select count(*)::int from public.erp_payment_ledger_mirror),0,'AC-LRR-002 Project Manager reads no raw PLE rows');
set local request.jwt.claims='{"sub":"03110000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is((select count(*)::int from public.erp_gl_entry_mirror),0,'AC-LRR-002 Engineer reads no raw GL rows');
select is((select count(*)::int from public.erp_payment_ledger_mirror),0,'AC-LRR-002 Engineer reads no raw PLE rows');

-- AC-LRR-003: status and auth ban are checked for the current authenticated subject.
reset role;
update auth.users set banned_until=now() + interval '1 hour' where id='03110000-0000-0000-0000-0000000000a8';
update auth.users set banned_until=now() - interval '1 hour' where id='03110000-0000-0000-0000-0000000000a9';
set local role authenticated;
set local request.jwt.claims='{"sub":"03110000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select is((select count(*)::int from public.erp_gl_entry_mirror),0,'AC-LRR-003 disabled Finance reads no raw GL rows');
select is((select count(*)::int from public.erp_payment_ledger_mirror),0,'AC-LRR-003 disabled Finance reads no raw PLE rows');
set local request.jwt.claims='{"sub":"03110000-0000-0000-0000-0000000000a8","role":"authenticated"}';
select is((select count(*)::int from public.erp_gl_entry_mirror),0,'AC-LRR-003 future-banned Finance reads no raw GL rows');
select is((select count(*)::int from public.erp_payment_ledger_mirror),0,'AC-LRR-003 future-banned Finance reads no raw PLE rows');
set local request.jwt.claims='{"sub":"03110000-0000-0000-0000-0000000000aa","role":"authenticated"}';
select is((select count(*)::int from public.erp_gl_entry_mirror),0,'AC-LRR-003 authenticated user without a profile reads no raw GL rows');
select is((select count(*)::int from public.erp_payment_ledger_mirror),0,'AC-LRR-003 authenticated user without a profile reads no raw PLE rows');
set local request.jwt.claims='{}';
set local role anon;
select is((select count(*)::int from public.erp_gl_entry_mirror),0,'AC-LRR-003 anonymous caller reads no raw GL rows');
select is((select count(*)::int from public.erp_payment_ledger_mirror),0,'AC-LRR-003 anonymous caller reads no raw PLE rows');
set local role authenticated;
set local request.jwt.claims='{"sub":"03110000-0000-0000-0000-0000000000a9","role":"authenticated"}';
select results_eq(
  $$select id,erp_name,party_type,debit,credit from public.erp_gl_entry_mirror order by id$$,
  $$values
    ('03110000-0000-0000-0000-0000000000c1'::uuid,'LRR-A-GL-EMP','Employee',0.00::numeric,101.25::numeric),
    ('03110000-0000-0000-0000-0000000000c2'::uuid,'LRR-A-GL-CUST','Customer',202.50::numeric,0.00::numeric),
    ('03110000-0000-0000-0000-0000000000c3'::uuid,'LRR-A-GL-SUP','Supplier',0.00::numeric,303.75::numeric),
    ('03110000-0000-0000-0000-0000000000c4'::uuid,'LRR-A-GL-NULL',null::text,404.00::numeric,0.00::numeric)$$,
  'AC-LRR-003 expired-ban active Finance reads exact own-org GL rows');
select results_eq(
  $$select id,erp_name,party_type,amount from public.erp_payment_ledger_mirror order by id$$,
  $$values
    ('03110000-0000-0000-0000-0000000000d1'::uuid,'LRR-A-PLE-EMP','Employee',101.25::numeric),
    ('03110000-0000-0000-0000-0000000000d2'::uuid,'LRR-A-PLE-CUST','Customer',202.50::numeric),
    ('03110000-0000-0000-0000-0000000000d3'::uuid,'LRR-A-PLE-SUP','Supplier',303.75::numeric),
    ('03110000-0000-0000-0000-0000000000d4'::uuid,'LRR-A-PLE-NULL',null::text,404.00::numeric)$$,
  'AC-LRR-003 expired-ban active Finance reads exact own-org PLE rows');

-- AC-LRR-004: persisted role changes govern the same JWT subject, even with a forged role claim.
reset role;
set local request.jwt.claims='{"sub":"03110000-0000-0000-0000-0000000000a1","role":"authenticated","app_metadata":{"role":"Admin"}}';
update public.profiles set role='Project Manager' where id='03110000-0000-0000-0000-0000000000a1';
set local role authenticated;
select is((select count(*)::int from public.erp_gl_entry_mirror),0,'AC-LRR-004 Finance-to-PM persisted demotion immediately denies GL on the same subject');
select is((select count(*)::int from public.erp_payment_ledger_mirror),0,'AC-LRR-004 Finance-to-PM persisted demotion immediately denies PLE on the same subject');
reset role;
update public.profiles set role='Engineer' where id='03110000-0000-0000-0000-0000000000a1';
set local role authenticated;
select is((select count(*)::int from public.erp_gl_entry_mirror),0,'AC-LRR-004 persisted Engineer role denies GL despite forged Admin claim');
select is((select count(*)::int from public.erp_payment_ledger_mirror),0,'AC-LRR-004 persisted Engineer role denies PLE despite forged Admin claim');
reset role;
update public.profiles set role='Finance' where id='03110000-0000-0000-0000-0000000000a1';
set local role authenticated;
select results_eq(
  $$select id,erp_name,party_type,debit,credit from public.erp_gl_entry_mirror order by id$$,
  $$values
    ('03110000-0000-0000-0000-0000000000c1'::uuid,'LRR-A-GL-EMP','Employee',0.00::numeric,101.25::numeric),
    ('03110000-0000-0000-0000-0000000000c2'::uuid,'LRR-A-GL-CUST','Customer',202.50::numeric,0.00::numeric),
    ('03110000-0000-0000-0000-0000000000c3'::uuid,'LRR-A-GL-SUP','Supplier',0.00::numeric,303.75::numeric),
    ('03110000-0000-0000-0000-0000000000c4'::uuid,'LRR-A-GL-NULL',null::text,404.00::numeric,0.00::numeric)$$,
  'AC-LRR-004 restoring persisted Finance role restores exact GL rows');
select results_eq(
  $$select id,erp_name,party_type,amount from public.erp_payment_ledger_mirror order by id$$,
  $$values
    ('03110000-0000-0000-0000-0000000000d1'::uuid,'LRR-A-PLE-EMP','Employee',101.25::numeric),
    ('03110000-0000-0000-0000-0000000000d2'::uuid,'LRR-A-PLE-CUST','Customer',202.50::numeric),
    ('03110000-0000-0000-0000-0000000000d3'::uuid,'LRR-A-PLE-SUP','Supplier',303.75::numeric),
    ('03110000-0000-0000-0000-0000000000d4'::uuid,'LRR-A-PLE-NULL',null::text,404.00::numeric)$$,
  'AC-LRR-004 restoring persisted Finance role restores exact PLE rows');

-- AC-LRR-005: authenticated users cannot mutate either mirror; service-role upserts still work.
select ok(has_table_privilege('authenticated','public.erp_gl_entry_mirror','SELECT')
      and has_table_privilege('authenticated','public.erp_payment_ledger_mirror','SELECT'),
  'AC-LRR-005 authenticated retains its existing ledger SELECT grants');
select ok(has_table_privilege('service_role','public.erp_gl_entry_mirror','SELECT,INSERT,UPDATE,DELETE')
      and has_table_privilege('service_role','public.erp_payment_ledger_mirror','SELECT,INSERT,UPDATE,DELETE'),
  'AC-LRR-005 service role retains mirror read and upsert privileges');
select throws_ok(
  $$insert into public.erp_gl_entry_mirror (org_id,erp_name,account,erp_modified) values ('03110000-0000-0000-0000-000000000001','LRR-USER-GL-WRITE','Synthetic','2026-10-17')$$,
  '42501',null,'AC-LRR-005 authenticated INSERT into GL mirror is denied');
select throws_ok(
  $$update public.erp_gl_entry_mirror set credit=999 where id='03110000-0000-0000-0000-0000000000c1'$$,
  '42501',null,'AC-LRR-005 authenticated UPDATE on GL mirror is denied');
select throws_ok(
  $$delete from public.erp_gl_entry_mirror where id='03110000-0000-0000-0000-0000000000c1'$$,
  '42501',null,'AC-LRR-005 authenticated DELETE from GL mirror is denied');
select throws_ok(
  $$insert into public.erp_payment_ledger_mirror (org_id,erp_name,account,erp_modified) values ('03110000-0000-0000-0000-000000000001','LRR-USER-PLE-WRITE','Synthetic','2026-10-17')$$,
  '42501',null,'AC-LRR-005 authenticated INSERT into PLE mirror is denied');
select throws_ok(
  $$update public.erp_payment_ledger_mirror set amount=999 where id='03110000-0000-0000-0000-0000000000d1'$$,
  '42501',null,'AC-LRR-005 authenticated UPDATE on PLE mirror is denied');
select throws_ok(
  $$delete from public.erp_payment_ledger_mirror where id='03110000-0000-0000-0000-0000000000d1'$$,
  '42501',null,'AC-LRR-005 authenticated DELETE from PLE mirror is denied');
reset role;
select is((select count(*)::int from public.erp_gl_entry_mirror where id='03110000-0000-0000-0000-0000000000c1' and credit=101.25),1,'AC-LRR-005 denied GL writes leave original row and value unchanged');
select is((select count(*)::int from public.erp_payment_ledger_mirror where id='03110000-0000-0000-0000-0000000000d1' and amount=101.25),1,'AC-LRR-005 denied PLE writes leave original row and value unchanged');
set local request.jwt.claims='{"role":"service_role"}';
set local role service_role;
insert into public.erp_gl_entry_mirror (org_id,erp_name,account,party_type,party,voucher_type,voucher_no,debit,credit,erp_modified)
values ('03110000-0000-0000-0000-000000000001','LRR-A-GL-EMP','Synthetic payable','Employee','synthetic-employee-a','Journal Entry','LRR-A-VOUCHER-EMP',0,888.25,'2026-10-18')
on conflict (org_id,erp_name) do update set credit=excluded.credit,erp_modified=excluded.erp_modified;
select is((select credit from public.erp_gl_entry_mirror where id='03110000-0000-0000-0000-0000000000c1'),888.25::numeric,'AC-LRR-005 service-role GL upsert reads back the updated exact amount');
insert into public.erp_payment_ledger_mirror (org_id,erp_name,account,party_type,party,against_voucher_type,against_voucher_no,amount,erp_modified)
values ('03110000-0000-0000-0000-000000000001','LRR-A-PLE-EMP','Synthetic payable','Employee','synthetic-employee-a','Journal Entry','LRR-A-PLE-VOUCHER-EMP',777.75,'2026-10-18')
on conflict (org_id,erp_name) do update set amount=excluded.amount,erp_modified=excluded.erp_modified;
select is((select amount from public.erp_payment_ledger_mirror where id='03110000-0000-0000-0000-0000000000d1'),777.75::numeric,'AC-LRR-005 service-role PLE upsert reads back the updated exact amount');
reset role;

-- AC-LRR-007: the Employee restrictions remain restrictive SELECT policies; expense scope remains separate.
select ok((select permissive='RESTRICTIVE' and cmd='SELECT' and roles=array['authenticated']::name[]
           from pg_policies where schemaname='public' and tablename='erp_gl_entry_mirror'
             and policyname='erp_gl_entry_mirror_employee_read_scope'),
  'AC-LRR-007 GL Employee scope remains a restrictive authenticated SELECT policy');
select ok((select permissive='RESTRICTIVE' and cmd='SELECT' and roles=array['authenticated']::name[]
           from pg_policies where schemaname='public' and tablename='erp_payment_ledger_mirror'
             and policyname='erp_payment_ledger_mirror_employee_read_scope'),
  'AC-LRR-007 PLE Employee scope remains a restrictive authenticated SELECT policy');
select ok((select permissive='RESTRICTIVE' and cmd='SELECT' and roles=array['authenticated']::name[]
             and qual like '%domain IS DISTINCT FROM%' and qual like '%holds_spend_approval_authority%'
           from pg_policies where schemaname='public' and tablename='external_command_outbox'
             and policyname='external_command_outbox_expenses_read_scope'),
  'AC-LRR-007 expense outbox remains governed by its independent restrictive policy');

-- AC-LRR-006: the established PM and Engineer operational Actuals remain snapshot-backed and nonzero.
set local role authenticated;
set local request.jwt.claims='{"sub":"03110307-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select (x->>'spent')::numeric from json_array_elements(public.get_pm_dashboard_projects()) x
           where x->>'id'='03110307-0000-0000-0000-0000000000d1'),120::numeric,
  'AC-LRR-006 assigned PM dashboard retains exact snapshot Actual of 120');
select is((select x->>'actual_currency' from json_array_elements(public.get_pm_dashboard_projects()) x
           where x->>'id'='03110307-0000-0000-0000-0000000000d1'),'USD',
  'AC-LRR-006 assigned PM dashboard retains Actual currency provenance');
select is((select (x->>'actual_coverage_count')::int from json_array_elements(public.get_pm_dashboard_projects()) x
           where x->>'id'='03110307-0000-0000-0000-0000000000d1'),1,
  'AC-LRR-006 assigned PM dashboard retains complete mapped-category coverage');
select is((select (x->>'actual_complete')::boolean from json_array_elements(public.get_pm_dashboard_projects()) x
           where x->>'id'='03110307-0000-0000-0000-0000000000d1'),true,
  'AC-LRR-006 assigned PM dashboard retains complete Actual status');
select is((public.get_project_finances('03110307-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric,120::numeric,
  'AC-LRR-006 PM project finance retains exact snapshot Actual of 120');
select is((public.get_project_finances('03110307-0000-0000-0000-0000000000d1')->'actuals'->>'as_of')::timestamptz,'2026-10-16 12:00:00+00'::timestamptz,
  'AC-LRR-006 PM project finance retains snapshot as-of provenance');
select is((public.get_project_finances('03110307-0000-0000-0000-0000000000d1')->'actuals'->>'excludes_restricted_rows')::boolean,false,
  'AC-LRR-006 PM project finance retains its existing expense-scope completeness');
select is((select (actuals->>'total')::numeric from public.get_projects_money_collection(array[
           '03110307-0000-0000-0000-0000000000d1'::uuid,'03110307-0000-0000-0000-0000000000d2'::uuid])),120::numeric,
  'AC-LRR-006 PM collection retains exact own-project snapshot Actual');
select results_eq(
  $$select project_id from public.get_projects_money_collection(array[
      '03110307-0000-0000-0000-0000000000d1'::uuid,'03110307-0000-0000-0000-0000000000d2'::uuid]) order by project_id$$,
  $$values ('03110307-0000-0000-0000-0000000000d1'::uuid)$$,
  'AC-LRR-006 PM collection excludes a foreign-project input');
select is((select ledger_basis from public.get_projects_money_collection(array['03110307-0000-0000-0000-0000000000d1'::uuid])), 'erp',
  'AC-LRR-006 PM collection retains ERP snapshot basis');
select is((select (actuals->>'complete')::boolean from public.get_projects_money_collection(array['03110307-0000-0000-0000-0000000000d1'::uuid])),true,
  'AC-LRR-006 PM collection retains complete Actual status');
select is((select (actuals->>'as_of')::timestamptz from public.get_projects_money_collection(array['03110307-0000-0000-0000-0000000000d1'::uuid])),
          '2026-10-16 12:00:00+00'::timestamptz,
  'AC-LRR-006 PM collection retains snapshot as-of provenance');
select ok(not jsonb_path_exists(to_jsonb(public.get_pm_dashboard_projects()),'$.**.party')
      and not jsonb_path_exists(to_jsonb(public.get_pm_dashboard_projects()),'$.**.voucher_no')
      and not jsonb_path_exists(to_jsonb(public.get_pm_dashboard_projects()),'$.**.erp_name'),
  'AC-LRR-006 PM dashboard output contains no raw ledger detail keys');
select ok(not jsonb_path_exists(public.get_project_finances('03110307-0000-0000-0000-0000000000d1'),'$.**.party')
      and not jsonb_path_exists(public.get_project_finances('03110307-0000-0000-0000-0000000000d1'),'$.**.voucher_no')
      and not jsonb_path_exists(public.get_project_finances('03110307-0000-0000-0000-0000000000d1'),'$.**.erp_name'),
  'AC-LRR-006 PM project finance output contains no raw ledger detail keys');
select ok(not jsonb_path_exists(to_jsonb((select actuals from public.get_projects_money_collection(array[
           '03110307-0000-0000-0000-0000000000d1'::uuid]))),'$.**.party')
      and not jsonb_path_exists(to_jsonb((select actuals from public.get_projects_money_collection(array[
           '03110307-0000-0000-0000-0000000000d1'::uuid]))),'$.**.voucher_no')
      and not jsonb_path_exists(to_jsonb((select actuals from public.get_projects_money_collection(array[
           '03110307-0000-0000-0000-0000000000d1'::uuid]))),'$.**.erp_name'),
  'AC-LRR-006 PM collection output contains no raw ledger detail keys');
select throws_ok($$select public.get_project_finances('03110307-0000-0000-0000-0000000000d2')$$,'P0002',null,
  'AC-LRR-006 PM receives not-found for foreign-project finance');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"03110307-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select (x->>'spent')::numeric from json_array_elements(public.get_executive_dashboard()->'top_projects') x
           where x->>'id'='03110307-0000-0000-0000-0000000000d1'),120::numeric,
  'AC-LRR-006 Engineer dashboard retains exact snapshot Actual of 120');
select is((select x->>'actual_currency' from json_array_elements(public.get_executive_dashboard()->'top_projects') x
           where x->>'id'='03110307-0000-0000-0000-0000000000d1'),'USD',
  'AC-LRR-006 Engineer dashboard retains Actual currency provenance');
select is((select (x->>'actual_complete')::boolean from json_array_elements(public.get_executive_dashboard()->'top_projects') x
           where x->>'id'='03110307-0000-0000-0000-0000000000d1'),true,
  'AC-LRR-006 Engineer dashboard retains complete Actual status');
select ok(not jsonb_path_exists(to_jsonb(public.get_executive_dashboard()),'$.**.party')
      and not jsonb_path_exists(to_jsonb(public.get_executive_dashboard()),'$.**.voucher_no')
      and not jsonb_path_exists(to_jsonb(public.get_executive_dashboard()),'$.**.erp_name'),
  'AC-LRR-006 Engineer dashboard output contains no raw ledger detail keys');
select throws_ok($$select public.get_project_finances('03110307-0000-0000-0000-0000000000d1')$$,'42501',null,
  'AC-LRR-006 Engineer remains excluded from project finance');
select throws_ok($$select * from public.get_projects_money_collection(array['03110307-0000-0000-0000-0000000000d1'::uuid])$$,'42501',null,
  'AC-LRR-006 Engineer remains excluded from project money collection');
reset role;

select * from finish();
rollback;
