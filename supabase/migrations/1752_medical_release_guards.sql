-- 1752_medical_release_guards.sql — while a release is Pending or Deferred the database refuses to roster the person for
-- any day on or after the release date: a new or extended crew placement, a new or extended loan, and an attendance row.
-- Separate triggers (zz_mr_*), so guard_crew_refs, guard_crew_loan and attendance_record are not restated. A placement or
-- row entirely before the release date, and a shrink of a placement, are untouched.
-- Reverse: supabase/migrations/rollback/1752_medical_release_guards_down.sql
create function public.guard_medical_release_placement() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.worker_id = old.worker_id
     and coalesce(new.valid_to, 'infinity'::date) <= coalesce(old.valid_to, 'infinity'::date) then
    return new;
  end if;
  if public.medical_release_blocks(new.worker_id, new.valid_to) then
    raise exception 'MR_BLOCKED: this person''s medical release is not approved; their direct manager must approve it before they are rostered'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_medical_release_placement() from public, anon, authenticated;
create trigger zz_mr_crew_members before insert or update on public.crew_members
  for each row execute function public.guard_medical_release_placement();
create trigger zz_mr_crew_loans before insert or update on public.crew_loans
  for each row execute function public.guard_medical_release_placement();

create function public.guard_medical_release_attendance() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- an update that changes none of who, which day, status or hours (an approval or lock stamp) is not a new recording
  if tg_op = 'UPDATE' and new.worker_id = old.worker_id and new.work_date = old.work_date and new.status = old.status
     and new.hours is not distinct from old.hours and new.overtime_hours is not distinct from old.overtime_hours then
    return new;
  end if;
  if public.medical_release_blocks(new.worker_id, new.work_date) then
    raise exception 'MR_BLOCKED: this person''s medical release is not approved; their direct manager must approve it before attendance is recorded'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_medical_release_attendance() from public, anon, authenticated;
create trigger zz_mr_attendance_days before insert or update on public.attendance_days
  for each row execute function public.guard_medical_release_attendance();
