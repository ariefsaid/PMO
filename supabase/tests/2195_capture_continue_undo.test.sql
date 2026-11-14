begin;
select plan(10);
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
insert into auth.users(id,email) values ('21950003-0000-0000-0000-000000000011','finance-proof@example.test'),('21950003-0000-0000-0000-000000000012','foreign-proof@example.test');
insert into organizations(id,name,default_currency) values ('21950003-0000-0000-0000-000000000013','Other','USD');
insert into profiles(id,org_id,full_name,email,role,status) values ('21950003-0000-0000-0000-000000000011','21950003-0000-0000-0000-000000000001','Finance','finance-proof@example.test','Finance','active'),('21950003-0000-0000-0000-000000000012','21950003-0000-0000-0000-000000000013','Other','foreign-proof@example.test','Admin','active');
set local request.jwt.claims='{"role":"service_role"}';
insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
select '21950003-0000-0000-0000-000000000001','procurement',('21950003-5000-0000-0000-'||lpad(g::text,12,'0')),'key-'||g,'erpnext','create','pending',jsonb_build_object('procurementId',('21950003-1000-0000-0000-'||lpad(g::text,12,'0')),'erp_doc_kind','payment','capturedInvoiceDocumentId',('21950003-2000-0000-0000-'||lpad(g::text,12,'0')),'pi_names',jsonb_build_array('INV-'||g)) from generate_series(1,8) g;
update external_command_outbox set state=case pmo_record_id when '21950003-5000-0000-0000-000000000002' then 'committing' when '21950003-5000-0000-0000-000000000003' then 'committed' when '21950003-5000-0000-0000-000000000004' then 'quarantined' when '21950003-5000-0000-0000-000000000005' then 'held' when '21950003-5000-0000-0000-000000000006' then 'committed' when '21950003-5000-0000-0000-000000000007' then 'failed' when '21950003-5000-0000-0000-000000000008' then 'failed' else 'pending' end where org_id='21950003-0000-0000-0000-000000000001';
update external_command_outbox set attempt_count=public.outbox_max_auto_attempts() where pmo_record_id='21950003-5000-0000-0000-000000000007';
insert into payments(id,org_id,procurement_id,status,amount,erp_docstatus) values ('21950003-5000-0000-0000-000000000006','21950003-0000-0000-0000-000000000001','21950003-1000-0000-0000-000000000006','Paid',25,1);
update external_command_outbox set state='confirmed' where pmo_record_id='21950003-5000-0000-0000-000000000006';
set local role authenticated;
set local request.jwt.claims='{"role":"authenticated","sub":"21950003-0000-0000-0000-000000000002"}';
select throws_ok(format('select public.undo_captured_purchase(%L::uuid,%L,false)',('21950003-1000-0000-0000-'||lpad(g::text,12,'0')),'reviewed'), '55000','has_later_pmo_steps','AC-ROP-009 undo refuses active continuation '||g) from generate_series(1,6) g;
select throws_ok($q$select public.undo_captured_purchase('21950003-1000-0000-0000-000000000008','reviewed',false)$q$,'55000','has_later_pmo_steps','AC-ROP-009 retryable failure retains the continuation');
select is(public.undo_captured_purchase('21950003-1000-0000-0000-000000000007','reviewed',true)->>'outcome','undo','AC-ROP-009 failed no-write command permits undo');
set local request.jwt.claims='{"role":"authenticated","sub":"21950003-0000-0000-0000-000000000011"}';
select throws_ok($q$select public.undo_captured_purchase('21950003-1000-0000-0000-000000000009','reviewed',false)$q$,'42501','not authorized','AC-ROP-009 non-Admin cannot undo');
set local request.jwt.claims='{"role":"authenticated","sub":"21950003-0000-0000-0000-000000000012"}';
select throws_ok($q$select public.undo_captured_purchase('21950003-1000-0000-0000-000000000009','reviewed',false)$q$,'P0002','purchase_not_found','AC-ROP-009 another organization cannot undo');
reset role;
select * from finish();
rollback;
