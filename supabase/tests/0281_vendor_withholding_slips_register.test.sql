-- Read seams expose bounded, caller-RLS register grains and reject malformed cursors.
begin;
select plan(10);
select has_view('public','vendor_withholding_slip_register','AC-BUPOT-012 slip register view exists');
select has_view('public','vendor_withholding_bill_register','AC-BUPOT-012 bill register view exists');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.vendor_withholding_slip_register'::regclass),
  'AC-BUPOT-012 slip register is security invoker');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.vendor_withholding_bill_register'::regclass),
  'AC-BUPOT-012 bill register is security invoker');
select has_function('public','list_vendor_withholding_slips',array['uuid','date','uuid','date','uuid','integer'],'AC-BUPOT-012 header keyset reader exists');
select has_function('public','list_vendor_withholding_bills',array['uuid','text','text','uuid[]','boolean','date','uuid','boolean','integer'],'AC-BUPOT-012 bill keyset reader exists');
select has_function('public','get_vendor_withholding_slip',array['uuid'],'AC-BUPOT-012 detail reader exists');
select throws_ok($$select * from public.list_vendor_withholding_slips(null,null,null,'2026-01-01',null,50)$$,'22023',null,
  'AC-BUPOT-012 header reader rejects a partial cursor');
select throws_ok($$select * from public.list_vendor_withholding_bills(null,null,null,null,false,null,'91100000-0000-0000-0000-000000000001',false,50)$$,'22023',null,
  'AC-BUPOT-012 bill reader rejects a missing date cursor component');
select ok(not has_function_privilege('anon','public.list_vendor_withholding_slips(uuid,date,uuid,date,uuid,integer)','EXECUTE')
       and has_function_privilege('authenticated','public.list_vendor_withholding_slips(uuid,date,uuid,date,uuid,integer)','EXECUTE'),
  'AC-BUPOT-008 header list is authenticated and not anonymous');
select * from finish();
rollback;
