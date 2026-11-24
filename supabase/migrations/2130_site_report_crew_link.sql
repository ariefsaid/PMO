-- 2130_site_report_crew_link.sql — a daily site report may be linked to a crew, or to a named person when no crew applies
-- (docs/specs/site-report-crew-link.spec.md, FR-SRC-001..006). Optional: existing reports stay valid with no link.
--   * daily_site_reports.crew_id / person_id (at most one), indexed for the list's crew filter.
--   * dsr_save_draft takes optional crew_id / person_id (a payload without the keys keeps the link); dsr_correct copies it.
-- Both functions are restated from their latest bodies (1041, read from the database at head).
-- Reversal: rollback/2130_site_report_crew_link_down.sql. Proven by supabase/tests/2130_site_report_crew_link.test.sql.

alter table public.daily_site_reports
  add column crew_id   uuid references public.crews(id),
  add column person_id uuid references public.people(id),
  add constraint daily_site_reports_one_link check (crew_id is null or person_id is null);
create index daily_site_reports_crew on public.daily_site_reports (crew_id, work_date desc) where crew_id is not null;
create index daily_site_reports_person on public.daily_site_reports (person_id) where person_id is not null;

CREATE OR REPLACE FUNCTION public.dsr_save_draft(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid; v_uid uuid := auth.uid(); v_id uuid; v_req uuid; v_wo record; v_date date; r public.daily_site_reports;
  v_variant uuid; v_weather uuid; v_start time; v_end time; v_crew uuid; v_person uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.dsr_require_member();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'report must be an object' using errcode = '22023'; end if;
  begin v_id := (p->>'id')::uuid; v_req := (p->>'client_request_id')::uuid; v_variant := (p->>'variant_id')::uuid;
        v_weather := (p->>'weather_id')::uuid; v_start := (p->>'start_time')::time; v_end := (p->>'end_time')::time;
  exception when others then raise exception 'malformed report field' using errcode = '22023'; end;

  -- The link is optional and a payload without the keys leaves it as it is (a queued older client never wipes it).
  begin v_crew := (p->>'crew_id')::uuid; v_person := (p->>'person_id')::uuid;
  exception when others then raise exception 'malformed report field' using errcode = '22023'; end;

  if v_id is null then
    -- NFR-DSR-004: a retried create returns the report it already made.
    if v_req is not null then
      select id into v_id from public.daily_site_reports where org_id = v_org and client_request_id = v_req;
      if v_id is not null then return v_id; end if;
    end if;
    begin v_date := (p->>'work_date')::date; exception when others then v_date := null; end;
    if v_date is null then raise exception 'work_date is required' using errcode = '22023'; end if;
    select w.id, w.project_id, w.status into v_wo from public.work_orders w
     where w.id = (p->>'work_order_id')::uuid and w.org_id = v_org;
    if v_wo.id is null then raise exception 'work order not found' using errcode = 'P0002'; end if;
    if not public.dsr_may_enter(v_wo.project_id) then
      raise exception 'you cannot enter site reports on this project' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('dsr:' || v_wo.id::text || ':' || v_date::text, 0));
    if exists (select 1 from public.daily_site_reports d where d.work_order_id = v_wo.id and d.work_date = v_date
                and d.supersedes_id is null and d.archived_at is null) then
      raise exception 'A report exists for this date' using errcode = '23505';
    end if;
    insert into public.daily_site_reports (org_id, project_id, work_order_id, work_date, author_id, client_request_id)
    values (v_org, v_wo.project_id, v_wo.id, v_date, v_uid, v_req) returning * into r;
    perform public.dsr_log(r.id, v_org, 'created', null);
  else
    select * into r from public.daily_site_reports where id = v_id and org_id = v_org for update;
    if r.id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
    if r.status not in ('draft','returned') then
      raise exception 'only a draft or returned report can be edited' using errcode = '42501';
    end if;
    if r.author_id <> v_uid and not public.dsr_may_enter(r.project_id) then
      raise exception 'you cannot edit this report' using errcode = '42501';
    end if;
  end if;

  if v_variant is not null and not exists (select 1 from public.rate_catalogue_variants v where v.id = v_variant and v.project_id = r.project_id) then
    raise exception 'work location must belong to this contract' using errcode = '23514';
  end if;
  if v_weather is not null and not exists (select 1 from public.dsr_weather_conditions w where w.id = v_weather and w.org_id = v_org) then
    raise exception 'unknown weather' using errcode = '23503';
  end if;
  if p ? 'crew_id' or p ? 'person_id' then
    if v_crew is not null and v_person is not null then
      raise exception 'SR_LINK: link a report to a crew or to a person, not both' using errcode = '23514';
    end if;
    if v_crew is not null and not exists (select 1 from public.crews c where c.id = v_crew and c.org_id = v_org) then
      raise exception 'SR_LINK: unknown crew' using errcode = '23503';
    end if;
    if v_person is not null and not exists (select 1 from public.people pe where pe.id = v_person and pe.org_id = v_org) then
      raise exception 'SR_LINK: unknown person' using errcode = '23503';
    end if;
    update public.daily_site_reports set crew_id = v_crew, person_id = v_person where id = r.id;
  end if;
  update public.daily_site_reports set variant_id = v_variant, start_time = v_start, end_time = v_end, weather_id = v_weather,
         weather_note = nullif(btrim(coalesce(p->>'weather_note', '')), ''), note = nullif(btrim(coalesce(p->>'note', '')), ''),
         updated_at = now()
   where id = r.id returning * into r;
  perform public.dsr_replace_lines(r, p);
  return r.id;
