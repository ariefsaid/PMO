-- procurement_recorded_document_total.test.sql — 0371. A purchase recorded in PMO with no line items takes its
-- total from its documents (vendor invoice, else payment, else order), so committed spend counts it once paid.
begin;
select plan(39);

insert into organizations (id, name, default_currency) values
  ('03710000-0000-0000-0000-00000000000a','RDT Native','IDR'), ('03710000-0000-0000-0000-00000000000b','RDT Foreign','IDR'),
  ('03710000-0000-0000-0000-00000000000c','RDT Ledger','IDR');
insert into auth.users (id, email) values
  ('03710000-0000-0000-0000-0000000000a1','rdt-fin1@example.com'), ('03710000-0000-0000-0000-0000000000a2','rdt-fin2@example.com'),
  ('03710000-0000-0000-0000-0000000000b1','rdt-b@example.com'),    ('03710000-0000-0000-0000-0000000000c1','rdt-l@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03710000-0000-0000-0000-0000000000a1','03710000-0000-0000-0000-00000000000a','Fin One','rdt-fin1@example.com','Finance','active'),
  ('03710000-0000-0000-0000-0000000000a2','03710000-0000-0000-0000-00000000000a','Fin Two','rdt-fin2@example.com','Finance','active'),
  ('03710000-0000-0000-0000-0000000000b1','03710000-0000-0000-0000-00000000000b','B Fin','rdt-b@example.com','Finance','active'),
  ('03710000-0000-0000-0000-0000000000c1','03710000-0000-0000-0000-00000000000c','L Fin','rdt-l@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('03710000-0000-0000-0000-0000000000d1','03710000-0000-0000-0000-00000000000a','RDT P1','Ongoing Project'),
  ('03710000-0000-0000-0000-0000000000d2','03710000-0000-0000-0000-00000000000a','RDT P2','Ongoing Project'),
  ('03710000-0000-0000-0000-0000000000d3','03710000-0000-0000-0000-00000000000b','RDT PB','Ongoing Project'),
  ('03710000-0000-0000-0000-0000000000d4','03710000-0000-0000-0000-00000000000c','RDT PL','Ongoing Project');
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status, approved_by_id, approved_total_value) values
  -- e1: started at a vendor invoice; e2: started at an ERP-mirrored paid payment; e3: has line items;
  -- e4: went through approval; e5: written by direct SQL; e6: started at a scheduled payment; eb: another org.
  ('03710000-0000-0000-0000-0000000000e1','03710000-0000-0000-0000-00000000000a','VI start','03710000-0000-0000-0000-0000000000a1','03710000-0000-0000-0000-0000000000d1','IDR',0,'Draft',null,null),
  ('03710000-0000-0000-0000-0000000000e2','03710000-0000-0000-0000-00000000000a','PE start','03710000-0000-0000-0000-0000000000a1','03710000-0000-0000-0000-0000000000d2','IDR',0,'Draft',null,null),
  ('03710000-0000-0000-0000-0000000000e3','03710000-0000-0000-0000-00000000000a','Items','03710000-0000-0000-0000-0000000000a1','03710000-0000-0000-0000-0000000000d2','IDR',0,'Draft',null,null),
  ('03710000-0000-0000-0000-0000000000e4','03710000-0000-0000-0000-00000000000a','Approved','03710000-0000-0000-0000-0000000000a1','03710000-0000-0000-0000-0000000000d2','IDR',1000,'Approved','03710000-0000-0000-0000-0000000000a1',1000),
  ('03710000-0000-0000-0000-0000000000e5','03710000-0000-0000-0000-00000000000a','Direct','03710000-0000-0000-0000-0000000000a1','03710000-0000-0000-0000-0000000000d2','IDR',0,'Draft',null,null),
  ('03710000-0000-0000-0000-0000000000e6','03710000-0000-0000-0000-00000000000a','Sched','03710000-0000-0000-0000-0000000000a1','03710000-0000-0000-0000-0000000000d2','IDR',0,'Draft',null,null),
  ('03710000-0000-0000-0000-0000000000eb','03710000-0000-0000-0000-00000000000b','Foreign','03710000-0000-0000-0000-0000000000b1','03710000-0000-0000-0000-0000000000d3','IDR',50,'Draft',null,null);
