-- sales_ar_offboarded_rls.test.sql
-- Luna re-audit BLOCK #10 [pgTAP]: offboarded (disabled) users must not read AR data.
--
-- 0104's revenue policies were written from the 0100 template, which predates the FR-INV-003
-- conjunction pass — they gate on `org_id = auth_org_id()` alone and omit `is_active_member()`
-- (0062), which every other business table requires (0063 conjoined it into all 5 policy kinds).
-- A disabled user holding a still-valid JWT could therefore export invoice amounts, outstanding
-- balances, customers and payment allocations from `sales_invoices` / `incoming_payments`.
--
-- Proof shape mirrors 0125_ops_admin_disabled_reads_nothing.test.sql: business rows are seeded AS
-- TABLE OWNER so "0 rows" is a real DENY, not an empty table, and the SAME rows are then read by an
-- ACTIVE member of the same org to prove the conjunct denies offboarded users specifically rather
-- than breaking the tables for everyone.
begin;
select plan(8);

-- ── Fixtures: one org, one ACTIVE Finance member, one DISABLED Finance member. ──
insert into organizations (id, name) values
  ('01190000-0000-0000-0000-000000000001','Luna B10 Org');
insert into auth.users (id, email) values
  ('01190000-0000-0000-0000-0000000000a1','b10-active@example.com'),
  ('01190000-0000-0000-0000-0000000000a2','b10-disabled@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('01190000-0000-0000-0000-0000000000a1','01190000-0000-0000-0000-000000000001','A Active','b10-active@example.com','Finance','active'),
  ('01190000-0000-0000-0000-0000000000a2','01190000-0000-0000-0000-000000000001','D Disabled','b10-disabled@example.com','Finance','disabled');

insert into companies (id, org_id, name, type) values
  ('01190000-0000-0000-0000-0000000c0001','01190000-0000-0000-0000-000000000001','B10 Customer','Client');
insert into sales_invoices (id, org_id, customer_id, si_number, amount, erp_outstanding_amount, status) values
  ('01190000-0000-0000-0000-0000000e0001','01190000-0000-0000-0000-000000000001','01190000-0000-0000-0000-0000000c0001','ACC-SINV-B10-0001',125000.00,125000.00,'Unpaid');
insert into incoming_payments (id, org_id, customer_id, sales_invoice_id, ip_number, amount, status) values
  ('01190000-0000-0000-0000-0000000f0001','01190000-0000-0000-0000-000000000001','01190000-0000-0000-0000-0000000c0001','01190000-0000-0000-0000-0000000e0001','ACC-PE-B10-0001',25000.00,'Paid');

-- ════════════════════════════════════════════════════════════════════════════
-- DENY: the DISABLED member reads no AR rows at all.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01190000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is((select count(*)::int from sales_invoices), 0,
  'Luna B10 disabled member reads 0 sales_invoices (is_active_member conjunct on SELECT)');
select is((select count(*)::int from incoming_payments), 0,
  'Luna B10 disabled member reads 0 incoming_payments (is_active_member conjunct on SELECT)');
-- The money columns specifically — the exfiltration the finding describes.
select is((select coalesce(sum(amount),0)::numeric from sales_invoices), 0::numeric,
  'Luna B10 disabled member cannot sum invoice amounts');
select is((select coalesce(sum(amount),0)::numeric from incoming_payments), 0::numeric,
  'Luna B10 disabled member cannot sum payment allocations');

-- ════════════════════════════════════════════════════════════════════════════
-- ALLOW: an ACTIVE member of the SAME org still reads the SAME rows — the conjunct denies
-- offboarded users, it does not break the tables.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"01190000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from sales_invoices), 1,
  'Luna B10 active member still reads sales_invoices');
select is((select count(*)::int from incoming_payments), 1,
  'Luna B10 active member still reads incoming_payments');
select is((select amount from sales_invoices where id = '01190000-0000-0000-0000-0000000e0001'), 125000.00,
  'Luna B10 active member still reads the invoice amount');
select is((select amount from incoming_payments where id = '01190000-0000-0000-0000-0000000f0001'), 25000.00,
  'Luna B10 active member still reads the payment amount');

select * from finish();
rollback;
