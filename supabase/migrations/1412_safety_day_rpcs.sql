-- 1412_safety_day_rpcs.sql — #2596 daily safety records: the writers that are more than a row, and the per-day read.
-- Spec: docs/specs/daily-safety-records.spec.md (FR-DSF-003, 006, 008). Proven by supabase/tests/safety_days.test.sql.
--   safety_save_talk       a toolbox talk with its attendees in one step (at least one attendee)
--   submit_safety_day      draft -> locked (author only); immutable from here (the guards of 1411)
--   correct_safety_day     a locked day -> a new draft version naming it, with a reason (as dsr_correct, 1041)
--   safety_day_missing     (internal) the parts still missing on a day
--   safety_work_order_days per date: the day, whether it is complete, what is missing, how many were present
-- Reversal: rollback/1412_safety_day_rpcs_down.sql.

create function public.safety_save_talk(p_day uuid, p_topic text, p_presenter text, p_held_at timestamptz, p_attendees jsonb)
  returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_talk uuid;
  v_org uuid;
  a jsonb;
begin
  if not public.safety_day_writable(p_day) then
    raise exception 'safety day is not open for entry' using errcode = '42501';
  end if;
  if p_attendees is null or jsonb_typeof(p_attendees) <> 'array' or jsonb_array_length(p_attendees) = 0 then
    raise exception 'a toolbox talk needs at least one attendee' using errcode = '23514';
  end if;
  select org_id into v_org from public.safety_days where id = p_day;
  insert into public.safety_toolbox_talks (org_id, day_id, topic, presenter, held_at)
    values (v_org, p_day, p_topic, p_presenter, p_held_at) returning id into v_talk;
  for a in select * from jsonb_array_elements(p_attendees) loop
    insert into public.safety_toolbox_attendees (org_id, day_id, talk_id, worker_id, visitor_name)
      values (v_org, p_day, v_talk, nullif(a ->> 'worker_id', '')::uuid, nullif(btrim(coalesce(a ->> 'visitor_name', '')), ''));
  end loop;
  return v_talk;
end $$;

-- Parts still missing on a day: 'toolbox_talk_photo', 'checklist', 'fitness_check'.
create function public.safety_day_missing(p_day uuid) returns text[]
  language sql stable security definer set search_path = public, pg_temp as $$
  select array_remove(array[
    case when not exists (select 1 from public.safety_toolbox_photos p where p.day_id = d.id) then 'toolbox_talk_photo' end,
    case when exists (select 1 from public.safety_checklist_answers c where c.day_id = d.id and c.answer is null) then 'checklist' end,
    case when exists (select 1 from public.attendance_days a
                       where a.work_order_id = d.work_order_id and a.work_date = d.work_date and a.status = 'present'
                         and not exists (select 1 from public.safety_fitness_checks f
                                          where f.day_id = d.id and f.worker_id = a.worker_id and f.result in ('fit', 'not_fit')))
         then 'fitness_check' end], null)
  from public.safety_days d where d.id = p_day
$$;
revoke all on function public.safety_day_missing(uuid) from public, anon, authenticated;

