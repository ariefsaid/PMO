-- si_submit_clearance_release.test.sql (migration 0114) — the Sales-Invoice submit CLEARANCE: it must
-- be impossible to bypass, and impossible to turn into a permanent freeze.
--
-- ── ROUND-7 CROSS-FAMILY FINDING B1: self-approval was still reachable.
-- 0113 §C made `submit_sales_invoice` record a clearance whose side effect is that
-- `claim_sales_invoice_author` raises 55006, refusing a body rewrite while a submit is in flight. Three
-- defects made that a decoration:
--
--   (B1a) the TTL (5 minutes, hand-picked) was SHORTER than a submit can legitimately stay in flight
--         (`erpnext/client.ts`: ~26 minutes worst case for a submit's idempotent ERP requests). The
--         clearance lapsed mid-submit, so the approver could then claim authorship, rewrite the amount,
--         and have the STILL-RUNNING submit commit their own numbers under their own approval.
--   (B1b) the release was fenced to `user_id = auth.uid()` and granted to `authenticated` — but the
--         attacker IS the grantee, so the approver could simply release their own clearance mid-submit
--         and walk through the gate. A fence naming the constrained party is not a fence.
--   (B1c) ONE row per invoice collapsed concurrent submits: a second submit overwrote the first's
--         clearance and, on resolving, released it — un-freezing an invoice whose FIRST submit was still
--         in flight.
--
-- The design proven here:
--   • `submit_sales_invoice` is the caller-callable SoD CHECK and records NOTHING — no authenticated
--     caller can freeze an invoice's amount at all (this also retires the round-6 finding-2 insider DoS
--     structurally, rather than by rate-limiting it);
--   • `grant_sales_invoice_submit_clearance` / `release_sales_invoice_submit_clearance` are
--     SERVICE-ROLE-ONLY, so only `adapter-dispatch` can create a freeze — and it always releases it;
--   • the release is fenced to the CLEARANCE ID the granting dispatch minted, so neither the constrained
--     approver nor a second concurrent submit can lift a still-outstanding freeze;
--   • the TTL is derived from the client's retry budget and is a BACKSTOP for a dead worker only.
--
-- ── FINDING 3 (round 6, retained): the owner ruling (2026-07-20) is "revenue write = Admin + Finance"
-- (`pmo-portal/src/auth/policy.ts` REVENUE_WRITE), but the SERVER still admitted Executive and Project
-- Manager. The FE-stricter-than-RLS principle permits a narrower front end; it does not permit the
-- backend — the enforcement authority — to be the permissive side.
--
-- Namespaced UUIDs (valid hex), begin/rollback, finish() (not finish_testing()).

begin;
select plan(19);

-- ── Fixtures: one revenue-flipped org.
--    A  = the author (Finance)         P = a Project Manager   E = an Executive
--    F1 = the approver who submits     F2 = a second Finance user who must be able to correct the body
--    AD = an Admin (the ruling's other revenue writer, standing in for a SECOND concurrent submit)
insert into organizations (id, name) values
  ('11140000-0000-0000-0000-000000000101','Clearance Release Org');

insert into auth.users (id, email) values
  ('11140000-0000-0000-0000-0000000001a1','clr-a@example.com'),
  ('11140000-0000-0000-0000-0000000001a2','clr-pm@example.com'),
  ('11140000-0000-0000-0000-0000000001e1','clr-exec@example.com'),
  ('11140000-0000-0000-0000-0000000001f1','clr-f1@example.com'),
  ('11140000-0000-0000-0000-0000000001f2','clr-f2@example.com'),
  ('11140000-0000-0000-0000-0000000001d1','clr-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('11140000-0000-0000-0000-0000000001a1','11140000-0000-0000-0000-000000000101','Author A','clr-a@example.com','Finance','active'),
  ('11140000-0000-0000-0000-0000000001a2','11140000-0000-0000-0000-000000000101','PM P','clr-pm@example.com','Project Manager','active'),
  ('11140000-0000-0000-0000-0000000001e1','11140000-0000-0000-0000-000000000101','Exec E','clr-exec@example.com','Executive','active'),
  ('11140000-0000-0000-0000-0000000001f1','11140000-0000-0000-0000-000000000101','Finance F1','clr-f1@example.com','Finance','active'),
  ('11140000-0000-0000-0000-0000000001f2','11140000-0000-0000-0000-000000000101','Finance F2','clr-f2@example.com','Finance','active'),
  ('11140000-0000-0000-0000-0000000001d1','11140000-0000-0000-0000-000000000101','Admin AD','clr-admin@example.com','Admin','active');

insert into external_domain_ownership (org_id, external_tier, domain) values
  ('11140000-0000-0000-0000-000000000101','erpnext','revenue');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config) values
  ('11140000-0000-0000-0000-000000000101','erpnext','https://erp-clr.example.com','secret-ref-clr','{}'::jsonb);

insert into companies (id, org_id, name, type) values
  ('11140000-0000-0000-0000-0000000001c1','11140000-0000-0000-0000-000000000101','Clearance Customer','Client');

insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, status, author_user_id, erp_docstatus)
values ('11140000-0000-0000-0000-0000000001b1','11140000-0000-0000-0000-000000000101',
        '11140000-0000-0000-0000-0000000001c1','CLR-SI-001','2026-07-20',1000.00,'Draft',
        '11140000-0000-0000-0000-0000000001a1', 0);
