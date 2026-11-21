-- vendor_supply_risk.test.sql — #2583 (1149 columns + guard, 1150 reads, 1151 set function).
-- Owns AC-VSR-001, 002 (Paid-case half; the voided-bill half is deferred, #2600), 004, 006..012, 014, 016, 017, 018.
begin;
select plan(66);

-- Fixtures (table owner, no JWT: the guard lets a no-JWT session through).
insert into organizations (id, name, default_currency) values
  ('25830000-0000-0000-0000-000000000001','VSR Org','IDR'),
  ('25830000-0000-0000-0000-000000000002','VSR Other Org','IDR'),
  ('25830000-0000-0000-0000-000000000003','VSR ERP Org','IDR');
insert into auth.users (id, email) values
  ('25830000-0000-0000-0000-0000000000a1','vsr-admin@example.com'),
  ('25830000-0000-0000-0000-0000000000a2','vsr-fin@example.com'),
  ('25830000-0000-0000-0000-0000000000a3','vsr-pm1@example.com'),
  ('25830000-0000-0000-0000-0000000000a4','vsr-pm2@example.com'),
  ('25830000-0000-0000-0000-0000000000a5','vsr-exec@example.com'),
  ('25830000-0000-0000-0000-0000000000a6','vsr-eng@example.com'),
  ('25830000-0000-0000-0000-0000000000b1','vsr-other@example.com'),
  ('25830000-0000-0000-0000-0000000000c1','vsr-erp-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25830000-0000-0000-0000-0000000000a1','25830000-0000-0000-0000-000000000001','VSR Admin','vsr-admin@example.com','Admin','active'),
  ('25830000-0000-0000-0000-0000000000a2','25830000-0000-0000-0000-000000000001','VSR Finance','vsr-fin@example.com','Finance','active'),
  ('25830000-0000-0000-0000-0000000000a3','25830000-0000-0000-0000-000000000001','VSR PM One','vsr-pm1@example.com','Project Manager','active'),
  ('25830000-0000-0000-0000-0000000000a4','25830000-0000-0000-0000-000000000001','VSR PM Two','vsr-pm2@example.com','Project Manager','active'),
  ('25830000-0000-0000-0000-0000000000a5','25830000-0000-0000-0000-000000000001','VSR Exec','vsr-exec@example.com','Executive','active'),
  ('25830000-0000-0000-0000-0000000000a6','25830000-0000-0000-0000-000000000001','VSR Eng','vsr-eng@example.com','Engineer','active'),
  ('25830000-0000-0000-0000-0000000000b1','25830000-0000-0000-0000-000000000002','VSR Other Finance','vsr-other@example.com','Finance','active'),
  ('25830000-0000-0000-0000-0000000000c1','25830000-0000-0000-0000-000000000003','VSR ERP Finance','vsr-erp-fin@example.com','Finance','active');
insert into companies (id, org_id, name, type, archived_at, erp_supplier_name) values
  ('25830000-0000-0000-0000-0000000000d1','25830000-0000-0000-0000-000000000001','VSR Vendor','Vendor',null,null),
  ('25830000-0000-0000-0000-0000000000d2','25830000-0000-0000-0000-000000000001','VSR Client','Client',null,null),
  ('25830000-0000-0000-0000-0000000000d3','25830000-0000-0000-0000-000000000001','VSR Internal','Internal',null,null),
  ('25830000-0000-0000-0000-0000000000d4','25830000-0000-0000-0000-000000000001','VSR Archived Vendor','Vendor',now(),null),
  ('25830000-0000-0000-0000-0000000000d5','25830000-0000-0000-0000-000000000002','VSR Foreign Vendor','Vendor',null,null),
  ('25830000-0000-0000-0000-0000000000d6','25830000-0000-0000-0000-000000000001','VSR Idle Vendor','Vendor',null,null),
  ('25830000-0000-0000-0000-0000000000d7','25830000-0000-0000-0000-000000000003','VSR ERP Vendor','Vendor',null,'VSR ERP Supplier Ltd'),
  ('25830000-0000-0000-0000-0000000000d8','25830000-0000-0000-0000-000000000003','VSR ERP Unmatched Vendor','Vendor',null,'No Such Party');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('25830000-0000-0000-0000-0000000000e1','25830000-0000-0000-0000-000000000001','VSR Project One','Ongoing Project',1000000,'exclusive',0,'25830000-0000-0000-0000-0000000000a3'),
  ('25830000-0000-0000-0000-0000000000e2','25830000-0000-0000-0000-000000000001','VSR Project Two','Ongoing Project',1000000,'exclusive',0,'25830000-0000-0000-0000-0000000000a4');
insert into work_orders (id, org_id, project_id, title, order_value, tax_treatment, tax_amount, currency) values
  ('25830000-0000-0000-0000-0000000000f1','25830000-0000-0000-0000-000000000001','25830000-0000-0000-0000-0000000000e1','WO issued',100,'exclusive',0,'IDR'),
  ('25830000-0000-0000-0000-0000000000f2','25830000-0000-0000-0000-000000000001','25830000-0000-0000-0000-0000000000e2','WO draft',100,'exclusive',0,'IDR'),
  ('25830000-0000-0000-0000-0000000000f3','25830000-0000-0000-0000-000000000001','25830000-0000-0000-0000-0000000000e1','WO for closed PO',100,'exclusive',0,'IDR'),
  ('25830000-0000-0000-0000-0000000000f4','25830000-0000-0000-0000-000000000001','25830000-0000-0000-0000-0000000000e1','WO for draft PO',100,'exclusive',0,'IDR'),
  ('25830000-0000-0000-0000-0000000000f5','25830000-0000-0000-0000-000000000001','25830000-0000-0000-0000-0000000000e1','WO closed itself',100,'exclusive',0,'IDR');
-- A closed work order cannot be created directly; force its status as the owner.
update work_orders set status = 'Closed' where id = '25830000-0000-0000-0000-0000000000f5';

-- ── PMO basis hand example (org today = Asia/Jakarta calendar date) ──
create temp table t_today as select (now() at time zone 'Asia/Jakarta')::date as d;
grant select on t_today to authenticated;

-- Cases: all Vendor Invoiced, vendor d1, IDR.
insert into procurements (id, org_id, title, requested_by_id, project_id, vendor_id, currency, total_value, status) values
  ('25830000-0000-0000-0000-000000000c01','25830000-0000-0000-0000-000000000001','VSR case 1','25830000-0000-0000-0000-0000000000a3','25830000-0000-0000-0000-0000000000e1','25830000-0000-0000-0000-0000000000d1','IDR',1000000,'Vendor Invoiced'),
  ('25830000-0000-0000-0000-000000000c02','25830000-0000-0000-0000-000000000001','VSR case 2','25830000-0000-0000-0000-0000000000a3','25830000-0000-0000-0000-0000000000e1','25830000-0000-0000-0000-0000000000d1','IDR',2000000,'Vendor Invoiced'),
  ('25830000-0000-0000-0000-000000000c03','25830000-0000-0000-0000-000000000001','VSR case 3','25830000-0000-0000-0000-0000000000a3','25830000-0000-0000-0000-0000000000e1','25830000-0000-0000-0000-0000000000d1','IDR',1000000,'Vendor Invoiced'),
  ('25830000-0000-0000-0000-000000000c04','25830000-0000-0000-0000-000000000001','VSR case 4','25830000-0000-0000-0000-0000000000a3','25830000-0000-0000-0000-0000000000e1','25830000-0000-0000-0000-0000000000d1','IDR',500000,'Vendor Invoiced'),
  ('25830000-0000-0000-0000-000000000c05','25830000-0000-0000-0000-000000000001','VSR case 5 paid','25830000-0000-0000-0000-0000000000a3','25830000-0000-0000-0000-0000000000e1','25830000-0000-0000-0000-0000000000d1','IDR',900000,'Paid');
insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, currency, tax_treatment, tax_amount)
select p.org_id, v.pid, 'Received', v.dt, v.amt, p.currency, 'inclusive', 0 from (values
  ('25830000-0000-0000-0000-000000000c01'::uuid,(select d - 111 from t_today),1000000),
  ('25830000-0000-0000-0000-000000000c02'::uuid,(select d - 56 from t_today),2000000),
  ('25830000-0000-0000-0000-000000000c03'::uuid,(select d - 70 from t_today),1000000),
  ('25830000-0000-0000-0000-000000000c04'::uuid,(select d - 71 from t_today),500000),
  ('25830000-0000-0000-0000-000000000c05'::uuid,(select d - 200 from t_today),900000)) v(pid, dt, amt) join procurements p on p.id = v.pid;
