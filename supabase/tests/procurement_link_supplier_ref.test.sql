-- procurement_link_supplier_ref.test.sql — 0380. The supplier check of link_erp_purchase_documents reads a company's ERPNext
-- supplier identity from its 'Supplier:<id>' reference (the form the party feed writes, feedKinds.externalIdForKind), not
-- the raw reference text, so a correctly mapped vendor is no longer refused with supplier_mismatch. A 'Customer:' reference
-- is not a supplier identity; a legacy bare reference still counts. Link refusals generally: procurement_erp_links.
-- Mutation check: scripts/test-procurement-link-supplier-ref-rollback.sh (the raw compare restored refuses again).
begin;
select plan(14);

insert into organizations (id, name, default_currency) values ('03810000-0000-0000-0000-00000000000a','SR A','IDR');
insert into auth.users (id, email) values ('03810000-0000-0000-0000-0000000000a1','sr-fin-a@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03810000-0000-0000-0000-0000000000a1','03810000-0000-0000-0000-00000000000a','Fin A','sr-fin-a@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('03810000-0000-0000-0000-0000000000d1','03810000-0000-0000-0000-00000000000a','SR P1','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('03810000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"03810000-0000-0000-0000-0000000000d1":"ERP-P"}}'::jsonb, now(), 'active');
insert into companies (id, org_id, name, type, erp_supplier_name) values
  ('03810000-0000-0000-0000-0000000000c1','03810000-0000-0000-0000-00000000000a','Prefixed Co','Vendor',null),
  ('03810000-0000-0000-0000-0000000000c2','03810000-0000-0000-0000-00000000000a','Other Co','Vendor',null),
  ('03810000-0000-0000-0000-0000000000c3','03810000-0000-0000-0000-00000000000a','Both Co','Vendor','S-9'),
  ('03810000-0000-0000-0000-0000000000c4','03810000-0000-0000-0000-00000000000a','Plain Co','Vendor',null),
  ('03810000-0000-0000-0000-0000000000c5','03810000-0000-0000-0000-00000000000a','Legacy Co','Vendor',null);
-- A company holds one companies reference (unique org/domain/record), so a party that is also a customer carries its
-- 'Customer:' reference and is known as a supplier by erp_supplier_name.
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('03810000-0000-0000-0000-00000000000a','companies','03810000-0000-0000-0000-0000000000c1','erpnext','Supplier:S-1'),
  ('03810000-0000-0000-0000-00000000000a','companies','03810000-0000-0000-0000-0000000000c2','erpnext','Supplier:S-2'),
  ('03810000-0000-0000-0000-00000000000a','companies','03810000-0000-0000-0000-0000000000c3','erpnext','Customer:C-9'),
  ('03810000-0000-0000-0000-00000000000a','companies','03810000-0000-0000-0000-0000000000c5','erpnext','S-L');
insert into procurements (id, org_id, title, requested_by_id, project_id, vendor_id, currency, total_value, status) values
  ('03810000-0000-0000-0000-0000000000e1','03810000-0000-0000-0000-00000000000a','E1','03810000-0000-0000-0000-0000000000a1','03810000-0000-0000-0000-0000000000d1','03810000-0000-0000-0000-0000000000c1','IDR',10,'Draft'),
  ('03810000-0000-0000-0000-0000000000e2','03810000-0000-0000-0000-00000000000a','E2','03810000-0000-0000-0000-0000000000a1','03810000-0000-0000-0000-0000000000d1','03810000-0000-0000-0000-0000000000c1','IDR',10,'Draft'),
  ('03810000-0000-0000-0000-0000000000e3','03810000-0000-0000-0000-00000000000a','E3','03810000-0000-0000-0000-0000000000a1','03810000-0000-0000-0000-0000000000d1','03810000-0000-0000-0000-0000000000c3','IDR',10,'Draft'),
  ('03810000-0000-0000-0000-0000000000e4','03810000-0000-0000-0000-00000000000a','E4','03810000-0000-0000-0000-0000000000a1','03810000-0000-0000-0000-0000000000d1','03810000-0000-0000-0000-0000000000c3','IDR',10,'Draft'),
  ('03810000-0000-0000-0000-0000000000e5','03810000-0000-0000-0000-00000000000a','E5','03810000-0000-0000-0000-0000000000a1','03810000-0000-0000-0000-0000000000d1','03810000-0000-0000-0000-0000000000c4','IDR',10,'Draft'),
  ('03810000-0000-0000-0000-0000000000e6','03810000-0000-0000-0000-00000000000a','E6','03810000-0000-0000-0000-0000000000a1','03810000-0000-0000-0000-0000000000d1','03810000-0000-0000-0000-0000000000c4','IDR',10,'Draft'),
  ('03810000-0000-0000-0000-0000000000e7','03810000-0000-0000-0000-00000000000a','E7','03810000-0000-0000-0000-0000000000a1','03810000-0000-0000-0000-0000000000d1','03810000-0000-0000-0000-0000000000c5','IDR',10,'Draft'),
  ('03810000-0000-0000-0000-0000000000e8','03810000-0000-0000-0000-00000000000a','E8','03810000-0000-0000-0000-0000000000a1','03810000-0000-0000-0000-0000000000d1',null,'IDR',10,'Draft');
select upsert_erp_purchase_documents('03810000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"N1","supplier":"S-1","supplier_name":"Prefixed Co","erp_project":"ERP-P","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"N2","supplier":"S-1","supplier_name":"PT Prefixed","erp_project":"ERP-P","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"X1","supplier":"S-1","supplier_name":"PT Prefixed","erp_project":"ERP-P","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"X2","supplier":"S-2","supplier_name":"Prefixed Co","erp_project":"ERP-P","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"Y1","supplier":"S-9","supplier_name":"Anything","erp_project":"ERP-P","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"Y2","supplier":"C-9","supplier_name":"Anything","erp_project":"ERP-P","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"Z1","supplier":"S-P","supplier_name":" plain CO","erp_project":"ERP-P","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"Z2","supplier":"S-Q","supplier_name":"Someone Else","erp_project":"ERP-P","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"L1","supplier":"S-L","supplier_name":"Anything","erp_project":"ERP-P","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"V1","supplier":"S-1","supplier_name":"PT Prefixed","erp_project":"ERP-P","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"}
]$$::jsonb);

