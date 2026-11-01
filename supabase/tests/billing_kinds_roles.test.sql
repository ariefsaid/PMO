begin;
create extension if not exists pgtap;
select plan(36);   -- set by the plan script below

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
insert into public.organizations (id,name) values
  ('04080000-0000-0000-0000-000000000001','Billing kinds roles org'),
  ('04080000-0000-0000-0000-000000000002','Billing kinds roles foreign org');
insert into auth.users (id,email) values
  ('04080000-0000-0000-0000-0000000000a1','bkr-finance@example.test'),('04080000-0000-0000-0000-0000000000a2','bkr-admin@example.test'),('04080000-0000-0000-0000-0000000000a3','bkr-exec@example.test'),
  ('04080000-0000-0000-0000-0000000000a4','bkr-pm@example.test'),('04080000-0000-0000-0000-0000000000a5','bkr-eng@example.test'),('04080000-0000-0000-0000-0000000000a6','bkr-inactive@example.test'),('04080000-0000-0000-0000-0000000000a7','bkr-foreign@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
  ('04080000-0000-0000-0000-0000000000a1','04080000-0000-0000-0000-000000000001','BKR Finance','bkr-finance@example.test','Finance','active'),
  ('04080000-0000-0000-0000-0000000000a2','04080000-0000-0000-0000-000000000001','BKR Admin','bkr-admin@example.test','Admin','active'),
  ('04080000-0000-0000-0000-0000000000a3','04080000-0000-0000-0000-000000000001','BKR Executive','bkr-exec@example.test','Executive','active'),
  ('04080000-0000-0000-0000-0000000000a4','04080000-0000-0000-0000-000000000001','BKR PM','bkr-pm@example.test','Project Manager','active'),
  ('04080000-0000-0000-0000-0000000000a5','04080000-0000-0000-0000-000000000001','BKR Engineer','bkr-eng@example.test','Engineer','active'),
  ('04080000-0000-0000-0000-0000000000a6','04080000-0000-0000-0000-000000000001','BKR Inactive','bkr-inactive@example.test','Finance','disabled'),
  ('04080000-0000-0000-0000-0000000000a7','04080000-0000-0000-0000-000000000002','BKR Foreign Finance','bkr-foreign@example.test','Finance','active');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref) values
 ('04080000-0000-0000-0000-0000000000d1','04080000-0000-0000-0000-000000000001','BKR P1','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BKR-1'),
 ('04080000-0000-0000-0000-0000000000d4','04080000-0000-0000-0000-000000000001','BKR P4','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BKR-4'),
 ('04080000-0000-0000-0000-0000000000d7','04080000-0000-0000-0000-000000000001','BKR P7','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BKR-7'),
 ('04080000-0000-0000-0000-0000000000d9','04080000-0000-0000-0000-000000000002','BKR foreign','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BKR-F');
insert into public.external_domain_ownership (org_id,external_tier,domain) values ('04080000-0000-0000-0000-000000000001','erpnext','revenue');
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,
                                   tax_amount,currency,status,erp_docstatus) values
 ('04080000-0000-0000-0000-0000000000e1','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d1','SI-BKR-1','2026-01-01',400,0,'exclusive',0,'USD','Paid',1),
 ('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-000000000001',null,'SI-BKR-3','2026-01-03',50,50,'exclusive',0,'USD','Unpaid',1),
 ('04080000-0000-0000-0000-0000000000e9','04080000-0000-0000-0000-000000000002','04080000-0000-0000-0000-0000000000d9','SI-BKR-9','2026-01-09',10,10,'exclusive',0,'USD','Unpaid',1);
insert into public.sales_invoices (id,org_id,project_id,invoice_date,amount,erp_outstanding_amount,tax_treatment,tax_amount,
                                   currency,status,native_lines,pmo_native,author_user_id,pmo_number) values
 ('04080000-0000-0000-0000-0000000000e2','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d1','2026-01-02',200,200,'exclusive',0,'USD','Unpaid','[{"description":"native"}]',true,'04080000-0000-0000-0000-0000000000a1','PMO-BKR-1');
insert into public.external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id) values
 ('04080000-0000-0000-0000-000000000001','revenue','04080000-0000-0000-0000-0000000000e1','erpnext','SI-BKR-1'),('04080000-0000-0000-0000-000000000001','revenue','04080000-0000-0000-0000-0000000000e3','erpnext','SI-BKR-3');
-- over-contract project: contract 700 + 400 against 1000, other 250
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,
                                   tax_amount,currency,status,erp_docstatus,billing_kind) values
 ('04080000-0000-0000-0000-0000000000f9','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d7','SI-BKR-E1','2026-03-03',700,700,'exclusive',0,'USD','Unpaid',1,'contract'),
 ('04080000-0000-0000-0000-0000000000fa','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d7','SI-BKR-E2','2026-03-01',400,0,'exclusive',0,'USD','Paid',1,'contract'),
 ('04080000-0000-0000-0000-0000000000fb','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d7','SI-BKR-E3','2026-03-02',250,250,'exclusive',0,'USD','Unpaid',1,'other');

-- ── allowed: Finance and Admin ─────────────────────────────────────────────────────────────────
set local role authenticated; set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$, 'AC-007 Finance may correct a kind');
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e1'), 'other', 'AC-007 the Finance correction persisted');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','contract')$$, 'AC-007 Admin may correct a kind');
select lives_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d1','other')$$, 'AC-007 Admin may link with a kind');
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e3'), 'other', 'AC-007 the link carried the kind');
-- a kind correction on a native invoice leaves author, approval, status and money untouched
reset role;
create temp table bk_roles_before as select to_jsonb(si) - 'billing_kind' as row_data from public.sales_invoices si
 where id='04080000-0000-0000-0000-0000000000e2';
