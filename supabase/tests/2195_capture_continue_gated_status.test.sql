begin;
select plan(5);
insert into organizations(id,name,default_currency) values ('21950003-0000-0000-0000-000000000001','Status proof','USD');
insert into auth.users(id,email) values ('21950003-0000-0000-0000-000000000002','status-proof@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21950003-0000-0000-0000-000000000002','21950003-0000-0000-0000-000000000001','Admin','status-proof@example.test','Admin','active');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('21950003-0000-0000-0000-000000000003','21950003-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref','{}',now(),'active');
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status,origin)
select ('21950003-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'21950003-0000-0000-0000-000000000001','Purchase '||g,'21950003-0000-0000-0000-000000000002','USD',100,'Vendor Invoiced','erp_link' from generate_series(1,10) g;
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,currency,grand_total,outstanding_amount,erp_docstatus,erp_modified)
select ('21950003-2000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'21950003-0000-0000-0000-000000000001','Purchase Invoice','INV-'||g,'USD',100,100,1,'2026-01-01' from generate_series(1,10) g;
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id)
select '21950003-0000-0000-0000-000000000001',('21950003-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,('21950003-2000-0000-0000-'||lpad(g::text,12,'0'))::uuid from generate_series(1,10) g;
update procurements set record_only=true where org_id='21950003-0000-0000-0000-000000000001';
insert into erp_purchase_captures(org_id,procurement_id,binding_id,request_id,payload,kind,stage,captured_by)
select '21950003-0000-0000-0000-000000000001',('21950003-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'21950003-0000-0000-0000-000000000003',('21950003-3000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'{"source_ids":[]}','supplier_invoice','invoiced','21950003-0000-0000-0000-000000000002' from generate_series(1,10) g;
update organizations set procurement_gates='{"approval_before_payment":true}' where id='21950003-0000-0000-0000-000000000001';
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok($q$update erp_purchase_documents set outstanding_amount=0 where id='21950003-2000-0000-0000-000000000001'$q$,'AC-ROP-024 directly settled invoice refreshes with approval rule enabled');
select is((select status::text from procurements where id='21950003-1000-0000-0000-000000000001'),'Paid','AC-ROP-024 ERP settlement remains visible with approval rule enabled');
select is(public.procurement_create_refusal('21950003-0000-0000-0000-000000000001','21950003-1000-0000-0000-000000000002','payment','21950003-0000-0000-0000-000000000002'),'gate_approval_before_payment','AC-ROP-024 payment command still respects the approval rule');
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status) values ('21950003-1000-0000-0000-000000000012','21950003-0000-0000-0000-000000000001','Ordinary','21950003-0000-0000-0000-000000000002','USD',100,'Vendor Invoiced');
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,currency,grand_total,outstanding_amount,erp_docstatus,erp_modified) values ('21950003-2000-0000-0000-000000000012','21950003-0000-0000-0000-000000000001','Purchase Invoice','ORDINARY-12','USD',100,0,1,'2026-01-01');
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id) values ('21950003-0000-0000-0000-000000000001','21950003-1000-0000-0000-000000000012','21950003-2000-0000-0000-000000000012');
insert into erp_purchase_captures(org_id,procurement_id,binding_id,request_id,payload,kind,stage,captured_by) values ('21950003-0000-0000-0000-000000000001','21950003-1000-0000-0000-000000000012','21950003-0000-0000-0000-000000000003','21950003-3000-0000-0000-000000000012','{"source_ids":[]}','supplier_invoice','paid','21950003-0000-0000-0000-000000000002');
select throws_ok($q$update procurements set status='Paid' where id='21950003-1000-0000-0000-000000000012'$q$,'23514',null,'AC-ROP-024 ordinary gated purchase cannot be marked Paid');
select throws_ok($q$update procurements set status='Paid' where id='21950003-1000-0000-0000-000000000003'$q$,'23514',null,'AC-ROP-024 service update without settlement evidence is refused');
select * from finish();
rollback;
