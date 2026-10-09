begin;
select plan(8);

insert into organizations (id, name) values ('02830000-0000-0000-0000-000000000001','VAT unlock org');
insert into auth.users (id, email) values ('02830000-0000-0000-0000-0000000000a1','vat-unlock@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('02830000-0000-0000-0000-0000000000a1','02830000-0000-0000-0000-000000000001','Finance','vat-unlock@example.com','Finance');
insert into companies (id, org_id, name, type) values
  ('02830000-0000-0000-0000-0000000000c1','02830000-0000-0000-0000-000000000001','VAT customer','Client');
insert into projects (id, org_id, name, status) values
  ('02830000-0000-0000-0000-0000000000b1','02830000-0000-0000-0000-000000000001','Empty','Leads'),
  ('02830000-0000-0000-0000-0000000000b2','02830000-0000-0000-0000-000000000001','Cancelled','Leads'),
  ('02830000-0000-0000-0000-0000000000b3','02830000-0000-0000-0000-000000000001','Live','Leads');
insert into sales_invoices (tax_treatment, tax_amount, id, org_id, project_id, customer_id, si_number, invoice_date, amount,
                            erp_outstanding_amount, status, erp_docstatus, author_user_id) values
  ('exclusive', 50, '02830000-0000-0000-0000-0000000000e1','02830000-0000-0000-0000-000000000001',
   '02830000-0000-0000-0000-0000000000b2','02830000-0000-0000-0000-0000000000c1','SI-CANCELLED','2026-03-02',550,0,'Cancelled',2,'02830000-0000-0000-0000-0000000000a1'),
  ('exclusive', 50, '02830000-0000-0000-0000-0000000000e2','02830000-0000-0000-0000-000000000001',
   '02830000-0000-0000-0000-0000000000b3','02830000-0000-0000-0000-0000000000c1','SI-LIVE','2026-03-02',550,550,'Unpaid',1,'02830000-0000-0000-0000-0000000000a1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02830000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select set_project_contract_value('02830000-0000-0000-0000-0000000000b1'::uuid,100,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>false) $$,
  'AC-PPNC-006 an empty project may change its VAT flag');
select lives_ok($$ select set_project_contract_value('02830000-0000-0000-0000-0000000000b2'::uuid,100,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>false) $$,
  'AC-PPNC-006 cancelled invoices permit a VAT change');
select throws_ok($$ select set_project_contract_value('02830000-0000-0000-0000-0000000000b3'::uuid,100,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>false) $$,
  '42501', 'this project VAT setting is locked by its invoice state',
  'AC-PPNC-007 a live invoice blocks a VAT change');
select is((select subject_to_vat from projects where id='02830000-0000-0000-0000-0000000000b2'),false,
  'AC-PPNC-006 the setter changes only the flag on a cancelled project');
select is((select tax_amount from sales_invoices where id='02830000-0000-0000-0000-0000000000e1'),50::numeric,
  'AC-PPNC-012 cancelled invoice tax facts remain unchanged');
select is((select (get_project_vat_editability('02830000-0000-0000-0000-0000000000b2')->>'eligible')::boolean),true,
  'AC-PPNC-019 scoped reader reports eligible after cancellation');
select is((select get_project_vat_editability('02830000-0000-0000-0000-0000000000b2')->>'hasInvoices'), 'true',
  'AC-PPNC-019 scoped reader reports invoice presence without invoice details');
reset role;
select is(has_function_privilege('anon','public.get_project_vat_editability(uuid)','execute'),false,
  'AC-PPNC-019 anonymous users cannot call the scoped reader');
select * from finish();
rollback;
