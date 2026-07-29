-- 0174_create_path_sod_class.sql — close the create-path SoD hole across the whole class
-- (docs/specs/create-path-sod-class.spec.md; FR-CPS-010/011/020/030/040/060, AC-CPS-010..070).
-- Proven by pgTAP supabase/tests/0167_create_path_sod_class.test.sql (44 assertions).
-- Slice 1 (`projects`) is 0173_project_create_origination_sod.sql; this is slice 2, the other five.
--
-- ── THE CLASS ────────────────────────────────────────────────────────────────────────────────────
-- A workflow's Separation of Duties is enforced on the UPDATE path and inside a security-definer
-- transition RPC. The INSERT path was left open, so an attacker never transitions into the protected
-- state — they create the row ALREADY IN IT. No transition runs, so no SoD check runs and no audit
-- row is written. Every case below was demonstrated live against the local DB at 0173:
--
--   • procurements       (CRITICAL, Engineer-reachable) — procurements_insert (0002) carries no role
--     gate at all while procurements_update (0002/0010) does, and 0075 handed `authenticated` a
--     BLANKET table INSERT. An ENGINEER inserted status='Paid' with requested_by_id = approved_by_id
--     and po_number='PO-FORGED-ENG', leaving 0 audit rows. That defeats BOTH SoD rules in
--     transition_procurement whose own comments call them inviolable ("requester cannot approve/reject
--     own procurement", "approver cannot pay own procurement") and bypasses the
--     next_procurement_doc_number sequence.
--   • project_documents  (HIGH) — a PM inserted status='Approved' with author_id = self, defeating
--     transition_document_status' approver-not-author check (commented "MUST stay — it is the
--     segregation of duties being enforced") and skipping the log_audit that RPC writes.
--   • procurement_invoices / _receipts / _quotations (HIGH) — the grant asymmetry is NOT the defect
--     here: the dangerous columns (.status, .status, .is_selected) are granted on BOTH paths, so
--     narrowing INSERT to match UPDATE would look like a fix and change nothing. The defect is that
--     the create_procurement_* / select_procurement_quote definer RPCs were not the ONLY granted
--     path. A PM forged a Paid invoice (amount 888888, erp_docstatus 1), a Complete goods receipt
--     driving 3-way match, and a pre-selected quotation that never passed select_procurement_quote.
--     ⚑ CORRECTION (0175): this file closed only the INSERT half of that, so all three forgeries
--     stayed reachable in TWO requests instead of one, via the 0010/0075 column-UPDATE grant that
--     covered exactly `.status` / `.status` / `.is_selected`. 0175_update_path_sod_class.sql revokes
--     the UPDATE grant as well; only after it is the "ONLY granted path" claim true.
--     The RLS `NOT domain_externally_owned(...)` guard those policies carry is inert —
--     external_domain_ownership is empty — and a guard that is a no-op until an unrelated table is
--     populated is not a control.
--     ⚑ CORRECTION (0175): the timesheet grants were symmetric but BOTH were too wide. An Engineer
--     could `update timesheets set approved_by=<self>, approved_at=now()` on their own Draft sheet
--     (timesheets_update_own permits it — it pins only org/owner/Draft), and transition_timesheet
--     Draft->Submitted does NOT clear those columns, so the forged approver survived into Submitted.
--     §4's message below ("the approver is stamped only by transition_timesheet") only became true
--     with 0175, which withholds approved_by/approved_at from the UPDATE grant and adds the missing
--     approved_at branch to §4's guard.
--   • timesheets         (MEDIUM, variant B) — grants are SYMMETRIC here; the POLICIES differ.
--     timesheets_update_own pins status='Draft' in both USING and WITH CHECK; timesheets_insert
--     constrains only user_id. An Engineer inserted their own sheet at status='Approved',
--     approved_by = self, defeating transition_timesheet's "even an Admin can never approve their own
--     timesheet... Do not reorder." Materiality is bounded (timesheet_entries_write requires a Draft
--     parent, so the forged sheet carries no hours, and there is no DELETE policy on timesheets), but
--     it is the same class and it is reachable by approved_timesheet_for_push.
--
-- ── SCOPE: WHO IS ENFORCED (identical to 0173, and asserted) ─────────────────────────────────────
-- The guards enforce on roles SUBJECT to RLS (authenticated, anon) and EXEMPT roles that already
-- BYPASS it (postgres / service_role / supabase_admin — `pg_roles.rolbypassrls`), via
-- public.actor_bypasses_rls() below. That sits at exactly the RLS trust boundary: a BYPASSRLS role
-- holds a server-side secret and is an authority, not a client. The demonstrated exploit is an
-- `authenticated` PostgREST request, so this is not a loophole for it.
--
-- Enforcing on BYPASSRLS roles as well would break, with no security benefit:
--   • supabase/seed.sql and the pgTAP fixtures across supabase/tests (procurements at every status,
--     documents at Approved/Issued, timesheets at Submitted/Approved),
--   • pmo-portal/e2e/serial/_tspHelpers.ts (service-role timesheet inserts past Draft),
--   • scripts/import-historical.mjs (service-role; legitimately imports procurements at their
--     terminal status, e.g. Paid, with minted document numbers).
--
-- ── LAYERS ───────────────────────────────────────────────────────────────────────────────────────
-- §2 procurements gets BOTH layers. The grant layer is what a real attacker hits (42501 at the
--   privilege check, before any trigger) and it is the stronger of the two, but its message names
--   nothing; the trigger layer re-catches every withheld column with a message that names it, for any
--   future path that holds the grant. `procurements.status` is withheld too — unlike `projects.status`
--   in 0173, which had to stay insertable because a project has TWO origination statuses to choose
--   between. A purchase request has exactly one ('Draft') and it is the column default, so the column
--   need never be named by a client at all.
-- §3/§4 project_documents and timesheets get the trigger layer only: their `status` MUST stay
--   insertable because createDocumentRevision and createDraftTimesheet both send it explicitly, and a
--   grant cannot express "only this value".
-- §5 the three child tables get the grant layer only, because after the revoke there is no client
--   INSERT path left to trigger-guard — the definer RPCs run as their postgres owner and are
--   unaffected.
--
-- ── WHY THIS BREAKS NO CALLER (verified by reading each one, 2026-07-28) ─────────────────────────
--   • createProcurement (src/lib/db/procurementCrud.ts) never sets approved_by_id or any document
--     number. It DID send a redundant `status: 'Draft'`; that one field is removed in this change
--     because §2's grant withholds the column. The column default is 'Draft', so the behaviour is
--     identical — and its unit test already allowed both shapes.
--   • createProjectDocument (src/lib/db/documents.ts) does not set status at all; createDocumentRevision
--     sets it to 'Draft'. Both are the origination status.
--   • createDraftTimesheet (src/lib/db/timesheets.ts) hardcodes 'Draft' and never sets approved_by;
--     save_timesheet_week (0172) inserts 'Draft' as a postgres-owned definer function.
--   • procurement_invoices / _receipts / _quotations have ZERO direct FE inserts — the app already
--     goes through create_procurement_* / select_procurement_quote, which is why revoking table INSERT
--     is the clean fix rather than a disruptive one. The ERPNext read-model writers
--     (supabase/functions/adapter-dispatch/readModelWriters.ts) write with the service-role client,
--     which holds its own table grants and is untouched.
--
-- ── AUDIT (FR-CPS-060) ───────────────────────────────────────────────────────────────────────────
-- Every INSERT into procurements / project_documents / timesheets now writes an audit_events row via
-- log_audit(), following the 0076 convention exactly (postgres-owned SECURITY DEFINER trigger fn →
-- log_audit; no parallel mechanism). It fires for all roles including service_role/postgres backfills
-- — a create is a create.
--
-- ── OUT OF SCOPE (spec §6) ───────────────────────────────────────────────────────────────────────
-- §1 below WARNS about pre-existing rows that could not have been created under the new rule and does
-- nothing else — no delete, no quarantine, no blocked apply. Disposition is the owner's call
-- (OD-PCS-1, still open from slice 1). Verifying the PRODUCTION catalog for the dblink item is an
-- owner-run check; the test-side fix is in supabase/tests/0163_automation_cap_race.test.sql.
--
-- Reversibility (ADR-0006). ⚑ NOT `supabase db reset` — v0.8.0 is in production and a reset there is
-- destructive and local-only. The manual reverse, statement for statement:
--   drop trigger if exists procurements_origination_guard      on public.procurements;
--   drop trigger if exists procurements_audit_insert           on public.procurements;
--   drop trigger if exists project_documents_origination_guard on public.project_documents;
--   drop trigger if exists project_documents_audit_insert      on public.project_documents;
--   drop trigger if exists timesheets_origination_guard        on public.timesheets;
--   drop trigger if exists timesheets_audit_insert             on public.timesheets;
--   drop function if exists public.assert_procurement_origination_insert();
--   drop function if exists public.assert_project_document_origination_insert();
--   drop function if exists public.assert_timesheet_origination_insert();
--   drop function if exists public.audit_procurement_insert();
--   drop function if exists public.audit_project_document_insert();
--   drop function if exists public.audit_timesheet_insert();
--   -- ⚑ actor_bypasses_rls() is SHARED: 0175 makes 0173's projects guard call it too, so dropping it
--   -- here breaks that guard as well. Drop it only after reversing 0175 (or not at all — it is inert
--   -- once nothing calls it).
--   drop function if exists public.actor_bypasses_rls();
--   -- ⚑ THESE RESTORE THE VULNERABLE STATE. The blanket INSERT grants are the hole §2b/§5 close: they
--   -- re-open the forged Paid procurement / Paid invoice / Complete goods receipt / pre-selected
--   -- quotation described above. Reverse only with that understood.
--   grant insert on public.procurements, public.procurement_invoices, public.procurement_receipts,
--                   public.procurement_quotations to authenticated;
-- ⚑ 0175 supersedes §0's search_path and §4's assert_timesheet_origination_insert() body. Reversing
-- this file does not undo 0175 — reverse 0175 first if that is the intent.

