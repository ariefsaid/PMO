-- si_submit_sod_reauthor.test.sql — Luna re-audit (SoD): the APPROVER half of OD-SAR-DRAFT-SUBMIT.
--
-- The two-person rule was only half-closed. `sales_invoices.author_user_id` was stamped ONLY on the
-- create mirror, so a designated approver B could REWRITE the money on A's draft (an `update` or a
-- `transition{verb:'amend'}` rebuilds the ERP Sales Invoice body from the caller's `items` —
-- `buildsSalesInvoiceBody`) and then submit it: the RPC compared submitter B against author A, saw
-- A≠B, and passed. B alone set the number AND approved it.
--
-- The fix lives in the read-model writer (adapter-dispatch/readModelWriters.ts): a BODY-BUILDING
-- update re-stamps `author_user_id` = the updating caller. This proof asserts the DB-side consequence
-- of that stamp — the half `submit_sales_invoice` owns: once B is recorded as the author, B's own
-- submit is refused as self-approval, and the invoice can only move with a genuine second person.
--
-- The re-stamp is written by the SERVICE-ROLE writer (which bypasses 0106's native mirror guard), so
-- it is performed here under service_role claims, exactly as the edge function does it.
-- Uses namespaced UUIDs (valid hex only), begin/rollback, finish() not finish_testing().

begin;
select plan(4);

-- ── Fixtures: one revenue-flipped org; A = original author, B = approver (Finance). ──
insert into organizations (id, name) values
  ('11110000-0000-0000-0000-000000000101','SoD Re-Author Org');

insert into auth.users (id, email) values
  ('11110000-0000-0000-0000-0000000001a1','reauthor-a@example.com'),
  ('11110000-0000-0000-0000-0000000001b1','reauthor-b@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('11110000-0000-0000-0000-0000000001a1','11110000-0000-0000-0000-000000000101','Author A','reauthor-a@example.com','Project Manager','active'),
  ('11110000-0000-0000-0000-0000000001b1','11110000-0000-0000-0000-000000000101','Approver B','reauthor-b@example.com','Finance','active');

insert into external_domain_ownership (org_id, external_tier, domain) values
  ('11110000-0000-0000-0000-000000000101','erpnext','revenue');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config) values
  ('11110000-0000-0000-0000-000000000101','erpnext','https://erp.example.com','secret-ref','{}'::jsonb);

insert into companies (id, org_id, name, type) values
  ('11110000-0000-0000-0000-0000000001f1','11110000-0000-0000-0000-000000000101','Re-Author Customer','Client');

-- A authors a 1,000 draft.
insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, status, author_user_id)
values (
  '11110000-0000-0000-0000-0000000001e1',
  '11110000-0000-0000-0000-000000000101',
  '11110000-0000-0000-0000-0000000001f1',
  'DRAFT-SI-REAUTH-001',
  '2026-07-19',
  1000.00,
  'Draft',
  '11110000-0000-0000-0000-0000000001a1'
);

-- ════════════════════════════════════════════════════════════════════════════
-- Baseline: while A is the recorded author, B is a legitimate second person.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"11110000-0000-0000-0000-0000000001b1","role":"authenticated"}';

select lives_ok(
  $$ select submit_sales_invoice('11110000-0000-0000-0000-0000000001e1') $$,
  'baseline: with A recorded as author, approver B satisfies the two-person rule');

-- ════════════════════════════════════════════════════════════════════════════
-- B rewrites the money. The read-model writer mirrors that body-building update as SERVICE ROLE and
-- (post-fix) re-stamps author_user_id = B — whoever builds the body is the author.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

update sales_invoices
   set amount = 1000000.00,
       author_user_id = '11110000-0000-0000-0000-0000000001b1'
 where id = '11110000-0000-0000-0000-0000000001e1';

select is(
  (select author_user_id from sales_invoices where id = '11110000-0000-0000-0000-0000000001e1'),
  '11110000-0000-0000-0000-0000000001b1'::uuid,
  'the body-building update re-stamps authorship onto B (the caller who set the money)');

-- ════════════════════════════════════════════════════════════════════════════
-- The fix: B can no longer approve the money B just set.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"11110000-0000-0000-0000-0000000001b1","role":"authenticated"}';

select throws_ok(
  $$ select submit_sales_invoice('11110000-0000-0000-0000-0000000001e1') $$,
  '42501', null,
  'after re-authoring, B submitting their OWN money is denied as self-approval (42501)');

-- ...and the rule still WORKS: a genuine second person (A) may approve B's number.
set local request.jwt.claims = '{"sub":"11110000-0000-0000-0000-0000000001a1","role":"authenticated"}';

select lives_ok(
  $$ select submit_sales_invoice('11110000-0000-0000-0000-0000000001e1') $$,
  'the two-person rule still functions with the roles swapped: A may approve B-authored money');

reset role;
select * from finish();
rollback;
