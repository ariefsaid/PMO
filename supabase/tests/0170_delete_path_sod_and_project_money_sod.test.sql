-- 0170_delete_path_sod_and_project_money_sod.test.sql
-- docs/specs/create-path-sod-class.spec.md §9 — slice 5: the DELETE path (PART A) and the `projects`
-- money SoD (PART B). Migration under test: 0177_delete_path_sod_and_project_money_sod.sql.
--
-- ── WHY THERE IS A SLICE 5 ───────────────────────────────────────────────────────────────────────
-- The class is: SoD is enforced on the TRANSITION, so the attacker never transitions — they put the
-- row into (or out of) the protected state by a path the transition does not own. There are THREE
-- such paths. Slices 1-4 closed INSERT and UPDATE; 0175 and 0176 each wrote "STILL OPEN — DELETE"
-- into their own headers and PINNED the vulnerable state in pgTAP (0168 §J AC-UPS-080,
-- 0169 AC-RES-019) rather than fixing it. Those pins are rewritten by this slice — that was the
-- point of writing them.
--
-- ⚑ THE NEW LESSON: a guard on a CHILD table is not a guard if a parent delete CASCADES. Probed live
--   at 0176 as a plain Project Manager:
--     delete from budget_line_items where <owning version is Active>  -> ERROR (the child guard fires)
--     delete from budget_versions   where <that Active version>       -> DELETE 1
--     => line items left 0, audit rows 0.
--   Every ON DELETE CASCADE FK in the schema was enumerated against its child's delete-time guards
--   (spec §9.6, 62 FKs); this suite asserts the two families that enumeration found.
--
-- ── ORACLE DISCIPLINE ────────────────────────────────────────────────────────────────────────────
-- Every denial asserts the errcode AND the exact message. A bare throws_ok(sql,'42501',null) goes
-- green for the WRONG reason the moment another 42501 gate moves in front of the one under test.
--
-- ── NO-OVER-BLOCKING CONTROLS ARE FIRST CLASS ───────────────────────────────────────────────────
-- Every revoke is paired with a proof that the legitimate path still works: deleteDraftVersion's
-- affordance, archiveVersion, activate_budget_version, an Admin's project hard-delete cascading
-- through the new budget guard, the service-role mirror writer on all five mirror tables, and — for
-- PART B — a PM winning a colleague's value, Finance winning their own, a PM winning a zero-value
-- deal, a server-seeded deal, and the whole legitimate pipeline end to end.
begin;
select plan(62);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Fixtures (as postgres — a BYPASSRLS authority, exempt from the guards by design). No JWT claims
-- are in scope here, so auth.uid() is NULL and every project seeded below carries the
-- "set by a server-side authority" witness (NULL actor, non-NULL timestamp) — the shape section F
-- relies on and asserts.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
insert into organizations (id, name) values
  ('01700000-0000-0000-0000-000000000001','DPS Org');

insert into auth.users (id, email) values
  ('01700000-0000-0000-0000-0000000000a1','dps-pm@example.com'),
  ('01700000-0000-0000-0000-0000000000a2','dps-colleague@example.com'),
  ('01700000-0000-0000-0000-0000000000a3','dps-admin@example.com'),
  ('01700000-0000-0000-0000-0000000000a4','dps-finance@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('01700000-0000-0000-0000-0000000000a1','01700000-0000-0000-0000-000000000001','DPS PM','dps-pm@example.com','Project Manager','active'),
  ('01700000-0000-0000-0000-0000000000a2','01700000-0000-0000-0000-000000000001','DPS Colleague','dps-colleague@example.com','Project Manager','active'),
  ('01700000-0000-0000-0000-0000000000a3','01700000-0000-0000-0000-000000000001','DPS Admin','dps-admin@example.com','Admin','active'),
  ('01700000-0000-0000-0000-0000000000a4','01700000-0000-0000-0000-000000000001','DPS Finance','dps-finance@example.com','Finance','active');

insert into companies (id, org_id, name, type) values
  ('01700000-0000-0000-0000-0000000000c1','01700000-0000-0000-0000-000000000001','DPS Customer','Client'),
  ('01700000-0000-0000-0000-0000000000c2','01700000-0000-0000-0000-000000000001','DPS Vendor','Vendor');

insert into projects (id, org_id, name, status) values
  ('01700000-0000-0000-0000-0000000000b1','01700000-0000-0000-0000-000000000001','DPS Project','Internal Project'),
  -- a second project used ONLY by the Admin hard-delete control (it must be free of FK-RESTRICT children)
  ('01700000-0000-0000-0000-0000000000b2','01700000-0000-0000-0000-000000000001','DPS Cascade Project','Internal Project');

-- Budget versions. The line items go in while the version is still Draft — budget_line_items_draft_guard
-- refuses to write them once it is Active, which is precisely the guard the parent delete bypassed.
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('01700000-0000-0000-0000-0000000000f1','01700000-0000-0000-0000-000000000001','01700000-0000-0000-0000-0000000000b1',1,'DPS Active','Draft'),
  ('01700000-0000-0000-0000-0000000000f2','01700000-0000-0000-0000-000000000001','01700000-0000-0000-0000-0000000000b1',2,'DPS Draft','Draft'),
  ('01700000-0000-0000-0000-0000000000f3','01700000-0000-0000-0000-000000000001','01700000-0000-0000-0000-0000000000b1',3,'DPS Archived','Draft'),
  ('01700000-0000-0000-0000-0000000000f4','01700000-0000-0000-0000-000000000001','01700000-0000-0000-0000-0000000000b2',1,'DPS Cascade Active','Draft');

insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount) values
  ('01700000-0000-0000-0000-0000000000e1','01700000-0000-0000-0000-000000000001','01700000-0000-0000-0000-0000000000f1','Labor','the line items the cascade destroyed',1000000);

