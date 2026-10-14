-- AC-UXT-004 supporting contract: linked-bill presentation receives supplier and project references.
begin;
select plan(4);

insert into organizations(id,name,default_currency,default_timezone) values
 ('92870000-0000-0000-0000-000000000001','Tax context org','IDR','Asia/Jakarta');
insert into auth.users(id,email) values ('92870000-0000-0000-0000-000000000011','tax-context-finance@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('92870000-0000-0000-0000-000000000011','92870000-0000-0000-0000-000000000001','Tax context Finance','tax-context-finance@example.test','Finance','active');
insert into companies(id,org_id,name,type) values
 ('92870000-0000-0000-0000-000000000031','92870000-0000-0000-0000-000000000001','Tax context vendor','Vendor');
insert into projects(id,org_id,name,status,pmo_project_number) values
 ('92870000-0000-0000-0000-000000000041','92870000-0000-0000-0000-000000000001','Tax context project','Leads','PRJ-2871');
insert into procurements(id,org_id,title,status,requested_by_id,vendor_id,project_id) values
 ('92870000-0000-0000-0000-000000000051','92870000-0000-0000-0000-000000000001','Tax context case','Paid','92870000-0000-0000-0000-000000000011','92870000-0000-0000-0000-000000000031','92870000-0000-0000-0000-000000000041');
insert into procurement_invoices(id,org_id,procurement_id,status,invoice_date,amount,currency,tax_treatment,tax_amount,withheld_amount,withheld_pph_type,reference_number,vi_number) values
 ('92870000-0000-0000-0000-000000000061','92870000-0000-0000-0000-000000000001','92870000-0000-0000-0000-000000000051','Paid',current_date,100000,'IDR','exclusive',0,100,'pph23','SUPPLIER-TAX-2871','VI-2609-2871');

set local request.jwt.claims='{"sub":"92870000-0000-0000-0000-000000000011","role":"authenticated"}';
set local role authenticated;
select * from public.record_vendor_withholding_slip(
 '92870000-0000-0000-0000-000000000071','92870000-0000-0000-0000-000000000031','TAX-CONTEXT-2871',current_date,date_trunc('month',current_date)::date,'pph23',1000,100,
 array['92870000-0000-0000-0000-000000000061'::uuid],'{}'
);

select is(public.get_vendor_withholding_slip('92870000-0000-0000-0000-000000000071')->'bills'->0->>'reference_number','SUPPLIER-TAX-2871','AC-UXT-004 exposes supplier invoice reference in the linked-bill envelope');
select is(public.get_vendor_withholding_slip('92870000-0000-0000-0000-000000000071')->'bills'->0->>'project_id','92870000-0000-0000-0000-000000000041','AC-UXT-004 exposes the linked bill project key');
select is(public.get_vendor_withholding_slip('92870000-0000-0000-0000-000000000071')->'bills'->0->>'invoice_id','92870000-0000-0000-0000-000000000061','AC-UXT-004 retains the immutable invoice destination');
select ok(not (public.get_vendor_withholding_slip('92870000-0000-0000-0000-000000000071')->'bills'->0 ? 'slip_number'),'AC-UXT-004 does not expose the slip write payload in bill identity');

select * from finish();
rollback;
