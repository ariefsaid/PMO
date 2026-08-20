-- 0171_sod_class_completeness.test.sql
-- docs/specs/create-path-sod-class.spec.md §10 (+ the §10.1 COMPLETENESS MATRIX) — slice 6.
-- Migration under test: 0178_sod_class_completeness.sql.
--
-- ── WHY THERE IS A SLICE 6 ───────────────────────────────────────────────────────────────────────
-- The class was declared closed after slice 3, after slice 4 and after slice 5. Each time, a table
-- had been added to the class and only the path in hand was closed. The completeness test is
-- **per-table × {INSERT, UPDATE, DELETE, RPC-parameter}**, over all fifteen tables, from the LIVE
-- CATALOG — not per-slice. That matrix is the spec's §10.1; this file is its enforcement.
--
-- ⚑ THE DENOMINATOR IS NAMED, NOT DERIVED — so a NEW money table is NOT automatically in it. Adding
--   one means adding a section here, or the "completeness" in this file's name is a claim about a set
--   that has quietly stopped matching the schema. `work_orders` (0193, #498) is §J. That is the whole
--   reason slice 6 exists: the class was declared closed after slices 3, 4 and 5, each time because
--   the path in hand was closed and the table just added was not looked at.
--
-- ⚑ AND A SECOND AXIS: a cell is not closed because an assertion is green. Two defects repaired in
--   this slice are PROOF defects — an assertion matching a `--` COMMENT (0170 AC-PMS-021: the whole
--   role gate could be deleted and 62/62 stayed green) and an assertion over a set that is EMPTY BY
--   CONSTRUCTION (`column_privileges … privilege_type='DELETE'`; DELETE is not a column privilege).
--   Both are repaired IN 0170. This file adds none of that shape: **no assertion here matches on
--   function source text.** Every rule is proven by a caller it must refuse or must serve.
--
-- ── ORACLE DISCIPLINE ────────────────────────────────────────────────────────────────────────────
-- Every denial asserts the errcode AND the exact message. A bare throws_ok(sql,'42501',null) goes
-- green for the WRONG reason the moment another 42501 gate moves in front of the one under test.
--
-- ── NO-OVER-BLOCKING CONTROLS ARE FIRST CLASS ───────────────────────────────────────────────────
-- Every revoke is paired with a proof that the legitimate path still works: archiveVersion,
-- activate_budget_version, clone_budget_version, deleteDraftVersion, the permissive-capture payment,
-- the service-role mirror writer, a Draft document's file upload, createDraftTimesheet's insert
-- shape, the Draft budget line-item editor, an Admin's project hard-delete, and the whole legitimate
-- two-person win.
begin;
select plan(97);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Fixtures (as postgres — an unattributed BYPASSRLS authority, exempt by design).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
insert into organizations (id, name) values
  ('01710000-0000-0000-0000-000000000001','SCC Org'),
  ('01710000-0000-0000-0000-000000000002','SCC Other Org');

insert into auth.users (id, email) values
  ('01710000-0000-0000-0000-0000000000a1','scc-pm@example.com'),
  ('01710000-0000-0000-0000-0000000000a2','scc-colleague@example.com'),
  ('01710000-0000-0000-0000-0000000000a3','scc-admin@example.com'),
  ('01710000-0000-0000-0000-0000000000a4','scc-finance@example.com'),
  ('01710000-0000-0000-0000-0000000000a5','scc-disabled-pm1@example.com'),
  ('01710000-0000-0000-0000-0000000000a6','scc-disabled-pm2@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('01710000-0000-0000-0000-0000000000a1','01710000-0000-0000-0000-000000000001','SCC PM','scc-pm@example.com','Project Manager','active'),
  ('01710000-0000-0000-0000-0000000000a2','01710000-0000-0000-0000-000000000001','SCC Colleague','scc-colleague@example.com','Project Manager','active'),
  ('01710000-0000-0000-0000-0000000000a3','01710000-0000-0000-0000-000000000001','SCC Admin','scc-admin@example.com','Admin','active'),
  ('01710000-0000-0000-0000-0000000000a4','01710000-0000-0000-0000-000000000001','SCC Finance','scc-finance@example.com','Finance','active'),
  -- ⚑ the MEDIUM-2 subject: two OFFBOARDED accounts that satisfied the two-person money rule.
  ('01710000-0000-0000-0000-0000000000a5','01710000-0000-0000-0000-000000000001','SCC Disabled PM1','scc-disabled-pm1@example.com','Project Manager','disabled'),
  ('01710000-0000-0000-0000-0000000000a6','01710000-0000-0000-0000-000000000001','SCC Disabled PM2','scc-disabled-pm2@example.com','Project Manager','disabled');

insert into companies (id, org_id, name, type) values
  ('01710000-0000-0000-0000-0000000000c1','01710000-0000-0000-0000-000000000001','SCC Customer','Client'),
  ('01710000-0000-0000-0000-0000000000c2','01710000-0000-0000-0000-000000000001','SCC Vendor','Vendor');

insert into projects (id, org_id, name, status) values
  ('01710000-0000-0000-0000-0000000000b1','01710000-0000-0000-0000-000000000001','SCC Project','Internal Project'),
  -- used ONLY by the cascade section (§F); kept free of FK-RESTRICT children
  ('01710000-0000-0000-0000-0000000000b2','01710000-0000-0000-0000-000000000001','SCC Cascade Project','Internal Project');

-- Budget versions. The line item goes in while the version is Draft — budget_line_items_draft_guard
-- refuses to touch it once the version is Active, which is the guard the round trip voided.
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('01710000-0000-0000-0000-0000000000f1','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000b1',1,'SCC Active','Draft'),
  ('01710000-0000-0000-0000-0000000000f2','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000b1',2,'SCC Draft','Draft'),
  ('01710000-0000-0000-0000-0000000000f3','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000b1',3,'SCC Archived','Draft'),
  ('01710000-0000-0000-0000-0000000000f4','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000b2',1,'SCC Cascade Active','Draft');

insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount) values
  ('01710000-0000-0000-0000-0000000000e1','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000f1','Labor','the line item the round trip rewrote',1000000);

update budget_versions set status = 'Active', activated_at = timestamptz '2026-01-01 00:00:00Z'
  where id = '01710000-0000-0000-0000-0000000000f1';
update budget_versions set status = 'Archived' where id = '01710000-0000-0000-0000-0000000000f3';
update budget_versions set status = 'Active', activated_at = timestamptz '2026-01-01 00:00:00Z'
  where id = '01710000-0000-0000-0000-0000000000f4';

-- Procurement cases: one Draft (the create_payment surface) and one already Vendor Invoiced with a
-- DIFFERENT approver (so the sanctioned Finance -> Paid transition can run without tripping SoD-b).
insert into procurements (id, org_id, title, status, requested_by_id, approved_by_id, vendor_id, total_value) values
  ('01710000-0000-0000-0000-0000000000d3','01710000-0000-0000-0000-000000000001','SCC draft case','Draft',
   '01710000-0000-0000-0000-0000000000a1',null,'01710000-0000-0000-0000-0000000000c2',1000),
  ('01710000-0000-0000-0000-0000000000d8','01710000-0000-0000-0000-000000000001','SCC invoiced case','Vendor Invoiced',
   '01710000-0000-0000-0000-0000000000a1','01710000-0000-0000-0000-0000000000a2','01710000-0000-0000-0000-0000000000c2',1000);

insert into sales_invoices (tax_treatment, tax_amount, id, org_id, project_id, customer_id, si_number, invoice_date, amount, status) values
  ('exclusive', 0, '01710000-0000-0000-0000-0000000000d1','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000b1',
   '01710000-0000-0000-0000-0000000000c1','SI-SCC-001','2026-03-02',500.00,'Paid');

insert into incoming_payments (id, org_id, customer_id, sales_invoice_id, ip_number, date, amount, status) values
  ('01710000-0000-0000-0000-0000000000d2','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000c1',
   '01710000-0000-0000-0000-0000000000d1','IP-SCC-001','2026-03-03',500.00,'Scheduled');

-- Two documents: one that will be APPROVED (the §D subject) and one that stays Draft (the control).
insert into project_documents (id, org_id, project_id, code, category, title, revision, doc_date, author_id, file_path, status) values
  ('01710000-0000-0000-0000-0000000000d0','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000b1',
   'DOC-SCC-1','Drawing','Benign scope of work','A','2026-02-01','01710000-0000-0000-0000-0000000000a1','scc/benign.pdf','Draft'),
  ('01710000-0000-0000-0000-0000000000d9','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000b1',
   'DOC-SCC-2','Drawing','Still a draft','A','2026-02-01','01710000-0000-0000-0000-0000000000a1',null,'Draft');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- A. budget_versions UPDATE — THE ROUND TRIP THAT VOIDED budget_line_items_draft_guard.
--    0176 closed INSERT, 0177 closed DELETE, and UPDATE was never touched.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select coalesce(string_agg(distinct column_name, ',' order by column_name), '')
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'budget_versions'
      and grantee in ('authenticated','anon') and privilege_type = 'UPDATE'),
  'status',
  'AC-SCC-010 `status` is the ONLY client-UPDATEable column on budget_versions — activated_at (the ADR-0059 push key) and the identity columns are withheld');

