-- 0173_rpc_active_member_gate.test.sql — a DISABLED account must not be able to write.
-- Spec: docs/specs/active-member-write-gate.spec.md (FR-AMG-001..005, NFR-AMG-001).
-- Migration under test: supabase/migrations/0180_rpc_active_member_gate.sql.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────
-- `is_active_member()` (0062/0095) is conjoined into every business-table RLS policy, so a deactivated
-- employee holding a still-valid JWT READS nothing. The `security definer` RPCs bypass RLS by design
-- and re-assert org and role — but not active membership. Probed live at 0178 with a disabled profile:
--
--     select count(*) from procurements;                        -->  0      (RLS read blocked)
--     select create_procurement_invoice(<pr>,'Paid',…,424242);  -->  VI-…   Paid  424242.00
--
-- 0178 closed two of the seventeen (`transition_project`, `set_project_contract_value`). This file is
-- the proof for the remaining FIFTEEN, re-derived from the live catalog rather than from a list:
--   security definer + EXECUTE to `authenticated` + a write + no `is_active_member` in the body.
--
-- ⚑ ONE ASSERTION PER FUNCTION, NOT A SAMPLE. The defect IS inconsistent application — three
--   functions carried the check and the rest did not — so a sampled proof reproduces exactly the gap
--   it is meant to close.
--
-- ── THE TRAP THIS FILE EXISTS TO CATCH (§2 of the spec) ─────────────────────────────────────────
-- `is_active_member()` takes no arguments and resolves `auth.uid()`, which is NULL for a service_role
-- caller ⇒ it returns FALSE. A plain conjunct on an RPC that an edge function invokes as service_role
-- breaks that path IN PRODUCTION, and breaks it CLOSED — silently, not at deploy time. Two of the
-- fifteen have exactly that caller (`external-connect` -> create_vault_secret_for_org and
-- `external-disconnect` -> admin_change_domain_ownership, both `serviceClient.rpc(..., p_actor_id)`),
-- and both already resolve `coalesce(auth.uid(), p_actor_id)` for their privilege check. Sections 4
-- and 5 are the controls that catch a regression here: the service-role path must still WORK for an
-- active actor (AC-AMG-003) and must still REFUSE a disabled or banned one (AC-AMG-004/005).
--
-- ── ORACLE DISCIPLINE ───────────────────────────────────────────────────────────────────────────
-- Every denial asserts the errcode AND THE EXACT MESSAGE. A bare throws_ok(sql,'42501',null) goes
-- green for the WRONG reason the moment another 42501 gate moves in front of the one under test, and
-- these RPCs are full of 42501 gates ('not authorized' appears in all fifteen). The active-member
-- refusal therefore has its OWN message (FR-AMG-004: it must be distinguishable from a role denial),
-- and a message-only mutation — same errcode, generic text — kills every assertion in section 1.
--
-- Deny fixtures and allow fixtures are SEPARATE ROWS wherever the call mutates state, so a red run
-- (in which the exploit succeeds) cannot silently poison the no-over-blocking control that follows it.

begin;
select plan(61);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Fixtures (as postgres — BYPASSRLS, exempt from the origination guards by design).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
insert into organizations (id, name) values
  ('01730000-0000-0000-0000-000000000001','AMG Org A'),
  ('01730000-0000-0000-0000-000000000002','AMG Org B');

insert into auth.users (id, email) values
  ('01730000-0000-0000-0000-0000000000a1','amg-admin@example.com'),
  ('01730000-0000-0000-0000-0000000000a2','amg-admin2@example.com'),
  ('01730000-0000-0000-0000-0000000000a9','amg-admin-disabled@example.com'),
  ('01730000-0000-0000-0000-0000000000c1','amg-pm@example.com'),
  ('01730000-0000-0000-0000-0000000000c9','amg-pm-disabled@example.com'),
  ('01730000-0000-0000-0000-0000000000e1','amg-author@example.com');

