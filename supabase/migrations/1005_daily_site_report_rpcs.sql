-- 1005_daily_site_report_rpcs.sql — #1522: the daily site report's writers and money reads.
-- Spec: docs/specs/daily-site-report.spec.md (FR-DSR-009..019). Proven by supabase/tests/dsr_report.test.sql.
--   dsr_save_draft   create (idempotent on client_request_id) or edit a draft/returned report and its lines
--   dsr_submit       draft|returned -> submitted
--   dsr_validate     submitted -> validated; the validator is never the author (SoD, ADR-0019); freezes rates
--   dsr_return       submitted -> returned with a reason
--   dsr_correct      a validated report -> a new draft version that supersedes it once validated
--   dsr_report_revenue / work_order_validated_revenue / dsr_validation_queue — money reads, rate-reader roles only
-- Role mapping until the field-controller and QS roles exist (#902): enter = Admin, Engineer, or the project's PM;
-- validate = Admin, Finance, or the project's PM. Revenue reads = the rate catalogue's readers (0955).
-- Reversal: rollback/1005_daily_site_report_rpcs_down.sql.

-- ── who may do what ─────────────────────────────────────────────────────────────────────────────────
create function public.dsr_may_enter(p_project uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and exists (
    select 1 from public.projects p
     where p.id = p_project and p.org_id = public.auth_org_id()
       and (public.auth_role() in ('Admin','Engineer')
            or (public.auth_role() = 'Project Manager' and p.project_manager_id = auth.uid()))), false)
$$;

create function public.dsr_may_validate(p_project uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and exists (
    select 1 from public.projects p
     where p.id = p_project and p.org_id = public.auth_org_id()
       and (public.auth_role() in ('Admin','Finance')
            or (public.auth_role() = 'Project Manager' and p.project_manager_id = auth.uid()))), false)
$$;

-- Same audience that may read the project's rate catalogue (0955 select policies).
create function public.dsr_may_see_revenue(p_project uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and exists (
    select 1 from public.projects p
     where p.id = p_project and p.org_id = public.auth_org_id()
       and (public.auth_role() in ('Admin','Finance','Executive')
            or (public.auth_role() = 'Project Manager' and p.project_manager_id = auth.uid()))), false)
$$;

-- ── the rate in force for one progress line (FR-DSR-010, OD-DSR-1/7) ───────────────────────────────────
-- Catalogue first: the contract line's catalogue item at the work location (the report's variant, else the line's
-- priced variant, else the project default) on the work date; a sub-stage takes its weight share of that rate.
-- A line priced by hand (no catalogue item) uses its contract rate; it has no stages. Nothing found -> no row.
create function public.dsr_line_rate(p_work_order_line uuid, p_sub_stage text, p_variant uuid, p_as_of date)
returns table (rate numeric, rate_id uuid, source text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b record; v_variant uuid; v_rate record; v_weight numeric; v_wfrom date;
begin
  select bi.id, bi.project_id, bi.rate, bi.catalogue_item_id, bi.catalogue_variant_id into b
    from public.work_order_lines l join public.boq_items bi on bi.id = l.boq_item_id where l.id = p_work_order_line;
  if b.id is null then return; end if;
  if b.catalogue_item_id is null then
    if p_sub_stage is null and b.rate > 0 then
      rate := b.rate; rate_id := null; source := 'contract'; return next;
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

-- Line amount: exact, rounded half-up to cents once per line (the FE's dsrRevenue.ts mirrors this).
create function public.dsr_line_amount(p_quantity numeric, p_rate numeric) returns numeric
language sql immutable set search_path = public, pg_temp as $$ select round(p_quantity * p_rate, 2) $$;

-- ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
create function public.dsr_log(p_report uuid, p_org uuid, p_action text, p_reason text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.dsr_events (org_id, report_id, action, actor_id, reason) values (p_org, p_report, p_action, auth.uid(), p_reason)
$$;

create function public.dsr_require_member() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or auth.uid() is null or not public.is_active_member() then
    raise exception 'active organization required' using errcode = '42501';
  end if;
  return v_org;
end $$;

-- Replace a draft's lines from the payload; every line is checked against the report's own work order.
create function public.dsr_replace_lines(p_report public.daily_site_reports, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare e jsonb; v_pos integer; v_qty numeric; v_unit text; v_min integer; v_line uuid; v_item uuid; v_reason uuid;
begin
  delete from public.dsr_progress_lines where report_id = p_report.id;
  delete from public.dsr_idle_periods where report_id = p_report.id;
  delete from public.dsr_consumables where report_id = p_report.id;

  v_pos := 0;
  for e in select * from jsonb_array_elements(coalesce(p->'progress', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    begin v_line := (e->>'work_order_line_id')::uuid; exception when others then v_line := null; end;
    select bi.unit into v_unit from public.work_order_lines l join public.boq_items bi on bi.id = l.boq_item_id
     where l.id = v_line and l.work_order_id = p_report.work_order_id and l.org_id = p_report.org_id;
    if v_unit is null then
      raise exception 'progress line % is not a contract item of this work order', v_pos using errcode = '23514';
    end if;
    begin v_qty := (e->>'quantity')::numeric; exception when others then v_qty := null; end;
    if v_qty is null or v_qty <= 0 or v_qty >= 100000000000 or round(v_qty, 3) <> v_qty then
      raise exception 'progress line % needs a positive quantity with at most 3 decimals', v_pos using errcode = '22023';
    end if;
    insert into public.dsr_progress_lines (org_id, report_id, position, work_order_line_id, sub_stage, quantity, unit)
    values (p_report.org_id, p_report.id, v_pos, v_line, nullif(btrim(coalesce(e->>'sub_stage', '')), ''), v_qty, v_unit);
  end loop;

  v_pos := 0;
  for e in select * from jsonb_array_elements(coalesce(p->'idle', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    begin v_min := (e->>'minutes')::integer; exception when others then v_min := null; end;
    if v_min is null or v_min not between 1 and 1440 then
      raise exception 'idle period % needs 1 to 1440 minutes', v_pos using errcode = '22023';
    end if;
    begin v_reason := (e->>'reason_id')::uuid; exception when others then v_reason := null; end;
    if not exists (select 1 from public.dsr_idle_reasons r where r.id = v_reason and r.org_id = p_report.org_id and r.archived_at is null) then
      raise exception 'idle period % has an unknown reason', v_pos using errcode = '23503';
    end if;
    insert into public.dsr_idle_periods (org_id, report_id, position, minutes, reason_id) values (p_report.org_id, p_report.id, v_pos, v_min, v_reason);
  end loop;

  v_pos := 0;
  for e in select * from jsonb_array_elements(coalesce(p->'consumables', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    begin v_item := (e->>'stock_item_id')::uuid; exception when others then v_item := null; end;
    select u.code into v_unit from public.stock_items s join public.stock_units u on u.id = s.unit_id
     where s.id = v_item and s.org_id = p_report.org_id;
    if v_unit is null then raise exception 'consumable % is not a stock item of this organisation', v_pos using errcode = '23503'; end if;
    begin v_qty := (e->>'quantity')::numeric; exception when others then v_qty := null; end;
    if v_qty is null or v_qty <= 0 or v_qty >= 100000000000 or round(v_qty, 3) <> v_qty then
      raise exception 'consumable % needs a positive quantity with at most 3 decimals', v_pos using errcode = '22023';
    end if;
    insert into public.dsr_consumables (org_id, report_id, position, stock_item_id, quantity, unit)
    values (p_report.org_id, p_report.id, v_pos, v_item, v_qty, v_unit);
  end loop;
end $$;

-- ── writers ─────────────────────────────────────────────────────────────────────────────────────────
-- p: {id?, client_request_id?, work_order_id, work_date, variant_id?, start_time?, end_time?, weather_id?,
--     weather_note?, note?, progress:[{work_order_line_id, sub_stage?, quantity}], idle:[{minutes, reason_id}],
--     consumables:[{stock_item_id, quantity}]}
create function public.dsr_save_draft(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); v_id uuid; v_req uuid; v_wo record; v_date date; r public.daily_site_reports;
  v_variant uuid; v_weather uuid; v_start time; v_end time;
begin
  perform public.assert_is_active_member();
  v_org := public.dsr_require_member();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'report must be an object' using errcode = '22023'; end if;
  begin v_id := (p->>'id')::uuid; v_req := (p->>'client_request_id')::uuid; v_variant := (p->>'variant_id')::uuid;
        v_weather := (p->>'weather_id')::uuid; v_start := (p->>'start_time')::time; v_end := (p->>'end_time')::time;
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
  update public.daily_site_reports set variant_id = v_variant, start_time = v_start, end_time = v_end, weather_id = v_weather,
         weather_note = nullif(btrim(coalesce(p->>'weather_note', '')), ''), note = nullif(btrim(coalesce(p->>'note', '')), ''),
         updated_at = now()
   where id = r.id returning * into r;
  perform public.dsr_replace_lines(r, p);
  return r.id;
end $$;

create function public.dsr_submit(p_report uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; r public.daily_site_reports;
begin
  perform public.assert_is_active_member();
  v_org := public.dsr_require_member();
  select * into r from public.daily_site_reports where id = p_report and org_id = v_org for update;
  if r.id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  if r.status = 'submitted' then return; end if;
  if r.status not in ('draft','returned') then raise exception 'only a draft or returned report can be submitted' using errcode = '42501'; end if;
  if r.author_id <> auth.uid() and not public.dsr_may_enter(r.project_id) then
    raise exception 'you cannot submit this report' using errcode = '42501';
  end if;
  update public.daily_site_reports set status = 'submitted', submitted_at = now(), updated_at = now() where id = r.id;
  perform public.dsr_log(r.id, v_org, 'submitted', null);
end $$;

create function public.dsr_validate(p_report uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); r public.daily_site_reports; l record; v record;
begin
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
  if not exists (select 1 from public.dsr_photos ph where ph.report_id = r.id and ph.kind = 'paper_form') then
    raise exception 'a photo of the paper form is required to validate' using errcode = '23514';
  end if;
  -- FR-DSR-011: freeze the rate in force on the work date.
  for l in select * from public.dsr_progress_lines where report_id = r.id loop
    select * into v from public.dsr_line_rate(l.work_order_line_id, l.sub_stage, r.variant_id, r.work_date);
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
end $$;

create function public.dsr_return(p_report uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; r public.daily_site_reports; v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.assert_is_active_member();
  v_org := public.dsr_require_member();
  if char_length(v_reason) not between 1 and 500 then raise exception 'a reason is required to return a report' using errcode = '22023'; end if;
  select * into r from public.daily_site_reports where id = p_report and org_id = v_org for update;
  if r.id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  if r.status <> 'submitted' then raise exception 'only a submitted report can be returned' using errcode = '42501'; end if;
  if r.author_id = auth.uid() or not public.dsr_may_validate(r.project_id) then
    raise exception 'you cannot return this report' using errcode = '42501';
  end if;
  update public.daily_site_reports set status = 'returned', returned_reason = v_reason, updated_at = now() where id = r.id;
  perform public.dsr_log(r.id, v_org, 'returned', v_reason);
end $$;

-- FR-DSR-018: a validated report never changes; a correction is a new version that supersedes it when validated.
create function public.dsr_correct(p_report uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; r public.daily_site_reports; n public.daily_site_reports; v_reason text := btrim(coalesce(p_reason, ''));
begin
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
         author_id, variant_id, start_time, end_time, weather_id, weather_note, note)
  values (v_org, r.project_id, r.work_order_id, r.work_date, r.version + 1, r.id, v_reason,
         auth.uid(), r.variant_id, r.start_time, r.end_time, r.weather_id, r.weather_note, r.note)
  returning * into n;
  insert into public.dsr_progress_lines (org_id, report_id, position, work_order_line_id, sub_stage, quantity, unit)
    select org_id, n.id, position, work_order_line_id, sub_stage, quantity, unit from public.dsr_progress_lines where report_id = r.id;
  insert into public.dsr_idle_periods (org_id, report_id, position, minutes, reason_id)
    select org_id, n.id, position, minutes, reason_id from public.dsr_idle_periods where report_id = r.id;
  insert into public.dsr_consumables (org_id, report_id, position, stock_item_id, quantity, unit)
    select org_id, n.id, position, stock_item_id, quantity, unit from public.dsr_consumables where report_id = r.id;
  insert into public.dsr_photos (org_id, report_id, kind, file_path, uploaded_by_id)
    select org_id, n.id, kind, file_path, uploaded_by_id from public.dsr_photos where report_id = r.id;
  perform public.dsr_log(n.id, v_org, 'corrected', v_reason);
  return n.id;
end $$;

-- ── money reads ─────────────────────────────────────────────────────────────────────────────────────
-- Per line: the frozen rate once validated, the live rate before (FR-DSR-010/011). Null rate = "no rate".
create function public.dsr_report_revenue(p_report uuid)
returns table (line_id uuid, rate numeric, rate_source text, amount numeric, frozen boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.daily_site_reports;
begin
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
      left join lateral public.dsr_line_rate(l.work_order_line_id, l.sub_stage, r.variant_id, r.work_date) v on true
     where l.report_id = r.id order by l.position;
  end if;
end $$;

-- FR-DSR-012/014: only validated, non-superseded reports count.
create function public.work_order_validated_revenue(p_work_order uuid) returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_project uuid;
begin
  perform public.dsr_require_member();
  select project_id into v_project from public.work_orders where id = p_work_order and org_id = public.auth_org_id();
  if v_project is null then raise exception 'work order not found' using errcode = 'P0002'; end if;
  if not public.dsr_may_see_revenue(v_project) then raise exception 'you cannot see revenue on this project' using errcode = '42501'; end if;
  return coalesce((select sum(l.frozen_amount) from public.dsr_progress_lines l
    join public.daily_site_reports d on d.id = l.report_id
   where d.work_order_id = p_work_order and d.status = 'validated' and d.superseded_at is null and d.archived_at is null), 0);
end $$;

-- FR-DSR-017: the QS queue, oldest first, for the caller's validatable projects.
create function public.dsr_validation_queue()
returns table (report_id uuid, project_id uuid, work_order_id uuid, work_order_label text, work_date date, author_id uuid,
               author_name text, submitted_at timestamptz, total_revenue numeric, unrated_lines integer, age_days integer,
               waiting_for_validator boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.dsr_require_member();
  return query
  select d.id, d.project_id, d.work_order_id, coalesce(w.wo_number || ' · ', '') || w.title, d.work_date, d.author_id,
         a.full_name, d.submitted_at,
         coalesce((select sum(public.dsr_line_amount(l.quantity, v.rate)) from public.dsr_progress_lines l
                   left join lateral public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date) v on true
                   where l.report_id = d.id), 0),
         (select count(*)::integer from public.dsr_progress_lines l
           where l.report_id = d.id and not exists (select 1 from public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date))),
         greatest(0, (current_date - d.work_date) - 1),
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
end $$;

-- ── photo rows and storage: the author or an enterer, while the report is editable ─────────────────────
create function public.dsr_photo_writable(p_report uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(exists (select 1 from public.daily_site_reports d
    where d.id = p_report and d.org_id = public.auth_org_id() and d.status in ('draft','returned')
      and public.is_active_member() and (d.author_id = auth.uid() or public.dsr_may_enter(d.project_id))), false)
$$;

create policy dsr_photos_insert on public.dsr_photos for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.dsr_photo_writable(report_id));
create policy dsr_photos_delete on public.dsr_photos for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.dsr_photo_writable(report_id));
grant insert (report_id, kind, file_path) on public.dsr_photos to authenticated;
grant delete on public.dsr_photos to authenticated;

create policy storage_objects_site_report_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'site-report-photos' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and exists (select 1 from public.daily_site_reports d where d.id::text = split_part(name, '/', 2)));
create policy storage_objects_site_report_photo_write on storage.objects for insert to authenticated
  with check (bucket_id = 'site-report-photos' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and public.dsr_photo_writable(nullif(split_part(name, '/', 2), '')::uuid));

-- ── seed the neutral default lists for every organisation, now and on creation ────────────────────────
create function public.dsr_seed_default_lists(p_org uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.dsr_idle_reasons (org_id, label)
    select p_org, x from unnest(array['Weather','Waiting for materials','Waiting for instruction','Equipment breakdown','Access not available','Other']) x
  on conflict do nothing;
  insert into public.dsr_weather_conditions (org_id, label)
    select p_org, x from unnest(array['Clear','Cloudy','Rain','Heavy rain']) x
  on conflict do nothing;
$$;
create function public.dsr_seed_default_lists_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.dsr_seed_default_lists(new.id); return new; end $$;
create trigger organizations_dsr_default_lists after insert on public.organizations
  for each row execute function public.dsr_seed_default_lists_trigger();
select public.dsr_seed_default_lists(id) from public.organizations;

-- ── grants: the writers and reads to authenticated; internals to nobody ───────────────────────────────
revoke all on function public.dsr_may_enter(uuid) from public, anon;
revoke all on function public.dsr_may_validate(uuid) from public, anon;
revoke all on function public.dsr_may_see_revenue(uuid) from public, anon;
grant execute on function public.dsr_may_enter(uuid) to authenticated;
grant execute on function public.dsr_may_validate(uuid) to authenticated;
grant execute on function public.dsr_may_see_revenue(uuid) to authenticated;
revoke all on function public.dsr_line_rate(uuid, text, uuid, date) from public, anon, authenticated;
revoke all on function public.dsr_line_amount(numeric, numeric) from public, anon;
grant execute on function public.dsr_line_amount(numeric, numeric) to authenticated;
revoke all on function public.dsr_log(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.dsr_require_member() from public, anon, authenticated;
revoke all on function public.dsr_replace_lines(public.daily_site_reports, jsonb) from public, anon, authenticated;
revoke all on function public.dsr_seed_default_lists(uuid) from public, anon, authenticated;
revoke all on function public.dsr_seed_default_lists_trigger() from public, anon, authenticated;
revoke all on function public.dsr_photo_writable(uuid) from public, anon;
grant execute on function public.dsr_photo_writable(uuid) to authenticated;
do $$ declare f text; begin
  foreach f in array array['dsr_save_draft(jsonb)','dsr_submit(uuid)','dsr_validate(uuid)','dsr_return(uuid,text)',
                           'dsr_correct(uuid,text)','dsr_report_revenue(uuid)','work_order_validated_revenue(uuid)',
                           'dsr_validation_queue()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