-- ============================================================================
-- 0. The trust boundary, named once. 0173 inlined this lookup; four more copies would make the
-- decision look like an accident, so it becomes one function that the guards and any future slice
-- share.
--
-- SECURITY INVOKER (the SQL default, and load-bearing): `current_user` must be the REAL calling role.
-- Under SECURITY DEFINER it would always read `postgres` and every caller would be exempt, silently.
-- The function needs no elevated privilege — pg_roles is world-readable, so it works as
-- `authenticated`. coalesce(..., false): if current_user is somehow absent from pg_roles the guards
-- ENFORCE (fail-closed) rather than waving the insert through on a NULL.
-- ============================================================================
create or replace function public.actor_bypasses_rls() returns boolean
  language sql stable set search_path = public, pg_catalog as $$
  select coalesce((select rolbypassrls from pg_roles where rolname = current_user), false)
$$;

comment on function public.actor_bypasses_rls() is
  'True when the CURRENT role already bypasses RLS (postgres / service_role / supabase_admin) and is '
  'therefore a server-side authority rather than a client. The create-path SoD guards (0173, 0174) '
  'use it to scope themselves to exactly the RLS trust boundary. Must stay SECURITY INVOKER.';

-- ============================================================================
-- 1. Apply-time visibility for pre-existing violations. WARN ONLY (spec §6 / OD-PCS-1 option a).
--
-- A row's INSERT-time shape cannot be recovered after the fact, so each count uses the one signal the
-- state machine leaves behind and is therefore a LOWER BOUND (a forged row later touched by the RPC
-- is not counted):
--   • procurements      — transition_procurement (0006) sets updated_at = now() on every branch, so a
--                         row past Draft (or carrying a decision artifact) whose updated_at still
--                         equals created_at never went through it.
--   • timesheets        — transition_timesheet stamps submitted_at on the way to Submitted, so a row
--                         past Draft with submitted_at IS NULL never went through it.
--   • project_documents — the table has NO update timestamp and transition_document_status stamps
--                         nothing but `status`, so there is NO signal here at all. The non-Draft count
--                         is reported as CONTEXT only and must not be read as a violation count.
-- ============================================================================
do $$
declare
  v_proc     bigint;
  v_ts       bigint;
  v_doc_ctx  bigint;
