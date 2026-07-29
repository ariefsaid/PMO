-- 0168_update_path_sod_class.test.sql
-- docs/specs/create-path-sod-class.spec.md — close the UPDATE half of the same SoD class (slice 3).
-- Migration under test: 0175_update_path_sod_class.sql.
--
-- ── WHY THERE IS A SLICE 3 ───────────────────────────────────────────────────────────────────────
-- Slices 1 (0173) and 2 (0174) closed the INSERT path and declared the class closed. It was not:
-- every forgery 0174's header enumerates was still reachable in TWO requests instead of one, because
-- 0075 handed `authenticated` a column-level UPDATE grant covering exactly the dangerous columns.
-- Demonstrated live against the local DB at 0174, as a plain Project Manager:
--
--     update procurement_invoices   set status='Paid'                    -> UPDATE 1, status = Paid
--     update procurement_receipts   set status='Complete'                -> UPDATE 1, status = Complete
--     update procurement_quotations set is_selected=true, total_amount=1 -> UPDATE 1, is_selected = t
--
-- and as an Engineer:
--
--     update timesheets set approved_by=<self>, approved_at=now()        -> UPDATE 1, forged approver
--
-- `transition_timesheet` Draft->Submitted does not clear `approved_by`, so the forged approver
-- survived into Submitted — i.e. 0174's own trigger message ("the approver is stamped only by
-- transition_timesheet") was false. This file is the proof that it is now true.
--
-- ── ORACLE DISCIPLINE (the trap this repo has shipped twice) ─────────────────────────────────────
-- Every denial below asserts the errcode AND the exact message. A bare `throws_ok(sql,'42501',null)`
-- would go green for the WRONG reason the moment some other 42501 gate moves in front of the one
-- under test. Two of the assertions here exist precisely because that happened elsewhere in this
-- suite (see the erpnext_*_flip_rls.test.sql notes).
--
-- ── NO-OVER-REVOKE CONTROLS ARE FIRST CLASS ─────────────────────────────────────────────────────
-- A blanket revoke that passes the security assertion and breaks the app is a worse outcome than the
-- bug. Section D re-proves every legitimate write path that touches the four tables: the timesheet
-- own-Draft edits, save_timesheet_week, the submit transition, all three create_procurement_* RPCs
-- and select_procurement_quote — including under an ERPNext domain flip, where ADR-0055's PMO
-- enhancement (`procurement_quotations.is_selected`) must stay reachable.
begin;
select plan(41);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Fixtures (as postgres — a BYPASSRLS authority, exempt from the origination guards by design).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
insert into organizations (id, name) values
  ('01680000-0000-0000-0000-000000000001','UPS Org');

insert into auth.users (id, email) values
  ('01680000-0000-0000-0000-0000000000a1','ups-eng@example.com'),
  ('01680000-0000-0000-0000-0000000000a2','ups-pm@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('01680000-0000-0000-0000-0000000000a1','01680000-0000-0000-0000-000000000001','UPS Engineer','ups-eng@example.com','Engineer','active'),
  ('01680000-0000-0000-0000-0000000000a2','01680000-0000-0000-0000-000000000001','UPS PM','ups-pm@example.com','Project Manager','active');

insert into companies (id, org_id, name, type) values
  ('01680000-0000-0000-0000-0000000000c1','01680000-0000-0000-0000-000000000001','UPS Vendor','Vendor');

insert into projects (id, org_id, name, status) values
  ('01680000-0000-0000-0000-0000000000b1','01680000-0000-0000-0000-000000000001','UPS Project','Internal Project');

-- Two procurement cases: d1 carries the forgery targets and the un-flipped RPC controls; d2 is held
-- back at 'Vendor Quoted' for the FLIPPED select_procurement_quote control in section E.
insert into procurements (id, org_id, title, status, vendor_id) values
  ('01680000-0000-0000-0000-0000000000d1','01680000-0000-0000-0000-000000000001','UPS case 1','Vendor Quoted','01680000-0000-0000-0000-0000000000c1'),
  ('01680000-0000-0000-0000-0000000000d2','01680000-0000-0000-0000-000000000001','UPS case 2','Vendor Quoted','01680000-0000-0000-0000-0000000000c1');

insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount) values
  ('01680000-0000-0000-0000-0000000000e1','01680000-0000-0000-0000-000000000001','01680000-0000-0000-0000-0000000000d1','VI-U1','2026-03-02','Received',500);

