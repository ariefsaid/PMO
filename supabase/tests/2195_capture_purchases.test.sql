-- Capture project documents through the existing purchase link rules.
begin;
select plan(23);
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

select has_function('public', 'capture_existing_purchases', array['jsonb','boolean'], 'AC-ROP-017 capture exposes a bounded preview and apply operation');
insert into auth.users (id,email) values ('21950001-0000-0000-0000-0000000000a6','capture-exec@example.com');
insert into profiles (id,org_id,full_name,email,role,status) values ('21950001-0000-0000-0000-0000000000a6','21950001-0000-0000-0000-00000000000a','Exec','capture-exec@example.com','Executive','active');
select ok(not has_function_privilege('anon','public.capture_existing_purchases(jsonb,boolean)','execute'),'AC-ROP-005 anonymous cannot execute capture');
select set_config('rrp.doc', (select id::text from erp_purchase_documents where org_id='21950001-0000-0000-0000-00000000000a' and erp_name='PINV-1'), true);
insert into budget_category_account_map (org_id,category,erp_account) values ('21950001-0000-0000-0000-00000000000a','Materials','Mapped cost');
insert into erp_gl_entry_mirror (org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values ('21950001-0000-0000-0000-00000000000a','gl-PINV-1','Example Co','Mapped cost','ERP-A','Purchase Invoice','PINV-1','2026-02-01',10,0,false,'2026-02-01');
insert into erp_capture_sources (org_id, binding_id, source_id, version, kind, state, normalized)
select d.org_id, b.id, d.id::text, d.erp_modified, 'supplier_invoice', 'invoiced', jsonb_build_object('document_id', d.id)
from erp_purchase_documents d join external_org_bindings b on b.org_id=d.org_id and b.external_tier='erpnext'
where d.id=current_setting('rrp.doc')::uuid;
select ok(not has_function_privilege('authenticated', 'public.capture_history_link_internal(jsonb,boolean)', 'execute'), 'AC-ROP-005 clients cannot invoke the exempt linker');

create function pg_temp.capture_group(dry boolean) returns jsonb language sql as $$
  select public.capture_existing_purchases(jsonb_build_array(jsonb_build_object(
    'request_id','21950001-0000-0000-0000-000000000099',
    'project_id','21950001-0000-0000-0000-0000000000d1',
    'source_ids',jsonb_build_array(current_setting('rrp.doc')),
    'source_versions',jsonb_build_object(current_setting('rrp.doc'),'2026-02-01'))),dry)
$$;
grant execute on function pg_temp.capture_group(boolean) to public;
update organizations set procurement_gates = '{"approval_before_order":true}' where id='21950001-0000-0000-0000-00000000000a';
savepoint gate_case;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PINV-G","project_id":"21950001-0000-0000-0000-0000000000d1"}]') #>> '{results,0,reason}', 'gate_approval_before_order', 'AC-ROP-005 ordinary linking still respects approval gates');
select is(pg_temp.capture_group(true) #>> '{results,0,outcome}', 'create', 'AC-ROP-017 historical capture bypasses ordinary new-order approval gates');
select is(pg_temp.capture_group(false) #>> '{results,0,outcome}', 'create', 'AC-ROP-017 gated history can be captured');
reset role;
select ok(exists (select 1 from audit_events where org_id='21950001-0000-0000-0000-00000000000a' and action='procurement.history_gate_exempt' and detail->>'gate'='gate_approval_before_order'), 'AC-ROP-017 audit names the bypassed gate');
rollback to savepoint gate_case;
update organizations set procurement_gates = '{}' where id='21950001-0000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(pg_temp.capture_group(true) #>> '{results,0,outcome}', 'create', 'AC-ROP-017 preview proposes an eligible invoice');
reset role;
select is((select count(*)::int from procurements where org_id='21950001-0000-0000-0000-00000000000a' and origin='erp_link'), 0, 'AC-ROP-017 preview writes no wrapper');
select set_config('rrp.outbox', (select count(*)::text from external_command_outbox), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(pg_temp.capture_group(false) #>> '{results,0,outcome}', 'create', 'AC-ROP-017 apply captures the eligible invoice');
select ok(exists (select 1 from procurement_erp_links l join erp_purchase_documents d on d.id=l.erp_purchase_document_id where d.erp_name='PINV-1'), 'AC-ROP-017 apply links the source');
reset role;
select is((select count(*)::text from external_command_outbox), current_setting('rrp.outbox'), 'AC-ROP-017 capture creates no ERP command');
select ok(exists (select 1 from procurements p join procurement_erp_links l on l.procurement_id=p.id where l.erp_purchase_document_id=current_setting('rrp.doc')::uuid and p.capture_history_notice = 'Recorded from ERP history without the approval gate.'), 'AC-ROP-017 the purchase names its historical gate exemption');
select ok(exists (select 1 from audit_events where org_id='21950001-0000-0000-0000-00000000000a' and action='procurement.history_gate_exempt'), 'AC-ROP-017 the history gate exemption is audited');
select set_config('rrp.count', (select count(*)::text from procurement_erp_links), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select pg_temp.capture_group(false);
reset role;
select is((select count(*)::text from procurement_erp_links), current_setting('rrp.count'), 'AC-ROP-017 repeat capture creates no duplicate link');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select pg_temp.capture_group(true) $$, '42501', null, 'AC-ROP-005 Finance cannot preview capture');
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select pg_temp.capture_group(true) $$, '42501', null, 'AC-ROP-005 Project Manager cannot preview capture');
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select pg_temp.capture_group(true) $$, '42501', null, 'AC-ROP-005 Engineer cannot preview capture');
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$ select pg_temp.capture_group(true) $$, '42501', null, 'AC-ROP-005 Executive cannot preview capture');
reset role;
update profiles set status='disabled' where id='21950001-0000-0000-0000-0000000000a5';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select pg_temp.capture_group(true) $$, '42501', null, 'AC-ROP-005 inactive Admin cannot preview capture');
reset role;
update profiles set status='active' where id='21950001-0000-0000-0000-0000000000a5';
update erp_purchase_documents set project_ids=array['21950001-0000-0000-0000-0000000000d1'::uuid] where org_id='21950001-0000-0000-0000-00000000000a' and erp_name='PINV-C';
insert into erp_gl_entry_mirror (org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values ('21950001-0000-0000-0000-00000000000a','gl-cancelled','Example Co','Mapped cost','ERP-A','Purchase Invoice','PINV-C','2026-02-01',5,0,false,'2026-02-01');
insert into erp_capture_sources (org_id, binding_id, source_id, version, kind, state, normalized)
select d.org_id, b.id, d.id::text, d.erp_modified, 'supplier_invoice', 'invoiced', jsonb_build_object('document_id', d.id)
from erp_purchase_documents d join external_org_bindings b on b.org_id=d.org_id and b.external_tier='erpnext'
where d.org_id='21950001-0000-0000-0000-00000000000a' and d.erp_name='PINV-C';
select set_config('rrp.doc', (select id::text from erp_purchase_documents where org_id='21950001-0000-0000-0000-00000000000a' and erp_name='PINV-C'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(pg_temp.capture_group(false) #>> '{results,0,reason}', 'source_not_eligible', 'AC-ROP-007 a cancelled source cannot reach the exemption');
select ok(not exists (select 1 from procurement_erp_links l where l.erp_purchase_document_id=current_setting('rrp.doc')::uuid), 'AC-ROP-007 a cancelled document receives no link');
select set_config('rrp.doc', '21950001-0000-0000-0000-000000000077', true);
select is(pg_temp.capture_group(false) #>> '{results,0,reason}', 'source_not_found', 'AC-ROP-007 a missing source cannot reach the exemption');
reset role;
select * from finish();
rollback;
