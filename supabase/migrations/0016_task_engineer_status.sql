-- 0016_task_engineer_status.sql — widen tasks RLS so an assignee (Engineer) can UPDATE the STATUS
-- of their OWN task, and ONLY the status (column-pinned), mirroring the timesheets MED-TS-2 pattern.
-- (CRUD+RBAC program, Tasks slice; docs/design/rbac-visibility.md §F, docs/plans/2026-06-07-crud-rbac-program.md.)
--
-- WHY: the shipped tasks_write policy (0002_rls.sql) is FOR ALL with the four delivery/master roles
-- (Admin, Executive, Project Manager, Finance) in both USING and WITH CHECK. An Engineer therefore
-- cannot UPDATE any task. The RBAC contract (§F) says the assignee — including an Engineer — may
-- change the STATUS of their OWN task (To Do / In Progress / Done / Blocked), but NOTHING else
-- (title, assignee, dates, project remain managers-only). RLS is the enforcement authority; the FE
-- gate (src/auth/policy.ts taskStatus.edit) is only a clarity projection — so the server must enforce
-- both the OWN-row scope AND the status-only column pin.
--
-- APPROACH (two parts, mirroring 0011/MED-TS-2 + the 0005 budget-draft trigger precedent):
--   (1) A PERMISSIVE UPDATE-only policy `tasks_update_own_status` granting the row-scope: the caller
--       may UPDATE a task where assignee_id = auth.uid() AND the row (pre- and post-image) is in their
--       org. PostgreSQL ORs permissive policies, so this ADDS the own-task UPDATE path on top of the
--       managers' tasks_write without touching it. The WITH CHECK pins org + own-assignee on the
--       post-image so the assignee cannot reassign the task away from themselves to escape the guard.
--   (2) A BEFORE UPDATE trigger `tasks_assignee_status_only` that, when the caller is NOT a structure
--       write-role (i.e. an Engineer reaching the row only via policy (1)), REJECTS (42501) any change
--       to a non-status column. This is the column pin RLS WITH CHECK cannot express (it cannot read
--       OLD). Managers (the four write-roles) bypass the pin and keep full structure edits via
--       tasks_write. `is distinct from` is null-safe (a NULL assignee/date change is still caught).
--
-- Net contract: Engineer assignee → status-only UPDATE on own task (any other column change → 42501);
-- non-assignee Engineer → no UPDATE path (policy (1) USING hides the row → 0-row no-op); managers →
-- unchanged full structure edit. SELECT/INSERT/DELETE are untouched. org_id seam intact on every path.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual rollback:
--   drop trigger if exists tasks_assignee_status_only on tasks;
--   drop function if exists enforce_assignee_status_only();
--   drop policy if exists tasks_update_own_status on tasks;

-- (1) Own-task UPDATE row-scope for the assignee (any role). Permissive, UPDATE-only.
create policy tasks_update_own_status on tasks
  for update
  using (org_id = auth_org_id() and assignee_id = auth.uid())
  with check (org_id = auth_org_id() and assignee_id = auth.uid());

-- (2) The status-only column pin for non-write-role callers (Engineers). Managers (the four
-- write-roles) are exempt so their tasks_write structure edits are unaffected. Any attempt by a
-- non-write-role to change a column other than status raises 42501 (insufficient privilege),
-- surfacing as a classified toast in the FE — never a silent partial write.
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
  then
    raise exception 'only the task status may be changed by its assignee' using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger tasks_assignee_status_only
  before update on tasks
  for each row execute function enforce_assignee_status_only();
