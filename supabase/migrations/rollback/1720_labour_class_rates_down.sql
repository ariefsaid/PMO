-- Reverse of 1720_labour_class_rates.sql. Restores save_labour_cost_rate, end_labour_cost_rate and
-- archive_labour_cost_rate to their bodies at head before 1720 (pg_get_functiondef), then drops what 1720 added.
-- DATA LOSS: every class rate (subject_kind = 'class') and every labour class assignment is deleted.
-- Reverse 1721 first (its reader reads the objects dropped here).
CREATE OR REPLACE FUNCTION public.save_labour_cost_rate(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.labour_cost_gate();
  v_kind text := p->>'subject_kind';
  v_person uuid; v_role text; v_class uuid; v_basis text := p->>'basis';
  v_amount numeric; v_mult numeric; v_day numeric; v_month numeric; v_from date; v_to date; v_id uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'rate must be a JSON object' using errcode = '22023'; end if;
  if v_kind is null or v_kind not in ('person', 'role') then raise exception 'subject_kind must be person or role' using errcode = '22023'; end if;
  if v_basis is null or v_basis not in ('hourly', 'daily', 'monthly') then raise exception 'basis must be hourly, daily or monthly' using errcode = '22023'; end if;
  begin
    v_amount := (p->>'amount')::numeric;
    v_mult := coalesce((p->>'overtime_multiplier')::numeric, 1);
    v_day := coalesce((p->>'day_hours')::numeric, 8);
    v_month := coalesce((p->>'month_hours')::numeric, 173);
    v_from := (p->>'effective_from')::date;
    v_to := nullif(p->>'effective_to', '')::date;
    v_class := (p->>'class_id')::uuid;
    if v_kind = 'person' then v_person := (p->>'person_id')::uuid; else v_role := p->>'role_key'; perform v_role::public.user_role; end if;
  exception when others then
    raise exception 'a rate field is missing or not valid' using errcode = '22023';
  end;
  if v_amount is null or v_amount <= 0 or v_amount >= 1e12 or round(v_amount, 2) <> v_amount then raise exception 'amount must be greater than 0 with at most 2 decimals' using errcode = '22023'; end if;
  if v_mult < 1 or v_mult > 5 then raise exception 'overtime multiplier must be between 1 and 5' using errcode = '22023'; end if;
  if v_day < 1 or v_day > 24 then raise exception 'day length must be between 1 and 24 hours' using errcode = '22023'; end if;
  if v_month < 1 or v_month > 744 then raise exception 'month length must be between 1 and 744 hours' using errcode = '22023'; end if;
  if v_from is null then raise exception 'start date is required' using errcode = '22023'; end if;
  if v_to is not null and v_to < v_from then raise exception 'end date is before the start date' using errcode = '22023'; end if;
  if not exists (select 1 from public.labour_cost_classes c where c.id = v_class and c.org_id = v_org and c.archived_at is null) then
    raise exception 'class not found or archived' using errcode = '22023';
  end if;
  if v_kind = 'person' and not exists (select 1 from public.profiles pr where pr.id = v_person and pr.org_id = v_org) then
    raise exception 'person not found' using errcode = '22023';
  end if;
  if public.labour_rate_locked(v_org, null, v_kind, v_person, v_role, v_from) then
    raise exception 'LCM_RATE_LOCKED: this rate would change hours already priced on approved timesheets; start it after the last priced day' using errcode = '23514';
  end if;
  insert into public.labour_cost_rates (org_id, subject_kind, person_id, role_key, class_id, basis, amount, overtime_multiplier,
                                        day_hours, month_hours, effective_from, effective_to, created_by)
  values (v_org, v_kind, v_person, v_role, v_class, v_basis, v_amount, v_mult, v_day, v_month, v_from, v_to, auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'a rate for this person or role already starts on that date' using errcode = '23505';
end $function$

;

CREATE OR REPLACE FUNCTION public.end_labour_cost_rate(p_id uuid, p_end date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid := public.labour_cost_gate(); r public.labour_cost_rates;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into r from public.labour_cost_rates where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'rate not found' using errcode = 'P0002'; end if;
  if p_end is null or p_end < r.effective_from then raise exception 'end date is before the start date' using errcode = '22023'; end if;
  if p_end > coalesce(r.effective_to, p_end) then
    -- Moving the end later adds a span: no approved hour inside it may already be priced.
    if exists (
      select 1 from public.timesheet_entries e
        join public.timesheets t on t.id = e.timesheet_id
       where e.org_id = v_org and t.org_id = v_org and t.status = 'Approved' and e.hours > 0
         and e.entry_date > r.effective_to and e.entry_date <= p_end
         and ((r.subject_kind = 'person' and t.user_id = r.person_id)
              or (r.subject_kind = 'role' and exists (select 1 from public.profiles pr
                   where pr.id = t.user_id and pr.org_id = v_org and pr.role::text = r.role_key)))
         and exists (select 1 from public.labour_rate_for(v_org, t.user_id, e.entry_date) x where x.id <> r.id)
    ) then
      raise exception 'LCM_RATE_LOCKED: hours in the added span are already priced' using errcode = '23514';
    end if;
  end if;
  if public.labour_rate_locked(v_org, p_id, null, null, null, p_end + 1) then
    raise exception 'LCM_RATE_LOCKED: hours after that date are already priced by this rate' using errcode = '23514';
  end if;
  update public.labour_cost_rates set effective_to = p_end where id = p_id;
  perform public.log_audit('labour_cost_rate.end', v_org, auth.uid(), p_id,
                           jsonb_build_object('effective_to', p_end, 'previous_effective_to', r.effective_to));
end $function$

;

CREATE OR REPLACE FUNCTION public.archive_labour_cost_rate(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid := public.labour_cost_gate(); r public.labour_cost_rates;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into r from public.labour_cost_rates where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'rate not found' using errcode = 'P0002'; end if;
  if public.labour_rate_locked(v_org, p_id, null, null, null, date '0001-01-01') then
    raise exception 'LCM_RATE_LOCKED: hours are already priced by this rate' using errcode = '23514';
  end if;
  update public.labour_cost_rates set archived_at = now() where id = p_id;
  perform public.log_audit('labour_cost_rate.archive', v_org, auth.uid(), p_id,
                           jsonb_build_object('subject_kind', r.subject_kind, 'effective_from', r.effective_from,
                                              'effective_to', r.effective_to));
end $function$

;

revoke all on function public.save_labour_cost_rate(jsonb) from public, anon;
grant execute on function public.save_labour_cost_rate(jsonb) to authenticated;
revoke all on function public.end_labour_cost_rate(uuid, date) from public, anon;
grant execute on function public.end_labour_cost_rate(uuid, date) to authenticated;
revoke all on function public.archive_labour_cost_rate(uuid) from public, anon;
grant execute on function public.archive_labour_cost_rate(uuid) to authenticated;

drop function public.archive_labour_class_assignment(uuid);
drop function public.end_labour_class_assignment(uuid, date);
drop function public.save_labour_class_assignment(jsonb);
drop function public.labour_class_locked(uuid, text, uuid, date);
drop function public.labour_attendance_priced_by(uuid, uuid, date);
drop function public.labour_class_rate_for(uuid, uuid, date);
drop function public.labour_class_for(uuid, uuid, date);
drop view public.labour_cost_attendance_days;
drop table public.labour_class_assignments;

delete from public.labour_cost_rates where subject_kind = 'class';
drop index public.labour_cost_rates_one_start;
create unique index labour_cost_rates_one_start on public.labour_cost_rates
  (org_id, subject_kind, coalesce(person_id::text, role_key), effective_from) where archived_at is null;
alter table public.labour_cost_rates drop constraint labour_cost_rates_subject;
alter table public.labour_cost_rates add constraint labour_cost_rates_subject check (
  (subject_kind = 'person' and person_id is not null and role_key is null)
  or (subject_kind = 'role' and person_id is null and role_key is not null));
alter table public.labour_cost_rates drop constraint labour_cost_rates_subject_kind_check;
alter table public.labour_cost_rates add constraint labour_cost_rates_subject_kind_check check (subject_kind in ('person', 'role'));
