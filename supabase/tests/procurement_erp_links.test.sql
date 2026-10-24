-- procurement_erp_links.test.sql — 0361. Owns AC-PFE-004, AC-PFE-008, AC-PFE-019, AC-PFE-023; link paths of AC-PFE-003/013.
begin;
select plan(30);

insert into organizations (id, name, default_currency) values
  ('03610000-0000-0000-0000-00000000000a','PFE A','IDR'), ('03610000-0000-0000-0000-00000000000b','PFE B','IDR');
insert into auth.users (id, email) values
  ('03610000-0000-0000-0000-0000000000a1','pfe-fin1@example.com'), ('03610000-0000-0000-0000-0000000000a2','pfe-fin2@example.com'),
  ('03610000-0000-0000-0000-0000000000a3','pfe-pm@example.com'),   ('03610000-0000-0000-0000-0000000000a4','pfe-eng@example.com'),
  ('03610000-0000-0000-0000-0000000000a5','pfe-admin@example.com'),('03610000-0000-0000-0000-0000000000b1','pfe-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03610000-0000-0000-0000-0000000000a1','03610000-0000-0000-0000-00000000000a','Fin One','pfe-fin1@example.com','Finance','active'),
  ('03610000-0000-0000-0000-0000000000a2','03610000-0000-0000-0000-00000000000a','Fin Two','pfe-fin2@example.com','Finance','active'),
  ('03610000-0000-0000-0000-0000000000a3','03610000-0000-0000-0000-00000000000a','PM','pfe-pm@example.com','Project Manager','active'),
  ('03610000-0000-0000-0000-0000000000a4','03610000-0000-0000-0000-00000000000a','Eng','pfe-eng@example.com','Engineer','active'),
  ('03610000-0000-0000-0000-0000000000a5','03610000-0000-0000-0000-00000000000a','Admin','pfe-admin@example.com','Admin','active'),
  ('03610000-0000-0000-0000-0000000000b1','03610000-0000-0000-0000-00000000000b','B Fin','pfe-b@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('03610000-0000-0000-0000-0000000000d1','03610000-0000-0000-0000-00000000000a','PFE P1','Ongoing Project'),
  ('03610000-0000-0000-0000-0000000000d2','03610000-0000-0000-0000-00000000000a','PFE P2','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('03610000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"03610000-0000-0000-0000-0000000000d1":"ERP-A","03610000-0000-0000-0000-0000000000d2":"ERP-B"}}'::jsonb,
   now(), 'active');
-- AMENDED BY 0372: a SharePoint file sent with a link must be on the organisation's own SharePoint host, so the org
-- has a default library on the host the FR-PFE-029 row uses.
insert into org_m365_document_settings (org_id, default_site_id, default_site_name, default_drive_id, default_drive_name, updated_by) values
  ('03610000-0000-0000-0000-00000000000a','example.sharepoint.com,site-a,web-a','Site','drive-a','Library','03610000-0000-0000-0000-0000000000a1');
insert into companies (id, org_id, name, type) values
  ('03610000-0000-0000-0000-0000000000c1','03610000-0000-0000-0000-00000000000a','Supplier One','Vendor'),
  ('03610000-0000-0000-0000-0000000000c3','03610000-0000-0000-0000-00000000000a','Supplier Three','Vendor');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('03610000-0000-0000-0000-00000000000a','companies','03610000-0000-0000-0000-0000000000c1','erpnext','SUP-1'),
  ('03610000-0000-0000-0000-00000000000a','procurement','pmo-pi','erpnext','PINV-PMO');
