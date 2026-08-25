-- 0206_tasks_meeting_parent.sql — tasks gain their second nullable parent: the meeting (/action).
-- DD-TASK-1/2 ruled this ships in its OWN migration, after meetings exist — 0199's header records
-- the same. Proven inside supabase/tests/0205_meeting_access.test.sql (AC-MTG-120..124).
--
-- The /action contract: a meeting minute's action item becomes a real task carrying meeting_id.
-- OD-MTG-1 + DD-TASK-8 make the author path coherent: every role may minute a meeting, and an
-- Engineer may create tasks (0204), so the minuting Engineer CAN create their action items — the
-- collision #551 was filed for is closed end-to-end here.

alter table public.tasks
  add column meeting_id uuid references public.meetings(id);
-- ⚑ NO cascade and NO set null: FR-MTG-016 wants a hard meeting delete to FK-BLOCK (23503,
-- "in use") while tasks reference it — the default NO ACTION is exactly that behaviour.

create index tasks_meeting_id_idx on public.tasks (meeting_id);

-- DD-TASK-1's invariant: a task and its meeting cannot name DIFFERENT projects. NULL on either
-- side passes — a project-less action item under a projected meeting is legal (and vice versa);
-- only an actual disagreement is a lie about where the work belongs.
-- ⚑ Owner-read + org floor per 0199's parent trigger: this trigger is invoker-rights and the
-- caller may not be able to SEE the meeting; `found` distinguishes "no row" from NULLs.
create or replace function public.check_task_meeting_same_project()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_meeting_project uuid; v_meeting_org uuid; v_found boolean;
begin
  if new.meeting_id is null then return new; end if;
  select m.project_id, m.org_id, true into v_meeting_project, v_meeting_org, v_found
    from public.meetings m where m.id = new.meeting_id;
  if not coalesce(v_found, false) then
    raise exception 'task meeting must be in the same org and project' using errcode = '42501';
  end if;
  if v_meeting_org is distinct from new.org_id then
    raise exception 'task meeting must be in the same org and project' using errcode = '42501';
  end if;
  if v_meeting_project is not null and new.project_id is not null
     and v_meeting_project is distinct from new.project_id then
    raise exception 'task meeting must be in the same org and project' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.check_task_meeting_same_project() from public;

create trigger tasks_check_meeting_same_project
  before insert or update on public.tasks
  for each row execute function public.check_task_meeting_same_project();

-- The creator may LINK their own task to a meeting after the fact (the natural flow is link-at-
-- creation from the minute; re-linking is still a work-field edit, not a lifecycle one).
-- Extends 0204's k_creator_allowed by exactly this column; body otherwise byte-identical to 0204's
-- (which was itself 0200-verbatim plus one branch) — copied, not re-typed, per the standing lesson.
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