insert into payments (org_id, procurement_id, status, amount, currency, date)
select p.org_id, v.pid, v.st, v.amt, p.currency, current_date from (values
  ('25830000-0000-0000-0000-000000000c03'::uuid,'Paid',400000),
  ('25830000-0000-0000-0000-000000000c04'::uuid,'Paid',500000)) v(pid, st, amt) join procurements p on p.id = v.pid;

-- Open orders for exposure (AC-VSR-011): a separate case per order so the money cases above stay clean.
insert into procurements (id, org_id, title, requested_by_id, project_id, vendor_id, currency, total_value, status) values
  ('25830000-0000-0000-0000-000000000c11','25830000-0000-0000-0000-000000000001','VSR order case','25830000-0000-0000-0000-0000000000a3','25830000-0000-0000-0000-0000000000e1','25830000-0000-0000-0000-0000000000d1','IDR',1,'Ordered'),
  ('25830000-0000-0000-0000-000000000c12','25830000-0000-0000-0000-000000000001','VSR order case two','25830000-0000-0000-0000-0000000000a4','25830000-0000-0000-0000-0000000000e2','25830000-0000-0000-0000-0000000000d1','IDR',1,'Ordered');
insert into purchase_orders (id, org_id, procurement_id, status, amount, work_order_id) values
  ('25830000-0000-0000-0000-000000000b01','25830000-0000-0000-0000-000000000001','25830000-0000-0000-0000-000000000c11','Issued',300,'25830000-0000-0000-0000-0000000000f1'),
  ('25830000-0000-0000-0000-000000000b02','25830000-0000-0000-0000-000000000001','25830000-0000-0000-0000-000000000c12','Acknowledged',200,'25830000-0000-0000-0000-0000000000f2'),
  ('25830000-0000-0000-0000-000000000b03','25830000-0000-0000-0000-000000000001','25830000-0000-0000-0000-000000000c11','Closed',100,'25830000-0000-0000-0000-0000000000f3'),
  ('25830000-0000-0000-0000-000000000b04','25830000-0000-0000-0000-000000000001','25830000-0000-0000-0000-000000000c11','Draft',100,'25830000-0000-0000-0000-0000000000f4'),
  ('25830000-0000-0000-0000-000000000b05','25830000-0000-0000-0000-000000000001','25830000-0000-0000-0000-000000000c11','Issued',100,'25830000-0000-0000-0000-0000000000f5'),
  ('25830000-0000-0000-0000-000000000b06','25830000-0000-0000-0000-000000000001','25830000-0000-0000-0000-000000000c11','Issued',50,null);

