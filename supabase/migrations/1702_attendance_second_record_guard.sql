-- 1702_attendance_second_record_guard.sql — docs/specs/pay-time.spec.md (FR-PAY-003, AC-PAY-003).
-- Reverse: rollback/1702_attendance_second_record_guard_down.sql.
-- A day waiting for a decision cannot be linked to a timesheet line, submitted or approved. A trigger on the table holds for every
-- writer (the timesheet generator, the week approval, the timesheet approval trigger), so no later path can skip the rule, and a
-- `manual_correction` of the day cannot clear it because the check is the live comparison, not a stored flag.

create function public.guard_attendance_day_undecided() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (old.timesheet_entry_id is null and new.timesheet_entry_id is not null)
     or (old.submitted_at is null and new.submitted_at is not null)
     or (old.approved_at is null and new.approved_at is not null)
     or (old.locked_at is null and new.locked_at is not null) then
    if public.attendance_day_undecided(new.worker_id, new.work_order_id, new.work_date) then
      raise exception 'ATT_UNDECIDED: the site report and the second record disagree for % ; decide which hours stand first',
        to_char(new.work_date, 'YYYY-MM-DD') using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_attendance_day_undecided() from public, anon, authenticated;
create trigger attendance_days_undecided_guard before update on public.attendance_days
  for each row execute function public.guard_attendance_day_undecided();

-- A decided day whose figure is later changed by someone else is a new disagreement: the decision is withdrawn and the two records
-- are compared again. The decision itself (1701) marks its own write so it does not withdraw itself.
create function public.reopen_attendance_second_record() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('pmo.pay_time_decide', true), 'off') <> 'on'
     and (old.status, old.hours, old.overtime_hours) is distinct from (new.status, new.hours, new.overtime_hours) then
    update public.attendance_second_records s
       set standing = null, decided_by = null, decided_at = null, decision_reason = null
     where s.worker_id = new.worker_id and s.work_order_id = new.work_order_id and s.work_date = new.work_date
       and s.decided_at is not null;
  end if;
  return new;
end $$;
revoke all on function public.reopen_attendance_second_record() from public, anon, authenticated;
create trigger attendance_days_reopen_second_record after update on public.attendance_days
  for each row execute function public.reopen_attendance_second_record();