update budget_versions set status = 'Active',   activated_at = now() where id = '01700000-0000-0000-0000-0000000000f1';
update budget_versions set status = 'Archived'                       where id = '01700000-0000-0000-0000-0000000000f3';
update budget_versions set status = 'Active',   activated_at = now() where id = '01700000-0000-0000-0000-0000000000f4';

-- The five mirror rows, each in a terminal / decision-bearing state.
insert into sales_invoices (tax_treatment, tax_amount, id, org_id, project_id, customer_id, si_number, invoice_date, amount,
                            erp_outstanding_amount, status, erp_docstatus, author_user_id) values
  ('exclusive', 0, '01700000-0000-0000-0000-0000000000d1','01700000-0000-0000-0000-000000000001',
   '01700000-0000-0000-0000-0000000000b1','01700000-0000-0000-0000-0000000000c1',
   'SI-DPS-001','2026-03-02',500.00,0.00,'Paid',1,'01700000-0000-0000-0000-0000000000a2');

-- The append-only authorship set that IS the submit SoD oracle (0132/0133) — ON DELETE CASCADE from
-- sales_invoices, so the parent delete erased it.
insert into sales_invoice_authors (org_id, sales_invoice_id, user_id) values
  ('01700000-0000-0000-0000-000000000001','01700000-0000-0000-0000-0000000000d1','01700000-0000-0000-0000-0000000000a2');

insert into incoming_payments (id, org_id, customer_id, sales_invoice_id, ip_number, date, amount, status, erp_docstatus) values
  ('01700000-0000-0000-0000-0000000000d2','01700000-0000-0000-0000-000000000001',
   '01700000-0000-0000-0000-0000000000c1','01700000-0000-0000-0000-0000000000d1','IP-DPS-001','2026-03-03',500.00,'Paid',1);

insert into procurements (id, org_id, title, status, requested_by_id, vendor_id) values
  ('01700000-0000-0000-0000-0000000000d3','01700000-0000-0000-0000-000000000001','DPS case','Paid',
   '01700000-0000-0000-0000-0000000000a1','01700000-0000-0000-0000-0000000000c2');

insert into procurement_invoices (id, org_id, procurement_id, status, invoice_date, vi_number, amount) values
  ('01700000-0000-0000-0000-0000000000d4','01700000-0000-0000-0000-000000000001','01700000-0000-0000-0000-0000000000d3',
   'Paid','2026-03-02','VI-DPS-001',9999.00);
insert into procurement_receipts (id, org_id, procurement_id, status, receipt_date, gr_number) values
  ('01700000-0000-0000-0000-0000000000d5','01700000-0000-0000-0000-000000000001','01700000-0000-0000-0000-0000000000d3',
   'Complete','2026-03-02','GR-DPS-001');
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, vq_number, total_amount, is_selected, received_date) values
  ('01700000-0000-0000-0000-0000000000d6','01700000-0000-0000-0000-000000000001','01700000-0000-0000-0000-0000000000d3',
   '01700000-0000-0000-0000-0000000000c2','VQ-DPS-001',9999.00,true,'2026-03-01');

-- A file row under that quotation: procurement_quotation_files_delete_admin_only (0058) is a
-- restrictive Admin-only DELETE policy on a child that CASCADES from a parent a non-Admin could
-- delete — the second cascade family.
insert into procurement_quotation_files (id, org_id, quotation_id, title, file_path, uploaded_by_id) values
  ('01700000-0000-0000-0000-0000000000d7','01700000-0000-0000-0000-000000000001','01700000-0000-0000-0000-0000000000d6',
   'DPS quote','dps/quote.pdf','01700000-0000-0000-0000-0000000000a1');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- A. budget_versions — THE CASCADE. The sharpest instance in the whole class.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- The exact probe that returned DELETE 1 at 0176.
select throws_ok(
  $$ delete from public.budget_versions where id = '01700000-0000-0000-0000-0000000000f1' $$,
  '42501',
  'budget_versions."DPS Active" is Active and only an Admin may delete a budget version that is not a Draft: deleting it CASCADES to its line items past budget_line_items_draft_guard, and to the ERPNext budget-push mirror — archive it instead',
  'AC-DPS-010 a PM deleting the ACTIVE budget version is refused, and the message names the cascade it would have driven');

