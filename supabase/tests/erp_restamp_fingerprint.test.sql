-- erp_restamp_fingerprint.test.sql — 0819 (#1276): the re-stamp runs only when its inputs changed since the last one;
-- a project-map change re-stamps everything once.
begin;
select plan(7);

insert into organizations (id, name, default_currency) values ('08190000-0000-0000-0000-00000000000a','FP A','IDR');
insert into projects (id, org_id, name, status) values
  ('08190000-0000-0000-0000-0000000000d1','08190000-0000-0000-0000-00000000000a','FP P1','Ongoing Project'),
  ('08190000-0000-0000-0000-0000000000d2','08190000-0000-0000-0000-00000000000a','FP P2','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('08190000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"08190000-0000-0000-0000-0000000000d1":"ERP-A"}}'::jsonb, now(), 'active');

select upsert_erp_purchase_documents('08190000-0000-0000-0000-00000000000a',
  '[{"erp_doctype":"Purchase Order","erp_name":"FP-PO-1","grand_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"}]');
select is((select project_ids from erp_purchase_documents where erp_name='FP-PO-1'),
  array['08190000-0000-0000-0000-0000000000d1']::uuid[], 'the first re-stamp stamps the row');

-- Nothing changed: a tick re-stamp is skipped, so a hand-made stale value survives.
update erp_purchase_documents set project_ids = '{}' where erp_name='FP-PO-1';
select upsert_erp_purchase_documents('08190000-0000-0000-0000-00000000000a', '[]'::jsonb, true);
select is((select project_ids from erp_purchase_documents where erp_name='FP-PO-1'), '{}'::uuid[],
  'an unchanged tick skips the re-stamp');

-- Project map changed: everything is re-stamped once.
update external_org_bindings set config = '{"company":"Example Co","project_map":{"08190000-0000-0000-0000-0000000000d2":"ERP-A"}}'::jsonb
 where org_id = '08190000-0000-0000-0000-00000000000a';
select upsert_erp_purchase_documents('08190000-0000-0000-0000-00000000000a', '[]'::jsonb, true);
select is((select project_ids from erp_purchase_documents where erp_name='FP-PO-1'),
  array['08190000-0000-0000-0000-0000000000d2']::uuid[], 'a project-map change re-stamps every row');

-- ...and then settles again.
update erp_purchase_documents set project_ids = '{}' where erp_name='FP-PO-1';
select upsert_erp_purchase_documents('08190000-0000-0000-0000-00000000000a', '[]'::jsonb, true);
select is((select project_ids from erp_purchase_documents where erp_name='FP-PO-1'), '{}'::uuid[],
  'the tick after a project-map re-stamp is skipped again');

-- A changed document (same ERP version fill) is re-stamped.
select upsert_erp_purchase_documents('08190000-0000-0000-0000-00000000000a',
  '[{"erp_doctype":"Purchase Order","erp_name":"FP-PO-1","grand_total":10,"erp_docstatus":1,"erp_project":"ERP-A","item_projects":["ERP-A"],"erp_modified":"2026-02-01"}]'::jsonb);
select is((select project_ids from erp_purchase_documents where erp_name='FP-PO-1'),
  array['08190000-0000-0000-0000-0000000000d2']::uuid[], 'a changed document re-stamps');

-- A PMO bill swapped for another (one deleted, one created: equal counts) still re-stamps pmo_owned.
insert into auth.users (id, email) values ('08190000-0000-0000-0000-0000000000a1','fp-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08190000-0000-0000-0000-0000000000a1','08190000-0000-0000-0000-00000000000a','Fin','fp-fin@example.com','Finance','active');
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status) values
  ('08190000-0000-0000-0000-0000000000e1','08190000-0000-0000-0000-00000000000a','FP Pushed','08190000-0000-0000-0000-0000000000a1',
   '08190000-0000-0000-0000-0000000000d1','IDR',0,'Draft');
insert into procurement_invoices (id, procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values
  ('08190000-0000-0000-0000-0000000000f1','08190000-0000-0000-0000-0000000000e1','08190000-0000-0000-0000-00000000000a','Received',10,'IDR','exclusive',0);
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('08190000-0000-0000-0000-00000000000a','procurement','08190000-0000-0000-0000-0000000000f1','erpnext','FP-PINV-1');
select upsert_erp_purchase_documents('08190000-0000-0000-0000-00000000000a',
  '[{"erp_doctype":"Purchase Invoice","erp_name":"FP-PINV-1","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"}]'::jsonb);
select ok((select pmo_owned from erp_purchase_documents where erp_name='FP-PINV-1'), 'fixture: the pushed bill is recorded by PMO');
delete from procurement_invoices where id = '08190000-0000-0000-0000-0000000000f1';
insert into procurement_invoices (id, procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values
  ('08190000-0000-0000-0000-0000000000f2','08190000-0000-0000-0000-0000000000e1','08190000-0000-0000-0000-00000000000a','Received',10,'IDR','exclusive',0);
select upsert_erp_purchase_documents('08190000-0000-0000-0000-00000000000a', '[]'::jsonb, true);
select ok(not (select pmo_owned from erp_purchase_documents where erp_name='FP-PINV-1'),
  'a PMO bill deleted and another created between ticks still re-stamps pmo_owned');

select * from finish();
rollback;
