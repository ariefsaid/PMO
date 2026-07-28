-- 0169_create_path_sod_residuals.test.sql
-- docs/specs/create-path-sod-class.spec.md §Slice 4 — the residuals three reviewers found after
-- slices 1-3 (0173/0174/0175) declared the create-path SoD class closed. Migration under test:
-- 0176_create_path_sod_residuals.sql.
--
-- ── WHY THERE IS A SLICE 4 ───────────────────────────────────────────────────────────────────────
-- The class is: SoD is enforced on the TRANSITION, so the attacker never transitions — they create or
-- edit the row into the protected state by a path the transition does not own. Slices 1-3 closed
-- INSERT then UPDATE on six tables and were each declared complete. Each time the sweep had matched a
-- SHAPE (asymmetric grants / asymmetric policies) rather than the RULE, and missed:
--
--   1. sales_invoices — blanket table INSERT + UPDATE + DELETE to `authenticated`, no origination
--      guard, no create audit. Two distinct forgeries, both probed live at 0175:
--        • a PM inserted status='Paid', amount=777777, si_number='SI-FORGED-001', erp_docstatus=1
--          in ONE statement, with ZERO audit rows;
--        • a Finance user wrote the invoice body directly (naming a colleague as author_user_id and
--          creating NO sales_invoice_authors row) and then CLEARED THEIR OWN SUBMIT through
--          submit_sales_invoice — defeating a rule its own code states as "NOBODY WHO EVER WROTE THE
--          BODY MAY APPROVE".
--   2. project_documents — 0174's guard checked `status` while `author_id` is the actual SoD subject
--      and was freely insertable. Probed: a PM inserts a Draft naming a COLLEAGUE as author, then
--      Issued -> Approved = self-approval in three statements, and the 0174 audit row did not even
--      record author_id.
--   3. projects — `transition_project` writes NO audit row at all, so the moment of elevation to Won
--      is unrecorded. (The contract_value SoD residual is deliberately STILL OPEN; see section E5.)
--   4. budget_versions — same class, untouched: `insert … values (…,'Active', now())` bypassed
--      activate_budget_version's role gate, Draft-only legality and the archive-previous invariant.
--   5. create_procurement_invoice(p_status) accepted 'Paid' with an arbitrary amount — the FE's
--      "N1: Paid is NOT offered here, Mark as Paid is the sole PR->Paid authority" rule was a
--      TypeScript comment in front of a public RPC.
--   6. Three-valued logic: `new.status not in (…)` / `<> 'Draft'` evaluate to NULL for an explicit
--      `status => NULL`, so every guard shipped so far FELL THROUGH and the NOT NULL constraint
--      caught it instead — the wrong error, and an open door the moment any migration relaxes NOT
--      NULL. Same family as `NaN >= 0` being TRUE in Postgres.
--
-- ── ORACLE DISCIPLINE ────────────────────────────────────────────────────────────────────────────
-- Every denial asserts the errcode AND the exact message. A bare throws_ok(sql,'42501',null) goes
-- green for the WRONG reason the moment another 42501 gate moves in front of the one under test —
-- this suite has shipped exactly that twice.
--
-- ── NO-OVER-BLOCKING CONTROLS ARE FIRST CLASS ───────────────────────────────────────────────────
-- Every revoke is paired with a proof that the legitimate path still works: the service-role ERPNext
-- mirror writer, createProjectDocument's two insert shapes, createBudgetVersion, archiveVersion,
-- activate_budget_version, create_procurement_invoice / capture_vendor_invoice, transition_project's
-- win path, and transition_document_status' real SoD.
begin;
select plan(69);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Fixtures (as postgres — a BYPASSRLS authority, exempt from the origination guards by design).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
insert into organizations (id, name) values
  ('01690000-0000-0000-0000-000000000001','RES Org');