select is(
  (select count(*)::int from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'budget_versions'
      and grantee in ('authenticated','anon') and privilege_type = 'UPDATE'),
  0,
  'AC-SCC-010 …and no TABLE-level UPDATE grant survives (a table grant covers every column and is not reduced by a column revoke — 0075 re-opened 0010 exactly this way)');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- The exact probe that returned UPDATE 1 at 0177, step 1 of the round trip.
select throws_ok(
  $$ update public.budget_versions set status = 'Draft' where id = '01710000-0000-0000-0000-0000000000f1' $$,
  '42501',
  'budget_versions."SCC Active" cannot be moved from Active to Draft from the client: the only status change a client may make is archiving the Active version. Activation is activate_budget_version''s alone (it enforces the role gate, active membership, Draft-only legality and archiving the previous Active version in one transaction), and re-opening a version as a Draft would let its line items be edited past budget_line_items_draft_guard and then re-activated',
  'AC-SCC-011 THE ROUND TRIP, step 1: a PM re-opening the ACTIVE version as a Draft is refused, and the message names the child guard it would have voided');

select throws_ok(
  $$ update public.budget_versions set status = 'Active' where id = '01710000-0000-0000-0000-0000000000f2' $$,
  '42501',
  'budget_versions."SCC Draft" cannot be moved from Draft to Active from the client: the only status change a client may make is archiving the Active version. Activation is activate_budget_version''s alone (it enforces the role gate, active membership, Draft-only legality and archiving the previous Active version in one transaction), and re-opening a version as a Draft would let its line items be edited past budget_line_items_draft_guard and then re-activated',
  'AC-SCC-012 …and step 3 (re-activating) is refused too — activation bypassed activate_budget_version''s role gate, is_active_member(), Draft-only legality and its archive-the-previous-Active invariant');

select throws_ok(
  $$ update public.budget_versions set status = 'Active' where id = '01710000-0000-0000-0000-0000000000f3' $$,
  '42501',
  'budget_versions."SCC Archived" cannot be moved from Archived to Active from the client: the only status change a client may make is archiving the Active version. Activation is activate_budget_version''s alone (it enforces the role gate, active membership, Draft-only legality and archiving the previous Active version in one transaction), and re-opening a version as a Draft would let its line items be edited past budget_line_items_draft_guard and then re-activated',
  'AC-SCC-012 …from Archived as well (un-archiving is an activation by another name)');

-- The forged activation witness: the grant withholds the column, so this is 42501 at the privilege
-- check, BEFORE the trigger. Both layers are asserted — the grant is what a real attacker hits.
select throws_ok(
  $$ update public.budget_versions set activated_at = timestamptz '2030-12-31 00:00:00Z'
      where id = '01710000-0000-0000-0000-0000000000f1' $$,
  '42501', 'permission denied for table budget_versions',
  'AC-SCC-013 activated_at cannot be forged — it is the ADR-0059 deterministic ERPNext budget-push key, i.e. a witness of an activation the DB never performed');

reset role;
select is(
  (select budgeted_amount from public.budget_line_items where id = '01710000-0000-0000-0000-0000000000e1'),
  1000000.00::numeric,
  'AC-SCC-014 THE WHOLE ROUND TRIP IS DEAD: the Active version''s line item still holds its original amount (at 0177 this run left it at 1.00)');

select is(
  (select status::text || '/' || activated_at::text from public.budget_versions where id = '01710000-0000-0000-0000-0000000000f1'),
  'Active/2026-01-01 00:00:00+00',
  'AC-SCC-014 …and the version is still Active on its original activation witness');

-- ── CONTROLS: every legitimate writer still works ──────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ update public.budget_versions set status = 'Archived' where id = '01710000-0000-0000-0000-0000000000f1' $$,
  'AC-SCC-015 CONTROL archiveVersion (budgets.ts:382, rendered on Active only) still works — it is the ONE transition a client may make');

select lives_ok(
  $$ select activate_budget_version('01710000-0000-0000-0000-0000000000f2'::uuid) $$,
  'AC-SCC-015 CONTROL activate_budget_version still activates a Draft (a SECURITY DEFINER owned by postgres is exempt by ADR-0069, and column grants do not bind a definer at all)');

select lives_ok(
  $$ select clone_budget_version('01710000-0000-0000-0000-0000000000f2'::uuid) $$,
  'AC-SCC-015 CONTROL clone_budget_version still clones the Active version into a new editable Draft');

reset role;
select is(
  (select status::text from public.budget_versions where id = '01710000-0000-0000-0000-0000000000f2'),
  'Active',
  'AC-SCC-015 …and the RPC really activated it (the control proves the path, not just the absence of an error)');

-- The audit trail this table never had: activation was invisible on BOTH paths before 0178.
-- ⚑ Filtered on the transition itself, NOT `order by created_at desc limit 1`: every audit row in a
--   pgTAP transaction shares one now(), so an ordered pick is a coin toss — it first selected the
--   FIXTURE's own Draft->Active row and passed/failed for the wrong reason.
select is(
  (select (detail ->> 'from_status') || '->' || (detail ->> 'to_status') || '/' || coalesce(actor_id::text,'<server>')
     from public.audit_events
    where action = 'budget_version.update' and entity_id = '01710000-0000-0000-0000-0000000000f1'
      and detail ->> 'to_status' = 'Archived'),
  'Active->Archived/01710000-0000-0000-0000-0000000000a1',
  'AC-SCC-016 the client archive is AUDITED, naming both states and the actor');

select ok(
  exists (select 1 from public.audit_events
           where action = 'budget_version.update'
             and entity_id = '01710000-0000-0000-0000-0000000000f2'
             and detail ->> 'to_status' = 'Active'),
  'AC-SCC-016 …and so is activate_budget_version''s ACTIVATION — the audit fires for all roles, so the RPC path is on the trail too (it was unaudited on both paths)');

