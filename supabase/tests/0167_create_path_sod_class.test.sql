-- 0167_create_path_sod_class.test.sql
-- docs/specs/create-path-sod-class.spec.md — close the create-path SoD hole across the whole class
-- (slice 2). Slice 1 (`projects`) is proven by 0166_project_create_sod.test.sql; this file proves the
-- remaining five tables plus the dblink hygiene item.
--
-- ── THE CLASS ────────────────────────────────────────────────────────────────────────────────────
-- A workflow's Separation-of-Duties is enforced on the UPDATE path and inside a security-definer
-- transition RPC. The INSERT path was left open, so an attacker never transitions into the protected
-- state — they create the row ALREADY IN IT. No transition runs, so no SoD check runs and no audit
-- row is written. Every probe below was demonstrated live against the local DB at 0173 before the fix
-- (spec §2): an Engineer created a `Paid`, self-approved procurement with a forged `po_number` and
-- left 0 audit rows; a PM created a self-authored `Approved` document; a PM forged a `Paid` invoice,
-- a `Complete` goods receipt and a pre-selected quotation; an Engineer created their own `Approved`
-- timesheet.
--
-- ── SCOPE OF THE GUARDS (deliberate, and asserted below) ─────────────────────────────────────────
-- Exactly as 0173/0166: the guards enforce on roles SUBJECT to RLS (authenticated, anon) and EXEMPT
-- roles that already bypass it (postgres / service_role / supabase_admin — `pg_roles.rolbypassrls`),
-- via public.actor_bypasses_rls(). That is the RLS trust boundary: a BYPASSRLS role holds a
-- server-side secret and is an authority, not a client; the demonstrated exploit is an
-- `authenticated` PostgREST request. Enforcing on BYPASSRLS roles would break supabase/seed.sql, the
-- pgTAP fixtures across this suite, pmo-portal/e2e/serial/_tspHelpers.ts (service-role timesheet
-- inserts at 'Submitted'/'Approved') and scripts/import-historical.mjs (service-role import of
-- historical procurements at their terminal status). Assertions 26-28 pin the exemption so it stays a
-- decision rather than an accident.
--
-- ── TWO LAYERS, BOTH ASSERTED ────────────────────────────────────────────────────────────────────
-- For `procurements` the withheld columns are stopped by the GRANT layer (42501, before any trigger
-- runs) — that is what a real attacker hits, and its message names nothing. The trigger layer is
-- proven separately by re-granting INSERT inside this transaction (undone by the closing rollback),
-- so the named messages can be asserted independently of the privilege check that would mask them.
begin;
select plan(44);

-- ── Fixtures: one org, an Engineer, a PM, an Admin, a vendor, a project, a parent procurement ────
insert into organizations (id, name) values
  ('01670000-0000-0000-0000-000000000001','CPS Org');

insert into auth.users (id, email) values
  ('01670000-0000-0000-0000-0000000000a1','cps-eng@example.com'),
  ('01670000-0000-0000-0000-0000000000a2','cps-pm@example.com'),
  ('01670000-0000-0000-0000-0000000000a3','cps-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('01670000-0000-0000-0000-0000000000a1','01670000-0000-0000-0000-000000000001',
   'CPS Engineer','cps-eng@example.com','Engineer','active'),
  ('01670000-0000-0000-0000-0000000000a2','01670000-0000-0000-0000-000000000001',
   'CPS PM','cps-pm@example.com','Project Manager','active'),
  ('01670000-0000-0000-0000-0000000000a3','01670000-0000-0000-0000-000000000001',
   'CPS Admin','cps-admin@example.com','Admin','active');

insert into companies (id, org_id, name, type) values
  ('01670000-0000-0000-0000-0000000000c1','01670000-0000-0000-0000-000000000001','CPS Vendor','Vendor');

insert into projects (id, org_id, name, status, client_id) values
  ('01670000-0000-0000-0000-0000000000b1','01670000-0000-0000-0000-000000000001',
   'CPS Project','Leads','01670000-0000-0000-0000-0000000000c1');

