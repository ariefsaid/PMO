-- procurement_no_double_count.test.sql — 0361. Owns AC-PFE-005 (FR-PFE-035..037, NFR-PFE-001/002).
begin;
select plan(10);
insert into organizations (id, name, default_currency) values
  ('03620000-0000-0000-0000-00000000000a','PFE Ledger','IDR'), ('03620000-0000-0000-0000-00000000000b','PFE Native','IDR');
insert into auth.users (id, email) values
  ('03620000-0000-0000-0000-0000000000a1','pfel@example.com'), ('03620000-0000-0000-0000-0000000000a2','pfel-eng@example.com'), ('03620000-0000-0000-0000-0000000000b1','pfen@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03620000-0000-0000-0000-0000000000a1','03620000-0000-0000-0000-00000000000a','L Fin','pfel@example.com','Finance','active'),
  ('03620000-0000-0000-0000-0000000000a2','03620000-0000-0000-0000-00000000000a','L Eng','pfel-eng@example.com','Engineer','active'),
  ('03620000-0000-0000-0000-0000000000b1','03620000-0000-0000-0000-00000000000b','N Fin','pfen@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('03620000-0000-0000-0000-0000000000d1','03620000-0000-0000-0000-00000000000a','L P1','Ongoing Project'),
  ('03620000-0000-0000-0000-0000000000d2','03620000-0000-0000-0000-00000000000b','N P1','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('03620000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"03620000-0000-0000-0000-0000000000d1":"ERP-L"}}'::jsonb, now(), 'active');
select upsert_erp_purchase_documents('03620000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-L","supplier":"S","supplier_name":"S","currency":"IDR","grand_total":666,"net_total":600,"erp_docstatus":1,"erp_project":"ERP-L","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-RET","supplier":"S","supplier_name":"S","currency":"IDR","grand_total":-111,"net_total":-100,"erp_docstatus":1,"is_return":true,"erp_project":"ERP-L","erp_modified":"2026-02-01"}]$$::jsonb);
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status) values
  ('03620000-0000-0000-0000-0000000000e1','03620000-0000-0000-0000-00000000000a','OL', '03620000-0000-0000-0000-0000000000a1','03620000-0000-0000-0000-0000000000d1','IDR',1000,'Ordered'),
  ('03620000-0000-0000-0000-0000000000e2','03620000-0000-0000-0000-00000000000a','OL2','03620000-0000-0000-0000-0000000000a1','03620000-0000-0000-0000-0000000000d1','IDR',500,'Vendor Invoiced'),
  ('03620000-0000-0000-0000-0000000000e3','03620000-0000-0000-0000-00000000000b','ON', '03620000-0000-0000-0000-0000000000b1','03620000-0000-0000-0000-0000000000d2','IDR',1000,'Vendor Invoiced'),
  ('03620000-0000-0000-0000-0000000000e4','03620000-0000-0000-0000-00000000000a','OE', '03620000-0000-0000-0000-0000000000a2',null,'IDR',400,'Vendor Invoiced');
-- OL2: a PMO-pushed invoice mirrored as submitted (exclusive: amount is pre-tax). ON: same shape in a non-ledger org.
insert into procurement_invoices (procurement_id, org_id, status, amount, tax_amount, tax_treatment, currency, erp_docstatus) values
  ('03620000-0000-0000-0000-0000000000e2','03620000-0000-0000-0000-00000000000a','Received',300,33,'exclusive','IDR',1),
  ('03620000-0000-0000-0000-0000000000e3','03620000-0000-0000-0000-00000000000b','Received',600,66,'exclusive','IDR',1),
  ('03620000-0000-0000-0000-0000000000e4','03620000-0000-0000-0000-00000000000a','Received',200,22,'exclusive','IDR',1);
create temp table actuals_before as select * from project_mapped_actuals('03620000-0000-0000-0000-0000000000d1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PINV-L","procurement_id":"03620000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,outcome}', 'link', 'fixture: invoice linked');
select is((select procurement_open_commitment(p) from procurements p where p.id = '03620000-0000-0000-0000-0000000000e1'), 400::numeric,
  'AC-PFE-005 open commitment excludes the linked invoice''s ledger-held net (1000 − 600)');
select is((select procurement_open_commitment(p) from procurements p where p.id = '03620000-0000-0000-0000-0000000000e2'), 200::numeric,
  'AC-PFE-005 open commitment excludes a PMO-pushed, ledger-submitted invoice (500 − 300)');
select is((select coalesce(sum(amount) filter (where is_project_currency), 0) from project_committed_spend('03620000-0000-0000-0000-0000000000d1')), 600::numeric, 'AC-PFE-005 project committed spend = Σ open commitment');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-RET","procurement_id":"03620000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,reason}', 'document_is_return', 'M-6 a return / debit note is refused');
select is((select procurement_open_commitment(p) from procurements p where p.id = '03620000-0000-0000-0000-0000000000e1'), 400::numeric,
  'AC-PFE-005 a refused return leaves the open commitment unchanged (1000 − 600)');
reset role;
select ok(not exists ((select * from project_mapped_actuals('03620000-0000-0000-0000-0000000000d1') except select * from actuals_before)
                      union all (select * from actuals_before except select * from project_mapped_actuals('03620000-0000-0000-0000-0000000000d1'))),
  'AC-PFE-005 FR-PFE-035 actuals are unchanged by linking');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select procurement_open_commitment(p) from procurements p where p.id = '03620000-0000-0000-0000-0000000000e3'), 1000::numeric,
  'AC-PFE-005 NFR-PFE-002 a non-ledger org''s commitment is total_value');
reset role;
-- 0350 Engineer purchasing scope: the ledger-held figure is invoice money, which Engineers never read (owner ruling).
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(procurement_ledger_held('03620000-0000-0000-0000-0000000000e2'), null::numeric,
  'AC-PFE-005 0350 scope: an Engineer gets nothing for someone else''s purchase');
select is(procurement_ledger_held('03620000-0000-0000-0000-0000000000e4'), null::numeric,
  'AC-PFE-005 0350 scope: an Engineer gets no invoice money even for their own request');
reset role;
select * from finish();
rollback;
