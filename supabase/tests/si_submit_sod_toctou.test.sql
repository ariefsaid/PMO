-- si_submit_sod_toctou.test.sql (0113 §C/§D) — SoD DEFECT 2: the SoD was TOCTOU-raceable.
--
-- `adapter-dispatch/index.ts` authorized the submit BEFORE the ERP body was constructed, and authorship
-- was recorded only AFTER, by the read-model writer (post-ERP). So the designated approver could issue
-- an `update` that rewrote the amount AND, concurrently, a `submit`: the submit's authorship check read
-- the state as it stood BEFORE the rewrite, passed, and the rewrite then landed the approver's own
-- numbers. Net — the approver's amount, carrying the approver's own approval.
--
-- The fix puts BOTH halves behind the SAME row lock in the DB (the serialization point and the
-- enforcement authority — a stateless edge function holds no transaction across the ERP HTTP call):
--
--   submit_sales_invoice(si)        : select … for update on the invoice → check the author SET →
--                                     RECORD the authorization (sales_invoice_submit_authorizations)
--   claim_sales_invoice_author(si)  : select … for update on the invoice → REFUSE (55006) while an
--                                     authorization is outstanding → else APPEND the caller to the set
--
-- and `index.ts` calls the claim BEFORE the ERP body write. The two possible serialization orders are
-- therefore both safe:
--   claim wins the lock  → the rewriter is in the author set → the submit is refused as self-approval;
--   submit wins the lock → the claim blocks on the lock, then sees the authorization → the rewrite is
--                          refused with 55006 and NEVER reaches ERP.
--
-- ⚑ COVERAGE HONESTY: pgTAP is single-session, so a true concurrent interleave cannot be expressed
-- here. What this file proves is (a) the mechanism itself — the authorization record, the 55006
-- refusal, the append, the lapse and the post-submit release — i.e. BOTH serialization outcomes
-- deterministically, and (b) STRUCTURALLY that each RPC takes `for update` on the invoice row, which
-- is what makes those two the ONLY possible outcomes. The lock's blocking behaviour under real
-- concurrency is not exercised by a single session.
--
-- Namespaced UUIDs (valid hex), begin/rollback, finish() (not finish_testing()).

begin;
select plan(10);

-- ── Fixtures: A = author (PM), B = the approver who tries to race, D = an untainted third party. ──
insert into organizations (id, name) values
  ('11131000-0000-0000-0000-000000000101','SoD TOCTOU Org');

insert into auth.users (id, email) values
  ('11131000-0000-0000-0000-0000000001a1','toctou-a@example.com'),
  ('11131000-0000-0000-0000-0000000001b1','toctou-b@example.com'),
  ('11131000-0000-0000-0000-0000000001d1','toctou-d@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('11131000-0000-0000-0000-0000000001a1','11131000-0000-0000-0000-000000000101','Author A','toctou-a@example.com','Project Manager','active'),
  ('11131000-0000-0000-0000-0000000001b1','11131000-0000-0000-0000-000000000101','Approver B','toctou-b@example.com','Finance','active'),
  ('11131000-0000-0000-0000-0000000001d1','11131000-0000-0000-0000-000000000101','Third Party D','toctou-d@example.com','Finance','active');

insert into external_domain_ownership (org_id, external_tier, domain) values
  ('11131000-0000-0000-0000-000000000101','erpnext','revenue');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config) values
  ('11131000-0000-0000-0000-000000000101','erpnext','https://erp-toctou.example.com','secret-ref-toctou','{}'::jsonb);

insert into companies (id, org_id, name, type) values
  ('11131000-0000-0000-0000-0000000001f1','11131000-0000-0000-0000-000000000101','TOCTOU Customer','Client');

insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, status, author_user_id, erp_docstatus)
values ('11131000-0000-0000-0000-0000000001e1','11131000-0000-0000-0000-000000000101',
        '11131000-0000-0000-0000-0000000001f1','TOCTOU-SI-001','2026-07-20',1000.00,'Draft',
        '11131000-0000-0000-0000-0000000001a1', 0);
insert into sales_invoice_authors (org_id, sales_invoice_id, user_id) values
  ('11131000-0000-0000-0000-000000000101','11131000-0000-0000-0000-0000000001e1','11131000-0000-0000-0000-0000000001a1');