select ok(
  exists (select 1 from public.audit_events
           where action = 'budget_version.create'
             and entity_id = '01710000-0000-0000-0000-0000000000f1'),
  'AC-SCC-016 …and every budget_version INSERT is audited (0176 §4 added the guard and not the trail — probed live: 0 audit rows)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- B. create_payment(p_status) — THE PROTECTED END STATE AS AN RPC PARAMETER.
--    payments / purchase_orders / purchase_requests / rfqs hold NO client table grant at all, so the
--    definer RPC is the entire write surface and its parameters are the entire attack surface.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.table_privileges
    where table_schema = 'public' and grantee in ('authenticated','anon')
      and privilege_type in ('INSERT','UPDATE','DELETE')
      and table_name in ('payments','purchase_orders','purchase_requests','rfqs')),
  0,
  'AC-SCC-020 no client role holds INSERT/UPDATE/DELETE on any of the four record tables — which is WHY the RPC parameter is the whole surface');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- The exact probe that returned `PAY-2607290001 | Paid | 888888.00` at 0177, on a DRAFT case.
select throws_ok(
  $$ select create_payment('01710000-0000-0000-0000-0000000000d3'::uuid, null, 'REF', 'Paid', '2026-03-02'::date, 888888) $$,
  'P0001',
  'payments.status "Paid" is not an origination status: a payment record is captured as Scheduled, and Paid is reached only by paying the case — the transition that is Finance-only and enforces that the approver does not pay their own request',
  'AC-SCC-021 THE EXPLOIT: a PM minting a PAID payment for 888888 on a DRAFT case is refused — it bypassed a Finance-only transition AND SoD-b (approver != payer) with a real server-sequence document number');

-- ── CONTROLS: permissive capture (FR-PR-017) is preserved in BOTH of its caller shapes ─────────
select lives_ok(
  $$ select create_payment('01710000-0000-0000-0000-0000000000d3'::uuid, null, 'REF-S', 'Scheduled', '2026-03-02'::date, 10) $$,
  'AC-SCC-022 CONTROL an origination (Scheduled) payment capture still works');

select is(
  (select status from create_payment('01710000-0000-0000-0000-0000000000d3'::uuid, null, 'REF-N', null, '2026-03-02'::date, 10)),
  'Scheduled',
  'AC-SCC-022 CONTROL a NULL p_status still works and still defaults to Scheduled — procurementRecords.ts forwards a runtime-legal NULL and 0079 calls it that way in four assertions, so the gate is `is not null and <> ...`, NOT a whitelist that rejects NULL');
reset role;

-- The sanctioned writer of a Paid payment row: transition_procurement's Finance-only -> Paid branch.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok(
  $$ select transition_procurement('01710000-0000-0000-0000-0000000000d8'::uuid,'Paid'::procurement_status) $$,
  'AC-SCC-023 CONTROL the SANCTIONED path is untouched: Finance (not the approver) pays the case');
reset role;
select is(
  (select status from public.payments where procurement_id = '01710000-0000-0000-0000-0000000000d8'),
  'Paid',
  'AC-SCC-023 …and THAT is what still mints a Paid payment row — the gate closes the forgery, not the workflow');

-- ⚑ PINNED, STILL OPEN BY DESIGN. The other three RPCs share create_payment's SHAPE and not its SoD
--   content: 'Submitted' (purchase_requests) is minted by a transition open to every write role,
--   'Issued' (purchase_orders) by one open to {PM, Finance} which the RPC's own gate already implies,
--   and no transition writes `rfqs` at all. The tables are PERMISSIVE CAPTURE by design (FR-PR-017;
--   0079 AC-PR-014 asserts an already-Ordered case succeeds ON PURPOSE), so a status whitelist is a
--   PRODUCT decision. Asserted here so that changing it is a deliberate, test-visible act.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  (select status from create_purchase_order('01710000-0000-0000-0000-0000000000d3'::uuid, null, 'Issued', '2026-03-02'::date, 1))
  || '/' ||
  (select status from create_purchase_request('01710000-0000-0000-0000-0000000000d3'::uuid, null, 'Approved', '2026-03-02'::date, 1))
  || '/' ||
  (select status from create_rfq('01710000-0000-0000-0000-0000000000d3'::uuid, null, 'Closed', '2026-03-02'::date, 1)),
  'Issued/Approved/Closed',
  'AC-SCC-024 PIN (STILL OPEN, product decision): create_purchase_order/_request/_rfq still accept any CHECK-legal status — permissive capture, FR-PR-017. Closing it must be a deliberate act that rewrites THIS line. docs/backlog.md');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- C. incoming_payments INSERT/UPDATE — the AR twin of sales_invoices, and the last write path on it.
--    0176 excluded it; 0177 §A3 re-judged that, closed DELETE and recorded the rest as open.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'incoming_payments'
      and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE','DELETE')),
  0,
  'AC-SCC-030 no TABLE-level INSERT/UPDATE/DELETE grant on incoming_payments survives for a client role');

select is(
  (select coalesce(string_agg(distinct privilege_type || ':' || column_name, ',' order by privilege_type || ':' || column_name), '')
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'incoming_payments'
      and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE')),
  -- #478 (0187): `currency` joined the BODY set (granted explicitly because this table's INSERT grant
  -- is column-level). status / ip_number / erp_* stay withheld and UPDATE still gets nothing.
  'INSERT:amount,INSERT:created_at,INSERT:currency,INSERT:customer_id,INSERT:date,INSERT:id,INSERT:org_id,INSERT:reference_number,INSERT:sales_invoice_id',
  'AC-SCC-030 the re-granted INSERT is the BODY only — no status, no ip_number, no erp_* feed column — and UPDATE gets no re-grant at all (mirrors 0176 §1 on sales_invoices)');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Probe 1 at 0177: the forged receipt, in one statement, with zero audit rows.
select throws_ok(
  $$ insert into public.incoming_payments (org_id, customer_id, sales_invoice_id, ip_number, date, amount, status, erp_docstatus)
     values ('01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000c1',
             '01710000-0000-0000-0000-0000000000d1','IP-FORGED','2026-03-04',500000,'Paid',1) $$,
  '42501', 'permission denied for table incoming_payments',
  'AC-SCC-031 the forged Paid/500000/IP-FORGED/erp_docstatus=1 receipt is denied AT THE GRANT — the layer a real attacker hits first');

-- Probe 2 at 0177, and the sharper one: it REWRITES A REAL MIRROR ROW.
select throws_ok(
  $$ update public.incoming_payments set status = 'Paid', amount = 999999, ip_number = 'IP-REWRITTEN', erp_docstatus = 1
      where id = '01710000-0000-0000-0000-0000000000d2' $$,
  '42501', 'permission denied for table incoming_payments',
  'AC-SCC-032 …and rewriting an EXISTING Scheduled receipt into a Paid 999999 one is denied (erp_docstatus is the ERP''s submitted flag — a client that can write it makes PMO assert a receipt ERPNext never issued)');

-- The trigger layer behind the grant: it is what NAMES the rule (a 42501 names nothing). Reached by
-- an insert that stays inside the re-granted column list but breaks the origination rule.
select throws_ok(
  $$ insert into public.incoming_payments (org_id, customer_id, sales_invoice_id, date, amount, status)
     values ('01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000c1',
             '01710000-0000-0000-0000-0000000000d1','2026-03-04',1,'Paid') $$,
  '42501', 'permission denied for table incoming_payments',
  'AC-SCC-033 naming `status` at all is denied at the grant — the trigger below is the SECOND layer, not the first');
reset role;

select is(
  (select status || '/' || amount::text from public.incoming_payments where id = '01710000-0000-0000-0000-0000000000d2'),
  'Scheduled/500.00',
  'AC-SCC-033 …and the real mirror row is untouched');

