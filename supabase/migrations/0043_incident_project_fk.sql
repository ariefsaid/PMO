-- 0043_incident_project_fk.sql — Backlog gap #8: link an incident to its project.
-- Forward-only, additive; reversibility contract is `supabase db reset` (pre-production, ADR-0006).
--
-- Adds incident_reports.project_id so an incident's location/project can deep-link to
-- /projects/:id. The column is NULLABLE (incidents may be unlinked) and ON DELETE SET NULL
-- (deleting a project must NOT delete incident history — the report survives, just loses its link).
-- Indexed: it is both an FK and a per-project filter path.
--
-- Same-org integrity guard (mirrors the 0039 same-case-invariant pattern): a plain FK constraint
-- bypasses RLS, so a cross-org project_id would otherwise be accepted — pointing an incident at a
-- project its own org cannot read (a broken link + a referential-existence oracle). A BEFORE
-- INSERT OR UPDATE trigger enforces incident.org_id = project.org_id, raising 42501 (uniform — does
-- NOT leak existence the way the 23503 FK-violation would). The existing org-scoped RLS
-- (incident_reports_select/insert/update) already covers reads/writes of the row itself; this guard
-- closes only the cross-org FK-target hole, so NO new RLS policy is needed.
--
-- Rollback (forward):
--   drop trigger   if exists incident_reports_check_project_org on incident_reports;
--   drop function  if exists check_incident_reports_project_org();
--   drop index     if exists idx_incident_reports_project_id;
--   alter table incident_reports drop column if exists project_id;
--
-- AC-IN-PROJ-001 / AC-IN-PROJ-002 / AC-IN-PROJ-003 / AC-IN-PROJ-004 /
-- AC-IN-PROJ-005 / AC-IN-PROJ-006 / AC-IN-PROJ-007 / AC-IN-PROJ-008 (0086 test file)

-- §1 — the nullable FK column + index.
alter table public.incident_reports
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists idx_incident_reports_project_id
  on public.incident_reports (project_id);

-- §2 — same-org invariant trigger (mirrors 0039). SECURITY INVOKER (no definer rights needed —
-- reads the parent table only). search_path pinned; all refs schema-qualified. Fires BEFORE
-- INSERT OR UPDATE so EVERY write path (RLS-direct, future UI) is constrained. Condition: if
-- project_id is non-null AND the referenced project's org_id differs from the incident's own
-- org_id → raise 42501 (uniform; no existence leak).
create or replace function public.check_incident_reports_project_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.project_id is not null
     and (select p.org_id from public.projects p where p.id = new.project_id)
         is distinct from new.org_id
  then
    raise exception 'project not in this org' using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger incident_reports_check_project_org
  before insert or update on public.incident_reports
  for each row execute function public.check_incident_reports_project_org();