begin
  select count(*) into v_proc
    from public.procurements
   where updated_at = created_at
     and (status <> 'Draft'
          or approved_by_id     is not null
          or pr_number          is not null
          or po_number          is not null
          or approval_notes     is not null
          or rejection_notes    is not null
          or vendor_invoiced_at is not null);

  select count(*) into v_ts
    from public.timesheets
   where status <> 'Draft' and submitted_at is null;

  select count(*) into v_doc_ctx
    from public.project_documents
   where status <> 'Draft';

  if v_proc > 0 or v_ts > 0 then
    raise warning
      '0174 create-path SoD: % procurement row(s) and % timesheet row(s) could not have been created '
      'under the new rule (past origination or carrying a decision artifact, and never through their '
      'transition RPC). Both counts are LOWER BOUNDS. Nothing was changed: disposition of pre-existing '
      'rows is an open owner decision (OD-PCS-1).', v_proc, v_ts;
  end if;

  if v_doc_ctx > 0 then
    raise warning
      '0174 create-path SoD: % project_document row(s) are past Draft. project_documents records no '
      'update timestamp, so this is CONTEXT, not a violation count — most of them reached that status '
      'legitimately through transition_document_status and cannot be told apart.', v_doc_ctx;
  end if;
end $$;

-- ============================================================================
-- 2a. procurements — the guard (FR-CPS-010). BEFORE INSERT, SECURITY INVOKER.
--
-- Each branch names ITS OWN column: a single combined message would leave the caller guessing which
-- of the seven was rejected. These branches are defence in depth behind §2b's revoke — a client that
-- does not hold the grant is stopped earlier, with a 42501 that names nothing.
-- ============================================================================
create or replace function public.assert_procurement_origination_insert() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Server-side authority (postgres / service_role / supabase_admin): exempt. See the header.
  if public.actor_bypasses_rls() then
    return new;
  end if;

  if new.status <> 'Draft' then
    raise exception
      'procurements.status "%" is not an origination status: a purchase request is created as a Draft, and every later state is reached only through transition_procurement, which enforces that the requester does not approve and the approver does not pay',
      new.status
      using errcode = 'P0001';
  end if;

  if new.approved_by_id is not null then
    raise exception
      'procurements.approved_by_id cannot be set when a purchase request is created: the approver is stamped only by transition_procurement, which enforces that the requester does not approve their own request'
      using errcode = 'P0001';
  end if;

  if new.po_number is not null then
    raise exception
      'procurements.po_number cannot be set when a purchase request is created: document numbers are minted only by next_procurement_doc_number, called from transition_procurement'
      using errcode = 'P0001';
  end if;

  if new.pr_number is not null then
    raise exception
      'procurements.pr_number cannot be set when a purchase request is created: document numbers are minted only by next_procurement_doc_number, called from transition_procurement'
      using errcode = 'P0001';
  end if;

  if new.approval_notes is not null then
    raise exception
      'procurements.approval_notes cannot be set when a purchase request is created: the approval and rejection decisions are recorded only by transition_procurement'
      using errcode = 'P0001';
  end if;

  if new.rejection_notes is not null then
    raise exception
      'procurements.rejection_notes cannot be set when a purchase request is created: the approval and rejection decisions are recorded only by transition_procurement'
      using errcode = 'P0001';
  end if;

  if new.vendor_invoiced_at is not null then
    raise exception
      'procurements.vendor_invoiced_at cannot be set when a purchase request is created: it is stamped only by transition_procurement'
      using errcode = 'P0001';
  end if;

  return new;
