-- erp_upsert_restamp_flag.test.sql — 0769 (#1290): upsert_erp_purchase_documents re-stamps project links and the
-- PMO-owned flag org-wide only when p_restamp is true (the default). Page writes of a catch-up send false.
begin;
select plan(7);

insert into organizations (id, name, default_currency) values ('07690000-0000-0000-0000-00000000000a','RSF A','IDR');
insert into projects (id, org_id, name, status) values
  ('07690000-0000-0000-0000-0000000000d1','07690000-0000-0000-0000-00000000000a','RSF P1','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('07690000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"07690000-0000-0000-0000-0000000000d1":"ERP-A"}}'::jsonb, now(), 'active');

-- Mirror one document, re-stamped (default): it maps to the project.
select upsert_erp_purchase_documents('07690000-0000-0000-0000-00000000000a',
  '[{"erp_doctype":"Purchase Order","erp_name":"RSF-PO-1","grand_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"}]');
select is((select project_ids from erp_purchase_documents where erp_name='RSF-PO-1'),
  array['07690000-0000-0000-0000-0000000000d1']::uuid[], 'the default call re-stamps the project link');

-- Make that row stale, then page-write ANOTHER row with p_restamp false: the stale row is not touched.
update erp_purchase_documents set project_ids = '{}', pmo_owned = true where erp_name='RSF-PO-1';
select is(upsert_erp_purchase_documents('07690000-0000-0000-0000-00000000000a',
  '[{"erp_doctype":"Purchase Order","erp_name":"RSF-PO-2","grand_total":20,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-02"}]'::jsonb,
  false), 1, 'p_restamp false still writes the page rows');
select is((select project_ids from erp_purchase_documents where erp_name='RSF-PO-1'), '{}'::uuid[],
  'p_restamp false leaves other rows project links alone');
select is((select pmo_owned from erp_purchase_documents where erp_name='RSF-PO-1'), true,
  'p_restamp false leaves other rows PMO-owned flag alone');
select is((select project_ids from erp_purchase_documents where erp_name='RSF-PO-2'), '{}'::uuid[],
  'p_restamp false leaves the new row unstamped until the tick re-stamp');

-- The tick re-stamp (empty rows, true) fixes both rows.
select upsert_erp_purchase_documents('07690000-0000-0000-0000-00000000000a', '[]'::jsonb, true);
select is((select count(*)::int from erp_purchase_documents
            where erp_name in ('RSF-PO-1','RSF-PO-2') and project_ids = array['07690000-0000-0000-0000-0000000000d1']::uuid[] and not pmo_owned),
  2, 'p_restamp true re-stamps every row of the org');

select ok(has_function_privilege('service_role', 'public.upsert_erp_purchase_documents(uuid,jsonb,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.upsert_erp_purchase_documents(uuid,jsonb,boolean)', 'execute'),
  'service_role only');

select * from finish();
rollback;
