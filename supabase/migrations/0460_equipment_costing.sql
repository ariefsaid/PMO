-- 0460_equipment_costing.sql — #1519 S2: versioned, windowed equipment costing settings (basis none | hire_rate |
-- actual_cost), hire-rate charges from approved usage, the allocation and usage-total reads, and the unit lock that
-- S1 stubbed. Spec: docs/specs/equipment-usage.spec.md (signed 2026-11-01). Plan: docs/plans/2026-11-01-equipment-usage.md S2.
-- Proven by supabase/tests/equipment_costing.test.sql and supabase/tests/equipment_rls.test.sql. Read-side only:
-- nothing here posts to the ERP (OQ-1). `actual_cost` rows are stored and conflict-checked here; the engine that
-- allocates them is S3. A hire-rate charge is a management charge outside the ledger (D5); S4 adds it to project actuals.
-- ── REVERSE (also supabase/migrations/rollback/0460_equipment_costing_down.sql) ───────────────────────
--   drop function if exists public.list_equipment_usage_totals(uuid, uuid, date, date);
--   drop function if exists public.list_equipment_allocations(uuid, date, date, uuid);
--   drop function if exists public.preview_equipment_costing(jsonb);
--   drop function if exists public.list_equipment_costing(boolean);
--   drop function if exists public.end_equipment_costing(uuid, date, int);
--   drop function if exists public.save_equipment_costing(jsonb);
--   drop function if exists public.equipment_costing_write(jsonb, text, boolean);
--   drop function if exists public.equipment_hire_charges(uuid, jsonb, uuid);
--   drop function if exists public.equipment_usage_by_project(uuid);
--   (restore S1's stub body of equipment_entry_locked_unit BEFORE dropping equipment_settings_effective)
--   drop function if exists public.equipment_settings_effective(uuid, jsonb);
--   drop function if exists public.equipment_costing_assert_no_conflict(uuid, jsonb);
--   drop function if exists public.cost_attribution_matches_overlap(uuid, text, text, text, text, text, text, text, text, text, text);
--   drop function if exists public.equipment_costing_normalize(uuid, jsonb, boolean);
--   drop function if exists public.equipment_costing_content(uuid);
--   drop table if exists public.equipment_costing_settings;

-- ── table (S2.2) ───────────────────────────────────────────────────────────────────────────────────
create table public.equipment_costing_settings (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,   -- stated by the writer, no default
  asset_id            uuid not null references public.equipment_assets(id) on delete restrict,
  setting_key         uuid not null,
  version             int not null check (version >= 1),
  is_current          boolean not null default true,
  basis               text not null check (basis in ('none','hire_rate','actual_cost')),
  work_rate           numeric(14,2) check (work_rate is null or (work_rate >= 0 and work_rate < 'Infinity'::numeric)),
  standby_rate        numeric(14,2) check (standby_rate is null or (standby_rate >= 0 and standby_rate < 'Infinity'::numeric)),
  rate_unit           text check (rate_unit is null or rate_unit in ('hours','days')),
  driver              text check (driver is null or driver in ('units','fuel','trips')),
  count_standby       boolean not null default false,                         -- OQ-6
  charge_category     public.budget_category,                                 -- OQ-3 / PQ-3 (hire_rate only)
  match_account       text, match_account_group text, match_cost_center text, match_party_type text, match_party text,
  specificity         int not null default 0,
  effective_from      date not null,
  effective_to        date,
  applies_to          date,                                                    -- PQ-4, written only by the writer
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  unique (org_id, setting_key, version),
  constraint equipment_costing_window check (effective_to is null or effective_to >= effective_from - 1),
  constraint equipment_costing_shape check (
    (basis = 'none' and work_rate is null and standby_rate is null and driver is null and match_account is null and match_account_group is null)
    or (basis = 'hire_rate' and work_rate is not null and rate_unit is not null and charge_category is not null and driver is null
        and match_account is null and match_account_group is null)
    or (basis = 'actual_cost' and driver is not null and work_rate is null and standby_rate is null
        and (match_account is null) <> (match_account_group is null) and (driver <> 'units' or rate_unit is not null)))
);
create unique index equipment_costing_one_current on public.equipment_costing_settings (org_id, setting_key) where is_current;
create index equipment_costing_asset on public.equipment_costing_settings (org_id, asset_id);
alter table public.equipment_costing_settings enable row level security;
alter table public.equipment_costing_settings force row level security;
create policy equipment_costing_settings_select on public.equipment_costing_settings for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and public.auth_role() in ('Admin','Finance','Executive','Project Manager'));
revoke all on public.equipment_costing_settings from public, anon, authenticated;
grant select on public.equipment_costing_settings to authenticated;   -- no write grant: the Admin/Finance RPCs are the only writers
grant all on public.equipment_costing_settings to service_role;

