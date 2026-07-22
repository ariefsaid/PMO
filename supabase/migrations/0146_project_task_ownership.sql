-- 0146_project_task_ownership.sql — task ownership follows the project binding (FR-IEM-010..013, 015).
--
-- Statement order is intentional: project_domain_externally_owned() is created first, then the
-- task RLS policies and triggers are replaced to use it. No existing binding is changed, no
-- project is auto-bound, and disconnected_at tombstones remain intact.
--
-- Reversal (manual, if promoted): restore the task policies and trigger bodies from migration
-- 0140_task_model_fields.sql / 0093_clickup_tasks_flip.sql, then:
--   drop function if exists public.project_domain_externally_owned(uuid,text);
-- This leaves external_project_bindings rows, including disconnected_at tombstones, untouched.
-- Do not alter, overload, or replace domain_externally_owned(uuid,text): it remains the org-level
-- predicate for every non-task ERPNext and ClickUp domain.

-- §1 — project-aware predicate. The project supplies the org; only an active ClickUp task binding
-- delegates ownership. SECURITY INVOKER preserves the caller's tenant/RLS visibility.
create or replace function public.project_domain_externally_owned(
  p_project_id uuid,
  p_domain text
) returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select p_domain = 'tasks'
     and exists (
       select 1
       from public.projects p
       join public.external_project_bindings b
         on b.org_id = p.org_id
        and b.project_id = p.id
       where p.id = p_project_id
         and b.external_tier = 'clickup'
         and b.disconnected_at is null
     )
$$;
revoke all on function public.project_domain_externally_owned(uuid,text) from public;
grant execute on function public.project_domain_externally_owned(uuid,text) to authenticated;
grant execute on function public.project_domain_externally_owned(uuid,text) to service_role;

-- §2 — task RLS gates (re-created, never edited in 0093).
drop policy tasks_insert on public.tasks;
drop policy tasks_update on public.tasks;
drop policy tasks_delete on public.tasks;
drop policy tasks_update_own_status on public.tasks;

create policy tasks_insert on public.tasks for insert
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id())
    and not public.project_domain_externally_owned(project_id, 'tasks'));

create policy tasks_update on public.tasks for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id()));

create policy tasks_delete on public.tasks for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id())
    and not public.project_domain_externally_owned(project_id, 'tasks'));

create policy tasks_update_own_status on public.tasks for update
  using (org_id = auth_org_id() and assignee_id = (select auth.uid())
    and not public.project_domain_externally_owned(project_id, 'tasks'))
  with check (org_id = auth_org_id() and assignee_id = (select auth.uid())
    and not public.project_domain_externally_owned(project_id, 'tasks'));

-- §3 — task column pin and completed-at stamp (0140 bodies, with only the ownership predicate
-- changed and evaluated against the row's project).
create or replace function public.enforce_assignee_status_only()
  returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     and public.project_domain_externally_owned(new.project_id, 'tasks') then
    return new;
  end if;
  if public.project_domain_externally_owned(new.project_id, 'tasks') then
    if new.name           is distinct from old.name
       or new.status         is distinct from old.status
       or new.assignee_id    is distinct from old.assignee_id
       or new.project_id     is distinct from old.project_id
       or new.org_id         is distinct from old.org_id
       or new.start_date     is distinct from old.start_date
       or new.end_date       is distinct from old.end_date
       or new.id             is distinct from old.id
       or new.created_at     is distinct from old.created_at
       or new.description    is distinct from old.description
       or new.priority       is distinct from old.priority
       or new.parent_task_id is distinct from old.parent_task_id
       or new.archived_at    is distinct from old.archived_at
    then
      raise exception 'task native fields are read-only while tasks are externally-owned'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if auth_role() in ('Admin','Executive','Project Manager','Finance') then
    return new;
  end if;
  if new.name           is distinct from old.name
     or new.assignee_id    is distinct from old.assignee_id
     or new.project_id     is distinct from old.project_id
     or new.org_id         is distinct from old.org_id
     or new.start_date     is distinct from old.start_date
     or new.end_date       is distinct from old.end_date
     or new.id             is distinct from old.id
     or new.created_at     is distinct from old.created_at
     or new.description    is distinct from old.description
     or new.priority       is distinct from old.priority
     or new.parent_task_id is distinct from old.parent_task_id
     or new.archived_at    is distinct from old.archived_at
  then
    raise exception 'only the task status may be changed by its assignee' using errcode = '42501';
  end if;
  return new;
end; $$;

create or replace function public.stamp_task_completed_at() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     and public.project_domain_externally_owned(new.project_id, 'tasks') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.completed_at := case when new.status = 'Done' then now() else null end;
  elsif new.status = 'Done' and old.status is distinct from 'Done' then
    new.completed_at := now();
  elsif new.status is distinct from 'Done' and old.status = 'Done' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end $$;
