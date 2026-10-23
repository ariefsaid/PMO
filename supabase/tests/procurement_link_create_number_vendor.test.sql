-- procurement_link_create_number_vendor.test.sql — 0369. "New purchase from this" numbers the purchase and finds its vendor.
-- Owns AC-PFE-026n (purchase number) and AC-PFE-026v (vendor) at the link RPC; link refusals are in procurement_erp_links.
begin;
select plan(18);

insert into organizations (id, name, default_currency) values
  ('03690000-0000-0000-0000-00000000000a','NV A','IDR'), ('03690000-0000-0000-0000-00000000000b','NV B','IDR');
insert into auth.users (id, email) values
  ('03690000-0000-0000-0000-0000000000a1','nv-fin-a@example.com'), ('03690000-0000-0000-0000-0000000000b1','nv-fin-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03690000-0000-0000-0000-0000000000a1','03690000-0000-0000-0000-00000000000a','Fin A','nv-fin-a@example.com','Finance','active'),
  ('03690000-0000-0000-0000-0000000000b1','03690000-0000-0000-0000-00000000000b','Fin B','nv-fin-b@example.com','Finance','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('03690000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref','{"company":"Example Co"}'::jsonb, now(), 'active'),
  ('03690000-0000-0000-0000-00000000000b','erpnext','https://erp-b.example.test','test-ref','{"company":"Example B"}'::jsonb, now(), 'active');
insert into companies (id, org_id, name, type, erp_supplier_name, archived_at) values
  ('03690000-0000-0000-0000-0000000000c1','03690000-0000-0000-0000-00000000000a','Acme Supply','Vendor',null,null),
  ('03690000-0000-0000-0000-0000000000c2','03690000-0000-0000-0000-00000000000a','Beta Ltd','Vendor','SUP-BETA',null),
  ('03690000-0000-0000-0000-0000000000c3','03690000-0000-0000-0000-00000000000a','Dup Co','Vendor',null,null),
  ('03690000-0000-0000-0000-0000000000c4','03690000-0000-0000-0000-00000000000a','dup co ','Vendor',null,null),
  ('03690000-0000-0000-0000-0000000000c5','03690000-0000-0000-0000-00000000000a','Gone Co','Vendor',null,now()),
  ('03690000-0000-0000-0000-0000000000c6','03690000-0000-0000-0000-00000000000a','Mapped Co','Vendor',null,null),
  ('03690000-0000-0000-0000-0000000000d1','03690000-0000-0000-0000-00000000000b','Cross Supplier','Vendor','SUP-CROSS',null),
  ('03690000-0000-0000-0000-0000000000d2','03690000-0000-0000-0000-00000000000b','Acme Supply B','Vendor',null,null);
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('03690000-0000-0000-0000-00000000000a','companies','03690000-0000-0000-0000-0000000000c6','erpnext','SUP-MAP'),
  ('03690000-0000-0000-0000-00000000000b','companies','03690000-0000-0000-0000-0000000000d1','erpnext','SUP-CROSS');
select upsert_erp_purchase_documents('03690000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"D-MAP","supplier":"SUP-MAP","supplier_name":"Anything","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"D-NAME","supplier":"SUP-N","supplier_name":"  ACME supply ","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"D-ERP","supplier":"SUP-BETA","supplier_name":"Unrelated Name","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"D-ERP2","supplier":"SUP-BETA","supplier_name":"Unrelated Name","currency":"IDR","grand_total":5,"net_total":5,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"D-AMB","supplier":"SUP-D","supplier_name":"Dup Co","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"D-NONE","supplier":"SUP-Z","supplier_name":"Nobody Ltd","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"D-ARCH","supplier":"SUP-G","supplier_name":"Gone Co","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"D-CROSS","supplier":"SUP-CROSS","supplier_name":"Cross Supplier","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"D-XNAME","supplier":"SUP-XN","supplier_name":"Acme Supply B","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"}
]$$::jsonb);
select upsert_erp_purchase_documents('03690000-0000-0000-0000-00000000000b', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"B-ACME","supplier":"SUP-A","supplier_name":"Acme Supply","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"}
]$$::jsonb);

set local role authenticated;
set local request.jwt.claims = '{"sub":"03690000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('nv.a', link_erp_purchase_documents($$[
  {"erp_name":"D-MAP"},{"erp_name":"D-NAME"},{"erp_name":"D-ERP"},{"erp_name":"D-AMB"},
  {"erp_name":"D-NONE"},{"erp_name":"D-ARCH"},{"erp_name":"D-CROSS"},{"erp_name":"D-XNAME"}]$$, false)::text, true);
reset role;
select is((select count(*)::int from jsonb_array_elements(current_setting('nv.a')::jsonb->'results') r where r->>'outcome' = 'link' and (r->>'new_purchase')::boolean),
          8, 'FR-PFE-026 all eight rows created a new purchase with no project (no project is allowed)');

