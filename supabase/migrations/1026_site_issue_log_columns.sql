-- 1026_site_issue_log_columns.sql — #2521: an incident can be raised as a site ISSUE. Spec
-- docs/specs/site-issue-log.spec.md; plan docs/plans/2026-11-20-site-issue-log.md. Proven by
-- supabase/tests/0979_site_issue_log.test.sql. Not a money path.
--
-- Extends incident_reports (one record, not two): work order, person in charge, action, due time, close stamps, close note,
-- escalation stamp, and the link to a task. Every new column is nullable, so legacy rows and the register are unchanged.
--   §1 columns + indexes
--   §2 ONE guard trigger (incident_reports_zz_issue_guard): work order on the issue's own project and org; assignee an active
--      member of the org; due time not in the past on creation; close stamps written only here; reopen audited; escalation
--      cleared when the due time moves forward; a person who is not a manager and edits only status / note (the assignee).
--   §3 a second UPDATE policy so the assignee can reach the row (the manager policy of 0002 is untouched).
--
-- ── REVERSE (also rollback/1026_site_issue_log_columns_down.sql) ──────────────────────────────────────
--   drop policy if exists incident_reports_update_assignee on public.incident_reports;
--   drop trigger if exists incident_reports_zz_issue_guard on public.incident_reports;
--   drop function if exists public.guard_incident_issue_fields();
--   alter table public.incident_reports drop column if exists <the nine columns below>;

-- ── §1 columns ───────────────────────────────────────────────────────────────────────────────────────
alter table public.incident_reports
  add column work_order_id uuid references public.work_orders(id),
  add column assignee_id   uuid references public.profiles(id),
  add column action        text check (action is null or char_length(action) <= 1000),
  add column due_at        timestamptz,
  add column closed_at     timestamptz,
  add column closed_by     uuid references public.profiles(id),
  add column close_note    text check (close_note is null or char_length(close_note) <= 1000),
  add column escalated_at  timestamptz,
  add column task_id       uuid unique references public.tasks(id) on delete set null;

create index incident_reports_work_order_idx on public.incident_reports (work_order_id) where work_order_id is not null;
create index incident_reports_assignee_idx   on public.incident_reports (assignee_id)   where assignee_id is not null;
-- the escalation pass scans exactly this set
create index incident_reports_overdue_idx    on public.incident_reports (org_id, due_at)
  where due_at is not null and escalated_at is null and status <> 'Closed';

-- ── §2 the rule ──────────────────────────────────────────────────────────────────────────────────────
-- Definer: reads work_orders / profiles whatever the caller's RLS. `auth.uid()` is null for the escalation job, the
-- migrations and the test fixtures (no client); that path is treated as privileged and is never reachable by a client role.
create function public.guard_incident_issue_fields() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_mgr boolean := auth.uid() is null or public.auth_role() in ('Admin','Executive','Project Manager','Finance');
  v_wo_org uuid; v_wo_project uuid;
begin
  -- work order: of the issue's own project and org (the #2517 rule)
  if new.work_order_id is not null then
    if new.project_id is null then
      raise exception 'a work order needs the issue to name its project' using errcode = '23514';
    end if;
    select w.org_id, w.project_id into v_wo_org, v_wo_project from public.work_orders w where w.id = new.work_order_id;
    if v_wo_org is distinct from new.org_id then
      raise exception 'work order not in this org' using errcode = '42501';
    end if;
    if v_wo_project is distinct from new.project_id then
      raise exception 'work order belongs to another project' using errcode = '23514';
    end if;
  end if;

  -- assignee: an active member of the issue's org
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    if not exists (select 1 from public.profiles p where p.id = new.assignee_id and p.org_id = new.org_id and p.status = 'active') then
      raise exception 'assignee must be an active member of this org' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if v_uid is not null and new.due_at is not null and new.due_at < now() then
      raise exception 'due time cannot be in the past' using errcode = '23514';
    end if;
    new.escalated_at := null;
    new.task_id := null;
    if new.status = 'Closed' then new.closed_at := now(); new.closed_by := v_uid;
    else new.closed_at := null; new.closed_by := null; end if;
    return new;
  end if;

  -- UPDATE ------------------------------------------------------------------------------------------
  if not v_mgr then
    -- the assignee: status and the close note only; never a reopen
    if (to_jsonb(new) - 'status' - 'close_note' - 'closed_at' - 'closed_by')
       is distinct from (to_jsonb(old) - 'status' - 'close_note' - 'closed_at' - 'closed_by') then
      raise exception 'only a manager may change the assignee, due time, work order or action' using errcode = '42501';
    end if;
    if old.status = 'Open' and new.status = 'Closed' then
      raise exception 'an assignee must investigate before closing' using errcode = '23514';
    end if;
    if old.status = 'Closed' and new.status <> 'Closed' then
      raise exception 'only a manager may reopen an issue' using errcode = '42501';
    end if;
  end if;

  -- close stamps are the database's, never the client's
  if new.status = 'Closed' and old.status <> 'Closed' then
    new.closed_at := now(); new.closed_by := v_uid;
  elsif new.status = 'Closed' then
    new.closed_at := old.closed_at; new.closed_by := old.closed_by;
  else
    new.closed_at := null; new.closed_by := null;
    if old.status = 'Closed' then
      perform public.log_audit('incident.reopened', new.org_id, v_uid, new.id,
        jsonb_build_object('closed_at', old.closed_at, 'closed_by', old.closed_by, 'status', new.status));
    end if;
  end if;

  -- escalation: a client never sets it; moving the due time forward clears it (a later miss escalates again)
  if v_uid is not null then
    new.escalated_at := old.escalated_at;
    -- the link is written only by create_task_from_incident (1028), which raises this transaction-local flag
    if current_setting('pmo.incident_task_link', true) is distinct from 'on' then
      new.task_id := old.task_id;
    end if;
  end if;
  if old.escalated_at is not null and new.due_at is not null and new.due_at > coalesce(old.due_at, '-infinity') and new.due_at > now() then
    new.escalated_at := null;
    perform public.log_audit('incident.escalation_cleared', new.org_id, v_uid, new.id,
      jsonb_build_object('old_due_at', old.due_at, 'new_due_at', new.due_at));
  end if;
  return new;
end; $$;
revoke all on function public.guard_incident_issue_fields() from public, anon, authenticated;

-- zz: after the org stamp (0215 ordering rule)
create trigger incident_reports_zz_issue_guard before insert or update on public.incident_reports
  for each row execute function public.guard_incident_issue_fields();

-- ── §3 the assignee reaches the row; the trigger limits what they may change ─────────────────────────
create policy incident_reports_update_assignee on public.incident_reports for update
  using (
    org_id = (select public.auth_org_id()) and (select public.is_active_member())
    and assignee_id = (select auth.uid())
    and org_feature_enabled((select public.auth_org_id()), 'incidents')
  )
  with check (
    org_id = (select public.auth_org_id()) and (select public.is_active_member())
    and assignee_id = (select auth.uid())
    and org_feature_enabled((select public.auth_org_id()), 'incidents')
  );
