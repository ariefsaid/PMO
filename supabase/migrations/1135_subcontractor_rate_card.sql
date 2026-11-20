-- 1135_subcontractor_rate_card.sql — #2584 Slice 1: the subcontractor rate card, and the crew on a progress line.
-- Spec docs/specs/subcontractor-progress-certificate.spec.md (FR-SPC-001..003, FR-SPC-019/020; OD-SPC-1/2/3) ·
-- Plan docs/plans/2026-11-20-subcontractor-progress-certificate.md. Proven by supabase/tests/subcontract_rate_card.test.sql.
-- Rollback: rollback/1135_subcontractor_rate_card_down.sql (refused while a rate line or a crewed progress line exists).
--
-- §1 The rate card: one cost rate per (vendor company, contract item) per month window. It is NOT the client rate catalogue
--    (#2520) and NOT the T&M card (0515): paying the vendor the client's selling price is the defect OD-SPC-2 names.
--    Windows start on a month's first day and end on a month's last day (OD-SPC-3), so one rate applies per item per
--    certificate; an exclusion constraint refuses overlap. Written only by set_subcontractor_rate (Admin, Finance).
-- §2 The crew on a progress line (OD-SPC-1): nullable, so own-crew and unattributed work stays out of a certificate.
--    dsr_replace_lines / dsr_correct are the 1041 bodies plus the crew (marked `-- 1135`).

create table public.subcontractor_rate_lines (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  vendor_company_id uuid not null references public.companies(id),
  boq_item_id       uuid not null references public.boq_items(id),
  unit              text not null check (char_length(btrim(unit)) between 1 and 20),
  rate              numeric(14,2) not null check (rate >= 0 and rate < 'Infinity'::numeric),
  currency          text not null check (currency ~ '^[A-Z]{3}$'),
  effective_from    date not null,
  effective_to      date,
  version           integer not null check (version >= 1),
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint subcontractor_rate_lines_from_month_start check (effective_from = date_trunc('month', effective_from)::date),
  constraint subcontractor_rate_lines_to_month_end check
    (effective_to is null or effective_to = (date_trunc('month', effective_to) + interval '1 month - 1 day')::date),
  constraint subcontractor_rate_lines_window check (effective_to is null or effective_to >= effective_from),
  constraint subcontractor_rate_lines_version unique (org_id, vendor_company_id, boq_item_id, version),
  constraint subcontractor_rate_lines_no_overlap exclude using gist (
    org_id with =, vendor_company_id with =, boq_item_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&)
);
create index subcontractor_rate_lines_lookup on public.subcontractor_rate_lines (org_id, vendor_company_id, boq_item_id, effective_from desc);
create index subcontractor_rate_lines_item on public.subcontractor_rate_lines (boq_item_id);
comment on table public.subcontractor_rate_lines is
  '#2584: cost rate the subcontractor is paid, per vendor company, contract item and month window. Written only by set_subcontractor_rate.';

-- Same-organisation references, and the shape guard: only set_subcontractor_rate writes, and only effective_to may move.
create function public.guard_subcontractor_rate_line() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a rate line is never deleted; it is ended and replaced' using errcode = '42501';
  end if;
  if coalesce(current_setting('pmo.spc_rate_write', true), '') <> 'on' then
    raise exception 'rate lines are written only through set_subcontractor_rate' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if (new.id, new.org_id, new.vendor_company_id, new.boq_item_id, new.unit, new.rate, new.currency, new.effective_from, new.version)
       is distinct from (old.id, old.org_id, old.vendor_company_id, old.boq_item_id, old.unit, old.rate, old.currency, old.effective_from, old.version) then
      raise exception 'a rate line changes only by ending its window' using errcode = '42501';
    end if;
    return new;
  end if;
  if not exists (select 1 from public.companies c where c.id = new.vendor_company_id and c.org_id = new.org_id)
     or not exists (select 1 from public.boq_items b where b.id = new.boq_item_id and b.org_id = new.org_id) then
    raise exception 'the vendor and the contract item must belong to this organisation' using errcode = '23503';
  end if;
  return new;
end $$;
revoke all on function public.guard_subcontractor_rate_line() from public, anon, authenticated;
create trigger subcontractor_rate_lines_guard before insert or update or delete on public.subcontractor_rate_lines
  for each row execute function public.guard_subcontractor_rate_line();

-- Who may read a vendor's rate lines (FR-SPC-003): Admin, Executive and Finance every vendor; a Project Manager only the
-- vendors of subcontract purchases on projects they manage; an Engineer and a field controller none.
create function public.spc_may_read_rates(p_vendor uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select (select public.is_active_member()) and (
    (select public.auth_role()) in ('Admin', 'Executive', 'Finance')
    or ((select public.auth_role()) = 'Project Manager' and exists (
          select 1 from public.procurements pr join public.projects pj on pj.id = pr.project_id
           where pr.org_id = (select public.auth_org_id()) and pr.is_subcontract and pr.vendor_id = p_vendor
             and pj.org_id = pr.org_id and pj.project_manager_id = (select auth.uid()))))
$$;
revoke all on function public.spc_may_read_rates(uuid) from public, anon;
grant execute on function public.spc_may_read_rates(uuid) to authenticated;

alter table public.subcontractor_rate_lines enable row level security;
alter table public.subcontractor_rate_lines force row level security;
create policy subcontractor_rate_lines_select on public.subcontractor_rate_lines for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and public.spc_may_read_rates(vendor_company_id));
revoke all on public.subcontractor_rate_lines from public, anon, authenticated;
grant select on public.subcontractor_rate_lines to authenticated;
grant all on public.subcontractor_rate_lines to service_role;

-- Set a rate from a month on. With no window end it replaces the open-ended line in force: that line is ended the day before
-- and the next version starts (earlier periods keep the version current on their dates). Any other overlap is refused.
create function public.set_subcontractor_rate(
  p_vendor uuid, p_boq_item uuid, p_unit text, p_rate numeric, p_currency text, p_effective_from date, p_effective_to date default null)
  returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_id uuid; v_version integer; v_prev public.subcontractor_rate_lines;
        v_unit text := btrim(coalesce(p_unit, '')); v_cur text := upper(btrim(coalesce(p_currency, '')));
begin
  perform public.assert_is_active_member();
  if v_org is null or public.auth_role() not in ('Admin', 'Finance') then
    raise exception 'only Admin and Finance keep the subcontractor rate card' using errcode = '42501';
  end if;
  perform public.assert_feature_on(v_org, 'procurement');
  if p_vendor is null or p_boq_item is null or p_effective_from is null or p_rate is null
     or p_rate < 0 or p_rate >= 'Infinity'::numeric or round(p_rate, 2) <> p_rate
     or char_length(v_unit) not between 1 and 20 or v_cur !~ '^[A-Z]{3}$' then
    raise exception 'a rate line needs a vendor, a contract item, a unit, a rate with at most 2 decimals and a currency' using errcode = '22023';
  end if;
  if p_effective_from <> date_trunc('month', p_effective_from)::date then
    raise exception 'a rate takes effect on the first day of a month' using errcode = '23514', detail = 'rate-not-month-start';
  end if;
  if p_effective_to is not null and (p_effective_to < p_effective_from
       or p_effective_to <> (date_trunc('month', p_effective_to) + interval '1 month - 1 day')::date) then
    raise exception 'a rate window ends on the last day of a month, not before it starts' using errcode = '23514', detail = 'rate-not-month-end';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_vendor and c.org_id = v_org)
     or not exists (select 1 from public.boq_items b where b.id = p_boq_item and b.org_id = v_org) then
    raise exception 'vendor or contract item not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('spc_rate:' || p_vendor::text || ':' || p_boq_item::text, 0));
  perform set_config('pmo.spc_rate_write', 'on', true);
  -- The open-ended line in force before the new start is ended the day before (a change, not an overlap).
  select * into v_prev from public.subcontractor_rate_lines
   where org_id = v_org and vendor_company_id = p_vendor and boq_item_id = p_boq_item
     and effective_to is null and effective_from < p_effective_from;
  if found then
    update public.subcontractor_rate_lines set effective_to = (p_effective_from - 1) where id = v_prev.id;
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.subcontractor_rate_lines
   where org_id = v_org and vendor_company_id = p_vendor and boq_item_id = p_boq_item;
  begin
    insert into public.subcontractor_rate_lines
      (org_id, vendor_company_id, boq_item_id, unit, rate, currency, effective_from, effective_to, version, created_by)
    values (v_org, p_vendor, p_boq_item, v_unit, p_rate, v_cur, p_effective_from, p_effective_to, v_version, auth.uid())
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'this rate window overlaps another rate line of the same vendor and item' using errcode = '23P01', detail = 'rate-overlap';
  end;
  perform set_config('pmo.spc_rate_write', '', true);
  perform public.log_audit('subcontractor_rate.set', v_org, auth.uid(), v_id, jsonb_build_object(
    'vendor_company_id', p_vendor, 'boq_item_id', p_boq_item, 'unit', v_unit, 'rate', p_rate, 'currency', v_cur,
    'effective_from', p_effective_from, 'effective_to', p_effective_to, 'version', v_version,
    'ended_line', v_prev.id, 'ended_line_rate', v_prev.rate));
  return v_id;
