-- AC-BUPOT-002/005/006/007: exercise the shipped record/correct/void RPCs end-to-end.
begin;
select plan(20);
insert into organizations(id,name,default_currency) values ('91110000-0000-0000-0000-000000000001','Bupot lifecycle','IDR');
insert into auth.users(id,email) values ('91110000-0000-0000-0000-000000000002','lifecycle-finance@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('91110000-0000-0000-0000-000000000002','91110000-0000-0000-0000-000000000001','Finance','lifecycle-finance@example.test','Finance','active');
insert into companies(id,org_id,name,type) values ('91110000-0000-0000-0000-000000000003','91110000-0000-0000-0000-000000000001','Lifecycle vendor','Vendor');
insert into procurements(id,org_id,title,status,vendor_id) values
 ('91110000-0000-0000-0000-000000000004','91110000-0000-0000-0000-000000000001','Lifecycle case A','Received','91110000-0000-0000-0000-000000000003'),
 ('91110000-0000-0000-0000-000000000005','91110000-0000-0000-0000-000000000001','Lifecycle case B','Received','91110000-0000-0000-0000-000000000003');
set local request.jwt.claims='{"sub":"91110000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.create_procurement_invoice('91110000-0000-0000-0000-000000000004','Received',current_date,'BUPOT-LIFE-A',100000,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_withheld_amount=>20000,p_withheld_pph_type=>'pph23')$$,
 'AC-BUPOT-002 Finance creates first synthetic bill');
select lives_ok($$select public.create_procurement_invoice('91110000-0000-0000-0000-000000000005','Received',current_date,'BUPOT-LIFE-B',100000,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_withheld_amount=>30000,p_withheld_pph_type=>'pph23')$$,
 'AC-BUPOT-002 Finance creates second bill in another case');
select throws_ok($$select * from public.record_vendor_withholding_slip(
 '91110000-0000-0000-0000-000000000006','91110000-0000-0000-0000-000000000003','LIFE-001',current_date,date_trunc('month',current_date)::date,'pph23',60000,49999.99,
 array[(select id from public.procurement_invoices where reference_number='BUPOT-LIFE-A'),(select id from public.procurement_invoices where reference_number='BUPOT-LIFE-B')],'{}')$$,
 '23514','23514','AC-BUPOT-003 a one-cent-low slip is rejected');
select throws_ok($$select * from public.record_vendor_withholding_slip(
 '91110000-0000-0000-0000-000000000006','91110000-0000-0000-0000-000000000003','LIFE-001',current_date,date_trunc('month',current_date)::date,'pph23',60000,50000.01,
 array[(select id from public.procurement_invoices where reference_number='BUPOT-LIFE-A'),(select id from public.procurement_invoices where reference_number='BUPOT-LIFE-B')],'{}')$$,
 '23514','23514','AC-BUPOT-003 a one-cent-high slip is rejected');
select is((select count(*)::int from public.vendor_withholding_slips where id='91110000-0000-0000-0000-000000000006'),0,
 'AC-BUPOT-003 failed sum checks leave no header');
select lives_ok($$select * from public.record_vendor_withholding_slip(
 '91110000-0000-0000-0000-000000000006','91110000-0000-0000-0000-000000000003',' LIFE-001 ',current_date,date_trunc('month',current_date)::date,'pph23',60000,50000,
 array[(select id from public.procurement_invoices where reference_number='BUPOT-LIFE-A'),(select id from public.procurement_invoices where reference_number='BUPOT-LIFE-B')],'{}')$$,
 'AC-BUPOT-002 one slip records exact cross-case amount');
reset role;
select is((select count(*)::int from public.vendor_withholding_slip_bills where slip_id='91110000-0000-0000-0000-000000000006'),2,
 'AC-BUPOT-002 both invoice snapshots are retained');
select is((select sum(withheld_at_record) from public.vendor_withholding_slip_bills where slip_id='91110000-0000-0000-0000-000000000006'),50000::numeric,
 'AC-BUPOT-002 snapshot sum equals the recorded slip');