insert into auth.users (id, email) values
  ('01690000-0000-0000-0000-0000000000a1','res-pm@example.com'),
  ('01690000-0000-0000-0000-0000000000a2','res-colleague@example.com'),
  ('01690000-0000-0000-0000-0000000000a3','res-eng@example.com'),
  ('01690000-0000-0000-0000-0000000000a4','res-fin@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('01690000-0000-0000-0000-0000000000a1','01690000-0000-0000-0000-000000000001','RES PM','res-pm@example.com','Project Manager','active'),
  ('01690000-0000-0000-0000-0000000000a2','01690000-0000-0000-0000-000000000001','RES Colleague','res-colleague@example.com','Project Manager','active'),
  ('01690000-0000-0000-0000-0000000000a3','01690000-0000-0000-0000-000000000001','RES Engineer','res-eng@example.com','Engineer','active'),
  ('01690000-0000-0000-0000-0000000000a4','01690000-0000-0000-0000-000000000001','RES Finance','res-fin@example.com','Finance','active');

insert into companies (id, org_id, name, type) values
  ('01690000-0000-0000-0000-0000000000c1','01690000-0000-0000-0000-000000000001','RES Customer','Client'),
  ('01690000-0000-0000-0000-0000000000c2','01690000-0000-0000-0000-000000000001','RES Vendor','Vendor');

insert into projects (id, org_id, name, status) values
  ('01690000-0000-0000-0000-0000000000b1','01690000-0000-0000-0000-000000000001','RES Project','Internal Project');

-- A pipeline deal for the transition-audit assertions (section E).
insert into projects (id, org_id, name, status, contract_value) values
  ('01690000-0000-0000-0000-0000000000b2','01690000-0000-0000-0000-000000000001','RES Pipeline Deal','Negotiation',400000);

-- An existing SI mirror row (as the service-role writer would have landed it) — the UPDATE/DELETE
-- forgery targets in section B.
insert into sales_invoices (id, org_id, project_id, customer_id, si_number, invoice_date, amount,
                            erp_outstanding_amount, status, erp_docstatus, author_user_id) values
  ('01690000-0000-0000-0000-0000000000e1','01690000-0000-0000-0000-000000000001',
   '01690000-0000-0000-0000-0000000000b1','01690000-0000-0000-0000-0000000000c1',
   'SI-RES-001','2026-03-02',500.00,500.00,'Unpaid',1,'01690000-0000-0000-0000-0000000000a2');

-- A procurement case at 'Vendor Quoted' for section G.
insert into procurements (id, org_id, title, status, requested_by_id, vendor_id) values
  ('01690000-0000-0000-0000-0000000000d1','01690000-0000-0000-0000-000000000001','RES case','Vendor Quoted',
   '01690000-0000-0000-0000-0000000000a3','01690000-0000-0000-0000-0000000000c2');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- A. sales_invoices — GRANT TOPOLOGY. The precise oracle: a behavioural throws_ok can be satisfied by
--    any gate; this asserts the exact privilege state the migration owns, so a later migration that
--    re-grants (as 0075 did to 0010) fails HERE with an unambiguous message.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.table_privileges
     where table_schema = 'public' and table_name = 'sales_invoices'
       and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE')),
  0,
  'AC-RES-010 no client role holds a TABLE-level INSERT or UPDATE on sales_invoices (a column revoke against one is a no-op)');

select is(
  (select array_agg(column_name::text order by column_name) from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'sales_invoices'
       and grantee = 'authenticated' and privilege_type = 'INSERT'),
  array['amount','created_at','customer_id','id','invoice_date','org_id','project_id','reference_number'],
  'AC-RES-010 the INSERT re-grant is exactly the body columns — status / si_number / author_user_id / erp_* are withheld');

select is(
  (select count(*)::int from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'sales_invoices'
       and grantee in ('authenticated','anon') and privilege_type = 'UPDATE'),
  0,
  'AC-RES-011 no client UPDATE on sales_invoices at all — a direct body rewrite would bypass claim_sales_invoice_author entirely');

select is(
  (select count(*)::int from information_schema.table_privileges
     where table_schema = 'public' and table_name = 'sales_invoice_authors'
       and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE','DELETE')),
  0,
  'AC-RES-012 sales_invoice_authors stays client-unwritable — claim_sales_invoice_author is its only caller-reachable writer');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- B. sales_invoices — THE PROBED FORGERIES, now denied.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into public.sales_invoices (org_id, project_id, si_number, invoice_date, amount, status, erp_docstatus, author_user_id)
       values ('01690000-0000-0000-0000-000000000001','01690000-0000-0000-0000-0000000000b1',
               'SI-FORGED-001','2026-03-02',777777,'Paid',1,'01690000-0000-0000-0000-0000000000a4') $$,
  '42501',
  'permission denied for table sales_invoices',
  'AC-RES-013 the probed one-statement forgery (Paid / 777777 / SI-FORGED-001 / docstatus 1) is denied at the privilege check');

select throws_ok(
  $$ insert into public.sales_invoices (org_id, amount, status)
       values ('01690000-0000-0000-0000-000000000001', 10, 'Paid') $$,
  '42501',
  'permission denied for table sales_invoices',
  'AC-RES-013 naming `status` alone is denied — the submitted/paid states are the ERP mirror''s to write');