insert into procurement_receipts (id, org_id, procurement_id, gr_number, receipt_date, status) values
  ('01680000-0000-0000-0000-0000000000e2','01680000-0000-0000-0000-000000000001','01680000-0000-0000-0000-0000000000d1','GR-U1','2026-03-02','Partial');

insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount, received_date, vq_number, is_selected) values
  ('01680000-0000-0000-0000-0000000000e3','01680000-0000-0000-0000-000000000001','01680000-0000-0000-0000-0000000000d1','01680000-0000-0000-0000-0000000000c1',500,'2026-03-01','VQ-U1',false),
  ('01680000-0000-0000-0000-0000000000e4','01680000-0000-0000-0000-000000000001','01680000-0000-0000-0000-0000000000d2','01680000-0000-0000-0000-0000000000c1',700,'2026-03-01','VQ-U2',false);

-- The Engineer's own Draft sheet — the timesheet forgery target and the own-Draft-edit control.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('01680000-0000-0000-0000-0000000000f1','01680000-0000-0000-0000-000000000001','01680000-0000-0000-0000-0000000000a1','2026-03-02','Draft');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- A. GRANT TOPOLOGY — the precise oracle. A behavioural throws_ok can be satisfied by any gate; this
--    asserts the exact privilege state the migration is responsible for, so a later migration that
--    re-grants (as 0075 did to 0010) fails HERE with an unambiguous message.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.table_privileges
     where table_schema = 'public' and grantee in ('authenticated','anon') and privilege_type = 'UPDATE'
       and table_name in ('procurement_invoices','procurement_receipts','procurement_quotations')),
  0,
  'AC-UPS-030 no client role holds a table-level UPDATE on procurement_invoices / _receipts / _quotations');

select is(
  (select count(*)::int from information_schema.column_privileges
     where table_schema = 'public' and grantee in ('authenticated','anon') and privilege_type = 'UPDATE'
       and table_name in ('procurement_invoices','procurement_receipts','procurement_quotations')),
  0,
  'AC-UPS-030 and no column-level UPDATE either — the definer RPCs are now the ONLY client write path');

select is(
  (select count(*)::int from information_schema.table_privileges
     where table_schema = 'public' and grantee in ('authenticated','anon')
       and privilege_type = 'UPDATE' and table_name = 'timesheets'),
  0,
  'AC-UPS-040 the table-wide UPDATE grant on timesheets is gone (a column REVOKE against it is a no-op)');

select is(
  (select array_agg(column_name::text order by column_name) from information_schema.column_privileges
     where table_schema = 'public' and grantee = 'authenticated'
       and privilege_type = 'UPDATE' and table_name = 'timesheets'),
  array['id','org_id','status','submitted_at','user_id','week_start_date'],
  'AC-UPS-040 timesheets re-grants exactly the client-editable columns — approved_by / approved_at withheld');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- B. THE FOUR LIVE PROBES, now denied. Message asserted, not just errcode.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01680000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ update public.procurement_invoices set status = 'Paid'
      where id = '01680000-0000-0000-0000-0000000000e1' $$,
  '42501',
  'permission denied for table procurement_invoices',
  'AC-UPS-030 a PM marking a vendor invoice Paid by direct UPDATE is denied (probe 1)');

select throws_ok(
  $$ update public.procurement_receipts set status = 'Complete'
      where id = '01680000-0000-0000-0000-0000000000e2' $$,
  '42501',
  'permission denied for table procurement_receipts',
  'AC-UPS-030 a PM completing a goods receipt (3-way match input) by direct UPDATE is denied (probe 2)');

select throws_ok(
  $$ update public.procurement_quotations set is_selected = true, total_amount = 1
      where id = '01680000-0000-0000-0000-0000000000e3' $$,
  '42501',
  'permission denied for table procurement_quotations',
  'AC-UPS-030 a PM pre-selecting a quotation AND rewriting its amount by direct UPDATE is denied (probe 3)');

select throws_ok(
  $$ update public.procurement_quotations set is_selected = true
      where id = '01680000-0000-0000-0000-0000000000e3' $$,
  '42501',
  'permission denied for table procurement_quotations',
  'AC-UPS-030 is_selected ALONE is denied too — select_procurement_quote''s stage+role gate cannot be side-stepped');

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01680000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update public.timesheets set approved_by = '01680000-0000-0000-0000-0000000000a1', approved_at = now()
      where id = '01680000-0000-0000-0000-0000000000f1' $$,
  '42501',
  'permission denied for table timesheets',
  'AC-UPS-040 an Engineer stamping themselves as their own approver is denied (probe 4)');