select throws_ok(
  $$ delete from public.budget_versions where id = '01700000-0000-0000-0000-0000000000f3' $$,
  '42501',
  'budget_versions."DPS Archived" is Archived and only an Admin may delete a budget version that is not a Draft: deleting it CASCADES to its line items past budget_line_items_draft_guard, and to the ERPNext budget-push mirror — archive it instead',
  'AC-DPS-010 an ARCHIVED version is protected too — budget HISTORY is not a PM''s to erase');

-- The child guard that the parent delete used to bypass. Asserted here so the suite states BOTH
-- halves of the defect: the child rule, and the fact that the parent can no longer walk around it.
select throws_ok(
  $$ delete from public.budget_line_items where id = '01700000-0000-0000-0000-0000000000e1' $$,
  'P0001',
  'line-items can only change while the owning version is Draft',
  'AC-DPS-011 the CHILD guard still fires directly (this is the rule the parent delete bypassed)');

reset role;
select is(
  (select count(*)::int from public.budget_line_items where id = '01700000-0000-0000-0000-0000000000e1'),
  1,
  'AC-DPS-011 the line item SURVIVED both attempts — the cascade is closed at the parent');

-- ── CONTROLS: the legitimate paths still work ──────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- deleteDraftVersion (src/lib/db/budgets.ts:394) — the ONLY client delete on this table, and the
-- only affordance that reaches it (ProjectBudget.tsx renders "Delete draft" on Draft only).
select lives_ok(
  $$ delete from public.budget_versions where id = '01700000-0000-0000-0000-0000000000f2' $$,
  'AC-DPS-012 CONTROL deleteDraftVersion still works: a PM can delete a DRAFT version');

-- archiveVersion does a direct `update … set status = ''Archived''` — this guard is DELETE-only.
-- ⚑ 0178 RE-SCOPED THIS PIN. It stays green and it stays a CONTROL, but it is no longer "the UPDATE
--   path is untouched": `Active -> Archived` is now the ONLY status edit a client may make. The two
--   edits this assertion used to bless by omission — `-> Active`, and the `Active -> Draft -> edit the
--   line items -> Active` ROUND TRIP that voided budget_line_items_draft_guard entirely — are denied
--   by 0178 §1 and asserted in 0171 §A. Read this line as "archiveVersion still works", nothing wider.
select lives_ok(
  $$ update public.budget_versions set status = 'Archived' where id = '01700000-0000-0000-0000-0000000000f1' $$,
  'AC-DPS-012 CONTROL archiveVersion''s direct UPDATE still works (0178 §1 narrowed the UPDATE path to exactly this one transition)');
-- put it back for the Admin control below
reset role;
update public.budget_versions set status = 'Active' where id = '01700000-0000-0000-0000-0000000000f1';

select is(
  (select (detail ->> 'status') || '/' || (detail ->> 'name') || '/' || actor_id::text
     from public.audit_events
    where action = 'budget_version.delete' and entity_id = '01700000-0000-0000-0000-0000000000f2'),
  'Draft/DPS Draft/01700000-0000-0000-0000-0000000000a1',
  'AC-DPS-013 the draft delete is AUDITED, naming the status, the version and the actor (there was no delete audit on this table at all)');

-- ADR-0019's Admin escape hatch. This is not a softening — it is what keeps an Admin''s project
-- hard-delete (which CASCADES into this trigger) working; see AC-DPS-015.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ delete from public.budget_versions where id = '01700000-0000-0000-0000-0000000000f1' $$,
  'AC-DPS-014 CONTROL an ADMIN may still delete a non-Draft version — ADR-0019''s destructive-delete escape hatch');

-- The Admin''s project hard-delete (projects_delete_admin_only, 0052) cascades into the new guard
-- with the same actor. A flat Draft-only rule would have broken this shipped capability.
select lives_ok(
  $$ delete from public.projects where id = '01700000-0000-0000-0000-0000000000b2' $$,
  'AC-DPS-015 CONTROL an Admin''s project hard-delete still CASCADES through the new guard (its Active budget version goes with it)');

reset role;
select is(
  (select count(*)::int from public.budget_versions where id = '01700000-0000-0000-0000-0000000000f4'),
  0,
  'AC-DPS-015 …and the cascaded version really is gone (the control proves the path, not just the absence of an error)');

select is(
  (select count(*)::int from public.audit_events
     where action = 'budget_version.delete'
       and entity_id in ('01700000-0000-0000-0000-0000000000f1','01700000-0000-0000-0000-0000000000f4')),
  2,
  'AC-DPS-013 the Admin delete AND the cascaded delete are both audited — a cascade is not a silent delete');

-- The ADR-0069 boundary: a BYPASSRLS authority (the e2e teardown / importer / seed path) is exempt.
select ok(
  (select prosrc like '%actor_bypasses_rls()%' from pg_proc where proname = 'assert_budget_version_delete'),
  'AC-DPS-016 the delete guard delegates to the shared actor_bypasses_rls() helper (ADR-0069), so service_role teardown is exempt');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