select throws_ok(
  $$ insert into public.sales_invoices (org_id, amount, author_user_id)
       values ('01690000-0000-0000-0000-000000000001', 10, '01690000-0000-0000-0000-0000000000a4') $$,
  '42501',
  'permission denied for table sales_invoices',
  'AC-RES-013 naming `author_user_id` alone is denied — authorship is recorded by claim_sales_invoice_author only');

select throws_ok(
  $$ update public.sales_invoices set amount = 1, status = 'Paid',
       author_user_id = '01690000-0000-0000-0000-0000000000a1'
      where id = '01690000-0000-0000-0000-0000000000e1' $$,
  '42501',
  'permission denied for table sales_invoices',
  'AC-RES-014 the UPDATE-path forgery (rewrite the money AND re-point the author) is denied');

select throws_ok(
  $$ update public.sales_invoices set amount = 1
      where id = '01690000-0000-0000-0000-0000000000e1' $$,
  '42501',
  'permission denied for table sales_invoices',
  'AC-RES-014 `amount` alone is denied too — a direct body rewrite never reaches claim_sales_invoice_author''s author record or its clearance check');

reset role;
select is(
  (select status || '/' || amount::text || '/' || si_number || '/' || author_user_id::text
     from public.sales_invoices where id = '01690000-0000-0000-0000-0000000000e1'),
  'Unpaid/500.00/SI-RES-001/01690000-0000-0000-0000-0000000000a2',
  'AC-RES-014 the mirror row is byte-for-byte as seeded — none of the forgeries landed');

-- ── The end-to-end defeat, closed. A client can still originate a native invoice body (the 0123
--    forward-compat seam), but it can no longer carry an author — so submit_sales_invoice FAILS
--    CLOSED on it instead of clearing the very person who wrote it.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a4","role":"authenticated"}';

select lives_ok(
  $$ insert into public.sales_invoices (id, org_id, project_id, customer_id, reference_number, invoice_date, amount)
       values ('01690000-0000-0000-0000-0000000000e2','01690000-0000-0000-0000-000000000001',
               '01690000-0000-0000-0000-0000000000b1','01690000-0000-0000-0000-0000000000c1',
               'REF-RES-2','2026-03-03', 999999) $$,
  'AC-RES-015 CONTROL a native invoice BODY still inserts (the 0123 forward-compat revenue seam is not taken away)');

select throws_ok(
  $$ select submit_sales_invoice('01690000-0000-0000-0000-0000000000e2') $$,
  '42501',
  'sales invoice has no recorded author — SoD cannot be verified',
  'AC-RES-016 the body-writer can no longer clear their OWN submit — an unattributable invoice fails CLOSED');

reset role;
select is(
  (select status || '/' || coalesce(author_user_id::text,'null') || '/' || coalesce(si_number,'null')
     from public.sales_invoices where id = '01690000-0000-0000-0000-0000000000e2'),
  'Draft/null/null',
  'AC-RES-015 the natively-created invoice is a Draft with no author and no ERP number — invisible to revenue (0158 counts Submitted/Unpaid/Paid only)');

-- ── The create is now on the audit trail (it was not).
select is(
  (select count(*)::int from public.audit_events
     where action = 'sales_invoice.create' and entity_id = '01690000-0000-0000-0000-0000000000e2'),
  1,
  'AC-RES-017 exactly one audit_events row was written for the sales-invoice create');

select is(
  (select actor_id::text || '/' || (detail ->> 'status') || '/' || (detail ->> 'amount')
     from public.audit_events
    where action = 'sales_invoice.create' and entity_id = '01690000-0000-0000-0000-0000000000e2'),
  '01690000-0000-0000-0000-0000000000a4/Draft/999999.00',
  'AC-RES-017 the audit row names the acting user, the status and the amount');

-- ── NO-OVER-REVOKE: the service-role ERPNext mirror writer (readModelWriters.ts) is untouched.
set local role service_role;
select lives_ok(
  $$ insert into public.sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount,
                                        erp_outstanding_amount, status, erp_docstatus, erp_modified, author_user_id)
       values ('01690000-0000-0000-0000-0000000000e3','01690000-0000-0000-0000-000000000001',
               '01690000-0000-0000-0000-0000000000c1','SI-MIRROR-1','2026-03-04', 250, 250,
               'Unpaid', 1, '2026-03-04 09:00:00','01690000-0000-0000-0000-0000000000a1') $$,
  'AC-RES-018 CONTROL the service-role mirror writer still lands a full ERP row (status + si_number + erp_* + author)');

