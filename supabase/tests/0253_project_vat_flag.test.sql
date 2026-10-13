-- 0253_project_vat_flag.test.sql — OD-TAX-4 / #856: projects.subject_to_vat. AC-856-8, AC-856-9 (+ default, cross-org, anon).
begin;
select plan(18);

insert into organizations (id, name) values
  ('02530000-0000-0000-0000-000000000001','VAT Org'),
  ('02530000-0000-0000-0000-000000000002','Other VAT Org');
insert into auth.users (id, email) values
  ('02530000-0000-0000-0000-0000000000a1','vat-fin@example.com'),
  ('02530000-0000-0000-0000-0000000000a2','vat-admin@example.com'),
  ('02530000-0000-0000-0000-0000000000a3','vat-pm@example.com'),
  ('02530000-0000-0000-0000-0000000000a4','vat-other-fin@example.com'),
  ('02530000-0000-0000-0000-0000000000a5','vat-exec@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('02530000-0000-0000-0000-0000000000a1','02530000-0000-0000-0000-000000000001','Fin','vat-fin@example.com','Finance'),
  ('02530000-0000-0000-0000-0000000000a2','02530000-0000-0000-0000-000000000001','Adm','vat-admin@example.com','Admin'),
  ('02530000-0000-0000-0000-0000000000a3','02530000-0000-0000-0000-000000000001','Pm','vat-pm@example.com','Project Manager'),
  ('02530000-0000-0000-0000-0000000000a4','02530000-0000-0000-0000-000000000002','OtherFin','vat-other-fin@example.com','Finance'),
  ('02530000-0000-0000-0000-0000000000a5','02530000-0000-0000-0000-000000000001','Exec','vat-exec@example.com','Executive');
insert into companies (id, org_id, name, type) values
  ('02530000-0000-0000-0000-0000000000c1','02530000-0000-0000-0000-000000000001','VAT Customer','Client');
insert into projects (id, org_id, name, status) values
  ('02530000-0000-0000-0000-0000000000b1','02530000-0000-0000-0000-000000000001','Flag project','Leads'),
  ('02530000-0000-0000-0000-0000000000b2','02530000-0000-0000-0000-000000000001','Invoiced project','Leads'),
  ('02530000-0000-0000-0000-0000000000b3','02530000-0000-0000-0000-000000000001','Cancelled-invoice project','Leads'),
  ('02530000-0000-0000-0000-0000000000b4','02530000-0000-0000-0000-000000000001','In-flight project','Leads'),
  ('02530000-0000-0000-0000-0000000000b5','02530000-0000-0000-0000-000000000001','Settled-outbox project','Leads');

-- 1. Default ON for a new project.
select is((select subject_to_vat from public.projects where id = '02530000-0000-0000-0000-0000000000b1'), true,
  'AC-856-8 a new project is subject to VAT by default');

-- 2. Finance can turn it off before the first invoice.
set local role authenticated;
set local request.jwt.claims = '{"sub":"02530000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('02530000-0000-0000-0000-0000000000b1'::uuid, 100, p_tax_treatment => 'exclusive', p_tax_amount => 0, p_subject_to_vat => false) $$,
  'AC-856-9 Finance can change the VAT flag before the first invoice');
reset role;
select is((select subject_to_vat from public.projects where id = '02530000-0000-0000-0000-0000000000b1'), false,
  'AC-856-9 the flag moved');

-- 3. Admin can turn it back on.
set local role authenticated;
set local request.jwt.claims = '{"sub":"02530000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('02530000-0000-0000-0000-0000000000b1'::uuid, 100, p_tax_treatment => 'exclusive', p_tax_amount => 0, p_subject_to_vat => true) $$,
  'AC-856-9 Admin can change the VAT flag before the first invoice');

-- 4. A Project Manager may set the value but not move the flag; leaving it unchanged (null / same) still works.
set local request.jwt.claims = '{"sub":"02530000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ select set_project_contract_value('02530000-0000-0000-0000-0000000000b1'::uuid, 100, p_tax_treatment => 'exclusive', p_tax_amount => 0, p_subject_to_vat => false) $$,
  '42501', 'only Finance or Admin can change whether a project is subject to VAT',
  'AC-856-9 a non-Finance role cannot change the VAT flag');
select lives_ok(
  $$ select set_project_contract_value('02530000-0000-0000-0000-0000000000b1'::uuid, 200, p_tax_treatment => 'exclusive', p_tax_amount => 0) $$,
  'AC-856-9 a non-Finance role can still set the value without touching the flag');

-- 4b. An Executive (who may set the value) is refused the flag too: only Finance/Admin move it.
set local request.jwt.claims = '{"sub":"02530000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok(
  $$ select set_project_contract_value('02530000-0000-0000-0000-0000000000b1'::uuid, 100, p_tax_treatment => 'exclusive', p_tax_amount => 0, p_subject_to_vat => false) $$,
  '42501', 'only Finance or Admin can change whether a project is subject to VAT',
  'AC-856-9 an Executive cannot change the VAT flag');

