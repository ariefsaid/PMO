\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap;
select plan(32);
-- These references are exact function definitions from origin/dev, created with current
-- default ACL and the explicit origin/dev grants. This is not a deployed predecessor snapshot.
-- @REFS@

create temporary table f2_forward as
select proname, pg_get_functiondef(p.oid) body, proowner, proconfig, proacl, prosecdef, provolatile, proparallel, prorettype, proargtypes, pronargdefaults
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname in ('undo_captured_purchase','unlink_erp_purchase_document',
'purchase_capture_source_page','purchase_capture_ledger_page','purchase_capture_feed_health','capture_source_kind','capture_source_evidence',
'capture_history_apply','capture_history_apply_internal','capture_history_batch',
'record_capture_feed_start','record_capture_feed_completion','fence_capture_source_change');
-- @DOWN@

select is((select array_agg(x::text order by x::text) from pg_proc p cross join lateral unnest(p.proacl) x where p.oid='public.undo_captured_purchase(uuid,text,boolean)'::regprocedure), (select array_agg(x::text order by x::text) from pg_proc p cross join lateral unnest(p.proacl) x where p.oid='public.p0_proof_undo_reference(uuid,text,boolean)'::regprocedure), 'predecessor undo ACL restored');
select is((select array_agg(x::text order by x::text) from pg_proc p cross join lateral unnest(p.proacl) x where p.oid='public.unlink_erp_purchase_document(uuid)'::regprocedure), (select array_agg(x::text order by x::text) from pg_proc p cross join lateral unnest(p.proacl) x where p.oid='public.p0_proof_unlink_reference(uuid)'::regprocedure), 'predecessor unlink ACL restored');
select is((select replace(pg_get_functiondef(oid),'undo_captured_purchase','p0_proof_undo_reference') from pg_proc where oid='public.undo_captured_purchase(uuid,text,boolean)'::regprocedure),pg_get_functiondef('public.p0_proof_undo_reference(uuid,text,boolean)'::regprocedure),'predecessor undo body restored');
select is((select replace(pg_get_functiondef(oid),'unlink_erp_purchase_document','p0_proof_unlink_reference') from pg_proc where oid='public.unlink_erp_purchase_document(uuid)'::regprocedure),pg_get_functiondef('public.p0_proof_unlink_reference(uuid)'::regprocedure),'predecessor unlink body restored');
select ok((select (a.proowner,a.proconfig,a.prosecdef,a.provolatile,a.proparallel,a.prorettype,a.proargtypes,a.pronargdefaults) is not distinct from (b.proowner,b.proconfig,b.prosecdef,b.provolatile,b.proparallel,b.prorettype,b.proargtypes,b.pronargdefaults) from pg_proc a,pg_proc b where a.oid='public.undo_captured_purchase(uuid,text,boolean)'::regprocedure and b.oid='public.p0_proof_undo_reference(uuid,text,boolean)'::regprocedure),'predecessor undo owner and catalog properties match source reference');
select ok((select (a.proowner,a.proconfig,a.prosecdef,a.provolatile,a.proparallel,a.prorettype,a.proargtypes,a.pronargdefaults) is not distinct from (b.proowner,b.proconfig,b.prosecdef,b.provolatile,b.proparallel,b.prorettype,b.proargtypes,b.pronargdefaults) from pg_proc a,pg_proc b where a.oid='public.unlink_erp_purchase_document(uuid)'::regprocedure and b.oid='public.p0_proof_unlink_reference(uuid)'::regprocedure),'predecessor unlink owner and catalog properties match source reference');
-- Establish independently reconstructed predecessor ACL before the round trip.
grant execute on function public.undo_captured_purchase(uuid,text,boolean), public.unlink_erp_purchase_document(uuid) to service_role;
create temporary table f2_predecessor as
select proname, pg_get_functiondef(p.oid) body, p.oid, proowner, proconfig, proacl, prosecdef, provolatile, proparallel, prorettype, proargtypes, pronargdefaults
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname in ('undo_captured_purchase','unlink_erp_purchase_document');
select ok((select bool_and(has_function_privilege('authenticated',oid,'execute') and has_function_privilege('service_role',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not exists(select 1 from aclexplode(proacl) a where a.grantee=0 and a.privilege_type='EXECUTE')) from f2_predecessor),'predecessor effective grants');
-- @UP@

select is((select count(*)::int from f2_forward b join pg_proc p on p.proname=b.proname join pg_namespace n on n.oid=p.pronamespace and n.nspname='public' where (b.body,b.proowner,b.proconfig,b.proacl,b.prosecdef,b.provolatile,b.proparallel,b.prorettype,b.proargtypes,b.pronargdefaults) is not distinct from (pg_get_functiondef(p.oid),p.proowner,p.proconfig,p.proacl,p.prosecdef,p.provolatile,p.proparallel,p.prorettype,p.proargtypes,p.pronargdefaults)),13,'forward function catalog round trip');
create function pg_temp.test_down() returns text language plpgsql as $func$
begin
  execute $f2down$-- @DOWN@
$f2down$;
  raise exception 'rollback successful probe' using errcode='ZX001';
exception when sqlstate 'ZX001' then return 'allowed';
  when others then return sqlstate||':'||sqlerrm;
end $func$;
select is(pg_temp.test_down(),'allowed','empty history permits full down');
insert into organizations(id,name,default_currency) values ('f2f30000-0000-0000-0000-000000000001','Proof','USD');
insert into auth.users(id,email) values ('f2f30000-0000-0000-0000-000000000002','rollback-proof@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('f2f30000-0000-0000-0000-000000000002','f2f30000-0000-0000-0000-000000000001','Proof','rollback-proof@example.test','Admin','active');
insert into projects(id,org_id,name,status) values ('f2f30000-0000-0000-0000-000000000003','f2f30000-0000-0000-0000-000000000001','Proof','Ongoing Project');
insert into companies(id,org_id,name,type) values ('f2f30000-0000-0000-0000-000000000004','f2f30000-0000-0000-0000-000000000001','Proof','Vendor');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('f2f30000-0000-0000-0000-000000000005','f2f30000-0000-0000-0000-000000000001','erpnext','https://example.test','test','{}',now(),'active');
insert into procurements(id,org_id,title,requested_by_id,project_id,vendor_id,currency,total_value,status) values ('f2f30000-0000-0000-0000-000000000006','f2f30000-0000-0000-0000-000000000001','Proof','f2f30000-0000-0000-0000-000000000002','f2f30000-0000-0000-0000-000000000003','f2f30000-0000-0000-0000-000000000004','USD',1,'Draft');
insert into procurements(id,org_id,title,requested_by_id,project_id,vendor_id,currency,total_value,status,record_only) values ('f2f30000-0000-0000-0000-000000000009','f2f30000-0000-0000-0000-000000000001','Journal proof','f2f30000-0000-0000-0000-000000000002','f2f30000-0000-0000-0000-000000000003','f2f30000-0000-0000-0000-000000000004','USD',1,'Draft',true);
insert into erp_purchase_captures(procurement_id,org_id,binding_id,request_id,payload,kind,stage,captured_by) values ('f2f30000-0000-0000-0000-000000000009','f2f30000-0000-0000-0000-000000000001','f2f30000-0000-0000-0000-000000000005','f2f30000-0000-0000-0000-000000000010','{}','journal','paid','f2f30000-0000-0000-0000-000000000002');
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,erp_modified) values ('f2f30000-0000-0000-0000-000000000011','f2f30000-0000-0000-0000-000000000001','Purchase Order','PROOF-ORDER','SUP-1','Proof','USD',1,1,1,'To Bill','PROJECT',array['f2f30000-0000-0000-0000-000000000003'::uuid],'2026-02-01');
insert into procurement_erp_links(id,org_id,procurement_id,erp_purchase_document_id) values ('f2f30000-0000-0000-0000-000000000012','f2f30000-0000-0000-0000-000000000001','f2f30000-0000-0000-0000-000000000006','f2f30000-0000-0000-0000-000000000011');
savepoint fixture;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2f30000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.undo_captured_purchase('f2f30000-0000-0000-0000-000000000009','proof',false)->>'outcome' as journal_outcome \gset
select public.unlink_erp_purchase_document('f2f30000-0000-0000-0000-000000000012');
reset role;
select count(*) as link_remaining from public.procurement_erp_links where id='f2f30000-0000-0000-0000-000000000012' \gset
select status::text as journal_status from public.procurements where id='f2f30000-0000-0000-0000-000000000009' \gset
select (undone_at is not null)::text as journal_stamped from public.erp_purchase_captures where procurement_id='f2f30000-0000-0000-0000-000000000009' \gset
rollback to fixture;
select is(:'journal_outcome'::text,'undo'::text,'forward journal undo retained');
select is(:'journal_status'::text,'Cancelled'::text,'forward journal wrapper cancelled');
select is(:'journal_stamped'::text,'true'::text,'forward journal history retained');
select is(:'link_remaining'::integer,0,'forward ordinary unlink retained');

insert into erp_purchase_captures(procurement_id,org_id,binding_id,request_id,payload,kind,stage,captured_by) values ('f2f30000-0000-0000-0000-000000000006','f2f30000-0000-0000-0000-000000000001','f2f30000-0000-0000-0000-000000000005','f2f30000-0000-0000-0000-000000000007','{}','order','ordered','f2f30000-0000-0000-0000-000000000002');
select pg_temp.test_down() as result \gset
rollback to fixture;
select is(:'result'::text,'55000:capture_history_exists'::text,'active order blocks down');
insert into erp_purchase_captures(procurement_id,org_id,binding_id,request_id,payload,kind,stage,captured_by,undone_at,undo_reason) values ('f2f30000-0000-0000-0000-000000000006','f2f30000-0000-0000-0000-000000000001','f2f30000-0000-0000-0000-000000000005','f2f30000-0000-0000-0000-000000000007','{}','order','ordered','f2f30000-0000-0000-0000-000000000002',now(),'test');
select pg_temp.test_down() as result \gset
rollback to fixture;
select is(:'result'::text,'55000:capture_history_exists'::text,'undone order blocks down');
insert into erp_purchase_captures(procurement_id,org_id,binding_id,request_id,payload,kind,stage,captured_by) values ('f2f30000-0000-0000-0000-000000000006','f2f30000-0000-0000-0000-000000000001','f2f30000-0000-0000-0000-000000000005','f2f30000-0000-0000-0000-000000000007','{}','supplier_invoice','invoiced','f2f30000-0000-0000-0000-000000000002');
select pg_temp.test_down() as result \gset
rollback to fixture;
select is(:'result'::text,'55000:capture_history_exists'::text,'active invoice blocks down');
insert into erp_purchase_captures(procurement_id,org_id,binding_id,request_id,payload,kind,stage,captured_by,undone_at,undo_reason) values ('f2f30000-0000-0000-0000-000000000006','f2f30000-0000-0000-0000-000000000001','f2f30000-0000-0000-0000-000000000005','f2f30000-0000-0000-0000-000000000007','{}','supplier_invoice','invoiced','f2f30000-0000-0000-0000-000000000002',now(),'test');
select pg_temp.test_down() as result \gset
rollback to fixture;
select is(:'result'::text,'55000:capture_history_exists'::text,'undone invoice blocks down');
insert into erp_capture_batches(org_id,request_id,actor_id,reviewed_revision,current_revision,precision,groups) values ('f2f30000-0000-0000-0000-000000000001','f2f30000-0000-0000-0000-000000000008','f2f30000-0000-0000-0000-000000000002','a','a','{}','[]');
select pg_temp.test_down() as result \gset
rollback to fixture;
select is(:'result'::text,'55000:capture_history_exists'::text,'batch alone blocks down');
select is(pg_temp.test_down(),'allowed','empty history remains eligible');
-- @DOWN@

select is((select count(*)::int from f2_predecessor b join pg_proc p on p.oid=b.oid where (b.body,b.proowner,b.proconfig,b.proacl,b.prosecdef,b.provolatile,b.proparallel,b.prorettype,b.proargtypes,b.pronargdefaults) is not distinct from (pg_get_functiondef(p.oid),p.proowner,p.proconfig,p.proacl,p.prosecdef,p.provolatile,p.proparallel,p.prorettype,p.proargtypes,p.pronargdefaults)),2,'exact predecessor identity and catalog restored');
select ok((select bool_and(has_function_privilege('authenticated',oid,'execute') and has_function_privilege('service_role',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not exists(select 1 from aclexplode(proacl) a where a.grantee=0 and a.privilege_type='EXECUTE')) from pg_proc where oid in (select oid from f2_predecessor)),'restored predecessor effective grants');
select is((select count(*)::int from pg_proc p where p.oid in (select oid from f2_predecessor)),2,'predecessor OIDs retained');
savepoint post_down;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2f30000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.undo_captured_purchase('f2f30000-0000-0000-0000-000000000009','proof',false)->>'outcome' as journal_outcome \gset
select public.unlink_erp_purchase_document('f2f30000-0000-0000-0000-000000000012');
reset role;
select count(*) as link_remaining from public.procurement_erp_links where id='f2f30000-0000-0000-0000-000000000012' \gset
select status::text as journal_status from public.procurements where id='f2f30000-0000-0000-0000-000000000009' \gset
select (undone_at is not null)::text as journal_stamped from public.erp_purchase_captures where procurement_id='f2f30000-0000-0000-0000-000000000009' \gset
rollback to post_down;
select is(:'journal_outcome'::text,'undo'::text,'restored predecessor journal undo retained');
select is(:'journal_status'::text,'Cancelled'::text,'restored predecessor journal wrapper cancelled');
select is(:'journal_stamped'::text,'true'::text,'restored predecessor journal history retained');
select is(:'link_remaining'::integer,0,'restored predecessor ordinary unlink retained');
-- @UP@

select is((select count(*)::int from f2_forward b join pg_proc p on p.proname=b.proname join pg_namespace n on n.oid=p.pronamespace and n.nspname='public' where (b.body,b.proowner,b.proconfig,b.proacl,b.prosecdef,b.provolatile,b.proparallel,b.prorettype,b.proargtypes,b.pronargdefaults) is not distinct from (pg_get_functiondef(p.oid),p.proowner,p.proconfig,p.proacl,p.prosecdef,p.provolatile,p.proparallel,p.prorettype,p.proargtypes,p.pronargdefaults)),13,'second forward catalog matches');
select ok((select bool_and(has_function_privilege('authenticated',p.oid,'execute') and has_function_privilege('service_role',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and not exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('undo_captured_purchase','unlink_erp_purchase_document')),'forward effective grants');
savepoint post_up;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2f30000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.undo_captured_purchase('f2f30000-0000-0000-0000-000000000009','proof',false)->>'outcome' as journal_outcome \gset
select public.unlink_erp_purchase_document('f2f30000-0000-0000-0000-000000000012');
reset role;
select count(*) as link_remaining from public.procurement_erp_links where id='f2f30000-0000-0000-0000-000000000012' \gset
select status::text as journal_status from public.procurements where id='f2f30000-0000-0000-0000-000000000009' \gset
select (undone_at is not null)::text as journal_stamped from public.erp_purchase_captures where procurement_id='f2f30000-0000-0000-0000-000000000009' \gset
rollback to post_up;
select is(:'journal_outcome'::text,'undo'::text,'reapplied forward journal undo retained');
select is(:'journal_status'::text,'Cancelled'::text,'reapplied forward journal wrapper cancelled');
select is(:'journal_stamped'::text,'true'::text,'reapplied forward journal history retained');
select is(:'link_remaining'::integer,0,'reapplied forward ordinary unlink retained');
select * from finish();
rollback;