select lives_ok(
  $$ update public.sales_invoices set status = 'Paid', erp_outstanding_amount = 0
      where id = '01690000-0000-0000-0000-0000000000e3' $$,
  'AC-RES-018 CONTROL the service-role mirror writer still UPDATES the mirror (the paid-detection write)');

reset role;
select is(
  (select count(*)::int from public.audit_events
     where action = 'sales_invoice.create' and entity_id = '01690000-0000-0000-0000-0000000000e3'),
  1,
  'AC-RES-017 the mirror create is audited too — a create is a create, whoever makes it');

-- ⚑ STILL OPEN — DELETE. `authenticated` keeps a table DELETE grant (0123) plus a permissive DELETE
--   policy, so a plain PM can erase a mirror row (a Paid invoice included) with NO audit row. Left
--   open DELIBERATELY: the right shape is an ADR-0018/ADR-0019 decision (soft-archive vs Admin-only
--   destructive delete vs a definer RPC + audit), exactly as 0175 left the procure-to-pay child
--   tables. This assertion PINS the current, vulnerable state so closing it is a test-visible act.
--   Tracked in docs/backlog.md.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ delete from public.sales_invoices where id = '01690000-0000-0000-0000-0000000000e3' $$,
  'AC-RES-019 STILL OPEN (pinned, not fixed): a PM can DELETE a sales-invoice mirror row — see docs/backlog.md');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- C. project_documents — the guard was on the wrong column. `author_id` is the SoD subject.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into public.project_documents (org_id, project_id, category, title, status, author_id)
       values ('01690000-0000-0000-0000-000000000001','01690000-0000-0000-0000-0000000000b1',
               'Drawing','EXPLOIT FOREIGN AUTHOR','Draft','01690000-0000-0000-0000-0000000000a2') $$,
  '42501',
  'new row violates row-level security policy "project_documents_insert_self_author" for table "project_documents"',
  'AC-RES-020 a PM naming a COLLEAGUE as author_id is denied — the three-statement self-approval starts here');

select throws_ok(
  $$ insert into public.project_documents (org_id, project_id, category, title, status, author_id)
       values ('01690000-0000-0000-0000-000000000001','01690000-0000-0000-0000-0000000000b1',
               'Drawing','EXPLOIT NULL AUTHOR','Draft', null) $$,
  '42501',
  'new row violates row-level security policy "project_documents_insert_self_author" for table "project_documents"',
  'AC-RES-020 an explicit NULL author is denied too — an unattributable document is one the approver-not-author rule cannot judge');

reset role;
select is(
  (select count(*)::int from public.project_documents where title like 'EXPLOIT%'),
  0,
  'AC-RES-020 no forged-authorship document landed');

-- CONTROL: both shapes the DAL actually sends still work.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into public.project_documents (id, org_id, project_id, category, title, status, author_id)
       values ('01690000-0000-0000-0000-0000000000f1','01690000-0000-0000-0000-000000000001',
               '01690000-0000-0000-0000-0000000000b1','Drawing','RES Self-authored','Draft',
               '01690000-0000-0000-0000-0000000000a1') $$,
  'AC-RES-021 CONTROL createProjectDocument / createDocumentRevision (author_id = the current user) still inserts');

select lives_ok(
  $$ insert into public.project_documents (id, project_id, category, title)
       values ('01690000-0000-0000-0000-0000000000f2','01690000-0000-0000-0000-0000000000b1',
               'Specification','RES Author-omitted') $$,
  'AC-RES-021 CONTROL an insert that OMITS author_id still succeeds (the column default stamps the caller — AC-DOC-101''s shape)');

reset role;
select is(
  (select author_id from public.project_documents where id = '01690000-0000-0000-0000-0000000000f2'),
  '01690000-0000-0000-0000-0000000000a1'::uuid,
  'AC-RES-021 and the omitted author_id was server-stamped to the caller (0051''s procurements pattern, mirrored)');

select is(
  (select detail ->> 'author_id' from public.audit_events
     where action = 'project_document.create' and entity_id = '01690000-0000-0000-0000-0000000000f1'),
  '01690000-0000-0000-0000-0000000000a1',
  'AC-RES-022 the create audit row now records author_id — the forgery was not even in the audit detail before');

-- The edit path of the same column.
select is(
  (select count(*)::int from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'project_documents'
       and grantee in ('authenticated','anon') and privilege_type = 'UPDATE'
       and column_name = 'author_id'),
  0,
  'AC-RES-023 author_id is no longer in the client UPDATE grant — it cannot be re-pointed after the insert either');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update public.project_documents set author_id = '01690000-0000-0000-0000-0000000000a2'
      where id = '01690000-0000-0000-0000-0000000000f1' $$,
  '42501',
  'permission denied for table project_documents',
  'AC-RES-023 re-pointing author_id by direct UPDATE is denied');

