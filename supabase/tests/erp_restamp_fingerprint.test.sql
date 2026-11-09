-- erp_restamp_fingerprint.test.sql — 0819 (#1276): the re-stamp runs only when its inputs changed since the last one;
-- a project-map change re-stamps everything once.
begin;
select plan(5);

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

select * from finish();
rollback;