create function public.submit_safety_day(p_day uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.safety_days%rowtype;
begin
  select * into d from public.safety_days where id = p_day and org_id = public.auth_org_id();
  if not found or not public.safety_may_enter(d.project_id) then
    raise exception 'not allowed to submit this safety day' using errcode = '42501';
  end if;
  if d.author_id is distinct from auth.uid() then
    raise exception 'only the author submits a safety day' using errcode = '42501';
  end if;
  if d.status <> 'draft' then
    raise exception 'this safety day is already locked' using errcode = '23514';
  end if;
  if exists (select 1 from public.safety_checklist_answers c where c.day_id = d.id and c.answer = 'no' and btrim(coalesce(c.note, '')) = '') then
    raise exception 'a checklist item answered no needs a note' using errcode = '23514';
  end if;
  perform set_config('pmo.safety_internal', 'on', true);
  update public.safety_days set status = 'locked', submitted_at = now() where id = d.id;
  perform set_config('pmo.safety_internal', 'off', true);
end $$;

create function public.correct_safety_day(p_day uuid, p_reason text) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.safety_days%rowtype;
  v_new uuid;
  t record;
  v_talk uuid;
begin
  select * into d from public.safety_days where id = p_day and org_id = public.auth_org_id();
  if not found or not public.safety_may_enter(d.project_id) then
    raise exception 'not allowed to correct this safety day' using errcode = '42501';
  end if;
  if d.status <> 'locked' then
    raise exception 'only a locked safety day is corrected' using errcode = '23514';
  end if;
  if exists (select 1 from public.safety_days s where s.supersedes_id = d.id) then
    raise exception 'this safety day already has a correction' using errcode = '23505';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a correction needs a reason' using errcode = '23514';
  end if;
  perform set_config('pmo.safety_internal', 'on', true);
  insert into public.safety_days (org_id, work_order_id, work_date, version, supersedes_id, correction_reason, author_id)
    values (d.org_id, d.work_order_id, d.work_date, d.version + 1, d.id, btrim(p_reason), auth.uid()) returning id into v_new;
  insert into public.safety_fitness_checks (org_id, day_id, worker_id, visitor_name, check_type_id, result, note)
    select org_id, v_new, worker_id, visitor_name, check_type_id, result, note from public.safety_fitness_checks where day_id = d.id;
  insert into public.safety_checklist_answers (org_id, day_id, item_id, label, position, answer, note)
    select org_id, v_new, item_id, label, position, answer, note from public.safety_checklist_answers where day_id = d.id;
  insert into public.safety_permits (org_id, day_id, permit_number, type_id, valid_from, valid_to, issued_by, state)
    select org_id, v_new, permit_number, type_id, valid_from, valid_to, issued_by, state from public.safety_permits where day_id = d.id;
  for t in select * from public.safety_toolbox_talks where day_id = d.id loop
    insert into public.safety_toolbox_talks (org_id, day_id, topic, presenter, held_at)
      values (t.org_id, v_new, t.topic, t.presenter, t.held_at) returning id into v_talk;
    insert into public.safety_toolbox_attendees (org_id, day_id, talk_id, worker_id, visitor_name)
      select org_id, v_new, v_talk, worker_id, visitor_name from public.safety_toolbox_attendees where talk_id = t.id;
    -- the same stored file stays readable through the original photo row (its id is in the object path)
    insert into public.safety_toolbox_photos (org_id, day_id, talk_id, file_path, uploaded_by)
      select org_id, v_new, v_talk, file_path, uploaded_by from public.safety_toolbox_photos where talk_id = t.id;
  end loop;
  perform set_config('pmo.safety_internal', 'off', true);
  return v_new;
end $$;

-- Per date for a work order: the latest version of the day (if any), how many were present, what is missing.
-- Definer because attendance rows are readable only by the roles that manage crews; counts only leave here.
create function public.safety_work_order_days(p_work_order_id uuid, p_from date, p_to date)
  returns table (work_date date, day_id uuid, status text, version integer, workers_present integer, missing text[], complete boolean)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_active_member()
     or not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = public.auth_org_id()) then
    raise exception 'not a member of this organisation' using errcode = '42501';
  end if;
  return query
  with dates as (
    select a.work_date from public.attendance_days a
     where a.work_order_id = p_work_order_id and a.status = 'present' and a.work_date between p_from and p_to
    union
    select s.work_date from public.safety_days s
     where s.work_order_id = p_work_order_id and s.work_date between p_from and p_to
  ), cur as (
    select distinct on (s.work_date) s.work_date, s.id, s.status, s.version
      from public.safety_days s where s.work_order_id = p_work_order_id and s.work_date between p_from and p_to
     order by s.work_date, s.version desc
  )
  select x.work_date, c.id, c.status, c.version,
         (select count(*)::int from public.attendance_days a
           where a.work_order_id = p_work_order_id and a.work_date = x.work_date and a.status = 'present'),
         case when c.id is null then array['safety_record']::text[] else public.safety_day_missing(c.id) end,
         coalesce(c.status = 'locked' and coalesce(cardinality(public.safety_day_missing(c.id)), 0) = 0, false)
    from dates x left join cur c on c.work_date = x.work_date
   order by x.work_date desc;
end $$;

revoke all on function public.safety_save_talk(uuid, text, text, timestamptz, jsonb), public.submit_safety_day(uuid),
  public.correct_safety_day(uuid, text), public.safety_work_order_days(uuid, date, date) from public, anon;
grant execute on function public.safety_save_talk(uuid, text, text, timestamptz, jsonb), public.submit_safety_day(uuid),
  public.correct_safety_day(uuid, text), public.safety_work_order_days(uuid, date, date) to authenticated;