select lives_ok(
  $$ update public.project_documents set title = 'RES Self-authored (Rev B)', revision = 'B'
      where id = '01690000-0000-0000-0000-0000000000f1' $$,
  'AC-RES-024 CONTROL a metadata edit still works (AC-DOC-102 — no over-revoke)');

-- REGRESSION CONTROL: the real SoD still fires on the real author.
select lives_ok(
  $$ select transition_document_status('01690000-0000-0000-0000-0000000000f1','Issued') $$,
  'AC-RES-025 CONTROL transition_document_status Draft -> Issued still works');

select throws_ok(
  $$ select transition_document_status('01690000-0000-0000-0000-0000000000f1','Approved') $$,
  '42501',
  'separation of duties: cannot approve or reject your own document',
  'AC-RES-025 CONTROL the approver-not-author SoD still fires — and is now unreachable by forging the author');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- D. projects — transition_project now writes the audit row it never wrote. The moment of elevation
--    to Won (and the contract_value riding into it) is recorded.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select transition_project('01690000-0000-0000-0000-0000000000b2'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-RES-1', '2026-03-01'::date) $$,
  'AC-RES-030 CONTROL transition_project still wins a pipeline deal (the sanctioned win path)');

reset role;
select is(
  (select status::text || '/' || customer_contract_ref || '/' || contract_date::text
     from public.projects where id = '01690000-0000-0000-0000-0000000000b2'),
  'Won, Pending KoM/CPO-RES-1/2026-03-01',
  'AC-RES-030 CONTROL the win artifacts were still captured by the state machine');

select is(
  (select count(*)::int from public.audit_events
     where action = 'project.transition' and entity_id = '01690000-0000-0000-0000-0000000000b2'),
  1,
  'AC-RES-031 the transition is now on the audit trail (transition_project wrote NO audit row at all before)');

select is(
  (select actor_id::text || '/' || (detail ->> 'from') || '/' || (detail ->> 'to')
       || '/' || (detail ->> 'contract_value') || '/' || (detail ->> 'customer_contract_ref')
     from public.audit_events
    where action = 'project.transition' and entity_id = '01690000-0000-0000-0000-0000000000b2'),
  '01690000-0000-0000-0000-0000000000a1/Negotiation/Won, Pending KoM/400000.00/CPO-RES-1',
  'AC-RES-031 the audit row names the actor, both states, the contract_value that rode into Won, and the win artifact');

-- ⚑ STILL OPEN — the projects money SoD itself. 0173's header claimed contract_value at INSERT was
--   safe because "the SoD is about the WON value, which transition_project + set_project_contract_value
--   own". transition_project never reads, requires or re-validates contract_value (verified by reading
--   it AND by the probe replayed below), and set_project_contract_value's Admin/Exec/Finance gate binds
--   only once the project is ALREADY on-hand — so the value rides in. 0176 corrects the false claim and
--   adds the audit row above (the detection control); CLOSING it is a product decision (gate the
--   pipeline->Won edge on Admin/Exec/Finance, or require re-approval of the value on win) and is
--   deliberately NOT taken here. This assertion PINS the current, vulnerable state.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ insert into public.projects (id, org_id, name, status, contract_value)
       values ('01690000-0000-0000-0000-0000000000b3','01690000-0000-0000-0000-000000000001',
               'RES Self-won deal','Leads', 99999999) $$,
  'AC-RES-032 STILL OPEN (pinned, not fixed): a PM originates a Lead at contract_value 99999999');
select lives_ok(
  $$ select transition_project('01690000-0000-0000-0000-0000000000b3'::uuid,'PQ Submitted'::project_status) $$,
  'AC-RES-032 STILL OPEN (pinned): …moves it up the pipeline alone…');
select lives_ok(
  $$ select transition_project('01690000-0000-0000-0000-0000000000b3'::uuid,'Quotation Submitted'::project_status) $$,
  'AC-RES-032 STILL OPEN (pinned): …alone…');
