-- 0017_doc_sod_delete_audit_hardening.sql — server-side hardening for the CRUD+RBAC integration round:
--   (1) transition_document_status RPC: the SOLE writer of project_documents.status, re-asserting
--       org + role + the legal status map + the approver≠author SoD (previously FE-only — a DAL comment
--       FALSELY claimed the DB backstopped it).
--   (2) Delete-gating consistency: Admin-only hard-DELETE on project_documents + incident_reports
--       (restrictive policies mirroring 0013 companies_delete_admin_only). incident_reports had NO
--       DELETE policy at all (the FE Delete affordance was a silent no-op).
--   (3) 0016 task column-pin: also reject Engineer changes to created_at.
--   (4) incident_reports.reported_by audit stamp: a BEFORE INSERT trigger defaulting it to auth.uid()
--       (it was never populated — an audit/repudiation gap + a false "server-resolved" DAL claim).
--
-- ACL discipline mirrors 0006/0007/0014/0015 + ADR-0011/0012/0019: the RPC does `revoke all from public`,
-- `grant execute to authenticated`, `revoke execute from anon`; it is SECURITY DEFINER, pins
-- search_path = public, and RE-ASSERTS auth_org_id()/auth_role()/SoD INTERNALLY because definer rights
-- bypass RLS. Table refs inside definer functions are schema-qualified (LOW-BV-1). Calls
-- auth_org_id()/auth_role() from 0002_rls.sql.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Forward-only/additive. Manual rollback:
--   drop trigger  if exists incident_reports_stamp_reporter on incident_reports;
--   drop function if exists stamp_incident_reporter();
--   drop policy   if exists incident_reports_delete_admin_only on incident_reports;
--   drop policy   if exists project_documents_delete_admin_only on project_documents;
--   drop function if exists transition_document_status(uuid, doc_status);
--   revoke update on project_documents from authenticated;
--   grant  update on project_documents to authenticated;

-- ============================================================================
-- A1 — transition_document_status: the SOLE writer of project_documents.status.
-- Re-asserts (a) tenant org, (b) the master-data write-role gate, (c) the legal status map
-- Draft → Issued → Approved/Rejected → Closed, and (d) the approver≠author SoD: the actor who
-- moves a document to Approved or Rejected may NOT be its author. Mirrors set_project_contract_value
-- (0014) / select_procurement_quote (0015): security-definer, pinned search_path, internal re-assertion.
-- ============================================================================
create or replace function transition_document_status(p_doc_id uuid, p_to doc_status)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from   doc_status;
  v_org    uuid;
  v_author uuid;
  v_uid    uuid      := auth.uid();
  v_role   user_role := auth_role();
  -- The legal status map (config seam, mirrored by the FE DocumentsTab). Draft → Issued → either
  -- Approved or Rejected → Closed; Rejected may also reopen to Draft for rework. Terminal: Closed.
  v_legal jsonb := jsonb_build_object(
    'Draft',    jsonb_build_array('Issued'),
    'Issued',   jsonb_build_array('Approved','Rejected'),
    'Approved', jsonb_build_array('Closed'),
    'Rejected', jsonb_build_array('Draft','Closed'),
    'Closed',   jsonb_build_array()
  );
begin
  -- Load + lock the row (serializes concurrent transitions on the SAME document). P0002 if absent.
  select status, org_id, author_id
    into v_from, v_org, v_author
    from public.project_documents where id = p_doc_id for update;
  if v_from is null then
    raise exception 'document not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation: proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Role gate: only the master-data write-roles move a document's workflow.
  -- SECURITY: this role gate MUST stay — removing it lets any authenticated user transition a document.
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to transition this document' using errcode = '42501';
  end if;

  -- Status-map legality: (from,to) must be in the data map, else P0001.
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal document transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- approver≠author SoD (the gap this migration closes): the actor approving/rejecting a document may
  -- not be its author. Ordered like the timesheet SoD — even an Admin cannot self-approve their own
  -- document. SECURITY: this MUST stay — it is the segregation of duties being enforced.
  if p_to in ('Approved','Rejected') and v_uid is not distinct from v_author then
    raise exception 'separation of duties: cannot approve or reject your own document'
      using errcode = '42501';
  end if;

  update public.project_documents
    set status = p_to
  where id = p_doc_id;
end; $$;
revoke all     on function transition_document_status(uuid, doc_status) from public;
grant  execute on function transition_document_status(uuid, doc_status) to   authenticated;
revoke execute on function transition_document_status(uuid, doc_status) from anon;