select throws_ok(
  $$ update public.timesheets set approved_by = '01680000-0000-0000-0000-0000000000a1'
      where id = '01680000-0000-0000-0000-0000000000f1' $$,
  '42501',
  'permission denied for table timesheets',
  'AC-UPS-040 approved_by alone is denied');

select throws_ok(
  $$ update public.timesheets set approved_at = now()
      where id = '01680000-0000-0000-0000-0000000000f1' $$,
  '42501',
  'permission denied for table timesheets',
  'AC-UPS-040 approved_at alone is denied (the approval timestamp is a transition artifact too)');

reset role;
select is(
  (select status::text from public.procurement_invoices where id = '01680000-0000-0000-0000-0000000000e1')
  || '/' || (select status::text from public.procurement_receipts where id = '01680000-0000-0000-0000-0000000000e2')
  || '/' || (select is_selected::text from public.procurement_quotations where id = '01680000-0000-0000-0000-0000000000e3')
  || '/' || (select total_amount::text from public.procurement_quotations where id = '01680000-0000-0000-0000-0000000000e3')
  || '/' || (select coalesce(approved_by::text,'null') from public.timesheets where id = '01680000-0000-0000-0000-0000000000f1'),
  'Received/Partial/false/500.00/null',
  'AC-UPS-030/040 none of the four forgeries landed — the rows are byte-for-byte as seeded');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- C. The INSERT-side residual of the SAME column. 0174 guarded `approved_by` at create but not
--    `approved_at`, so the approval timestamp was still forgeable on the create path.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01680000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into public.timesheets (org_id, user_id, week_start_date, status, approved_at)
       values ('01680000-0000-0000-0000-000000000001','01680000-0000-0000-0000-0000000000a1',
               '2026-03-09','Draft', now()) $$,
  'P0001',
  'timesheets.approved_at cannot be set when a timesheet is created: the approval timestamp is stamped only by transition_timesheet, which enforces that nobody approves their own timesheet',
  'AC-UPS-040 a Draft timesheet carrying an approved_at is rejected at create, naming approved_at');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- D. NO-OVER-REVOKE CONTROLS — every legitimate write path still works.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- D1. timesheets: the own-Draft edits the re-granted column list must preserve.
-- A week no other assertion in this file touches, so the control cannot fail for a fixture collision.
select lives_ok(
  $$ update public.timesheets set week_start_date = '2026-04-13'
      where id = '01680000-0000-0000-0000-0000000000f1' $$,
  'AC-UPS-041 CONTROL the owner can still move their own Draft sheet''s week (week_start_date stays granted)');

select lives_ok(
  $$ update public.timesheets set status = 'Draft'
      where id = '01680000-0000-0000-0000-0000000000f1' $$,
  'AC-UPS-041 CONTROL a status write that satisfies timesheets_update_own''s Draft WITH CHECK still works');

-- D2. createDraftTimesheet (src/lib/db/timesheets.ts) — the exact insert shape the DAL sends.
select lives_ok(
  $$ insert into public.timesheets (user_id, week_start_date, status)
       values ('01680000-0000-0000-0000-0000000000a1','2026-03-16','Draft') $$,
  'AC-UPS-041 CONTROL createDraftTimesheet''s insert shape still succeeds');

-- D3. save_timesheet_week (the atomic definer path) resolves-or-creates and lands the cell.
select lives_ok(
  $$ select save_timesheet_week(null, '2026-03-23'::date,
       jsonb_build_array(jsonb_build_object(
         'project_id','01680000-0000-0000-0000-0000000000b1',
         'entry_date','2026-03-24','hours',8,'notes',null)),
       '{}'::uuid[]) $$,
  'AC-UPS-041 CONTROL save_timesheet_week still creates the sheet and writes the entry');

-- D4. the submit transition still works — AND now leaves no forged approver behind, because there is
--     no longer a client path that could have put one there. This is the assertion that makes
--     0174's trigger message ("the approver is stamped only by transition_timesheet") TRUE.
select lives_ok(
  $$ select transition_timesheet('01680000-0000-0000-0000-0000000000f1','Submitted'::timesheet_status) $$,
  'AC-UPS-041 CONTROL transition_timesheet Draft -> Submitted still works');

reset role;
select is(
  (select coalesce(approved_by::text,'null') || '/' || coalesce(approved_at::text,'null') || '/' || status::text
     from public.timesheets where id = '01680000-0000-0000-0000-0000000000f1'),
  'null/null/Submitted',
  'AC-UPS-040 a Submitted sheet carries NO approver — the message on the create guard is now true');