-- Parent procurement for the three child tables. Created as postgres (BYPASSRLS) at 'Ordered' so the
-- create_procurement_* RPCs' own stage gates are satisfied by the AC-CPS-031 control below.
insert into procurements (id, org_id, title, status, requested_by_id, total_value) values
  ('01670000-0000-0000-0000-0000000000d1','01670000-0000-0000-0000-000000000001',
   'CPS Parent PR','Ordered','01670000-0000-0000-0000-0000000000a2', 50000);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-CPS-013 (FR-CPS-011) — the GRANT layer on `procurements`. Runs FIRST, before the deliberate
-- in-transaction re-grant further down.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'procurements'
       and grantee = 'authenticated' and privilege_type = 'INSERT'
       and column_name in ('status','approved_by_id','approval_notes','rejection_notes',
                           'po_number','pr_number','vendor_invoiced_at')),
  0,
  'AC-CPS-013 authenticated holds NO INSERT privilege on any of the seven state/decision columns of procurements');

-- No-over-revoke control: every column createProcurement() and the bulk importer actually send must
-- still be insertable. A blanket `revoke insert on procurements from authenticated` passes the
-- assertion above and fails this one.
select is(
  (select count(*)::int from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'procurements'
       and grantee = 'authenticated' and privilege_type = 'INSERT'
       and column_name in ('title','project_id','vendor_id','requested_by_id','total_value',
                           'code','import_key','import_batch_id','imported_at')),
  9,
  'AC-CPS-013 authenticated still holds INSERT on the nine columns a legitimate PR create sends (no over-revoke)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-CPS-010 (FR-CPS-010) — the demonstrated Critical exploit (spec §2.1), as an ENGINEER.
-- Grant layer: naming status / approved_by_id / po_number is denied at the privilege check.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01670000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into public.procurements (org_id, title, status, requested_by_id, approved_by_id, po_number, total_value)
       values ('01670000-0000-0000-0000-000000000001','EXPLOIT ENG PAID','Paid',
               '01670000-0000-0000-0000-0000000000a1','01670000-0000-0000-0000-0000000000a1',
               'PO-FORGED-ENG', 500000) $$,
  '42501',
  'permission denied for table procurements',
  'AC-CPS-010 an Engineer creating a Paid, self-approved procurement with a forged po_number is denied at the privilege check');

reset role;
select is(
  (select count(*)::int from public.procurements where title = 'EXPLOIT ENG PAID'),
  0,
  'AC-CPS-010 no forged Paid procurement row landed');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-CPS-011 — a PM is rejected identically: the rule is structural, not a role gate.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01670000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ insert into public.procurements (org_id, title, status, requested_by_id)
       values ('01670000-0000-0000-0000-000000000001','EXPLOIT PM APPROVED','Approved',
               '01670000-0000-0000-0000-0000000000a2') $$,
  '42501',
  'permission denied for table procurements',
  'AC-CPS-011 a PM creating a procurement directly at Approved is denied too');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-CPS-012 — NO OVER-BLOCKING. An ENGINEER (the lowest write role) must still be able to raise a
-- purchase request: procurements_insert has always been open to any active member on purpose
-- (0015's requester widening; createProcurement's own contract says "ANY member incl. Engineer may
-- raise"). A role gate on the INSERT path would pass every assertion above and fail here.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01670000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into public.procurements (id, org_id, title, requested_by_id, project_id, vendor_id, total_value)
       values ('01670000-0000-0000-0000-0000000000d2','01670000-0000-0000-0000-000000000001',
               'CPS Legitimate PR','01670000-0000-0000-0000-0000000000a1',
               '01670000-0000-0000-0000-0000000000b1','01670000-0000-0000-0000-0000000000c1', 1200) $$,
  'AC-CPS-012 an Engineer can still raise a purchase request (the origination create is untouched)');

reset role;
select is(
  (select status::text from public.procurements where id = '01670000-0000-0000-0000-0000000000d2'),
  'Draft',
  'AC-CPS-012 the new PR landed at the origination status Draft (from the column default)');

select is(
  (select approved_by_id from public.procurements where id = '01670000-0000-0000-0000-0000000000d2'),
  null::uuid,
  'AC-CPS-012 the new PR has no approver');

