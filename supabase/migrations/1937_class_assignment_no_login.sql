-- 1937_class_assignment_no_login.sql — a labour class is assigned only to a person with no login.
-- save_labour_class_assignment restated from 1720 (the only migration that defines it) with one refusal: a person linked to a login
-- (people.profile_id set) is refused with LCM_HAS_LOGIN. Existing assignments are not touched.
-- Proven by supabase/tests/1720_labour_class_rates.test.sql. Rollback: rollback/1937_class_assignment_no_login_down.sql

create or replace function public.save_labour_class_assignment(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.labour_cost_gate();
  v_worker uuid; v_class uuid; v_from date; v_to date; v_id uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'assignment must be a JSON object' using errcode = '22023'; end if;
  begin
    v_worker := (p->>'worker_id')::uuid;
    v_class := (p->>'class_id')::uuid;
    v_from := (p->>'effective_from')::date;
    v_to := nullif(p->>'effective_to', '')::date;
  exception when others then
    raise exception 'an assignment field is missing or not valid' using errcode = '22023';
  end;
  if v_from is null then raise exception 'start date is required' using errcode = '22023'; end if;
  if v_to is not null and v_to < v_from then raise exception 'end date is before the start date' using errcode = '22023'; end if;
  if v_worker is null or not exists (select 1 from public.people w where w.id = v_worker and w.org_id = v_org and w.archived_at is null) then
    raise exception 'person not found' using errcode = '22023';
  end if;
  -- Class rates price people with no login only (DD-R1122-8): a person who signs in is costed on their timesheet (1937).
  if exists (select 1 from public.people w where w.id = v_worker and w.profile_id is not null) then          -- mut:no_login
    raise exception 'LCM_HAS_LOGIN: this person signs in, so their hours are costed on their timesheet; a class is for people with no login' using errcode = '23514';
  end if;
  if not exists (select 1 from public.labour_cost_classes c where c.id = v_class and c.org_id = v_org and c.archived_at is null) then
    raise exception 'class not found or archived' using errcode = '22023';
  end if;
  if public.labour_class_locked(v_org, 'worker', v_worker, v_from) then
    raise exception 'LCM_CLASS_LOCKED: this would change hours already costed for this person; start the new class after the last costed day' using errcode = '23514';
  end if;
  insert into public.labour_class_assignments (org_id, worker_id, class_id, effective_from, effective_to, created_by)
  values (v_org, v_worker, v_class, v_from, v_to, auth.uid())
  returning id into v_id;
  perform public.log_audit('labour_class_assignment.save', v_org, auth.uid(), v_id,
                           jsonb_build_object('worker_id', v_worker, 'class_id', v_class, 'effective_from', v_from, 'effective_to', v_to));
  return v_id;
exception when unique_violation then
  raise exception 'this person already has a class starting on that date' using errcode = '23505';
end $$;
revoke all on function public.save_labour_class_assignment(jsonb) from public, anon;
grant execute on function public.save_labour_class_assignment(jsonb) to authenticated;
