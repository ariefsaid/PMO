-- si_author_user_id_mirror_guard.test.sql (Luna money audit — BLOCK 3)
-- On a revenue-flipped org, sales_invoices_native_mirror_guard (0104) pinned every native field EXCEPT
-- author_user_id (the column landed in 0105, after 0104's guard). So an authenticated user could
-- UPDATE author_user_id to someone else and then self-approve — defeating the submit_sales_invoice
-- approver≠author SoD. Migration 0106 re-creates the guard WITH author_user_id in the pinned set
-- (service_role still bypasses).
--
-- Proves: user-JWT UPDATE of author_user_id on a flipped org → 42501; service_role UPDATE succeeds.
-- Namespaced UUIDs (1103-prefix, valid hex), begin/rollback, finish().

begin;
select plan(3);

-- Org flipped to revenue→erpnext
insert into organizations (id, name) values
  ('11030000-0000-0000-0000-000000000001','Luna BLOCK 3 Org (flipped)');
insert into auth.users (id, email) values
  ('11030000-0000-0000-0000-0000000000a1','block3-author@example.com'),
  ('11030000-0000-0000-0000-0000000000a2','block3-patsy@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('11030000-0000-0000-0000-0000000000a1','11030000-0000-0000-0000-000000000001','B3 Author','block3-author@example.com','Finance','active'),
  ('11030000-0000-0000-0000-0000000000a2','11030000-0000-0000-0000-000000000001','B3 Patsy','block3-patsy@example.com','Finance','active');

insert into companies (id, org_id, name, type) values
  ('11030000-0000-0000-0000-0000000000f1','11030000-0000-0000-0000-000000000001','B3 Customer','Client');

-- A sales_invoice authored by user A (owner insert for setup)
insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, status, author_user_id)
values (
  '11030000-0000-0000-0000-0000000000e1',
  '11030000-0000-0000-0000-000000000001',
  '11030000-0000-0000-0000-0000000000f1',
  'B3-SI-001','2026-07-15',500.00,'Draft',
  '11030000-0000-0000-0000-0000000000a1'  -- author_user_id = user A
);

-- Flip org to revenue→erpnext (so native fields are read-only to users)
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('11030000-0000-0000-0000-000000000001','erpnext','revenue');

-- (1) Luna BLOCK 3: user-JWT UPDATE of author_user_id on a flipped org → 42501
--     (without the fix, author_user_id is NOT pinned → the update would succeed and the user could
--      re-point the author to a patsy then self-approve).
set local role authenticated;
set local request.jwt.claims = '{"sub":"11030000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update sales_invoices set author_user_id = '11030000-0000-0000-0000-0000000000a2' where id = '11030000-0000-0000-0000-0000000000e1' $$,
  '42501', null,
  'Luna BLOCK 3: user-JWT UPDATE of author_user_id denied on a flipped org (pinned by the native mirror guard)');

-- author_user_id unchanged after the denied update
select is(
  (select author_user_id from sales_invoices where id = '11030000-0000-0000-0000-0000000000e1'),
  '11030000-0000-0000-0000-0000000000a1'::uuid,
  'Luna BLOCK 3: author_user_id preserved after the denied user UPDATE');

-- (2) service_role UPDATE of author_user_id still succeeds (service bypasses the guard — the
--     read-model writer must be able to stamp it on a genuine create).
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

select lives_ok(
  $$ update sales_invoices set author_user_id = '11030000-0000-0000-0000-0000000000a2' where id = '11030000-0000-0000-0000-0000000000e1' $$,
  'Luna BLOCK 3: service-role UPDATE of author_user_id succeeds (service bypasses the guard)');

reset role;
select * from finish();
rollback;
