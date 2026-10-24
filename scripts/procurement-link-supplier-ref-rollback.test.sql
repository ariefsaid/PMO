-- Round trip for 0381 (the supplier check reads a company's 'Supplier:<id>' reference): down, then up again.
-- Run by scripts/test-procurement-link-supplier-ref-rollback.sh, which inlines the migration files at the markers.
-- The down half is the mutation check: on the raw compare a correctly mapped vendor is refused and never found.
begin;
select plan(8);
insert into organizations (id, name, default_currency) values ('03819000-0000-0000-0000-00000000000a','SR RT','IDR');
insert into auth.users (id, email) values ('03819000-0000-0000-0000-0000000000a1','sr-rt@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03819000-0000-0000-0000-0000000000a1','03819000-0000-0000-0000-00000000000a','RT Fin','sr-rt@example.com','Finance','active');
insert into companies (id, org_id, name, type) values
  ('03819000-0000-0000-0000-0000000000c1','03819000-0000-0000-0000-00000000000a','RT Supplier','Vendor');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('03819000-0000-0000-0000-00000000000a','companies','03819000-0000-0000-0000-0000000000c1','erpnext','Supplier:S-RT');
insert into procurements (id, org_id, title, requested_by_id, vendor_id, currency, total_value, status) values
  ('03819000-0000-0000-0000-0000000000e1','03819000-0000-0000-0000-00000000000a','RT','03819000-0000-0000-0000-0000000000a1','03819000-0000-0000-0000-0000000000c1','IDR',10,'Draft');
select upsert_erp_purchase_documents('03819000-0000-0000-0000-00000000000a',
  '[{"erp_doctype":"Purchase Invoice","erp_name":"PINV-SR","supplier":"S-RT","supplier_name":"PT Other Name","currency":"IDR","grand_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"}]');
-- @0381_DOWN@
set local role authenticated;
set local request.jwt.claims = '{"sub":"03819000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PINV-SR","procurement_id":"03819000-0000-0000-0000-0000000000e1"}]', true) #>> '{results,0,reason}',
  'supplier_mismatch', 'down 0381 (mutation check): the raw compare refuses the mapped vendor');
reset role;
select is(erp_supplier_company('03819000-0000-0000-0000-00000000000a', 'S-RT', 'PT Other Name'), null,
  'down 0381 (mutation check): the raw compare never finds the mapped company');
select ok(pg_get_functiondef('public.link_erp_purchase_documents(jsonb,boolean)'::regprocedure) not like '%0381%', 'down 0381: the 0378 link body');
select ok(pg_get_functiondef('public.erp_supplier_company(uuid,text,text)'::regprocedure) not like '%0381%', 'down 0381: the 0369 resolver body');
-- @0381_UP@
set local role authenticated;
set local request.jwt.claims = '{"sub":"03819000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PINV-SR","procurement_id":"03819000-0000-0000-0000-0000000000e1"}]', true) #>> '{results,0,outcome}',
  'link', 'up again: the mapped vendor''s document links');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-SR"}]', true) #>> '{results,0,outcome}',
  'link', 'up again: a new purchase from the document links');
reset role;
select is(erp_supplier_company('03819000-0000-0000-0000-00000000000a', 'S-RT', 'PT Other Name'), '03819000-0000-0000-0000-0000000000c1'::uuid,
  'up again: the Supplier: reference finds the company');
select ok(not has_function_privilege('authenticated', 'public.erp_supplier_company(uuid,text,text)', 'execute'),
  'up again: the resolver has no client grant');
select * from finish();
rollback;
