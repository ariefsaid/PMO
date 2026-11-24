-- 2132_areas_and_area_rates.sql — areas and rates, generic (docs/specs/areas-and-area-rates.spec.md, FR-ARA-001..008).
-- The organisation's work-order areas already exist (1382/1383: Admin-kept list, a work order names one). This adds:
--   * work_order_areas.description (optional);
--   * boq_item_area_rates: a contract line may carry a rate per area (written by set_boq_item_area_rate; read by who read the money);
--   * daily_site_reports.area_id: an optional area on the report that overrides its work order's area for the rate;
--   * dsr_line_rate: a contract-priced line takes the area's rate (report area, else work order area), else the contract rate as today.
--     An organisation with no area rates sees no change. The frozen rate source stays 'contract'.
-- dsr_line_rate gains a fifth argument with a default; dsr_validate, dsr_validation_queue, dsr_report_revenue (its callers), dsr_save_draft
-- and dsr_correct are restated from their latest bodies (read from the database at head).
-- drops: each restated line gains the report's area (dsr_line_rate's fifth argument, the area variable, the column and value lists of dsr_correct); the lines are otherwise unchanged.
-- Reversal: rollback/2132_areas_and_area_rates_down.sql. Proven by supabase/tests/2132_areas_and_area_rates.test.sql.

alter table public.work_order_areas add column description text check (description is null or char_length(description) <= 500);
grant insert (description) on public.work_order_areas to authenticated;
grant update (description) on public.work_order_areas to authenticated;

create table public.boq_item_area_rates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  boq_item_id uuid not null references public.boq_items(id) on delete cascade,
  area_id     uuid not null,
  rate        numeric(24,8) not null check (rate > 0 and rate < 'Infinity'::numeric),
  set_by      uuid references public.profiles(id) default auth.uid(),
  set_at      timestamptz not null default now(),
  constraint boq_item_area_rates_one unique (boq_item_id, area_id),
  constraint boq_item_area_rates_area_same_org foreign key (org_id, area_id) references public.work_order_areas (org_id, id)
);
create index boq_item_area_rates_area_idx on public.boq_item_area_rates (org_id, area_id);
create index boq_item_area_rates_project_idx on public.boq_item_area_rates (project_id);
create index boq_item_area_rates_set_by_idx on public.boq_item_area_rates (set_by);
create trigger boq_item_area_rates_stamp_org_id before insert on public.boq_item_area_rates
  for each row execute function public.stamp_org_id();

alter table public.boq_item_area_rates enable row level security;
alter table public.boq_item_area_rates force row level security;
-- A rate is money: read by the roles that read a daily report's revenue on the project (dsr_may_see_revenue), nobody else.
create policy boq_item_area_rates_select on public.boq_item_area_rates for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.dsr_may_see_revenue(project_id));
create policy light_account_deny_select on public.boq_item_area_rates as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true);
revoke all on public.boq_item_area_rates from public, anon, authenticated;
grant select on public.boq_item_area_rates to authenticated;
grant all on public.boq_item_area_rates to service_role;