end $function$;

CREATE OR REPLACE FUNCTION public.dsr_correct(p_report uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid; r public.daily_site_reports; n public.daily_site_reports; v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.dsr_require_member();
  if char_length(v_reason) not between 1 and 500 then raise exception 'a reason is required to correct a report' using errcode = '22023'; end if;
  select * into r from public.daily_site_reports where id = p_report and org_id = v_org for update;
  if r.id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  if r.status <> 'validated' or r.superseded_at is not null then
    raise exception 'only the current validated report can be corrected' using errcode = '42501';
  end if;
  if not public.dsr_may_validate(r.project_id) then raise exception 'you cannot correct this report' using errcode = '42501'; end if;
  if exists (select 1 from public.daily_site_reports d where d.supersedes_id = r.id) then
    raise exception 'a correction of this report already exists' using errcode = '23505';
  end if;
  insert into public.daily_site_reports (org_id, project_id, work_order_id, work_date, version, supersedes_id, correction_reason,
         author_id, crew_id, person_id, variant_id, start_time, end_time, weather_id, weather_note, note)
  values (v_org, r.project_id, r.work_order_id, r.work_date, r.version + 1, r.id, v_reason,
         auth.uid(), r.crew_id, r.person_id, r.variant_id, r.start_time, r.end_time, r.weather_id, r.weather_note, r.note)
  returning * into n;
  insert into public.dsr_progress_lines (org_id, report_id, position, work_order_line_id, section_id, sub_stage, quantity, unit, crew_id)   -- 1184: crew carried, 1171: section carried
    select org_id, n.id, position, work_order_line_id, section_id, sub_stage, quantity, unit, crew_id from public.dsr_progress_lines where report_id = r.id;
  insert into public.dsr_idle_periods (org_id, report_id, position, minutes, reason_id)
    select org_id, n.id, position, minutes, reason_id from public.dsr_idle_periods where report_id = r.id;
  insert into public.dsr_consumables (org_id, report_id, position, stock_item_id, quantity, unit, work_order_line_id)   -- 2676 carried
    select org_id, n.id, position, stock_item_id, quantity, unit, work_order_line_id from public.dsr_consumables where report_id = r.id;   -- 2676 carried
  insert into public.dsr_photos (org_id, report_id, kind, file_path, uploaded_by_id)
    select org_id, n.id, kind, file_path, uploaded_by_id from public.dsr_photos where report_id = r.id;
  perform public.dsr_log(n.id, v_org, 'corrected', v_reason);
  return n.id;
end $function$;
