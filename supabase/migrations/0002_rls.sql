-- 0002_rls.sql — RLS helpers + per-table policies (target-architecture.spec.md §6).
-- Coarse role gates now; full role×status matrices DEFERRED to module specs (plan D-5, spec §14).
-- This issue implements: org isolation on every business table (org_id = auth_org_id() on USING + WITH CHECK)
-- and coarse role gates. The org_id seam is client-unspoofable: column default (0001) + WITH CHECK here.

-- §6.2 caller's org (MVP: from profiles; later: from JWT app_metadata.org_id — spec §6.5).
-- security definer + pinned search_path prevents the predicate recursing into RLS on profiles and hardens
-- against search_path injection (security-auditor surface).
create or replace function auth_org_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = auth.uid()
$$;

-- §6.2 caller's role. AUTHORITY: profiles.role. The unsigned `app_metadata.role` JWT fast-path was
-- removed (audit LOW-1): GoTrue does not yet sign that claim and no audited sync trigger keeps it in
-- step with profiles.role, so trusting it would let a tampered/stale token drive role gates. The
-- JWT-claim fast-path returns in the Auth issue, once GoTrue signs the claim AND a profiles→claim sync
-- trigger is in place and security-audited. Until then profiles.role is the single source of truth.
create or replace function auth_role() returns user_role
  language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

-- organizations: read your own org only; no client writes in MVP (provisioning DEFERRED §6.5).
alter table organizations enable row level security;
create policy organizations_select on organizations for select
  using (id = auth_org_id());

-- profiles: read profiles in your org; update your own row; Admin updates any in org.
-- DEFERRED §14: role-change scope (who may change another user's role) tightened in the Admin/Users module spec.
alter table profiles enable row level security;
create policy profiles_select on profiles for select
  using (org_id = auth_org_id());
-- A self-update may NOT change role or org_id (audit HIGH-1: prevents self role-escalation). The
-- with check pins both to the caller's current persisted values; only profiles_admin_write may change
-- role. (subselects read profiles directly; security-definer-free here is fine — same-row read.)
create policy profiles_update_self on profiles for update
  using (id = auth.uid())
  with check (
    org_id = (select p.org_id from profiles p where p.id = auth.uid())
    and role = (select p.role from profiles p where p.id = auth.uid()));
-- with check also gates on auth_role()='Admin' (audit HIGH-1): permissive policies OR their with-check
-- clauses independently, so without the Admin gate here a non-Admin self-update could satisfy this
-- policy's weaker check and slip a role change past profiles_update_self.
create policy profiles_admin_write on profiles for all
  using (org_id = auth_org_id() and auth_role() = 'Admin')
  with check (org_id = auth_org_id() and auth_role() = 'Admin');

-- companies/projects/budgets/tasks/project_documents: read-in-org for all authenticated; coarse write gate
-- for org-mutating roles. DEFERRED §14: Finance scope to budgets, Engineer own-task-status, tightened in
-- the respective module specs (Budget §14, Schedule §14).
alter table companies enable row level security;
create policy companies_select on companies for select using (org_id = auth_org_id());
create policy companies_write on companies for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());

alter table projects enable row level security;
create policy projects_select on projects for select using (org_id = auth_org_id());
create policy projects_write on projects for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());

alter table budget_versions enable row level security;
create policy budget_versions_select on budget_versions for select using (org_id = auth_org_id());
create policy budget_versions_write on budget_versions for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());

alter table budget_line_items enable row level security;
create policy budget_line_items_select on budget_line_items for select using (org_id = auth_org_id());
-- Parent-org guard (audit HIGH-2): the parent budget_version must be in the caller's org, so a child
-- stamped with the caller's org cannot be attached to another org's aggregate.
create policy budget_line_items_write on budget_line_items for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from budget_versions bv
      where bv.id = budget_line_items.budget_version_id and bv.org_id = auth_org_id()))
  with check (org_id = auth_org_id()
    and exists (select 1 from budget_versions bv
      where bv.id = budget_line_items.budget_version_id and bv.org_id = auth_org_id()));

alter table tasks enable row level security;
create policy tasks_select on tasks for select using (org_id = auth_org_id());
-- Parent-org guard (audit HIGH-2): the parent project must be in the caller's org.
create policy tasks_write on tasks for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from projects p where p.id = tasks.project_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id()
    and exists (select 1 from projects p where p.id = tasks.project_id and p.org_id = auth_org_id()));