-- ── normalise, content, overlap predicate, conflict check (S2.3) ───────────────────────────────────
-- Internal helpers are plain (invoker) functions called only from the definers below (0376 pattern).
create function public.equipment_costing_normalize(p_org uuid, p_setting jsonb, p_check_accounts boolean default true)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_key uuid; v_asset uuid; v_from date; v_to date; v_ev int; v_basis text;
  v_work numeric; v_standby numeric; v_unit text; v_driver text; v_count_standby boolean; v_cat public.budget_category;
  v_account text; v_group text; v_cc text; v_ptype text; v_party text; v_spec int := 0; v_n numeric;
begin
  if p_setting is null or jsonb_typeof(p_setting) <> 'object' then
    raise exception 'setting must be a JSON object' using errcode = '22023';
  end if;
  begin
    v_key := nullif(p_setting->>'setting_key', '')::uuid;
    v_asset := (p_setting->>'asset_id')::uuid;
    v_from := (p_setting->>'effective_from')::date;
    v_to := nullif(p_setting->>'effective_to', '')::date;
    v_work := nullif(p_setting->>'work_rate', '')::numeric;
    v_standby := nullif(p_setting->>'standby_rate', '')::numeric;
    v_count_standby := coalesce(nullif(p_setting->>'count_standby', '')::boolean, false);
    v_cat := nullif(p_setting->>'charge_category', '')::public.budget_category;
  exception when others then
    raise exception 'setting_key, asset_id, effective dates, rates, count_standby or charge_category is malformed' using errcode = '22023';
  end;
  v_ev := case when (p_setting->>'expected_version') ~ '^\d{1,9}$' then (p_setting->>'expected_version')::int end;
  if v_from is null then raise exception 'effective_from is required' using errcode = '22023'; end if;
  if v_to is not null and v_to < v_from - 1 then
    raise exception 'effective_to is before effective_from' using errcode = '22023';
  end if;
  if not exists (select 1 from public.equipment_assets a where a.id = v_asset and a.org_id = p_org and a.archived_at is null) then
    raise exception 'asset not found' using errcode = 'P0002';   -- SECURITY: the org re-assertion MUST stay
  end if;
  v_basis := p_setting->>'basis';
  if v_basis is null or v_basis not in ('none','hire_rate','actual_cost') then
    raise exception 'basis must be none, hire_rate or actual_cost' using errcode = '22023';
  end if;
  foreach v_n in array array[v_work, v_standby] loop
    if v_n is not null and (v_n::text in ('NaN','Infinity','-Infinity') or v_n < 0 or v_n >= 1000000000000 or round(v_n, 2) <> v_n) then
      raise exception 'a rate must be zero or more, with at most 2 decimals' using errcode = '22023';
    end if;
  end loop;
  v_unit := nullif(btrim(coalesce(p_setting->>'rate_unit', '')), '');
  v_driver := nullif(btrim(coalesce(p_setting->>'driver', '')), '');
  v_account := nullif(btrim(coalesce(p_setting->>'account', '')), '');
  v_group := nullif(btrim(coalesce(p_setting->>'account_group', '')), '');
  v_cc := nullif(btrim(coalesce(p_setting->>'cost_center', '')), '');
  v_ptype := nullif(btrim(coalesce(p_setting->>'party_type', '')), '');
  v_party := nullif(btrim(coalesce(p_setting->>'party', '')), '');
  if v_unit is not null and v_unit not in ('hours','days') then raise exception 'rate_unit must be hours or days' using errcode = '22023'; end if;
  if v_driver is not null and v_driver not in ('units','fuel','trips') then raise exception 'driver must be units, fuel or trips' using errcode = '22023'; end if;
  if v_basis in ('none','hire_rate') and (v_driver is not null or v_account is not null or v_group is not null
       or v_cc is not null or v_ptype is not null or v_party is not null) then
    raise exception 'only an actual-cost setting carries a driver or a ledger match' using errcode = '22023';
  end if;
  if v_basis = 'none' then
    if v_work is not null or v_standby is not null or v_unit is not null or v_cat is not null then
      raise exception 'a setting with basis none carries no rates' using errcode = '22023';
    end if;
    v_count_standby := false;
  elsif v_basis = 'hire_rate' then
    if v_work is null or v_unit is null then raise exception 'a hire rate needs a work rate and a unit' using errcode = '22023'; end if;
    v_count_standby := false;
    v_cat := coalesce(v_cat, 'Equipment'::public.budget_category);
    if p_check_accounts and not exists (select 1 from public.budget_category_account_map m where m.org_id = p_org and m.category = v_cat) then
      raise exception 'map an account to the % category first', v_cat using errcode = 'P0002';   -- PQ-3
    end if;
  else
    if v_work is not null or v_standby is not null then
      raise exception 'an actual-cost setting carries no rates' using errcode = '22023';
    end if;
    if v_driver is null then raise exception 'actual cost needs a driver' using errcode = '22023'; end if;
    if (v_account is null) = (v_group is null) then raise exception 'name exactly one of account or account_group' using errcode = '22023'; end if;
    if v_driver = 'units' and v_unit is null then raise exception 'actual cost by units needs a unit' using errcode = '22023'; end if;
    if v_driver <> 'units' then v_unit := null; end if;
    if v_ptype is not null and v_party is null then raise exception 'party_type needs a party' using errcode = '22023'; end if;
    v_cat := null;
    if p_check_accounts then   -- the 0376 account checks, same messages
      if v_account is not null and not exists (
           select 1 from public.erp_account_mirror a where a.org_id = p_org and a.erp_name = v_account and not a.is_group)
         and not exists (select 1 from public.erp_gl_entry_mirror l where l.org_id = p_org and l.account = v_account) then
        raise exception 'account not found: %', v_account using errcode = 'P0002';
      end if;
      if v_group is not null and not exists (
           select 1 from public.erp_account_mirror a where a.org_id = p_org and a.erp_name = v_group and a.is_group) then
        raise exception 'account group not found: %', v_group using errcode = 'P0002';
      end if;
    end if;
    v_spec := 10 * ((v_cc is not null)::int + (v_party is not null)::int) + case when v_account is not null then 2 else 1 end;   -- 0376 :171
  end if;
  return jsonb_build_object(
    'setting_key', v_key, 'expected_version', v_ev, 'asset_id', v_asset, 'basis', v_basis,
    'work_rate', v_work, 'standby_rate', v_standby, 'rate_unit', v_unit, 'driver', v_driver,
    'count_standby', v_count_standby, 'charge_category', v_cat,
    'account', v_account, 'account_group', v_group, 'cost_center', v_cc, 'party_type', v_ptype, 'party', v_party,
    'effective_from', v_from, 'effective_to', v_to, 'specificity', v_spec);