end; $$;

drop trigger if exists procurements_origination_guard on public.procurements;
create trigger procurements_origination_guard
  before insert on public.procurements
  for each row execute function public.assert_procurement_origination_insert();

-- ============================================================================
-- 2b. procurements — the grant layer (FR-CPS-011). Same Postgres semantics as 0008 A6 / 0010: a
-- TABLE-level INSERT grant covers every column and is NOT reduced by a column-level REVOKE, so the
-- table-wide grant must be revoked and re-granted on the narrower list.
--
-- The seven omitted columns become insertable only by a role that bypasses the grant (postgres /
-- service_role) — i.e. by transition_procurement's own security-definer UPDATE, never by a client
-- INSERT. `requested_by_id` STAYS granted: the restrictive procurements_insert_self_requester policy
-- (0051) already pins it to auth.uid(), and createProcurement sends it.
--
-- Snapshot semantics (inherited from 0010, deliberately unchanged): a column added to procurements in
-- a FUTURE migration will NOT be insertable by `authenticated` until that migration grants it
-- explicitly. That is the same forcing function the UPDATE list has had since 0010.
--
-- `anon` is untouched: 0105 revoked its write DML outright, so there is nothing to narrow.
-- ============================================================================
revoke insert on public.procurements from authenticated;
grant insert (id, org_id, code, title, project_id, requested_by_id, total_value, vendor_id,
              created_at, updated_at, import_batch_id, imported_at, import_key)
  on public.procurements to authenticated;

