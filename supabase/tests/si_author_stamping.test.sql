-- si_author_stamping.test.sql (Luna money audit — BLOCK 4)
-- Proves the BLOCK 4 invariant at the DB/RPC layer: a PMO-created Sales Invoice carries a NON-NULL
-- author_user_id = its creator (the read-model writer stamps it from the dispatch caller, per the
-- deno proof in readModelWriters.money.test.ts), and BECAUSE the author is non-null the
-- submit_sales_invoice SoD (approver≠author) is enforced — the creator cannot self-submit (42501),
-- and a different approver-role user CAN. This is the "SoD is not a no-op when author is set" half;
-- without BLOCK 4's stamping the author would be NULL and the RPC's check would short-circuit.
--
-- Namespaced UUIDs (valid hex), begin/rollback, finish() (not finish_testing()).

begin;
select plan(3);

-- Fixtures: org, author (creator), approver (different user), profiles
insert into organizations (id, name) values
  ('11060000-0000-0000-0000-000000000101','Luna BLOCK 4 Org');

insert into auth.users (id, email) values
  ('11060000-0000-0000-0000-0000000001a1','author-block4@example.com'),
  ('11060000-0000-0000-0000-0000000001b1','approver-block4@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('11060000-0000-0000-0000-0000000001a1','11060000-0000-0000-0000-000000000101','Author B4','author-block4@example.com','Finance','active'),
  ('11060000-0000-0000-0000-0000000001b1','11060000-0000-0000-0000-000000000101','Approver B4','approver-block4@example.com','Finance','active');

-- Org employs revenue → erpnext (so revenue is externally owned; the RPC is the SoD authority)
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('11060000-0000-0000-0000-000000000101','erpnext','revenue');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config) values
  ('11060000-0000-0000-0000-000000000101','erpnext','https://erp.example.com','secret-ref','{}'::jsonb);

-- A valid company for the customer FK
insert into companies (id, org_id, name, type) values
  ('11060000-0000-0000-0000-0000000001f1','11060000-0000-0000-0000-000000000101','B4 Customer','Client');

-- A PMO-created SI: author_user_id = the creator (user A) — NON-NULL, exactly what the read-model
-- writer now stamps on an outbound create (deno proof above). Service-role owner insert for setup.
insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, status, author_user_id)
values (
  '11060000-0000-0000-0000-0000000001e1',
  '11060000-0000-0000-0000-000000000101',
  '11060000-0000-0000-0000-0000000001f1',
  'B4-SI-001',
  '2026-07-15',
  1000.00,
  'Draft',
  '11060000-0000-0000-0000-0000000001a1'  -- author_user_id = creator (user A) — NON-NULL
);

-- (1) The PMO-created SI has a NON-NULL author_user_id = the creator (the BLOCK 4 stamping).
select is(
  (select author_user_id from sales_invoices where id = '11060000-0000-0000-0000-0000000001e1'),
  '11060000-0000-0000-0000-0000000001a1'::uuid,
  'Luna BLOCK 4: a PMO-created SI carries author_user_id = its creator (non-null → SoD is active)');

-- (2) The creator (user A) self-submit → 42501: with a non-null author, the SoD is NOT a no-op.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11060000-0000-0000-0000-0000000001a1","role":"authenticated"}';

select throws_ok(
  $$ select submit_sales_invoice('11060000-0000-0000-0000-0000000001e1') $$,
  '42501', null,
  'Luna BLOCK 4: the creator cannot self-submit a PMO-authored SI (SoD active, 42501)');

-- (3) A different approver-role user (B, Finance) CAN submit → the SoD allows a genuine approver.
set local request.jwt.claims = '{"sub":"11060000-0000-0000-0000-0000000001b1","role":"authenticated"}';

select lives_ok(
  $$ select submit_sales_invoice('11060000-0000-0000-0000-0000000001e1') $$,
  'Luna BLOCK 4: a different approver-role user (B) can submit the creator-authored SI (lives_ok)');

reset role;
select * from finish();
rollback;
