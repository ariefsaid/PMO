-- #1514 T5: equipment contract rates and approved usage sources.
-- Sources carry an explicit work/standby basis so equal rate values never collapse distinct billable categories.

alter table public.contract_rate_lines drop constraint contract_rate_lines_kind_check;
alter table public.contract_rate_lines add constraint contract_rate_lines_kind_check check (kind in ('labour', 'equipment'));
alter table public.contract_rate_lines add constraint contract_rate_lines_asset_id_fkey
  foreign key (asset_id) references public.equipment_assets(id) on delete restrict;
alter table public.contract_rate_lines drop constraint contract_rate_lines_labour_shape;
alter table public.contract_rate_lines add constraint contract_rate_lines_kind_shape check (
  (kind = 'labour' and asset_id is null and standby_rate is null) or (kind = 'equipment' and asset_id is not null));
alter table public.contract_rate_lines add constraint contract_rate_lines_standby_rate_check
  check (standby_rate is null or (standby_rate >= 0 and standby_rate < 'Infinity'::numeric));
create unique index contract_rate_lines_equipment_asset_current
  on public.contract_rate_lines (org_id, project_id, asset_id) where kind = 'equipment' and is_current;

alter table public.tm_claim_lines drop constraint tm_claim_lines_kind_check;
alter table public.tm_claim_lines add constraint tm_claim_lines_kind_check check (kind in ('labour', 'equipment'));
alter table public.tm_claim_lines add column basis text not null default 'work' check (basis in ('work', 'standby'));
alter table public.tm_claim_lines drop constraint tm_claim_lines_claim_id_line_key_rate_version_key;
alter table public.tm_claim_lines add constraint tm_claim_lines_claim_line_basis_key unique (claim_id, line_key, rate_version, basis);

-- The output shape gains basis, so replace it rather than relying on an implicit table-row conversion.
drop function public.preview_tm_claim(uuid, date, date);
drop function public.tm_assignable_sources(uuid, date, date);

create or replace function public.contract_rate_line_normalize(p_org uuid, p_line jsonb) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_project uuid;
  v_key uuid;
  v_asset uuid;
  v_kind text;
  v_label text;
  v_unit text;
  v_rate numeric;
  v_standby numeric;
  v_from date;
  v_to date;
  v_expected integer;
  v_currency text;
  v_project_currency text;
begin
  if p_line is null or jsonb_typeof(p_line) <> 'object' then
    raise exception 'rate line must be a JSON object' using errcode = '22023';
  end if;
  begin
    v_project := nullif(p_line->>'project_id', '')::uuid;
    v_key := nullif(p_line->>'line_key', '')::uuid;
    v_asset := nullif(p_line->>'asset_id', '')::uuid;
    v_kind := nullif(btrim(p_line->>'kind'), '');
    v_label := btrim(coalesce(p_line->>'label', ''));
    v_unit := nullif(btrim(p_line->>'unit'), '');
    v_rate := nullif(p_line->>'rate', '')::numeric;
    v_standby := nullif(p_line->>'standby_rate', '')::numeric;
    v_from := nullif(p_line->>'effective_from', '')::date;
    v_to := nullif(p_line->>'effective_to', '')::date;
    v_expected := nullif(p_line->>'expected_version', '')::integer;
    v_currency := upper(btrim(coalesce(p_line->>'currency', '')));
  exception when others then
    raise exception 'rate line fields are malformed' using errcode = '22023';
  end;
  if v_project is null then raise exception 'project_id is required' using errcode = '22023'; end if;
  if v_kind is null or v_kind not in ('labour', 'equipment') then raise exception 'kind must be labour or equipment' using errcode = '22023'; end if;
  if v_kind = 'labour' and (v_asset is not null or v_standby is not null) then
    raise exception 'asset_id and standby_rate are only supported for equipment' using errcode = '22023';
  end if;
  if v_kind = 'equipment' and v_asset is null then raise exception 'asset_id is required for equipment' using errcode = '22023'; end if;
  if v_kind = 'equipment' and not exists (select 1 from public.equipment_assets a where a.id = v_asset and a.org_id = p_org and a.archived_at is null) then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;
  if char_length(v_label) not between 1 and 120 then raise exception 'label is required (at most 120 characters)' using errcode = '22023'; end if;
  if v_unit is null or v_unit not in ('hour', 'day') then raise exception 'unit must be hour or day' using errcode = '22023'; end if;
  if v_rate is null or v_rate::text in ('NaN', 'Infinity', '-Infinity') or v_rate < 0
     or v_rate >= 1000000000000 or round(v_rate, 2) <> v_rate then
    raise exception 'rate must be non-negative, below 1000000000000, with at most 2 decimals' using errcode = '22023';
  end if;
  if v_standby is not null and (v_standby::text in ('NaN', 'Infinity', '-Infinity') or v_standby < 0
     or v_standby >= 1000000000000 or round(v_standby, 2) <> v_standby) then
    raise exception 'standby_rate must be non-negative, below 1000000000000, with at most 2 decimals' using errcode = '22023';
  end if;
  if v_from is null or (v_to is not null and v_to < v_from - 1) then
    raise exception 'effective dates are invalid' using errcode = '22023';
  end if;
  if v_expected is not null and v_expected < 1 then raise exception 'expected_version must be positive' using errcode = '22023'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'currency must be a three-letter code' using errcode = '22023'; end if;
  select p.currency into v_project_currency from public.projects p where p.id = v_project and p.org_id = p_org;
  if not found then raise exception 'project not found' using errcode = 'P0002'; end if;
  if v_currency <> v_project_currency then raise exception 'rate currency must match project currency' using errcode = '23514'; end if;
  return jsonb_build_object(
    'project_id', v_project, 'line_key', v_key, 'kind', v_kind, 'asset_id', v_asset,
    'label', v_label, 'unit', v_unit, 'rate', v_rate, 'standby_rate', v_standby,
    'effective_from', v_from, 'effective_to', v_to, 'expected_version', v_expected, 'currency', v_currency
  );