-- ⚑ 0178: was `throws_ok(…,'42501',null,…)` — a bare errcode, in the very file whose header says
--   "Every denial asserts the errcode AND the exact message. A bare throws_ok(sql,'42501',null) goes
--   green for the WRONG reason the moment another 42501 gate moves in front of the one under test."
--   It did exactly that. The message is now asserted.
select throws_ok(
  $$ delete from public.budget_versions where id = '01700000-0000-0000-0000-0000000000f3' $$,
  '42501',
  'budget_versions."DPS Archived" is Archived and only an Admin may delete a budget version that is not a Draft: deleting it CASCADES to its line items past budget_line_items_draft_guard, and to the ERPNext budget-push mirror — archive it instead',
  'AC-DPS-016 …and the SAME statement is still refused for an RLS-subject PM, by the SAME rule (the exemption is not a hole)');
reset role;
-- A BYPASSRLS authority is exempt: the same non-Draft row it just refused deletes here.
-- ⚑ 0178: the claims MUST be cleared first. `set local request.jwt.claims` survives `reset role` to
--   the end of the transaction, so without this line auth.uid() is still the PM above and
--   is_unattributed_authority() (0178 §0) correctly reports "this statement HAS an actor" — the
--   genuine authority condition is "no actor AND an RLS-bypassing role", which is what makes the
--   guard fire on a client-initiated CASCADE. This is the same claims-leak footgun this file already
--   documents at AC-PMS-019; before 0178 the assertion passed for a partly-wrong reason.
set local request.jwt.claims = '';
select lives_ok(
  $$ delete from public.budget_versions where id = '01700000-0000-0000-0000-0000000000f3' $$,
  'AC-DPS-016 CONTROL an UNATTRIBUTED BYPASSRLS authority (postgres, no JWT actor) deletes the same Archived version — the exemption is real');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- B. The five mirror tables — GRANT TOPOLOGY. The precise oracle: a behavioural throws_ok can be
--    satisfied by any gate; this asserts the exact privilege state the migration owns, so a later
--    migration that re-grants (as 0075 did to 0010) fails HERE with an unambiguous message.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.table_privileges
     where table_schema = 'public' and privilege_type = 'DELETE'
       and grantee in ('authenticated','anon')
       and table_name in ('sales_invoices','incoming_payments','procurement_invoices',
                          'procurement_receipts','procurement_quotations')),
  0,
  'AC-DPS-020 no client role holds DELETE on any of the five mirror tables (0168 AC-UPS-080 and 0169 AC-RES-019 pinned the opposite on purpose — this is the rewrite)');