-- AC-CPS-060 — the procurement create is now on the audit trail.
select is(
  (select count(*)::int from public.audit_events
     where action = 'procurement.create' and entity_id = '01670000-0000-0000-0000-0000000000d2'),
  1,
  'AC-CPS-060 exactly one audit_events row was written for the procurement create');

select is(
  (select actor_id from public.audit_events
     where action = 'procurement.create' and entity_id = '01670000-0000-0000-0000-0000000000d2'),
  '01670000-0000-0000-0000-0000000000a1'::uuid,
  'AC-CPS-060 the procurement audit row names the acting Engineer');

select is(
  (select detail ->> 'status' from public.audit_events
     where action = 'procurement.create' and entity_id = '01670000-0000-0000-0000-0000000000d2'),
  'Draft',
  'AC-CPS-060 the procurement audit row records the origination status');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-CPS-020 (FR-CPS-020) — project_documents. `status` stays GRANTED here (createDocumentRevision
-- legitimately sends status='Draft'), so the trigger is the only layer and it must name the rule.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01670000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ insert into public.project_documents (org_id, project_id, category, title, status, author_id)
       values ('01670000-0000-0000-0000-000000000001','01670000-0000-0000-0000-0000000000b1',
               'Drawing','EXPLOIT SELF-APPROVED DOC','Approved','01670000-0000-0000-0000-0000000000a2') $$,
  'P0001',
  'project_documents.status "Approved" is not the origination status: a document is created as a Draft, and Issued / Approved / Rejected are reached only through transition_document_status, which enforces that nobody approves their own document',
  'AC-CPS-020 a PM creating a self-authored Approved document is rejected, naming the rule');

reset role;
select is(
  (select count(*)::int from public.project_documents where title = 'EXPLOIT SELF-APPROVED DOC'),
  0,
  'AC-CPS-020 no forged Approved document row landed');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-CPS-021 — NO OVER-BLOCKING: a Draft document still inserts, EXPLICIT status included (this is
-- exactly what createDocumentRevision sends), and it is audited.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01670000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ insert into public.project_documents (id, org_id, project_id, category, title, status, author_id)
       values ('01670000-0000-0000-0000-0000000000e1','01670000-0000-0000-0000-000000000001',
               '01670000-0000-0000-0000-0000000000b1','Drawing','CPS Legitimate Doc','Draft',
               '01670000-0000-0000-0000-0000000000a2') $$,
  'AC-CPS-021 a Draft document with an EXPLICIT status still inserts (createDocumentRevision sends it)');

reset role;
select is(
  (select count(*)::int from public.audit_events
     where action = 'project_document.create' and entity_id = '01670000-0000-0000-0000-0000000000e1'),
  1,
  'AC-CPS-060 exactly one audit_events row was written for the document create');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-CPS-030 (FR-CPS-030) — the three child tables. The grant asymmetry was NOT the defect: the
-- dangerous columns are granted on both paths, so narrowing INSERT to match UPDATE would change
-- nothing. The defect is that the create_procurement_* / select_procurement_quote definer RPCs were
-- not the ONLY granted path. Table INSERT is revoked from `authenticated` outright.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.table_privileges
     where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'INSERT'
       and table_name in ('procurement_invoices','procurement_receipts','procurement_quotations')),
  0,
  'AC-CPS-030 authenticated holds NO table-level INSERT on procurement_invoices / _receipts / _quotations');

select is(
  (select count(*)::int from information_schema.column_privileges
     where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'INSERT'
       and table_name in ('procurement_invoices','procurement_receipts','procurement_quotations')),
  0,
  'AC-CPS-030 and no column-level INSERT either (a column REVOKE against a table grant is a no-op)');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01670000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ insert into public.procurement_invoices (org_id, procurement_id, status, amount, erp_docstatus, vi_number)
       values ('01670000-0000-0000-0000-000000000001','01670000-0000-0000-0000-0000000000d1',
               'Paid', 888888, 1, 'VI-FORGED') $$,
  '42501',
  'permission denied for table procurement_invoices',
  'AC-CPS-030 a PM forging a Paid invoice straight into the table is denied');

