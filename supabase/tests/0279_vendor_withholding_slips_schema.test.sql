-- #911 schema and record contract; every behaviour assertion calls the shipped RPC.
begin;
select plan(10);
insert into organizations(id,name,default_currency) values ('91100000-0000-0000-0000-000000000001','Bupot test','IDR');
insert into auth.users(id,email) values ('91100000-0000-0000-0000-000000000002','bupot-fin@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('91100000-0000-0000-0000-000000000002','91100000-0000-0000-0000-000000000001','Finance','bupot-fin@example.test','Finance','active');
select has_table('public','vendor_withholding_slips','AC-BUPOT-001 header table exists');
select has_table('public','vendor_withholding_slip_bills','AC-BUPOT-002 link table exists');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.vendor_withholding_slips'::regclass),'AC-BUPOT-008 header forces RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.vendor_withholding_slip_bills'::regclass),'AC-BUPOT-008 links force RLS');
select ok(not has_table_privilege('authenticated','public.vendor_withholding_slips','INSERT') and not has_table_privilege('authenticated','public.vendor_withholding_slip_bills','DELETE'),'AC-BUPOT-008 clients cannot write tables');
select ok(has_function_privilege('authenticated','public.record_vendor_withholding_slip(uuid,uuid,text,date,date,text,numeric,numeric,uuid[],uuid[])','EXECUTE'),'AC-BUPOT-008 authenticated writer is executable');
select ok(not has_function_privilege('anon','public.record_vendor_withholding_slip(uuid,uuid,text,date,date,text,numeric,numeric,uuid[],uuid[])','EXECUTE'),'AC-BUPOT-008 anon writer is not executable');
select ok(to_regclass('public.vendor_withholding_slip_bills_active_invoice_uq') is not null,'AC-BUPOT-005 active invoice reservation index exists');
select ok(to_regclass('public.vendor_withholding_slips_number_uq') is not null,'AC-BUPOT-005 normalized number index exists');
select ok((select count(*)=2 from pg_trigger where tgname in ('vendor_withholding_slips_integrity','vendor_withholding_slip_bills_integrity') and not tgisinternal),'AC-BUPOT-002 deferred integrity triggers exist');
select * from finish();
rollback;