set local role authenticated;
set local request.jwt.claims = '{"sub":"03810000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('sr.r', link_erp_purchase_documents($$[
  {"erp_name":"N1","project_id":"03810000-0000-0000-0000-0000000000d1"},
  {"erp_name":"N2","project_id":"03810000-0000-0000-0000-0000000000d1"},
  {"erp_name":"X1","procurement_id":"03810000-0000-0000-0000-0000000000e1"},
  {"erp_name":"X2","procurement_id":"03810000-0000-0000-0000-0000000000e2"},
  {"erp_name":"Y1","procurement_id":"03810000-0000-0000-0000-0000000000e3"},
  {"erp_name":"Y2","procurement_id":"03810000-0000-0000-0000-0000000000e4"},
  {"erp_name":"Z1","procurement_id":"03810000-0000-0000-0000-0000000000e5"},
  {"erp_name":"Z2","procurement_id":"03810000-0000-0000-0000-0000000000e6"},
  {"erp_name":"L1","procurement_id":"03810000-0000-0000-0000-0000000000e7"},
  {"erp_name":"V1","procurement_id":"03810000-0000-0000-0000-0000000000e8"}]$$, false)::text, true);
reset role;

create function pg_temp.res(p_doc text) returns text language sql stable as $$
  select concat_ws(':', r->>'outcome', r->>'reason') from jsonb_array_elements(current_setting('sr.r')::jsonb->'results') r
   where r->>'erp_name' = p_doc $$;
create function pg_temp.vendor_of(p_doc text) returns uuid language sql stable as $$
  select p.vendor_id from procurements p join procurement_erp_links l on l.procurement_id = p.id
    join erp_purchase_documents d on d.id = l.erp_purchase_document_id where d.erp_name = p_doc $$;

-- New purchase from a document whose supplier maps to a company by its 'Supplier:' reference (the prod defect).
select is(pg_temp.res('N1'), 'link', 'AC-PFE-025 a new purchase links when the vendor''s reference is Supplier:<the document supplier>');
select is(pg_temp.vendor_of('N1'), '03810000-0000-0000-0000-0000000000c1'::uuid, 'AC-PFE-025 the new purchase''s vendor is that company');
select is(pg_temp.res('N2'), 'link', 'AC-PFE-025 a new purchase links when the ERP supplier name differs from the company name');
select is(pg_temp.vendor_of('N2'), '03810000-0000-0000-0000-0000000000c1'::uuid, 'AC-PFE-025 the Supplier: reference finds the vendor without the name');

-- Existing purchase with a vendor: the vendor's supplier reference decides.
select is(pg_temp.res('X1'), 'link', 'AC-PFE-025 the vendor''s own supplier''s document joins its purchase');
select is(pg_temp.res('X2'), 'refused:supplier_mismatch', 'AC-PFE-025 another supplier''s document is refused even when its name matches the vendor');

-- A party that is also a customer: its Customer: reference is not a supplier identity.
select is(pg_temp.res('Y1'), 'link', 'AC-PFE-025 a vendor with only a Customer: reference is checked by its erp supplier id');
select is(pg_temp.res('Y2'), 'refused:supplier_mismatch', 'AC-PFE-025 the party''s customer id is not accepted as its supplier');

-- No reference: the name / erp_supplier_name rule is unchanged.
select is(pg_temp.res('Z1'), 'link', 'AC-PFE-025 a vendor with no reference matches by trimmed, case-insensitive name');
select is(pg_temp.res('Z2'), 'refused:supplier_mismatch', 'AC-PFE-025 a vendor with no reference refuses another name');

-- A legacy bare reference still identifies the supplier.
select is(pg_temp.res('L1'), 'link', 'AC-PFE-025 a legacy bare supplier reference still matches');

-- A vendor-less purchase takes the vendor mapped by the Supplier: reference.
select is(pg_temp.res('V1'), 'link', 'FR-PFE-024 a vendor-less purchase takes the document');
select is((select vendor_id from procurements where id = '03810000-0000-0000-0000-0000000000e8'),
          '03810000-0000-0000-0000-0000000000c1'::uuid, 'FR-PFE-024 the vendor-less purchase gets the company mapped by Supplier:<supplier>');

-- Nothing else moved: the other purchases keep their vendors.
select is((select count(*)::int from procurements where org_id = '03810000-0000-0000-0000-00000000000a' and id <> '03810000-0000-0000-0000-0000000000e8'
             and origin is distinct from 'erp_link' and vendor_id is null), 0, 'FR-PFE-024 no purchase with a vendor lost it');

select * from finish();
rollback;
