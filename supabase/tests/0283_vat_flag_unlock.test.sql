begin;
select plan(22);

insert into organizations (id, name) values ('02830000-0000-0000-0000-000000000001','VAT unlock org');
insert into auth.users (id, email) values ('02830000-0000-0000-0000-0000000000a1','vat-unlock@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('02830000-0000-0000-0000-0000000000a1','02830000-0000-0000-0000-000000000001','Finance','vat-unlock@example.com','Finance');
insert into companies (id, org_id, name, type) values
  ('02830000-0000-0000-0000-0000000000c1','02830000-0000-0000-0000-000000000001','VAT customer','Client');
insert into projects (id, org_id, name, status) values
  ('02830000-0000-0000-0000-0000000000b1','02830000-0000-0000-0000-000000000001','Empty','Leads'),
  ('02830000-0000-0000-0000-0000000000b2','02830000-0000-0000-0000-000000000001','Cancelled','Leads'),
  ('02830000-0000-0000-0000-0000000000b3','02830000-0000-0000-0000-000000000001','Live','Leads'),
  ('02830000-0000-0000-0000-0000000000b4','02830000-0000-0000-0000-000000000001','Native lifecycle','Leads');
update projects set currency='IDR',tax_treatment='exclusive',tax_amount=0,tax_rate=12,
 tax_base_numerator=11,tax_base_denominator=12 where id='02830000-0000-0000-0000-0000000000b4';
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

-- AC-PPNC-012: native invoices use the current flag and never rewrite cancelled tax facts.
select lives_ok($$ select create_native_sales_invoice('02830000-0000-0000-0000-0000000000b4',
 '02830000-0000-0000-0000-0000000000c1','[{"item_code":"SVC","description":"Taxed before unlock","qty":1,"rate":100}]'::jsonb) $$,
 'AC-PPNC-012 initial native invoice is created with VAT on');
select is((select row(tax_amount,amount,tax_rate,tax_base_numerator,tax_base_denominator,tax_treatment)::text
 from sales_invoices where native_lines @> '[{"description":"Taxed before unlock"}]'),
 row(11.00::numeric,100.00::numeric,12.000::numeric,11,12,'exclusive')::text,
 'AC-PPNC-012 native invoice records tax at 12% of 11/12 base');
select lives_ok($$ select transition_native_sales_invoice((select id from sales_invoices where native_lines @> '[{"description":"Taxed before unlock"}]'),'Cancelled') $$,
 'AC-PPNC-012 original native invoice cancels');
select lives_ok($$ select set_project_contract_value('02830000-0000-0000-0000-0000000000b4'::uuid,100,
 p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>false) $$,
 'AC-PPNC-012 cancelled native invoice permits flag off');
select is((select row(status,tax_amount,amount,tax_rate,tax_base_numerator,tax_base_denominator,tax_treatment)::text
 from sales_invoices where native_lines @> '[{"description":"Taxed before unlock"}]'),
 row('Cancelled',11.00::numeric,100.00::numeric,12.000::numeric,11,12,'exclusive')::text,
 'AC-PPNC-012 cancelled invoice tax/amount/rate/base/treatment remain byte-identical');
select lives_ok($$ select create_native_sales_invoice('02830000-0000-0000-0000-0000000000b4',
 '02830000-0000-0000-0000-0000000000c1','[{"item_code":"SVC","description":"Untaxed after unlock","qty":1,"rate":100}]'::jsonb) $$,
 'AC-PPNC-012 native invoice after flag-off is created');
select is((select row(status,tax_amount,amount,tax_rate,tax_base_numerator,tax_base_denominator)::text
 from sales_invoices where native_lines @> '[{"description":"Untaxed after unlock"}]'),
 row('Draft',0.00::numeric,100.00::numeric,0.000::numeric,1,1)::text,
 'AC-PPNC-012 next native invoice is untaxed with retained rate basis');
select throws_ok($$ select set_project_contract_value('02830000-0000-0000-0000-0000000000b4'::uuid,100,
 p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>true) $$,
 '42501','this project VAT setting is locked by its invoice state',
 'AC-PPNC-012 live native draft relocks the VAT flag');
select lives_ok($$ select transition_native_sales_invoice((select id from sales_invoices where native_lines @> '[{"description":"Untaxed after unlock"}]'),'Cancelled') $$,
 'AC-PPNC-012 cancel native draft to unlock next VAT change');
select lives_ok($$ select set_project_contract_value('02830000-0000-0000-0000-0000000000b4'::uuid,100,
 p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>true) $$,
 'AC-PPNC-012 all native invoices cancelled permits flag on');
select lives_ok($$ select create_native_sales_invoice('02830000-0000-0000-0000-0000000000b4',
 '02830000-0000-0000-0000-0000000000c1','[{"item_code":"SVC","description":"Taxed after re-enable","qty":1,"rate":200}]'::jsonb) $$,
 'AC-PPNC-012 next native invoice after flag-on is created');
select is((select row(status,tax_amount,amount,tax_rate,tax_base_numerator,tax_base_denominator)::text
 from sales_invoices where native_lines @> '[{"description":"Taxed after re-enable"}]'),
 row('Draft',22.00::numeric,200.00::numeric,12.000::numeric,11,12)::text,
 'AC-PPNC-012 next native invoice uses recorded rate and base');
reset role;
select is(has_function_privilege('anon','public.get_project_vat_editability(uuid)','execute'),false,
  'AC-PPNC-019 anonymous users cannot call the scoped reader');
-- Claims share their invoice UUID; both families must participate in the lock.
insert into projects(id,org_id,name,status)
select ('02830000-0000-0000-0000-0000000000b'||n)::uuid,
 '02830000-0000-0000-0000-000000000001','Claim family '||n,'Leads'
from generate_series(5,6) n;
insert into progress_claims(id,org_id,project_id,kind,currency,gross_amount,
 down_payment_amount,recovery_pct,dp_item_code,created_by) values
 ('02830000-0000-0000-0000-0000000000e5','02830000-0000-0000-0000-000000000001',
 '02830000-0000-0000-0000-0000000000b5','progress','IDR',100,null,null,null,'02830000-0000-0000-0000-0000000000a1'),
 ('02830000-0000-0000-0000-0000000000e6','02830000-0000-0000-0000-000000000001',
 '02830000-0000-0000-0000-0000000000b6','down_payment','IDR',100,100,10,'DP','02830000-0000-0000-0000-0000000000a1');
insert into sales_invoices(id,org_id,project_id,si_number,invoice_date,amount,
 erp_outstanding_amount,status,erp_docstatus,tax_treatment,tax_amount)
select id,org_id,project_id,'SI-FAMILY-'||kind,'2026-10-01',100,100,'Unpaid',1,'exclusive',0
from progress_claims where id in ('02830000-0000-0000-0000-0000000000e5','02830000-0000-0000-0000-0000000000e6');
set local role authenticated;
set local request.jwt.claims='{"sub":"02830000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select set_project_contract_value('02830000-0000-0000-0000-0000000000b5',100,
 p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>false) $$,
 '42501','this project VAT setting is locked by its invoice state','AC-PPNC-007 live progress invoice blocks');
select throws_ok($$ select set_project_contract_value('02830000-0000-0000-0000-0000000000b6',100,
 p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>false) $$,
 '42501','this project VAT setting is locked by its invoice state','AC-PPNC-007 live down-payment invoice blocks');
reset role;
select * from finish();
rollback;
