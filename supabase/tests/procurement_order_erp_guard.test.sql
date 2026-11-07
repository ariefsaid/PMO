-- procurement_order_erp_guard.test.sql
-- #1607 blocker A (AC-ECA-050) [pgTAP]: "Record order" (transition_procurement -> Ordered) on a purchase whose
-- procurement the ERP owns must not mint a PMO-only purchase order; the order goes through the Purchase Order
-- capture that dispatches to the ERP. A pre-cut-over case (PD-ECA-9) and a PMO-owned org keep recording in PMO.
begin;
select plan(9);

insert into organizations (id, name) values
  ('07490000-0000-0000-0000-000000000001', 'OG Org A (ERP)'),
  ('07490000-0000-0000-0000-000000000002', 'OG Org B (PMO)');
insert into auth.users (id, email) values
  ('07490000-0000-0000-0000-0000000000a1', 'og-a-pm@example.com'),
  ('07490000-0000-0000-0000-0000000000b1', 'og-b-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07490000-0000-0000-0000-0000000000a1', '07490000-0000-0000-0000-000000000001', 'A PM', 'og-a-pm@example.com', 'Project Manager', 'active'),
  ('07490000-0000-0000-0000-0000000000b1', '07490000-0000-0000-0000-000000000002', 'B PM', 'og-b-pm@example.com', 'Project Manager', 'active');

insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, version_major, config, activated_at) values
  ('07490000-0000-0000-0000-000000000001', 'erpnext', 'https://synthetic.invalid', 'fixture', 16, '{"company":"OG Co"}', '2026-06-01T00:00:00Z');
insert into external_domain_ownership (org_id, external_tier, domain, created_at) values
  ('07490000-0000-0000-0000-000000000001', 'erpnext', 'procurement', '2026-07-15T00:00:00Z');

-- post = no document yet; pre = a bill PMO captured before the connection; own = PMO-owned org; bcase = org B's.
insert into procurements (id, org_id, code, title, status, currency) values
  ('07490000-0000-0000-0000-0000000000c1', '07490000-0000-0000-0000-000000000001', 'OG-POST', 'Approved, ERP-owned',   'Approved', 'IDR'),
  ('07490000-0000-0000-0000-0000000000c2', '07490000-0000-0000-0000-000000000001', 'OG-PRE',  'Approved, pre-cut-over', 'Approved', 'IDR'),
  ('07490000-0000-0000-0000-0000000000c3', '07490000-0000-0000-0000-000000000002', 'OG-OWN',  'Approved, PMO-owned',    'Approved', 'IDR');
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, tax_treatment, tax_amount, currency, created_at, erp_docstatus) values
  ('07490000-0000-0000-0000-0000000000e2', '07490000-0000-0000-0000-000000000001', '07490000-0000-0000-0000-0000000000c2', 'VI-OG-PRE', '2026-05-20', 'Received', 1000, 'exclusive', 0, 'IDR', '2026-05-20T00:00:00Z', null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"07490000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select transition_procurement('07490000-0000-0000-0000-0000000000c1', 'Ordered')$$, '42501',
  'This purchase is managed in your connected system. Record the purchase order to place the order there.',
  'AC-ECA-050 Record order on an ERP-owned post-cut-over case is refused in plain words');
reset role;
select is((select count(*)::int from purchase_orders where procurement_id = '07490000-0000-0000-0000-0000000000c1'), 0,
  'AC-ECA-050 the refused order minted no PMO-only purchase order');
select is((select status::text from procurements where id = '07490000-0000-0000-0000-0000000000c1'), 'Approved',
  'AC-ECA-050 the refused case stays Approved');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07490000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select transition_procurement('07490000-0000-0000-0000-0000000000c2', 'Ordered')$$,
  'PD-ECA-9 a pre-cut-over case still records its order in PMO');
reset role;
select is((select count(*)::int from purchase_orders where procurement_id = '07490000-0000-0000-0000-0000000000c2'), 1,
  'PD-ECA-9 the pre-cut-over order is a PMO purchase order');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07490000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($$select transition_procurement('07490000-0000-0000-0000-0000000000c3', 'Ordered')$$,
  'a PMO-owned org still records its order through Record order');
reset role;
select is((select count(*)::int from purchase_orders where procurement_id = '07490000-0000-0000-0000-0000000000c3'), 1,
  'a PMO-owned org gets its PMO purchase order');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07490000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select transition_procurement('07490000-0000-0000-0000-0000000000c1', 'Ordered')$$, '42501', 'not authorized',
  'org isolation: org B cannot order org A''s case');
reset role;
select is((select count(*)::int from purchase_orders where procurement_id = '07490000-0000-0000-0000-0000000000c1'), 0,
  'org isolation: still no purchase order on org A''s case');

select * from finish();
rollback;