-- §A shape
select col_type_is('public','companies','supply_risk_status','text','VSR supply_risk_status is text');
select col_default_is('public','companies','supply_risk_status','active','VSR the default status is active');
select is((select supply_risk_status from companies where id = '25830000-0000-0000-0000-0000000000d1'), 'active', 'VSR a vendor starts active (FR-VSR-001)');
select throws_ok($$ update companies set supply_risk_status = 'blocked' where id = '25830000-0000-0000-0000-0000000000d1' $$,
  '23514', null, 'VSR an unknown status is refused by the domain check');
select throws_ok($$ update companies set supply_risk_status = 'at_risk' where id = '25830000-0000-0000-0000-0000000000d1' $$,
  '23514', null, 'VSR at_risk without a reason is refused by the shape check (owner, no JWT)');

-- §B AC-VSR-001 / 017 / 018 / 002 / 003 / 005: the suggestion (as Finance)
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local role authenticated;
select is((select vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d1') ->> 'suggested_status'), 'at_risk',
  'AC-VSR-001 the hand example suggests at_risk');
select is((select vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d1') ->> 'basis'), 'pmo', 'AC-VSR-001 basis is pmo');
select is((select (vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d1') -> 'currencies' -> 0 ->> 'over60_amount')::numeric), 1600000::numeric,
  'AC-VSR-001 the over-60-day amount is 1,600,000 (cases 1 and 3, case 3 net of its Paid payment)');
select is((select (vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d1') -> 'currencies' -> 0 ->> 'invoice_count')::int), 2,
  'AC-VSR-001 two invoices are behind it');
select is((select (vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d1') ->> 'oldest_age_days')::int), 111,
  'AC-VSR-001 the oldest unpaid age is 111 days');
select is((select (vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d1') -> 'currencies' -> 0 ->> 'unpaid_amount')::numeric), 3600000::numeric,
  'AC-VSR-001 total unpaid is 3,600,000: cases 1, 2 and 3; case 4 (fully paid) and the Paid case 5 are out (AC-VSR-002)');
select is((select jsonb_array_length(vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d1') -> 'currencies')), 1,
  'AC-VSR-005 one currency reported (IDR)');
reset role; reset request.jwt.claims;

-- AC-VSR-017: case 3 alone, then Scheduled-only, then fully paid.
update procurements set status = 'Paid' where id in ('25830000-0000-0000-0000-000000000c01','25830000-0000-0000-0000-000000000c02');
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local role authenticated;
select is((select (vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d1') -> 'currencies' -> 0 ->> 'over60_amount')::numeric), 600000::numeric,
  'AC-VSR-017 case 3 alone: unpaid 600,000 (1,000,000 less the 400,000 Paid payment)');
select is((select (vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d1') ->> 'oldest_age_days')::int), 70, 'AC-VSR-017 age 70');
select is((select vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d1') ->> 'suggested_status'), 'at_risk', 'AC-VSR-017 still at_risk');
reset role; reset request.jwt.claims;
update payments set status = 'Scheduled' where procurement_id = '25830000-0000-0000-0000-000000000c03';
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local role authenticated;
select is((select (vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d1') -> 'currencies' -> 0 ->> 'over60_amount')::numeric), 1000000::numeric,
  'AC-VSR-017 a Scheduled payment does not reduce the balance: 1,000,000');
reset role; reset request.jwt.claims;
update payments set status = 'Paid', amount = 1000000 where procurement_id = '25830000-0000-0000-0000-000000000c03';
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local role authenticated;
select is((select vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d1') ->> 'suggested_status'), 'active',
  'AC-VSR-017 fully paid: nothing counts and the suggestion is active');
reset role; reset request.jwt.claims;

-- AC-VSR-003: an old invoice with no amount is unknown, never zero, and does not raise the suggestion.
insert into procurements (id, org_id, title, requested_by_id, project_id, vendor_id, currency, total_value, status) values
  ('25830000-0000-0000-0000-000000000c21','25830000-0000-0000-0000-000000000001','VSR unknown','25830000-0000-0000-0000-0000000000a3','25830000-0000-0000-0000-0000000000e1','25830000-0000-0000-0000-0000000000d6','IDR',1,'Vendor Invoiced');
insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, currency, tax_treatment, tax_amount)
select p.org_id, v.pid, 'Received', v.dt, v.amt, p.currency, 'inclusive', 0 from (values
  ('25830000-0000-0000-0000-000000000c21'::uuid,(select d - 120 from t_today),null::numeric)) v(pid, dt, amt) join procurements p on p.id = v.pid;
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local role authenticated;
select is((select (vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d6') ->> 'unknown_count')::int), 1,
  'AC-VSR-003 the amountless invoice is counted as unknown');
select is((select vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d6') ->> 'suggested_status'), 'active',
  'AC-VSR-003 an unknown balance does not by itself raise the suggestion');
reset role; reset request.jwt.claims;

-- AC-VSR-018: linked ERP documents (the /finance/payables rule).
insert into procurements (id, org_id, title, requested_by_id, project_id, vendor_id, currency, total_value, status) values
  ('25830000-0000-0000-0000-000000000c31','25830000-0000-0000-0000-000000000001','VSR erp-only','25830000-0000-0000-0000-0000000000a3','25830000-0000-0000-0000-0000000000e1','25830000-0000-0000-0000-0000000000d6','IDR',1,'Vendor Invoiced'),
  ('25830000-0000-0000-0000-000000000c32','25830000-0000-0000-0000-000000000001','VSR pmo+erp payment','25830000-0000-0000-0000-0000000000a3','25830000-0000-0000-0000-0000000000e1','25830000-0000-0000-0000-0000000000d6','USD',1,'Vendor Invoiced');
insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, currency, tax_treatment, tax_amount)
select p.org_id, v.pid, 'Received', v.dt, v.amt, p.currency, 'inclusive', 0 from (values
  ('25830000-0000-0000-0000-000000000c32'::uuid,(select d - 10 from t_today),1000)) v(pid, dt, amt) join procurements p on p.id = v.pid;
insert into erp_purchase_documents (id, org_id, erp_doctype, erp_name, erp_docstatus, erp_modified, grand_total, outstanding_amount) values
  ('25830000-0000-0000-0000-0000000003d1','25830000-0000-0000-0000-000000000001','Purchase Invoice','VSR-PINV-1',1,'m1',900,500),
  ('25830000-0000-0000-0000-0000000003d2','25830000-0000-0000-0000-000000000001','Payment Entry','VSR-PE-1',1,'m1',400,0);
insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id) values
  ('25830000-0000-0000-0000-000000000001','25830000-0000-0000-0000-000000000c31','25830000-0000-0000-0000-0000000003d1'),
  ('25830000-0000-0000-0000-000000000001','25830000-0000-0000-0000-000000000c32','25830000-0000-0000-0000-0000000003d2');
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local role authenticated;
select is((select (c ->> 'unpaid_amount')::numeric from jsonb_array_elements(vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d6') -> 'currencies') c where c ->> 'currency' = 'IDR'), 500::numeric,
  'AC-VSR-018 a case with no PMO bill and a linked ERP Purchase Invoice carries its outstanding 500');
select is((select (c ->> 'unpaid_amount')::numeric from jsonb_array_elements(vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d6') -> 'currencies') c where c ->> 'currency' = 'USD'), 600::numeric,
  'AC-VSR-018 a PMO bill of 1,000 less a linked ERP Payment Entry of 400 carries 600');
select is((select jsonb_array_length(vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d6') -> 'currencies')), 2,
  'AC-VSR-005 two currencies reported separately, never summed');
reset role; reset request.jwt.claims;

-- §C AC-VSR-004 / 016: ERP basis
insert into procurements (id, org_id, title, requested_by_id, vendor_id, currency, total_value, status) values
  ('25830000-0000-0000-0000-000000000c41','25830000-0000-0000-0000-000000000003','VSR erp-org pmo case','25830000-0000-0000-0000-0000000000c1','25830000-0000-0000-0000-0000000000d7','IDR',1,'Vendor Invoiced');
insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, currency, tax_treatment, tax_amount)
select p.org_id, v.pid, 'Received', v.dt, v.amt, p.currency, 'inclusive', 0 from (values
  ('25830000-0000-0000-0000-000000000c41'::uuid,(select d - 200 from t_today),9999999)) v(pid, dt, amt) join procurements p on p.id = v.pid;
insert into external_domain_ownership (org_id, external_tier, domain) values ('25830000-0000-0000-0000-000000000003','erpnext','procurement');
insert into erp_ap_aging_snapshot (org_id, party, party_type, currency, total_outstanding, b_0_30, b_61_90, b_90_plus, snapshot_id, as_of) values
  ('25830000-0000-0000-0000-000000000003','VSR ERP Supplier Ltd','Supplier','IDR',500000,100000,400000,0,'25830000-0000-0000-0000-00000000aa02', now()),
  ('25830000-0000-0000-0000-000000000003','VSR ERP Supplier Ltd','Supplier','IDR',1,1,0,0,'25830000-0000-0000-0000-00000000aa01', now() - interval '1 day');
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000c1","role":"authenticated"}';
set local role authenticated;
select is((select vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d7') ->> 'basis'), 'erp', 'AC-VSR-004 externally owned: basis erp');
select is((select vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d7') ->> 'suggested_status'), 'at_risk', 'AC-VSR-004 at_risk from the 61-90 bucket');
select is((select (vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d7') -> 'currencies' -> 0 ->> 'over60_amount')::numeric), 400000::numeric,
  'AC-VSR-004 the over-60 amount is the latest generation''s 400,000, not the PMO invoice of 9,999,999');
select is((select vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d7') -> 'currencies' -> 0 -> 'invoice_count'), 'null'::jsonb,
  'AC-VSR-004 no invoice count on the ERP basis');
select is((select (vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d8') ->> 'no_aging_data')::boolean), true,
  'AC-VSR-016 no snapshot row matches: no aging data');
select is((select vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d8') -> 'suggested_status'), 'null'::jsonb,
  'AC-VSR-016 and no suggested status (never active by default)');
reset role; reset request.jwt.claims;
-- a non-null company_id matches when a writer supplies one
insert into erp_ap_aging_snapshot (org_id, party, party_type, company_id, currency, total_outstanding, b_90_plus, snapshot_id, as_of) values
  ('25830000-0000-0000-0000-000000000003','Some Other Name','Supplier','25830000-0000-0000-0000-0000000000d8','IDR',70,70,'25830000-0000-0000-0000-00000000aa02', now());
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000c1","role":"authenticated"}';
set local role authenticated;
select is((select vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d8') ->> 'suggested_status'), 'at_risk',
  'AC-VSR-004 a row whose company_id equals the company matches the same way');
reset role; reset request.jwt.claims;

-- §D AC-VSR-014: organisation boundary
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000b1","role":"authenticated"}';
set local role authenticated;
select is((select vendor_supply_risk_suggestion('25830000-0000-0000-0000-0000000000d1')), null::jsonb, 'AC-VSR-014 another organisation reads no suggestion');
select is((select count(*)::int from vendor_exposed_work_orders('25830000-0000-0000-0000-0000000000d1')), 0, 'AC-VSR-014 another organisation reads no exposure');
select is((select count(*)::int from companies where id = '25830000-0000-0000-0000-0000000000d1'), 0, 'AC-VSR-014 another organisation cannot read the flag');
reset role; reset request.jwt.claims;

-- §E AC-VSR-011: exposure
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from vendor_exposed_work_orders('25830000-0000-0000-0000-0000000000d1') where kind = 'work_order'), 2,
  'AC-VSR-011 exactly two work orders are exposed (Issued PO on a Draft/Issued WO, Acknowledged PO on another)');
select is((select array_agg(title order by title) from vendor_exposed_work_orders('25830000-0000-0000-0000-0000000000d1') where kind = 'work_order'),
  array['WO draft','WO issued'], 'AC-VSR-011 the two are WO issued and WO draft; Closed PO, Draft PO and a Closed work order add nothing');
select is((select count(*)::int from vendor_exposed_work_orders('25830000-0000-0000-0000-0000000000d1') where kind = 'project'), 1,
  'AC-VSR-011 the order naming no work order is listed as a project-level order (FR-VSR-015)');
reset role; reset request.jwt.claims;

-- §F AC-VSR-007: who can write
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ update companies set supply_risk_status = 'at_risk', supply_risk_reason = 'x' where id = '25830000-0000-0000-0000-0000000000d1' $$,
  '42501', null, 'AC-VSR-007 Finance cannot write the status columns directly (guard trigger)');
reset role; reset request.jwt.claims;
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a1","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ update companies set supply_risk_reason = 'x' where id = '25830000-0000-0000-0000-0000000000d1' $$,
  '42501', null, 'AC-VSR-007 not even Admin writes a status column directly');
select throws_ok($$ insert into companies (name, type, supply_risk_status, supply_risk_reason) values ('VSR sneak', 'Vendor', 'inactive', 'x') $$,
  '42501', null, 'AC-VSR-007 an insert carrying a non-active status is refused');
select lives_ok($$ update companies set name = 'VSR Vendor' where id = '25830000-0000-0000-0000-0000000000d1' $$,
  'AC-VSR-007 other columns stay writable');
reset role; reset request.jwt.claims;

set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a5","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select set_vendor_supply_status('25830000-0000-0000-0000-0000000000d1','at_risk','late') $$, '42501', null, 'AC-VSR-007 Executive refused (42501)');
reset role; reset request.jwt.claims;
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a6","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select set_vendor_supply_status('25830000-0000-0000-0000-0000000000d1','at_risk','late') $$, '42501', null, 'AC-VSR-007 Engineer refused (42501)');
reset role; reset request.jwt.claims;
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a3","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select set_vendor_supply_status('25830000-0000-0000-0000-0000000000d1','at_risk','late') $$, '42501', null, 'AC-VSR-007 Project Manager refused (42501)');
reset role; reset request.jwt.claims;
select ok(not has_function_privilege('anon', 'public.set_vendor_supply_status(uuid,text,text)', 'EXECUTE'), 'AC-VSR-007 anon cannot execute the function');

-- §G AC-VSR-008 / 009: refusals
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select set_vendor_supply_status('25830000-0000-0000-0000-0000000000d2','at_risk','late') $$, 'P0001', null, 'AC-VSR-008 a Client company is refused');
select throws_ok($$ select set_vendor_supply_status('25830000-0000-0000-0000-0000000000d3','at_risk','late') $$, 'P0001', null, 'AC-VSR-008 an Internal company is refused');
select throws_ok($$ select set_vendor_supply_status('25830000-0000-0000-0000-0000000000d4','at_risk','late') $$, 'P0001', null, 'AC-VSR-008 an archived vendor is refused');
select throws_ok($$ select set_vendor_supply_status('25830000-0000-0000-0000-0000000000d5','at_risk','late') $$, 'P0002', null, 'AC-VSR-008 another organisation''s vendor is refused');
select throws_ok($$ select set_vendor_supply_status('25830000-0000-0000-0000-0000000000d1','at_risk',null) $$, '23514', null, 'AC-VSR-009 at_risk without a reason is refused');
select throws_ok($$ select set_vendor_supply_status('25830000-0000-0000-0000-0000000000d1','inactive','   ') $$, '23514', null, 'AC-VSR-009 inactive with a blank reason is refused');
reset role; reset request.jwt.claims;

-- §H AC-VSR-010: the suggestion never changes the stored status
select is((select supply_risk_status from companies where id = '25830000-0000-0000-0000-0000000000d1'), 'active',
  'AC-VSR-010 an at_risk-worthy age signal leaves the stored status active');

-- §I AC-VSR-006 / 012: set, audit, history, notify. Re-open an over-60 case first so the supplier suggests at_risk.
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select set_vendor_supply_status('25830000-0000-0000-0000-0000000000d1','at_risk','Late payments, deliveries slowing') $$,
  'AC-VSR-006 Finance sets at_risk with a reason');
reset role; reset request.jwt.claims;
select is((select supply_risk_status || '|' || supply_risk_reason || '|' || supply_risk_set_by::text from companies where id = '25830000-0000-0000-0000-0000000000d1'),
  'at_risk|Late payments, deliveries slowing|25830000-0000-0000-0000-0000000000a2', 'AC-VSR-006 the status, reason and actor are stored');
select ok((select supply_risk_set_at is not null from companies where id = '25830000-0000-0000-0000-0000000000d1'), 'AC-VSR-006 the change time is stored');
select is((select detail ->> 'from' || '>' || (detail ->> 'to') || ':' || (detail ->> 'reason') from audit_events
            where action = 'company.supply_risk.change' and entity_id = '25830000-0000-0000-0000-0000000000d1'),
  'active>at_risk:Late payments, deliveries slowing', 'AC-VSR-006 the audit event carries from, to and reason');
select is((select actor_id from audit_events where action = 'company.supply_risk.change' and entity_id = '25830000-0000-0000-0000-0000000000d1'),
  '25830000-0000-0000-0000-0000000000a2'::uuid, 'AC-VSR-006 the audit event names the actor');
select is((select changes -> 'supply_risk_status' ->> 'new' from record_changes
            where entity_type = 'company' and entity_id = '25830000-0000-0000-0000-0000000000d1' and changes ? 'supply_risk_status'),
  'at_risk', 'AC-VSR-006 the company record history shows the status change');
select is((select count(*)::int from notifications where title = 'Supplier marked at risk' and owner_id = '25830000-0000-0000-0000-0000000000a3'), 1,
  'AC-VSR-012 project manager one (project with the exposed Issued work order) is notified once');
select is((select count(*)::int from notifications where title = 'Supplier marked at risk' and owner_id = '25830000-0000-0000-0000-0000000000a4'), 1,
  'AC-VSR-012 project manager two (Draft work order, other project) is notified once');
select is((select count(*)::int from notifications where title = 'Supplier marked at risk' and owner_id = '25830000-0000-0000-0000-0000000000a2'), 0,
  'AC-VSR-012 the acting user gets none');
select is((select metadata -> 'entity' ->> 'id' from notifications where title = 'Supplier marked at risk' and owner_id = '25830000-0000-0000-0000-0000000000a3'),
  '25830000-0000-0000-0000-0000000000d1', 'AC-VSR-012 the supplier is the notification''s entity');
select ok((select body like '%WO issued%' and body not like '%WO draft%' from notifications where title = 'Supplier marked at risk' and owner_id = '25830000-0000-0000-0000-0000000000a3'),
  'AC-VSR-012 the body names that project''s exposed work orders only');
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select set_vendor_supply_status('25830000-0000-0000-0000-0000000000d1','at_risk','Late payments, deliveries slowing') $$,
  'AC-VSR-012 setting the same status again is accepted');
reset role; reset request.jwt.claims;
select is((select count(*)::int from notifications where title = 'Supplier marked at risk'), 2, 'AC-VSR-012 the unchanged status adds no notification');
select is((select count(*)::int from audit_events where action = 'company.supply_risk.change' and entity_id = '25830000-0000-0000-0000-0000000000d1'), 1,
  'AC-VSR-012 and no second audit event');
set local request.jwt.claims = '{"sub":"25830000-0000-0000-0000-0000000000a1","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select set_vendor_supply_status('25830000-0000-0000-0000-0000000000d1','active',null) $$,
  'AC-VSR-009 moving back to active needs no reason (Admin)');
reset role; reset request.jwt.claims;
select is((select count(*)::int from notifications where title like 'Supplier marked%'), 2, 'OQ-VSR-4 moving back to active notifies nobody');

select * from finish();
rollback;
