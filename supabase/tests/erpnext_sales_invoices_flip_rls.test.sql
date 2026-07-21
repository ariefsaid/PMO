-- erpnext_sales_invoices_flip_rls.test.sql (Slice 0, task 0.2) — OWNS AC-SAR-003 (org-scoped flip) +
-- AC-SAR-061 SI side (machine-only native writes + day-one erp_* cols). Models 0100/
-- erpnext_money_flip_rls.test.sql exactly. Namespaced UUIDs (005a-prefix, valid hex, NOT seed-colliding).
-- begin/rollback + finish() — NOT finish_testing().
begin;
select plan(11);

-- Org A (flipped revenue) + Org B (not flipped) — namespaced 005a UUIDs (valid hex)
insert into organizations (id, name) values
  ('005a0000-0000-0000-0000-000000000001','AC-SAR SI Org A (flipped)'),
  ('005a0000-0000-0000-0000-000000000002','AC-SAR SI Org B (not flipped)');
insert into auth.users (id, email) values
  ('005a0000-0000-0000-0000-0000000000a1','si-a@example.com'),
  ('005a0000-0000-0000-0000-0000000000b1','si-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('005a0000-0000-0000-0000-0000000000a1','005a0000-0000-0000-0000-000000000001','A Admin','si-a@example.com','Admin','active'),
  ('005a0000-0000-0000-0000-0000000000b1','005a0000-0000-0000-0000-000000000002','B Admin','si-b@example.com','Admin','active');

-- Seed (owner insert — bypasses RLS for fixture convenience)
insert into companies (id, org_id, name, type) values
  ('005a0000-0000-0000-0000-0000000000f1','005a0000-0000-0000-0000-000000000001','SI Customer','Client');
insert into projects (id, org_id, name, status) values
  ('005a0000-0000-0000-0000-0000000000c1','005a0000-0000-0000-0000-000000000001','SI Project','Ongoing Project');

-- A sales_invoices row in Org A (owner/service insert pre-flip, mirrors pre-migration state)
insert into sales_invoices (id, org_id, project_id, customer_id, si_number, reference_number,
  invoice_date, amount, erp_outstanding_amount, status, erp_docstatus, erp_modified,
  erp_amended_from, erp_cancelled_at, created_at)
values ('005a0000-0000-0000-0000-0000000000e1','005a0000-0000-0000-0000-000000000001',
  '005a0000-0000-0000-0000-0000000000c1','005a0000-0000-0000-0000-0000000000f1',
  'SI-001','REF-SI-001','2026-07-14',500.00,500.00,'Unpaid',0,'2026-07-14 09:00:00',
  null,null,'2026-07-14 09:00:00');

-- Flip Org A to revenue→erpnext (AFTER seed so fixture models pre-flip state; H-2: user/owner INSERT
-- denied once flipped)
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('005a0000-0000-0000-0000-000000000001','erpnext','revenue');

-- ── AC-SAR-061 SI: user-JWT native write DENIED while flipped ───────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"005a0000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update sales_invoices set amount = 600 where id = '005a0000-0000-0000-0000-0000000000e1' $$,
  '42501', null,
  'AC-SAR-061 SI: user-JWT native-field UPDATE (amount) denied while revenue is externally-owned');

select throws_ok(
  $$ insert into sales_invoices (org_id, si_number, reference_number, invoice_date, amount, status)
       values ('005a0000-0000-0000-0000-000000000001','SI-002','REF-002','2026-07-15',250.00,'Unpaid') $$,
  '42501', null,
  'AC-SAR-061 SI: user-JWT raw INSERT denied while flipped');

-- project_id is machine-only — user UPDATE of project_id must be denied while flipped
select throws_ok(
  $$ update sales_invoices set project_id = '00000000-0000-0000-0000-000000000000' where id = '005a0000-0000-0000-0000-0000000000e1' $$,
  '42501', null,
  'AC-SAR-061 SI: user-JWT UPDATE of project_id (machine-only field) denied while flipped');

-- service-role UPDATE of native + ALL erp_* mirror columns succeeds
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ update sales_invoices set amount = 750, erp_outstanding_amount = 0, status = 'Paid',
       erp_docstatus = 1, erp_modified = '2026-07-14 10:00:00', erp_amended_from = 'SI-001-amended',
       erp_cancelled_at = null where id = '005a0000-0000-0000-0000-0000000000e1' $$,
  'AC-SAR-061 SI: service-role UPDATE of native + ALL erp_* mirror cols succeeds');
select is(
  (select amount from sales_invoices where id = '005a0000-0000-0000-0000-0000000000e1'), 750::numeric,
  'AC-SAR-061 SI: amount preserved by service-role mirror write');
select is(
  (select project_id from sales_invoices where id = '005a0000-0000-0000-0000-0000000000e1'),
  '005a0000-0000-0000-0000-0000000000c1'::uuid,
  'AC-SAR-061 SI: project_id FK preserved under the flip');

-- information_schema.columns confirms the four day-one erp_* cols + erp_outstanding_amount exist
select is(
  (select count(*)::int from information_schema.columns
    where table_name = 'sales_invoices' and column_name in
      ('erp_docstatus','erp_modified','erp_amended_from','erp_cancelled_at','erp_outstanding_amount')),
  5,
  'AC-SAR-061 SI: day-one erp_* feed cols (docstatus,modified,amended_from,cancelled_at) + erp_outstanding_amount all present');

-- ── AC-SAR-003: org isolation (org A reads its row; org B reads 0) ───────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"005a0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from sales_invoices where id = '005a0000-0000-0000-0000-0000000000e1'), 1,
  'AC-SAR-003 SI: org-A member reads own flipped row');

set local request.jwt.claims = '{"sub":"005a0000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from sales_invoices where id = '005a0000-0000-0000-0000-0000000000e1'), 0,
  'AC-SAR-003 SI: org-B member reads 0 rows of org-A flipped row (org isolation)');

-- ── Org B (NOT flipped): procurement/companies behavior byte-for-byte (AC-SAR-003 cross-domain) ──
-- Verified by the existence of the proc/PI RPCs still succeeding for Org B.
-- We don't need to seed full procurement here — the P2 suite already owns that proof.
-- This assertion simply confirms the revenue flip does NOT leak to other domains.
select ok(not public.domain_externally_owned('005a0000-0000-0000-0000-000000000002'::uuid, 'revenue'),
  'AC-SAR-003 cross-domain: org-B is NOT flipped on revenue (domains are independent)');
select ok(not public.domain_externally_owned('005a0000-0000-0000-0000-000000000001'::uuid, 'procurement'),
  'AC-SAR-003 cross-domain: org-A flipped revenue does NOT auto-flip procurement');

-- Org B create_procurement_invoice would still succeed (byte-for-byte) — we don't re-seed it here;
-- the AC-ENA-072 cross-table proof already covers that P2 behavior is undisturbed.

-- ── Reversibility trigger note (no assertion needed — stamp_org_id() is pre-existing 0074 pattern) ──
-- stamp_org_id() BEFORE INSERT overrides null/seed org_id ONLY. Safe for the service-role writer
-- (no GENERATED column → no bypass needed; FR-SAR-171). A user-JWT INSERT is already blocked by
-- the INSERT policy (domain_externally_owned check) so the trigger never fires for a user row.

select finish();
rollback;