-- ⚑ AC-AMG-005: a RAW BAN. The profile stays 'active' — only auth.users.banned_until is set, which is
--   the out-of-band path (Supabase dashboard / direct SQL) that `admin_set_user_status` does not own.
--   0095 pushed that check down into is_active_member(); these two pin that it reaches the RPCs too.
insert into auth.users (id, email, banned_until) values
  ('01730000-0000-0000-0000-0000000000a8','amg-admin-banned@example.com', now() + interval '30 days'),
  ('01730000-0000-0000-0000-0000000000c8','amg-pm-banned@example.com',    now() + interval '30 days');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('01730000-0000-0000-0000-0000000000a1','01730000-0000-0000-0000-000000000001','AMG Admin','amg-admin@example.com','Admin','active'),
  ('01730000-0000-0000-0000-0000000000a2','01730000-0000-0000-0000-000000000001','AMG Admin Two','amg-admin2@example.com','Admin','active'),
  ('01730000-0000-0000-0000-0000000000a8','01730000-0000-0000-0000-000000000001','AMG Admin Banned','amg-admin-banned@example.com','Admin','active'),
  ('01730000-0000-0000-0000-0000000000a9','01730000-0000-0000-0000-000000000001','AMG Admin Gone','amg-admin-disabled@example.com','Admin','disabled'),
  ('01730000-0000-0000-0000-0000000000c1','01730000-0000-0000-0000-000000000001','AMG PM','amg-pm@example.com','Project Manager','active'),
  ('01730000-0000-0000-0000-0000000000c8','01730000-0000-0000-0000-000000000001','AMG PM Banned','amg-pm-banned@example.com','Project Manager','active'),
  ('01730000-0000-0000-0000-0000000000c9','01730000-0000-0000-0000-000000000001','AMG PM Gone','amg-pm-disabled@example.com','Project Manager','disabled'),
  ('01730000-0000-0000-0000-0000000000e1','01730000-0000-0000-0000-000000000001','AMG Author','amg-author@example.com','Project Manager','active');

insert into companies (id, org_id, name, type) values
  ('01730000-0000-0000-0000-0000000000b1','01730000-0000-0000-0000-000000000001','AMG Vendor','Vendor');

insert into projects (id, org_id, name, status) values
  ('01730000-0000-0000-0000-000000000101','01730000-0000-0000-0000-000000000001','AMG Project','Internal Project');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('01730000-0000-0000-0000-000000000201','01730000-0000-0000-0000-000000000001','01730000-0000-0000-0000-000000000101',1,'AMG BV Deny','Draft'),
  ('01730000-0000-0000-0000-000000000202','01730000-0000-0000-0000-000000000001','01730000-0000-0000-0000-000000000101',2,'AMG BV Allow','Draft');

insert into procurements (id, org_id, title, status, requested_by_id, vendor_id) values
  ('01730000-0000-0000-0000-000000000301','01730000-0000-0000-0000-000000000001','AMG records deny','Draft','01730000-0000-0000-0000-0000000000e1','01730000-0000-0000-0000-0000000000b1'),
  ('01730000-0000-0000-0000-000000000302','01730000-0000-0000-0000-000000000001','AMG records allow','Draft','01730000-0000-0000-0000-0000000000e1','01730000-0000-0000-0000-0000000000b1'),
  ('01730000-0000-0000-0000-000000000303','01730000-0000-0000-0000-000000000001','AMG quote deny','Vendor Quoted','01730000-0000-0000-0000-0000000000e1','01730000-0000-0000-0000-0000000000b1'),
  ('01730000-0000-0000-0000-000000000304','01730000-0000-0000-0000-000000000001','AMG quote allow','Vendor Quoted','01730000-0000-0000-0000-0000000000e1','01730000-0000-0000-0000-0000000000b1'),
  ('01730000-0000-0000-0000-000000000305','01730000-0000-0000-0000-000000000001','AMG transition deny','Draft','01730000-0000-0000-0000-0000000000e1','01730000-0000-0000-0000-0000000000b1'),
  ('01730000-0000-0000-0000-000000000306','01730000-0000-0000-0000-000000000001','AMG transition allow','Draft','01730000-0000-0000-0000-0000000000e1','01730000-0000-0000-0000-0000000000b1');