-- ============================================================================
-- 2c. procurements — audit every create (FR-CPS-060). Mirrors 0173 §2b / 0076 §4 exactly: a
-- postgres-owned SECURITY DEFINER trigger fn calling log_audit (granted to no client role), so the
-- trigger body may write to the FORCE-RLS, append-only audit_events. auth.uid() is unaffected by the
-- definer switch and records the acting user (NULL for a service-role/system write, per the
-- audit_events.actor_id contract).
-- ============================================================================
create or replace function public.audit_procurement_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('procurement.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',          new.status::text,
                                              'total_value',     new.total_value,
                                              'requested_by_id', new.requested_by_id));
  return new;
end; $$;

drop trigger if exists procurements_audit_insert on public.procurements;
create trigger procurements_audit_insert
  after insert on public.procurements
  for each row execute function public.audit_procurement_insert();

-- ============================================================================
-- 3. project_documents (FR-CPS-020 + FR-CPS-060).
--
-- Trigger layer ONLY, deliberately: `status` must stay insertable because createDocumentRevision
-- (src/lib/db/documents.ts) sends status='Draft' explicitly, and a grant cannot express "only this
-- value". The origination status IS the column default, so createProjectDocument (which omits status)
-- is unaffected either way.
-- ============================================================================
create or replace function public.assert_project_document_origination_insert() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.actor_bypasses_rls() then
    return new;
  end if;

  if new.status <> 'Draft' then
    raise exception
      'project_documents.status "%" is not the origination status: a document is created as a Draft, and Issued / Approved / Rejected are reached only through transition_document_status, which enforces that nobody approves their own document',
      new.status
      using errcode = 'P0001';
  end if;

  return new;
end; $$;

drop trigger if exists project_documents_origination_guard on public.project_documents;
create trigger project_documents_origination_guard
  before insert on public.project_documents
  for each row execute function public.assert_project_document_origination_insert();