-- ⚑ 0178 REPLACED A DEAD ASSERTION. This read
--     count(*) from information_schema.column_privileges where privilege_type = 'DELETE'
--   which returns 0 FOREVER: DELETE is a table-level privilege in Postgres and is never recorded per
--   column (the live catalog's column_privileges holds only INSERT / REFERENCES / SELECT / UPDATE).
--   The assertion could not fail, so it proved nothing — the same family as the prosrc-matches-a-
--   comment defect at AC-PMS-021 below. The replacement reads pg_class.relacl directly, which is
--   where a DELETE grant ('d') actually lives, and it WILL fail if any client role regains it.
select is(
  (select coalesce(array_agg(distinct c.relname order by c.relname), array[]::name[])
     from pg_class c, aclexplode(c.relacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('sales_invoices','incoming_payments','procurement_invoices',
                        'procurement_receipts','procurement_quotations')
      and a.privilege_type = 'DELETE'
      and a.grantee::regrole::text in ('authenticated','anon')),
  array[]::name[],
  'AC-DPS-020 and pg_class.relacl — where a DELETE grant actually lives — carries no DELETE for authenticated/anon on any of the five');

select is(
  (select count(*)::int from information_schema.table_privileges
     where table_schema = 'public' and privilege_type = 'DELETE' and grantee = 'service_role'
       and table_name in ('sales_invoices','incoming_payments','procurement_invoices',
                          'procurement_receipts','procurement_quotations')),
  5,
  'AC-DPS-021 CONTROL the service-role mirror writer KEEPS delete on all five — the revoke did not over-reach past the client');

-- ── The probed forgeries, now denied at the privilege check ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ delete from public.sales_invoices where id = '01700000-0000-0000-0000-0000000000d1' $$,
  '42501', 'permission denied for table sales_invoices',
  'AC-DPS-022 a PM erasing a PAID sales-invoice mirror row is denied (0169 AC-RES-019''s pinned exploit)');

select throws_ok(
  $$ delete from public.incoming_payments where id = '01700000-0000-0000-0000-0000000000d2' $$,
  '42501', 'permission denied for table incoming_payments',
  'AC-DPS-022 a PM erasing a PAID incoming payment is denied (the AR twin, un-pinned until now)');

select throws_ok(
  $$ delete from public.procurement_invoices where id = '01700000-0000-0000-0000-0000000000d4' $$,
  '42501', 'permission denied for table procurement_invoices',
  'AC-DPS-022 a PM erasing a PAID vendor invoice is denied (0168 AC-UPS-080 probe 1)');

select throws_ok(
  $$ delete from public.procurement_receipts where id = '01700000-0000-0000-0000-0000000000d5' $$,
  '42501', 'permission denied for table procurement_receipts',
  'AC-DPS-022 a PM erasing a COMPLETE goods receipt — a 3-way-match input — is denied (probe 2)');

select throws_ok(
  $$ delete from public.procurement_quotations where id = '01700000-0000-0000-0000-0000000000d6' $$,
  '42501', 'permission denied for table procurement_quotations',
  'AC-DPS-022 a PM erasing the SELECTED quotation is denied (probe 3)');

reset role;
select is(
  (select count(*)::int from public.sales_invoices        where id = '01700000-0000-0000-0000-0000000000d1')
+ (select count(*)::int from public.incoming_payments     where id = '01700000-0000-0000-0000-0000000000d2')
+ (select count(*)::int from public.procurement_invoices  where id = '01700000-0000-0000-0000-0000000000d4')
+ (select count(*)::int from public.procurement_receipts  where id = '01700000-0000-0000-0000-0000000000d5')
+ (select count(*)::int from public.procurement_quotations where id = '01700000-0000-0000-0000-0000000000d6'),
  5,
  'AC-DPS-022 none of the five rows was destroyed');

-- The two cascade families that ride on those parents.
select is(
  (select count(*)::int from public.sales_invoice_authors
     where sales_invoice_id = '01700000-0000-0000-0000-0000000000d1'),
  1,
  'AC-DPS-023 the sales-invoice AUTHORSHIP set survived — it is ON DELETE CASCADE from sales_invoices and it IS the submit-SoD oracle (0132/0133)');

select is(
  (select count(*)::int from public.procurement_quotation_files
     where quotation_id = '01700000-0000-0000-0000-0000000000d6'),
  1,
  'AC-DPS-023 the quotation FILE row survived — procurement_quotation_files_delete_admin_only (0058) was bypassable from a parent a non-Admin could delete');

-- ── CONTROL: the service-role mirror writer still deletes, and every delete is now audited ──────
set local role service_role;
select lives_ok(
  $$ delete from public.incoming_payments where id = '01700000-0000-0000-0000-0000000000d2' $$,
  'AC-DPS-024 CONTROL the service-role mirror writer can still delete an incoming payment');
select lives_ok(
  $$ delete from public.sales_invoices where id = '01700000-0000-0000-0000-0000000000d1' $$,
  'AC-DPS-024 CONTROL …and a sales invoice (the ERPNext mirror is still authoritative over its own rows)');
select lives_ok(
  $$ delete from public.procurement_invoices where id = '01700000-0000-0000-0000-0000000000d4' $$,
  'AC-DPS-024 CONTROL …and a vendor invoice');
select lives_ok(
  $$ delete from public.procurement_receipts where id = '01700000-0000-0000-0000-0000000000d5' $$,
  'AC-DPS-024 CONTROL …and a goods receipt');
select lives_ok(
  $$ delete from public.procurement_quotations where id = '01700000-0000-0000-0000-0000000000d6' $$,
  'AC-DPS-024 CONTROL …and a quotation');

reset role;
select is(
  (select array_agg(distinct action order by action) from public.audit_events
     where action in ('sales_invoice.delete','incoming_payment.delete','procurement_invoice.delete',
                      'procurement_receipt.delete','procurement_quotation.delete')),
  array['incoming_payment.delete','procurement_invoice.delete','procurement_quotation.delete',
        'procurement_receipt.delete','sales_invoice.delete'],
  'AC-DPS-025 all five deletes are AUDITED — 0076 wired an AFTER DELETE audit to companies and projects only, and none of these five had one');

select is(
  (select (detail ->> 'status') || '/' || (detail ->> 'amount') || '/' || (detail ->> 'si_number')
     from public.audit_events
    where action = 'sales_invoice.delete' and entity_id = '01700000-0000-0000-0000-0000000000d1'),
  'Paid/500.00/SI-DPS-001',
  'AC-DPS-025 the sales-invoice delete audit records WHAT was destroyed (status, amount, ERP document number)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- C. PART B — the projects money SoD. WITNESS COLUMNS: they are witnesses, never inputs.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'projects'
       and grantee in ('authenticated','anon')
       and privilege_type in ('INSERT','UPDATE')
       and column_name in ('contract_value_set_by','contract_value_set_at')),
  0,
  'AC-PMS-010 neither witness column is client-INSERTable or client-UPDATEable — a witness a client can write is not a witness');