-- D5. the three create_procurement_* RPCs (M-3: the quotation one had no positive control before)
--     and select_procurement_quote still run end to end as their postgres owner.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01680000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select create_procurement_invoice('01680000-0000-0000-0000-0000000000d1'::uuid,
       'Received'::procurement_invoice_status, '2026-03-02'::date, null, 1000::numeric) $$,
  'AC-UPS-031 CONTROL create_procurement_invoice still succeeds end to end');

select lives_ok(
  $$ select create_procurement_receipt('01680000-0000-0000-0000-0000000000d1'::uuid,
       'Complete'::procurement_receipt_status, '2026-03-02'::date, null) $$,
  'AC-UPS-031 CONTROL create_procurement_receipt still succeeds end to end');

select lives_ok(
  $$ select create_procurement_quotation('01680000-0000-0000-0000-0000000000d1'::uuid,
       '01680000-0000-0000-0000-0000000000c1'::uuid, 900::numeric, '2026-03-01'::date) $$,
  'AC-UPS-031 CONTROL create_procurement_quotation still succeeds end to end (M-3, previously unproven)');

reset role;
select is(
  (select count(*)::int from public.procurement_quotations
     where procurement_id = '01680000-0000-0000-0000-0000000000d1'
       and total_amount = 900 and vq_number is not null),
  1,
  'AC-UPS-031 the RPC-created quotation landed WITH a minted vq_number (the sequence still runs)');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01680000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select select_procurement_quote('01680000-0000-0000-0000-0000000000e3'::uuid) $$,
  'AC-UPS-032 CONTROL select_procurement_quote still succeeds — the sanctioned is_selected authority');

reset role;
select is(
  (select is_selected::text from public.procurement_quotations where id = '01680000-0000-0000-0000-0000000000e3')
  || '/' || (select status::text from public.procurements where id = '01680000-0000-0000-0000-0000000000d1')
  || '/' || (select total_value::text from public.procurements where id = '01680000-0000-0000-0000-0000000000d1'),
  'true/Quote Selected/500.00',
  'AC-UPS-032 the RPC set is_selected AND synced the header stage + total in one txn (what the direct UPDATE skipped)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- E. ADR-0055 / FR-ENA-130 Finding 8 — the PMO enhancement stays reachable under an ERPNext flip.
--    erpnext_procurement_flip_rls / erpnext_money_flip_rls used to prove that with a DIRECT
--    `update procurement_quotations set is_selected = true`. That path is gone; the enhancement is
--    not. The intent ("the flip must not take the PMO enhancement away") is re-proven here at the
--    surviving layer: select_procurement_quote is postgres-owned, and the flip's native-mirror guard
--    pins only the ERP-owned columns, so is_selected still moves while the domain is externally owned.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('01680000-0000-0000-0000-000000000001','erpnext','procurement');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01680000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ update public.procurement_quotations set is_selected = true
      where id = '01680000-0000-0000-0000-0000000000e4' $$,
  '42501',
  'permission denied for table procurement_quotations',
  'AC-UPS-033 while flipped, the DIRECT is_selected write is denied by the grant (not by the mirror guard)');

select lives_ok(
  $$ select select_procurement_quote('01680000-0000-0000-0000-0000000000e4'::uuid) $$,
  'AC-UPS-033 while flipped, select_procurement_quote STILL succeeds — ADR-0055''s enhancement is intact');

reset role;
select is(
  (select is_selected from public.procurement_quotations where id = '01680000-0000-0000-0000-0000000000e4'),
  true,
  'AC-UPS-033 and is_selected actually moved under the flip (the mirror guard pins only ERP-owned columns)');

delete from external_domain_ownership where org_id = '01680000-0000-0000-0000-000000000001';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- F. actor_bypasses_rls() hardening (I-4) — the guard predicate every create-path trigger delegates to.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'actor_bypasses_rls'),
  array['search_path=pg_catalog, public'],
  'AC-UPS-050 actor_bypasses_rls resolves pg_catalog FIRST — a public.pg_roles relation cannot shadow the catalog');

select is(
  (select count(distinct r.rolname)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(p.proacl) a
     join pg_roles r on r.oid = a.grantee
    where n.nspname = 'public' and p.proname = 'actor_bypasses_rls'
      and a.privilege_type = 'EXECUTE' and r.rolname in ('authenticated','anon')),
  2,
  'AC-UPS-051 actor_bypasses_rls carries an EXPLICIT execute grant to authenticated + anon (not the default PUBLIC one)');