-- ⚑ A FIRST DRAFT OF THIS SECTION ASSERTED SOMETHING FALSE, and the run caught it. It claimed a
--   client insert that OMITS status would reach the trigger's message with <NULL> interpolated. It
--   does not: `incoming_payments.status` carries a column DEFAULT of 'Scheduled', so an omitted status
--   lands on the origination value and the trigger correctly says nothing. The trigger's status branch
--   is UNREACHABLE from a client by construction (the column is not in the grant, and the default is
--   legal) — which is exactly what makes it the SECOND layer. So it is proven for what it is: the
--   layer that holds IF a future migration re-grants the column. That is not hypothetical here —
--   0075 re-granted, verbatim, what 0010 had revoked.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.incoming_payments (id, org_id, customer_id, sales_invoice_id, reference_number, date, amount)
  values ('01710000-0000-0000-0000-0000000000db','01710000-0000-0000-0000-000000000001',
          '01710000-0000-0000-0000-0000000000c1','01710000-0000-0000-0000-0000000000d1','SCC-BODY','2026-03-05',1);
reset role;
select is(
  (select status from public.incoming_payments where id = '01710000-0000-0000-0000-0000000000db'),
  'Scheduled',
  'AC-SCC-034 CONTROL the forward-compat body seam still works and lands on the origination status by column DEFAULT — which is WHY the trigger''s status branch is unreachable from a client, not dead');

-- The second layer, proven under the exact failure mode this repo has suffered: a future migration
-- re-grants the column. (0075 re-granted, verbatim, what 0010 had revoked.) The grant is made and
-- rolled back inside this transaction; the trigger must still refuse, by message.
grant insert (status) on public.incoming_payments to authenticated;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into public.incoming_payments (org_id, customer_id, sales_invoice_id, date, amount, status)
     values ('01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000c1',
             '01710000-0000-0000-0000-0000000000d1','2026-03-05',1,'Paid') $$,
  'P0001',
  'incoming_payments.status "Paid" is not the origination status: a customer receipt is created as Scheduled, and Paid is reached only through the ERPNext mirror, which is written by the service-role adapter and never by a client',
  'AC-SCC-034 SECOND LAYER: even if a future migration re-granted the status column, the trigger still refuses a forged Paid — and it NAMES the rule, which the grant''s bare 42501 never can');

select throws_ok(
  $$ insert into public.incoming_payments (org_id, customer_id, sales_invoice_id, date, amount, status)
     values ('01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000c1',
             '01710000-0000-0000-0000-0000000000d1','2026-03-05',1,null) $$,
  'P0001',
  'incoming_payments.status "<NULL>" is not the origination status: a customer receipt is created as Scheduled, and Paid is reached only through the ERPNext mirror, which is written by the service-role adapter and never by a client',
  'AC-SCC-034 …and it is NULL-TOTAL: an explicit status => NULL reaches the RULE''s message, not a NOT NULL violation (0176 §6''s three-valued-logic defect, which opened four guards silently)');
reset role;
revoke insert (status) on public.incoming_payments from authenticated;

-- ── CONTROL: the service-role mirror writer — the only sanctioned writer — is untouched ────────
set local role service_role;
select lives_ok(
  $$ insert into public.incoming_payments (id, org_id, customer_id, sales_invoice_id, ip_number, date, amount, status, erp_docstatus)
     values ('01710000-0000-0000-0000-0000000000da','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000c1',
             '01710000-0000-0000-0000-0000000000d1','IP-MIRROR-1','2026-03-06',250,'Paid',1) $$,
  'AC-SCC-035 CONTROL the service-role ERPNext mirror writer still inserts a Paid receipt with its ERP document number and feed columns');
select lives_ok(
  $$ update public.incoming_payments set amount = 260 where id = '01710000-0000-0000-0000-0000000000da' $$,
  'AC-SCC-035 CONTROL …and still updates it (the revoke did not over-reach past the client)');
reset role;

select ok(
  exists (select 1 from public.audit_events
           where action = 'incoming_payment.create' and entity_id = '01710000-0000-0000-0000-0000000000da'),
  'AC-SCC-035 …and every incoming_payments create is now AUDITED (probed at 0177: 0 audit rows for a forged insert)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- D. project_documents — THE SoD DEFEATED ON THE GOAL, NOT ON THE TRANSITION.
--    Get a benign body approved by a colleague (the real SoD runs and PASSES), then swap the file.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_document_status('01710000-0000-0000-0000-0000000000d0'::uuid,'Issued'::doc_status) $$,
  'AC-SCC-040 CONTROL the author issues their own draft (that is legal)');
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_document_status('01710000-0000-0000-0000-0000000000d0'::uuid,'Approved'::doc_status) $$,
  'AC-SCC-040 CONTROL …and a COLLEAGUE approves it — the approver-!=-author SoD runs and PASSES');

-- The swap, as the author, exactly as probed at 0177.
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ update public.project_documents set file_path = 'scc/swapped.pdf'
      where id = '01710000-0000-0000-0000-0000000000d0' $$,
  '42501',
  'project_documents."Benign scope of work" is Approved and its file cannot be replaced from the client: the approval in transition_document_status (nobody approves their own document) attests to the FILE THAT WAS APPROVED, so swapping it afterwards would defeat that rule on the goal rather than on the transition — raise a revision instead',
  'AC-SCC-041 THE EXPLOIT: the author replacing the APPROVED file is refused — the SoD is defended on the goal, not only on the transition');
reset role;

select is(
  (select file_path from public.project_documents where id = '01710000-0000-0000-0000-0000000000d0'),
  'scc/benign.pdf',
  'AC-SCC-041 …and the approved file is still the one that was approved');

-- ⚑ PINNED, STILL OPEN, OWNER'S CALL. The metadata edit on a non-Draft document is a SHIPPED,
--   unit-tested affordance: DocumentsTab.tsx:296/538 renders Edit whenever
--   `canEditDoc(d) && status not in (Closed, Superseded)`, i.e. the author may edit their own
--   Issued/Approved document's metadata. Removing that is a PRODUCT decision (the sanctioned way to
--   change an approved document is createDocumentRevision, a NEW row). What 0178 does close is the
--   FILE swap above and the total absence of an audit trail — asserted next.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ update public.project_documents set title = 'Variation order +5,000,000', revision = 'B'
      where id = '01710000-0000-0000-0000-0000000000d0' $$,
  'AC-SCC-042 PIN (STILL OPEN, product decision): the author CAN still rewrite an APPROVED document''s metadata — it is the shipped DocumentsTab Edit affordance. Closing it must rewrite THIS line. docs/backlog.md');
reset role;

-- ⚑ Filtered on the change itself, not `order by created_at desc limit 1` — see the note at
--   AC-SCC-016. The two transition_document_status calls above ALSO write project_document.update
--   rows (which is the point: the whole update path is now on the trail), and they share one now().
select is(
  (select (detail ->> 'from_title') || ' -> ' || (detail ->> 'to_title') || ' @ ' || (detail ->> 'status')
     from public.audit_events
    where action = 'project_document.update' and entity_id = '01710000-0000-0000-0000-0000000000d0'
      and detail ->> 'to_title' = 'Variation order +5,000,000'),
  'Benign scope of work -> Variation order +5,000,000 @ Approved',
  'AC-SCC-043 …but it is no longer INVISIBLE: every project_documents update is audited with the before and after of every content column (probed at 0177: 0 audit rows)');

-- ── CONTROLS: a DRAFT document''s file is still freely writable ─────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ update public.project_documents set file_path = 'scc/uploaded.pdf'
      where id = '01710000-0000-0000-0000-0000000000d9' $$,
  'AC-SCC-044 CONTROL a DRAFT document''s file is still writable — DocumentsTab renders Upload/Replace on Draft only, so the guard costs the product nothing');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- E. is_active_member() — THE MONEY SoD''S "SECOND PERSON" COULD BE AN OFFBOARDED ACCOUNT.