create or replace function public.audit_project_document_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('project_document.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',     new.status::text,
                                              'project_id', new.project_id,
                                              'category',   new.category));
  return new;
end; $$;

drop trigger if exists project_documents_audit_insert on public.project_documents;
create trigger project_documents_audit_insert
  after insert on public.project_documents
  for each row execute function public.audit_project_document_insert();

-- ============================================================================
-- 4. timesheets (FR-CPS-040 + FR-CPS-060) — variant B: the grants were already symmetric, so there is
-- nothing to narrow; the gap was entirely in the policy. timesheets_update_own pins status='Draft' in
-- USING and WITH CHECK, timesheets_insert constrained only user_id. `status` stays insertable because
-- createDraftTimesheet sends it explicitly.
-- ============================================================================
create or replace function public.assert_timesheet_origination_insert() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.actor_bypasses_rls() then
    return new;
  end if;

  if new.status <> 'Draft' then
    raise exception
      'timesheets.status "%" is not the origination status: a timesheet is created as a Draft, and Submitted / Approved / Rejected are reached only through transition_timesheet, which enforces that nobody approves their own timesheet',
      new.status
      using errcode = 'P0001';
  end if;

  if new.approved_by is not null then
    raise exception
      'timesheets.approved_by cannot be set when a timesheet is created: the approver is stamped only by transition_timesheet, which enforces that nobody approves their own timesheet'
      using errcode = 'P0001';
  end if;

  return new;
end; $$;

drop trigger if exists timesheets_origination_guard on public.timesheets;
create trigger timesheets_origination_guard
  before insert on public.timesheets
  for each row execute function public.assert_timesheet_origination_insert();

create or replace function public.audit_timesheet_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('timesheet.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',          new.status::text,
                                              'week_start_date', new.week_start_date,
                                              'user_id',         new.user_id));
  return new;
end; $$;

drop trigger if exists timesheets_audit_insert on public.timesheets;
create trigger timesheets_audit_insert
  after insert on public.timesheets
  for each row execute function public.audit_timesheet_insert();

-- ============================================================================
-- 5. procurement_invoices / _receipts / _quotations (FR-CPS-030) — close the client INSERT path.
--
-- ⚑ CORRECTION. This section originally claimed it left "the definer RPCs as the ONLY write path".
-- It did not: it closed INSERT only, while 0010/0075's column-level UPDATE grant — covering exactly
-- `.status` / `.status` / `.is_selected` — stayed live, so every forgery in the header was still
-- reachable in two requests. 0175_update_path_sod_class.sql revokes UPDATE too, and from 0175 on the
-- RPCs are the only client INSERT and UPDATE path (asserted directly, not inferred, in
-- supabase/tests/0168_update_path_sod_class.test.sql §A). ⚑ NOT the only write path even then:
-- `authenticated` still holds DELETE on all three (0075 grant + a permissive DELETE policy each), so
-- a PM can delete a Paid invoice. Deliberately left open — see 0175's "STILL OPEN — DELETE" block
-- and docs/backlog.md.
--
-- No trigger guard and no re-grant: after the revoke there is no client INSERT path left to guard.
-- create_procurement_invoice / _receipt / _quotation and select_procurement_quote are SECURITY DEFINER
-- owned by postgres, so they retain INSERT after this revoke and keep minting vi_number / gr_number /
-- vq_number through next_procurement_doc_number. The ERPNext read-model writers use the service-role
-- client, which holds its own table grants and is likewise unaffected.
--
-- `anon` had table INSERT from 0075 and lost its write DML in 0105; the revokes below are re-asserted
-- for anon anyway so the state does not depend on reading two migrations.
-- ============================================================================
revoke insert on public.procurement_invoices   from authenticated, anon;
revoke insert on public.procurement_receipts   from authenticated, anon;
revoke insert on public.procurement_quotations from authenticated, anon;