end $$;

-- A saved row's content keys, so an identical save is detected exactly (0376 :367-370).
create function public.equipment_costing_content(p_id uuid) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'asset_id', s.asset_id, 'basis', s.basis, 'work_rate', s.work_rate, 'standby_rate', s.standby_rate,
    'rate_unit', s.rate_unit, 'driver', s.driver, 'count_standby', s.count_standby, 'charge_category', s.charge_category,
    'account', s.match_account, 'account_group', s.match_account_group, 'cost_center', s.match_cost_center,
    'party_type', s.match_party_type, 'party', s.match_party, 'effective_from', s.effective_from, 'effective_to', s.effective_to)
  from public.equipment_costing_settings s where s.id = p_id
$$;

-- The overlap predicate of 0376 :191-205, extracted so S3 reuses it for the cost-attribution side.
create function public.cost_attribution_matches_overlap(p_org uuid,
    a_account text, a_group text, a_cc text, a_ptype text, a_party text,
    b_account text, b_group text, b_cc text, b_ptype text, b_party text) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select (a_cc is null or b_cc is null or a_cc = b_cc)
     and (a_party is null or b_party is null
          or (a_party = b_party and (a_ptype is null or b_ptype is null or a_ptype = b_ptype)))
     and ((a_account is not null and a_account = b_account)
          or (a_group is not null and b_group is not null
              and (a_group = b_group
                   or exists (select 1 from public.erp_account_mirror g1 join public.erp_account_mirror g2
                                on g2.org_id = g1.org_id and g2.company = g1.company
                              where g1.org_id = p_org and g1.erp_name = a_group and g1.is_group
                                and g2.erp_name = b_group and g2.is_group
                                and ((g1.lft <= g2.lft and g2.rgt <= g1.rgt) or (g2.lft <= g1.lft and g1.rgt <= g2.rgt)))))
          -- an account under a group overlaps that group (0376 compares like with like; equipment mixes them)
          or (a_account is not null and b_group is not null and exists (
                select 1 from public.erp_account_mirror g join public.erp_account_mirror x
                  on x.org_id = g.org_id and x.company = g.company and x.lft > g.lft and x.rgt < g.rgt
                 where g.org_id = p_org and g.erp_name = b_group and g.is_group and x.erp_name = a_account))
          or (b_account is not null and a_group is not null and exists (
                select 1 from public.erp_account_mirror g join public.erp_account_mirror x
                  on x.org_id = g.org_id and x.company = g.company and x.lft > g.lft and x.rgt < g.rgt
                 where g.org_id = p_org and g.erp_name = a_group and g.is_group and x.erp_name = b_account)))
$$;

-- ── effective windows and approved usage (S2.4): the single source for every reader ─────────────────
create function public.equipment_settings_effective(p_org_id uuid, p_draft jsonb default null)
returns table(id uuid, setting_key uuid, version int, asset_id uuid, basis text, work_rate numeric, standby_rate numeric,
              rate_unit text, driver text, count_standby boolean, charge_category public.budget_category,
              match_account text, match_account_group text, match_cost_center text, match_party_type text, match_party text,
              specificity int, window_from date, window_to date)