--    auth_role() reads profiles.role with NO status filter, so a disabled profile still returns
--    'Project Manager'. This lands on the control 0177 had just introduced.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
insert into projects (id, org_id, name, status, contract_value) values
  ('01710000-0000-0000-0000-0000000000b3','01710000-0000-0000-0000-000000000001','SCC Offboarded deal','Negotiation',0);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(
  (select is_active_member()), false,
  'AC-SCC-050 the offboarded PM really is inactive (asserted, not assumed — the whole section is meaningless if the fixture is wrong)');

select throws_ok(
  $$ select set_project_contract_value('01710000-0000-0000-0000-0000000000b3'::uuid, 77000000) $$,
  '42501', 'not authorized',
  'AC-SCC-051 a DISABLED Project Manager can no longer author a contract value (probed at 0177: it succeeded, and became a valid "second person")');

-- Give the deal a legitimate witness so the next assertion tests the MEMBERSHIP gate and not the SoD.
-- ⚑ The witness is FINANCE (a4), not the peer PM (a2), and that is the point: under ADR-0070 a peer
-- does not outrank a peer, so a colleague-witnessed deal is no longer winnable by the author. Using
-- a2 here would make the next assertion fail for the SoD reason and silently stop testing membership
-- at all — the control would still be red, but for the wrong reason. (It WAS a2, and it went red on
-- the rank ruling; fixed the FIXTURE, not the oracle.)
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('01710000-0000-0000-0000-0000000000b3'::uuid, 77000000) $$,
  'AC-SCC-052 CONTROL an ACTIVE Finance user authors the value — and Finance may now do so PRE-WIN (owner ruling 2026-07-29), which is the capability ADR-0070 assumed and the old gate withheld');

set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok(
  $$ select transition_project('01710000-0000-0000-0000-0000000000b3'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-SCC-1', '2026-03-02'::date) $$,
  '42501', 'not authorized',
  'AC-SCC-052 …and a DISABLED Project Manager can no longer WIN it either — at 0177 two offboarded accounts satisfied the two-person money rule between them and landed 77,000,000');
reset role;

select is(
  (select status::text from public.projects where id = '01710000-0000-0000-0000-0000000000b3'),
  'Negotiation',
  'AC-SCC-052 …and the deal did not move');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_project('01710000-0000-0000-0000-0000000000b3'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-SCC-1', '2026-03-02'::date) $$,
  'AC-SCC-053 CONTROL an ACTIVE PM still wins a deal witnessed by someone SENIOR to them — the membership conjunct is not an over-block');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- F. THE CASCADE. 0177''s own headline lesson — "a guard on a child table is not a guard if a parent
--    delete CASCADES" — was NOT implemented by its own fix: an ON DELETE CASCADE runs as the
--    REFERENCED table''s owner, so current_user became postgres, actor_bypasses_rls() returned TRUE,
--    and the guard returned before evaluating its rule.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- The predicate''s ADR-0069 properties, asserted rather than assumed. (Property 1 is the sharpest: as
-- a SECURITY DEFINER it would read current_user = postgres and exempt EVERY caller, silently.)
select is(
  (select prosecdef::text || '/' || array_to_string(proconfig,',') from pg_proc
    where proname = 'is_unattributed_authority' and pronamespace = 'public'::regnamespace),
  'false/search_path=pg_catalog, public',
  'AC-SCC-060 is_unattributed_authority is SECURITY INVOKER (a definer would read current_user=postgres and exempt everyone) and names pg_catalog FIRST');

select ok(
  has_function_privilege('authenticated','public.is_unattributed_authority()','execute')
  and has_function_privilege('anon','public.is_unattributed_authority()','execute'),
  'AC-SCC-060 …and carries an EXPLICIT execute grant, so `revoke execute on all functions in schema public from public` cannot turn every guarded delete into a 42501');

-- The discriminator, in the three states that matter. A CASCADE reproduces state 2 exactly: a
-- BYPASSRLS role with the caller''s JWT claims still in scope.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  (select actor_bypasses_rls()::text || '/' || is_unattributed_authority()::text),
  'false/false',
  'AC-SCC-061 a plain client: neither predicate exempts');
reset role;
select is(
  (select actor_bypasses_rls()::text || '/' || is_unattributed_authority()::text),
  'true/false',
  'AC-SCC-061 a BYPASSRLS role WITH an actor — exactly what a client-initiated CASCADE looks like: the old predicate exempted it, the new one does NOT');
set local request.jwt.claims = '';
select is(
  (select actor_bypasses_rls()::text || '/' || is_unattributed_authority()::text),
  'true/true',
  'AC-SCC-061 a BYPASSRLS role with NO actor — seed.sql / the pgTAP fixtures / the service-role mirror writer / e2e teardown: still exempt, so the change is strictly narrowing');

-- ── The behavioural proof: the guard now FIRES INSIDE A CASCADE ────────────────────────────────
-- Reproduced honestly: a cascading parent delete reaching the guard with a NON-Admin actor. Today the
-- only cascading parent is `projects`, gated Admin-only by RLS — so the delete is issued by a
-- BYPASSRLS role while a PM''s claims are in scope, which is byte-for-byte the state a cascade
-- creates. Before 0178 this destroyed the Active version and its line items silently.
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ delete from public.projects where id = '01710000-0000-0000-0000-0000000000b2' $$,
  '42501',
  'budget_versions."SCC Cascade Active" is Active and only an Admin may delete a budget version that is not a Draft: deleting it CASCADES to its line items past budget_line_items_draft_guard, and to the ERPNext budget-push mirror — archive it instead',
  'AC-SCC-062 THE CASCADE IS GUARDED: a parent delete carrying a NON-Admin actor is refused BY THE CHILD''S OWN RULE (at 0177 the guard exempted every cascade before evaluating it)');

select is(
  (select count(*)::int from public.budget_versions where id = '01710000-0000-0000-0000-0000000000f4'),
  1,
  'AC-SCC-062 …and the Active version survived the parent delete');

-- ── CONTROLS: the two paths that MUST still cascade through ────────────────────────────────────
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ delete from public.projects where id = '01710000-0000-0000-0000-0000000000b2' $$,
  'AC-SCC-063 CONTROL an ADMIN''s project hard-delete still cascades through the guard — and NOW the Admin carve-out is genuinely load-bearing, which is what 0177''s header claimed and did not deliver');
select is(
  (select count(*)::int from public.budget_versions where id = '01710000-0000-0000-0000-0000000000f4'),
  0,
  'AC-SCC-063 …and the cascaded version really is gone (the control proves the path, not just the absence of an error)');

set local request.jwt.claims = '';
insert into projects (id, org_id, name, status) values
  ('01710000-0000-0000-0000-0000000000b4','01710000-0000-0000-0000-000000000001','SCC Teardown Project','Internal Project');
insert into budget_versions (id, org_id, project_id, version, name, status, activated_at) values
  ('01710000-0000-0000-0000-0000000000f5','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000b4',1,'SCC Teardown Active','Active',now());
select lives_ok(
  $$ delete from public.projects where id = '01710000-0000-0000-0000-0000000000b4' $$,
  'AC-SCC-063 CONTROL an UNATTRIBUTED authority (e2e teardown / seed.sql / the importer — no JWT actor) still tears an Active version down through the cascade');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- G. THE MONEY SoD, AS THE OWNER RULED IT — ADR-0070: APPROVAL AUTHORITY IS RANK + LINE MANAGEMENT.
