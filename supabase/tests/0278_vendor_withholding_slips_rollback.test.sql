-- The rollback is exercised transactionally against the local schema; rollback restores 0278 afterward.
begin;
select plan(4);
\ir ../migrations/rollback/0278_vendor_withholding_slips_down.sql
select ok(to_regclass('public.vendor_withholding_slips') is null and to_regclass('public.vendor_withholding_slip_bills') is null,'rollback removes only the feature tables');
select ok(to_regprocedure('public.record_vendor_withholding_slip(uuid,uuid,text,date,date,text,numeric,numeric,uuid[],uuid[])') is null,'rollback removes the three writer RPCs');
select ok((select count(*)=12 from public.record_history_config),'rollback restores the prior history catalog');
select ok(has_function_privilege('authenticated','public.set_procurement_invoice_efaktur(uuid,text,date)','EXECUTE'),'rollback leaves the incumbent e-Faktur writer grant intact');
select * from finish();
rollback;