end $$;

create or replace function public.contract_rate_line_write(p_line jsonb, p_action text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_norm jsonb;
  v_project uuid;
  v_key uuid;
  v_expected integer;
  v_from date;
  v_to date;
  v_cur public.contract_rate_lines;
  v_before jsonb;
  v_after jsonb;
  v_id uuid;
  v_version integer := 1;
  v_content jsonb;
begin
  if v_org is null or v_uid is null then raise exception 'active organization required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('contract_rates:' || v_org::text, 0));
  v_norm := public.contract_rate_line_normalize(v_org, p_line);
  v_project := (v_norm->>'project_id')::uuid;
  v_key := coalesce((v_norm->>'line_key')::uuid, gen_random_uuid());
  v_expected := nullif(v_norm->>'expected_version', '')::integer;
  v_from := (v_norm->>'effective_from')::date;
  v_to := nullif(v_norm->>'effective_to', '')::date;
  v_norm := jsonb_set(v_norm, '{line_key}', to_jsonb(v_key));
  v_content := v_norm - 'expected_version' - 'currency';

  select * into v_cur from public.contract_rate_lines l
   where l.org_id = v_org and l.project_id = v_project and l.line_key = v_key and l.is_current for update;
  if found then
    if v_expected is null or v_expected <> v_cur.version then
      raise exception 'rate line changed since it was loaded (current version %)', v_cur.version using errcode = '40001';
    end if;
    v_before := public.contract_rate_line_content(v_cur.id);
    if v_before = v_content then
      return jsonb_build_object('id', v_cur.id, 'line_key', v_key, 'version', v_cur.version, 'changed', false);
    end if;
    if p_action <> 'end' and v_from <= v_cur.effective_from then
      raise exception 'a new rate version cannot rewrite an already applied effective window' using errcode = '23505';
    end if;
    if p_action = 'end' and (v_from <> v_cur.effective_from or (v_cur.effective_to is not null and v_to > v_cur.effective_to)) then
      raise exception 'ending a rate line cannot move or extend its effective window' using errcode = '22023';
    end if;
    v_version := v_cur.version + 1;
    update public.contract_rate_lines l
       set applies_to = greatest(l.effective_from, v_from) - 1
     where l.org_id = v_org and l.project_id = v_project and l.line_key = v_key
       and least(coalesce(l.effective_to, 'infinity'::date), coalesce(l.applies_to, 'infinity'::date)) >= v_from;
    update public.contract_rate_lines set is_current = false where id = v_cur.id;
  elsif v_expected is not null then
    raise exception 'rate line not found' using errcode = 'P0002';
  elsif p_action = 'end' then
    raise exception 'rate line not found' using errcode = 'P0002';
  end if;

  insert into public.contract_rate_lines (
    org_id, project_id, line_key, version, is_current, kind, asset_id, label, unit,
    rate, standby_rate, effective_from, effective_to, created_by
  ) values (
    v_org, v_project, v_key, v_version, true, v_norm->>'kind', nullif(v_norm->>'asset_id', '')::uuid,
    v_norm->>'label', v_norm->>'unit', (v_norm->>'rate')::numeric, nullif(v_norm->>'standby_rate', '')::numeric,
    v_from, v_to, v_uid
  ) returning id into v_id;
  v_after := public.contract_rate_line_content(v_id);
  perform public.log_audit(
    'contract_rate_line.' || case when v_cur.id is null then 'create' else p_action end,
    v_org, v_uid, v_id,
    jsonb_build_object('line_key', v_key, 'version', v_version, 'before', v_before, 'after', v_after)
  );
  return jsonb_build_object('id', v_id, 'line_key', v_key, 'version', v_version, 'changed', true);
end $$;

create or replace function public.end_contract_rate_line(p_project uuid, p_line_key uuid, p_effective_to date, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_line public.contract_rate_lines;
  v_currency text;
  v_result jsonb;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin', 'Finance') then
    raise exception 'not authorized to end contract rates' using errcode = '42501';
  end if;
  if p_effective_to is null then raise exception 'effective_to is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('contract_rates:' || v_org::text, 0));
  select * into v_line from public.contract_rate_lines l
   where l.org_id = v_org and l.project_id = p_project and l.line_key = p_line_key and l.is_current for update;
  if not found then raise exception 'rate line not found' using errcode = 'P0002'; end if;
  select p.currency into v_currency from public.projects p where p.id = p_project and p.org_id = v_org;
  v_result := public.contract_rate_line_write(jsonb_build_object(
    'project_id', p_project, 'line_key', p_line_key, 'expected_version', p_expected_version,
    'kind', v_line.kind, 'asset_id', v_line.asset_id, 'standby_rate', v_line.standby_rate,
    'label', v_line.label, 'unit', v_line.unit, 'rate', v_line.rate,
    'currency', v_currency, 'effective_from', v_line.effective_from, 'effective_to', p_effective_to
  ), 'end');
  update public.contract_rate_lines l
     set sales_item_code = v_line.sales_item_code
   where l.org_id = v_org and l.id = (v_result->>'id')::uuid;
  return v_result;
end $$;

create or replace function public.set_contract_rate_assignee(
  p_project uuid, p_line_key uuid, p_user uuid, p_from date, p_to date
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin', 'Finance') then
    raise exception 'not authorized to assign contract rates' using errcode = '42501';
  end if;
  if p_from is null or (p_to is not null and p_to < p_from) then
    raise exception 'assignment dates are invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('contract_rates:' || v_org::text, 0));
  if not exists (select 1 from public.projects p where p.id = p_project and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.contract_rate_lines l
                  where l.org_id = v_org and l.project_id = p_project and l.line_key = p_line_key and l.is_current and l.kind = 'labour') then
    raise exception 'rate line not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles u where u.id = p_user and u.org_id = v_org and public.is_active_member(u.id)) then
    raise exception 'active organization member not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.contract_rate_assignees a
     where a.org_id = v_org and a.project_id = p_project and a.user_id = p_user
       and a.effective_from <= coalesce(p_to, 'infinity'::date)
       and p_from <= coalesce(a.effective_to, 'infinity'::date)
  ) then
    raise exception 'person already has a labour line over those dates' using errcode = '23505';
  end if;
  insert into public.contract_rate_assignees (org_id, project_id, line_key, user_id, effective_from, effective_to, created_by)
  values (v_org, p_project, p_line_key, p_user, p_from, p_to, v_uid)
  returning id into v_id;
  return v_id;
end $$;

drop function public.list_tm_claim_source_details(uuid);

create function public.tm_assignable_sources(p_project uuid, p_from date, p_to date)
returns table (
  source_kind text, source_id uuid, user_id uuid, entry_date date, units numeric,
  line_key uuid, rate_version integer, kind text, basis text, label text, unit text, rate numeric, unrated_reason text)
language sql stable set search_path = public, pg_temp as $$
  with e as (
    select en.id, en.org_id, ts.user_id, en.entry_date, en.hours
      from public.timesheet_entries en
      join public.timesheets ts on ts.id = en.timesheet_id
     where en.org_id = public.auth_org_id() and ts.org_id = en.org_id
       and en.project_id = p_project and ts.status = 'Approved'
       and en.entry_date between p_from and p_to and en.hours > 0
       and not exists (select 1 from public.tm_claim_sources s
                        where s.source_kind = 'timesheet_entry' and s.source_id = en.id and s.is_live)
  ), a as (
    select e.*, (select ca.line_key from public.contract_rate_assignees ca
                  where ca.org_id = e.org_id and ca.project_id = p_project and ca.user_id = e.user_id
                    and ca.effective_from <= e.entry_date and e.entry_date <= coalesce(ca.effective_to, 'infinity'::date)
                  limit 1) as assigned_line
      from e
  ), equipment as (
    select ue.id, ue.org_id, ue.project_id, ue.work_date, ue.quantity, ue.unit as usage_unit, ue.kind as usage_kind, ue.asset_id
      from public.equipment_usage_entries ue
     where ue.org_id = public.auth_org_id() and ue.project_id = p_project and ue.status = 'Approved'
       and ue.archived_at is null and ue.quantity > 0 and ue.work_date between p_from and p_to
       and not exists (select 1 from public.tm_claim_sources s
                        where s.source_kind = 'equipment_usage' and s.source_id = ue.id and s.is_live)
  )
  select 'timesheet_entry'::text, a.id, a.user_id, a.entry_date, a.hours::numeric,
         a.assigned_line, r.version, r.kind, 'work'::text, r.label, r.unit, r.rate,
         case when a.assigned_line is null then 'no_assignee'
              when r.id is null then 'no_rate'
              when r.unit <> 'hour' then 'unit_not_supported' end
    from a
    left join lateral (
      select l.* from public.contract_rate_lines l
       where l.org_id = a.org_id and l.project_id = p_project and l.line_key = a.assigned_line
         and l.kind = 'labour' and l.effective_from <= a.entry_date
         and a.entry_date <= least(coalesce(l.effective_to, 'infinity'::date), coalesce(l.applies_to, 'infinity'::date))
       order by l.version desc limit 1) r on true
  union all
  select 'equipment_usage'::text, e.id, null::uuid, e.work_date, e.quantity::numeric,
         r.line_key, r.version, 'equipment'::text, e.usage_kind::text, r.label, r.unit,
         case when e.usage_kind = 'standby' then r.standby_rate else r.rate end,
         case when r.id is null then 'no_rate'
              when e.usage_kind = 'standby' and r.standby_rate is null then 'no_standby_rate'
              when r.unit <> case when e.usage_unit = 'hours' then 'hour' else 'day' end then 'unit_not_supported' end
    from equipment e
    left join lateral (
      select l.* from public.contract_rate_lines l
       where l.org_id = e.org_id and l.project_id = e.project_id and l.asset_id = e.asset_id and l.kind = 'equipment'
         and l.effective_from <= e.work_date
         and e.work_date <= least(coalesce(l.effective_to, 'infinity'::date), coalesce(l.applies_to, 'infinity'::date))
       order by l.version desc limit 1) r on true
  order by 4, 2
$$;

create or replace function public.assemble_tm_claim(
  p_project uuid, p_from date, p_to date, p_work_order uuid default null, p_exclude jsonb default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_currency text;
  v_wo_project uuid;
  v_exclude uuid[] := '{}';
  v_id uuid := gen_random_uuid();
  v_count integer;
  v_other uuid;
begin
  perform public.assert_is_active_member();
  if p_project is null or p_from is null or p_to is null or p_to < p_from then
    raise exception 'a project and a valid date range are required' using errcode = '22023';
  end if;
  if p_exclude is not null then
    begin
      if jsonb_typeof(p_exclude) <> 'array' then raise exception 'x'; end if;
      select coalesce(array_agg(x::uuid), '{}') into v_exclude from jsonb_array_elements_text(p_exclude) x;
    exception when others then
      raise exception 'exclude must be a list of source ids' using errcode = '22023';
    end;
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  -- SECURITY: the role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  if not public.may_record_project_progress(p_project) then
    raise exception 'not authorized to prepare a time-and-materials claim for this project' using errcode = '42501';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'sales_invoices');
  -- Lock order as create_progress_claim: the work order's billing lock, then the project row.
  if p_work_order is not null then
    perform public.lock_work_order_billing(p_work_order);
    select wo.project_id into v_wo_project from public.work_orders wo where wo.id = p_work_order and wo.org_id = v_org;
    if v_wo_project is distinct from p_project then
      raise exception 'the work order must be on the same project as the claim' using errcode = '23514';
    end if;
  end if;
  select p.currency into v_currency from public.projects p where p.id = p_project and p.org_id = v_org for update;
  -- Hold the Approved weeks while we read them: a concurrent reopen takes the row lock first, so the helper below
  -- either sees the week Draft (and offers nothing) or this claim is live before the reopen checks.
  perform 1 from public.timesheets t
   where t.org_id = v_org and t.status = 'Approved'
     and t.id in (select en.timesheet_id from public.timesheet_entries en
                   where en.org_id = v_org and en.project_id = p_project and en.entry_date between p_from and p_to)
   order by t.id for share;
  -- Hold Approved equipment rows as well: a concurrent reopen/archive waits, then sees the live claim.
  perform 1 from public.equipment_usage_entries ue
   where ue.org_id = v_org and ue.project_id = p_project and ue.status = 'Approved'
     and ue.archived_at is null and ue.work_date between p_from and p_to
   order by ue.id for share;

  begin
    with src as materialized (
      select s.* from public.tm_assignable_sources(p_project, p_from, p_to) s
       where s.unrated_reason is null and s.source_id <> all (v_exclude)
    ), grp as (
      select s.line_key, s.rate_version, s.kind, s.basis, s.label, s.unit, s.rate, sum(s.units) as units
        from src s group by 1, 2, 3, 4, 5, 6, 7
    ), ins_claim as (
      insert into public.tm_claims (id, org_id, project_id, work_order_id, period_from, period_to, currency, gross_amount, prepared_by)
      select v_id, v_org, p_project, p_work_order, p_from, p_to, v_currency,
             (select sum(round(g.units * g.rate, 2)) from grp g), v_uid
       where exists (select 1 from src)
      returning id
    ), ins_lines as (
      insert into public.tm_claim_lines (org_id, claim_id, line_key, rate_version, kind, basis, label, unit, units, rate, amount)
      select v_org, c.id, g.line_key, g.rate_version, g.kind, g.basis, g.label, g.unit, g.units, g.rate, round(g.units * g.rate, 2)
        from grp g cross join ins_claim c
      returning id, claim_id, line_key, rate_version, basis
    ), ins_sources as (
      insert into public.tm_claim_sources (org_id, claim_id, claim_line_id, source_kind, source_id, units)
      select v_org, l.claim_id, l.id, s.source_kind, s.source_id, s.units
        from src s join ins_lines l on l.line_key = s.line_key and l.rate_version = s.rate_version and l.basis = s.basis
      returning 1
    )
    select count(*) into v_count from ins_sources;
  exception when unique_violation then
    select s.claim_id into v_other
      from public.tm_claim_sources s
      left join public.timesheet_entries en on s.source_kind = 'timesheet_entry' and en.id = s.source_id
      left join public.equipment_usage_entries ue on s.source_kind = 'equipment_usage' and ue.id = s.source_id
     where s.is_live and ((s.source_kind = 'timesheet_entry' and en.project_id = p_project
                             and en.entry_date between p_from and p_to)
                       or (s.source_kind = 'equipment_usage' and ue.project_id = p_project
                             and ue.work_date between p_from and p_to))
     limit 1;
    raise exception 'a source is already in claim %', v_other using errcode = 'P0001';
  end;
  if v_count = 0 then
    raise exception 'no approved, rated sources left to claim in this period' using errcode = 'P0001';
  end if;
  perform public.log_audit('tm_claim.assemble', v_org, v_uid, v_id,
    jsonb_build_object('project_id', p_project, 'period_from', p_from, 'period_to', p_to,
                       'work_order_id', p_work_order, 'sources', v_count));
  return v_id;
end $$;


create or replace function public.confirm_tm_signoff(p_claim uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_role user_role := public.auth_role();
  v_c public.tm_claims;
  v_currency text;
  v_basis text := 'standard';
  v_sole boolean := false;
  v_doc_status public.doc_status;
  v_doc_revision text;
  v_bad integer;
  v_bad_kind text;
begin
  perform public.assert_is_active_member();
  select * into v_c from public.tm_claims c where c.id = p_claim and c.org_id = v_org;
  if not found then raise exception 'claim not found' using errcode = 'P0002'; end if;
  -- SECURITY: the role and separation-of-duties re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  if v_role is null or v_role not in ('Admin', 'Finance') then
    raise exception 'only Admin or Finance may confirm a sign-off' using errcode = '42501';
  end if;
  -- Lock order as create_progress_claim: the work order's billing lock, the project row, then the claim.
  if v_c.work_order_id is not null then perform public.lock_work_order_billing(v_c.work_order_id); end if;
  select p.currency into v_currency from public.projects p where p.id = v_c.project_id and p.org_id = v_org for update;
  select * into v_c from public.tm_claims c where c.id = p_claim for update;
  if v_c.status <> 'Draft' then
    raise exception 'this sign-off is already %', lower(v_c.status) using errcode = 'P0001';
  end if;
  if v_c.signoff_prepared_by is null or v_c.document_id is null or v_c.prepared_fingerprint is null then
    raise exception 'prepare the sign-off before confirming it' using errcode = 'P0001';
  end if;
  if v_uid is not distinct from v_c.prepared_by or v_uid is not distinct from v_c.signoff_prepared_by then
    select count(*) = 1 and bool_or(p.id = auth.uid()) into v_sole
      from public.profiles p where p.org_id = v_org and public.is_active_member(p.id);
    if not coalesce(v_sole, false) then
      raise exception 'separation of duties: the preparer cannot confirm this sign-off' using errcode = '42501';
    end if;
    v_basis := 'sole_operator';
  end if;
  if v_c.currency is distinct from v_currency then
    raise exception 'the claim is in % but the project is in %', v_c.currency, v_currency using errcode = '23514';
  end if;
  select d.status, d.revision into v_doc_status, v_doc_revision
    from public.project_documents d
   where d.id = v_c.document_id and d.org_id = v_org and d.project_id = v_c.project_id
     and d.status in ('Issued', 'Approved') and nullif(btrim(d.file_path), '') is not null
     for share;
  if not found then
    raise exception 'confirmation requires an Issued or Approved project document with a file' using errcode = '23514';
  end if;
  if not exists (select 1 from public.tm_claim_lines l where l.claim_id = p_claim) then
    raise exception 'a claim with no lines cannot be signed off' using errcode = 'P0001';
  end if;
  if public.tm_claim_fingerprint(p_claim) is distinct from v_c.prepared_fingerprint then
    raise exception 'the claim changed after its sign-off was prepared: prepare it again' using errcode = 'P0001';
  end if;
  -- Every source must still be Approved and match its frozen line basis. Hold its row while validating so a concurrent
  -- reopen waits, then sees the live claim after this transaction commits.
  perform 1 from public.timesheets t
   where t.id in (select en.timesheet_id from public.tm_claim_sources s
                    join public.timesheet_entries en on en.id = s.source_id where s.claim_id = p_claim and s.source_kind = 'timesheet_entry')
   order by t.id for share;
  perform 1 from public.equipment_usage_entries ue
   where ue.id in (select s.source_id from public.tm_claim_sources s where s.claim_id = p_claim and s.source_kind = 'equipment_usage')
   order by ue.id for share;
  select count(*), case when bool_or(s.source_kind = 'timesheet_entry') then 'timesheet_entry' else 'equipment_usage' end
    into v_bad, v_bad_kind
    from public.tm_claim_sources s
    join public.tm_claim_lines l on l.id = s.claim_line_id and l.claim_id = s.claim_id and l.org_id = s.org_id
    left join public.timesheet_entries en on s.source_kind = 'timesheet_entry' and en.id = s.source_id
    left join public.timesheets t on t.id = en.timesheet_id and t.org_id = en.org_id
    left join public.equipment_usage_entries ue on s.source_kind = 'equipment_usage' and ue.id = s.source_id
   where s.claim_id = p_claim and (not s.is_live or not (
     (s.source_kind = 'timesheet_entry' and l.kind = 'labour' and l.basis = 'work'
       and en.org_id = v_org and t.org_id = v_org and t.status = 'Approved'
       and en.project_id = v_c.project_id and en.entry_date between v_c.period_from and v_c.period_to and en.hours = s.units)
     or (s.source_kind = 'equipment_usage' and l.kind = 'equipment' and l.basis = ue.kind
       and ue.org_id = v_org and ue.status = 'Approved' and ue.archived_at is null
       and ue.project_id = v_c.project_id and ue.work_date between v_c.period_from and v_c.period_to
       and ue.quantity = s.units and l.unit = case when ue.unit = 'hours' then 'hour' else 'day' end)));
  if v_bad > 0 then
    if v_bad_kind = 'timesheet_entry' then
      raise exception 'an hour in this claim is no longer approved: withdraw the claim and assemble it again' using errcode = 'P0001';
    end if;
    raise exception 'an equipment usage in this claim is no longer approved: withdraw the claim and assemble it again' using errcode = 'P0001';
  end if;
  -- ⚑ FR-TM-033: the claim reserves its gross against its work order at confirm, as create_progress_claim does.
  if v_c.work_order_id is not null then
    perform public.assert_work_order_invoiceable(v_org, v_c.work_order_id, v_c.project_id, p_claim::text, v_c.gross_amount, v_c.currency);
  end if;
  insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, dp_recovery_amount, created_by)
  values (p_claim, v_org, v_c.project_id, v_c.work_order_id, 'time_materials', v_c.currency, v_c.gross_amount, 0, v_c.prepared_by);
  insert into public.progress_claim_evidence (org_id, claim_id, document_id, document_status, document_revision, attached_by)
  values (v_org, p_claim, v_c.document_id, v_doc_status, v_doc_revision, v_uid);
  update public.tm_claims set status = 'SignedOff', confirmed_by = v_uid, confirm_basis = v_basis where id = p_claim;
  perform public.log_audit('tm_signoff.confirm', v_org, v_uid, p_claim,
    jsonb_build_object('project_id', v_c.project_id, 'work_order_id', v_c.work_order_id, 'document_id', v_c.document_id,
                       'gross_amount', v_c.gross_amount, 'basis', v_basis));
  return jsonb_build_object('claim_id', p_claim, 'basis', v_basis, 'gross_amount', v_c.gross_amount);
end $$;

create or replace function public.list_tm_claims(p_project uuid)
returns table(id uuid, work_order_id uuid, period_from date, period_to date, status text, currency text, gross_amount numeric,
              prepared_by uuid, signoff_prepared_by uuid, confirmed_by uuid, confirm_basis text, document_id uuid,
              note text, created_at timestamptz, lines jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  perform public.tm_assert_amounts_reader(p_project);
  return query
    select c.id, c.work_order_id, c.period_from, c.period_to, c.status, c.currency, c.gross_amount,
           c.prepared_by, c.signoff_prepared_by, c.confirmed_by, c.confirm_basis, c.document_id, c.note, c.created_at,
           coalesce((select jsonb_agg(jsonb_build_object('line_key', l.line_key, 'rate_version', l.rate_version, 'kind', l.kind, 'basis', l.basis,
                                                         'label', l.label, 'unit', l.unit, 'units', l.units, 'rate', l.rate,
                                                         'amount', l.amount) order by l.label, l.rate_version, l.basis)
                       from public.tm_claim_lines l where l.claim_id = c.id and l.org_id = c.org_id), '[]'::jsonb)
      from public.tm_claims c
     where c.org_id = public.auth_org_id() and c.project_id = p_project
     order by c.created_at desc, c.id;
end $$;

create function public.preview_tm_claim(p_project uuid, p_from date, p_to date)
returns table(line_key uuid, rate_version integer, kind text, basis text, label text, unit text, rate numeric, user_id uuid,
              units numeric, amount numeric, source_count bigint, unrated_reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  perform public.tm_assert_amounts_reader(p_project);
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'a valid date range is required' using errcode = '22023';
  end if;
  -- One row per priced line and basis (the same grouping assembly freezes); unrated sources have no amount.
  return query
    select s.line_key, s.rate_version, s.kind, s.basis, s.label, s.unit, s.rate,
           case when s.unrated_reason is not null then s.user_id end,
           sum(s.units), case when s.unrated_reason is null then round(sum(s.units) * s.rate, 2) end,
           count(*), s.unrated_reason
      from public.tm_assignable_sources(p_project, p_from, p_to) s
     group by s.line_key, s.rate_version, s.kind, s.basis, s.label, s.unit, s.rate, s.unrated_reason,
              case when s.unrated_reason is not null then s.user_id end
     order by s.unrated_reason nulls first, s.label, s.basis, 8;
end $$;

create function public.list_tm_claim_source_details(p_claim uuid)
returns table(id uuid, entry_id uuid, entry_date date, person_id uuid, person_name text, basis text, units numeric, unit text,
              line_label text, is_selected boolean, person_unit_total numeric, total_count bigint, signoff_is_current boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_project uuid;
begin
  if p_claim is null then raise exception 'a claim is required' using errcode = '22023'; end if;
  select c.project_id into v_project from public.tm_claims c
   where c.id = p_claim and c.org_id = public.auth_org_id();
  if not found then raise exception 'claim not found' using errcode = 'P0002'; end if;
  perform public.tm_assert_amounts_reader(v_project);
  return query
    select s.id, s.source_id, coalesce(en.entry_date, ue.work_date), coalesce(ts.user_id, ue.author_id), p.full_name,
           l.basis, s.units, l.unit, l.label, s.is_live,
           coalesce(sum(s.units) filter (where s.is_live) over (partition by coalesce(ts.user_id, ue.author_id), l.unit, l.basis), 0),
           count(*) over (),
           coalesce(c.signoff_prepared_by is not null and c.prepared_fingerprint is not null
             and public.tm_claim_fingerprint(c.id) = c.prepared_fingerprint, false)
      from public.tm_claim_sources s
      join public.tm_claims c on c.id = s.claim_id and c.org_id = s.org_id
      join public.tm_claim_lines l on l.id = s.claim_line_id and l.claim_id = s.claim_id and l.org_id = s.org_id
      left join public.timesheet_entries en on s.source_kind = 'timesheet_entry' and en.id = s.source_id and en.org_id = s.org_id
      left join public.timesheets ts on ts.id = en.timesheet_id and ts.org_id = en.org_id
      left join public.equipment_usage_entries ue on s.source_kind = 'equipment_usage' and ue.id = s.source_id and ue.org_id = s.org_id
      left join public.profiles p on p.id = coalesce(ts.user_id, ue.author_id) and p.org_id = s.org_id
     where s.claim_id = p_claim and s.org_id = public.auth_org_id() and c.org_id = public.auth_org_id()
     order by coalesce(en.entry_date, ue.work_date) nulls last, p.full_name nulls last, l.label, l.basis, s.id;
end $$;

create or replace function public.archive_equipment_usage(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_e public.equipment_usage_entries; v_claim uuid;
begin
  perform public.assert_is_active_member();
  select * into v_e from public.equipment_usage_entries e where e.id = p_id for update;
  if not found or v_e.org_id is distinct from public.auth_org_id() then raise exception 'entry not found' using errcode = 'P0002'; end if;
  if public.tm_source_is_live('equipment_usage', p_id) then
    select s.claim_id into v_claim from public.tm_claim_sources s where s.source_kind = 'equipment_usage' and s.source_id = p_id and s.is_live limit 1;
    raise exception 'equipment usage belongs to live claim %', v_claim using errcode = '55000';
  end if;
  if v_e.status = 'Approved' then raise exception 'reopen approved usage before archiving it' using errcode = '22023'; end if;
  if not (v_e.author_id is not distinct from auth.uid() and v_e.status in ('Draft','Rejected')) and public.auth_role() is distinct from 'Admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.equipment_usage_entries set archived_at = now(), updated_at = now() where id = p_id and archived_at is null;
  perform public.log_audit('equipment_usage.archive', v_e.org_id, auth.uid(), p_id, jsonb_build_object('status', v_e.status));
end $$;

create or replace function public.equipment_usage_transition_core(p_id uuid, p_to text, p_notes text) returns text
language plpgsql set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_role public.user_role := public.auth_role(); v_e public.equipment_usage_entries;
  v_legal jsonb := jsonb_build_object('Draft', jsonb_build_array('Submitted'), 'Submitted', jsonb_build_array('Approved','Rejected'),
                                      'Rejected', jsonb_build_array('Draft'), 'Approved', jsonb_build_array('Draft'));
  v_action text; v_locked text; v_claim uuid;
begin
  select * into v_e from public.equipment_usage_entries e where e.id = p_id for update;
  if not found then raise exception 'entry not found' using errcode = 'P0002'; end if;
  -- SECURITY: definer bypasses RLS; this org re-assertion MUST stay.
  if v_e.org_id is distinct from public.auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_e.archived_at is not null then raise exception 'an archived entry cannot move' using errcode = '22023'; end if;
  if p_to is null or not coalesce((v_legal -> v_e.status) ? p_to, false) then
    raise exception 'illegal transition % -> %', v_e.status, p_to using errcode = '22023';
  end if;
  if p_to = 'Submitted' or (v_e.status = 'Rejected' and p_to = 'Draft') then
    if v_uid is distinct from v_e.author_id then raise exception 'not authorized' using errcode = '42501'; end if;
    v_action := case when p_to = 'Submitted' then 'submitted' else 'redraft' end;
  elsif p_to in ('Approved','Rejected') then
    -- SoD FIRST, ALWAYS (FR-EQU-011, the 0180 transition_timesheet order). Do not reorder.
    if v_uid is not distinct from v_e.author_id then raise exception 'separation of duties: cannot decide own equipment usage' using errcode = '42501'; end if;
    if not public.equipment_can_approve(v_uid, v_role, v_e.org_id, v_e.project_id) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    v_action := lower(p_to);
  else  -- Approved -> Draft: Admin reopen (FR-EQU-012), never by the author
    if v_uid is not distinct from v_e.author_id then raise exception 'separation of duties: cannot reopen own equipment usage' using errcode = '42501'; end if;
    if v_role is distinct from 'Admin' then raise exception 'only an Admin reopens approved usage' using errcode = '42501'; end if;
    v_action := 'reopen';
  end if;
  if v_e.status = 'Approved' and p_to = 'Draft' and public.tm_source_is_live('equipment_usage', p_id) then
    select s.claim_id into v_claim from public.tm_claim_sources s where s.source_kind = 'equipment_usage' and s.source_id = p_id and s.is_live limit 1;
    raise exception 'equipment usage belongs to live claim %', v_claim using errcode = '55000';
  end if;
  -- FR-EQU-032: a costing setting saved after the entry was logged (a day entry Rejected before an hours rate existed,
  -- or a race with the setting save) must not let the entry reach a charge in another unit. The author's resubmit and the
  -- approver's decision both re-check; bulk week approval runs this core, so it stops at such an entry with this message.
  if p_to in ('Submitted','Approved') then
    v_locked := public.equipment_entry_locked_unit(v_e.org_id, v_e.asset_id, v_e.work_date);
    if v_locked is not null and v_locked <> v_e.unit then
      raise exception 'this asset is costed per % on that date; this entry is in %', v_locked, v_e.unit using errcode = '22023';
    end if;
  end if;
  update public.equipment_usage_entries
     set status = p_to,
         approver_id = case when p_to in ('Approved','Rejected') then v_uid when p_to = 'Draft' then null else approver_id end,
         approved_at = case when p_to = 'Approved' then now() else null end,
         decision_notes = case when p_to in ('Approved','Rejected') or v_action = 'reopen' then nullif(btrim(coalesce(p_notes,'')), '')
                               else decision_notes end,
         updated_at = now()
   where id = p_id;
  perform public.log_audit('equipment_usage.' || v_action, v_e.org_id, v_uid, p_id,
    jsonb_build_object('from', v_e.status, 'to', p_to, 'notes', p_notes));
  return p_to;
end $$;

-- Re-grant the functions whose return tables were replaced by DROP/CREATE.
alter function public.tm_assignable_sources(uuid, date, date) owner to postgres;
revoke all on function public.tm_assignable_sources(uuid, date, date) from public, anon, authenticated;
alter function public.preview_tm_claim(uuid, date, date) owner to postgres;
revoke all on function public.preview_tm_claim(uuid, date, date) from public, anon, authenticated;
grant execute on function public.preview_tm_claim(uuid, date, date) to authenticated;
alter function public.list_tm_claim_source_details(uuid) owner to postgres;
revoke all on function public.list_tm_claim_source_details(uuid) from public, anon, authenticated;
grant execute on function public.list_tm_claim_source_details(uuid) to authenticated;

-- CREATE OR REPLACE preserves existing grants/owners for the unchanged signatures above.
notify pgrst, 'reload schema';