--
--    0177 shipped "approver != author — ANY second person will do", with an ENUMERATED
--    {Admin, Executive, Finance} carve-out justified as "set_project_contract_value's own gate".
--    That RPC has TWO gates and they differ (on-hand {Admin, Executive, Finance}, pre-win
--    {Admin, Executive, Project Manager}): the list was copied from the wrong branch, and 62
--    assertions plus two reviewers missed it, BECAUSE A LIST OF ROLE LITERALS IS UNFALSIFIABLE.
--    The rule was also wrong on its merits — ADR-0019 §1 reserves a WON project's contract value to
--    {Admin, Executive, Finance}, so "any second person" let a PM plus a peer PM achieve in two
--    steps what ADR-0019 forbids in one.
--
--    THE TRUTH TABLE BELOW IS THE SPECIFICATION. Every row of ADR-0070's table is a live assertion.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ── The rank table itself, asserted as DATA rather than trusted as a comment ────────────────────
select is(
  (select string_agg(r::text || '=' || coalesce(role_rank(r)::text,'<null>'), ' ' order by role_rank(r) desc, r::text)
     from unnest(enum_range(null::user_role)) r),
  'Admin=50 Executive=40 Finance=30 Project Manager=20 Engineer=10',
  'AC-SCC-073 the ONE rank ordering (ADR-0070): Admin > Executive > Finance > Project Manager > Engineer, over the WHOLE user_role enum — so a role added to the enum without a rank shows up here immediately');

-- The falsifiable form of the claim 0177 made in a comment and got wrong.
select is(
  (select coalesce(array_agg(r::text order by r::text), array[]::text[])
     from unnest(enum_range(null::user_role)) r where holds_won_value_authority(r)),
  array['Admin','Executive','Finance'],
  'AC-SCC-074 holds_won_value_authority() selects EXACTLY ADR-0019 §1''s set today — so replacing the enumerated on-hand gate with the rank threshold is a refactor, not a behaviour change');

-- The property the whole ADR exists for: a NEW role must not require editing any SoD predicate.
select ok(
  (select role_outranks('Finance','Project Manager') and role_outranks('Executive','Finance')
      and role_outranks('Project Manager','Engineer') and role_outranks('Admin','Engineer')
      and role_outranks('Admin','Executive') and not role_outranks('Executive','Admin')
      and not role_outranks('Admin','Admin') and not role_outranks('Executive','Executive')
      and not role_outranks('Project Manager','Project Manager')
      and not role_outranks('Project Manager','Finance')),
  'AC-SCC-075 rank is a STRICT TOTAL order, Admin > Executive (owner ruling 2026-07-29) — and a peer never outranks a peer, which is what makes "the colleague at the next desk" insufficient. Admin>Executive is what makes "only an Admin may assign the Executive role" expressible as outranking rather than as a special case');

select ok(
  (select not role_outranks(null,'Engineer') and not role_outranks('Admin',null)
      and not holds_won_value_authority(null)
      and not may_approve_work_of(null,'01710000-0000-0000-0000-0000000000a1')
      and not may_approve_work_of('01710000-0000-0000-0000-0000000000a3',null)),
  'AC-SCC-075 …and every helper is NULL-TOTAL — a NULL role or a NULL actor is "no authority", never an exemption (0176 §6''s three-valued-logic defect, which opened four guards silently)');