select upsert_erp_purchase_documents('03610000-0000-0000-0000-00000000000a', $$[
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
insert into procurements (id, org_id, title, requested_by_id, project_id, vendor_id, currency, total_value, status, approved_by_id, approved_total_value) values
  ('03610000-0000-0000-0000-0000000000e1','03610000-0000-0000-0000-00000000000a','PUR1','03610000-0000-0000-0000-0000000000a3','03610000-0000-0000-0000-0000000000d1','03610000-0000-0000-0000-0000000000c1','IDR',1000,'Ordered',null,null),
  ('03610000-0000-0000-0000-0000000000e3','03610000-0000-0000-0000-00000000000a','PUR3','03610000-0000-0000-0000-0000000000a3','03610000-0000-0000-0000-0000000000d1','03610000-0000-0000-0000-0000000000c3','IDR',100,'Ordered',null,null),
  ('03610000-0000-0000-0000-0000000000e4','03610000-0000-0000-0000-00000000000a','PURA','03610000-0000-0000-0000-0000000000a3','03610000-0000-0000-0000-0000000000d1','03610000-0000-0000-0000-0000000000c1','IDR',1000,'Vendor Invoiced','03610000-0000-0000-0000-0000000000a1',1000),
  ('03610000-0000-0000-0000-0000000000e5','03610000-0000-0000-0000-00000000000a','PURC','03610000-0000-0000-0000-0000000000a3','03610000-0000-0000-0000-0000000000d1',null,'IDR',10,'Cancelled',null,null),
  ('03610000-0000-0000-0000-0000000000e6','03610000-0000-0000-0000-00000000000a','PURV','03610000-0000-0000-0000-0000000000a3','03610000-0000-0000-0000-0000000000d1','03610000-0000-0000-0000-0000000000c1','IDR',100,'Ordered',null,null);
select set_config('pfe.outbox_before', (select count(*)::text from external_command_outbox), true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select set_config('pfe.r', link_erp_purchase_documents('[{"erp_name":"PINV-1","procurement_id":"03610000-0000-0000-0000-0000000000e1"}]')::text, true);
select is(current_setting('pfe.r')::jsonb #>> '{results,0,outcome}', 'link', 'AC-PFE-004 a Finance member links an orphan invoice');
reset role;
select is((select count(*) from procurement_erp_links where procurement_id = '03610000-0000-0000-0000-0000000000e1'), 1::bigint, 'AC-PFE-004 one link row');
select is((select status::text from procurements where id = '03610000-0000-0000-0000-0000000000e1'), 'Vendor Invoiced', 'AC-PFE-004 status derived to Vendor Invoiced');
select is((select count(*)::text from external_command_outbox), current_setting('pfe.outbox_before'), 'AC-PFE-004 FR-PFE-022 linking creates no outbox command');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PINV-1","procurement_id":"03610000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,outcome}', 'skip', 'FR-PFE-028 re-linking to the same purchase is a skip');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-1","procurement_id":"03610000-0000-0000-0000-0000000000e3"}]') #>> '{results,0,reason}', 'document_linked_to_another_purchase', 'AC-PFE-008 one purchase per document');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-2","procurement_id":"03610000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,reason}', 'supplier_mismatch', 'AC-PFE-008 supplier differs from the mapped vendor');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-2","procurement_id":"03610000-0000-0000-0000-0000000000e6"}]') #>> '{results,0,reason}', 'supplier_mismatch', 'AC-PFE-008 supplier differs from the mapped vendor of a purchase with no linked documents');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-3","procurement_id":"03610000-0000-0000-0000-0000000000e3","sharepoint":{"drive_id":"drv","item_id":"itm","web_url":"https://example.sharepoint.com/sites/s/Shared%20Documents/Bill.pdf","name":"Bill.pdf","kind":"file"}}]') #>> '{results,0,outcome}', 'link', 'FR-PFE-024 an unmapped vendor matches by name');
select is(link_erp_purchase_documents('[{"erp_name":"PO-USD","procurement_id":"03610000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,reason}', 'currency_mismatch', 'AC-PFE-008 currency differs');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-P2","procurement_id":"03610000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,reason}', 'project_mismatch', 'AC-PFE-008 project differs');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-C","procurement_id":"03610000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,reason}', 'document_cancelled', 'FR-PFE-023 cancelled documents are refused');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-PMO","procurement_id":"03610000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,reason}', 'document_recorded_by_pmo', 'FR-PFE-023 PMO-pushed documents are refused');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-2","procurement_id":"03610000-0000-0000-0000-0000000000e5"}]') #>> '{results,0,reason}', 'purchase_closed', 'FR-PFE-004 closed purchases are refused');
select is(link_erp_purchase_documents('[{"erp_name":"NOPE"}]') #>> '{results,0,reason}', 'document_not_found', 'FR-PFE-023 unknown document');
reset role;
select is((select count(*) from procurement_documents where record_kind = 'erp_document' and source = 'onedrive'
            and procurement_id = '03610000-0000-0000-0000-0000000000e3'), 1::bigint, 'FR-PFE-029 the row''s SharePoint item is attached to the linked document');

-- AC-PFE-013 link path: the approver may not link the payment that pays their own approval.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PE-1","procurement_id":"03610000-0000-0000-0000-0000000000e4"}]') #>> '{results,0,reason}',
  'separation_of_duties', 'AC-PFE-013 approver cannot move their approved purchase to Paid by linking');
reset role;

-- AC-PFE-003 link path.
update organizations set procurement_gates = '{"approval_before_order":true}' where id = '03610000-0000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PINV-G","project_id":"03610000-0000-0000-0000-0000000000d1"}]') #>> '{results,0,reason}', 'gate_approval_before_order', 'AC-PFE-003 a gate refuses a link');
reset role;
update organizations set procurement_gates = '{}' where id = '03610000-0000-0000-0000-00000000000a';