select is((select slip_number from public.vendor_withholding_slips where id='91110000-0000-0000-0000-000000000006'),'LIFE-001',
 'AC-BUPOT-001 issued number is trimmed and retained');
select is((select count(*)::int from public.record_changes where entity_id='91110000-0000-0000-0000-000000000006' and entity_type='vendor_withholding_slip'),1,
 'AC-BUPOT-011 record history attributes the created header');
select is((select count(*)::int from public.audit_events where entity_id='91110000-0000-0000-0000-000000000006' and action='vendor_withholding_slip.record'),1,
 'AC-BUPOT-011 recording creates one audit event');
drop policy vendor_withholding_slips_select on public.vendor_withholding_slips;
set local request.jwt.claims='{"sub":"91110000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select bool_and(coverage_state='unavailable') from public.list_vendor_withholding_bills(
 null,null,null,array[(select id from public.procurement_invoices where reference_number='BUPOT-LIFE-A'),(select id from public.procurement_invoices where reference_number='BUPOT-LIFE-B')],false,null,null,false,50)),true,
 'AC-BUPOT-010 a source-visible reservation with a hidden header is unavailable');
select is((select count(*)::int from public.list_vendor_withholding_bills('91110000-0000-0000-0000-000000000003','pph23',null,null,true,null,null,false,50)),0,
 'AC-BUPOT-010 a hidden-header reservation is not offered as a candidate');
reset role;
create policy vendor_withholding_slips_select on public.vendor_withholding_slips for select to authenticated using
 (vendor_withholding_slips.org_id=public.auth_org_id() and public.is_active_member() and exists(select 1 from public.companies c where c.id=vendor_withholding_slips.vendor_id and c.org_id=vendor_withholding_slips.org_id));
set local request.jwt.claims='{"sub":"91110000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select revision from public.correct_vendor_withholding_slip('91110000-0000-0000-0000-000000000006',1,'LIFE-002',current_date,date_trunc('month',current_date)::date,'corrected issued number')),2,
 'AC-BUPOT-006 metadata correction advances the revision');
select is((select revision from public.correct_vendor_withholding_slip('91110000-0000-0000-0000-000000000006',2,'LIFE-002',current_date,date_trunc('month',current_date)::date,'no-op reason')),2,
 'AC-BUPOT-006 identical metadata correction is a no-op');
select is((select revision from public.void_vendor_withholding_slip('91110000-0000-0000-0000-000000000006',2,'PMO evidence void')),3,
 'AC-BUPOT-007 void advances revision');
select is((select revision from public.void_vendor_withholding_slip('91110000-0000-0000-0000-000000000006',2,'PMO evidence void')),3,
 'AC-BUPOT-007 same actor/reason retry is idempotent');
select is((select revision from public.record_vendor_withholding_slip(
 '91110000-0000-0000-0000-000000000006','91110000-0000-0000-0000-000000000003',' LIFE-001 ',current_date,date_trunc('month',current_date)::date,'pph23',60000,50000,
 array[(select id from public.procurement_invoices where reference_number='BUPOT-LIFE-A'),(select id from public.procurement_invoices where reference_number='BUPOT-LIFE-B')],'{}')),3,
 'AC-BUPOT-005 original record retry returns its revision after correction and void');
select throws_ok($$select * from public.record_vendor_withholding_slip(
 '91110000-0000-0000-0000-000000000006','91110000-0000-0000-0000-000000000003','LIFE-OTHER',current_date,date_trunc('month',current_date)::date,'pph23',60000,50000,
 array[(select id from public.procurement_invoices where reference_number='BUPOT-LIFE-A'),(select id from public.procurement_invoices where reference_number='BUPOT-LIFE-B')],'{}')$$,
 '23505','23505','AC-BUPOT-005 reused intent with different facts is refused');
reset role;
select is((select count(*)::int from public.vendor_withholding_slip_bills where slip_id='91110000-0000-0000-0000-000000000006' and released_at is not null),2,
 'AC-BUPOT-007 void releases all retained links atomically');
select * from finish();
rollback;