-- ⚑ THE LOAD-BEARING PRECONDITION. manager_id is now an authorisation input, so if a user could edit
--   their own, every rule built on ADR-0070 becomes self-serve. profiles_update_self must keep
--   pinning BOTH columns. (This is the one place in the slice that asserts on policy source, and it
--   is a POLICY EXPRESSION, not a comment — pg_policies.with_check is compiled SQL, so it cannot be
--   satisfied by a `--` comment the way 0170 AC-PMS-021 was.)
select ok(
  (select with_check like '%manager_id%' and with_check like '%role%'
     from pg_policies where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_update_self'),
  'AC-SCC-076 profiles_update_self still pins BOTH role and manager_id — a user cannot self-grant approval authority. ADR-0070 names this load-bearing: remove it and every SoD rule built on rank becomes self-serve');

-- ── ROW 1: PM sets the value, nobody ratifies, the same PM wins -> REFUSED ──────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
-- ⚑ Created at 'Leads' and walked up: 0173's origination guard refuses a project created past its
--   origination status, and a first draft of this fixture tripped it. Walking it is also the truer
--   reproduction — the exploit IS a PM driving their own deal the length of the pipeline alone.
insert into public.projects (id, org_id, name, status, contract_value) values
  ('01710000-0000-0000-0000-0000000000b5','01710000-0000-0000-0000-000000000001','SCC Self-set deal','Leads',99999999);
select transition_project('01710000-0000-0000-0000-0000000000b5'::uuid,'PQ Submitted'::project_status);
select transition_project('01710000-0000-0000-0000-0000000000b5'::uuid,'Quotation Submitted'::project_status);
select throws_ok(
  $$ select transition_project('01710000-0000-0000-0000-0000000000b5'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-SCC-2', '2026-03-02'::date) $$,
  '42501',
  'this deal''s contract value was not set by anyone senior to you, so you cannot win it: it must be confirmed by your supervisor or by someone who outranks you, through set_project_contract_value (which records who set it) — or ask them to win the deal',
  'AC-SCC-070 ROW 1 a PM who set their own contract value cannot win it, and the message describes the rule in the owner''s terms — your supervisor, or someone who outranks you');

-- ── ROW 2: a PEER PM ratifies (not the author's manager) -> STILL REFUSED. THE CHANGE. ──────────
-- a2 is a Project Manager and is NOT a1's manager. Under 0177 this ratification CLEARED the win.
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('01710000-0000-0000-0000-0000000000b5'::uuid, 500000) $$,
  'AC-SCC-071 ROW 2 a peer PM CAN still author the value (set_project_contract_value''s pre-win gate admits Project Managers — that gate is unchanged)');
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select transition_project('01710000-0000-0000-0000-0000000000b5'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-SCC-2', '2026-03-02'::date) $$,
  '42501',
  'this deal''s contract value was not set by anyone senior to you, so you cannot win it: it must be confirmed by your supervisor or by someone who outranks you, through set_project_contract_value (which records who set it) — or ask them to win the deal',
  'AC-SCC-071 ROW 2 …but the win is STILL REFUSED — THIS IS THE BEHAVIOUR CHANGE. 0177 allowed it, and the easiest second signature is the colleague at the next desk. ADR-0019 §1 does not trust a PM with a won value, so a PM cannot confer one');
reset role;
select is(
  (select status::text from public.projects where id = '01710000-0000-0000-0000-0000000000b5'),
  'Quotation Submitted',
  'AC-SCC-071 ROW 2 …and the deal did not move');

-- ── ROW 3: the PM's LINE MANAGER ratifies -> ALLOWED, whatever their role ───────────────────────
-- a7 is deliberately a PROJECT MANAGER — the same role as the author, so this row can only pass
-- through the LINE-MANAGEMENT limb. If it passed by rank the fixture would prove nothing.
insert into auth.users (id, email) values ('01710000-0000-0000-0000-0000000000a7','scc-lead-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('01710000-0000-0000-0000-0000000000a7','01710000-0000-0000-0000-000000000001','SCC Lead PM','scc-lead-pm@example.com','Project Manager','active');
update profiles set manager_id = '01710000-0000-0000-0000-0000000000a7'
  where id = '01710000-0000-0000-0000-0000000000a1';

select ok(
  (select not role_outranks(
             (select role from profiles where id = '01710000-0000-0000-0000-0000000000a7'),
             (select role from profiles where id = '01710000-0000-0000-0000-0000000000a1'))),
  'AC-SCC-072 ROW 3 the line manager does NOT outrank the author (both are Project Managers) — so the next assertion can only pass through the LINE-MANAGEMENT limb, not through rank');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('01710000-0000-0000-0000-0000000000b5'::uuid, 500000) $$,
  'AC-SCC-072 ROW 3 the PM''s line manager re-sets the value');
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_project('01710000-0000-0000-0000-0000000000b5'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-SCC-2', '2026-03-02'::date) $$,
  'AC-SCC-072 ROW 3 …and NOW the PM wins it — being in someone''s supervisor field is sufficient, whatever the two roles are (ADR-0070 limb 1)');
reset role;

-- ── ROW 4: Finance ratifies a PM's deal -> ALLOWED, by rank ─────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.projects (id, org_id, name, status, contract_value) values
  ('01710000-0000-0000-0000-0000000000b6','01710000-0000-0000-0000-000000000001','SCC Finance-ratified','Leads',250000);
select transition_project('01710000-0000-0000-0000-0000000000b6'::uuid,'PQ Submitted'::project_status);
select transition_project('01710000-0000-0000-0000-0000000000b6'::uuid,'Quotation Submitted'::project_status);
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('01710000-0000-0000-0000-0000000000b6'::uuid, 250000) $$,
  'AC-SCC-073 ROW 4 a FINANCE user ratifies the PM''s figure — at the SAME number, which is the ratifier''s natural act and which must still re-stamp the witness');
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_project('01710000-0000-0000-0000-0000000000b6'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-SCC-3', '2026-03-02'::date) $$,
  'AC-SCC-073 ROW 4 …and the PM wins it — Finance outranks a Project Manager (ADR-0070 limb 2)');
reset role;

-- ── ROW 5: a FINANCE user wins their OWN self-set value -> ALLOWED ─────────────────────────────
-- Not by a carve-out list: Finance HOLDS won-value authority by rank (ADR-0019 §1), so the rule
-- never asks them for a second person in the first place.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a4","role":"authenticated"}';
insert into public.projects (id, org_id, name, status, contract_value) values
  ('01710000-0000-0000-0000-0000000000b7','01710000-0000-0000-0000-000000000001','SCC Finance own deal','Leads',88888);
select transition_project('01710000-0000-0000-0000-0000000000b7'::uuid,'PQ Submitted'::project_status);
select transition_project('01710000-0000-0000-0000-0000000000b7'::uuid,'Quotation Submitted'::project_status);
select lives_ok(
  $$ select transition_project('01710000-0000-0000-0000-0000000000b7'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-SCC-4', '2026-03-02'::date) $$,
  'AC-SCC-074 ROW 5 a FINANCE user wins their OWN self-set value — re-justified under rank: they are the role ADR-0019 §1 makes accountable for a won value, so no second person is required of them');
reset role;

-- ── ROW 6: the author's manager_id IS NULL, a peer PM ratifies -> REFUSED. FAIL CLOSED. ─────────
-- ⚑ 5 of 11 seeded profiles carry no manager_id. A missing manager must fall back to the RANK test
--   and never wave anything through — a NULL-driven exemption is 0176 §6's defect exactly.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into public.projects (id, org_id, name, status, contract_value) values
  ('01710000-0000-0000-0000-0000000000b8','01710000-0000-0000-0000-000000000001','SCC Null-manager deal','Leads',640000);
select transition_project('01710000-0000-0000-0000-0000000000b8'::uuid,'PQ Submitted'::project_status);
select transition_project('01710000-0000-0000-0000-0000000000b8'::uuid,'Quotation Submitted'::project_status);
reset role;
select ok(
  (select manager_id is null from profiles where id = '01710000-0000-0000-0000-0000000000a2'),
  'AC-SCC-075 ROW 6 the author really has NO line manager (asserted, not assumed — the row is meaningless if the fixture happens to have one)');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('01710000-0000-0000-0000-0000000000b8'::uuid, 640000) $$,
  'AC-SCC-075 ROW 6 a peer PM (who has a manager, but is not THIS author''s) ratifies');
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_project('01710000-0000-0000-0000-0000000000b8'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-SCC-5', '2026-03-02'::date) $$,
  '42501',
  'this deal''s contract value was not set by anyone senior to you, so you cannot win it: it must be confirmed by your supervisor or by someone who outranks you, through set_project_contract_value (which records who set it) — or ask them to win the deal',
  'AC-SCC-075 ROW 6 FAIL CLOSED — a NULL manager_id falls back to rank and is REFUSED, never waved through');
reset role;

-- ── The pre-win gate is deliberately UNCHANGED, and that asymmetry is the rule''s teeth ──────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select set_project_contract_value('01710000-0000-0000-0000-0000000000b6'::uuid, 99999999) $$,
  '42501', 'changing the contract value on a won project requires Executive or Finance',
  'AC-SCC-076 a PM still cannot touch an ON-HAND value — so there is no two-step path to a priced won deal either. That gate is now expressed as holds_won_value_authority(), NOT as a role list, and its message is unchanged');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- H. HYGIENE — each item probed against the live catalog, each with its no-over-blocking control.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select ok(
  exists (select 1 from pg_index i
           join pg_class c on c.oid = i.indrelid
           join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
          where c.relname = 'projects' and c.relnamespace = 'public'::regnamespace
            and a.attname = 'contract_value_set_by'),
  'AC-SCC-080 projects.contract_value_set_by has a covering index — it was the ONLY foreign key on projects without one, so every profiles delete/update seq-scanned projects to check it');

select is(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'timesheets'
      and grantee in ('authenticated','anon') and privilege_type = 'INSERT'
      and column_name = 'submitted_at'),
  0,
  'AC-SCC-081 timesheets.submitted_at is no longer client-INSERTable — a forged submission timestamp corrupts 0174 §1''s post-submit forensic heuristic at its source (probed: an inserted Draft carried submitted_at = 2020-01-01)');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ insert into public.timesheets (user_id, week_start_date, status)
     values ('01710000-0000-0000-0000-0000000000a1','2026-03-02','Draft') $$,
  'AC-SCC-081 CONTROL createDraftTimesheet''s exact insert shape (user_id, week_start_date, status) still works');

select throws_ok(
  $$ insert into public.timesheets (user_id, week_start_date, status, submitted_at)
     values ('01710000-0000-0000-0000-0000000000a1','2026-03-09','Draft', timestamptz '2020-01-01 00:00:00Z') $$,
  '42501', 'permission denied for table timesheets',
  'AC-SCC-081 …and naming submitted_at is denied');

-- L2: the latent DELETE grants. These tables have NO DELETE policy, so a client DELETE matched 0 rows
-- — closed by POLICY ABSENCE ALONE, i.e. one `create policy … for delete` away from re-opening.
select is(
  (select coalesce(array_agg(distinct c.relname order by c.relname), array[]::name[])
     from pg_class c, aclexplode(c.relacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('procurements','timesheets')
      and a.privilege_type = 'DELETE'
      and a.grantee::regrole::text in ('authenticated','anon')),
  array[]::name[],
  'AC-SCC-082 the latent DELETE grants on procurements and timesheets are revoked — their closure no longer rests on policy absence alone');

reset role;
-- A version that is STILL a Draft at this point in the run: §A's control activated the fixture's
-- other draft, and its line item is (correctly) frozen by budget_line_items_draft_guard. A first
-- draft of this control asserted against that frozen item and failed for a reason that had nothing
-- to do with the grant under test.
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('01710000-0000-0000-0000-0000000000f6','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000b1',9,'SCC Live Draft','Draft');
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount) values
  ('01710000-0000-0000-0000-0000000000e3','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000f6','Labor','a DRAFT version''s line item — a live capability',50);
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ delete from public.budget_line_items where id = '01710000-0000-0000-0000-0000000000e3' $$,
  'AC-SCC-083 CONTROL budget_line_items DELETE is deliberately NOT revoked: it rides on the FOR ALL budget_line_items_write policy and IS a live capability (the Draft budget editor). The brief that grouped it with the latent grants was wrong — probed live: DELETE 1');
reset role;

