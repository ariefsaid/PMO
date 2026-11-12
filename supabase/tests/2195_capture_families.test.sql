-- Multi-document capture and tenant boundary.
begin;
select plan(13);
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


insert into budget_category_account_map (org_id,category,erp_account) values ('21950001-0000-0000-0000-00000000000a','Materials','Mapped cost');
insert into erp_gl_entry_mirror (org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values ('21950001-0000-0000-0000-00000000000a','gl-PINV-D1','Example Co','Mapped cost','ERP-A','Purchase Invoice','PINV-D1','2026-02-01',10,0,false,'2026-02-01'),('21950001-0000-0000-0000-00000000000a','gl-PINV-D2','Example Co','Mapped cost','ERP-A','Purchase Invoice','PINV-D2','2026-02-01',10,0,false,'2026-02-01');
insert into erp_capture_sources (org_id,binding_id,source_id,version,kind,state,normalized)
select d.org_id,b.id,d.id::text,d.erp_modified,'supplier_invoice','invoiced',jsonb_build_object('document_id',d.id)
from erp_purchase_documents d join external_org_bindings b on b.org_id=d.org_id and b.external_tier='erpnext'
where d.org_id='21950001-0000-0000-0000-00000000000a' and d.erp_name in ('PINV-D1','PINV-D2');
select set_config('rrp.ids', (select jsonb_agg(id::text order by erp_name)::text from erp_purchase_documents where org_id='21950001-0000-0000-0000-00000000000a' and erp_name in ('PINV-D1','PINV-D2')), true);
select set_config('rrp.versions', (select jsonb_object_agg(id::text,erp_modified)::text from erp_purchase_documents where org_id='21950001-0000-0000-0000-00000000000a' and erp_name in ('PINV-D1','PINV-D2')), true);
create function pg_temp.capture_many(versions jsonb, dry boolean default false) returns jsonb language sql as $$
  select public.capture_existing_purchases(jsonb_build_array(jsonb_build_object('request_id','21950001-0000-0000-0000-000000000098',
    'project_id','21950001-0000-0000-0000-0000000000d1','source_ids',current_setting('rrp.ids')::jsonb,'source_versions',versions)),dry)
$$;
grant execute on function pg_temp.capture_many(jsonb,boolean) to public;
savepoint partial_case;
insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id)
select org_id, '21950001-0000-0000-0000-0000000000f8', id from erp_purchase_documents
where org_id='21950001-0000-0000-0000-00000000000a' and erp_name in ('PINV-D1','PINV-D2') order by id limit 1;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(pg_temp.capture_many(current_setting('rrp.versions')::jsonb) #>> '{results,0,reason}', 'partially_linked', 'AC-ROP-007 a partially linked family is refused without a second purchase');
reset role;
select is((select count(*)::int from procurement_erp_links where org_id='21950001-0000-0000-0000-00000000000a'), 1, 'AC-ROP-007 partial family refusal preserves the original link');
rollback to savepoint partial_case;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(pg_temp.capture_many('{}'::jsonb) #>> '{results,0,reason}', 'source_stale', 'AC-ROP-017 stale source versions are refused');
reset role;
select is((select count(*)::int from procurement_erp_links where org_id='21950001-0000-0000-0000-00000000000a'), 0, 'AC-ROP-017 stale groups write no links');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(pg_temp.capture_many(current_setting('rrp.versions')::jsonb) #>> '{results,0,outcome}', 'create', 'AC-ROP-017 one group captures two matching invoices');
reset role;
select is((select count(distinct l.procurement_id)::int from procurement_erp_links l where l.erp_purchase_document_id::text in (select jsonb_array_elements_text(current_setting('rrp.ids')::jsonb))), 1, 'AC-ROP-017 both documents share one purchase');
select is((select count(*)::int from procurement_erp_links l where l.erp_purchase_document_id::text in (select jsonb_array_elements_text(current_setting('rrp.ids')::jsonb))), 2, 'AC-ROP-017 both source links are retained');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(pg_temp.capture_many(current_setting('rrp.versions')::jsonb) #>> '{results,0,outcome}', 'skip', 'AC-ROP-017 identical retry returns the existing capture');
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select pg_temp.capture_many(current_setting('rrp.versions')::jsonb)$$, '42501', null, 'AC-ROP-005 a Project Manager cannot capture');
reset role;
update profiles set role='Admin' where id='21950001-0000-0000-0000-0000000000b1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(pg_temp.capture_many(current_setting('rrp.versions')::jsonb) #>> '{results,0,reason}', 'project_not_found', 'AC-ROP-006 another organization cannot target this project');
reset role;
insert into erp_capture_sources (org_id,binding_id,source_id,version,kind,state,normalized)
select d.org_id,b.id,d.id::text,d.erp_modified,'order','ordered',jsonb_build_object('document_id',d.id)
from erp_purchase_documents d join external_org_bindings b on b.org_id=d.org_id and b.external_tier='erpnext'
where d.org_id='21950001-0000-0000-0000-00000000000a' and d.erp_name='PO-USD';
select set_config('rrp.order_id',(select id::text from erp_purchase_documents where org_id='21950001-0000-0000-0000-00000000000a' and erp_name='PO-USD'),true);
savepoint request_conflict;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(public.capture_existing_purchases(jsonb_build_array(jsonb_build_object(
  'request_id','21950001-0000-0000-0000-000000000098','project_id','21950001-0000-0000-0000-0000000000d1',
  'source_ids',jsonb_build_array(current_setting('rrp.order_id')),
  'source_versions',jsonb_build_object(current_setting('rrp.order_id'),'2026-02-01'))),false) #>> '{results,0,reason}',
  'request_conflict','AC-ROP-017 reusing a request identity with changed sources is refused');
reset role;
rollback to savepoint request_conflict;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950001-0000-0000-0000-0000000000a5","role":"authenticated"}';
select set_config('rrp.order_capture',public.capture_existing_purchases(jsonb_build_array(jsonb_build_object(
  'request_id','21950001-0000-0000-0000-000000000097','project_id','21950001-0000-0000-0000-0000000000d1',
  'source_ids',jsonb_build_array(current_setting('rrp.order_id')),
  'source_versions',jsonb_build_object(current_setting('rrp.order_id'),'2026-02-01'))),false)::text,true);
select is((select amount from public.procurement_open_commitments(array[(current_setting('rrp.order_capture')::jsonb #>> '{results,0,procurement_id}')::uuid])),50::numeric,
  'AC-ROP-017 captured open order has its canonical open commitment');
select is((select amount from public.project_committed_spend('21950001-0000-0000-0000-0000000000d1') where currency='USD'),50::numeric,
  'AC-ROP-017 captured order contributes once to the canonical project commitment');
reset role;
select * from finish();
rollback;