insert into procurement_items (procurement_id, org_id, name, quantity, rate) values
  ('03710000-0000-0000-0000-0000000000e3','03710000-0000-0000-0000-00000000000a','Line',1,700);

-- A user records documents (claims set, role stays postgres so fixtures bypass grants).
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values
  ('03710000-0000-0000-0000-0000000000e1','03710000-0000-0000-0000-00000000000a','Received',1500,'IDR','exclusive',165),
  ('03710000-0000-0000-0000-0000000000e3','03710000-0000-0000-0000-00000000000a','Received',900,'IDR','exclusive',0),
  ('03710000-0000-0000-0000-0000000000e4','03710000-0000-0000-0000-00000000000a','Received',800,'IDR','exclusive',0);
reset request.jwt.claims;
select results_eq($$ select status::text, total_value from procurements where id = '03710000-0000-0000-0000-0000000000e1' $$,
  $$ values ('Vendor Invoiced', 1500::numeric) $$, '0371 a purchase started at a vendor invoice takes the invoice''s pre-tax amount');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_procurement('03710000-0000-0000-0000-0000000000e1','Paid') $$, '0371 fixture: Finance pays it');
select results_eq($$ select status::text, total_value from procurements where id = '03710000-0000-0000-0000-0000000000e1' $$,
  $$ values ('Paid', 1500::numeric) $$, '0371 the invoice amount still wins over the gross payment once paid');
select is((select coalesce(sum(amount) filter (where is_project_currency), 0) from project_committed_spend('03710000-0000-0000-0000-0000000000d1')), 1500::numeric,
  '0371 a purchase started at a vendor invoice and paid counts its amount in committed spend');
select is((select procurement_open_commitment(p) from procurements p where p.id = '03710000-0000-0000-0000-0000000000e1'), 1500::numeric,
  '0371 its open commitment is the recorded amount');
select lives_ok($$ select create_payment('03710000-0000-0000-0000-0000000000e6', null, null, null, current_date, 800) $$,
  '0371 fixture: a scheduled payment is recorded on a purchase with nothing else');
select is((select total_value from procurements where id = '03710000-0000-0000-0000-0000000000e6'), 800::numeric,
  '0371 with no vendor invoice the payment amount is the total');
reset role;
reset request.jwt.claims;

-- The ERP mirror (service_role JWT) records a paid payment and derives Paid.
set local request.jwt.claims = '{"role":"service_role"}';
insert into payments (procurement_id, org_id, status, amount, erp_docstatus) values
  ('03710000-0000-0000-0000-0000000000e2','03710000-0000-0000-0000-00000000000a','Paid',1200,1);
reset request.jwt.claims;
select results_eq($$ select status::text, total_value from procurements where id = '03710000-0000-0000-0000-0000000000e2' $$,
  $$ values ('Paid', 1200::numeric) $$, '0371 an ERP-mirrored paid payment derives Paid and carries its amount');

select is((select total_value from procurements where id = '03710000-0000-0000-0000-0000000000e3'), 700::numeric,
  '0371 line items still win over a recorded invoice');
select is((select total_value from procurements where id = '03710000-0000-0000-0000-0000000000e4'), 1000::numeric,
  '0371 an approved purchase keeps the amount its approval was decided on');

-- Direct SQL (seed/migration/fixture) never re-derives (NFR-PFE-010).
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values
  ('03710000-0000-0000-0000-0000000000e5','03710000-0000-0000-0000-00000000000a','Received',300,'IDR','exclusive',0);
select is((select total_value from procurements where id = '03710000-0000-0000-0000-0000000000e5'), 0::numeric,
  '0371 NFR-PFE-010 a direct SQL write re-derives nothing');