create function pg_temp.pur(p_doc text) returns public.procurements language sql stable as $$
  select p.* from procurements p join procurement_erp_links l on l.procurement_id = p.id
    join erp_purchase_documents d on d.id = l.erp_purchase_document_id where d.erp_name = p_doc $$;

-- Number: the normal minter, per org, in sequence.
select ok((select bool_and(code ~ '^PROC-[0-9]{6}[0-9]{4}$' and code like 'PROC-' || to_char(current_date, 'YYMMDD') || '%')
             from procurements where origin = 'erp_link' and org_id = '03690000-0000-0000-0000-00000000000a'),
  'AC-PFE-026n a created purchase has a number in the normal PROC-YYMMDD#### format');
select is((select string_agg(right(code, 4), ',' order by code) from procurements where origin = 'erp_link' and org_id = '03690000-0000-0000-0000-00000000000a'),
          '0001,0002,0003,0004,0005,0006,0007,0008', 'AC-PFE-026n numbers follow the minter sequence, one per purchase');
select is((select last_seq from procurement_doc_counters where org_id = '03690000-0000-0000-0000-00000000000a' and prefix = 'PROC' and doc_date = current_date),
          8, 'AC-PFE-026n the numbers come from procurement_doc_counters');
select ok((select bool_and(pr_number is null and po_number is null) from procurements where origin = 'erp_link'),
  'AC-PFE-026n a created purchase carries no request or order number (it never had a request)');

-- Vendor.
select is((pg_temp.pur('D-MAP')).vendor_id, '03690000-0000-0000-0000-0000000000c6'::uuid, 'AC-PFE-026v the companies mapping wins over the name');
select is((pg_temp.pur('D-NAME')).vendor_id, '03690000-0000-0000-0000-0000000000c1'::uuid, 'AC-PFE-026v an unmapped supplier matches one company by trimmed, case-insensitive name');
select is((pg_temp.pur('D-ERP')).vendor_id, '03690000-0000-0000-0000-0000000000c2'::uuid, 'AC-PFE-026v the company that records this ERP supplier id is the vendor');
select is((pg_temp.pur('D-AMB')).vendor_id, null, 'AC-PFE-026v two companies with the name leave the vendor empty');
select is((pg_temp.pur('D-NONE')).vendor_id, null, 'AC-PFE-026v a supplier matching no company leaves the vendor empty');
select is((pg_temp.pur('D-ARCH')).vendor_id, null, 'AC-PFE-026v an archived company is never matched');
select is((pg_temp.pur('D-CROSS')).vendor_id, null, 'NFR-PFE-012 another org''s company is never matched, by mapping or by erp supplier id');
select is((pg_temp.pur('D-XNAME')).vendor_id, null, 'NFR-PFE-012 another org''s company is never matched by name');

-- The vendor found by erp supplier id does not make the same supplier's next document a supplier_mismatch.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03690000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents(format('[{"erp_name":"D-ERP2","procurement_id":"%s"}]', (pg_temp.pur('D-ERP')).id)::jsonb) #>> '{results,0,outcome}',
          'link', 'AC-PFE-026v a second document of the supplier joins the purchase (no supplier_mismatch)');
reset role;

-- An existing purchase with no vendor keeps the 0361 rule: only the mapped company, never a guessed one.
insert into procurements (id, org_id, title, requested_by_id, project_id, vendor_id, currency, total_value, status) values
  ('03690000-0000-0000-0000-0000000000e1','03690000-0000-0000-0000-00000000000a','Own','03690000-0000-0000-0000-0000000000a1',null,null,'IDR',10,'Draft');
select upsert_erp_purchase_documents('03690000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"D-OWN","supplier":"SUP-N","supplier_name":"Acme Supply","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"}]$$::jsonb);
set local role authenticated;
set local request.jwt.claims = '{"sub":"03690000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"D-OWN","procurement_id":"03690000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,outcome}', 'link', 'FR-PFE-024 a vendor-less purchase of the user takes the document');
reset role;
select is((select vendor_id from procurements where id = '03690000-0000-0000-0000-0000000000e1'), null, 'FR-PFE-024 a user''s vendor-less purchase gets no name-guessed vendor');
select is((select code from procurements where id = '03690000-0000-0000-0000-0000000000e1'), null, 'AC-PFE-026n linking does not number a purchase the link did not create');

-- Another org: its own numbering and no cross-org match.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03690000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select set_config('nv.b', link_erp_purchase_documents('[{"erp_name":"B-ACME"}]', false)::text, true);
reset role;
select ok((select p.vendor_id is null and p.code like 'PROC-%0001' from procurements p join procurement_erp_links l on l.procurement_id = p.id join erp_purchase_documents d on d.id = l.erp_purchase_document_id where d.erp_name = 'B-ACME'),
  'NFR-PFE-012 org B gets its own sequence and org A''s "Acme Supply" is not its vendor');

select * from finish();
rollback;