select throws_ok(
  $$ insert into public.procurement_receipts (org_id, procurement_id, status, gr_number)
       values ('01670000-0000-0000-0000-000000000001','01670000-0000-0000-0000-0000000000d1',
               'Complete','GR-FORGED') $$,
  '42501',
  'permission denied for table procurement_receipts',
  'AC-CPS-030 a PM forging a Complete goods receipt straight into the table is denied');

select throws_ok(
  $$ insert into public.procurement_quotations (org_id, procurement_id, vendor_id, total_amount, is_selected, vq_number)
       values ('01670000-0000-0000-0000-000000000001','01670000-0000-0000-0000-0000000000d1',
               '01670000-0000-0000-0000-0000000000c1', 12345, true, 'VQ-FORGED') $$,
  '42501',
  'permission denied for table procurement_quotations',
  'AC-CPS-030 a PM forging a pre-selected quotation straight into the table is denied');

reset role;
select is(
  (select count(*)::int from public.procurement_invoices where vi_number = 'VI-FORGED')
  + (select count(*)::int from public.procurement_receipts where gr_number = 'GR-FORGED')
  + (select count(*)::int from public.procurement_quotations where vq_number = 'VQ-FORGED'),
  0,
  'AC-CPS-030 none of the three forged child rows landed');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-CPS-031 — THE CONTROL that catches an over-broad revoke: the sanctioned definer RPCs still work
-- end to end. They run as their postgres owner, so the revoke above does not reach them.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01670000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select create_procurement_invoice('01670000-0000-0000-0000-0000000000d1'::uuid,
       'Received'::procurement_invoice_status, current_date, null, 1000::numeric) $$,
  'AC-CPS-031 create_procurement_invoice still succeeds end to end (the sanctioned write path)');

select lives_ok(
  $$ select create_procurement_receipt('01670000-0000-0000-0000-0000000000d1'::uuid,
       'Complete'::procurement_receipt_status, current_date, null) $$,
  'AC-CPS-031 create_procurement_receipt still succeeds end to end');

reset role;
select is(
  (select count(*)::int from public.procurement_invoices
     where procurement_id = '01670000-0000-0000-0000-0000000000d1' and vi_number is not null),
  1,
  'AC-CPS-031 the RPC-created invoice landed WITH a minted vi_number (the sequence still runs)');

select is(
  (select count(*)::int from public.procurement_receipts
     where procurement_id = '01670000-0000-0000-0000-0000000000d1' and gr_number is not null),
  1,
  'AC-CPS-031 the RPC-created receipt landed WITH a minted gr_number');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-CPS-040 (FR-CPS-040) — timesheets, variant B: the grants were symmetric, the POLICIES were not.
-- timesheets_update_own pins status='Draft' in USING and WITH CHECK; timesheets_insert constrained
-- only user_id. `status` stays granted (createDraftTimesheet sends it), so the trigger names the rule.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01670000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into public.timesheets (org_id, user_id, week_start_date, status, approved_by, approved_at)
       values ('01670000-0000-0000-0000-000000000001','01670000-0000-0000-0000-0000000000a1',
               '2026-03-02','Approved','01670000-0000-0000-0000-0000000000a1', now()) $$,
  'P0001',
  'timesheets.status "Approved" is not the origination status: a timesheet is created as a Draft, and Submitted / Approved / Rejected are reached only through transition_timesheet, which enforces that nobody approves their own timesheet',
  'AC-CPS-040 an Engineer creating their own already-Approved timesheet is rejected, naming the rule');

select throws_ok(
  $$ insert into public.timesheets (org_id, user_id, week_start_date, status, approved_by)
       values ('01670000-0000-0000-0000-000000000001','01670000-0000-0000-0000-0000000000a1',
               '2026-03-09','Draft','01670000-0000-0000-0000-0000000000a1') $$,
  'P0001',
  'timesheets.approved_by cannot be set when a timesheet is created: the approver is stamped only by transition_timesheet, which enforces that nobody approves their own timesheet',
  'AC-CPS-040 a Draft timesheet carrying an approved_by is rejected too, naming approved_by');

