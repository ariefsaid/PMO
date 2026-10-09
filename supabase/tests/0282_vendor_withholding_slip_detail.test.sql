-- AC-BUPOT-020: assert values returned by the shipped SECURITY INVOKER detail RPC.
begin;
select plan(8);
insert into organizations(id,name,default_currency) values ('91128000-0000-0000-0000-000000000001','Slip detail test','IDR');
insert into auth.users(id,email) values ('91128000-0000-0000-0000-000000000002','slip-detail-finance@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('91128000-0000-0000-0000-000000000002','91128000-0000-0000-0000-000000000001','Finance','slip-detail-finance@example.test','Finance','active');
insert into companies(id,org_id,name,type) values ('91128000-0000-0000-0000-000000000003','91128000-0000-0000-0000-000000000001','Slip detail vendor','Vendor');
insert into procurements(id,org_id,title,status,vendor_id) values
 ('91128000-0000-0000-0000-000000000004','91128000-0000-0000-0000-000000000001','Slip detail case','Received','91128000-0000-0000-0000-000000000003');
set local request.jwt.claims='{"sub":"91128000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.create_procurement_invoice('91128000-0000-0000-0000-000000000004','Received',current_date,'SLIP-DETAIL-BILL',100000,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_withheld_amount=>20000,p_withheld_pph_type=>'pph23')$$,
 'AC-BUPOT-020 creates fixture bill through the shipped RPC');
select lives_ok($$select * from public.record_vendor_withholding_slip(
 '91128000-0000-0000-0000-000000000005','91128000-0000-0000-0000-000000000003','SLIP-DETAIL',current_date,date_trunc('month',current_date)::date,'pph23',100000,20000,
 array[(select id from public.procurement_invoices where reference_number='SLIP-DETAIL-BILL')],'{}')$$,
 'AC-BUPOT-020 records the fixture slip through the shipped RPC');
select lives_ok($$select * from public.void_vendor_withholding_slip('91128000-0000-0000-0000-000000000005',1,'Retained test reason')$$,
 'AC-BUPOT-020 stores the void reason through the shipped RPC');
select is(public.get_vendor_withholding_slip('91128000-0000-0000-0000-000000000005')->'header'->>'void_reason','Retained test reason',
 'AC-BUPOT-020 detail response returns the retained void reason');
select is(public.get_vendor_withholding_slip('91128000-0000-0000-0000-000000000005')->'bills'->0->>'withheld_at_record','20000.00',
 'AC-BUPOT-020 detail response returns the bill recorded amount');
select is(public.get_vendor_withholding_slip('91128000-0000-0000-0000-000000000005')->'bills'->0->>'withheld_current','20000.00',
 'AC-BUPOT-018 detail response returns the current source amount');
select is(public.get_vendor_withholding_slip('91128000-0000-0000-0000-000000000005')->'bills'->0->>'difference','0.00',
 'AC-BUPOT-018 detail response returns the exact source difference');
select is(public.get_vendor_withholding_slip('91128000-0000-0000-0000-000000000005')->'bills'->0->>'coverage_state','not-recorded',
 'AC-BUPOT-018 detail response returns the current coverage state');
reset role;
select * from finish();
rollback;
