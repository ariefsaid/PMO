-- Capture project documents through the existing purchase link rules.
begin;
select plan(8);
insert into organizations (id, name, default_currency) values
  ('21950001-0000-0000-0000-00000000000a','PFE A','IDR'), ('21950001-0000-0000-0000-00000000000b','PFE B','IDR');
insert into auth.users (id, email) values
  ('21950001-0000-0000-0000-0000000000a1','capture-fin1@example.com'), ('21950001-0000-0000-0000-0000000000a2','capture-fin2@example.com'),
  ('21950001-0000-0000-0000-0000000000a3','capture-pm@example.com'),   ('21950001-0000-0000-0000-0000000000a4','capture-eng@example.com'),
  ('21950001-0000-0000-0000-0000000000a5','capture-admin@example.com'),('21950001-0000-0000-0000-0000000000b1','capture-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('21950001-0000-0000-0000-0000000000a1','21950001-0000-0000-0000-00000000000a','Fin One','capture-fin1@example.com','Finance','active'),
  ('21950001-0000-0000-0000-0000000000a2','21950001-0000-0000-0000-00000000000a','Fin Two','capture-fin2@example.com','Finance','active'),
  ('21950001-0000-0000-0000-0000000000a3','21950001-0000-0000-0000-00000000000a','PM','capture-pm@example.com','Project Manager','active'),
  ('21950001-0000-0000-0000-0000000000a4','21950001-0000-0000-0000-00000000000a','Eng','capture-eng@example.com','Engineer','active'),
  ('21950001-0000-0000-0000-0000000000a5','21950001-0000-0000-0000-00000000000a','Admin','capture-admin@example.com','Admin','active'),
  ('21950001-0000-0000-0000-0000000000b1','21950001-0000-0000-0000-00000000000b','B Fin','capture-b@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('21950001-0000-0000-0000-0000000000d1','21950001-0000-0000-0000-00000000000a','PFE P1','Ongoing Project'),
  ('21950001-0000-0000-0000-0000000000d2','21950001-0000-0000-0000-00000000000a','PFE P2','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('21950001-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"21950001-0000-0000-0000-0000000000d1":"ERP-A","21950001-0000-0000-0000-0000000000d2":"ERP-B"}}'::jsonb,
   now(), 'active');
-- AMENDED BY 0372: a SharePoint file sent with a link must be on the organisation's own SharePoint host, so the org
-- has a default library on the host the FR-PFE-029 row uses.
insert into org_m365_document_settings (org_id, default_site_id, default_site_name, default_drive_id, default_drive_name, updated_by) values
  ('21950001-0000-0000-0000-00000000000a','example.sharepoint.com,site-a,web-a','Site','drive-a','Library','21950001-0000-0000-0000-0000000000a1');
insert into companies (id, org_id, name, type) values
  ('21950001-0000-0000-0000-0000000000c1','21950001-0000-0000-0000-00000000000a','Supplier One','Vendor'),
  ('21950001-0000-0000-0000-0000000000c3','21950001-0000-0000-0000-00000000000a','Supplier Three','Vendor');
-- AMENDED BY 0378: a document is recorded by PMO only while its procurement reference points at a live PMO record of
-- its kind, so the PMO-pushed fixture is a real vendor bill (it pointed at nothing before).
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status) values
  ('21950001-0000-0000-0000-0000000000f8','21950001-0000-0000-0000-00000000000a','PMO pushed','21950001-0000-0000-0000-0000000000a1','IDR',0,'Draft');
insert into procurement_invoices (id, procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values
  ('21950001-0000-0000-0000-0000000000f9','21950001-0000-0000-0000-0000000000f8','21950001-0000-0000-0000-00000000000a','Received',5,'IDR','exclusive',0);
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('21950001-0000-0000-0000-00000000000a','companies','21950001-0000-0000-0000-0000000000c1','erpnext','SUP-1'),
  ('21950001-0000-0000-0000-00000000000a','procurement','21950001-0000-0000-0000-0000000000f9','erpnext','PINV-PMO');
select upsert_erp_purchase_documents('21950001-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-1","supplier":"SUP-1","supplier_name":"Supplier One","currency":"IDR","grand_total":666,"net_total":600,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-2","supplier":"SUP-2","supplier_name":"Supplier Two","currency":"IDR","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-3","supplier":"SUP-3","supplier_name":"Supplier Three","currency":"IDR","grand_total":50,"net_total":50,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-USD","supplier":"SUP-1","supplier_name":"Supplier One","currency":"USD","grand_total":50,"net_total":50,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-C","supplier":"SUP-1","currency":"IDR","grand_total":5,"erp_docstatus":2,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-PMO","supplier":"SUP-1","currency":"IDR","grand_total":5,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-P2","supplier":"SUP-1","supplier_name":"Supplier One","currency":"IDR","grand_total":5,"net_total":5,"erp_docstatus":1,"erp_project":"ERP-B","erp_modified":"2026-02-01"},
 {"erp_doctype":"Payment Entry","erp_name":"PE-1","supplier":"SUP-1","supplier_name":"Supplier One","currency":"IDR","grand_total":666,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-D1","supplier":"SUP-1","supplier_name":"Supplier One","currency":"IDR","grand_total":660,"net_total":600,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-D2","supplier":"SUP-1","supplier_name":"Supplier One","currency":"IDR","grand_total":660,"net_total":600,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-G","supplier":"SUP-1","supplier_name":"Supplier One","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"}
]$$::jsonb);

select has_function('public', 'capture_project_purchases', array['uuid','boolean'], 'AC-RRP-001 capture exposes a project-scoped preview and apply operation');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select set_config('rrp.preview', public.capture_project_purchases('21950001-0000-0000-0000-0000000000d1', true)::text, true);
select ok(jsonb_array_length(current_setting('rrp.preview')::jsonb->'results') > 0, 'AC-RRP-001 preview proposes eligible project documents');
reset role;
select is((select count(*)::int from procurements where org_id='21950001-0000-0000-0000-00000000000a' and origin='erp_link'), 0, 'AC-RRP-001 preview writes no wrapper');
select set_config('rrp.outbox', (select count(*)::text from external_command_outbox), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select set_config('rrp.applied', public.capture_project_purchases('21950001-0000-0000-0000-0000000000d1', false)::text, true);
select ok(exists (select 1 from procurement_erp_links l join erp_purchase_documents d on d.id=l.erp_purchase_document_id where d.erp_name='PINV-1'), 'AC-RRP-002 apply links an eligible invoice');
reset role;
select is((select count(*)::text from external_command_outbox), current_setting('rrp.outbox'), 'AC-RRP-002 capture creates no ERP command');
select set_config('rrp.count', (select count(*)::text from procurement_erp_links), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select public.capture_project_purchases('21950001-0000-0000-0000-0000000000d1', false);
reset role;
select is((select count(*)::text from procurement_erp_links), current_setting('rrp.count'), 'AC-RRP-003 repeat capture creates no duplicate link');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.capture_project_purchases(null, true) $$, '42501', null, 'AC-RRP-004 Finance cannot preview capture');
select throws_ok($$ select public.capture_project_purchases(null, false) $$, '42501', null, 'AC-RRP-004 Finance cannot apply capture');
reset role;
select * from finish();
rollback;
