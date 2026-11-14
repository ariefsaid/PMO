-- AC-ROP-005: Capture surfaces retain their tenant and caller boundaries.
begin;
select plan(24);
select is((select count(*)::integer from information_schema.role_table_grants where table_schema='public' and table_name in ('erp_capture_batches','erp_capture_feed_witnesses') and grantee in ('anon','authenticated','service_role')), 0, 'capture tables grant no API role table privileges');
select is((select count(*)::integer from (values ('anon'),('authenticated'),('service_role')) roles(role_name)
 cross join (values ('public.erp_capture_batches'),('public.erp_capture_feed_witnesses')) tables(table_name)
 cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) privileges(privilege_name)
 where has_table_privilege(role_name,table_name,privilege_name)), 0, 'capture table effective privileges are absent for API roles');
select ok(not has_table_privilege('authenticated','public.erp_capture_batches','select'), 'capture batches are not readable by clients');
select ok(not has_table_privilege('service_role','public.erp_capture_batches','select'), 'capture batches are not directly readable by service');
select ok(not has_table_privilege('authenticated','public.erp_capture_feed_witnesses','select'), 'feed witnesses are not readable by clients');
select ok(not has_table_privilege('service_role','public.erp_capture_feed_witnesses','select'), 'feed witnesses are not directly readable by service');
select is((select count(*)::integer from (values ('anon'),('authenticated'),('service_role')) roles(role_name)
 cross join (values ('public.capture_history_apply_internal(uuid,uuid,uuid,text,jsonb,jsonb,boolean,boolean)'),('public.undo_captured_journal_purchase(uuid,text,boolean)'),('public.unlink_erp_purchase_document_unchecked(uuid)')) functions(signature)
 where has_function_privilege(role_name,signature,'execute')),0,'private helper execution is unavailable to all API roles');
select ok(not has_function_privilege('authenticated','public.capture_history_apply_internal(uuid,uuid,uuid,text,jsonb,jsonb,boolean,boolean)','execute'), 'internal capture helper is not client callable');
select ok(not has_function_privilege('service_role','public.capture_history_apply_internal(uuid,uuid,uuid,text,jsonb,jsonb,boolean,boolean)','execute'), 'internal capture helper is not service callable');
select ok(not has_function_privilege('authenticated','public.capture_history_batch(uuid,uuid,uuid,text,jsonb,jsonb)','execute'), 'batch is not client callable');
select ok(not has_function_privilege('authenticated','public.record_capture_feed_start(uuid,uuid,text,timestamp with time zone,uuid)','execute'), 'feed start is not client callable');
select ok(not has_function_privilege('authenticated','public.record_capture_feed_completion(uuid,uuid,text,timestamp with time zone,uuid)','execute'), 'feed completion is not client callable');
select ok(not has_function_privilege('service_role','public.undo_captured_journal_purchase(uuid,text,boolean)','execute'), 'undo helper is not service callable');
select ok(not has_function_privilege('service_role','public.unlink_erp_purchase_document_unchecked(uuid)','execute'), 'unlink helper is not service callable');
select ok(not has_function_privilege('anon','public.purchase_capture_source_page(uuid,uuid,integer)','execute'), 'anonymous census is not callable');
insert into public.organizations(id,name,default_currency) values
 ('21950999-0000-0000-0000-000000000001','Capture A','USD'),
 ('21950999-0000-0000-0000-000000000002','Capture B','USD');
insert into auth.users(id,email) values ('21950999-0000-0000-0000-000000000003','capture-isolation@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('21950999-0000-0000-0000-000000000003','21950999-0000-0000-0000-000000000002','Admin','capture-isolation@example.test','Admin','active');
insert into public.projects(id,org_id,name,status) values
 ('21950999-0000-0000-0000-000000000004','21950999-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into public.external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('21950999-0000-0000-0000-000000000005','21950999-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref','{"company":"A"}',now()-interval '1 minute','active'),
 ('21950999-0000-0000-0000-000000000006','21950999-0000-0000-0000-000000000002','erpnext','https://example.test','test-ref','{"company":"B"}',now()-interval '1 minute','active');
select public.upsert_erp_purchase_documents('21950999-0000-0000-0000-000000000001', '[{"erp_doctype":"Purchase Order","erp_name":"ISOLATION-ORDER","currency":"USD","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-01-01"}]'::jsonb);
insert into public.erp_gl_entry_mirror(org_id,erp_name,company,account,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
 ('21950999-0000-0000-0000-000000000001','ISOLATION-GL','A','Cost','Journal Entry','ISOLATION-JV','2026-01-01',10,0,false,'2026-01-01');
insert into public.erp_capture_feed_witnesses(binding_id,org_id,feed_kind,started_at,run_id,completed) values
 ('21950999-0000-0000-0000-000000000005','21950999-0000-0000-0000-000000000001','purchases',now(),'21950999-0000-0000-0000-000000000007',true),
 ('21950999-0000-0000-0000-000000000005','21950999-0000-0000-0000-000000000001','ledger',now(),'21950999-0000-0000-0000-000000000007',true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950999-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.purchase_capture_source_page(null,'21950999-0000-0000-0000-000000000004',500)$$,'P0002',null,'foreign project is refused by census');
select is(jsonb_array_length(public.purchase_capture_source_page(null,null,500)->'sources'),0,'census omits foreign sources');
select is(jsonb_array_length(public.purchase_capture_ledger_page(null,500)->'lines'),0,'ledger omits foreign lines');
select is(public.purchase_capture_feed_health()->>'caught_up','false','health does not use foreign witnesses');
reset role;
update public.erp_capture_feed_witnesses set completed=false where binding_id='21950999-0000-0000-0000-000000000005' and feed_kind='purchases';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.record_capture_feed_start('21950999-0000-0000-0000-000000000002','21950999-0000-0000-0000-000000000005','purchases',now(),'21950999-0000-0000-0000-000000000007')$$,'22023',null,'feed start rejects a foreign binding');
select is(public.capture_history_batch('21950999-0000-0000-0000-000000000003','21950999-0000-0000-0000-000000000004','21950999-0000-0000-0000-000000000008','revision','{}'::jsonb,'[]'::jsonb)->>'reason','project_not_found','batch refuses foreign project');
select is(public.capture_history_apply('21950999-0000-0000-0000-000000000003','21950999-0000-0000-0000-000000000004','21950999-0000-0000-0000-000000000008','revision','["21950999-0000-0000-0000-000000000009"]'::jsonb,'{}'::jsonb,true)->>'reason','project_not_found','capture apply refuses foreign project');
select public.record_capture_feed_completion('21950999-0000-0000-0000-000000000002','21950999-0000-0000-0000-000000000005','purchases',now(),'21950999-0000-0000-0000-000000000007');
reset role;
select is(public.capture_history_apply_internal('21950999-0000-0000-0000-000000000003','21950999-0000-0000-0000-000000000004','21950999-0000-0000-0000-000000000008','revision','["21950999-0000-0000-0000-000000000009"]'::jsonb,'{}'::jsonb,true,false)->>'reason','project_not_found','private capture helper refuses foreign project');
select is((select completed from public.erp_capture_feed_witnesses where binding_id='21950999-0000-0000-0000-000000000005' and feed_kind='purchases'),false,'foreign completion leaves witness unchanged');
select * from finish();
rollback;
