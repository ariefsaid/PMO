-- 0237_workflow_notifications.sql — in-app notifications for workflow hand-offs (#788, AC-WFN-001..004).
-- Reuses public.notifications (0048). Rows are written ONLY by the AFTER triggers below (SECURITY
-- DEFINER); a client can still insert only its own row (notifications_insert pins owner_id = auth.uid()).
--   • procurement  Draft→Requested        → every active same-org user whose role may approve (OD-PROC-1:
--                                           Admin, Project Manager, Finance, Executive), never the requester
--   • procurement  Requested→Approved/Rejected → the requester (rejection comment in the body)
--   • timesheet    →Submitted             → the owner's line manager; Admin; Executive only when no manager
--                                           (OD-TS-1, mirrors transition_timesheet), never the owner
--   • timesheet    Submitted→Approved/Rejected → the owner
--   • task         assignee set/changed   → the new assignee (human actor only; never the actor)
-- The actor is never notified. Recipients must be active members of the record's org.

create or replace function public.notify_workflow_user(
  p_org uuid, p_owner uuid, p_title text, p_body text, p_severity text, p_entity_type text, p_entity_id uuid, p_label text
) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Same org as the record AND an active member; never the acting user.
  if p_owner is null or p_owner is not distinct from auth.uid() then return; end if;
  if not exists (select 1 from public.profiles p where p.id = p_owner and p.org_id = p_org) then return; end if;
  if not public.is_active_member(p_owner) then return; end if;
  insert into public.notifications (org_id, owner_id, severity, title, body, metadata)
  values (p_org, p_owner, p_severity, p_title, nullif(p_body, ''),
          jsonb_build_object('entity', jsonb_build_object('type', p_entity_type, 'id', p_entity_id, 'label', p_label)));
end; $$;
revoke execute on function public.notify_workflow_user(uuid, uuid, text, text, text, text, uuid, text) from public, anon, authenticated;

-- ── procurements ────────────────────────────────────────────────────────────────────────────────────
create or replace function public.notify_procurement_transition() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'Requested' and old.status = 'Draft' then
    -- Approver population = transition_procurement's Requested→Approved/Rejected arm (OD-PROC-1) minus the requester (SoD-a).
    for r in select p.id from public.profiles p
              where p.org_id = new.org_id
                and p.role in ('Admin','Project Manager','Finance','Executive')
                and p.id is distinct from new.requested_by_id
    loop
      perform public.notify_workflow_user(new.org_id, r.id, 'Procurement awaiting your approval',
        new.title, 'info', 'procurement_case', new.id, new.title);
    end loop;
  elsif old.status = 'Requested' and new.status = 'Approved' then
    perform public.notify_workflow_user(new.org_id, new.requested_by_id, 'Your procurement was approved',
      coalesce(new.approval_notes, new.title), 'info', 'procurement_case', new.id, new.title);
  elsif old.status = 'Requested' and new.status = 'Rejected' then
    perform public.notify_workflow_user(new.org_id, new.requested_by_id, 'Your procurement was rejected',
      coalesce(nullif(new.rejection_notes, ''), new.title), 'warning', 'procurement_case', new.id, new.title);
  end if;
  return new;
end; $$;
revoke execute on function public.notify_procurement_transition() from public, anon, authenticated;
create trigger procurements_notify_transition_trg
  after update of status on public.procurements
  for each row execute function public.notify_procurement_transition();

-- ── timesheets ──────────────────────────────────────────────────────────────────────────────────────
create or replace function public.notify_timesheet_transition() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_mgr uuid; v_label text := 'Timesheet week of ' || new.week_start_date::text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'Submitted' then
    select manager_id into v_mgr from public.profiles where id = new.user_id;
    -- Mirrors transition_timesheet: assigned line manager; Admin break-glass; Executive only when no manager.
    for r in select p.id from public.profiles p
              where p.org_id = new.org_id
                and p.id <> new.user_id
                and (p.id is not distinct from v_mgr
                     or p.role = 'Admin'
                     or (v_mgr is null and p.role = 'Executive'))
    loop
      perform public.notify_workflow_user(new.org_id, r.id, 'Timesheet awaiting your approval',
        v_label, 'info', 'timesheet', new.id, v_label);
    end loop;
  elsif old.status = 'Submitted' and new.status = 'Approved' then
    perform public.notify_workflow_user(new.org_id, new.user_id, 'Your timesheet was approved',
      v_label, 'info', 'timesheet', new.id, v_label);
  elsif old.status = 'Submitted' and new.status = 'Rejected' then
    perform public.notify_workflow_user(new.org_id, new.user_id, 'Your timesheet was rejected',
      v_label, 'warning', 'timesheet', new.id, v_label);
  end if;
  return new;
end; $$;
revoke execute on function public.notify_timesheet_transition() from public, anon, authenticated;
create trigger timesheets_notify_transition_trg
  after update of status on public.timesheets
  for each row execute function public.notify_timesheet_transition();

-- ── tasks ───────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.notify_task_assignment() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Human actor only: server-side writers (ERP sync, seed) have no auth.uid() and must not spam.
  if auth.uid() is null or new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then return new; end if;
  perform public.notify_workflow_user(new.org_id, new.assignee_id, 'A task was assigned to you',
    new.name, 'info', 'task', new.id, new.name);
  return new;
end; $$;
revoke execute on function public.notify_task_assignment() from public, anon, authenticated;
create trigger tasks_notify_assignment_trg
  after insert or update of assignee_id on public.tasks
  for each row execute function public.notify_task_assignment();