-- p_rate null removes the area's rate (the line falls back to its contract rate).
create function public.set_boq_item_area_rate(p_boq_item uuid, p_area uuid, p_rate numeric default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_b record;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_org is null or auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select bi.id, bi.project_id, bi.catalogue_item_id into v_b from public.boq_items bi where bi.id = p_boq_item and bi.org_id = v_org;
  if v_b.id is null then raise exception 'contract line not found' using errcode = 'P0002'; end if;
  if not public.dsr_may_write_revenue(v_b.project_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.work_order_areas a where a.id = p_area and a.org_id = v_org) then
    raise exception 'AREA_UNKNOWN: unknown area' using errcode = '23503';
  end if;
  if v_b.catalogue_item_id is not null then
    raise exception 'AREA_RATE_CATALOGUE: a line priced from the rate catalogue takes its rate from the catalogue' using errcode = '23514';
  end if;
  if p_rate is null then
    delete from public.boq_item_area_rates r where r.boq_item_id = p_boq_item and r.area_id = p_area;
  else
    if p_rate <= 0 or p_rate >= 'Infinity'::numeric then raise exception 'AREA_RATE: a rate is a positive number' using errcode = '22023'; end if;
    insert into public.boq_item_area_rates (org_id, project_id, boq_item_id, area_id, rate, set_by)
    values (v_org, v_b.project_id, p_boq_item, p_area, p_rate, auth.uid())
    on conflict (boq_item_id, area_id) do update set rate = excluded.rate, set_by = excluded.set_by, set_at = now();
  end if;
  perform public.log_audit('boq_item.area_rate', v_org, auth.uid(), p_boq_item,
            jsonb_build_object('area_id', p_area, 'rate', p_rate));
end $$;
revoke all on function public.set_boq_item_area_rate(uuid, uuid, numeric) from public, anon;
grant execute on function public.set_boq_item_area_rate(uuid, uuid, numeric) to authenticated;

alter table public.daily_site_reports add column area_id uuid;
alter table public.daily_site_reports add constraint daily_site_reports_area_same_org
  foreign key (org_id, area_id) references public.work_order_areas (org_id, id);
create index daily_site_reports_area_idx on public.daily_site_reports (org_id, area_id) where area_id is not null;

drop function public.dsr_line_rate(uuid, text, uuid, date);
create function public.dsr_line_rate(p_work_order_line uuid, p_sub_stage text, p_variant uuid, p_as_of date, p_area uuid default null)
returns table (rate numeric, rate_id uuid, source text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b record; v_variant uuid; v_rate record; v_weight numeric; v_wfrom date; v_area uuid; v_area_rate numeric;
begin
  select bi.id, bi.project_id, bi.rate, bi.catalogue_item_id, bi.catalogue_variant_id, w.area_id as wo_area into b
    from public.work_order_lines l join public.boq_items bi on bi.id = l.boq_item_id
    join public.work_orders w on w.id = l.work_order_id where l.id = p_work_order_line;
  if b.id is null then return; end if;
  if b.catalogue_item_id is null then
    if p_sub_stage is null and b.rate > 0 then
      -- A contract rate may carry a rate per area: the report's own area, else the work order's, when one is set for this line.
      v_area := coalesce(p_area, b.wo_area);
      if v_area is not null then
        select ar.rate into v_area_rate from public.boq_item_area_rates ar where ar.boq_item_id = b.id and ar.area_id = v_area;
      end if;
      rate := coalesce(v_area_rate, b.rate); rate_id := null; source := 'contract'; return next;
    end if;
    return;
  end if;
  v_variant := coalesce(p_variant, b.catalogue_variant_id,
    (select v.id from public.rate_catalogue_variants v where v.project_id = b.project_id and v.is_default));
  if v_variant is null then return; end if;
  select r.id, r.rate into v_rate from public.rate_catalogue_rates r
   where r.item_id = b.catalogue_item_id and r.variant_id = v_variant and r.effective_from <= p_as_of
   order by r.effective_from desc limit 1;
  if v_rate.id is null then return; end if;
  if p_sub_stage is null then
    rate := v_rate.rate; rate_id := v_rate.id; source := 'catalogue'; return next; return;
  end if;
  select max(w.effective_from) into v_wfrom from public.rate_catalogue_stage_weights w
   where w.item_id = b.catalogue_item_id and w.effective_from <= p_as_of;
  select w.weight_pct into v_weight from public.rate_catalogue_stage_weights w
   where w.item_id = b.catalogue_item_id and w.effective_from = v_wfrom and lower(w.stage) = lower(btrim(p_sub_stage));
  if v_weight is null then return; end if;
  rate := v_rate.rate * v_weight / 100; rate_id := v_rate.id; source := 'catalogue'; return next;
end $$;

revoke all on function public.dsr_line_rate(uuid, text, uuid, date, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dsr_save_draft(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid; v_uid uuid := auth.uid(); v_id uuid; v_req uuid; v_wo record; v_date date; r public.daily_site_reports;
  v_variant uuid; v_weather uuid; v_start time; v_end time; v_crew uuid; v_person uuid; v_area uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.dsr_require_member();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'report must be an object' using errcode = '22023'; end if;
  begin v_id := (p->>'id')::uuid; v_req := (p->>'client_request_id')::uuid; v_variant := (p->>'variant_id')::uuid;
        v_weather := (p->>'weather_id')::uuid; v_start := (p->>'start_time')::time; v_end := (p->>'end_time')::time;
  exception when others then raise exception 'malformed report field' using errcode = '22023'; end;

  -- The link is optional and a payload without the keys leaves it as it is (a queued older client never wipes it).
  begin v_crew := (p->>'crew_id')::uuid; v_person := (p->>'person_id')::uuid; v_area := (p->>'area_id')::uuid;
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
  if p ? 'area_id' then
    if v_area is not null and not exists (select 1 from public.work_order_areas a where a.id = v_area and a.org_id = v_org) then
      raise exception 'AREA_UNKNOWN: unknown area' using errcode = '23503';
    end if;
    update public.daily_site_reports set area_id = v_area where id = r.id;
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
         author_id, area_id, crew_id, person_id, variant_id, start_time, end_time, weather_id, weather_note, note)
  values (v_org, r.project_id, r.work_order_id, r.work_date, r.version + 1, r.id, v_reason,
         auth.uid(), r.area_id, r.crew_id, r.person_id, r.variant_id, r.start_time, r.end_time, r.weather_id, r.weather_note, r.note)
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

CREATE OR REPLACE FUNCTION public.dsr_validate(p_report uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid; v_uid uuid := auth.uid(); r public.daily_site_reports; l record; v record;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.dsr_require_member();
  select * into r from public.daily_site_reports where id = p_report and org_id = v_org for update;
  if r.id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  if r.status <> 'submitted' then raise exception 'only a submitted report can be validated' using errcode = '42501'; end if;
  -- FR-DSR-015: separation of duties, no sole-user exception.
  if r.author_id = v_uid then
    raise exception 'the author of a report cannot validate it' using errcode = '42501';
  end if;
  if not public.dsr_may_validate(r.project_id) then
    raise exception 'you cannot validate site reports on this project' using errcode = '42501';
  end if;
  -- OD-DSR-4: the paper form's photo is the evidence.
  if not exists (select 1 from public.dsr_photos ph where ph.report_id = r.id and ph.kind = 'paper_form'
                 and public.dsr_photo_stored(ph.file_path)) then
    raise exception 'a photo of the paper form is required to validate' using errcode = '23514';
  end if;
  -- FR-DSR-011: freeze the rate in force on the work date.
  for l in select * from public.dsr_progress_lines where report_id = r.id loop
    select * into v from public.dsr_line_rate(l.work_order_line_id, l.sub_stage, r.variant_id, r.work_date, r.area_id);
    update public.dsr_progress_lines set frozen_rate = v.rate, frozen_rate_id = v.rate_id, frozen_rate_source = v.source,
           frozen_amount = case when v.rate is null then null else public.dsr_line_amount(l.quantity, v.rate) end, frozen_at = now()
     where id = l.id;
  end loop;
  update public.daily_site_reports set status = 'validated', validated_by = v_uid, validated_at = now(), updated_at = now() where id = r.id;
  perform public.dsr_log(r.id, v_org, 'validated', null);
  if r.supersedes_id is not null then
    update public.daily_site_reports set superseded_at = now() where id = r.supersedes_id and superseded_at is null;
    perform public.dsr_log(r.supersedes_id, v_org, 'superseded', r.correction_reason);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.dsr_validation_queue()
 RETURNS TABLE(report_id uuid, project_id uuid, work_order_id uuid, work_order_label text, work_date date, author_id uuid, author_name text, submitted_at timestamp with time zone, total_revenue numeric, unrated_lines integer, age_days integer, waiting_for_validator boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.assert_not_light();
  perform public.dsr_require_member();
  return query
  select d.id, d.project_id, d.work_order_id, coalesce(w.wo_number || ' · ', '') || w.title, d.work_date, d.author_id,
         a.full_name, d.submitted_at,
         coalesce((select sum(public.dsr_line_amount(l.quantity, v.rate)) from public.dsr_progress_lines l
                   left join lateral public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date, d.area_id) v on true
                   where l.report_id = d.id), 0),
         (select count(*)::integer from public.dsr_progress_lines l
           where l.report_id = d.id and not exists (select 1 from public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date, d.area_id))),
         greatest(0, (public.equipment_org_today(d.org_id) - d.work_date) - 1),
         not exists (select 1 from public.profiles pr join public.projects p on p.id = d.project_id
                      where pr.org_id = d.org_id and pr.status = 'active' and pr.id <> d.author_id
                        and (pr.role in ('Admin','Finance') or (pr.role = 'Project Manager' and p.project_manager_id = pr.id)))
    from public.daily_site_reports d
    join public.work_orders w on w.id = d.work_order_id
    left join public.profiles a on a.id = d.author_id
   where d.org_id = public.auth_org_id() and d.status = 'submitted' and d.archived_at is null
     and public.dsr_may_validate(d.project_id)
   order by d.submitted_at, d.id
   limit 500;
end $function$;

CREATE OR REPLACE FUNCTION public.dsr_report_revenue(p_report uuid)
 RETURNS TABLE(line_id uuid, rate numeric, rate_source text, amount numeric, frozen boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r public.daily_site_reports;
begin
  perform public.assert_not_light();
  perform public.dsr_require_member();
  select * into r from public.daily_site_reports where id = p_report and org_id = public.auth_org_id();
  if r.id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  if not public.dsr_may_see_revenue(r.project_id) then raise exception 'you cannot see revenue on this project' using errcode = '42501'; end if;
  if r.status = 'validated' then
    return query select l.id, l.frozen_rate, l.frozen_rate_source, l.frozen_amount, true
      from public.dsr_progress_lines l where l.report_id = r.id order by l.position;
  else
    return query select l.id, v.rate, v.source, case when v.rate is null then null else public.dsr_line_amount(l.quantity, v.rate) end, false
      from public.dsr_progress_lines l
      left join lateral public.dsr_line_rate(l.work_order_line_id, l.sub_stage, r.variant_id, r.work_date, r.area_id) v on true
     where l.report_id = r.id order by l.position;
  end if;
end $function$;

