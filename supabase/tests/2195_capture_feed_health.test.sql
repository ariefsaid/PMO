-- AC-ROP-017: an authorized census must not truncate purchase history.
begin;
select plan(10);
insert into organizations (id, name, default_currency) values
  ('21950110-0000-0000-0000-000000000001','Capture test','USD');
insert into auth.users (id, email) values
  ('21950110-0000-0000-0000-000000000002','capture-admin@example.test'),
  ('21950110-0000-0000-0000-000000000003','capture-finance@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('21950110-0000-0000-0000-000000000002','21950110-0000-0000-0000-000000000001','Admin','capture-admin@example.test','Admin','active'),
  ('21950110-0000-0000-0000-000000000003','21950110-0000-0000-0000-000000000001','Finance','capture-finance@example.test','Finance','active');
insert into projects (id, org_id, name, status) values
  ('21950110-0000-0000-0000-000000000004','21950110-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('21950110-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref',
   '{"company":"Example","project_map":{"21950110-0000-0000-0000-000000000004":"PROJECT"}}',now(),'active');
select upsert_erp_purchase_documents('21950110-0000-0000-0000-000000000001', $$[
 {"erp_doctype":"Purchase Order","erp_name":"ORDER-1","supplier":"SUP-1","currency":"USD","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_project":"PROJECT","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"INVOICE-1","supplier":"SUP-1","currency":"USD","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_project":"PROJECT","erp_modified":"2026-02-01"}
]$$::jsonb);

select set_config('capture.binding',(select id::text from external_org_bindings where org_id='21950110-0000-0000-0000-000000000001'),true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950110-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.revision',public.purchase_capture_source_page(null,null,1)->>'revision',true);
select is(public.purchase_capture_feed_health()->>'caught_up','false','AC-ROP-018 missing feed completion is incomplete');
select ok(not has_function_privilege('authenticated','public.record_capture_feed_completion(uuid,uuid,text,timestamptz,uuid)','execute'),'AC-ROP-005 a client cannot assert feed completion');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_capture_feed_start('21950110-0000-0000-0000-000000000001',current_setting('capture.binding')::uuid,'purchases',now(),'21950110-0000-0000-0000-000000000010');
select public.record_capture_feed_completion('21950110-0000-0000-0000-000000000001',current_setting('capture.binding')::uuid,'purchases',now(),'21950110-0000-0000-0000-000000000010');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950110-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.purchase_capture_feed_health()->>'caught_up','false','AC-ROP-018 purchase completion alone is incomplete');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_capture_feed_start('21950110-0000-0000-0000-000000000001',current_setting('capture.binding')::uuid,'ledger',now(),'21950110-0000-0000-0000-000000000011');
select public.record_capture_feed_completion('21950110-0000-0000-0000-000000000001',current_setting('capture.binding')::uuid,'ledger',now(),'21950110-0000-0000-0000-000000000011');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950110-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.purchase_capture_feed_health()->>'caught_up','true','AC-ROP-018 both current feeds are required');
select is(public.purchase_capture_feed_health()->>'ledger_currency',null,'AC-ROP-018 absent company currency is unknown');
select isnt(public.purchase_capture_source_page(null,null,1)->>'revision',current_setting('capture.revision'),'AC-ROP-017 feed completion participates in generation');
reset role;
insert into erp_financial_statement_snapshot(org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,published_at,capture_started_at,capture_completed_at,payload,raw_reports,has_activity,display_precision,display_rounding_method)
values ('21950110-0000-0000-0000-000000000001','Example','21950110-0000-0000-0000-000000000008','21950110-0000-0000-0000-000000000009','trial_balance','company','account_breakdown','month','2026-01-01','2026-01-31','2025-01-01','2025-01-31','IDR',now(),now(),now(),now(),'{"current":{"rows":[]},"prior":{"rows":[]}}','{"current":"{}","prior":"{}"}',false,2,'erpnext_report_output');
insert into erp_financial_statement_published_context(org_id,company,snapshot_id,source_generation,context)
values ('21950110-0000-0000-0000-000000000001','Example','21950110-0000-0000-0000-000000000008','21950110-0000-0000-0000-000000000009','{"presentation":{"context":{"raw":{"company":{"name":"Example","currency":"IDR"}}}}}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950110-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.purchase_capture_feed_health()->>'ledger_currency','IDR','AC-ROP-018 the bound company currency comes from trusted publication evidence');
reset role;
select set_config('capture.new_start',clock_timestamp()::text,true);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_capture_feed_start('21950110-0000-0000-0000-000000000001',current_setting('capture.binding')::uuid,'purchases',current_setting('capture.new_start')::timestamptz,'21950110-0000-0000-0000-000000000012');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950110-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.purchase_capture_feed_health()->>'caught_up','false','AC-ROP-018 an in-progress feed cannot reuse an earlier completed witness');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_capture_feed_completion('21950110-0000-0000-0000-000000000001',current_setting('capture.binding')::uuid,'purchases',now(),'21950110-0000-0000-0000-000000000010');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950110-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.purchase_capture_feed_health()->>'caught_up','false','AC-ROP-018 an older overlapping completion cannot complete the current feed');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_capture_feed_completion('21950110-0000-0000-0000-000000000001',current_setting('capture.binding')::uuid,'purchases',current_setting('capture.new_start')::timestamptz,'21950110-0000-0000-0000-000000000012');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950110-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.purchase_capture_feed_health()->>'caught_up','true','AC-ROP-018 only the current run restores the completed witness');
reset role;
select * from finish();
rollback;
