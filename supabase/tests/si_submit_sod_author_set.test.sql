-- si_submit_sod_author_set.test.sql (0113 §A/§B) — SoD DEFECT 1: authorship is LAST-WRITER-WINS.
--
-- `sales_invoices.author_user_id` records only the MOST RECENT body-writer, and `submit_sales_invoice`
-- compared the submitter against that single current value. The two-person rule therefore collapsed
-- under an entirely ordinary sequence:
--
--   A creates a 1,000,000 sales invoice          → author_user_id = A
--   A asks B (the designated approver) to fix the due date; B's `update` REBUILDS the ERP body
--                                                → author_user_id = B   (last-writer-wins)
--   B is now SoD-blocked, so **A submits it**    → the RPC sees author B ≠ submitter A → PASS
--
-- A both set the money and approved it. The invariant must be "NOBODY WHO EVER WROTE THE BODY MAY
-- APPROVE", not "not the last writer": 0113 adds the append-only `sales_invoice_authors` SET (written
-- by the read-model writer on every body-building write, deno-proved in readModelWriters.money.test.ts)
-- and `submit_sales_invoice` refuses any submitter present in it.
--
-- `author_user_id` is KEPT (0106's mirror guard and other code reference it) and is still honoured as
-- a member of the set, so pre-0113 rows that carry only the scalar stay covered — but it is no longer
-- the oracle. 0108 §B's NULL-author fail-closed rule survives as "an EMPTY author set refuses submit".
--
-- Namespaced UUIDs (valid hex), begin/rollback, finish() (not finish_testing()).

begin;
select plan(12);

-- ── Fixtures: one revenue-flipped org; A = original author (PM), B = approver who edits (Finance),
--    C = a genuine, untainted third party (Finance). ──
insert into organizations (id, name) values
  ('11130000-0000-0000-0000-000000000101','SoD Author-Set Org'),
  ('11130000-0000-0000-0000-000000000102','SoD Author-Set Other Org');

insert into auth.users (id, email) values
  ('11130000-0000-0000-0000-0000000001a1','set-a@example.com'),
  ('11130000-0000-0000-0000-0000000001b1','set-b@example.com'),
  ('11130000-0000-0000-0000-0000000001c1','set-c@example.com'),
  ('11130000-0000-0000-0000-0000000001d1','set-outsider@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('11130000-0000-0000-0000-0000000001a1','11130000-0000-0000-0000-000000000101','Author A','set-a@example.com','Project Manager','active'),
  ('11130000-0000-0000-0000-0000000001b1','11130000-0000-0000-0000-000000000101','Approver B','set-b@example.com','Finance','active'),
  ('11130000-0000-0000-0000-0000000001c1','11130000-0000-0000-0000-000000000101','Third Party C','set-c@example.com','Finance','active'),
  ('11130000-0000-0000-0000-0000000001d1','11130000-0000-0000-0000-000000000102','Outsider D','set-outsider@example.com','Admin','active');

insert into external_domain_ownership (org_id, external_tier, domain) values
  ('11130000-0000-0000-0000-000000000101','erpnext','revenue');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config) values
  ('11130000-0000-0000-0000-000000000101','erpnext','https://erp-set.example.com','secret-ref-set','{}'::jsonb);

insert into companies (id, org_id, name, type) values
  ('11130000-0000-0000-0000-0000000001f1','11130000-0000-0000-0000-000000000101','Author-Set Customer','Client');

-- A authors a 1,000,000 draft. The read-model writer stamps BOTH the scalar and the set.
insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, status, author_user_id)
values ('11130000-0000-0000-0000-0000000001e1','11130000-0000-0000-0000-000000000101',
        '11130000-0000-0000-0000-0000000001f1','SET-SI-001','2026-07-20',1000000.00,'Draft',
        '11130000-0000-0000-0000-0000000001a1');
insert into sales_invoice_authors (org_id, sales_invoice_id, user_id) values
  ('11130000-0000-0000-0000-000000000101','11130000-0000-0000-0000-0000000001e1','11130000-0000-0000-0000-0000000001a1');

-- ════════════════════════════════════════════════════════════════════════════
-- The EXPLOIT: B (the designated approver) edits A's invoice. The read-model writer re-stamps the
-- scalar to B (last-writer-wins) AND appends B to the set. Replayed here exactly as the SERVICE-ROLE
-- writer performs it (it bypasses 0106's native mirror guard).
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"role":"service_role"}';

update sales_invoices
   set invoice_date = '2026-07-25',
       author_user_id = '11130000-0000-0000-0000-0000000001b1'
 where id = '11130000-0000-0000-0000-0000000001e1';
