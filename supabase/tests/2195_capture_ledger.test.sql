-- AC-ROP-017: an authorized census must not truncate purchase history.
begin;
select plan(14);
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

insert into budget_category_account_map(org_id,category,erp_account) values ('21950110-0000-0000-0000-000000000001','Materials','Cost'), ('21950110-0000-0000-0000-000000000001','Equipment','Asset'), ('21950110-0000-0000-0000-000000000001','Labor','Unknown');
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id) values
 ('21950110-0000-0000-0000-000000000001','Example','Cost','Cost','Expense','Profit and Loss',false,'USD',1,2,'21950110-0000-0000-0000-000000000006'),
 ('21950110-0000-0000-0000-000000000001','Example','Asset','Asset','Asset','Balance Sheet',false,'USD',3,4,'21950110-0000-0000-0000-000000000006');
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
 ('21950110-0000-0000-0000-000000000001','GL-1','Example','Cost','PROJECT','Purchase Invoice','INVOICE-1','2026-02-01',100,0,false,'2026-02-01'),
 ('21950110-0000-0000-0000-000000000001','GL-2','Example','Asset','PROJECT','Journal Entry','JV-1','2026-02-01',0,25.00,false,'2026-02-01'),
 ('21950110-0000-0000-0000-000000000001','GL-3','Example','Cost','PROJECT','Journal Entry','JV-2','2026-02-01',5,0,false,'2026-02-01'),
 ('21950110-0000-0000-0000-000000000001','GL-4','Example','Unknown','PROJECT','Journal Entry','JV-3','2026-02-01',5,0,false,'2026-02-01');
insert into procurements(id,org_id,title,requested_by_id,project_id,currency,total_value,status) values
 ('21950110-0000-0000-0000-000000000007','21950110-0000-0000-0000-000000000001','Historical purchase','21950110-0000-0000-0000-000000000002','21950110-0000-0000-0000-000000000004','USD',5,'Draft');
insert into erp_journal_line_links(org_id,procurement_id,erp_doctype,voucher_no,project_id,account) values
 ('21950110-0000-0000-0000-000000000001','21950110-0000-0000-0000-000000000007','Journal Entry','JV-2','21950110-0000-0000-0000-000000000004','Cost');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
 ('21950110-0000-0000-0000-000000000001','odoo','https://other.example.test','other-ref',
  '{"company":"Example","project_map":{"21950110-0000-0000-0000-000000000009":"PROJECT"}}',now(),'disconnected');
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
 ('21950110-0000-0000-0000-000000000001','GL-OTHER','Other','Cost','OTHER-PROJECT','Purchase Invoice','INVOICE-1','2026-02-01',1,0,false,'2026-02-01');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950110-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.ledger',public.purchase_capture_ledger_page(null,500)::text,true);
select is(jsonb_array_length(current_setting('capture.ledger')::jsonb->'lines'),5,'AC-ROP-018 ledger census includes each live source');
select is((select x->>'classification' from jsonb_array_elements(current_setting('capture.ledger')::jsonb->'lines') x where x->>'erp_name'='GL-1'),'mapped','AC-ROP-018 mapped cost is identified');
select is((select x->>'classification' from jsonb_array_elements(current_setting('capture.ledger')::jsonb->'lines') x where x->>'erp_name'='GL-2'),'capital_spending','AC-ROP-018 capital spending is distinct');
select is((select x->>'classification' from jsonb_array_elements(current_setting('capture.ledger')::jsonb->'lines') x where x->>'erp_name'='GL-4'),'unknown','AC-ROP-018 a map without chart classification remains unknown');
select is((select x->>'credit' from jsonb_array_elements(current_setting('capture.ledger')::jsonb->'lines') x where x->>'erp_name'='GL-2'),'25.00','AC-ROP-018 signed components preserve decimal text');
select is((select x->>'journal_purchase_id' from jsonb_array_elements(current_setting('capture.ledger')::jsonb->'lines') x where x->>'erp_name'='GL-3'),'21950110-0000-0000-0000-000000000007','AC-ROP-018 an actual journal link proves represented ownership');
select is((select x->>'project_id' from jsonb_array_elements(current_setting('capture.ledger')::jsonb->'lines') x where x->>'erp_name'='GL-3'),'21950110-0000-0000-0000-000000000004','AC-ROP-018 journal ownership uses the mapped project');
select is(current_setting('capture.ledger')::jsonb->>'revision',public.purchase_capture_source_page(null,null,1)->>'revision','AC-ROP-018 ledger and document pages share one witness');
select is((select x->>'project_id' from jsonb_array_elements(current_setting('capture.ledger')::jsonb->'lines') x where x->>'erp_name'='GL-OTHER'),null,'AC-ROP-018 unrelated company has no mapped project');
select is((select x->>'document_id' from jsonb_array_elements(current_setting('capture.ledger')::jsonb->'lines') x where x->>'erp_name'='GL-OTHER'),null,'AC-ROP-018 another company cannot match a purchase document');
reset role;
update external_org_bindings set status='disconnected' where org_id='21950110-0000-0000-0000-000000000001' and external_tier='erpnext';
set local role authenticated;
select is(public.purchase_capture_ledger_page(null,500)->>'outcome','refused','AC-ROP-018 zero active bindings refuse');
select is(public.purchase_capture_ledger_page(null,500)->>'reason','binding_unavailable','AC-ROP-018 zero binding refusal reason');
reset role;
update external_org_bindings set status='active' where org_id='21950110-0000-0000-0000-000000000001';
set local role authenticated;
select is(public.purchase_capture_ledger_page(null,500)->>'outcome','refused','AC-ROP-018 two active bindings refuse');
select is(public.purchase_capture_ledger_page(null,500)->>'reason','binding_unavailable','AC-ROP-018 two binding refusal reason');
reset role;
select * from finish();
rollback;