end $$;
revoke all on function public.set_subcontractor_rate(uuid, uuid, text, numeric, text, date, date) from public, anon;
grant execute on function public.set_subcontractor_rate(uuid, uuid, text, numeric, text, date, date) to authenticated;

-- ── §2 the crew on a progress line ───────────────────────────────────────────────────────────────────
alter table public.dsr_progress_lines add column crew_id uuid references public.crews(id);
create index dsr_progress_lines_crew on public.dsr_progress_lines (crew_id) where crew_id is not null;
grant select (crew_id) on public.dsr_progress_lines to authenticated;

create or replace function public.dsr_replace_lines(p_report public.daily_site_reports, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare e jsonb; v_pos integer; v_qty numeric; v_unit text; v_min integer; v_line uuid; v_item uuid; v_reason uuid; v_crew uuid;   -- 1135
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
    -- 1135 (OD-SPC-1): the optional performing crew. A crew of this organisation only; its kind decides later whether the
    -- work is a subcontractor's (the certificate reads a vendor crew's vendor).
    v_crew := null;
    if nullif(btrim(coalesce(e->>'crew_id', '')), '') is not null then
      begin v_crew := (e->>'crew_id')::uuid; exception when others then v_crew := null; end;
      if v_crew is null or not exists (select 1 from public.crews c where c.id = v_crew and c.org_id = p_report.org_id) then
        raise exception 'progress line % names a crew that is not in this organisation', v_pos using errcode = '23503';
      end if;
    end if;
    insert into public.dsr_progress_lines (org_id, report_id, position, work_order_line_id, sub_stage, quantity, unit, crew_id)
    values (p_report.org_id, p_report.id, v_pos, v_line, nullif(btrim(coalesce(e->>'sub_stage', '')), ''), v_qty, v_unit, v_crew);
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