-- Foreign-org isolation is unchanged.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select coalesce(sum(amount) filter (where is_project_currency), 0) from project_committed_spend('03710000-0000-0000-0000-0000000000d1')), 0::numeric, '0371 another org sees none of this org''s committed spend');
select is((select count(*) from procurements where org_id = '03710000-0000-0000-0000-00000000000a'), 0::bigint, '0371 another org reads none of its purchases');
reset role;
reset request.jwt.claims;
select is((select total_value from procurements where id = '03710000-0000-0000-0000-0000000000eb'), 50::numeric,
  '0371 another org''s purchase is untouched');

-- The ERP-linked path (0361) is unchanged: its total follows its linked ERP documents only.
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('03710000-0000-0000-0000-00000000000c','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"03710000-0000-0000-0000-0000000000d4":"ERP-L"}}'::jsonb, now(), 'active');
select upsert_erp_purchase_documents('03710000-0000-0000-0000-00000000000c', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-RDT","supplier":"SUP-R","supplier_name":"Supplier R","currency":"IDR","grand_total":666,"net_total":600,"erp_docstatus":1,"erp_project":"ERP-L","erp_modified":"2026-02-01"},
 {"erp_doctype":"Payment Entry","erp_name":"PE-RDT","supplier":"SUP-R","supplier_name":"Supplier R","currency":"IDR","grand_total":2000,"erp_docstatus":1,"erp_project":"ERP-L","erp_modified":"2026-02-01"}]$$::jsonb);