select lives_ok(
  $$ select transition_project('01690000-0000-0000-0000-0000000000b3'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-RES-2', '2026-03-02'::date) $$,
  'AC-RES-032 STILL OPEN (pinned): …and wins it alone — no second person ever touched the value');

reset role;
select is(
  (select status::text || ' | ' || contract_value::text
     from public.projects where id = '01690000-0000-0000-0000-0000000000b3'),
  'Won, Pending KoM | 99999999.00',
  'AC-RES-032 STILL OPEN (pinned, not fixed): the money SoD on projects — see docs/backlog.md and 0176 §3');

select is(
  (select (detail ->> 'contract_value')::numeric from public.audit_events
     where action = 'project.transition' and entity_id = '01690000-0000-0000-0000-0000000000b3'
       and detail ->> 'to' = 'Won, Pending KoM'),
  99999999.00::numeric,
  'AC-RES-031 …but the elevation is now RECORDED: the audit row carries the value that rode into Won');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- E. budget_versions — the same class, untouched by slices 1-3.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'budget_versions'
       and grantee in ('authenticated','anon') and privilege_type = 'INSERT'
       and column_name = 'activated_at'),
  0,
  'AC-RES-040 activated_at is not client-insertable — the activation witness is stamped only by activate_budget_version');

select is(
  (select count(*)::int from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'budget_versions'
       and grantee = 'authenticated' and privilege_type = 'INSERT'
       and column_name in ('id','org_id','project_id','version','name','status','created_at')),
  7,
  'AC-RES-040 every column createBudgetVersion sends is still insertable (no over-revoke)');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into public.budget_versions (org_id, project_id, version, name, status)
       values ('01690000-0000-0000-0000-000000000001','01690000-0000-0000-0000-0000000000b1',
               9,'FORGED ACTIVE','Active') $$,
  'P0001',
  'budget_versions.status "Active" is not the origination status: a budget version is created as a Draft, and Active is reached only through activate_budget_version, which archives the previous Active version in the same transaction',
  'AC-RES-041 creating a budget version directly at Active is rejected, naming the rule');

select throws_ok(
  $$ insert into public.budget_versions (org_id, project_id, version, name, status, activated_at)
       values ('01690000-0000-0000-0000-000000000001','01690000-0000-0000-0000-0000000000b1',
               9,'FORGED STAMP','Draft', now()) $$,
  '42501',
  'permission denied for table budget_versions',
  'AC-RES-041 naming activated_at in the INSERT column list is denied at the privilege check (grant layer)');

reset role;
select is(
  (select count(*)::int from public.budget_versions where name like 'FORGED%'),
  0,
  'AC-RES-041 no forged budget version landed');

-- CONTROL: createBudgetVersion + activate_budget_version + archiveVersion all still work.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into public.budget_versions (id, project_id, version, name, status)
       values ('01690000-0000-0000-0000-00000000a001','01690000-0000-0000-0000-0000000000b1',
               1,'RES Draft Budget','Draft') $$,
  'AC-RES-042 CONTROL createBudgetVersion''s exact insert shape still succeeds');

select lives_ok(
  $$ select activate_budget_version('01690000-0000-0000-0000-00000000a001') $$,
  'AC-RES-042 CONTROL activate_budget_version still works end to end (the sanctioned Active authority)');

reset role;
select is(
  (select status::text || '/' || (activated_at is not null)::text
     from public.budget_versions where id = '01690000-0000-0000-0000-00000000a001'),
  'Active/true',
  'AC-RES-042 CONTROL the RPC set Active AND stamped the activation witness the push key derives from');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ update public.budget_versions set status = 'Archived'
      where id = '01690000-0000-0000-0000-00000000a001' $$,
  'AC-RES-042 CONTROL archiveVersion''s direct status UPDATE still works (the guard is INSERT-only)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- F. create_procurement_invoice — the RPC accepted the protected end state as a PARAMETER. Now that
--    0174/0175 made the definer RPCs the sole client write path, their parameters ARE the surface.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select create_procurement_invoice('01690000-0000-0000-0000-0000000000d1'::uuid,
       'Paid'::procurement_invoice_status, '2026-03-02'::date, 'BILL-FORGED', 888888::numeric) $$,
  'P0001',
  'procurement_invoices.status "Paid" is not an origination status: a vendor invoice is recorded as Received or Scheduled, and Paid is reached only by paying it — the case transition that enforces that the approver does not pay their own request',
  'AC-RES-050 the RPC no longer mints a PAID vendor invoice on request, naming the rule');

reset role;
select is(
  (select count(*)::int from public.procurement_invoices where reference_number = 'BILL-FORGED'),
  0,
  'AC-RES-050 no forged Paid invoice landed');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select create_procurement_invoice('01690000-0000-0000-0000-0000000000d1'::uuid,
       'Received'::procurement_invoice_status, '2026-03-02'::date, 'BILL-OK', 1000::numeric) $$,
  'AC-RES-051 CONTROL create_procurement_invoice still records a Received invoice end to end');