-- L3: the three procure-to-pay child tables. 0177 audited their DELETEs and left their creates silent.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select create_procurement_invoice('01710000-0000-0000-0000-0000000000d3'::uuid,
       'Received'::procurement_invoice_status, '2026-03-02'::date, 'VI-REF', 42,
       p_tax_treatment => 'exclusive', p_tax_amount => 0) $$,
  'AC-SCC-084 CONTROL create_procurement_invoice still works end to end (0176 §5''s gate is untouched)');

-- ⚑ FR-RES-060 required every create-path guard to be NULL-TOTAL and this branch was never asserted.
select throws_ok(
  $$ select create_procurement_invoice('01710000-0000-0000-0000-0000000000d3'::uuid,
       null::procurement_invoice_status, '2026-03-02'::date, 'VI-REF', 42) $$,
  'P0001',
  'procurement_invoices.status "<NULL>" is not an origination status: a vendor invoice is recorded as Received or Scheduled, and Paid is reached only by paying it — the case transition that enforces that the approver does not pay their own request',
  'AC-SCC-085 create_procurement_invoice''s `p_status is null` branch reaches the RULE''s message (FR-RES-060 demanded NULL-totality in every create-path guard and this branch shipped unasserted)');
reset role;

select ok(
  exists (select 1 from public.audit_events
           where action = 'procurement_invoice.create'
             and detail ->> 'procurement_id' = '01710000-0000-0000-0000-0000000000d3'),
  'AC-SCC-086 the procure-to-pay child CREATES are audited — 0177 wired AFTER DELETE audits to all five mirror tables and left the create side of these three silent');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- I. AC-CPS-070 — the regression control the class has claimed since slice 2 and never owned.
--    Spec §5 lists it ("Every pre-existing SoD proof still passes") with no owning test anywhere in
--    the repo. This is that owner: each of the five rules is proven by a caller it must REFUSE.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
insert into procurements (id, org_id, title, status, requested_by_id, vendor_id) values
  ('01710000-0000-0000-0000-0000000000d4','01710000-0000-0000-0000-000000000001','SCC SoD case','Requested',
   '01710000-0000-0000-0000-0000000000a1','01710000-0000-0000-0000-0000000000c2');
insert into timesheets (id, org_id, user_id, week_start_date, status, submitted_at) values
  ('01710000-0000-0000-0000-0000000000d5','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000a1','2026-03-16','Submitted',now());
insert into project_documents (id, org_id, project_id, code, category, title, revision, doc_date, author_id, status) values
  ('01710000-0000-0000-0000-0000000000d6','01710000-0000-0000-0000-000000000001','01710000-0000-0000-0000-0000000000b1',
   'DOC-SCC-3','Drawing','Self-approval probe','A','2026-02-01','01710000-0000-0000-0000-0000000000a1','Issued');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select transition_procurement('01710000-0000-0000-0000-0000000000d4'::uuid,'Approved'::procurement_status) $$,
  '42501', 'separation of duties: requester cannot approve/reject own procurement',
  'AC-CPS-070 transition_procurement''s requester-!=-approver SoD still fires');

select throws_ok(
  $$ select transition_procurement('01710000-0000-0000-0000-0000000000d8'::uuid,'Paid'::procurement_status) $$,
  'P0001', 'illegal transition Paid -> Paid',
  'AC-CPS-070 …and its transition map still refuses a re-entry into a terminal state');

select throws_ok(
  $$ select transition_document_status('01710000-0000-0000-0000-0000000000d6'::uuid,'Approved'::doc_status) $$,
  '42501', 'separation of duties: cannot approve or reject your own document',
  'AC-CPS-070 transition_document_status''s approver-!=-author SoD still fires');

select throws_ok(
  $$ select transition_timesheet('01710000-0000-0000-0000-0000000000d5'::uuid,'Approved'::timesheet_status, null) $$,
  '42501', 'separation of duties: cannot approve own timesheet',
  'AC-CPS-070 transition_timesheet''s nobody-approves-their-own SoD still fires (even an Admin cannot)');

reset role;
-- ⚑ b8 (ROW 6: no line manager, peer-PM ratifier -> REFUSED), NOT b5. b5 is deliberately WON earlier
-- by ROW 3, so asserting it here would go red for the right reason and prove nothing about the SoD.
-- It did exactly that on the rank ruling. Pick the deal the rule actually holds back.
select is(
  (select status::text from public.projects where id = '01710000-0000-0000-0000-0000000000b8'),
  'Quotation Submitted',
  'AC-CPS-070 transition_project''s money SoD still holds an un-ratified deal out of Won');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- J. work_orders (0193, #498) — the newest money table, added to the DENOMINATOR of this test.
--    Its own feature proof is supabase/tests/0193_work_orders.test.sql (90 assertions). What belongs
--    HERE is only the four matrix axes, so a future migration that re-grants or re-opens one of them
--    fails in the completeness file rather than only in the feature file it may not think to read.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
insert into projects (id, org_id, name, status, contract_value) values
  ('01710000-0000-0000-0000-0000000000b9','01710000-0000-0000-0000-000000000001','SCC WO Project','Ongoing Project',1000);

-- INSERT axis. `status` is withheld from the column grant, so a client cannot originate an already-
-- Issued work order at the PRIVILEGE layer — before the origination trigger is even reached.
select is(has_column_privilege('authenticated','public.work_orders','status','INSERT'), false,
  'AC-SCC-090 work_orders.status is not client-INSERTable — a work order cannot be born Issued, which would mint client revenue past the entire SoD');

-- UPDATE axis. THE 0014 A2 MECHANIC, and the single thing this file exists to catch: a column-level
-- REVOKE cannot subtract from a table-level GRANT, so the absence of a table grant is load-bearing.
select is(
  (select count(*)::int from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'work_orders'
      and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE','DELETE')),
  0,
  'AC-SCC-091 no client role holds a TABLE-level INSERT/UPDATE/DELETE on work_orders — without this, every column-level narrowing below is a SILENT NO-OP');

select is(has_column_privilege('authenticated','public.work_orders','order_value','UPDATE'), false,
  'AC-SCC-092 work_orders.order_value is not client-UPDATEable — set_work_order_value is its sole writer, exactly as set_project_contract_value is for projects.contract_value');

-- DELETE axis. Closed by BOTH layers, not by policy absence alone (the AC-SCC-082 lesson).
select is(
  (select has_table_privilege('authenticated','public.work_orders','DELETE')::text || '/' ||
          (select count(*)::int from pg_policies
            where schemaname = 'public' and tablename = 'work_orders' and cmd = 'DELETE')::text),
  'false/0',
  'AC-SCC-093 work_orders has neither a client DELETE grant nor a DELETE policy — Cancelled is the soft-delete, and the closure rests on two independent layers');

-- RPC-parameter axis. The whole client write surface for `status` is transition_work_order, so its
-- parameters are the whole attack surface — and its issue gate is the money SoD.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into work_orders (id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('01710000-0000-0000-0000-0000000000e9','01710000-0000-0000-0000-0000000000b9','SCC self-authored WO',100,'exclusive',0);
select throws_ok(
  $$ select transition_work_order('01710000-0000-0000-0000-0000000000e9','Issued') $$,
  '42501',
  'you set this work order''s value yourself, so you cannot also issue it: the value must be confirmed by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it',
  'AC-SCC-094 THE EXPLOIT on the newest money table: a PM sets a work order''s value and issues it alone. Refused.');
reset role;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok(
  $$ select set_work_order_value('01710000-0000-0000-0000-0000000000e9', 100) $$,
  'AC-SCC-095 CONTROL Finance (who outranks a PM) may author the value…');
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_work_order('01710000-0000-0000-0000-0000000000e9','Issued') $$,
  'AC-SCC-095 …and THEN the PM may issue — the gate closes the forgery, not the workflow');
reset role;

select * from finish();
rollback;
