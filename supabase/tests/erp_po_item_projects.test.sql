-- erp_po_item_projects.test.sql — 0815 (#1276): a Purchase Order attributes to every project its item lines name,
-- unioned with the header project; no item projects keeps header attribution.
begin;
select plan(5);

insert into organizations (id, name, default_currency) values ('08150000-0000-0000-0000-00000000000a','IP A','IDR');
insert into projects (id, org_id, name, status) values
  ('08150000-0000-0000-0000-0000000000d1','08150000-0000-0000-0000-00000000000a','IP P1','Ongoing Project'),
  ('08150000-0000-0000-0000-0000000000d2','08150000-0000-0000-0000-00000000000a','IP P2','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('08150000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"08150000-0000-0000-0000-0000000000d1":"ERP-A","08150000-0000-0000-0000-0000000000d2":"ERP-B"}}'::jsonb, now(), 'active');

select upsert_erp_purchase_documents('08150000-0000-0000-0000-00000000000a', '[
  {"erp_doctype":"Purchase Order","erp_name":"IP-SPLIT","grand_total":10,"erp_docstatus":1,"erp_project":null,"item_projects":["ERP-A","ERP-B"],"erp_modified":"2026-02-01"},
  {"erp_doctype":"Purchase Order","erp_name":"IP-HEADER","grand_total":10,"erp_docstatus":1,"erp_project":"ERP-A","item_projects":[],"erp_modified":"2026-02-01"},
  {"erp_doctype":"Purchase Order","erp_name":"IP-UNION","grand_total":10,"erp_docstatus":1,"erp_project":"ERP-A","item_projects":["ERP-B"],"erp_modified":"2026-02-01"}
]'::jsonb);

select is((select project_ids from erp_purchase_documents where erp_name='IP-SPLIT'),
  array['08150000-0000-0000-0000-0000000000d1','08150000-0000-0000-0000-0000000000d2']::uuid[], 'a split PO lists under both item projects');
select is((select project_ids from erp_purchase_documents where erp_name='IP-HEADER'),
  array['08150000-0000-0000-0000-0000000000d1']::uuid[], 'items without a project keep the header project');
select is((select project_ids from erp_purchase_documents where erp_name='IP-UNION'),
  array['08150000-0000-0000-0000-0000000000d1','08150000-0000-0000-0000-0000000000d2']::uuid[], 'header and items that disagree give the union');

-- Same ERP version re-read fills item projects on a row mirrored without them.
select upsert_erp_purchase_documents('08150000-0000-0000-0000-00000000000a',
  '[{"erp_doctype":"Purchase Order","erp_name":"IP-HEADER","grand_total":10,"erp_docstatus":1,"erp_project":"ERP-A","item_projects":["ERP-B"],"erp_modified":"2026-02-01"}]'::jsonb);
select is((select project_ids from erp_purchase_documents where erp_name='IP-HEADER'),
  array['08150000-0000-0000-0000-0000000000d1','08150000-0000-0000-0000-0000000000d2']::uuid[], 'a same-version re-read fills item projects');

select ok(has_function_privilege('service_role', 'public.upsert_erp_purchase_documents(uuid,jsonb,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.upsert_erp_purchase_documents(uuid,jsonb,boolean)', 'execute'),
  'service_role only');

select * from finish();
rollback;
