-- #2195 B1: the down for 0875 restores every replaced function to its exact previous body, refuses while any decision exists,
-- and removes what 0875 added. The script substitutes the (signature, body hash, grants) of each replaced function, as recorded in a database reset to the
-- migration before 0875, and the down file. One transaction; nothing is left behind.
begin;
select plan(5);
insert into organizations(id,name,default_currency) values ('21951008-0000-0000-0000-000000000001','Rollback org','USD');
insert into auth.users(id,email) values ('21951008-0000-0000-0000-000000000002','rollback-b1@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21951008-0000-0000-0000-000000000002','21951008-0000-0000-0000-000000000001','Admin','rollback-b1@example.test','Admin','active');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('21951008-0000-0000-0000-000000000003','21951008-0000-0000-0000-000000000001','erpnext','https://example.test','test','{}',now(),'active');
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,erp_docstatus,erp_modified) values ('21951008-0000-0000-0000-000000000004','21951008-0000-0000-0000-000000000001','Purchase Invoice','INV-RB',1,'1');
insert into erp_capture_invoice_assignments(org_id,binding_id,source_document_id,request_id,payload_digest,decision,actor_id)
 values ('21951008-0000-0000-0000-000000000001','21951008-0000-0000-0000-000000000003','21951008-0000-0000-0000-000000000004',gen_random_uuid(),'x','set_aside','21951008-0000-0000-0000-000000000002');
select throws_ok($down$
@DOWN@
$down$,'55000','assignment_history_exists','AC-ROP-009 the down refuses while an assignment decision exists');
delete from erp_capture_invoice_assignments where org_id='21951008-0000-0000-0000-000000000001';
select lives_ok($down$
@DOWN@
$down$,'AC-ROP-009 the down runs once no decision exists');
select is((select count(*)::int from pg_class where oid=to_regclass('public.erp_capture_invoice_assignments'))
  + (select count(*)::int from pg_proc where proname in ('capture_assigned_gl','capture_assignment_claim','capture_assignment_validate','capture_assignment_row','assign_capture_invoices','purchase_capture_assignment_report','guard_capture_assignment_update','capture_assignment_batch','capture_assignment_release_set_aside')
      and pronamespace='public'::regnamespace),0,'AC-ROP-009 the assignment table, trigger guard and every function 0875 added are gone');
select is((select count(*)::int from (values @HASHES@) e(sig,body,acl) join pg_proc p on p.oid=to_regprocedure(e.sig)
   where md5(pg_get_functiondef(p.oid))=e.body and p.proacl::text is not distinct from nullif(e.acl,'')),7,'AC-ROP-009 every replaced function has its exact previous body and grants');
select is((select count(*)::int from pg_proc where proname in ('cost_attribution_engine','cost_attribution_allocations','cost_attribution_org_actuals','cost_attribution_project_actuals','link_erp_purchase_documents','undo_captured_purchase','api_client_request_guard') and pronamespace='public'::regnamespace),7,'AC-ROP-009 no replaced function was dropped or duplicated');
select * from finish();
rollback;
