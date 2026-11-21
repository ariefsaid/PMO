-- 1395_task_groups.sql — #2679: a per-project task group that can be linked to a milestone.
-- Spec docs/specs/task-group-milestone-rollup.spec.md. The roll-up itself is 1396.
-- Reverse: rollback/1395_task_groups_down.sql.

create table public.task_groups (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 120),
  sort_order   integer not null default 0,
  milestone_id uuid,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  -- A group links only to a milestone of its OWN project (0202 pattern); deleting the milestone unlinks.
  constraint task_groups_milestone_fkey foreign key (project_id, milestone_id)
    references public.project_milestones (project_id, id) match simple on delete set null (milestone_id)
);
create unique index task_groups_project_id_id_key on public.task_groups (project_id, id);
create index task_groups_org_idx on public.task_groups (org_id);
create index task_groups_milestone_idx on public.task_groups (milestone_id) where milestone_id is not null;

alter table public.tasks add column task_group_id uuid;
-- tasks is record-history tracked: classify the new column like milestone_id (captured, a reference).
update public.record_history_config set captured = captured || '{"task_group_id":"ref"}'::jsonb
 where table_name = 'tasks' and not (captured ? 'task_group_id');
alter table public.tasks add constraint tasks_task_group_id_fkey foreign key (project_id, task_group_id)
  references public.task_groups (project_id, id) match simple on delete set null (task_group_id);
alter table public.tasks add constraint tasks_task_group_needs_project check (task_group_id is null or project_id is not null);
create index tasks_task_group_idx on public.tasks (task_group_id) where task_group_id is not null;

alter table public.task_groups enable row level security;
alter table public.task_groups force row level security;

create policy task_groups_select on public.task_groups for select
  using (org_id = (select public.auth_org_id()));

-- Write: Admin and Project Manager only (OD-DEL-7 shape, as project_milestones_write), parent project in the org.
create policy task_groups_write on public.task_groups for all
  using (org_id = (select public.auth_org_id()) and (select public.auth_role()) in ('Admin','Project Manager')
    and exists (select 1 from public.projects p where p.id = task_groups.project_id and p.org_id = (select public.auth_org_id())))
  with check (org_id = (select public.auth_org_id()) and (select public.auth_role()) in ('Admin','Project Manager')
    and exists (select 1 from public.projects p where p.id = task_groups.project_id and p.org_id = (select public.auth_org_id())));

grant select, insert, update, delete on public.task_groups to authenticated;

-- Moving a task into a group moves a milestone percentage, so it is a manager-only column on insert AND update
-- (an assignee/creator is already pinned on update by the allow-lists; insert had no pin). Server authority passes.
create or replace function public.guard_task_group_write()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.task_group_id is not null
     and (tg_op = 'INSERT' or new.task_group_id is distinct from old.task_group_id)
     and auth.uid() is not null
     and (select public.auth_role()) not in ('Admin','Executive','Project Manager') then
    raise exception 'only a manager may assign a task to a task group' using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger tasks_guard_task_group_write
  before insert or update on public.tasks
  for each row execute function public.guard_task_group_write();
