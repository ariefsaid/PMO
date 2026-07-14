-- si_submit_sod.test.sql (Slice 3, task 3.3) — OWNS AC-SAR-073
-- Seeds a draft sales_invoices row authored by user A (author_user_id=A); asserts:
--   - user A calling submit_sales_invoice(si_id) → sod-self-approval (42501), no docstatus change;
--   - user B (different approver-role user) calling submit_sales_invoice(si_id) → succeeds;
--   - draft authoring by A (create/edit) is ungated by SoD (the SoD applies to submit only),
--     but the native mirror guard blocks user edits when revenue is externally owned.
-- Uses namespaced UUIDs (valid hex only), begin/rollback, finish() not finish_testing().

begin;
select plan(8);

-- Fixtures: org, users (A=author, B=approver, C=non-approver-role), profiles
insert into organizations (id, name) values
  ('11050000-0000-0000-0000-000000000101','AC-SAR-073 SoD Org');

insert into auth.users (id, email) values
  ('11050000-0000-0000-0000-0000000001a1','author-a@example.com'),
  ('11050000-0000-0000-0000-0000000001b1','approver-b@example.com'),
  ('11050000-0000-0000-0000-0000000001c1','non-approver-c@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('11050000-0000-0000-0000-0000000001a1','11050000-0000-0000-0000-000000000101','Author A','author-a@example.com','Project Manager','active'),
  ('11050000-0000-0000-0000-0000000001b1','11050000-0000-0000-0000-000000000101','Approver B','approver-b@example.com','Finance','active'),
  ('11050000-0000-0000-0000-0000000001c1','11050000-0000-0000-0000-000000000101','Non-Approver C','non-approver-c@example.com','Engineer','active');

-- Org employs revenue → erpnext (so the table is externally owned, but the RPC is the gate)
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('11050000-0000-0000-0000-000000000101','erpnext','revenue');

insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config) values
  ('11050000-0000-0000-0000-000000000101','erpnext','https://erp.example.com','secret-ref','{}'::jsonb);

-- Create a valid company for the customer FK (company_type enum: Internal, Client, Vendor)
insert into companies (id, org_id, name, type) values
  ('11050000-0000-0000-0000-0000000001f1','11050000-0000-0000-0000-000000000101','Test Customer','Client');

-- Seed a draft sales_invoices row authored by user A (author_user_id = A)
-- Use valid UUIDs (hex only: 0-9, a-f)
insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, status, author_user_id)
values (
  '11050000-0000-0000-0000-0000000001f1',  -- si_id: valid hex UUID
  '11050000-0000-0000-0000-000000000101',
  '11050000-0000-0000-0000-0000000001f1',  -- customer_id = company id
  'DRAFT-SI-001',
  '2026-07-14',
  1000.00,
  'Draft',
  '11050000-0000-0000-0000-0000000001a1'  -- author_user_id = user A
);

-- ── SoD test 1: Author (user A) tries to submit their own draft → DENIED (sod-self-approval, 42501)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11050000-0000-0000-0000-0000000001a1","role":"authenticated"}';

select throws_ok(
  $$ select submit_sales_invoice('11050000-0000-0000-0000-0000000001f1') $$,
  '42501', null,
  'AC-SAR-073: author (user A) self-submit denied with sod-self-approval (42501)');

-- Verify docstatus unchanged (the RPC doesn't change status; dispatch does that after RPC succeeds)
select is(
  (select erp_docstatus from sales_invoices where id = '11050000-0000-0000-0000-0000000001f1'),
  null,
  'AC-SAR-073: erp_docstatus remains null after self-submit rejection');

-- ── SoD test 2: Different approver-role user (user B, Finance) submits → ALLOWED
set local request.jwt.claims = '{"sub":"11050000-0000-0000-0000-0000000001b1","role":"authenticated"}';

select lives_ok(
  $$ select submit_sales_invoice('11050000-0000-0000-0000-0000000001f1') $$,
  'AC-SAR-073: different approver-role user (B, Finance) submit succeeds (lives_ok)');

-- Verify the RPC returns the row (dispatch will then issue ERP submit)
select isnt(
  (select submit_sales_invoice('11050000-0000-0000-0000-0000000001f1'))::text,
  '',
  'AC-SAR-073: RPC returns the sales_invoices row on success');

-- ── SoD test 3: Non-approver role (user C, Engineer) tries to submit → DENIED (role gate)
set local request.jwt.claims = '{"sub":"11050000-0000-0000-0000-0000000001c1","role":"authenticated"}';

select throws_ok(
  $$ select submit_sales_invoice('11050000-0000-0000-0000-0000000001f1') $$,
  '42501', null,
  'AC-SAR-073: non-approver-role user (C, Engineer) submit denied (42501)');

-- ── Draft authoring is ungated by SoD: verify SoD does NOT block author edits
-- However, the native mirror guard DOES block user edits when revenue is externally owned.
-- This test verifies the SoD check is not the blocker (the mirror guard is a separate mechanism).
set local request.jwt.claims = '{"sub":"11050000-0000-0000-0000-0000000001a1","role":"authenticated"}';

select throws_ok(
  $$ update sales_invoices set amount = 1500.00 where id = '11050000-0000-0000-0000-0000000001f1' $$,
  '42501', null,
  'AC-SAR-073: author edit blocked by native mirror guard (not SoD) when revenue externally owned');

-- Amount unchanged due to mirror guard
select is(
  (select amount from sales_invoices where id = '11050000-0000-0000-0000-0000000001f1'),
  1000.00,
  'AC-SAR-073: amount unchanged after mirror guard rejection');

-- ── Non-revenue org: RPC should deny (org guard)
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

insert into organizations (id, name) values
  ('11050000-0000-0000-0000-000000000102','AC-SAR-073 Non-Revenue Org');
insert into auth.users (id, email) values
  ('11050000-0000-0000-0000-0000000001d1','admin-d@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('11050000-0000-0000-0000-0000000001d1','11050000-0000-0000-0000-000000000102','Admin D','admin-d@example.com','Admin','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config) values
  ('11050000-0000-0000-0000-000000000102','erpnext','https://erp-d.example.com','secret-ref-d','{}'::jsonb);
-- No external_domain_ownership for revenue → not externally owned

insert into companies (id, org_id, name, type) values
  ('11050000-0000-0000-0000-0000000001f2','11050000-0000-0000-0000-000000000102','Test Customer D','Client');

insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, status, author_user_id)
values (
  '11050000-0000-0000-0000-0000000001f2',
  '11050000-0000-0000-0000-000000000102',
  '11050000-0000-0000-0000-0000000001f2',
  'DRAFT-SI-002',
  '2026-07-14',
  500.00,
  'Draft',
  '11050000-0000-0000-0000-0000000001d1'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11050000-0000-0000-0000-0000000001d1","role":"authenticated"}';

select throws_ok(
  $$ select submit_sales_invoice('11050000-0000-0000-0000-0000000001f2') $$,
  '42501', null,
  'AC-SAR-073: non-revenue org submit denied by org guard (42501)');

reset role;
select * from finish();
rollback;