insert into sales_invoice_authors (org_id, sales_invoice_id, user_id) values
  ('11130000-0000-0000-0000-000000000101','11130000-0000-0000-0000-0000000001e1','11130000-0000-0000-0000-0000000001b1')
  on conflict do nothing;

-- The scalar now points at B — the pre-0113 oracle would clear A.
select is(
  (select author_user_id from sales_invoices where id = '11130000-0000-0000-0000-0000000001e1'),
  '11130000-0000-0000-0000-0000000001b1'::uuid,
  'precondition: the co-worker edit made B the LAST writer (the scalar oracle now points away from A)');

-- ...but the SET still remembers A.
select is(
  (select count(*)::int from sales_invoice_authors where sales_invoice_id = '11130000-0000-0000-0000-0000000001e1'),
  2,
  'the authorship SET is append-only: it holds BOTH A and B (a later writer never displaces an earlier one)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11130000-0000-0000-0000-0000000001a1","role":"authenticated"}';

-- THE DEFECT: A, who chose the 1,000,000, must not be able to approve it just because B touched it after.
select throws_ok(
  $$ select submit_sales_invoice('11130000-0000-0000-0000-0000000001e1') $$,
  '42501', null,
  'DEFECT 1: A (who set the money) cannot approve it after a co-worker edit handed the scalar author to B');

select throws_like(
  $$ select submit_sales_invoice('11130000-0000-0000-0000-0000000001e1') $$,
  '%approver must differ%',
  'DEFECT 1: the denial is a self-approval denial (A is in the author set), not a mislabelled other error');

select is(
  (select erp_docstatus from sales_invoices where id = '11130000-0000-0000-0000-0000000001e1'),
  null,
  'DEFECT 1: nothing moved — erp_docstatus is untouched by the refusal (no ERP submit follows)');

-- B, the other body-writer, is refused too (the set covers every writer, not just the earliest).
set local request.jwt.claims = '{"sub":"11130000-0000-0000-0000-0000000001b1","role":"authenticated"}';
select throws_ok(
  $$ select submit_sales_invoice('11130000-0000-0000-0000-0000000001e1') $$,
  '42501', null,
  'DEFECT 1: B (the other body-writer) is refused as well — every writer in the set is disqualified');

-- ════════════════════════════════════════════════════════════════════════════
-- Fail-closed did NOT become fail-everything: a genuine third person may still approve.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"11130000-0000-0000-0000-0000000001c1","role":"authenticated"}';
select lives_ok(
  $$ select submit_sales_invoice('11130000-0000-0000-0000-0000000001e1') $$,
  'a genuine third-party approver (C, who never wrote the body) still satisfies the two-person rule');

-- ════════════════════════════════════════════════════════════════════════════
-- 0108 §B survives: an invoice with NO recorded author (empty set AND null scalar) refuses submit.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, status, author_user_id)
values ('11130000-0000-0000-0000-0000000001e2','11130000-0000-0000-0000-000000000101',
        '11130000-0000-0000-0000-0000000001f1','SET-SI-002','2026-07-20',500.00,'Draft', null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11130000-0000-0000-0000-0000000001c1","role":"authenticated"}';
select throws_ok(
  $$ select submit_sales_invoice('11130000-0000-0000-0000-0000000001e2') $$,
  '42501', null,
  'an EMPTY author set (and null scalar) still refuses submit — 0108 §B fail-closed survives the oracle swap');
select throws_like(
  $$ select submit_sales_invoice('11130000-0000-0000-0000-0000000001e2') $$,
  '%no recorded author%',
  'the empty-set denial names the MISSING author (distinct from the self-approval denial)');

-- ════════════════════════════════════════════════════════════════════════════
-- Tenancy + append-only: a cross-org caller can neither submit nor read the authorship set, and no
-- authenticated user may erase their own authorship to re-enable self-approval.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"11130000-0000-0000-0000-0000000001d1","role":"authenticated"}';
select throws_ok(
  $$ select submit_sales_invoice('11130000-0000-0000-0000-0000000001e1') $$,
  '42501', null,
  'a cross-org caller is denied by the org guard (the author set is not a tenancy bypass)');

select is(
  (select count(*)::int from sales_invoice_authors where sales_invoice_id = '11130000-0000-0000-0000-0000000001e1'),
  0,
  'a cross-org caller reads NO authorship rows (RLS: org-scoped select only)');

-- A tries to delete their own authorship row (the obvious self-heal of the SoD).
set local request.jwt.claims = '{"sub":"11130000-0000-0000-0000-0000000001a1","role":"authenticated"}';
select throws_ok(
  $$ delete from sales_invoice_authors where sales_invoice_id = '11130000-0000-0000-0000-0000000001e1' $$,
  '42501', null,
  'append-only: an authenticated user cannot delete their authorship row to re-enable self-approval');

reset role;
select * from finish();
rollback;
