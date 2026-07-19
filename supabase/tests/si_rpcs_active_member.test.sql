-- si_rpcs_active_member.test.sql — Luna re-audit: the offboarding gate must cover the SECURITY
-- DEFINER RPCs, not just the tables.
--
-- 0109/0110 conjoined `is_active_member()` into the AR/AP table policies, so a disabled user with a
-- still-valid JWT reads nothing from `sales_invoices` directly. But `submit_sales_invoice` (0108 §B)
-- is SECURITY DEFINER, granted to `authenticated`, RETURNS THE WHOLE `public.sales_invoices` ROW, and
-- guards only on `auth_org_id()` + `auth_role()` — neither of which looks at `profiles.status` or
-- `auth.users.banned_until` (`is_active_member()` is the one that does). The same omission sits on
-- `get_process_gates` (0108 §A). A disabled user could therefore call the RPC and read back amount,
-- erp_outstanding_amount, customer, project and si_number — exactly the data 0109 denies them — and,
-- on `submit_sales_invoice`, obtain the SoD clearance that gates a real ERP submit.
--
-- Proof shape mirrors sales_ar_offboarded_rls.test.sql: the SAME row is then exercised by an ACTIVE
-- member of the same org, so a pass means "the conjunct denies offboarded users specifically", not
-- "the RPC is broken for everyone". The service_role bypass on `get_process_gates` is asserted
-- explicitly — it is load-bearing (adapter-dispatch calls it with a service client whose
-- auth_org_id() is NULL; breaking it breaks every SI create).

begin;
select plan(6);

-- ── Fixtures: one revenue-flipped org; A = active Finance, D = DISABLED Finance, X = the author. ──
insert into organizations (id, name) values
  ('11120000-0000-0000-0000-000000000101','RPC Active-Member Org');

insert into auth.users (id, email) values
  ('11120000-0000-0000-0000-0000000001a1','rpc-active@example.com'),
  ('11120000-0000-0000-0000-0000000001d1','rpc-disabled@example.com'),
  ('11120000-0000-0000-0000-0000000001c1','rpc-author@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('11120000-0000-0000-0000-0000000001a1','11120000-0000-0000-0000-000000000101','A Active','rpc-active@example.com','Finance','active'),
  ('11120000-0000-0000-0000-0000000001d1','11120000-0000-0000-0000-000000000101','D Disabled','rpc-disabled@example.com','Finance','disabled'),
  ('11120000-0000-0000-0000-0000000001c1','11120000-0000-0000-0000-000000000101','X Author','rpc-author@example.com','Project Manager','active');

insert into external_domain_ownership (org_id, external_tier, domain) values
  ('11120000-0000-0000-0000-000000000101','erpnext','revenue');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config) values
  ('11120000-0000-0000-0000-000000000101','erpnext','https://erp.example.com','secret-ref','{"process_gates":{"require_project_on_si":false}}'::jsonb);

insert into companies (id, org_id, name, type) values
  ('11120000-0000-0000-0000-0000000001f1','11120000-0000-0000-0000-000000000101','RPC Customer','Client');

-- A draft authored by X — so neither A nor D is blocked by the SoD self-approval rule; the ONLY thing
-- that can deny D is the active-member gate under test.
insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, status, author_user_id)
values (
  '11120000-0000-0000-0000-0000000001e1',
  '11120000-0000-0000-0000-000000000101',
  '11120000-0000-0000-0000-0000000001f1',
  'DRAFT-SI-ACTIVE-001',
  '2026-07-19',
  777000.00,
  'Draft',
  '11120000-0000-0000-0000-0000000001c1'
);

-- ════════════════════════════════════════════════════════════════════════════
-- DENY: the DISABLED member gets nothing from either RPC.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"11120000-0000-0000-0000-0000000001d1","role":"authenticated"}';

select throws_ok(
  $$ select submit_sales_invoice('11120000-0000-0000-0000-0000000001e1') $$,
  '42501', null,
  'disabled member calling submit_sales_invoice is denied (42501) — the RPC returns the whole SI row');

select throws_ok(
  $$ select get_process_gates('11120000-0000-0000-0000-000000000101') $$,
  '42501', null,
  'disabled member calling get_process_gates is denied (42501)');

-- ════════════════════════════════════════════════════════════════════════════
-- ALLOW: an ACTIVE member of the SAME org still passes both RPCs on the SAME row.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"11120000-0000-0000-0000-0000000001a1","role":"authenticated"}';

select lives_ok(
  $$ select submit_sales_invoice('11120000-0000-0000-0000-0000000001e1') $$,
  'active member still submits — the conjunct denies offboarded users, it does not break the RPC');

select is(
  (select (submit_sales_invoice('11120000-0000-0000-0000-0000000001e1')).amount),
  777000.00,
  'active member still reads the invoice row the RPC returns');

select is(
  (select get_process_gates('11120000-0000-0000-0000-000000000101') -> 'require_project_on_si'),
  'false'::jsonb,
  'active member still reads the merged process gates');

-- ════════════════════════════════════════════════════════════════════════════
-- PRESERVED: the get_process_gates service_role bypass. The dispatch calls it with a service client
-- whose auth_org_id() AND auth.uid() are both NULL — it must still answer, or every SI create fails.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select get_process_gates('11120000-0000-0000-0000-000000000101') -> 'require_project_on_si'),
  'false'::jsonb,
  'service_role bypass preserved: the machine caller (no uid, no org) still reads the gates');

reset role;
select * from finish();
rollback;
