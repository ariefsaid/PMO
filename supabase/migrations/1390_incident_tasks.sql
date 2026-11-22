-- 1390_incident_tasks.sql — #2677: several tasks per issue. Spec docs/specs/issue-tasks-root-cause.spec.md (FR-ITR-001, 004..007);
-- proven by supabase/tests/1390_issue_tasks_root_cause.test.sql. Not a money path.
--   incident_tasks is the full list of an issue's tasks. The legacy incident_reports.task_id (1026) stays readable and
--   unchanged; it is backfilled here and mirrored by trigger whenever create_task_from_incident (1028) sets it, so one list
--   serves the screen. Clients may read, never write: the rows are written by add_task_to_incident (1392) and the trigger.
-- ── REVERSE (also rollback/1390_incident_tasks_down.sql)
--   drop trigger incident_reports_zz_mirror_task on public.incident_reports; drop function public.mirror_incident_task();
--   drop table public.incident_tasks;

create table public.incident_tasks (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incident_reports(id) on delete cascade,
  task_id     uuid not null unique references public.tasks(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default clock_timestamp(),
  unique (incident_id, task_id)
);
create index incident_tasks_incident_idx on public.incident_tasks (incident_id, created_at);

alter table public.incident_tasks enable row level security;
revoke all on public.incident_tasks from anon, authenticated;
grant select on public.incident_tasks to authenticated;
create policy incident_tasks_select on public.incident_tasks for select to authenticated using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and public.org_feature_enabled((select public.auth_org_id()), 'incidents')
);
create trigger incident_tasks_stamp_org_id before insert on public.incident_tasks
  for each row execute function public.stamp_org_id();

-- legacy single task -> the list
insert into public.incident_tasks (incident_id, task_id, org_id, created_at)
select i.id, i.task_id, i.org_id, coalesce(t.created_at, now())
  from public.incident_reports i join public.tasks t on t.id = i.task_id
 where i.task_id is not null
on conflict do nothing;

-- keep the list whole when create_task_from_incident sets the legacy column
create function public.mirror_incident_task() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.task_id is not null and new.task_id is distinct from old.task_id then
    insert into public.incident_tasks (incident_id, task_id, org_id, created_by)
    values (new.id, new.task_id, new.org_id, auth.uid())
    on conflict do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.mirror_incident_task() from public, anon, authenticated;
create trigger incident_reports_zz_mirror_task after update of task_id on public.incident_reports
  for each row execute function public.mirror_incident_task();
