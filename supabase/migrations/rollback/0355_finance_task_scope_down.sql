-- Down for 0355: restore the HEAD task write rules (0204 tasks_update, 0199/0204 tasks_delete,
-- 0206 enforce_assignee_status_only) — Finance back in the write-role set. Bodies byte-identical to
-- HEAD apart from comments.

-- ── UPDATE: the four write roles, OR the creator on a PMO-owned task ────────────
drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (org_id = auth_org_id() and public.is_active_member()
    and (auth_role() in ('Admin','Executive','Project Manager','Finance')
         or (created_by = (select auth.uid())
             and not public.task_domain_externally_owned(project_id)))
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id())))
  with check (org_id = auth_org_id() and public.is_active_member()
    and (auth_role() in ('Admin','Executive','Project Manager','Finance')
         or (created_by = (select auth.uid())
             and not public.task_domain_externally_owned(project_id)))
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id())));

-- ── DELETE: the four write roles ──────────────────────────────────────────────────────────────────
drop policy tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id()))
    and not public.task_domain_externally_owned(project_id));

-- ── Column pin: 0206's body (HEAD) ──
create or replace function public.enforce_assignee_status_only()
  returns trigger language plpgsql set search_path = public as $$
declare
  k_external_allowed constant text[] :=
    array['milestone_id','completed_at','tombstoned_at','source_updated_at'];
  k_assignee_allowed constant text[] := array['status','completed_at'];
  k_creator_allowed constant text[] :=
    array['name','description','priority','status','assignee_id','milestone_id','parent_task_id',
          'project_id','start_date','end_date','completed_at','last_update','meeting_id'];
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     and public.task_domain_externally_owned(new.project_id) then
    return new;
  end if;

  if public.task_domain_externally_owned(new.project_id) then
    if to_jsonb(new) - k_external_allowed is distinct from to_jsonb(old) - k_external_allowed then
      -- Message byte-preserved from 0093/0140/0146/0199 — asserted verbatim elsewhere.
      raise exception 'task native fields are read-only while tasks are externally-owned'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if auth_role() in ('Admin','Executive','Project Manager','Finance') then
    return new;
  end if;

  if old.created_by is not null and old.created_by = (select auth.uid()) then
    if to_jsonb(new) - k_creator_allowed is distinct from to_jsonb(old) - k_creator_allowed then
      raise exception 'creator may edit task fields, not lifecycle or provenance columns'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if to_jsonb(new) - k_assignee_allowed is distinct from to_jsonb(old) - k_assignee_allowed then
    -- Message byte-preserved from 0016 onward — first_class_tasks.test.sql matches it verbatim.
    raise exception 'only the task status may be changed by its assignee' using errcode = '42501';
  end if;
  return new;
end; $$;

comment on function public.enforce_assignee_status_only() is
  'Column pin for non-service-role task UPDATEs. Externally-owned: everyone is pinned to '
  '{milestone_id, completed_at, tombstoned_at, source_updated_at}. PMO-owned: write roles pass; the '
  'CREATOR may change work fields (DD-TASK-8, 0204); the assignee may change {status, completed_at}; '
  'server authority (no auth.uid()) passes. created_by itself is pinned immutable by '
  'tasks_aa_pin_created_by, which fires first.';