language sql stable set search_path = public, pg_temp as $$
  with d as (
    select coalesce(nullif(p_draft->>'setting_key','')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) as setting_key,
           (p_draft->>'effective_from')::date as effective_from
     where p_draft is not null
  ), v as (
    select s.id, s.setting_key, s.version, s.asset_id, s.basis, s.work_rate, s.standby_rate, s.rate_unit, s.driver,
           s.count_standby, s.charge_category, s.match_account, s.match_account_group, s.match_cost_center,
           s.match_party_type, s.match_party, s.specificity, s.effective_from as window_from,
           least(coalesce(s.effective_to, 'infinity'::date), coalesce(s.applies_to, 'infinity'::date),
                 coalesce((select greatest(s.effective_from, d.effective_from) - 1 from d where d.setting_key = s.setting_key),
                          'infinity'::date)) as window_to
      from public.equipment_costing_settings s where s.org_id = p_org_id
    union all
    select null::uuid, d.setting_key, coalesce(nullif(p_draft->>'expected_version','')::int, 0) + 1, (p_draft->>'asset_id')::uuid,
           p_draft->>'basis', (p_draft->>'work_rate')::numeric, (p_draft->>'standby_rate')::numeric, p_draft->>'rate_unit',
           p_draft->>'driver', coalesce((p_draft->>'count_standby')::boolean, false), (p_draft->>'charge_category')::public.budget_category,
           p_draft->>'account', p_draft->>'account_group', p_draft->>'cost_center', p_draft->>'party_type', p_draft->>'party',
           (p_draft->>'specificity')::int, d.effective_from, coalesce((p_draft->>'effective_to')::date, 'infinity'::date)
      from d
  )
  select * from v where v.window_to >= v.window_from
$$;

create function public.equipment_usage_by_project(p_org_id uuid)
returns table(asset_id uuid, project_id uuid, month date, kind text, unit text, quantity numeric, fuel_litres numeric,
              trips numeric, entry_count int, as_of timestamptz)
language sql stable set search_path = public, pg_temp as $$
  select e.asset_id, e.project_id, date_trunc('month', e.work_date)::date, e.kind, e.unit, sum(e.quantity),
         sum(coalesce(e.fuel_litres, 0)), sum(coalesce(e.trips, 0))::numeric, count(*)::int, max(e.approved_at)
    from public.equipment_usage_entries e
   where e.org_id = p_org_id and e.status = 'Approved' and e.archived_at is null      -- FR-EQU-012: approved only
   group by 1, 2, 3, 4, 5
$$;

-- p_draft is always a normalised object (from equipment_costing_normalize), never raw client JSON.
-- Refuse a setting that ties another over overlapping dates, and a unit that contradicts logged usage.
create function public.equipment_costing_assert_no_conflict(p_org uuid, p_norm jsonb) returns void
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_from date := (p_norm->>'effective_from')::date;
  v_to date := coalesce((p_norm->>'effective_to')::date, 'infinity'::date);
  v_key uuid := coalesce(nullif(p_norm->>'setting_key','')::uuid, '00000000-0000-0000-0000-000000000000'::uuid);
  v_asset uuid := (p_norm->>'asset_id')::uuid;
  v_spec int := (p_norm->>'specificity')::int;
  v_unit text := p_norm->>'rate_unit';
  v_name text; v_start date;
begin
  if v_to < v_from then return; end if;   -- a voided window matches nothing
  -- (a) FR-EQU-034: one effective setting per asset per day. Every effective version counts, not only the current one.
  select a.code into v_name
    from public.equipment_settings_effective(p_org, p_norm) v join public.equipment_assets a on a.id = v.asset_id
   where v.asset_id = v_asset and v.setting_key <> v_key and v.window_from <= v_to and v_from <= v.window_to
   order by v.window_from limit 1;
  if v_name is not null then
    raise exception 'asset % already has a costing setting over those dates', v_name using errcode = '23505';
  end if;
  if p_norm->>'basis' = 'actual_cost' then
    -- (b) a current cost attribution rule of equal or greater specificity over the same dates
    select r.name into v_name
      from public.cost_attribution_rules r
     where r.org_id = p_org and r.is_current and r.specificity >= v_spec
       and (r.effective_to is null or r.effective_to >= r.effective_from)
       and r.effective_from <= v_to and v_from <= coalesce(r.effective_to, 'infinity'::date)
       and public.cost_attribution_matches_overlap(p_org, p_norm->>'account', p_norm->>'account_group', p_norm->>'cost_center',
             p_norm->>'party_type', p_norm->>'party', r.match_account, r.match_account_group, r.match_cost_center,
             r.match_party_type, r.match_party)
     order by r.name limit 1;
    if v_name is not null then
      raise exception 'conflicts with rule "%": equal or greater specificity, overlapping dates and matches', v_name using errcode = '23505';
    end if;
    -- (c) another asset's actual-cost setting of equal specificity the engine could only break by key
    select a.code into v_name
      from public.equipment_settings_effective(p_org, p_norm) v join public.equipment_assets a on a.id = v.asset_id
     where v.basis = 'actual_cost' and v.asset_id <> v_asset and v.specificity = v_spec
       and v.window_from <= v_to and v_from <= v.window_to
       and public.cost_attribution_matches_overlap(p_org, p_norm->>'account', p_norm->>'account_group', p_norm->>'cost_center',
             p_norm->>'party_type', p_norm->>'party', v.match_account, v.match_account_group, v.match_cost_center,
             v.match_party_type, v.match_party)
     order by a.code limit 1;
    if v_name is not null then
      raise exception 'conflicts with the actual-cost setting of asset %: same specificity, overlapping dates and matches', v_name
        using errcode = '23505';
    end if;
  end if;
  -- FR-EQU-032: one unit per asset per setting. An actual-cost version shares its pool over the whole month (PQ-5).
  if v_unit is not null then
    v_start := case when p_norm->>'basis' = 'actual_cost' then date_trunc('month', v_from)::date else v_from end;
    if exists (select 1 from public.equipment_usage_entries e
                where e.org_id = p_org and e.asset_id = v_asset and e.archived_at is null and e.status <> 'Rejected'
                  and e.unit <> v_unit and e.work_date between v_start and v_to) then
      raise exception 'mixed units: this asset has % entries in that window; a setting costs one unit',
        case v_unit when 'hours' then 'days' else 'hours' end using errcode = '22023';
    end if;
  end if;