create or replace function public.dsr_correct(p_report uuid, p_reason text) returns uuid
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
  insert into public.dsr_progress_lines (org_id, report_id, position, work_order_line_id, sub_stage, quantity, unit, crew_id)   -- 1135: crew carried
    select org_id, n.id, position, work_order_line_id, sub_stage, quantity, unit, crew_id from public.dsr_progress_lines where report_id = r.id;
  insert into public.dsr_idle_periods (org_id, report_id, position, minutes, reason_id)
    select org_id, n.id, position, minutes, reason_id from public.dsr_idle_periods where report_id = r.id;
  insert into public.dsr_consumables (org_id, report_id, position, stock_item_id, quantity, unit)
    select org_id, n.id, position, stock_item_id, quantity, unit from public.dsr_consumables where report_id = r.id;
  insert into public.dsr_photos (org_id, report_id, kind, file_path, uploaded_by_id)
    select org_id, n.id, kind, file_path, uploaded_by_id from public.dsr_photos where report_id = r.id;
  perform public.dsr_log(n.id, v_org, 'corrected', v_reason);
  return n.id;
end $$;

do $$
begin
  if not (select c.relforcerowsecurity from pg_class c where c.oid = 'public.subcontractor_rate_lines'::regclass) then
    raise exception '1135: subcontractor_rate_lines lacks FORCE RLS'; end if;
  if has_table_privilege('authenticated', 'public.subcontractor_rate_lines', 'INSERT')
     or has_table_privilege('authenticated', 'public.subcontractor_rate_lines', 'UPDATE')
     or has_table_privilege('authenticated', 'public.subcontractor_rate_lines', 'DELETE') then
    raise exception '1135: subcontractor_rate_lines holds a client DML grant'; end if;
  if has_function_privilege('anon', 'public.set_subcontractor_rate(uuid,uuid,text,numeric,text,date,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.spc_may_read_rates(uuid)', 'EXECUTE') then
    raise exception '1135: a rate card function is anon-executable'; end if;
end $$;
