begin;
create extension if not exists pgtap;
select plan(8);

insert into public.organizations (id,name) values ('02910000-0000-0000-0000-000000000001','Contract comparison test');
insert into auth.users (id,email) values ('02910000-0000-0000-0000-0000000000a1','contract-reader@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('02910000-0000-0000-0000-0000000000a1','02910000-0000-0000-0000-000000000001','Finance','contract-reader@example.test','Finance','active');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref) values
 ('02910000-0000-0000-0000-0000000000d1','02910000-0000-0000-0000-000000000001','Exclusive','Ongoing Project','IDR',10000,'exclusive',0,0,1,1,false,'RET-EX'),
 ('02910000-0000-0000-0000-0000000000d2','02910000-0000-0000-0000-000000000001','Inclusive','Ongoing Project','IDR',1100,'inclusive',0,0,1,1,false,'RET-IN'),
 ('02910000-0000-0000-0000-0000000000d3','02910000-0000-0000-0000-000000000001','Foreign','Ongoing Project','IDR',10000,'exclusive',0,0,1,1,false,'RET-FX'),
 ('02910000-0000-0000-0000-0000000000d4','02910000-0000-0000-0000-000000000001','Missing amount','Ongoing Project','IDR',10000,'exclusive',0,0,1,1,false,'RET-NULL');
set local request.jwt.claims='{}';
set local role service_role;
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,tax_treatment,tax_amount,currency,status,erp_docstatus) values
 ('02910000-0000-0000-0000-0000000000e1','02910000-0000-0000-0000-000000000001','02910000-0000-0000-0000-0000000000d1','RET-1','2026-01-01',2200,'inclusive',200,'IDR','Submitted',1),
 ('02910000-0000-0000-0000-0000000000e2','02910000-0000-0000-0000-000000000001','02910000-0000-0000-0000-0000000000d1','RET-2','2026-01-01',900,'exclusive',0,'IDR','Unpaid',1),
 ('02910000-0000-0000-0000-0000000000e3','02910000-0000-0000-0000-000000000001','02910000-0000-0000-0000-0000000000d1','RET-3','2026-01-01',7000,'exclusive',0,'IDR','Draft',0),
 ('02910000-0000-0000-0000-0000000000e4','02910000-0000-0000-0000-000000000001','02910000-0000-0000-0000-0000000000d1','RET-4','2026-01-01',8000,'exclusive',0,'IDR','Cancelled',2),
 ('02910000-0000-0000-0000-0000000000e5','02910000-0000-0000-0000-000000000001','02910000-0000-0000-0000-0000000000d2','RET-5','2026-01-01',1000,'exclusive',100,'IDR','Paid',1),
 ('02910000-0000-0000-0000-0000000000e6','02910000-0000-0000-0000-000000000001','02910000-0000-0000-0000-0000000000d3','RET-6','2026-01-01',1000,'exclusive',0,'USD','Paid',1),
 ('02910000-0000-0000-0000-0000000000e7','02910000-0000-0000-0000-000000000001','02910000-0000-0000-0000-0000000000d4','RET-7','2026-01-01',null,'inclusive',0,'IDR','Paid',1);
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"02910000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.get_project_finances('02910000-0000-0000-0000-0000000000d1')->>'contract_invoiced')::numeric,2900::numeric,'AC-UNB-001 inclusive and exclusive submitted invoices normalize to the exclusive contract, excluding Draft and Cancelled');
select is((public.get_project_finances('02910000-0000-0000-0000-0000000000d1')->>'remaining_to_invoice')::numeric,7100::numeric,'AC-UNB-001 remaining on the exclusive contract basis');
select is((public.get_project_finances('02910000-0000-0000-0000-0000000000d2')->>'contract_invoiced')::numeric,1100::numeric,'AC-UNB-003 exclusive invoice normalizes to the inclusive ceiling');
select is((public.get_project_finances('02910000-0000-0000-0000-0000000000d2')->>'remaining_to_invoice')::numeric,0::numeric,'AC-UNB-003 inclusive ceiling has zero remaining');
select is(public.get_project_finances('02910000-0000-0000-0000-0000000000d3')->>'contract_invoiced',null,'AC-UNB-003 foreign invoice leaves contract invoiced unavailable');
select is(public.get_project_finances('02910000-0000-0000-0000-0000000000d3')->>'remaining_to_invoice',null,'AC-UNB-003 foreign invoice leaves remaining unavailable');
select is(public.get_project_finances('02910000-0000-0000-0000-0000000000d4')->>'contract_invoiced',null,'AC-UNB-003 missing invoice amount leaves contract invoiced unavailable');
select is(public.get_project_finances('02910000-0000-0000-0000-0000000000d4')->>'remaining_to_invoice',null,'AC-UNB-003 missing invoice amount leaves remaining unavailable');
select * from finish();
rollback;