end $$;

-- ── hire-rate charges (S2.5, FR-EQU-040, OQ-6, D5) ─────────────────────────────────────────────────
-- Every effective version (and the draft, setting_id null) is in scope; a preview filters setting_id is null.
create function public.equipment_hire_charges(p_org_id uuid, p_draft jsonb default null, p_project_id uuid default null)
returns table(setting_id uuid, setting_key uuid, version int, asset_id uuid, project_id uuid, month date,
              category public.budget_category, fiscal_year text, work_units numeric, standby_units numeric,
              work_rate numeric, standby_rate numeric, amount numeric, entry_count int, as_of timestamptz, rate_unit text)
language sql stable set search_path = public, pg_temp as $$
  select v.id, v.setting_key, v.version, v.asset_id, e.project_id, date_trunc('month', e.work_date)::date, v.charge_category,
         to_char(e.work_date, 'YYYY'),                                                              -- PQ-2
         coalesce(sum(e.quantity) filter (where e.kind = 'work'), 0),
         coalesce(sum(e.quantity) filter (where e.kind = 'standby'), 0),
         v.work_rate, v.standby_rate,
         round(coalesce(sum(e.quantity) filter (where e.kind = 'work'), 0) * v.work_rate
             + coalesce(sum(e.quantity) filter (where e.kind = 'standby'), 0) * coalesce(v.standby_rate, 0), 2),  -- once per row
         count(*)::int, max(e.approved_at), v.rate_unit
    from public.equipment_settings_effective(p_org_id, p_draft) v
    join public.equipment_usage_entries e
      on e.org_id = p_org_id and e.asset_id = v.asset_id and e.status = 'Approved' and e.archived_at is null
     and e.work_date between v.window_from and v.window_to
   where v.basis = 'hire_rate' and (p_project_id is null or e.project_id = p_project_id)
   group by v.id, v.setting_key, v.version, v.asset_id, e.project_id, date_trunc('month', e.work_date), v.charge_category,
            to_char(e.work_date, 'YYYY'), v.work_rate, v.standby_rate, v.rate_unit
$$;

-- ── writer and the client RPCs (S2.6) ──────────────────────────────────────────────────────────────
-- Shared writer: a new setting (no setting_key) or a new version of the current one (0376 cost_attribution_write).
create function public.equipment_costing_write(p_setting jsonb, p_action text, p_check_accounts boolean)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_norm jsonb; v_key uuid; v_cur public.equipment_costing_settings; v_before jsonb; v_after jsonb;
  v_id uuid; v_version int := 1; v_content jsonb; v_from date;