select lives_ok(
  $$ select create_procurement_invoice('01690000-0000-0000-0000-0000000000d1'::uuid,
       'Scheduled'::procurement_invoice_status, '2026-03-02'::date, 'BILL-OK-2', 1000::numeric) $$,
  'AC-RES-051 CONTROL Scheduled is an origination status too (RecordCaptureForm offers exactly these two)');

reset role;
select is(
  (select count(*)::int from public.procurement_invoices
     where reference_number in ('BILL-OK','BILL-OK-2') and vi_number is not null),
  2,
  'AC-RES-051 CONTROL both landed WITH a minted vi_number (next_procurement_doc_number still runs)');

-- CONTROL: the atomic capture path (transition + invoice + event in one txn) is unbroken.
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('01690000-0000-0000-0000-0000000000d2','01690000-0000-0000-0000-000000000001','RES capture case','Received',
   '01690000-0000-0000-0000-0000000000a3');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok(
  $$ select capture_vendor_invoice('01690000-0000-0000-0000-0000000000d2'::uuid,
       'Received'::procurement_invoice_status, '2026-03-02'::date, 'CAP-OK', 700::numeric, null) $$,
  'AC-RES-052 CONTROL capture_vendor_invoice (transition + invoice + event, one txn) still succeeds');

-- ⚑ STILL OPEN — the goods-receipt self-attestation. create_procurement_receipt is role-gated to
--   Admin OR PM OR THE REQUESTER, so the Engineer who raised the request can record their own
--   'Complete' delivery. Unlike the invoice case this is NOT a status-origination bug — 'Partial' and
--   'Complete' are both origination values (RecordCaptureForm offers both) — and the requester
--   carve-out is a RATIFIED contract (supabase/tests/0055_authz_hardening.test.sql AC-AUTHZ-007).
--   Narrowing it is a product decision, not a create-path repair. Pinned here so it stays visible.
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ select create_procurement_receipt('01690000-0000-0000-0000-0000000000d1'::uuid,
       'Complete'::procurement_receipt_status, '2026-03-02'::date) $$,
  'AC-RES-053 STILL OPEN (pinned, not fixed): the Engineer REQUESTER can self-attest a Complete goods receipt — see docs/backlog.md');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- G. THREE-VALUED LOGIC — `new.status not in (…)` / `<> 'Draft'` evaluate to NULL for an explicit
--    `status => NULL`, so EVERY guard shipped so far fell through and the NOT NULL constraint caught
--    it (23502) — the wrong error, and a silent opening the moment any migration relaxes NOT NULL.
--    These assertions fail on 0175 with `null value in column "status" … violates not-null constraint`.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into public.projects (org_id, name, status)
       values ('01690000-0000-0000-0000-000000000001','RES null-status project', null) $$,
  'P0001',
  'projects.status "<NULL>" is not an origination status: a project can only be created as a Lead or an Internal Project, and a won project is reached only by winning the deal',
  'AC-RES-060 projects: an explicit NULL status is caught by the GUARD, not by the NOT NULL constraint');

select throws_ok(
  $$ insert into public.project_documents (org_id, project_id, category, title, status, author_id)
       values ('01690000-0000-0000-0000-000000000001','01690000-0000-0000-0000-0000000000b1',
               'Drawing','RES null doc', null, '01690000-0000-0000-0000-0000000000a1') $$,
  'P0001',
  'project_documents.status "<NULL>" is not the origination status: a document is created as a Draft, and Issued / Approved / Rejected are reached only through transition_document_status, which enforces that nobody approves their own document',
  'AC-RES-060 project_documents: an explicit NULL status is caught by the guard');

select throws_ok(
  $$ insert into public.timesheets (org_id, user_id, week_start_date, status)
       values ('01690000-0000-0000-0000-000000000001','01690000-0000-0000-0000-0000000000a1','2026-03-02', null) $$,
  'P0001',
  'timesheets.status "<NULL>" is not the origination status: a timesheet is created as a Draft, and Submitted / Approved / Rejected are reached only through transition_timesheet, which enforces that nobody approves their own timesheet',
  'AC-RES-060 timesheets: an explicit NULL status is caught by the guard');

select throws_ok(
  $$ insert into public.budget_versions (org_id, project_id, version, name, status)
       values ('01690000-0000-0000-0000-000000000001','01690000-0000-0000-0000-0000000000b1', 8,'RES null bv', null) $$,
  'P0001',
  'budget_versions.status "<NULL>" is not the origination status: a budget version is created as a Draft, and Active is reached only through activate_budget_version, which archives the previous Active version in the same transaction',
  'AC-RES-060 budget_versions: an explicit NULL status is caught by the guard');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- H. THE TRIGGER LAYER behind the revokes. `procurements.status` and `sales_invoices.status` are
