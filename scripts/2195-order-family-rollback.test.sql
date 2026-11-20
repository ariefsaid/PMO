-- #2277: the down for 0903 restores every replaced function to its exact previous body and grants (0896 for undo, else 0882), refuses while any order-family placement exists,
-- and removes what 0903 added. The script substitutes the (signature, body hash, grants) of each replaced function from before 0903,
-- and the down file. The request guard must remain unchanged by 0903's down from the rollback starting point. One transaction; nothing is left behind.
begin;
create temporary table _request_guard_before_0903_down as
  select md5(pg_get_functiondef('public.api_client_request_guard()'::regprocedure)) as body_hash;
select plan(7);
insert into organizations(id,name,default_currency) values ('21953004-0000-0000-0000-000000000001','Family rollback org','USD');
insert into auth.users(id,email) values ('21953004-0000-0000-0000-000000000002','rollback-family@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21953004-0000-0000-0000-000000000002','21953004-0000-0000-0000-000000000001','Admin','rollback-family@example.test','Admin','active');
insert into projects(id,org_id,name,status) values ('21953004-0000-0000-0000-000000000003','21953004-0000-0000-0000-000000000001','Rollback project','Ongoing Project');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('21953004-0000-0000-0000-000000000004','21953004-0000-0000-0000-000000000001','erpnext','https://example.test','test','{}',now(),'active');
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,erp_docstatus,erp_modified) values
 ('21953004-0000-0000-0000-000000000005','21953004-0000-0000-0000-000000000001','Purchase Order','PO-RB',1,'1'),
 ('21953004-0000-0000-0000-000000000006','21953004-0000-0000-0000-000000000001','Purchase Invoice','PI-RB',1,'1');
insert into erp_capture_invoice_assignments(org_id,binding_id,source_document_id,request_id,payload_digest,decision,project_id,actor_id,family_request_id,family_order_document_id)
 values ('21953004-0000-0000-0000-000000000001','21953004-0000-0000-0000-000000000004','21953004-0000-0000-0000-000000000006',gen_random_uuid(),'x','project',
         '21953004-0000-0000-0000-000000000003','21953004-0000-0000-0000-000000000002',gen_random_uuid(),'21953004-0000-0000-0000-000000000005');
select throws_ok($down$
@DOWN@
$down$,'55000','family_history_exists','AC-020 the down refuses while a family decision exists');
delete from erp_capture_invoice_assignments where org_id='21953004-0000-0000-0000-000000000001';
insert into procurements(id,org_id,title,requested_by_id,project_id,currency,total_value,status) values ('21953004-0000-0000-0000-000000000007','21953004-0000-0000-0000-000000000001','Rollback','21953004-0000-0000-0000-000000000002','21953004-0000-0000-0000-000000000003','USD',0,'Draft');
insert into erp_purchase_captures(org_id,binding_id,request_id,procurement_id,payload,kind,stage,captured_by)
 values ('21953004-0000-0000-0000-000000000001','21953004-0000-0000-0000-000000000004',gen_random_uuid(),'21953004-0000-0000-0000-000000000007',
         jsonb_build_object('family_request_id',gen_random_uuid(),'mode','create'),'supplier_invoice','invoiced','21953004-0000-0000-0000-000000000002');
select throws_ok($down$
@DOWN@
$down$,'55000','family_history_exists','AC-020 the down refuses while a family placement of tagged invoices only (a capture row) exists');
delete from erp_purchase_captures where org_id='21953004-0000-0000-0000-000000000001';
select lives_ok($down$
@DOWN@
$down$,'AC-020 the down runs once no family placement exists');
select is((select count(*)::int from pg_proc where pronamespace='public'::regnamespace and (proname in ('capture_assignment_family','capture_family_stage')
      or oid=to_regprocedure('public.undo_captured_purchase(uuid,text,boolean,uuid)') or oid=to_regprocedure('public.capture_assignment_validate(uuid,uuid,jsonb,uuid,jsonb,text)')))
  + (select count(*)::int from information_schema.columns where table_schema='public' and table_name='erp_capture_invoice_assignments' and column_name in ('family_request_id','family_order_document_id'))
  + (select count(*)::int from pg_class where oid in (to_regclass('public.erp_capture_assignment_family_idx'),to_regclass('public.erp_purchase_documents_purchase_orders_idx'))),0,
  'AC-020 the family and stage functions, the new signatures, columns and indexes are gone');
select is(md5(pg_get_functiondef('public.api_client_request_guard()'::regprocedure)),
  (select body_hash from _request_guard_before_0903_down),
  'AC-020 0903 rollback leaves the request guard unchanged from the rollback starting point');
select is((select count(*)::int from (values @HASHES@) e(sig,body,acl) join pg_proc p on p.oid=to_regprocedure(e.sig)
   where md5(pg_get_functiondef(p.oid))=e.body and p.proacl::text is not distinct from nullif(e.acl,'')),5,'AC-020 every replaced function has its exact previous body and grants');
select is((select count(*)::int from pg_proc where proname in ('assign_capture_invoices','capture_assignment_claim','capture_assignment_validate','undo_captured_purchase','purchase_capture_assignment_report') and pronamespace='public'::regnamespace),5,'AC-020 no replaced function was dropped or duplicated');
select * from finish();
rollback;