begin
  perform pg_advisory_xact_lock(hashtextextended('equipment_costing:' || v_org::text, 0));
  v_norm := public.equipment_costing_normalize(v_org, p_setting, p_check_accounts);
  v_key := (v_norm->>'setting_key')::uuid;
  v_from := (v_norm->>'effective_from')::date;
  v_content := v_norm - 'setting_key' - 'specificity' - 'expected_version';
  if v_key is not null then
    select * into v_cur from public.equipment_costing_settings s
     where s.org_id = v_org and s.setting_key = v_key and s.is_current for update;
    if not found then raise exception 'setting not found' using errcode = 'P0002'; end if;
    if nullif(p_setting->>'expected_version', '') is null
       or (p_setting->>'expected_version') !~ '^\d+$' or (p_setting->>'expected_version')::int <> v_cur.version then
      raise exception 'setting changed since it was loaded (current version %)', v_cur.version using errcode = '40001';
    end if;
    if v_cur.asset_id is distinct from (v_norm->>'asset_id')::uuid then
      raise exception 'a setting cannot move to another asset' using errcode = '22023';
    end if;
    v_before := public.equipment_costing_content(v_cur.id);
    if v_before = v_content then
      return jsonb_build_object('setting_key', v_key, 'version', v_cur.version, 'id', v_cur.id, 'changed', false);
    end if;
    v_version := v_cur.version + 1;
  else
    if p_action <> 'create' then raise exception 'setting not found' using errcode = 'P0002'; end if;
    v_key := gen_random_uuid();
    v_norm := jsonb_set(v_norm, '{setting_key}', to_jsonb(v_key));
  end if;
  perform public.equipment_costing_assert_no_conflict(v_org, v_norm);
  if v_cur.id is not null then
    -- PQ-4 / FR-EQU-045: earlier versions keep applying only up to the day before the new version starts.
    update public.equipment_costing_settings s
       set applies_to = greatest(s.effective_from, v_from) - 1
     where s.org_id = v_org and s.setting_key = v_key
       and least(coalesce(s.effective_to, 'infinity'::date), coalesce(s.applies_to, 'infinity'::date)) >= v_from;
    update public.equipment_costing_settings set is_current = false where id = v_cur.id;   -- also when its window ends earlier
  end if;
  insert into public.equipment_costing_settings (org_id, asset_id, setting_key, version, is_current, basis, work_rate, standby_rate,
      rate_unit, driver, count_standby, charge_category, match_account, match_account_group, match_cost_center, match_party_type,
      match_party, specificity, effective_from, effective_to, created_by)
  values (v_org, (v_norm->>'asset_id')::uuid, v_key, v_version, true, v_norm->>'basis', (v_norm->>'work_rate')::numeric,
      (v_norm->>'standby_rate')::numeric, v_norm->>'rate_unit', v_norm->>'driver', (v_norm->>'count_standby')::boolean,
      (v_norm->>'charge_category')::public.budget_category, v_norm->>'account', v_norm->>'account_group',
      v_norm->>'cost_center', v_norm->>'party_type', v_norm->>'party', (v_norm->>'specificity')::int, v_from,
      (v_norm->>'effective_to')::date, v_uid)
  returning id into v_id;
  v_after := public.equipment_costing_content(v_id);
  perform public.log_audit('equipment_costing.' || case when v_cur.id is null then 'create' else p_action end,
    v_org, v_uid, v_id, jsonb_build_object('setting_key', v_key, 'version', v_version, 'before', v_before, 'after', v_after));
  return jsonb_build_object('setting_key', v_key, 'version', v_version, 'id', v_id, 'changed', true);
end $$;