--    withheld from the INSERT grant, so a client hits 42501 before any trigger — which means the
--    trigger branches for those columns are UNREACHABLE from `authenticated` and would rot unproven.
--    They are the second layer for any FUTURE path that holds the grant, so they are proven here by
--    re-granting IN THIS TRANSACTION (rolled back with everything else) — the 0166 technique.
--    ⚑ Runs LAST: it deliberately mutates privileges.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
reset role;
grant insert (status, si_number, author_user_id, erp_docstatus) on public.sales_invoices to authenticated;
grant insert (status) on public.procurements to authenticated;
grant insert (activated_at) on public.budget_versions to authenticated;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01690000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into public.sales_invoices (org_id, amount, status)
       values ('01690000-0000-0000-0000-000000000001', 5, 'Paid') $$,
  'P0001',
  'sales_invoices.status "Paid" is not the origination status: an invoice is created as a Draft, and Submitted / Unpaid / Paid are reached only through the ERPNext mirror, whose submit is gated by grant_sales_invoice_submit_clearance (nobody who wrote the body may approve it)',
  'AC-RES-070 trigger layer: a non-origination sales-invoice status is rejected, naming the rule');

select throws_ok(
  $$ insert into public.sales_invoices (org_id, amount, si_number)
       values ('01690000-0000-0000-0000-000000000001', 5, 'SI-X') $$,
  'P0001',
  'sales_invoices.si_number cannot be set when a sales invoice is created: the ERP document number is written only by the mirror writer',
  'AC-RES-070 trigger layer: si_number is named by its own branch');

select throws_ok(
  $$ insert into public.sales_invoices (org_id, amount, author_user_id)
       values ('01690000-0000-0000-0000-000000000001', 5, '01690000-0000-0000-0000-0000000000a1') $$,
  'P0001',
  'sales_invoices.author_user_id cannot be set when a sales invoice is created: authorship is recorded only by claim_sales_invoice_author, which is what the submit SoD reads',
  'AC-RES-070 trigger layer: author_user_id is named by its own branch — the column the whole submit SoD turns on');

select throws_ok(
  $$ insert into public.sales_invoices (org_id, amount, erp_docstatus)
       values ('01690000-0000-0000-0000-000000000001', 5, 1) $$,
  'P0001',
  'sales_invoices.erp_docstatus cannot be set when a sales invoice is created: the ERP feed columns are written only by the mirror writer',
  'AC-RES-070 trigger layer: erp_docstatus is named by its own branch');

select throws_ok(
  $$ insert into public.sales_invoices (org_id, amount, status)
       values ('01690000-0000-0000-0000-000000000001', 5, null) $$,
  'P0001',
  'sales_invoices.status "<NULL>" is not the origination status: an invoice is created as a Draft, and Submitted / Unpaid / Paid are reached only through the ERPNext mirror, whose submit is gated by grant_sales_invoice_submit_clearance (nobody who wrote the body may approve it)',
  'AC-RES-060 sales_invoices: an explicit NULL status is caught by the guard');

select throws_ok(
  $$ insert into public.procurements (org_id, title, status)
       values ('01690000-0000-0000-0000-000000000001','RES null proc', null) $$,
  'P0001',
  'procurements.status "<NULL>" is not an origination status: a purchase request is created as a Draft, and every later state is reached only through transition_procurement, which enforces that the requester does not approve and the approver does not pay',
  'AC-RES-060 procurements: an explicit NULL status is caught by the guard');

select throws_ok(
  $$ insert into public.budget_versions (org_id, project_id, version, name, status, activated_at)
       values ('01690000-0000-0000-0000-000000000001','01690000-0000-0000-0000-0000000000b1',
               7,'RES stamped draft','Draft', now()) $$,
  'P0001',
  'budget_versions.activated_at cannot be set when a budget version is created: the activation witness is stamped only by activate_budget_version, and the ERPNext budget push key is derived from it',
  'AC-RES-070 trigger layer: activated_at is named by its own branch');

-- The trust boundary the whole class rests on stays exactly where it was put.
reset role;
select is(
  (select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'actor_bypasses_rls'),
  array['search_path=pg_catalog, public'],
  'AC-RES-071 actor_bypasses_rls is unchanged — one definition of the trust boundary (ADR-0069)');

select * from finish();
rollback;