select is(
  (select count(*)::int from information_schema.table_privileges
     where table_schema = 'public' and table_name = 'projects'
       and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE')),
  0,
  'AC-PMS-010 …and projects still holds NO table-level INSERT/UPDATE grant, which is WHY a new column is withheld by construction');

select is(
  (select count(*)::int from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'projects'
       and grantee = 'authenticated' and privilege_type = 'INSERT'
       and column_name = 'contract_value'),
  1,
  'AC-PMS-010 CONTROL contract_value itself is STILL insertable — it is the opportunity value and every legitimate create sends it (0173 §3)');

-- ── The witness is stamped truthfully on both writers ──────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.projects (id, org_id, name, status, contract_value) values
  ('01700000-0000-0000-0000-0000000000b3','01700000-0000-0000-0000-000000000001','DPS Self-set deal','Leads',99999999);
reset role;

select is(
  (select contract_value_set_by::text from public.projects where id = '01700000-0000-0000-0000-0000000000b3'),
  '01700000-0000-0000-0000-0000000000a1',
  'AC-PMS-011 the origination INSERT stamps the witness with the calling user');

select ok(
  (select contract_value_set_at is not null from public.projects where id = '01700000-0000-0000-0000-0000000000b3'),
  'AC-PMS-011 …and the witness timestamp with it (the pair is what tells "a user set it" from "the platform set it")');

-- An unrelated header UPDATE must NOT re-stamp: a false authorship is as bad as no authorship.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
update public.projects set name = 'DPS Self-set deal (renamed)' where id = '01700000-0000-0000-0000-0000000000b3';
reset role;
select is(
  (select contract_value_set_by::text from public.projects where id = '01700000-0000-0000-0000-0000000000b3'),
  '01700000-0000-0000-0000-0000000000a1',
  'AC-PMS-012 an unrelated header UPDATE by a DIFFERENT user does not re-stamp the witness');

-- ── THE EXPLOIT, now refused ───────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_project('01700000-0000-0000-0000-0000000000b3'::uuid,'PQ Submitted'::project_status) $$,
  'AC-PMS-013 the PM still moves their own deal UP the pipeline alone — the rule binds on the money, not on the pipeline');
select lives_ok(
  $$ select transition_project('01700000-0000-0000-0000-0000000000b3'::uuid,'Quotation Submitted'::project_status) $$,
  'AC-PMS-013 …and again');

select throws_ok(
  $$ select transition_project('01700000-0000-0000-0000-0000000000b3'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-DPS-1', '2026-03-02'::date) $$,
  '42501',
  'this deal''s contract value was not set by anyone senior to you, so you cannot win it: it must be confirmed by your supervisor or by someone who outranks you, through set_project_contract_value (which records who set it) — or ask them to win the deal',
  'AC-PMS-013 THE EXPLOIT: the PM who set contract_value 99999999 cannot also win the deal (0169 AC-RES-032 pinned this succeeding)');

reset role;
select is(
  (select status::text from public.projects where id = '01700000-0000-0000-0000-0000000000b3'),
  'Quotation Submitted',
  'AC-PMS-013 …and the deal did NOT move to Won');

-- ── CONTROL 1: someone SENIOR set the value → the SAME PM can win it ───────────────────────────
-- ⚑ REWRITTEN BY 0178 (ADR-0070). This control used to have a PEER Project Manager (a2) ratify the
--   value, and asserted "a PM can still win a deal whose value SOMEONE ELSE set". Under 0177's
--   "any second person" rule that passed; under ADR-0070 it is exactly the case the owner ruled
--   OUT — ADR-0019 §1 reserves a WON project's contract value to {Admin, Executive, Finance}, so
--   letting a PM ratify a peer's number achieved in two steps what ADR-0019 forbids in one. The
--   ratifier is now FINANCE (a4), who outranks a Project Manager. The peer-PM case is asserted as a
--   DENIAL in 0171 §G's truth table, where it belongs.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('01700000-0000-0000-0000-0000000000b3'::uuid, 500000) $$,
  'AC-PMS-014 CONTROL a FINANCE user (who outranks a PM) re-sets the value through the SoD-scoped RPC');
reset role;
select is(
  (select contract_value_set_by::text from public.projects where id = '01700000-0000-0000-0000-0000000000b3'),
  '01700000-0000-0000-0000-0000000000a4',
  'AC-PMS-014 …which re-stamps the witness to that senior user (set_project_contract_value populates it truthfully)');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_project('01700000-0000-0000-0000-0000000000b3'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-DPS-1', '2026-03-02'::date) $$,
  'AC-PMS-014 CONTROL and NOW the PM wins it — a PM can still win a deal whose value someone SENIOR TO THEM set');
reset role;
select is(
  (select status::text || ' | ' || contract_value::text from public.projects where id = '01700000-0000-0000-0000-0000000000b3'),
  'Won, Pending KoM | 500000.00',
  'AC-PMS-014 …at the ratified value, not the self-set 99999999');

select is(
  (select (detail ->> 'contract_value') || '/' || (detail ->> 'contract_value_set_by')
     from public.audit_events
    where action = 'project.transition' and entity_id = '01700000-0000-0000-0000-0000000000b3'
      and detail ->> 'to' = 'Won, Pending KoM'),
  '500000.00/01700000-0000-0000-0000-0000000000a4',
  'AC-PMS-015 the transition audit now answers BOTH questions in one read: who set the value, and who turned it into revenue');

-- ── CONTROL 2: a role already trusted with the value may win its own ───────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
insert into public.projects (id, org_id, name, status, contract_value) values
  ('01700000-0000-0000-0000-0000000000b4','01700000-0000-0000-0000-000000000001','DPS Finance deal','Leads',88888);