create function public.save_equipment_costing(p_setting jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Finance') then          -- FR-EQU-033
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return public.equipment_costing_write(p_setting, case when nullif(p_setting->>'setting_key','') is null then 'create' else 'update' end, true);
end $$;

-- End = a new version with effective_to set (effective_from − 1 voids it). Accounts are not re-checked, so a setting
-- whose account has since left the chart can still be ended.
create function public.end_equipment_costing(p_setting_key uuid, p_effective_to date, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur public.equipment_costing_settings;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_effective_to is null then raise exception 'effective_to is required' using errcode = '22023'; end if;
  select * into v_cur from public.equipment_costing_settings s
   where s.org_id = public.auth_org_id() and s.setting_key = p_setting_key and s.is_current;
  if not found then raise exception 'setting not found' using errcode = 'P0002'; end if;
  return public.equipment_costing_write(
    public.equipment_costing_content(v_cur.id)
      || jsonb_build_object('setting_key', p_setting_key, 'expected_version', p_expected_version, 'effective_to', p_effective_to),
    'end', false);
end $$;

-- Definer, not invoker as 0376's list: window_to comes from equipment_settings_effective, an internal helper with no
-- client EXECUTE. The definer bypasses RLS, so the org filter and the role gate MUST stay.
create function public.list_equipment_costing(p_include_history boolean default false)
returns table(id uuid, setting_key uuid, version int, is_current boolean, asset_id uuid, asset_code text, asset_name text,
              basis text, work_rate numeric, standby_rate numeric, rate_unit text, driver text, count_standby boolean,
              charge_category public.budget_category, match_account text, match_account_group text, match_cost_center text,
              match_party_type text, match_party text, specificity int, effective_from date, effective_to date,
              window_to date, created_by uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select s.id, s.setting_key, s.version, s.is_current, s.asset_id, a.code, a.name, s.basis, s.work_rate, s.standby_rate,
           s.rate_unit, s.driver, s.count_standby, s.charge_category, s.match_account, s.match_account_group,
           s.match_cost_center, s.match_party_type, s.match_party, s.specificity, s.effective_from, s.effective_to,
           nullif(w.window_to, 'infinity'::date), s.created_by, s.created_at
      from public.equipment_costing_settings s
      join public.equipment_assets a on a.id = s.asset_id
      left join public.equipment_settings_effective(public.auth_org_id(), null) w on w.id = s.id
     where s.org_id = public.auth_org_id() and (p_include_history or s.is_current)
     order by a.code, s.setting_key, s.version desc;
end $$;

-- Preview = save by construction: the same normaliser, conflict check and charge function the save path uses.
create function public.preview_equipment_costing(p_setting jsonb)
returns table(project_id uuid, month date, category public.budget_category, basis text, amount numeric,
              driver_total numeric, entry_count int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_norm jsonb;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_norm := public.equipment_costing_normalize(v_org, p_setting, true);
  if v_norm->>'setting_key' is not null and not exists (
       select 1 from public.equipment_costing_settings s
        where s.org_id = v_org and s.setting_key = (v_norm->>'setting_key')::uuid and s.is_current) then
    raise exception 'setting not found' using errcode = 'P0002';
  end if;
  perform public.equipment_costing_assert_no_conflict(v_org, v_norm);
  return query
    select c.project_id, c.month, c.category, 'hire_rate'::text, c.amount, null::numeric, c.entry_count
      from public.equipment_hire_charges(v_org, v_norm, null) c
     where c.setting_id is null
     order by c.month, c.project_id;
end $$;

-- ── reads (S2.7, FR-EQU-043/044, FR-EQU-062, PQ-11) ────────────────────────────────────────────────
-- Deviation from the plan: a trailing `unit` column, because an asset without a setting may hold hours and days and a
-- sum across units is a wrong number; a usage-only row is therefore one per unit.
create function public.list_equipment_allocations(p_asset_id uuid, p_from date, p_to date, p_project_id uuid default null)
returns table(asset_id uuid, asset_code text, project_id uuid, project_name text, month date, basis text, setting_key uuid,
              version int, status text, reason text, driver text, work_units numeric, standby_units numeric,
              work_rate numeric, standby_rate numeric, pool numeric, driver_value numeric, driver_total numeric,
              share numeric, amount numeric, category public.budget_category, line_count int, entry_count int, unit text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  if not public.is_active_member() or coalesce(public.auth_role()::text, '') not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if (p_asset_id is null and p_project_id is null) or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then
    raise exception 'name an asset or a project and a range of at most two years' using errcode = '22023';
  end if;
  return query
    with eff as materialized (select * from public.equipment_settings_effective(v_org, null))
    -- hire_rate charges
    select c.asset_id, a.code, c.project_id, p.name, c.month, 'hire_rate'::text, c.setting_key, c.version, 'allocated'::text,
           null::text, 'units'::text, c.work_units, c.standby_units, c.work_rate, c.standby_rate, null::numeric, null::numeric,
           null::numeric, null::numeric, c.amount, c.category, 0, c.entry_count, c.rate_unit
      from public.equipment_hire_charges(v_org, null, p_project_id) c
      join public.equipment_assets a on a.id = c.asset_id join public.projects p on p.id = c.project_id
     where (p_asset_id is null or c.asset_id = p_asset_id) and c.month between date_trunc('month', p_from)::date and p_to
    union all
    -- basis none / no setting on the work date: usage totals, no amount (FR-EQU-043)
    select e.asset_id, a.code, e.project_id, p.name, date_trunc('month', e.work_date)::date, 'none'::text, x.setting_key, x.version,
           'usage_only'::text, null::text, null::text, sum(e.quantity) filter (where e.kind = 'work'),
           sum(e.quantity) filter (where e.kind = 'standby'), null::numeric, null::numeric, null::numeric, null::numeric,
           null::numeric, null::numeric, null::numeric, null::public.budget_category, 0, count(*)::int, e.unit
      from public.equipment_usage_entries e
      join public.equipment_assets a on a.id = e.asset_id join public.projects p on p.id = e.project_id
      left join eff x on x.asset_id = e.asset_id and e.work_date between x.window_from and x.window_to
     where e.org_id = v_org and e.status = 'Approved' and e.archived_at is null
       and (p_asset_id is null or e.asset_id = p_asset_id) and (p_project_id is null or e.project_id = p_project_id)
       and e.work_date >= date_trunc('month', p_from)::date and e.work_date < (date_trunc('month', p_to) + interval '1 month')::date
       and coalesce(x.basis, 'none') = 'none'
     group by e.asset_id, a.code, e.project_id, p.name, date_trunc('month', e.work_date), x.setting_key, x.version, e.unit
    order by 5, 4, 2;
end $$;

-- Any active member (FR-EQU-062): an Engineer reads each asset's approved totals and what is waiting, never an amount.
create function public.list_equipment_usage_totals(p_project_id uuid default null, p_asset_id uuid default null,
                                                   p_from date default null, p_to date default null)
returns table(asset_id uuid, asset_code text, asset_name text, project_id uuid, project_name text, month date, unit text,
              work_units numeric, standby_units numeric, fuel_litres numeric, trips numeric, entry_count int, submitted_count int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  if not public.is_active_member() then raise exception 'not authorized' using errcode = '42501'; end if;
  if (p_asset_id is null and p_project_id is null) or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then
    raise exception 'name an asset or a project and a range of at most two years' using errcode = '22023';
  end if;
  return query
    select e.asset_id, a.code, a.name, e.project_id, p.name, date_trunc('month', e.work_date)::date, e.unit,
           sum(e.quantity) filter (where e.status = 'Approved' and e.kind = 'work'),
           sum(e.quantity) filter (where e.status = 'Approved' and e.kind = 'standby'),
           sum(coalesce(e.fuel_litres, 0)) filter (where e.status = 'Approved'),
           sum(coalesce(e.trips, 0)) filter (where e.status = 'Approved')::numeric,
           (count(*) filter (where e.status = 'Approved'))::int, (count(*) filter (where e.status = 'Submitted'))::int
      from public.equipment_usage_entries e
      join public.equipment_assets a on a.id = e.asset_id join public.projects p on p.id = e.project_id
     where e.org_id = v_org and e.status in ('Approved','Submitted') and e.archived_at is null
       and (p_asset_id is null or e.asset_id = p_asset_id) and (p_project_id is null or e.project_id = p_project_id)
       and e.work_date >= date_trunc('month', p_from)::date and e.work_date < (date_trunc('month', p_to) + interval '1 month')::date
     group by e.asset_id, a.code, a.name, e.project_id, p.name, date_trunc('month', e.work_date), e.unit
     order by 6, 5, 2;
end $$;

-- ── replace the unit lock (S2.8, FR-EQU-032) ───────────────────────────────────────────────────────
create or replace function public.equipment_entry_locked_unit(p_org uuid, p_asset uuid, p_date date) returns text
  language sql stable set search_path = public, pg_temp as $$
  select v.rate_unit from public.equipment_settings_effective(p_org, null) v
   where v.asset_id = p_asset
     and p_date between case when v.basis = 'actual_cost' then date_trunc('month', v.window_from)::date else v.window_from end
                    and v.window_to                       -- actual_cost: the whole first month feeds the driver (PQ-5)
     and (v.basis = 'hire_rate' or (v.basis = 'actual_cost' and v.driver = 'units'))
   order by v.window_from desc limit 1
$$;

-- ── grants ─────────────────────────────────────────────────────────────────────────────────────────
alter function public.save_equipment_costing(jsonb) owner to postgres;
alter function public.end_equipment_costing(uuid, date, int) owner to postgres;
alter function public.list_equipment_costing(boolean) owner to postgres;
alter function public.preview_equipment_costing(jsonb) owner to postgres;
alter function public.list_equipment_allocations(uuid, date, date, uuid) owner to postgres;
alter function public.list_equipment_usage_totals(uuid, uuid, date, date) owner to postgres;
revoke all on function public.equipment_costing_normalize(uuid, jsonb, boolean), public.equipment_costing_content(uuid),
  public.cost_attribution_matches_overlap(uuid, text, text, text, text, text, text, text, text, text, text),
  public.equipment_settings_effective(uuid, jsonb), public.equipment_usage_by_project(uuid),
  public.equipment_costing_assert_no_conflict(uuid, jsonb), public.equipment_hire_charges(uuid, jsonb, uuid),
  public.equipment_costing_write(jsonb, text, boolean), public.equipment_entry_locked_unit(uuid, uuid, date)
  from public, anon, authenticated;
revoke all on function public.save_equipment_costing(jsonb), public.end_equipment_costing(uuid, date, int),
  public.list_equipment_costing(boolean), public.preview_equipment_costing(jsonb),
  public.list_equipment_allocations(uuid, date, date, uuid), public.list_equipment_usage_totals(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.save_equipment_costing(jsonb), public.end_equipment_costing(uuid, date, int),
  public.list_equipment_costing(boolean), public.preview_equipment_costing(jsonb),
  public.list_equipment_allocations(uuid, date, date, uuid), public.list_equipment_usage_totals(uuid, uuid, date, date)
  to authenticated;

-- ── self-assertion (S2.10): internals stay internal, nothing new is reachable by anon or PUBLIC ──────
do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('equipment_costing_normalize', 'equipment_costing_content', 'cost_attribution_matches_overlap',
                       'equipment_settings_effective', 'equipment_usage_by_project', 'equipment_costing_assert_no_conflict',
                       'equipment_hire_charges', 'equipment_costing_write', 'equipment_entry_locked_unit')
     and (p.prosecdef or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then raise exception '0460: internal helper is a definer or client-executable: %', v_bad; end if;

  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    left join pg_roles r on r.oid = a.grantee
   where n.nspname = 'public'
     and (p.proname like 'equipment\_%' or p.proname like '%\_equipment\_%' or p.proname = 'cost_attribution_matches_overlap')
     and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or r.rolname = 'anon');
  if v_bad is not null then raise exception '0460: function executable by anon or PUBLIC: %', v_bad; end if;
end $$;