-- ============================================================================
-- A2 — Remove status from the direct-UPDATE grant on project_documents so the RPC is the sole writer.
-- 0002 granted table-wide UPDATE via project_documents_write FOR ALL. To make the status workflow
-- RPC-only (the SoD authority), revoke the table-wide UPDATE and re-grant the explicit column list
-- MINUS `status` — identical to the 0014 contract_value lockdown. A direct
-- `update project_documents set status = …` by a write-role is then denied (42501); the RPC remains
-- the only path. This is a column PRIVILEGE change, NOT an RLS change: project_documents_write still
-- gates org + role + parent-org on the row for the remaining (metadata) columns.
-- ============================================================================
revoke update on project_documents from authenticated;
grant  update (id, org_id, project_id, code, category, title, revision, doc_date, author_id,
               file_path, created_at)
  on project_documents to authenticated;

-- ============================================================================
-- A3 — project_documents hard-DELETE → Admin-only (restrictive, mirrors 0013 companies_delete_admin_only).
-- project_documents_write is FOR ALL (covers DELETE for all four write-roles); the FE gates delete to
-- Admin. Add a RESTRICTIVE DELETE policy requiring Admin so the server enforces it too. AND-combined
-- with the permissive write policy → DELETE = (org + 4-role) AND (Admin) = Admin only; INSERT/UPDATE/
-- SELECT unaffected.
-- ============================================================================
create policy project_documents_delete_admin_only on project_documents
  as restrictive
  for delete
  using (auth_role() = 'Admin');

-- ============================================================================
-- A4 — incident_reports hard-DELETE → Admin-only. incident_reports had NO DELETE policy, so RLS
-- denied DELETE to EVERYONE silently (0-row no-op) and the FE Delete affordance never worked. Add a
-- PERMISSIVE Admin DELETE policy so the affordance functions for an Admin (org-scoped) — there is no
-- existing FOR ALL policy on this table (insert/update are separate), so a permissive policy is the
-- correct construct here (unlike companies/documents where a FOR ALL policy must be narrowed by a
-- restrictive one). org guard rides on the USING so a cross-org Admin still cannot delete.
-- ============================================================================
create policy incident_reports_delete_admin_only on incident_reports
  for delete
  using (org_id = auth_org_id() and auth_role() = 'Admin');

-- ============================================================================
-- A5 — extend the 0016 task column pin to also reject Engineer changes to created_at. A non-write-role
-- (Engineer reaching the row via tasks_update_own_status) may change status and NOTHING else;
-- created_at was not pinned, leaving an audit field mutable by the assignee. `is distinct from` is
-- null-safe. Managers (the four write-roles) remain exempt (gated by tasks_write).
-- ============================================================================
create or replace function enforce_assignee_status_only()
  returns trigger language plpgsql set search_path = public as $$
begin
  -- Structure write-roles keep full edit rights (gated by tasks_write); only pin the others.
  if auth_role() in ('Admin','Executive','Project Manager','Finance') then
    return new;
  end if;
  -- A non-write-role (Engineer via tasks_update_own_status) may change status and nothing else.
  if new.name        is distinct from old.name
     or new.assignee_id is distinct from old.assignee_id
     or new.project_id  is distinct from old.project_id
     or new.org_id      is distinct from old.org_id
     or new.start_date  is distinct from old.start_date
     or new.end_date    is distinct from old.end_date
     or new.id          is distinct from old.id
     or new.created_at  is distinct from old.created_at
  then
    raise exception 'only the task status may be changed by its assignee' using errcode = '42501';
  end if;
  return new;
end; $$;

-- ============================================================================
-- A6 — incident_reports.reported_by audit stamp (audit/repudiation fix). reported_by was never
-- populated by the create path (the FE omitted it; no trigger filled it) yet the DAL falsely claimed
-- it was "server-resolved (auth.uid())". Mirror project_documents.author_id authenticity: a BEFORE
-- INSERT trigger that defaults reported_by = auth.uid() when the client did not supply it. An
-- explicitly-sent reported_by (e.g. the table-owner seed, which has no auth.uid()) is preserved so the
-- seed/back-office paths still work. SECURITY INVOKER (no definer needed — it only reads auth.uid()).
-- ============================================================================
create or replace function stamp_incident_reporter()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.reported_by is null then
    new.reported_by := auth.uid();
  end if;
  return new;
end; $$;

create trigger incident_reports_stamp_reporter
  before insert on incident_reports
  for each row execute function stamp_incident_reporter();