insert into procurement_quotations (id, org_id, procurement_id, vendor_id, reference, total_amount) values
  ('01730000-0000-0000-0000-000000000401','01730000-0000-0000-0000-000000000001','01730000-0000-0000-0000-000000000303','01730000-0000-0000-0000-0000000000b1','AMG-Q-DENY',1000),
  ('01730000-0000-0000-0000-000000000402','01730000-0000-0000-0000-000000000001','01730000-0000-0000-0000-000000000304','01730000-0000-0000-0000-0000000000b1','AMG-Q-ALLOW',2000);

-- Authored by AMG Author, so transition_document_status' approver!=author SoD is never the reason.
insert into project_documents (id, org_id, project_id, code, category, title, revision, doc_date, author_id, status) values
  ('01730000-0000-0000-0000-000000000501','01730000-0000-0000-0000-000000000001','01730000-0000-0000-0000-000000000101','DOC-AMG-1','Drawing','AMG doc deny','A','2026-02-01','01730000-0000-0000-0000-0000000000e1','Draft'),
  ('01730000-0000-0000-0000-000000000502','01730000-0000-0000-0000-000000000001','01730000-0000-0000-0000-000000000101','DOC-AMG-2','Drawing','AMG doc allow','A','2026-02-01','01730000-0000-0000-0000-0000000000e1','Draft');

