-- erp_document_recorded_by_pmo.test.sql — 0378: an ERP purchase document is recorded by PMO only while a procurement
-- reference points at a live PMO record of the same kind. A reference to nothing (the production shape: a sweep
-- adopt claimed it, then refused to mint) no longer hides the document or refuses link / set-aside.
-- Mutation check: scripts/test-erp-document-recorded-by-pmo-rollback.sh (the 0361 predicate restored refuses again).
begin;
select plan(16);

insert into organizations (id, name, default_currency) values ('03780000-0000-0000-0000-00000000000a','RBP A','IDR');
insert into auth.users (id, email) values ('03780000-0000-0000-0000-0000000000a1','rbp-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03780000-0000-0000-0000-0000000000a1','03780000-0000-0000-0000-00000000000a','Fin','rbp-fin@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('03780000-0000-0000-0000-0000000000d1','03780000-0000-0000-0000-00000000000a','RBP P1','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('03780000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"03780000-0000-0000-0000-0000000000d1":"ERP-A"}}'::jsonb, now(), 'active');
-- A live PMO bill the dispatch path pushed as PINV-LIVE and as DUP-1.
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status) values
  ('03780000-0000-0000-0000-0000000000e1','03780000-0000-0000-0000-00000000000a','Pushed','03780000-0000-0000-0000-0000000000a1',
   '03780000-0000-0000-0000-0000000000d1','IDR',0,'Draft');
insert into procurement_invoices (id, procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values
  ('03780000-0000-0000-0000-0000000000f1','03780000-0000-0000-0000-0000000000e1','03780000-0000-0000-0000-00000000000a','Received',10,'IDR','exclusive',0),
  ('03780000-0000-0000-0000-0000000000f2','03780000-0000-0000-0000-0000000000e1','03780000-0000-0000-0000-00000000000a','Received',10,'IDR','exclusive',0);
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  -- dangling: no PMO record has these ids (the 2026-10-15 production shape)
  ('03780000-0000-0000-0000-00000000000a','procurement','7d1c0000-0000-4000-8000-000000000001','erpnext','PINV-DANGLE'),
  ('03780000-0000-0000-0000-00000000000a','procurement','7d1c0000-0000-4000-8000-000000000002','erpnext','PINV-DANGLE-2'),
  ('03780000-0000-0000-0000-00000000000a','procurement','7d1c0000-0000-4000-8000-000000000003','erpnext','PAY-DANGLE'),
  -- live
  ('03780000-0000-0000-0000-00000000000a','procurement','03780000-0000-0000-0000-0000000000f1','erpnext','PINV-LIVE'),
  ('03780000-0000-0000-0000-00000000000a','procurement','03780000-0000-0000-0000-0000000000f2','erpnext','DUP-1');
select upsert_erp_purchase_documents('03780000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-DANGLE","supplier":"SUP-1","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-DANGLE-2","supplier":"SUP-1","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Payment Entry","erp_name":"PAY-DANGLE","supplier":"SUP-1","currency":"IDR","grand_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-LIVE","supplier":"SUP-1","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"DUP-1","supplier":"SUP-1","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Payment Entry","erp_name":"DUP-1","supplier":"SUP-1","currency":"IDR","grand_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"}
]$$::jsonb);

-- The helper is internal.
select ok(not has_function_privilege('authenticated','public.erp_document_recorded_by_pmo(uuid,text,text)','execute')
          and not has_function_privilege('anon','public.erp_document_recorded_by_pmo(uuid,text,text)','execute'),
  'the recorded-by-PMO rule is not callable by clients');
-- Stored stamp.
select ok(not (select pmo_owned from erp_purchase_documents where erp_name = 'PINV-DANGLE'),
  'a Purchase Invoice whose procurement reference points at no PMO record is not recorded by PMO');
select ok(not (select pmo_owned from erp_purchase_documents where erp_name = 'PAY-DANGLE'),
  'a Payment Entry whose procurement reference points at no PMO record is not recorded by PMO');