reset role;
select is(
  (select count(*)::int from public.timesheets
     where user_id = '01670000-0000-0000-0000-0000000000a1'),
  0,
  'AC-CPS-040 no forged timesheet row landed');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-CPS-041 — NO OVER-BLOCKING: a Draft sheet still inserts, and save_timesheet_week still works
-- end to end (it creates its own Draft sheet through the definer RPC).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01670000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into public.timesheets (id, org_id, user_id, week_start_date, status)
       values ('01670000-0000-0000-0000-0000000000f1','01670000-0000-0000-0000-000000000001',
               '01670000-0000-0000-0000-0000000000a1','2026-03-16','Draft') $$,
  'AC-CPS-041 a Draft timesheet with an EXPLICIT status still inserts (createDraftTimesheet sends it)');

select lives_ok(
  $$ select save_timesheet_week(null::uuid, '2026-03-23'::date) $$,
  'AC-CPS-041 save_timesheet_week still creates its Draft sheet end to end');

reset role;
select is(
  (select count(*)::int from public.timesheets
     where user_id = '01670000-0000-0000-0000-0000000000a1' and status = 'Draft'),
  2,
  'AC-CPS-041 both legitimate Draft sheets landed');

select is(
  (select count(*)::int from public.audit_events
     where action = 'timesheet.create' and entity_id = '01670000-0000-0000-0000-0000000000f1'),
  1,
  'AC-CPS-060 exactly one audit_events row was written for the timesheet create');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- The TRIGGER layer on `procurements`, isolated. Defence in depth: even WITH the INSERT grant
-- restored, the trigger stops each state/decision column and NAMES it. The grant below is DDL inside
-- this test transaction and is undone by the closing rollback; it exists so the trigger can be proven
-- independently of the privilege check that masks it above (whose 42501 names no column at all).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
grant insert (status, approved_by_id, approval_notes, rejection_notes, po_number, pr_number,
              vendor_invoiced_at) on public.procurements to authenticated;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01670000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into public.procurements (org_id, title, status, requested_by_id)
       values ('01670000-0000-0000-0000-000000000001','CPS forged Paid','Paid',
               '01670000-0000-0000-0000-0000000000a1') $$,
  'P0001',
  'procurements.status "Paid" is not an origination status: a purchase request is created as a Draft, and every later state is reached only through transition_procurement, which enforces that the requester does not approve and the approver does not pay',
  'AC-CPS-010 the trigger rejects a non-Draft status at INSERT, naming the origination rule');

select throws_ok(
  $$ insert into public.procurements (org_id, title, requested_by_id, approved_by_id)
       values ('01670000-0000-0000-0000-000000000001','CPS forged approver',
               '01670000-0000-0000-0000-0000000000a1','01670000-0000-0000-0000-0000000000a1') $$,
  'P0001',
  'procurements.approved_by_id cannot be set when a purchase request is created: the approver is stamped only by transition_procurement, which enforces that the requester does not approve their own request',
  'AC-CPS-010 the trigger rejects a non-NULL approved_by_id at INSERT, naming approved_by_id');

select throws_ok(
  $$ insert into public.procurements (org_id, title, requested_by_id, po_number)
       values ('01670000-0000-0000-0000-000000000001','CPS forged PO',
               '01670000-0000-0000-0000-0000000000a1','PO-FORGED-ENG') $$,
  'P0001',
  'procurements.po_number cannot be set when a purchase request is created: document numbers are minted only by next_procurement_doc_number, called from transition_procurement',
  'AC-CPS-010 the trigger rejects a supplied po_number at INSERT, naming po_number');

select throws_ok(
  $$ insert into public.procurements (org_id, title, requested_by_id, pr_number)
       values ('01670000-0000-0000-0000-000000000001','CPS forged PR',
               '01670000-0000-0000-0000-0000000000a1','PR-FORGED-ENG') $$,
  'P0001',
  'procurements.pr_number cannot be set when a purchase request is created: document numbers are minted only by next_procurement_doc_number, called from transition_procurement',
  'AC-CPS-010 the trigger rejects a supplied pr_number at INSERT, naming pr_number');