set local role authenticated;
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select set_config('rdt.r', link_erp_purchase_documents('[{"erp_name":"PINV-RDT","project_id":"03710000-0000-0000-0000-0000000000d4","group":"g"},{"erp_name":"PE-RDT","project_id":"03710000-0000-0000-0000-0000000000d4","group":"g"}]')::text, true);
select is(current_setting('rdt.r')::jsonb #>> '{counts,link}', '2', '0371 fixture: an invoice and its payment link into one new purchase');
reset role;
select is((select total_value from procurements where id = (current_setting('rdt.r')::jsonb #>> '{results,0,procurement_id}')::uuid), 600::numeric,
  '0371 a purchase created from ERP documents keeps the 0361 total (invoice net)');
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000c1","role":"authenticated"}';
insert into payments (procurement_id, org_id, status, amount)
  values ((current_setting('rdt.r')::jsonb #>> '{results,0,procurement_id}')::uuid, '03710000-0000-0000-0000-00000000000c', 'Scheduled', 999);
reset request.jwt.claims;
select is((select total_value from procurements where id = (current_setting('rdt.r')::jsonb #>> '{results,0,procurement_id}')::uuid), 600::numeric,
  '0371 a PMO record on a purchase created from ERP documents does not override the 0361 total');

-- Review fixes (I-1, I-2, M-1..M-5).
insert into auth.users (id, email) values ('03710000-0000-0000-0000-0000000000a3','rdt-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03710000-0000-0000-0000-0000000000a3','03710000-0000-0000-0000-00000000000a','Admin','rdt-admin@example.com','Admin','active');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status, pr_number) values
  ('03710000-0000-0000-0000-000000000f01','03710000-0000-0000-0000-00000000000a','Order then bill','03710000-0000-0000-0000-0000000000a1','IDR',0,'Draft',null),
  ('03710000-0000-0000-0000-000000000f02','03710000-0000-0000-0000-00000000000a','Prepay','03710000-0000-0000-0000-0000000000a1','IDR',0,'Draft',null),
  ('03710000-0000-0000-0000-000000000f03','03710000-0000-0000-0000-00000000000a','Cancel','03710000-0000-0000-0000-0000000000a1','IDR',0,'Draft',null),
  ('03710000-0000-0000-0000-000000000f04','03710000-0000-0000-0000-00000000000a','Amend','03710000-0000-0000-0000-0000000000a1','IDR',0,'Draft',null),
  ('03710000-0000-0000-0000-000000000f05','03710000-0000-0000-0000-00000000000a','Delete','03710000-0000-0000-0000-0000000000a1','IDR',0,'Draft',null),
  ('03710000-0000-0000-0000-000000000f06','03710000-0000-0000-0000-00000000000a','Second','03710000-0000-0000-0000-0000000000a1','IDR',0,'Draft',null),
  ('03710000-0000-0000-0000-000000000f07','03710000-0000-0000-0000-00000000000a','Inclusive','03710000-0000-0000-0000-0000000000a1','IDR',0,'Draft',null),
  ('03710000-0000-0000-0000-000000000f08','03710000-0000-0000-0000-00000000000a','Mixed','03710000-0000-0000-0000-0000000000a1','IDR',0,'Draft',null),
  ('03710000-0000-0000-0000-000000000f09','03710000-0000-0000-0000-00000000000a','USD','03710000-0000-0000-0000-0000000000a1','USD',0,'Draft',null),
  ('03710000-0000-0000-0000-000000000f10','03710000-0000-0000-0000-00000000000a','Awaiting','03710000-0000-0000-0000-0000000000a1','IDR',100,'Requested',null),
  ('03710000-0000-0000-0000-000000000f11','03710000-0000-0000-0000-00000000000a','Was requested','03710000-0000-0000-0000-0000000000a1','IDR',0,'Draft','PR-RDT-11'),
  ('03710000-0000-0000-0000-000000000f12','03710000-0000-0000-0000-00000000000a','Overflow mirror','03710000-0000-0000-0000-0000000000a1','IDR',0,'Draft',null),
  ('03710000-0000-0000-0000-000000000f13','03710000-0000-0000-0000-00000000000a','Overflow user','03710000-0000-0000-0000-0000000000a1','IDR',0,'Draft',null),
  ('03710000-0000-0000-0000-000000000f14','03710000-0000-0000-0000-00000000000a','Submit','03710000-0000-0000-0000-0000000000a1','IDR',0,'Draft',null);
insert into procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, notes) values
  ('03710000-0000-0000-0000-000000000f11','03710000-0000-0000-0000-00000000000a','Draft','Requested','03710000-0000-0000-0000-0000000000a1','fixture'),
  ('03710000-0000-0000-0000-000000000f11','03710000-0000-0000-0000-00000000000a','Requested','Rejected','03710000-0000-0000-0000-0000000000a3','fixture'),
  ('03710000-0000-0000-0000-000000000f11','03710000-0000-0000-0000-00000000000a','Rejected','Draft','03710000-0000-0000-0000-0000000000a1','fixture');
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into purchase_orders (procurement_id, org_id, status, amount, currency) values ('03710000-0000-0000-0000-000000000f01','03710000-0000-0000-0000-00000000000a','Issued',10000,'IDR');
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03710000-0000-0000-0000-000000000f01','03710000-0000-0000-0000-00000000000a','Received',2000,'IDR','exclusive',0);
insert into payments (procurement_id, org_id, status, amount, currency) values ('03710000-0000-0000-0000-000000000f02','03710000-0000-0000-0000-00000000000a','Scheduled',1500,'IDR');
reset request.jwt.claims;
select is((select total_value from procurements where id = '03710000-0000-0000-0000-000000000f01'), 10000::numeric, '0371 I-1 an order of 10,000 then a partial bill of 2,000 keeps 10,000');
select is((select total_value from procurements where id = '03710000-0000-0000-0000-000000000f02'), 1500::numeric, '0371 I-1 a prepayment with no order and no bill is the total');
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03710000-0000-0000-0000-000000000f02','03710000-0000-0000-0000-00000000000a','Received',500,'IDR','exclusive',0);
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03710000-0000-0000-0000-000000000f03','03710000-0000-0000-0000-00000000000a','Received',1000,'IDR','exclusive',0);
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03710000-0000-0000-0000-000000000f05','03710000-0000-0000-0000-00000000000a','Received',700,'IDR','exclusive',0);
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount, vi_number) values ('03710000-0000-0000-0000-000000000f06','03710000-0000-0000-0000-00000000000a','Received',1000,'IDR','exclusive',0, 'VI-RDT-6');
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03710000-0000-0000-0000-000000000f07','03710000-0000-0000-0000-00000000000a','Received',1110,'IDR','inclusive',110);
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03710000-0000-0000-0000-000000000f08','03710000-0000-0000-0000-00000000000a','Received',1000,'IDR','exclusive',0);
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03710000-0000-0000-0000-000000000f08','03710000-0000-0000-0000-00000000000a','Received',50,'USD','exclusive',0);
reset request.jwt.claims;
select is((select total_value from procurements where id = '03710000-0000-0000-0000-000000000f02'), 500::numeric, '0371 I-1 once a bill exists it wins over the (tax-carrying) prepayment');
select is((select total_value from procurements where id = '03710000-0000-0000-0000-000000000f07'), 1000::numeric, '0371 a tax-inclusive bill counts net of its tax');
select is((select total_value from procurements where id = '03710000-0000-0000-0000-000000000f08'), 1000::numeric, '0371 M-1 a bill in another currency is ignored');
-- I-2: every document stops counting -> 0, never the stale amount.
set local request.jwt.claims = '{"role":"service_role"}';
update procurement_invoices set erp_docstatus = 2 where procurement_id = '03710000-0000-0000-0000-000000000f03';
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount, vi_number, erp_docstatus) values ('03710000-0000-0000-0000-000000000f04','03710000-0000-0000-0000-00000000000a','Received',1000,'IDR','exclusive',0, 'VI-RDT-4', 1);
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount, vi_number, erp_amended_from, erp_docstatus) values ('03710000-0000-0000-0000-000000000f04','03710000-0000-0000-0000-00000000000a','Received',900,'IDR','exclusive',0, 'VI-RDT-4-1', 'VI-RDT-4', 1);
reset request.jwt.claims;
select is((select total_value from procurements where id = '03710000-0000-0000-0000-000000000f03'), 0::numeric, '0371 I-2 the only bill cancelled -> total 0');
select is((select total_value from procurements where id = '03710000-0000-0000-0000-000000000f04'), 900::numeric, '0371 I-2 an amended bill counts once, at the amendment');
set local request.jwt.claims = '{"role":"service_role"}';
update procurement_invoices set erp_docstatus = 2 where procurement_id = '03710000-0000-0000-0000-000000000f04';
reset request.jwt.claims;
select is((select total_value from procurements where id = '03710000-0000-0000-0000-000000000f04'), 0::numeric, '0371 I-2 the amendment cancelled too -> total 0');
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
delete from procurement_invoices where procurement_id = '03710000-0000-0000-0000-000000000f05';
reset request.jwt.claims;
select is((select total_value from procurements where id = '03710000-0000-0000-0000-000000000f05'), 0::numeric, '0371 I-2 the only bill deleted -> total 0');
-- A second or edited document after the status advanced.
select is((select status::text from procurements where id = '03710000-0000-0000-0000-000000000f06'), 'Vendor Invoiced', '0371 fixture: the first bill advanced the status');
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03710000-0000-0000-0000-000000000f06','03710000-0000-0000-0000-00000000000a','Received',500,'IDR','exclusive',0);
reset request.jwt.claims;
select is((select total_value from procurements where id = '03710000-0000-0000-0000-000000000f06'), 1500::numeric, '0371 a second bill after the status advanced adds to the total');
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
update procurement_invoices set amount = 1200 where vi_number = 'VI-RDT-6';
reset request.jwt.claims;
select is((select total_value from procurements where id = '03710000-0000-0000-0000-000000000f06'), 1700::numeric, '0371 an edited bill updates the total');
-- M-1: a mirror payment with no currency is stamped with the org default, so on a USD purchase it is ignored.
set local request.jwt.claims = '{"role":"service_role"}';
insert into payments (procurement_id, org_id, status, amount) values ('03710000-0000-0000-0000-000000000f09','03710000-0000-0000-0000-00000000000a','Scheduled',300);
reset request.jwt.claims;
select results_eq($$ select (select currency from payments where procurement_id = '03710000-0000-0000-0000-000000000f09'), (select total_value from procurements where id = '03710000-0000-0000-0000-000000000f09') $$,
  $$ values ('IDR', 0::numeric) $$, '0371 M-1 a mirror payment with no currency on a USD purchase is stamped IDR and ignored');
-- M-2 / M-3: awaiting approval, or ever entered approval -> no refresh. f10 carries no request number or event so only
-- the awaiting-approval check holds it.
set local request.jwt.claims = '{"role":"service_role"}';
insert into payments (procurement_id, org_id, status, amount, currency) values ('03710000-0000-0000-0000-000000000f10','03710000-0000-0000-0000-00000000000a','Scheduled',400,'IDR');
reset request.jwt.claims;
select is((select total_value from procurements where id = '03710000-0000-0000-0000-000000000f10'), 100::numeric, '0371 M-2 a mirror write while awaiting approval leaves the total');
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into payments (procurement_id, org_id, status, amount, currency) values ('03710000-0000-0000-0000-000000000f11','03710000-0000-0000-0000-00000000000a','Scheduled',300,'IDR');
reset request.jwt.claims;
select is((select total_value from procurements where id = '03710000-0000-0000-0000-000000000f11'), 0::numeric, '0371 M-3 a purchase that entered approval (and went back to Draft) is not refreshed');
-- M-4: a mirror write whose refresh fails is kept and audited; a user write fails.
set local request.jwt.claims = '{"role":"service_role"}';
insert into payments (procurement_id, org_id, status, amount, currency) values ('03710000-0000-0000-0000-000000000f12','03710000-0000-0000-0000-00000000000a','Scheduled',999999999999,'IDR');
insert into payments (procurement_id, org_id, status, amount, currency) values ('03710000-0000-0000-0000-000000000f12','03710000-0000-0000-0000-00000000000a','Scheduled',999999999999,'IDR');
reset request.jwt.claims;
select results_eq($$ select (select count(*)::int from payments where procurement_id = '03710000-0000-0000-0000-000000000f12'), (select total_value from procurements where id = '03710000-0000-0000-0000-000000000f12'),
    (select count(*)::int from audit_events where action = 'procurement.total_refresh_skipped' and entity_id = '03710000-0000-0000-0000-000000000f12') $$,
  $$ values (2, 999999999999::numeric, 1) $$, '0371 M-4 a mirror write is kept, the total left, the failure audited');
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into payments (procurement_id, org_id, status, amount, currency) values ('03710000-0000-0000-0000-000000000f13','03710000-0000-0000-0000-00000000000a','Scheduled',999999999999,'IDR');
select throws_ok($$ insert into payments (procurement_id, org_id, status, amount, currency) values ('03710000-0000-0000-0000-000000000f13','03710000-0000-0000-0000-00000000000a','Scheduled',999999999999,'IDR') $$,
  '22003', null, '0371 M-4 a user write whose refresh fails is refused');
reset request.jwt.claims;
-- Documents, then submit and approve: the approved amount is the document total; later documents leave it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select create_payment('03710000-0000-0000-0000-000000000f14', null, null, null, current_date, 800) $$, '0371 fixture: a scheduled payment on a Draft purchase');
select lives_ok($$ select transition_procurement('03710000-0000-0000-0000-000000000f14','Requested') $$, '0371 fixture: the requester submits it');
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_procurement('03710000-0000-0000-0000-000000000f14','Approved') $$, '0371 fixture: an Admin approves it');
reset role;
reset request.jwt.claims;
select results_eq($$ select total_value, approved_total_value from procurements where id = '03710000-0000-0000-0000-000000000f14' $$,
  $$ values (800::numeric, 800::numeric) $$, '0371 the approved amount is the document total');
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03710000-0000-0000-0000-000000000f14','03710000-0000-0000-0000-00000000000a','Received',900,'IDR','exclusive',0);
reset request.jwt.claims;
select results_eq($$ select status::text, total_value, approved_total_value from procurements where id = '03710000-0000-0000-0000-000000000f14' $$,
  $$ values ('Vendor Invoiced', 800::numeric, 800::numeric) $$, '0371 M-3 a later bill on an approved purchase leaves its total');

select * from finish();
rollback;