select lives_ok(
  $$ select transition_project('01700000-0000-0000-0000-0000000000b4'::uuid,'PQ Submitted'::project_status);
     select transition_project('01700000-0000-0000-0000-0000000000b4'::uuid,'Quotation Submitted'::project_status);
     select transition_project('01700000-0000-0000-0000-0000000000b4'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-DPS-2', '2026-03-02'::date) $$,
  'AC-PMS-016 CONTROL a FINANCE user may win their OWN self-set value — RE-JUSTIFIED under ADR-0070: not by an enumerated carve-out, but because Finance HOLDS won-value authority by rank (ADR-0019 §1), so no second person is required of them at all');
reset role;

-- ── CONTROL 3: no money at stake → no second person required ───────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.projects (id, org_id, name, status) values
  ('01700000-0000-0000-0000-0000000000b5','01700000-0000-0000-0000-000000000001','DPS Zero deal','Leads');
select lives_ok(
  $$ select transition_project('01700000-0000-0000-0000-0000000000b5'::uuid,'PQ Submitted'::project_status);
     select transition_project('01700000-0000-0000-0000-0000000000b5'::uuid,'Quotation Submitted'::project_status);
     select transition_project('01700000-0000-0000-0000-0000000000b5'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-DPS-3', '2026-03-02'::date) $$,
  'AC-PMS-017 CONTROL a PM wins their OWN deal at contract_value 0 — the rule is about MONEY, and the common case is untaxed');
reset role;

-- ── FAIL-CLOSED on a NULL witness (the pre-0177 rows that cannot be backfilled) ─────────────────
-- The witness is forced NULL as the table owner to reproduce exactly what a legacy row looks like.
insert into public.projects (id, org_id, name, status, contract_value) values
  ('01700000-0000-0000-0000-0000000000b6','01700000-0000-0000-0000-000000000001','DPS Legacy deal','Negotiation',700000);
update public.projects set contract_value_set_by = null, contract_value_set_at = null
  where id = '01700000-0000-0000-0000-0000000000b6';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select transition_project('01700000-0000-0000-0000-0000000000b6'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-DPS-4', '2026-03-02'::date) $$,
  '42501',
  'this deal''s contract value has no recorded author, so you cannot win it: the value must be set by your supervisor or by someone who outranks you, through set_project_contract_value (which records who set it) — or ask them to win the deal',
  'AC-PMS-018 FAIL-CLOSED a row with NO witness at all (a pre-0177 row) is refused for a PM, with its OWN message — `v_set_by = auth.uid()` would have been NULL and fallen through, which is 0176 §6''s exact defect');
reset role;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ select transition_project('01700000-0000-0000-0000-0000000000b6'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-DPS-4', '2026-03-02'::date) $$,
  'AC-PMS-018 …and an ADMIN can still win that legacy deal — fail-closed is a re-route, not a dead end');
reset role;

-- ── CONTROL 4: a SERVER-seeded row (NULL actor, non-NULL timestamp) is still winnable ──────────
-- This is the shape every seed.sql row, every pgTAP fixture and every service-role import carries:
-- auth.uid() is NULL for a server-side authority, so the witness records "the platform set it" —
-- which is by construction NOT the calling user, so the two-person rule is already satisfied.
select ok(
  (select contract_value_set_by is null and contract_value_set_at is not null
     from public.projects where id = '01700000-0000-0000-0000-0000000000b1'),
  'AC-PMS-019 a row seeded by a server-side authority carries a NULL actor with a NON-NULL timestamp — the two NULLs mean different things, which is why there are two columns');

-- ⚑ `set local request.jwt.claims` survives `reset role` to the end of the transaction, so a fixture
--   inserted here would inherit the LAST test user''s identity and the witness would name them. That
--   would make this control pass for the wrong reason. Clear the claims so auth.uid() is genuinely
--   NULL — the real service-role / seed.sql / importer condition.
set local request.jwt.claims = '';
insert into public.projects (id, org_id, name, status, contract_value) values
  ('01700000-0000-0000-0000-0000000000b7','01700000-0000-0000-0000-000000000001','DPS Seeded deal','Negotiation',400000);
select ok(
  (select contract_value_set_by is null and contract_value_set_at is not null
     from public.projects where id = '01700000-0000-0000-0000-0000000000b7'),
  'AC-PMS-019 …and the fixture really carries that shape (asserted, not assumed — the claims-leak above would have hidden it)');
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_project('01700000-0000-0000-0000-0000000000b7'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-DPS-5', '2026-03-02'::date) $$,
  'AC-PMS-019 CONTROL a PM still wins a server-seeded deal at 400000 — the seed/import path is not blocked');
reset role;

-- ── CONTROL 5: the WHOLE legitimate journey, end to end, AS IT NOW READS ───────────────────────
-- A PM originates a deal at their own estimate, drives it the length of the pipeline alone, a second
-- person ratifies the value, the PM wins it and takes it into delivery. This is the post-0177 shape
-- of the everyday journey: exactly ONE extra act, by exactly one other person, at exactly the moment
-- the estimate becomes revenue.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.projects (id, org_id, name, status, contract_value) values
  ('01700000-0000-0000-0000-0000000000b8','01700000-0000-0000-0000-000000000001','DPS Full journey','Leads',250000);
select lives_ok(
  $$ select transition_project('01700000-0000-0000-0000-0000000000b8'::uuid,'PQ Submitted'::project_status);
     select transition_project('01700000-0000-0000-0000-0000000000b8'::uuid,'Quotation Submitted'::project_status);
     select transition_project('01700000-0000-0000-0000-0000000000b8'::uuid,'Tender Submitted'::project_status);
     select transition_project('01700000-0000-0000-0000-0000000000b8'::uuid,'Negotiation'::project_status) $$,
  'AC-PMS-020 CONTROL the PM drives their own deal the whole length of the pipeline alone — Leads -> PQ -> Quotation -> Tender -> Negotiation');

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
-- ⚑ AT THE SAME FIGURE, deliberately. The ratifier's natural act is to CONFIRM the number the
--   originator proposed, not to change it. A first draft of the witness trigger only stamped when the
--   value actually CHANGED, so this call was a no-op and the legitimate two-person path DEADLOCKED —
--   this control is what caught it. Setting the value to what it already holds is still authorship.
select lives_ok(
  $$ select set_project_contract_value('01700000-0000-0000-0000-0000000000b8'::uuid, 250000) $$,
  'AC-PMS-020 CONTROL an Admin ratifies the value at the SAME figure — the ONE extra act the rule asks for');
reset role;
select is(
  (select contract_value_set_by::text from public.projects where id = '01700000-0000-0000-0000-0000000000b8'),
  '01700000-0000-0000-0000-0000000000a3',
  'AC-PMS-020 …and a same-figure ratification DOES re-stamp the witness (a value comparison here would deadlock the happy path)');

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_project('01700000-0000-0000-0000-0000000000b8'::uuid,'Won, Pending KoM'::project_status,'CPO-DPS-6','2026-03-02'::date);
     select transition_project('01700000-0000-0000-0000-0000000000b8'::uuid,'Ongoing Project'::project_status) $$,
  'AC-PMS-020 CONTROL …and the PM wins it and takes it into delivery');
reset role;
select is(
  (select status::text from public.projects where id = '01700000-0000-0000-0000-0000000000b8'),
  'Ongoing Project',
  'AC-PMS-020 …and lands on Ongoing Project');

-- ── The pre-existing SoD proofs this slice must not have broken ────────────────────────────────
-- ⚑ 0178 REPLACED THREE DEAD ASSERTIONS, and this is the THIRD time this trap has shipped here.
--   These read `prosrc like '%coarse role gate MUST stay%'` / `'%org re-assertion MUST stay%'`.
--   BOTH strings live in transition_project ONLY as `--` SQL COMMENTS. A reviewer deleted the entire
--   role-gate `if` block, kept the comment, re-ran, and got 62/62 GREEN: the assertions this slice
--   wrote to protect its own edit proved the presence of a COMMENT, not of a guard.
--   (Verified: `regexp_replace(prosrc,'--[^\n]*','','g') like '%coarse role gate MUST stay%'` is FALSE.)
--   The brief that produced this file said "strip comments where matching on source". The durable fix
--   is not to strip better — it is to STOP MATCHING ON SOURCE. All three now assert BEHAVIOUR: the
--   gate is proven by a caller it must refuse, which no comment can satisfy.
--   (Wider coverage of the role gate also lives in 0027_project_transition_authz.test.sql; these stay
--   in-file so this suite remains self-contained about the edit it made.)
insert into auth.users (id, email) values ('01700000-0000-0000-0000-0000000000a5','dps-engineer@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('01700000-0000-0000-0000-0000000000a5','01700000-0000-0000-0000-000000000001','DPS Engineer','dps-engineer@example.com','Engineer','active');
insert into organizations (id, name) values ('01700000-0000-0000-0000-000000000002','DPS Other Org');
insert into auth.users (id, email) values ('01700000-0000-0000-0000-0000000000a6','dps-outsider@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('01700000-0000-0000-0000-0000000000a6','01700000-0000-0000-0000-000000000002','DPS Outsider','dps-outsider@example.com','Admin','active');
insert into projects (id, org_id, name, status) values
  ('01700000-0000-0000-0000-0000000000b9','01700000-0000-0000-0000-000000000001','DPS Gate probe','Leads');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok(
  $$ select transition_project('01700000-0000-0000-0000-0000000000b9'::uuid,'PQ Submitted'::project_status) $$,
  '42501', 'not authorized',
  'AC-PMS-021 transition_project still REFUSES a role outside the coarse gate (an Engineer) — the money branch was INSERTED, not substituted');

set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok(
  $$ select transition_project('01700000-0000-0000-0000-0000000000b9'::uuid,'PQ Submitted'::project_status) $$,
  '42501', 'not authorized',
  'AC-PMS-021 …and still REFUSES an Admin of ANOTHER org — the cross-org re-assertion is live (a definer bypasses RLS, so only this check stands between orgs)');

set local request.jwt.claims =
  '{"sub":"01700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select transition_project('01700000-0000-0000-0000-0000000000b9'::uuid,'Ongoing Project'::project_status) $$,
  'P0001', 'illegal transition Leads -> Ongoing Project',
  'AC-PMS-021 …and still REFUSES an off-map transition — the transition-map legality check is live');
reset role;

select * from finish();
rollback;
