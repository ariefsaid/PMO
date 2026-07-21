-- si_submit_sod_null_author.test.sql (0108 — Luna re-audit BLOCK 6, defence in depth)
--
-- readModelWriters stamps `author_user_id: ctx.callerUserId ?? null`, so some paths can leave the
-- author NULL. 0105's SoD then compares approver≠author against a NULL author, which passes trivially
-- for EVERYONE — the two-person rule silently evaporates on exactly the rows where we cannot prove who
-- authored the invoice. 0108 makes `submit_sales_invoice` REJECT a submit when author_user_id IS NULL
-- (fail closed, distinct 'sod-author-missing' detail).
--
-- The 0105 happy paths (self-submit denied / different approver allowed) are re-asserted here as
-- regressions: fail-closed must not become fail-everything.
-- Uses namespaced UUIDs, begin/rollback, finish().

begin;
select plan(6);

insert into organizations (id, name) values
  ('11080000-0000-0000-0000-000000000201','B6 SoD Org');

insert into auth.users (id, email) values
  ('11080000-0000-0000-0000-0000000002a1','author-a-b6@example.com'),
  ('11080000-0000-0000-0000-0000000002b1','approver-b-b6@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('11080000-0000-0000-0000-0000000002a1','11080000-0000-0000-0000-000000000201','Author A','author-a-b6@example.com','Finance','active'),
  ('11080000-0000-0000-0000-0000000002b1','11080000-0000-0000-0000-000000000201','Approver B','approver-b-b6@example.com','Finance','active');

insert into external_domain_ownership (org_id, external_tier, domain) values
  ('11080000-0000-0000-0000-000000000201','erpnext','revenue');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config) values
  ('11080000-0000-0000-0000-000000000201','erpnext','https://erp-b6.example.com','secret-ref-b6','{}'::jsonb);

insert into companies (id, org_id, name, type) values
  ('11080000-0000-0000-0000-0000000002c1','11080000-0000-0000-0000-000000000201','B6 Customer','Client');

-- SI #1: author_user_id NULL — the row the SoD cannot reason about.
insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, status, author_user_id)
values ('11080000-0000-0000-0000-0000000002f1','11080000-0000-0000-0000-000000000201',
        '11080000-0000-0000-0000-0000000002c1','B6-SI-NULL-AUTHOR','2026-07-16',1000.00,'Draft', null);

-- SI #2: authored by A — the control (0105's proven behaviour must be intact).
insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, status, author_user_id)
values ('11080000-0000-0000-0000-0000000002f2','11080000-0000-0000-0000-000000000201',
        '11080000-0000-0000-0000-0000000002c1','B6-SI-AUTHORED','2026-07-16',2000.00,'Draft',
        '11080000-0000-0000-0000-0000000002a1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11080000-0000-0000-0000-0000000002b1","role":"authenticated"}';

-- 1) A NULL-author SI cannot be submitted by ANY approver — approver≠author is unprovable, so fail closed.
select throws_ok(
  $$ select submit_sales_invoice('11080000-0000-0000-0000-0000000002f1') $$,
  '42501', null,
  'B6: submitting a NULL-author sales invoice is denied 42501 (SoD fails closed — a null author cannot satisfy approver≠author)');

-- 2) ...and the denial is the AUTHOR-MISSING one, not a self-approval mislabel (distinct detail).
select throws_like(
  $$ select submit_sales_invoice('11080000-0000-0000-0000-0000000002f1') $$,
  '%author%',
  'B6: the NULL-author denial names the missing author (distinct from sod-self-approval)');

-- 3) The invoice is untouched by the rejection.
select is(
  (select erp_docstatus from sales_invoices where id = '11080000-0000-0000-0000-0000000002f1'),
  null,
  'B6: erp_docstatus unchanged after the null-author rejection (no ERP submit follows)');

-- 4) REGRESSION — a properly authored SI still submits for a DIFFERENT approver (B, Finance).
select lives_ok(
  $$ select submit_sales_invoice('11080000-0000-0000-0000-0000000002f2') $$,
  'B6: a normally authored SI still submits for a different approver (fail-closed did not become fail-everything)');

-- 5) REGRESSION — the author still cannot self-approve their own authored SI.
set local request.jwt.claims = '{"sub":"11080000-0000-0000-0000-0000000002a1","role":"authenticated"}';
select throws_ok(
  $$ select submit_sales_invoice('11080000-0000-0000-0000-0000000002f2') $$,
  '42501', null,
  'B6: the author still cannot self-approve their own SI (0105 SoD intact)');

-- 6) REGRESSION — a not-found SI still raises P0002, not the new author check.
select throws_ok(
  $$ select submit_sales_invoice('11080000-0000-0000-0000-00000000ffff') $$,
  'P0002', null,
  'B6: a missing SI still raises P0002 (the null-author guard did not swallow the not-found path)');

reset role;
select * from finish();
rollback;
