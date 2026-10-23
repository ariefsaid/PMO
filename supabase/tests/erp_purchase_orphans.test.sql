-- erp_purchase_orphans.test.sql — 0360/0361. Owns AC-PFE-016, AC-PFE-017.
begin;
select plan(6);
insert into organizations (id, name, default_currency) values
  ('03630000-0000-0000-0000-00000000000a','PFO A','IDR'), ('03630000-0000-0000-0000-00000000000b','PFO B','IDR');
insert into auth.users (id, email) values
  ('03630000-0000-0000-0000-0000000000a1','pfo-fin@example.com'), ('03630000-0000-0000-0000-0000000000a2','pfo-eng@example.com'),
  ('03630000-0000-0000-0000-0000000000b1','pfo-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03630000-0000-0000-0000-0000000000a1','03630000-0000-0000-0000-00000000000a','Fin','pfo-fin@example.com','Finance','active'),
  ('03630000-0000-0000-0000-0000000000a2','03630000-0000-0000-0000-00000000000a','Eng','pfo-eng@example.com','Engineer','active'),
  ('03630000-0000-0000-0000-0000000000b1','03630000-0000-0000-0000-00000000000b','B','pfo-b@example.com','Finance','active');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('03630000-0000-0000-0000-00000000000a','procurement','pmo-x','erpnext','PI-PMO');
select upsert_erp_purchase_documents('03630000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PI-ORPHAN","supplier":"S","currency":"IDR","grand_total":1,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PI-LINKED","supplier":"S","currency":"IDR","grand_total":1,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PI-PMO","supplier":"S","currency":"IDR","grand_total":1,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PI-CANCEL","supplier":"S","currency":"IDR","grand_total":1,"erp_docstatus":2,"erp_modified":"2026-02-01"}]$$::jsonb);
select upsert_erp_purchase_documents('03630000-0000-0000-0000-00000000000b',
  '[{"erp_doctype":"Purchase Invoice","erp_name":"PI-B","supplier":"S","currency":"IDR","grand_total":1,"erp_docstatus":1,"erp_modified":"2026-02-01"}]');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status) values
  ('03630000-0000-0000-0000-0000000000e1','03630000-0000-0000-0000-00000000000a','P1','03630000-0000-0000-0000-0000000000a1','IDR',1,'Draft'),
  ('03630000-0000-0000-0000-0000000000e2','03630000-0000-0000-0000-00000000000a','P2','03630000-0000-0000-0000-0000000000a1','IDR',1,'Draft');
insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id)
  select '03630000-0000-0000-0000-00000000000a','03630000-0000-0000-0000-0000000000e1', id from erp_purchase_documents where erp_name = 'PI-LINKED';
insert into purchase_orders (id, procurement_id, org_id, status) values
  ('03630000-0000-0000-0000-0000000000f2','03630000-0000-0000-0000-0000000000e2','03630000-0000-0000-0000-00000000000a','Issued');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03630000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select array_agg(erp_name order by erp_name) from erp_purchase_orphans), array['PI-ORPHAN'], 'AC-PFE-016 orphans = unlinked, submitted, not PMO-pushed, own org');
select is((select count(*) from procurement_erp_links), 1::bigint, 'AC-PFE-016 Finance reads its org''s links');
select throws_ok($$ select link_procurement_sharepoint_item('03630000-0000-0000-0000-0000000000e1','purchase_order','03630000-0000-0000-0000-0000000000f2',
  '{"drive_id":"d","item_id":"i","web_url":"https://example.sharepoint.com/sites/s/a.pdf","name":"a.pdf","kind":"file"}') $$,
  '23514', null, 'AC-PFE-017 a file cannot target a record of another purchase');
select lives_ok($$ select link_procurement_sharepoint_item('03630000-0000-0000-0000-0000000000e2','purchase_order','03630000-0000-0000-0000-0000000000f2',
  '{"drive_id":"d","item_id":"i","web_url":"https://example.sharepoint.com/sites/s/a.pdf","name":"a.pdf","kind":"file"}') $$,
  'AC-PFE-017 a file targets a record of its own purchase');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03630000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*) from erp_purchase_orphans), 0::bigint, 'AC-PFE-016 an Engineer reads no orphans');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03630000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select array_agg(erp_name) from erp_purchase_orphans), array['PI-B'], 'AC-PFE-016 org B sees only its own orphans');
reset role;
select * from finish();
rollback;