select is(
  (select rolbypassrls from pg_roles where rolname = current_user),
  true,
  'AC-UPS-052 the fixture role really is BYPASSRLS — the exemption the seeds above depend on is not assumed');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- G. M-2 — one definition of the trust-boundary predicate. 0173 shipped an INLINE copy with different
--    search_path semantics from the shared helper; two things to audit is one too many.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select ok(
  (select prosrc like '%actor_bypasses_rls%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'assert_project_origination_insert'),
  'AC-UPS-053 assert_project_origination_insert delegates to the shared actor_bypasses_rls() helper');

select ok(
  (select prosrc not like '%rolbypassrls%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'assert_project_origination_insert'),
  'AC-UPS-053 and its inline pg_roles copy is gone — there is exactly ONE definition of the predicate');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%rolbypassrls%'
      and p.proname <> 'actor_bypasses_rls'),
  0,
  'AC-UPS-053 no OTHER function carries its own copy of the BYPASSRLS lookup either');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- H. I-3 — audit_events indexes. 0173/0174 turned it from low-volume into one row per create on four
--    tables (bulk imports included); it had only its PK, and audit_events_select filters on org_id.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select has_index('public','audit_events','audit_events_org_created_idx',
  'AC-UPS-060 audit_events has the (org_id, created_at desc) index the RLS-scoped reader needs');

select ok(
  (select indexdef like '%created_at DESC%' from pg_indexes
    where schemaname = 'public' and indexname = 'audit_events_org_created_idx'),
  'AC-UPS-060 and created_at is DESC — the newest-first read is a forward index scan, not a sort');

select has_index('public','audit_events','audit_events_entity_idx',
  'AC-UPS-060 audit_events has an entity_id index (the per-row history lookup)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- I. Regression guard for the LAST slice — the INSERT half must stay closed while the UPDATE half is
--    added. (0167 owns these in depth; this is the cheap "did slice 3 undo slice 2" tripwire.)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01680000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ insert into public.procurement_invoices (org_id, procurement_id, status, amount)
       values ('01680000-0000-0000-0000-000000000001','01680000-0000-0000-0000-0000000000d1','Paid',999) $$,
  '42501',
  'permission denied for table procurement_invoices',
  'AC-UPS-070 slice 2''s INSERT revoke is still in force (this slice did not re-open it)');

select throws_ok(
  $$ insert into public.timesheets (org_id, user_id, week_start_date, status, approved_by)
       values ('01680000-0000-0000-0000-000000000001','01680000-0000-0000-0000-0000000000a2',
               '2026-04-06','Draft','01680000-0000-0000-0000-0000000000a2') $$,
  'P0001',
  'timesheets.approved_by cannot be set when a timesheet is created: the approver is stamped only by transition_timesheet, which enforces that nobody approves their own timesheet',
  'AC-UPS-070 slice 2''s approved_by create guard is still in force and still names the column');

reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- J. DELETE — ⚑ CLOSED BY SLICE 5 (0177). This assertion is the REWRITE the pin below demanded.
--
--    It used to read "AC-UPS-080 STILL OPEN: authenticated retains DELETE on all three child tables"
--    and asserted the count 3, pinning the VULNERABLE state on purpose so that closing it would have
--    to be a deliberate, test-visible act. 0177 revoked DELETE on all three (and on sales_invoices +
--    incoming_payments) with no re-grant, so the claim 0174/0167/the spec all made — that the
--    `create_procurement_*` definer RPCs are the ONLY client write path — is now true for all three
--    of INSERT, UPDATE and DELETE. The denial behaviour, the no-over-blocking controls (the
--    service-role mirror writer keeps its grant) and the new delete audit live in
--    supabase/tests/0170_delete_path_sod_and_project_money_sod.test.sql AC-DPS-020..025.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.table_privileges
     where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'DELETE'
       and table_name in ('procurement_invoices','procurement_receipts','procurement_quotations')),
  0,
  'AC-UPS-080 CLOSED (0177): authenticated holds NO DELETE on the three child tables either — the definer RPCs are now the only client write path on ALL THREE of INSERT, UPDATE and DELETE');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01680000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- The one half of the residual that IS closed, and closed by RLS rather than by a grant: timesheets
-- has no DELETE policy, so the delete matches 0 rows instead of raising. Asserted so a future
-- migration that adds a DELETE policy cannot quietly open a destructive path on approved timesheets.
with d as (
  delete from public.timesheets where id = '01680000-0000-0000-0000-0000000000f1' returning id)
select is(
  (select count(*)::int from d),
  0,
  'AC-UPS-081 timesheets has NO delete policy — a client DELETE matches zero rows (this half is closed)');

reset role;
select * from finish();
rollback;