select throws_ok(
  $$ insert into public.procurements (org_id, title, requested_by_id, approval_notes)
       values ('01670000-0000-0000-0000-000000000001','CPS forged approval notes',
               '01670000-0000-0000-0000-0000000000a1','looks fine to me') $$,
  'P0001',
  'procurements.approval_notes cannot be set when a purchase request is created: the approval and rejection decisions are recorded only by transition_procurement',
  'AC-CPS-010 the trigger rejects supplied approval_notes at INSERT, naming approval_notes');

select throws_ok(
  $$ insert into public.procurements (org_id, title, requested_by_id, rejection_notes)
       values ('01670000-0000-0000-0000-000000000001','CPS forged rejection notes',
               '01670000-0000-0000-0000-0000000000a1','no budget') $$,
  'P0001',
  'procurements.rejection_notes cannot be set when a purchase request is created: the approval and rejection decisions are recorded only by transition_procurement',
  'AC-CPS-010 the trigger rejects supplied rejection_notes at INSERT, naming rejection_notes');

select throws_ok(
  $$ insert into public.procurements (org_id, title, requested_by_id, vendor_invoiced_at)
       values ('01670000-0000-0000-0000-000000000001','CPS forged vendor invoice date',
               '01670000-0000-0000-0000-0000000000a1', now()) $$,
  'P0001',
  'procurements.vendor_invoiced_at cannot be set when a purchase request is created: it is stamped only by transition_procurement',
  'AC-CPS-010 the trigger rejects a supplied vendor_invoiced_at at INSERT, naming vendor_invoiced_at');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Scoping control (see header): a BYPASSRLS server-side authority is EXEMPT on all three guarded
-- tables. service_role is how the e2e seed helpers, the historical importer and every edge function
-- write, and they legitimately create rows past origination.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
reset role;
set local role service_role;

select lives_ok(
  $$ insert into public.procurements (org_id, title, status, requested_by_id, po_number, approved_by_id)
       values ('01670000-0000-0000-0000-000000000001','CPS service-role historical import','Paid',
               '01670000-0000-0000-0000-0000000000a2','PO-HIST-1','01670000-0000-0000-0000-0000000000a3') $$,
  'service_role (a BYPASSRLS server-side authority) may still import a terminal-state procurement');

select lives_ok(
  $$ insert into public.project_documents (org_id, project_id, category, title, status, author_id)
       values ('01670000-0000-0000-0000-000000000001','01670000-0000-0000-0000-0000000000b1',
               'Drawing','CPS service-role doc','Approved','01670000-0000-0000-0000-0000000000a2') $$,
  'service_role may still create a non-origination project document');

select lives_ok(
  $$ insert into public.timesheets (org_id, user_id, week_start_date, status, approved_by)
       values ('01670000-0000-0000-0000-000000000001','01670000-0000-0000-0000-0000000000a2',
               '2026-03-30','Approved','01670000-0000-0000-0000-0000000000a3') $$,
  'service_role may still seed an Approved timesheet (pmo-portal/e2e/serial/_tspHelpers.ts does exactly this)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-CPS-050 (FR-CPS-050) — a test shall not permanently mutate the shared database.
-- 0163_automation_cap_race.test.sql creates `dblink` in `public` BEFORE its own `begin` (so that
-- dblink_exec is still defined for its post-rollback cleanup), and the DDL survived the test: on the
-- shared dev DB dblink sat in `public` with EXECUTE to `anon` and `authenticated`, created by no
-- migration. This file is numbered ABOVE 0163 so pg_prove runs it AFTER — the oracle is only
-- meaningful in that order.
--
-- Escalation via dblink was probed and blocked (dblink's own password_required check refuses a
-- passwordless loopback for a non-superuser), so this is hygiene rather than a live hole — but a test
-- that leaves DDL behind is its own defect.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
reset role;
select is(
  (select count(*)::int from pg_extension e join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'dblink' and n.nspname = 'public'),
  0,
  'AC-CPS-050 dblink is not left installed in public after the suite has run 0163');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'dblink%'
       and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'AC-CPS-050 no dblink function in public is EXECUTE-able by anon');

select * from finish();
rollback;