-- ════════════════════════════════════════════════════════════════════════════
-- Order 1 — the SUBMIT wins the lock. It must leave a record that makes the racing body rewrite
-- impossible, rather than a check whose result is stale the moment it returns.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"11131000-0000-0000-0000-0000000001b1","role":"authenticated"}';

select lives_ok(
  $$ select submit_sales_invoice('11131000-0000-0000-0000-0000000001e1') $$,
  'B (not an author) legitimately authorizes the submit');

select is(
  (select user_id from sales_invoice_submit_authorizations where sales_invoice_id = '11131000-0000-0000-0000-0000000001e1'),
  '11131000-0000-0000-0000-0000000001b1'::uuid,
  'the authorization is RECORDED under the invoice row lock (not merely returned to the caller)');

-- B now races a body rewrite (the exploit: B rewrites the amount while B''s own submit is in flight).
select throws_ok(
  $$ select claim_sales_invoice_author('11131000-0000-0000-0000-0000000001e1') $$,
  '55006', null,
  'DEFECT 2: while an authorization is outstanding, a body rewrite is REFUSED (55006) — before any ERP call');

select is(
  (select count(*)::int from sales_invoice_authors where sales_invoice_id = '11131000-0000-0000-0000-0000000001e1'),
  1,
  'DEFECT 2: the refused rewrite recorded nothing — the author set is unchanged (A only)');

-- ── The mechanism that makes those the ONLY two outcomes: both RPCs serialize on the invoice row. ──
select alike(
  pg_get_functiondef('public.submit_sales_invoice(uuid)'::regprocedure),
  '%for update%',
  'submit_sales_invoice takes `select … for update` on the invoice — the authorship check and the '
  'authorization record are atomic w.r.t. a concurrent body write');

select alike(
  pg_get_functiondef('public.claim_sales_invoice_author(uuid)'::regprocedure),
  '%for update%',
  'claim_sales_invoice_author takes the SAME row lock — a rewrite cannot interleave between the '
  'submit''s check and its authorization record');

-- ════════════════════════════════════════════════════════════════════════════
-- The authorization LAPSES (a submit that never completed must not freeze the invoice forever).
-- ════════════════════════════════════════════════════════════════════════════
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
update sales_invoice_submit_authorizations
   set authorized_at = now() - interval '1 hour'
 where sales_invoice_id = '11131000-0000-0000-0000-0000000001e1';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11131000-0000-0000-0000-0000000001d1","role":"authenticated"}';

select lives_ok(
  $$ select claim_sales_invoice_author('11131000-0000-0000-0000-0000000001e1') $$,
  'a LAPSED authorization stops blocking rewrites (a failed submit must not freeze the invoice)');

-- ════════════════════════════════════════════════════════════════════════════
-- Order 2 — the CLAIM wins the lock: the rewriter joins the author set, so their submit is refused.
-- ════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ select submit_sales_invoice('11131000-0000-0000-0000-0000000001e1') $$,
  '42501', null,
  'DEFECT 2 (other order): having claimed the body, D can no longer approve it — self-approval');

-- ════════════════════════════════════════════════════════════════════════════
-- Once the invoice IS submitted (docstatus 1) the authorization no longer blocks: the amend path
-- must stay open.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
update sales_invoice_submit_authorizations
   set authorized_at = now()
 where sales_invoice_id = '11131000-0000-0000-0000-0000000001e1';
update sales_invoices set erp_docstatus = 1 where id = '11131000-0000-0000-0000-0000000001e1';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11131000-0000-0000-0000-0000000001d1","role":"authenticated"}';
select lives_ok(
  $$ select claim_sales_invoice_author('11131000-0000-0000-0000-0000000001e1') $$,
  'a SUBMITTED invoice (docstatus 1) is no longer submit-pending — the amend path is not blocked');

-- The authorization ledger is machine-only: a user cannot clear it to unblock their own rewrite.
select throws_ok(
  $$ delete from sales_invoice_submit_authorizations where sales_invoice_id = '11131000-0000-0000-0000-0000000001e1' $$,
  '42501', null,
  'the authorization ledger cannot be cleared by an authenticated user (machine-written, read-only)');

reset role;
select * from finish();
rollback;