-- AC-PFE-019 dry run = same checks, no writes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select set_config('pfe.dry', link_erp_purchase_documents($$[
  {"erp_name":"PINV-D1","project_id":"03610000-0000-0000-0000-0000000000d1","group":"G"},
  {"erp_name":"PINV-D2","project_id":"03610000-0000-0000-0000-0000000000d1","group":"G"},
  {"erp_name":"PINV-1","procurement_id":"03610000-0000-0000-0000-0000000000e1"},
  {"erp_name":"PINV-2","procurement_id":"03610000-0000-0000-0000-0000000000e1"},
  {"erp_name":"NOPE"}]$$, true)::text, true);
reset role;
select is((select jsonb_agg(r->>'outcome' order by (r->>'row')::int) from jsonb_array_elements(current_setting('pfe.dry')::jsonb->'results') r),
  '["link","link","skip","refused","refused"]'::jsonb, 'AC-PFE-019 dry run reports link ×2, skip, refused ×2');
select ok((current_setting('pfe.dry')::jsonb #>> '{results,0,procurement_id}') is null
          and (current_setting('pfe.dry')::jsonb #>> '{results,0,new_purchase}') = 'true', 'AC-PFE-019 a would-be new purchase has no id in a dry run');
select ok(not exists (select 1 from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id where d.erp_name in ('PINV-D1','PINV-D2'))
          and not exists (select 1 from procurements where origin = 'erp_link'), 'AC-PFE-019 a dry run writes nothing');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select set_config('pfe.real', link_erp_purchase_documents($$[
  {"erp_name":"PINV-D1","project_id":"03610000-0000-0000-0000-0000000000d1","group":"G"},
  {"erp_name":"PINV-D2","project_id":"03610000-0000-0000-0000-0000000000d1","group":"G"},
  {"erp_name":"PINV-1","procurement_id":"03610000-0000-0000-0000-0000000000e1"},
  {"erp_name":"PINV-2","procurement_id":"03610000-0000-0000-0000-0000000000e1"},
  {"erp_name":"NOPE"}]$$, false)::text, true);
reset role;
select is((select jsonb_agg(jsonb_build_array(r->>'outcome', r->>'reason') order by (r->>'row')::int) from jsonb_array_elements(current_setting('pfe.real')::jsonb->'results') r),
          (select jsonb_agg(jsonb_build_array(r->>'outcome', r->>'reason') order by (r->>'row')::int) from jsonb_array_elements(current_setting('pfe.dry')::jsonb->'results') r),
  'AC-PFE-019 the real run reports exactly what the dry run reported');
select results_eq($$ select count(distinct l.procurement_id)::int, min(p.total_value), min(p.status::text), min(p.vendor_id::text), min(p.origin)
                       from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id
                       join procurements p on p.id = l.procurement_id where d.erp_name in ('PINV-D1','PINV-D2') $$,
  $$ values (1, 1200.00::numeric, 'Vendor Invoiced', '03610000-0000-0000-0000-0000000000c1', 'erp_link') $$,
  'FR-PFE-026/027 one grouped new purchase, total = invoice nets, vendor adopted from the supplier mapping');

-- Authorization and tenancy.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select link_erp_purchase_documents('[{"erp_name":"PINV-2"}]') $$, '42501', null, 'FR-PFE-020 an Engineer cannot link');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PINV-2"}]') #>> '{results,0,reason}', 'document_not_found', 'NFR-PFE-012 another org cannot reach the document');
reset role;
select throws_ok($$ insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id)
  select '03610000-0000-0000-0000-00000000000a','03610000-0000-0000-0000-0000000000e3', id from erp_purchase_documents where erp_name = 'PINV-1' $$,
  '23505', null, 'AC-PFE-008 the database refuses a second purchase for one document');

-- AC-PFE-023 unlink.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select unlink_erp_purchase_document((select l.id from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id where d.erp_name = 'PINV-3')) $$,
  '42501', null, 'AC-PFE-023 a Project Manager cannot unlink');
reset role;
select set_config('pfe.link3', (select l.id::text from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id where d.erp_name = 'PINV-3'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select lives_ok(format('select unlink_erp_purchase_document(%L)', current_setting('pfe.link3')), 'AC-PFE-023 an Admin unlinks');
select ok(exists (select 1 from erp_purchase_orphans where erp_name = 'PINV-3'), 'AC-PFE-023 the document is an orphan again');
reset role;
select is((select status::text from procurements where id = '03610000-0000-0000-0000-0000000000e3'), 'Vendor Invoiced', 'AC-PFE-023 FR-PFE-003 unlinking never moves status back');

select * from finish();
rollback;