insert into sales_invoice_authors (org_id, sales_invoice_id, user_id) values
  ('11140000-0000-0000-0000-000000000101','11140000-0000-0000-0000-0000000001b1','11140000-0000-0000-0000-0000000001a1');

-- ════════════════════════════════════════════════════════════════════════════
-- FINDING 3 — the revenue ruling is enforced by the DB, not just by the FE.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"11140000-0000-0000-0000-0000000001a2","role":"authenticated"}';

select throws_ok(
  $$ select submit_sales_invoice('11140000-0000-0000-0000-0000000001b1') $$,
  '42501', null,
  'finding 3: a Project Manager cannot submit a Sales Invoice (revenue write = Admin + Finance)');

select throws_ok(
  $$ select claim_sales_invoice_author('11140000-0000-0000-0000-0000000001b1') $$,
  '42501', null,
  'finding 3: a Project Manager cannot reach the authorship primitive either');

set local request.jwt.claims = '{"sub":"11140000-0000-0000-0000-0000000001e1","role":"authenticated"}';
select throws_ok(
  $$ select submit_sales_invoice('11140000-0000-0000-0000-0000000001b1') $$,
  '42501', null,
  'finding 3: an Executive cannot submit a Sales Invoice either');

-- ════════════════════════════════════════════════════════════════════════════
-- B1b — the CALLER-CALLABLE RPC is a pure CHECK. No authenticated user can freeze an amount.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"11140000-0000-0000-0000-0000000001f1","role":"authenticated"}';
select lives_ok(
  $$ select submit_sales_invoice('11140000-0000-0000-0000-0000000001b1') $$,
  'F1 (Finance, not an author) passes the SoD check');

select is(
  (select count(*)::int from sales_invoice_submit_authorizations where sales_invoice_id = '11140000-0000-0000-0000-0000000001b1'),
  0,
  'B1b: the caller-callable check records NO clearance — it is no longer a grantable body-freeze primitive');

set local request.jwt.claims = '{"sub":"11140000-0000-0000-0000-0000000001f2","role":"authenticated"}';
select lives_ok(
  $$ select claim_sales_invoice_author('11140000-0000-0000-0000-0000000001b1') $$,
  'B1b: so Finance can still correct the body — no insider can hold the amount frozen by re-calling it');

-- ════════════════════════════════════════════════════════════════════════════
-- B1b — the clearance primitives are UNREACHABLE from an authenticated session. The party the
-- clearance constrains can neither mint one nor lift one.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"11140000-0000-0000-0000-0000000001f1","role":"authenticated"}';

select throws_ok(
  $$ select grant_sales_invoice_submit_clearance(
       '11140000-0000-0000-0000-0000000001b1',
       '11140000-0000-0000-0000-0000000001f1',
       '11140000-0000-0000-0000-0000000000c1') $$,
  '42501', null,
  'B1b: an authenticated caller cannot GRANT a clearance (only adapter-dispatch, under service role)');

select throws_ok(
  $$ select release_sales_invoice_submit_clearance(
       '11140000-0000-0000-0000-0000000001b1',
       '11140000-0000-0000-0000-0000000000c1') $$,
  '42501', null,
  'B1b: an authenticated caller cannot RELEASE a clearance — the grantee IS the constrained approver');