alter table task_dependencies enable row level security;
create policy task_dependencies_select on task_dependencies for select using (org_id = auth_org_id());
-- Parent-org guard (audit HIGH-2): BOTH endpoint tasks must be in the caller's org.
create policy task_dependencies_write on task_dependencies for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from tasks t where t.id = task_dependencies.task_id and t.org_id = auth_org_id())
    and exists (select 1 from tasks t where t.id = task_dependencies.depends_on_id and t.org_id = auth_org_id()))
  with check (org_id = auth_org_id()
    and exists (select 1 from tasks t where t.id = task_dependencies.task_id and t.org_id = auth_org_id())
    and exists (select 1 from tasks t where t.id = task_dependencies.depends_on_id and t.org_id = auth_org_id()));

alter table project_documents enable row level security;
create policy project_documents_select on project_documents for select using (org_id = auth_org_id());
-- Parent-org guard (audit HIGH-2): the parent project must be in the caller's org.
create policy project_documents_write on project_documents for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from projects p where p.id = project_documents.project_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id()
    and exists (select 1 from projects p where p.id = project_documents.project_id and p.org_id = auth_org_id()));

-- procurements + children: read in org; any member may insert (raise a request). Status transitions go
-- through RPC (spec §8.4) authored in the Procurement module — full role×status matrix DEFERRED §14.
alter table procurements enable row level security;
create policy procurements_select on procurements for select using (org_id = auth_org_id());
create policy procurements_insert on procurements for insert with check (org_id = auth_org_id());
create policy procurements_update on procurements for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());

alter table procurement_items enable row level security;
create policy procurement_items_select on procurement_items for select using (org_id = auth_org_id());
-- Parent-org guard (audit HIGH-2): the parent procurement must be in the caller's org.
create policy procurement_items_write on procurement_items for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from procurements p where p.id = procurement_items.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id()
    and exists (select 1 from procurements p where p.id = procurement_items.procurement_id and p.org_id = auth_org_id()));

alter table procurement_quotations enable row level security;
create policy procurement_quotations_select on procurement_quotations for select using (org_id = auth_org_id());
-- Parent-org guard (audit HIGH-2): the parent procurement must be in the caller's org.
create policy procurement_quotations_write on procurement_quotations for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from procurements p where p.id = procurement_quotations.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id()
    and exists (select 1 from procurements p where p.id = procurement_quotations.procurement_id and p.org_id = auth_org_id()));

alter table procurement_documents enable row level security;
create policy procurement_documents_select on procurement_documents for select using (org_id = auth_org_id());
-- Parent-org guard (audit HIGH-2): the parent procurement must be in the caller's org.
create policy procurement_documents_write on procurement_documents for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from procurements p where p.id = procurement_documents.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id()
    and exists (select 1 from procurements p where p.id = procurement_documents.procurement_id and p.org_id = auth_org_id()));

-- timesheets: own rows readable/writable while Draft; managers read submitted (rule DEFERRED §14);
-- approve/reject via RPC (spec §8.4). MVP coarse gate: own-row writes + read-in-org.
alter table timesheets enable row level security;
create policy timesheets_select on timesheets for select
  using (org_id = auth_org_id() and (user_id = auth.uid()
         or auth_role() in ('Admin','Executive','Project Manager','Finance')));
create policy timesheets_insert on timesheets for insert
  with check (org_id = auth_org_id() and user_id = auth.uid());
create policy timesheets_update_own on timesheets for update
  using (org_id = auth_org_id() and user_id = auth.uid() and status = 'Draft')
  with check (org_id = auth_org_id() and user_id = auth.uid());

alter table timesheet_entries enable row level security;
create policy timesheet_entries_select on timesheet_entries for select
  using (org_id = auth_org_id() and exists (
    select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
      and (t.user_id = auth.uid() or auth_role() in ('Admin','Executive','Project Manager','Finance'))));
create policy timesheet_entries_write on timesheet_entries for all
  using (org_id = auth_org_id() and exists (
    select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
      and t.user_id = auth.uid() and t.status = 'Draft'))
  with check (org_id = auth_org_id());

-- incident_reports: read in org; any member may insert (schema-only MVP). DEFERRED §14: full workflow.
alter table incident_reports enable row level security;
create policy incident_reports_select on incident_reports for select using (org_id = auth_org_id());
create policy incident_reports_insert on incident_reports for insert with check (org_id = auth_org_id());
create policy incident_reports_update on incident_reports for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());