-- Each caller submits their OWN sheet (transition_timesheet's submit arm is owner-only), so the two
-- rows differ by owner, not by week.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('01730000-0000-0000-0000-000000000601','01730000-0000-0000-0000-000000000001','01730000-0000-0000-0000-0000000000c9','2026-03-02','Draft'),
  ('01730000-0000-0000-0000-000000000602','01730000-0000-0000-0000-000000000001','01730000-0000-0000-0000-0000000000c1','2026-03-02','Draft');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — AC-AMG-001. A DISABLED member with a valid JWT is refused by EVERY ONE of the fifteen.
-- The caller is a disabled PROJECT MANAGER for the thirteen whose role gate a PM satisfies, and a
-- disabled ADMIN for the two admin RPCs — so in every case the ONLY thing that can refuse them is the
-- active-member gate. The message is asserted verbatim; it is deliberately not 'not authorized'.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01730000-0000-0000-0000-0000000000c9","role":"authenticated"}';

select throws_ok(
  $$ select clone_budget_version('01730000-0000-0000-0000-000000000201') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 clone_budget_version refuses a disabled member');

select throws_ok(
  $$ select create_payment('01730000-0000-0000-0000-000000000301', null, 'AMG-PAY-DENY', 'Scheduled', '2026-03-02', 424242) $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 create_payment refuses a disabled member');

select throws_ok(
  $$ select create_procurement_invoice('01730000-0000-0000-0000-000000000301','Received','2026-03-02','AMG-VI-DENY',424242) $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 create_procurement_invoice refuses a disabled member');

select throws_ok(
  $$ select create_procurement_quotation('01730000-0000-0000-0000-000000000301','01730000-0000-0000-0000-0000000000b1',424242,'2026-03-02') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 create_procurement_quotation refuses a disabled member');

select throws_ok(
  $$ select create_procurement_receipt('01730000-0000-0000-0000-000000000301','Complete','2026-03-02','AMG-GR-DENY') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 create_procurement_receipt refuses a disabled member');

select throws_ok(
  $$ select create_purchase_order('01730000-0000-0000-0000-000000000301','AMG-PO-DENY','Draft','2026-03-02',424242) $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 create_purchase_order refuses a disabled member');

select throws_ok(
  $$ select create_purchase_request('01730000-0000-0000-0000-000000000301','AMG-PR-DENY','Draft','2026-03-02',424242) $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 create_purchase_request refuses a disabled member');

select throws_ok(
  $$ select create_rfq('01730000-0000-0000-0000-000000000301','AMG-RFQ-DENY','Draft','2026-03-02',424242) $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 create_rfq refuses a disabled member');

select throws_ok(
  $$ select save_timesheet_week(null,'2026-03-09','[]'::jsonb,'{}'::uuid[]) $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 save_timesheet_week refuses a disabled member');

select throws_ok(
  $$ select select_procurement_quote('01730000-0000-0000-0000-000000000401') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 select_procurement_quote refuses a disabled member');

select throws_ok(
  $$ select transition_document_status('01730000-0000-0000-0000-000000000501','Issued') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 transition_document_status refuses a disabled member');

select throws_ok(
  $$ select transition_procurement('01730000-0000-0000-0000-000000000305','Requested','deny') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 transition_procurement refuses a disabled member');

select throws_ok(
  $$ select transition_timesheet('01730000-0000-0000-0000-000000000601','Submitted') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 transition_timesheet refuses a disabled member (their OWN draft sheet)');

-- The two admin RPCs, JWT path — a disabled ADMIN, who satisfies their Admin-of-org gate.
set local request.jwt.claims = '{"sub":"01730000-0000-0000-0000-0000000000a9","role":"authenticated"}';

select throws_ok(
  $$ select admin_change_domain_ownership('01730000-0000-0000-0000-000000000001','clickup','tasks','employ') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 admin_change_domain_ownership refuses a disabled Admin (JWT path)');

select throws_ok(
  $$ select create_vault_secret_for_org('01730000-0000-0000-0000-000000000001','clickup','amg-deny-token','amg_secret_deny') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-001 create_vault_secret_for_org refuses a disabled Admin (JWT path)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — AC-AMG-001, second half: "and NO ROW is written". The refusal must be a refusal, not a
-- rollback of a partly-applied write, and not a raise after the sequence has already been consumed.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
reset role;

select is((select count(*)::int from payments              where procurement_id = '01730000-0000-0000-0000-000000000301'), 0,
  'AC-AMG-001 no payment row was written for the disabled member');
select is((select count(*)::int from procurement_invoices  where procurement_id = '01730000-0000-0000-0000-000000000301'), 0,
  'AC-AMG-001 no vendor-invoice row was written for the disabled member');
select is((select count(*)::int from procurement_receipts  where procurement_id = '01730000-0000-0000-0000-000000000301'), 0,
  'AC-AMG-001 no goods-receipt row was written for the disabled member');
select is((select count(*)::int from purchase_orders       where procurement_id = '01730000-0000-0000-0000-000000000301'), 0,
  'AC-AMG-001 no purchase-order row was written for the disabled member');
select is((select count(*)::int from purchase_requests     where procurement_id = '01730000-0000-0000-0000-000000000301'), 0,
  'AC-AMG-001 no purchase-request row was written for the disabled member');
select is((select count(*)::int from rfqs                  where procurement_id = '01730000-0000-0000-0000-000000000301'), 0,
  'AC-AMG-001 no RFQ row was written for the disabled member');
select is((select count(*)::int from procurement_quotations where procurement_id = '01730000-0000-0000-0000-000000000301'), 0,
  'AC-AMG-001 no quotation row was written for the disabled member');
select is((select count(*)::int from budget_versions where project_id = '01730000-0000-0000-0000-000000000101'), 2,
  'AC-AMG-001 clone_budget_version created nothing (still the two seeded versions)');
select is((select status::text from project_documents where id = '01730000-0000-0000-0000-000000000501'), 'Draft',
  'AC-AMG-001 the document was not transitioned by the disabled member');
select is((select status::text from procurements where id = '01730000-0000-0000-0000-000000000305'), 'Draft',
  'AC-AMG-001 the procurement was not transitioned by the disabled member');
select is((select status::text from timesheets where id = '01730000-0000-0000-0000-000000000601'), 'Draft',
  'AC-AMG-001 the timesheet was not submitted by the disabled member');
select is((select count(*)::int from timesheets where user_id = '01730000-0000-0000-0000-0000000000c9'), 1,
  'AC-AMG-001 save_timesheet_week created no second sheet for the disabled member');
select is((select count(*)::int from external_domain_ownership where org_id = '01730000-0000-0000-0000-000000000001'), 0,
  'AC-AMG-001 no domain ownership was employed by the disabled Admin');
select is((select count(*)::int from external_org_bindings where org_id = '01730000-0000-0000-0000-000000000001'), 0,
  'AC-AMG-001 no external binding was created by the disabled Admin');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — AC-AMG-002 / NFR-AMG-001. THE NO-OVER-BLOCKING CONTROL, one per function: the SAME
-- call by an ACTIVE member of the same org with the same role still succeeds. Without this section a
-- migration that simply broke all fifteen would pass section 1.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01730000-0000-0000-0000-0000000000c1","role":"authenticated"}';

select lives_ok($$ select clone_budget_version('01730000-0000-0000-0000-000000000202') $$,
  'AC-AMG-002 clone_budget_version still works for an active member');
select lives_ok($$ select create_payment('01730000-0000-0000-0000-000000000302', null, 'AMG-PAY-OK','Scheduled','2026-03-02',100) $$,
  'AC-AMG-002 create_payment still works for an active member');
select lives_ok($$ select create_procurement_invoice('01730000-0000-0000-0000-000000000302','Received','2026-03-02','AMG-VI-OK',100) $$,
  'AC-AMG-002 create_procurement_invoice still works for an active member');
select lives_ok($$ select create_procurement_quotation('01730000-0000-0000-0000-000000000302','01730000-0000-0000-0000-0000000000b1',100,'2026-03-02') $$,
  'AC-AMG-002 create_procurement_quotation still works for an active member');
select lives_ok($$ select create_procurement_receipt('01730000-0000-0000-0000-000000000302','Complete','2026-03-02','AMG-GR-OK') $$,
  'AC-AMG-002 create_procurement_receipt still works for an active member');
select lives_ok($$ select create_purchase_order('01730000-0000-0000-0000-000000000302','AMG-PO-OK','Draft','2026-03-02',100) $$,
  'AC-AMG-002 create_purchase_order still works for an active member');
select lives_ok($$ select create_purchase_request('01730000-0000-0000-0000-000000000302','AMG-PR-OK','Draft','2026-03-02',100) $$,
  'AC-AMG-002 create_purchase_request still works for an active member');
select lives_ok($$ select create_rfq('01730000-0000-0000-0000-000000000302','AMG-RFQ-OK','Draft','2026-03-02',100) $$,
  'AC-AMG-002 create_rfq still works for an active member');
select lives_ok($$ select save_timesheet_week(null,'2026-03-09','[]'::jsonb,'{}'::uuid[]) $$,
  'AC-AMG-002 save_timesheet_week still works for an active member');
select lives_ok($$ select select_procurement_quote('01730000-0000-0000-0000-000000000402') $$,
  'AC-AMG-002 select_procurement_quote still works for an active member');
select lives_ok($$ select transition_document_status('01730000-0000-0000-0000-000000000502','Issued') $$,
  'AC-AMG-002 transition_document_status still works for an active member');
select lives_ok($$ select transition_procurement('01730000-0000-0000-0000-000000000306','Requested','allow') $$,
  'AC-AMG-002 transition_procurement still works for an active member');
select lives_ok($$ select transition_timesheet('01730000-0000-0000-0000-000000000602','Submitted') $$,
  'AC-AMG-002 transition_timesheet still works for an active member');

set local request.jwt.claims = '{"sub":"01730000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select admin_change_domain_ownership('01730000-0000-0000-0000-000000000001','erpnext','reference','employ') $$,
  'AC-AMG-002 admin_change_domain_ownership still works for an active Admin (JWT path)');
select lives_ok($$ select create_vault_secret_for_org('01730000-0000-0000-0000-000000000001','clickup','amg-ok-token','amg_secret_ok') $$,
  'AC-AMG-002 create_vault_secret_for_org still works for an active Admin (JWT path)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — THE §2 TRAP. The service_role path (auth.uid() IS NULL, actor supplied as p_actor_id).
-- A plain `is_active_member()` conjunct on either of these two would return FALSE for every real
-- production call from external-connect / external-disconnect and break the integration CLOSED.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
reset role;
set local request.jwt.claims = '{}';

-- AC-AMG-003: the resolved actor is an ACTIVE Admin -> the machine caller still works.
select lives_ok(
  $$ select admin_change_domain_ownership('01730000-0000-0000-0000-000000000001','erpnext','tasks','employ','01730000-0000-0000-0000-0000000000a2') $$,
  'AC-AMG-003 service_role + p_actor_id of an ACTIVE Admin still employs domain ownership');
select lives_ok(
  $$ select create_vault_secret_for_org('01730000-0000-0000-0000-000000000001','erpnext','amg-svc-token','amg_secret_svc','01730000-0000-0000-0000-0000000000a2') $$,
  'AC-AMG-003 service_role + p_actor_id of an ACTIVE Admin still creates the vault secret + binding');

-- AC-AMG-004: the resolved-actor form must not become the bypass. A DISABLED p_actor_id is refused.
select throws_ok(
  $$ select admin_change_domain_ownership('01730000-0000-0000-0000-000000000001','clickup','tasks','employ','01730000-0000-0000-0000-0000000000a9') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-004 service_role + p_actor_id of a DISABLED Admin is refused');
select throws_ok(
  $$ select create_vault_secret_for_org('01730000-0000-0000-0000-000000000001','clickup','amg-svc-deny','amg_secret_svc_deny','01730000-0000-0000-0000-0000000000a9') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-004 service_role + p_actor_id of a DISABLED Admin cannot create a vault secret');

-- ⚑ AC-AMG-004, THE ORDERING. `coalesce(auth.uid(), p_actor)` — auth.uid() FIRST — is what stops a
--   JWT caller laundering their own identity through the parameter. With the operands swapped, a
--   DISABLED Admin would pass the active-member check as an ACTIVE colleague while the PRIVILEGE
--   check still resolved to themselves (they are an Admin of the org), and the write would land.
--   This repo has shipped that exact inversion once already (approved_timesheet_for_push), so it gets
--   its own assertion rather than being left to the comment.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01730000-0000-0000-0000-0000000000a9","role":"authenticated"}';
select throws_ok(
  $$ select admin_change_domain_ownership('01730000-0000-0000-0000-000000000001','clickup','tasks','employ','01730000-0000-0000-0000-0000000000a2') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-004 a DISABLED Admin cannot launder the write through p_actor_id (auth.uid() resolves FIRST)');
select throws_ok(
  $$ select create_vault_secret_for_org('01730000-0000-0000-0000-000000000001','clickup','amg-spoof','amg_secret_spoof','01730000-0000-0000-0000-0000000000a2') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-004 a DISABLED Admin cannot mint a vault secret through an active colleague''s p_actor_id');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — AC-AMG-005. A RAW BAN (auth.users.banned_until in the future, profile still 'active').
-- ⚑ This is what makes the resolved-actor form an is_active_member() OVERLOAD rather than a
--   `profiles.status = 'active'` lookup: a status-only check would MISS the ban on the p_actor path,
--   which is precisely the out-of-band offboarding 0095 exists to cover.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01730000-0000-0000-0000-0000000000c8","role":"authenticated"}';
select throws_ok(
  $$ select create_procurement_invoice('01730000-0000-0000-0000-000000000301','Received','2026-03-02','AMG-VI-BAN',999999) $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-005 a raw-banned member (profile still active) is refused on the JWT path');
select throws_ok(
  $$ select transition_timesheet('01730000-0000-0000-0000-000000000601','Submitted') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-005 a raw-banned member is refused by the transition RPCs too');

reset role;
set local request.jwt.claims = '{}';
select throws_ok(
  $$ select create_vault_secret_for_org('01730000-0000-0000-0000-000000000001','clickup','amg-ban-token','amg_secret_ban','01730000-0000-0000-0000-0000000000a8') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-AMG-005 service_role + p_actor_id of a RAW-BANNED Admin is refused (the status-only shortcut would have passed this)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — THE ANTI-DRIFT PAIR. `is_active_member(uuid)` duplicates `is_active_member()`'s body
-- rather than the 0-arg form delegating to it, because the 0-arg form is conjoined into ~30 RLS
-- policies on the read hot path and a SECURITY DEFINER function is never inlined by the planner.
-- The cost of that choice is DRIFT, and this is where the cost is paid: the two forms must agree in
-- every state, including the raw ban (the half a `profiles.status` lookup would miss) and an actor
-- that resolves to nothing at all (fail closed).
--
-- ⚑ Run as postgres, not `authenticated`: EXECUTE on the overload is deliberately revoked from
--   authenticated/anon so it cannot be used as an is-this-uuid-an-active-user oracle. auth.uid()
--   still reads the request.jwt.claims GUC, which survives `reset role`.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
reset role;

set local request.jwt.claims = '{"sub":"01730000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is(public.is_active_member()::text || '/' || public.is_active_member('01730000-0000-0000-0000-0000000000c1')::text,
  'true/true', 'FR-AMG-002 the two is_active_member forms agree for an ACTIVE member (true)');

set local request.jwt.claims = '{"sub":"01730000-0000-0000-0000-0000000000c9","role":"authenticated"}';
select is(public.is_active_member()::text || '/' || public.is_active_member('01730000-0000-0000-0000-0000000000c9')::text,
  'false/false', 'FR-AMG-002 the two forms agree for a DISABLED member (false)');

set local request.jwt.claims = '{"sub":"01730000-0000-0000-0000-0000000000c8","role":"authenticated"}';
select is(public.is_active_member()::text || '/' || public.is_active_member('01730000-0000-0000-0000-0000000000c8')::text,
  'false/false', 'FR-AMG-002 the two forms agree for a RAW-BANNED member (false) — 0095''s banned_until reaches BOTH');

set local request.jwt.claims = '{"sub":"01730000-0000-0000-0000-000000000fff","role":"authenticated"}';
select is(public.is_active_member()::text || '/' || public.is_active_member(null)::text,
  'false/false', 'FR-AMG-003 both forms FAIL CLOSED for an unresolvable actor (unknown uuid / NULL)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — COMPLETENESS, DERIVED FROM THE LIVE CATALOG RATHER THAN FROM A LIST.
--
-- ⚑ This is the assertion that makes the proof self-maintaining, and it is the 0178 lesson ("the
--   completeness test is not per-slice") expressed as a query. The fifteen above are a snapshot; THIS
--   is the rule. A future `security definer` function that writes, is granted to `authenticated`, and
--   forgets the gate fails HERE — instead of being appended to a list nobody re-runs.
--
--   If this fires: either add `assert_is_active_member()` (or `(p_actor)` if the function has a
--   service_role caller — do the caller analysis, do not guess), or, if the function genuinely must
--   not carry it, say so IN ITS BODY in a comment containing the string `is_active_member` and record
--   why in docs/backlog.md. Silence is not an option the query offers.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and pg_get_functiondef(p.oid) not ilike '%is_active_member%'
      and pg_get_functiondef(p.oid) ~* '(insert into|update public|delete from)'),
  '',
  'AC-AMG-001 completeness: NO security-definer write RPC granted to authenticated is missing the active-member gate');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — AC-AMG-006 / FR-AMG-005. The RLS conjuncts the create-path slices made unreachable are
-- annotated as superseded, naming what enforces them now.
--
-- ⚑ WHAT THIS SECTION DOES AND DOES NOT PROVE. It is a TEXT assertion, and text assertions are how
--   0170's AC-PMS-021 proved nothing (it matched a `--` comment, so deleting the guard left it green).
--   It is admissible here ONLY because the requirement IS documentation: "the dead control must not
--   read like a live one". It proves the annotation exists and names its successor; it proves nothing
--   about enforcement. Enforcement is sections 1-5.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select ok(
  (select d.description like '%create_procurement_invoice%'
     from pg_policy p join pg_description d on d.objoid = p.oid and d.classoid = 'pg_policy'::regclass
    where p.polname = 'procurement_invoices_insert'),
  'AC-AMG-006 procurement_invoices_insert is annotated as superseded, naming create_procurement_invoice');
select ok(
  (select d.description like '%create_procurement_receipt%'
     from pg_policy p join pg_description d on d.objoid = p.oid and d.classoid = 'pg_policy'::regclass
    where p.polname = 'procurement_receipts_insert'),
  'AC-AMG-006 procurement_receipts_insert is annotated as superseded, naming create_procurement_receipt');
select ok(
  (select d.description like '%create_procurement_quotation%'
     from pg_policy p join pg_description d on d.objoid = p.oid and d.classoid = 'pg_policy'::regclass
    where p.polname = 'procurement_quotations_write'),
  'AC-AMG-006 procurement_quotations_write is annotated as superseded, naming create_procurement_quotation');

select * from finish();
rollback;
