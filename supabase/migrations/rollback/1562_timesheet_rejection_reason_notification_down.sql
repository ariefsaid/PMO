-- 1562 down: restore pre-change notify_timesheet_transition() definition from 0237 / live catalog.
create or replace function public.notify_timesheet_transition() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_mgr uuid; v_label text := 'Timesheet week of ' || new.week_start_date::text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'Submitted' then
    select manager_id into v_mgr from public.profiles where id = new.user_id;
    -- ⚑ MIRRORS the approver arm of public.transition_timesheet (0180): assigned line manager; Admin break-glass;
    -- Executive only when the owner has no manager. A change there MUST change this predicate too.
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