grant select on bk_roles_before to authenticated;
set local role authenticated; set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e2','other')$$, 'AC-007 Finance may correct a native invoice kind');
select is((select to_jsonb(si) - 'billing_kind' from public.sales_invoices si where id='04080000-0000-0000-0000-0000000000e2'),
          (select row_data from bk_roles_before), 'AC-007 the native correction leaves author, approval, status and money untouched');

-- ── refused: Executive, Project Manager, Engineer, inactive Finance - each for BOTH writers ────
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$, '42501', 'not authorized', 'AC-007 Executive cannot set a kind');
select throws_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d4','other')$$, '42501', 'not authorized', 'AC-007 Executive cannot link with a kind');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$, '42501', 'not authorized', 'AC-007 Project Manager cannot set a kind');
select throws_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d4','other')$$, '42501', 'not authorized', 'AC-007 Project Manager cannot link with a kind');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$, '42501', 'not authorized', 'AC-007 Engineer cannot set a kind');
select throws_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d4','other')$$, '42501', 'not authorized', 'AC-007 Engineer cannot link with a kind');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$, '42501', null, 'AC-007 an inactive Finance member cannot set a kind');
select throws_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d4','other')$$, '42501', null, 'AC-007 an inactive Finance member cannot link with a kind');
reset role;
set local role anon; set local request.jwt.claims='{}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$, '42501', null, 'AC-007 anonymous cannot set a kind');
select throws_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d4','other')$$, '42501', null, 'AC-007 anonymous cannot link with a kind');
reset role;
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e1'), 'contract', 'AC-007 refused role writes left the invoice unchanged');
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e3'), 'other', 'AC-007 refused role links left the invoice as the Admin saved it');

-- ── foreign org: the same P0002 as a missing invoice (no existence signal), both directions ───
set local role authenticated; set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$, 'P0002', null, 'AC-007 a foreign-org Finance user cannot reach this org''s invoice');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e9','other')$$, 'P0002', null, 'AC-007 this org''s Finance user cannot reach a foreign invoice');
select throws_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d9','other')$$, 'P0002', null, 'AC-007 a foreign project is refused');
select throws_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e9','04080000-0000-0000-0000-0000000000d9','other')$$, 'P0002', null, 'AC-007 this org''s Finance user cannot link or classify a foreign invoice');
reset role;
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e9'), 'contract', 'AC-007 the refused foreign write left the foreign invoice unchanged');
select is((select project_id from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e9'), '04080000-0000-0000-0000-0000000000d9'::uuid, 'AC-007 the refused foreign link left the foreign invoice''s project unchanged');

-- ── direct-write paths: the missing column grant is the control ───────────────────────────────
select ok(not has_column_privilege('authenticated','public.sales_invoices','billing_kind','UPDATE')
          and not has_column_privilege('authenticated','public.sales_invoices','billing_kind','INSERT')
          and not has_column_privilege('anon','public.sales_invoices','billing_kind','UPDATE')
          and not has_column_privilege('anon','public.sales_invoices','billing_kind','INSERT'), 'AC-007 no client role can write billing_kind directly');
set local role authenticated; set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$update public.sales_invoices set billing_kind='other' where id='04080000-0000-0000-0000-0000000000e1'$$, '42501', null, 'AC-007 a direct UPDATE of the kind is refused for Finance');
select throws_ok($$insert into public.sales_invoices (id,org_id,project_id,si_number,amount,tax_treatment,tax_amount,currency,status,billing_kind)
                   values (gen_random_uuid(),'04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d1','SI-DIRECT',1,'exclusive',0,'USD','Draft','other')$$,
                 '42501', null, 'AC-007 a direct INSERT naming the kind is refused for Finance');
reset role;
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e1'), 'contract', 'AC-007 refused direct writes left the invoice unchanged');

-- ── readers keep the existing revenue visibility (contributors ride get_project_finances) ─────
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(jsonb_array_length(public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->'contributors'), 2, 'AC-007 Finance reads the contributors');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(jsonb_array_length(public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->'contributors'), 2, 'AC-007 Admin reads the contributors');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(jsonb_array_length(public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->'contributors'), 2, 'AC-007 Executive reads the contributors');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is(jsonb_array_length(public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->'contributors'), 2, 'AC-007 Project Manager reads the contributors');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.get_project_finances('04080000-0000-0000-0000-0000000000d7')$$, '42501', null, 'AC-007 an Engineer cannot read project finances or contributors');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select throws_ok($$select public.get_project_finances('04080000-0000-0000-0000-0000000000d7')$$, 'P0002', null, 'AC-007 a foreign-org user cannot read this org''s contributors');
reset role;

-- ── function posture ──────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon','public.set_sales_invoice_billing_kind(uuid,text)','execute')
          and has_function_privilege('authenticated','public.set_sales_invoice_billing_kind(uuid,text)','execute')
          and (select prosecdef and proconfig = array['search_path=public'] from pg_proc where oid='public.set_sales_invoice_billing_kind(uuid,text)'::regprocedure),
          'AC-007 the kind setter is a definer with a pinned search_path and no anon grant');
select * from finish();
rollback;