-- ════════════════════════════════════════════════════════════════════════════
-- The dispatch takes F1's clearance. The freeze is real while that submit is in flight.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
select lives_ok(
  $$ select grant_sales_invoice_submit_clearance(
       '11140000-0000-0000-0000-0000000001b1',
       '11140000-0000-0000-0000-0000000001f1',
       '11140000-0000-0000-0000-0000000000c1') $$,
  'the dispatch grants F1''s submit clearance (service role, explicit actor)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11140000-0000-0000-0000-0000000001f2","role":"authenticated"}';
select throws_ok(
  $$ select claim_sales_invoice_author('11140000-0000-0000-0000-0000000001b1') $$,
  '55006', null,
  'the TOCTOU freeze is intact: while F1''s submit is in flight, a body rewrite is refused');

-- A release naming the WRONG clearance is a no-op — the fence is the id, not the caller.
reset role;
select lives_ok(
  $$ select release_sales_invoice_submit_clearance(
       '11140000-0000-0000-0000-0000000001b1',
       '11140000-0000-0000-0000-0000000000cf') $$,
  'releasing an unknown clearance id is a silent no-op, never an error the dispatch must special-case');

select is(
  (select count(*)::int from sales_invoice_submit_authorizations where sales_invoice_id = '11140000-0000-0000-0000-0000000001b1'),
  1,
  'B1b: …and it removes NOTHING — F1''s in-flight clearance survives');

-- ════════════════════════════════════════════════════════════════════════════
-- B1c — a SECOND concurrent submit resolving must not lift the FIRST one's freeze.
-- ════════════════════════════════════════════════════════════════════════════
select lives_ok(
  $$ select grant_sales_invoice_submit_clearance(
       '11140000-0000-0000-0000-0000000001b1',
       '11140000-0000-0000-0000-0000000001d1',
       '11140000-0000-0000-0000-0000000000c2') $$,
  'a second dispatch (Admin AD) takes its OWN clearance on the same invoice');

select is(
  (select count(*)::int from sales_invoice_submit_authorizations where sales_invoice_id = '11140000-0000-0000-0000-0000000001b1'),
  2,
  'B1c: the table holds ONE ROW PER GRANT — the second submit does not overwrite the first''s clearance');

-- The second dispatch resolves and releases ITS clearance…
select lives_ok(
  $$ select release_sales_invoice_submit_clearance(
       '11140000-0000-0000-0000-0000000001b1',
       '11140000-0000-0000-0000-0000000000c2') $$,
  'the second dispatch releases its own clearance when it resolves');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11140000-0000-0000-0000-0000000001f2","role":"authenticated"}';
select throws_ok(
  $$ select claim_sales_invoice_author('11140000-0000-0000-0000-0000000001b1') $$,
  '55006', null,
  'B1c: the invoice is STILL frozen — F1''s submit is in flight and its clearance is untouched');

-- ════════════════════════════════════════════════════════════════════════════
-- …and no PERMANENT freeze: when the last in-flight submit resolves, the body is correctable at once.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
select lives_ok(
  $$ select release_sales_invoice_submit_clearance(
       '11140000-0000-0000-0000-0000000001b1',
       '11140000-0000-0000-0000-0000000000c1') $$,
  'F1''s dispatch resolves (success or ERP failure) and releases its clearance');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11140000-0000-0000-0000-0000000001f2","role":"authenticated"}';
select lives_ok(
  $$ select claim_sales_invoice_author('11140000-0000-0000-0000-0000000001b1') $$,
  'with every clearance released, Finance can correct the amount at once (no indefinite freeze)');

-- ════════════════════════════════════════════════════════════════════════════
-- B1a — the TTL outlives the longest submit that can still be in flight.
--
-- `erpnext/client.ts` ERP_SUBMIT_MAX_IN_FLIGHT_MS = 3 idempotent ERP requests × ((3+1) × 120 s +
-- 3 × 15 s) = 1 575 s = 26.25 minutes. A shorter TTL lets the clearance lapse WHILE the submit is still
-- running, which is exactly the self-approval window B1a describes.
-- (`submitClearanceTtl.test.ts` guards the same relationship against the client's own constants.)
-- ════════════════════════════════════════════════════════════════════════════
reset role;
select ok(
  public.si_submit_clearance_ttl() >= interval '1575 seconds',
  'B1a: the clearance TTL covers the worst-case in-flight submit (no lapse-mid-submit rewrite window)');

reset role;
select * from finish();
rollback;