-- 5. Cross-org Finance is refused.
set local request.jwt.claims = '{"sub":"02530000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok(
  $$ select set_project_contract_value('02530000-0000-0000-0000-0000000000b1'::uuid, 100, p_tax_treatment => 'exclusive', p_tax_amount => 0, p_subject_to_vat => false) $$,
  '42501', 'not authorized',
  'a Finance user of another org cannot change the VAT flag');
reset role;

-- 6. Anon holds no EXECUTE on the setter, and the denial is the privilege check itself (not the function's own no-org branch).
select is(has_function_privilege('anon',
  'public.set_project_contract_value(uuid,numeric,text,numeric,numeric,text,integer,integer,boolean)', 'execute'), false,
  'anon holds no EXECUTE on set_project_contract_value');
set local role anon;
select throws_ok(
  $$ select set_project_contract_value('02530000-0000-0000-0000-0000000000b1'::uuid, 100, p_tax_treatment => 'exclusive', p_tax_amount => 0, p_subject_to_vat => false) $$,
  '42501', 'permission denied for function set_project_contract_value',
  'anon is denied at the privilege check');
reset role;

-- 6b. A signed-in user cannot write the flag directly: the RPC is the only writer (no column UPDATE / INSERT grant).
select is(has_column_privilege('authenticated','public.projects','subject_to_vat','update'), false,
  'AC-856-9 authenticated has no UPDATE privilege on projects.subject_to_vat');
select is(has_column_privilege('authenticated','public.projects','subject_to_vat','insert'), false,
  'AC-856-9 authenticated has no INSERT privilege on projects.subject_to_vat');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02530000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ update public.projects set subject_to_vat = false where id = '02530000-0000-0000-0000-0000000000b1' $$,
  '42501', 'permission denied for table projects',
  'AC-856-9 a Finance user cannot UPDATE projects.subject_to_vat directly');
reset role;

-- 7. Once the project has a sales invoice the flag is locked, for every writer.
insert into sales_invoices (tax_treatment, tax_amount, id, org_id, project_id, customer_id, si_number, invoice_date, amount,
                            erp_outstanding_amount, status, erp_docstatus, author_user_id) values
  ('exclusive', 0, '02530000-0000-0000-0000-0000000000e1','02530000-0000-0000-0000-000000000001',
   '02530000-0000-0000-0000-0000000000b2','02530000-0000-0000-0000-0000000000c1',
   'SI-VAT-001','2026-03-02',500.00,500.00,'Unpaid',1,'02530000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ update public.projects set subject_to_vat = false where id = '02530000-0000-0000-0000-0000000000b2' $$,
  '42501', 'this project VAT setting is locked by its invoice state',
  'AC-856-8 the VAT flag is locked once the project has a sales invoice (direct writer)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02530000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select set_project_contract_value('02530000-0000-0000-0000-0000000000b2'::uuid, 100, p_tax_treatment => 'exclusive', p_tax_amount => 0, p_subject_to_vat => false) $$,
  '42501', 'this project VAT setting is locked by its invoice state',
  'AC-PPNC-007 a live invoice blocks the setter');
reset role;

-- 8. A cancelled invoice still locks it (ERPNext keeps the taxed history).
insert into sales_invoices (tax_treatment, tax_amount, id, org_id, project_id, customer_id, si_number, invoice_date, amount,
                            erp_outstanding_amount, status, erp_docstatus, author_user_id) values
  ('exclusive', 0, '02530000-0000-0000-0000-0000000000e2','02530000-0000-0000-0000-000000000001',
   '02530000-0000-0000-0000-0000000000b3','02530000-0000-0000-0000-0000000000c1',
   'SI-VAT-002','2026-03-02',500.00,0,'Cancelled',2,'02530000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$ update public.projects set subject_to_vat = false where id = '02530000-0000-0000-0000-0000000000b3' $$,
  'AC-PPNC-006 a verifiably cancelled invoice permits a VAT flag change');

-- 9. A sales-invoice create still in flight in the outbox locks it; a terminal one does not.
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload) values
  ('02530000-0000-0000-0000-000000000001','revenue','si-flight','k-flight','erpnext','create','committing',
   '{"erp_doc_kind":"sales-invoice","projectId":"02530000-0000-0000-0000-0000000000b4","vat_flag_at_resolution":true}'),
  ('02530000-0000-0000-0000-000000000001','revenue','si-done','k-done','erpnext','create','confirmed',
   '{"erp_doc_kind":"sales-invoice","projectId":"02530000-0000-0000-0000-0000000000b5"}');
select throws_ok(
  $$ update public.projects set subject_to_vat = false where id = '02530000-0000-0000-0000-0000000000b4' $$,
  '42501', 'this project VAT setting is locked by its invoice state',
  'AC-856-8 an in-flight sales-invoice create locks the VAT flag');
select lives_ok(
  $$ update public.projects set subject_to_vat = false where id = '02530000-0000-0000-0000-0000000000b5' $$,
  'AC-856-8 a terminal (confirmed) outbox row alone does not lock the VAT flag');

select * from finish();
rollback;
