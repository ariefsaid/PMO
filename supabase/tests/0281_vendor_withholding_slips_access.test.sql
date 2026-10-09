-- Server role checks use the shipped SECURITY DEFINER RPCs, not cloned predicates.
begin;
select plan(6);
insert into organizations(id,name,default_currency) values ('91100000-0000-0000-0000-000000000011','Bupot access','IDR');
insert into auth.users(id,email) values ('91100000-0000-0000-0000-000000000012','bupot-engineer@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('91100000-0000-0000-0000-000000000012','91100000-0000-0000-0000-000000000011','Engineer','bupot-engineer@example.test','Engineer','active');
set local request.jwt.claims='{"sub":"91100000-0000-0000-0000-000000000012","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select * from public.record_vendor_withholding_slip('91100000-0000-0000-0000-000000000013','91100000-0000-0000-0000-000000000014','x','2026-01-01','2026-01-01','pph23',1,1,array['91100000-0000-0000-0000-000000000015'::uuid],'{}')$$,'42501',null,'AC-BUPOT-008 Engineer cannot record (role checked before target lookup)');
select throws_ok($$select * from public.correct_vendor_withholding_slip('91100000-0000-0000-0000-000000000013',1,'x','2026-01-01','2026-01-01','reason')$$,'42501',null,'AC-BUPOT-008 Engineer cannot correct');
select throws_ok($$select * from public.void_vendor_withholding_slip('91100000-0000-0000-0000-000000000013',1,'reason')$$,'42501',null,'AC-BUPOT-008 Engineer cannot void');
reset role;
select ok(not has_table_privilege('authenticated','public.vendor_withholding_slips','INSERT,UPDATE,DELETE') and not has_table_privilege('anon','public.vendor_withholding_slip_bills','INSERT,UPDATE,DELETE'),'AC-BUPOT-008 no direct client DML path');
select ok(not has_function_privilege('anon','public.correct_vendor_withholding_slip(uuid,integer,text,date,date,text)','EXECUTE') and not has_function_privilege('service_role','public.void_vendor_withholding_slip(uuid,integer,text)','EXECUTE'),'AC-BUPOT-008 writer EXECUTE is limited to authenticated');
select ok(not has_column_privilege('authenticated','public.vendor_withholding_slips','create_payload','SELECT'),'AC-BUPOT-008 original idempotency payload is not client-readable');
select * from finish(); rollback;