select ok((select pmo_owned from erp_purchase_documents where erp_name = 'PINV-LIVE'),
  'a Purchase Invoice whose reference points at a live PMO vendor bill is recorded by PMO');
select ok((select pmo_owned from erp_purchase_documents where erp_doctype = 'Purchase Invoice' and erp_name = 'DUP-1'),
  'DUP-1 the Purchase Invoice is recorded by PMO');
select ok(not (select pmo_owned from erp_purchase_documents where erp_doctype = 'Payment Entry' and erp_name = 'DUP-1'),
  'a PMO bill''s reference does not hide a Payment Entry with the same name');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03780000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select array_agg(erp_doctype || ' ' || erp_name order by erp_doctype, erp_name) from erp_purchase_orphans),
  array['Payment Entry DUP-1','Payment Entry PAY-DANGLE','Purchase Invoice PINV-DANGLE','Purchase Invoice PINV-DANGLE-2'],
  'the unlinked list shows the documents with dangling references and the same-named Payment Entry, not the PMO bills');
-- Link.
select is(link_erp_purchase_documents('[{"erp_name":"PINV-DANGLE","erp_doctype":"Purchase Invoice","project_id":"03780000-0000-0000-0000-0000000000d1"}]') #>> '{results,0,outcome}',
  'link', 'a document with a dangling reference links into a purchase');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-LIVE","erp_doctype":"Purchase Invoice","project_id":"03780000-0000-0000-0000-0000000000d1"}]') #>> '{results,0,reason}',
  'document_recorded_by_pmo', 'a document PMO recorded is refused for linking');
select is(link_erp_purchase_documents('[{"erp_name":"DUP-1","erp_doctype":"Purchase Invoice","project_id":"03780000-0000-0000-0000-0000000000d1"}]') #>> '{results,0,reason}',
  'document_recorded_by_pmo', 'DUP-1 the Purchase Invoice is refused for linking');
-- Set aside.
select is(mark_erp_purchase_documents('[{"erp_name":"PINV-DANGLE-2","erp_doctype":"Purchase Invoice"}]') #>> '{results,0,outcome}',
  'apply', 'a document with a dangling reference can be set aside');
select is(mark_erp_purchase_documents('[{"erp_name":"DUP-1","erp_doctype":"Payment Entry"}]') #>> '{results,0,outcome}',
  'apply', 'the same-named Payment Entry can be set aside');
select is(mark_erp_purchase_documents('[{"erp_name":"PINV-LIVE","erp_doctype":"Purchase Invoice"}]') #>> '{results,0,reason}',
  'document_recorded_by_pmo', 'a document PMO recorded is refused for setting aside');
reset role;

-- The live check (M-2): a push recorded after the last mirror run is refused before the stamp catches up, and a
-- reference whose PMO record is gone stops refusing at once.
insert into procurement_invoices (id, procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values
  ('03780000-0000-0000-0000-0000000000f3','03780000-0000-0000-0000-0000000000e1','03780000-0000-0000-0000-00000000000a','Received',10,'IDR','exclusive',0);
update external_refs set pmo_record_id = '03780000-0000-0000-0000-0000000000f3'
 where org_id = '03780000-0000-0000-0000-00000000000a' and domain = 'procurement' and external_record_id = 'PAY-DANGLE';
select ok(not (select pmo_owned from erp_purchase_documents where erp_name = 'PAY-DANGLE'), 'fixture: the stored stamp has not caught up');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03780000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PAY-DANGLE","erp_doctype":"Payment Entry","project_id":"03780000-0000-0000-0000-0000000000d1"}]') #>> '{results,0,outcome}',
  'link', 'a bill reference does not make a Payment Entry recorded by PMO, even when the bill is live');
reset role;
delete from procurement_invoices where id = '03780000-0000-0000-0000-0000000000f1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03780000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(mark_erp_purchase_documents('[{"erp_name":"PINV-LIVE","erp_doctype":"Purchase Invoice"}]') #>> '{results,0,outcome}',
  'apply', 'once the PMO bill is gone its reference no longer refuses the document');
reset role;
select * from finish();
rollback;
