-- 0471_equipment_actual_cost.sql — #1519 S3: `actual_cost` inside the cost attribution engine. Equipment settings with
-- basis actual_cost join #1271's rules as a second source in ONE engine (cost_attribution_engine, the 0376 body plus
-- equipment); cost_attribution_allocations stays as a thin wrapper so none of its four callers changes. One winner per
-- ledger line across both sources; the winner's pool is split by approved driver share; a pool with no driver is
-- returned as unallocated and reaches no figure. Also: the symmetric refusal (a #1271 rule that ties or beats an equipment
-- setting), the previews/reads gain actual_cost, and a guard so an Admin cannot hard-delete approved usage inside a
-- costed month (reopen, then archive). Spec: docs/specs/equipment-usage.spec.md. Plan: docs/plans/2026-11-01-equipment-usage.md S3.
-- Proven by supabase/tests/equipment_actual_cost.test.sql (+ the perf test) and, unchanged, supabase/tests/cost_attribution.test.sql.
-- Read-side only: nothing here posts to the ERP (OQ-1). The plan numbered this slice 0449; the coordinator allocated 0471.
-- ── REVERSE (also supabase/migrations/rollback/0471_equipment_actual_cost_down.sql) ───────────────────
--   drop trigger if exists equipment_usage_entries_guard_delete on public.equipment_usage_entries;
--   drop function if exists public.equipment_usage_guard_delete();
--   (restore S2's preview_equipment_costing and list_equipment_allocations bodies from 0460)
--   drop function if exists public.cost_attribution_allocations(uuid, jsonb, uuid, uuid, jsonb);   -- FIRST: a re-created 4-arg overload would make 3- and 4-arg calls ambiguous
--   drop function if exists public.cost_attribution_engine(uuid, jsonb, uuid, uuid, jsonb);
--   (re-create cost_attribution_allocations(uuid, jsonb, uuid, uuid) and cost_attribution_assert_no_conflict(uuid, jsonb) verbatim from 0376)

-- ── the engine (S3.2): the 0376 allocation body, plus equipment `actual_cost` as a second rule source (D4) ──
-- Every changed line is marked -- 0471. A line is placed once: `winners` picks one rule OR one equipment version per line
-- (specificity desc, then key), so nothing is counted twice (FR-EQU-034). Lines an equipment version wins are pooled per
-- (version, month, account, fiscal year, party type) and split by approved driver share, cents last-takes-remainder (PQ-6).
-- A pool with no driver is returned as `unallocated`, never dropped (FR-EQU-042); the wrapper below filters it from every figure.
-- p_equipment_draft: a normalised, previewed equipment setting (equipment_settings_effective overlays it with id null).
drop function public.cost_attribution_allocations(uuid, jsonb, uuid, uuid);   -- 0471: before any 4-argument re-create (ambiguity)
create function public.cost_attribution_engine(p_org_id uuid, p_draft jsonb default null, p_exclude_rule_key uuid default null,
                                               p_project_id uuid default null, p_equipment_draft jsonb default null)
returns table(source text, gl_id uuid, rule_id uuid, rule_key uuid, version int, asset_id uuid, project_id uuid, account text,
              fiscal_year text, posting_date date, party_type text, amount numeric, as_of timestamptz, pool numeric,
              driver text, driver_value numeric, driver_total numeric, line_count int, entry_count int, status text)
language sql stable set search_path = public, pg_temp as $$
  with draft as (
    select coalesce((p_draft->>'rule_key')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) as rule_key
    where p_draft is not null
  ), eq_versions as (                                                                                 -- 0471
    select v.* from public.equipment_settings_effective(p_org_id, p_equipment_draft) v where v.basis = 'actual_cost'  -- 0471
  ), rules as (
    select r.id, r.rule_key, r.specificity, r.match_account, r.match_account_group, r.match_cost_center,
           r.match_party_type, r.match_party, r.effective_from, r.effective_to, 'rule'::text as source          -- 0471 source
      from public.cost_attribution_rules r
     where r.org_id = p_org_id and r.is_current
       and r.rule_key is distinct from p_exclude_rule_key
       and not exists (select 1 from draft d where d.rule_key = r.rule_key)
    union all
    select null::uuid, d.rule_key, (p_draft->>'specificity')::int, p_draft->>'account', p_draft->>'account_group',
           p_draft->>'cost_center', p_draft->>'party_type', p_draft->>'party',
           (p_draft->>'effective_from')::date, (p_draft->>'effective_to')::date, 'rule'                         -- 0471 source
      from draft d
    union all                                                                                         -- 0471
    select v.id, v.setting_key, v.specificity, v.match_account, v.match_account_group, v.match_cost_center,   -- 0471
           v.match_party_type, v.match_party, v.window_from, nullif(v.window_to, 'infinity'::date), 'equipment'  -- 0471
      from eq_versions v                                                                              -- 0471
  ), targets as (
    select r.rule_key, t.position::int as position, t.project_id, t.percent
      from rules r join public.cost_attribution_rule_targets t on t.rule_id = r.id
    union all
    select d.rule_key, (e.ord - 1)::int, (e.v->>'project_id')::uuid, (e.v->>'percent')::numeric
      from draft d cross join lateral jsonb_array_elements(p_draft->'targets') with ordinality e(v, ord)
  ), project_rules as (
    select distinct t.rule_key from targets t where p_project_id is null or t.project_id = p_project_id
    union                                                                                             -- 0471
    select v.setting_key from eq_versions v                                                           -- 0471
     where p_project_id is null or exists (select 1 from public.equipment_usage_entries e             -- 0471
             where e.org_id = p_org_id and e.asset_id = v.asset_id and e.project_id = p_project_id    -- 0471
               and e.status = 'Approved' and e.archived_at is null)                                   -- 0471
  ), rule_accounts as (
    select r.*, r.match_account as acct from rules r where r.match_account is not null
    union all
    select r.*, a.erp_name
      from rules r
      join public.erp_account_mirror g on g.org_id = p_org_id and g.erp_name = r.match_account_group and g.is_group
      join public.erp_account_mirror a on a.org_id = p_org_id and a.company = g.company
                                       and a.lft > g.lft and a.rgt < g.rgt and not a.is_group
     where r.match_account_group is not null
  ), scan_accounts as (
    select distinct ra.acct from rule_accounts ra join project_rules pr on pr.rule_key = ra.rule_key
  ), ledger as materialized (                                 -- 0471 NFR-EQU-003: read once, then hash-joined to the rules on the cost centre
    select l.id, l.account, l.cost_center, l.party, l.party_type, l.fiscal_year, l.posting_date, l.debit - l.credit as net, l.as_of
      from scan_accounts sa
      join public.erp_gl_entry_mirror l
        on l.org_id = p_org_id and l.account = sa.acct
       and coalesce(l.project, '') = '' and not l.is_cancelled
  ), candidates as (                                          -- the 0376 join, split on the cost centre so each half is an equi-join
    select l.id as gl_id, ra.id as rule_id, ra.rule_key, ra.source, ra.specificity, l.account, l.fiscal_year, l.posting_date,
           l.party_type, l.net, l.as_of
      from ledger l
      join rule_accounts ra
        on ra.acct = l.account and ra.match_cost_center = l.cost_center
       and l.posting_date >= ra.effective_from
       and (ra.effective_to is null or l.posting_date <= ra.effective_to)
       and (ra.match_party is null or (l.party = ra.match_party
            and (ra.match_party_type is null or l.party_type = ra.match_party_type)))
    union all
    select l.id, ra.id, ra.rule_key, ra.source, ra.specificity, l.account, l.fiscal_year, l.posting_date,
           l.party_type, l.net, l.as_of
      from ledger l
      join rule_accounts ra
        on ra.acct = l.account and ra.match_cost_center is null
       and l.posting_date >= ra.effective_from
       and (ra.effective_to is null or l.posting_date <= ra.effective_to)
       and (ra.match_party is null or (l.party = ra.match_party
            and (ra.match_party_type is null or l.party_type = ra.match_party_type)))
  ), winners as (
    select distinct on (c.gl_id) c.gl_id, c.rule_id, c.rule_key, c.source, c.account, c.fiscal_year, c.posting_date,
           c.party_type, c.net, c.as_of
      from candidates c
     order by c.gl_id, c.specificity desc, c.rule_key
  ), shares as (
    select w.*, t.project_id, t.position, round(w.net * t.percent / 100, 2) as share,
           row_number() over (partition by w.gl_id order by t.position desc) = 1 as is_last
      from winners w join targets t on t.rule_key = w.rule_key
     where w.source = 'rule' and w.rule_key in (select pr.rule_key from project_rules pr)                -- 0471 source
  ), placed as (
    select s.gl_id, s.rule_id, s.rule_key, s.project_id, s.account, s.fiscal_year, s.posting_date, s.party_type,
           case when s.is_last then s.net - (sum(s.share) over (partition by s.gl_id) - s.share) else s.share end as amount,
           s.as_of
      from shares s
  ), eq_pools as (                                                                                    -- 0471 FR-EQU-041/042
    select w.rule_id, w.rule_key, date_trunc('month', w.posting_date)::date as month, w.account, w.fiscal_year, w.party_type,
           sum(w.net) as pool, count(*)::int as line_count, max(w.as_of) as as_of
      from winners w where w.source = 'equipment'
     group by 1, 2, 3, 4, 5, 6
  ), eq_all as materialized (                                                                         -- 0471 aggregated once, not per version
    select u.* from public.equipment_usage_by_project(p_org_id) u where u.asset_id in (select v.asset_id from eq_versions v)
  ), eq_usage as materialized (                                                                                    -- 0471 OQ-2, OQ-6
    select v.setting_key, v.id as version_id, u.month, u.project_id,
           sum(case v.driver when 'units' then u.quantity when 'fuel' then u.fuel_litres else u.trips end) as driver_value,
           sum(u.entry_count)::int as entry_count
      from eq_versions v join eq_all u on u.asset_id = v.asset_id
     where (u.kind = 'work' or v.count_standby)
       and (v.driver <> 'units' or u.unit = v.rate_unit)       -- never add hours to days (FR-EQU-032 refuses the mix; this holds if one slipped in)
     group by 1, 2, 3, 4
  ), eq_split as (                                                                                    -- 0471
    select p.*, v.version, v.asset_id, v.driver, x.project_id, x.driver_value, x.entry_count,
           sum(x.driver_value) over (partition by p.rule_key, p.rule_id, p.month, p.account, p.fiscal_year, p.party_type) as driver_total
      from eq_pools p
      join eq_versions v on v.setting_key = p.rule_key and v.id is not distinct from p.rule_id
      left join eq_usage x on x.setting_key = p.rule_key and x.version_id is not distinct from p.rule_id
                          and x.month = p.month and x.driver_value > 0
  ), eq_shares as (                                                                                   -- 0471 PQ-6
    select s.*, round(s.pool * s.driver_value / s.driver_total, 2) as share,
           row_number() over (partition by s.rule_key, s.rule_id, s.month, s.account, s.fiscal_year, s.party_type
                              order by s.project_id desc) = 1 as is_last
      from eq_split s where s.driver_total > 0
  ), eq_placed as (                                                                                   -- 0471 FR-CAT-022
    select s.*, case when s.is_last
                     then s.pool - (sum(s.share) over (partition by s.rule_key, s.rule_id, s.month, s.account, s.fiscal_year, s.party_type) - s.share)
                     else s.share end as amount
      from eq_shares s
  )
  select 'rule'::text, p.gl_id, p.rule_id, p.rule_key, null::int, null::uuid, p.project_id, p.account, p.fiscal_year,
         p.posting_date, p.party_type, p.amount, p.as_of, null::numeric, null::text, null::numeric, null::numeric, 1,
         null::int, 'allocated'::text
    from placed p where p_project_id is null or p.project_id = p_project_id
  union all                                                                                           -- 0471
  select 'equipment', null, e.rule_id, e.rule_key, e.version, e.asset_id, e.project_id, e.account, e.fiscal_year, e.month,
         e.party_type, e.amount, e.as_of, e.pool, e.driver, e.driver_value, e.driver_total, e.line_count, e.entry_count, 'allocated'
    from eq_placed e where p_project_id is null or e.project_id = p_project_id
  union all                                                                                           -- 0471 never dropped
  select distinct on (s.rule_key, s.rule_id, s.month, s.account, s.fiscal_year, s.party_type)
         'equipment', null, s.rule_id, s.rule_key, s.version, s.asset_id, null::uuid, s.account, s.fiscal_year, s.month,
         s.party_type, s.pool, s.as_of, s.pool, s.driver, null::numeric, 0::numeric, s.line_count, 0, 'unallocated'
    from eq_split s where coalesce(s.driver_total, 0) = 0 and p_project_id is null
$$;
revoke all on function public.cost_attribution_engine(uuid, jsonb, uuid, uuid, jsonb) from public, anon, authenticated;

-- ── the wrapper (S3.3): the 0376 signature plus a trailing default, so the four callers need no change ──────
create function public.cost_attribution_allocations(p_org_id uuid, p_draft jsonb default null, p_exclude_rule_key uuid default null,
                                                    p_project_id uuid default null, p_equipment_draft jsonb default null)
returns table(gl_id uuid, rule_id uuid, rule_key uuid, project_id uuid, account text, fiscal_year text,
              posting_date date, party_type text, amount numeric, as_of timestamptz)
language sql stable set search_path = public, pg_temp as $$
  select e.gl_id, e.rule_id, e.rule_key, e.project_id, e.account, e.fiscal_year, e.posting_date, e.party_type, e.amount, e.as_of
    from public.cost_attribution_engine(p_org_id, p_draft, p_exclude_rule_key, p_project_id, p_equipment_draft) e
   where e.status = 'allocated'      -- an unallocated pool reaches no project figure
$$;
revoke all on function public.cost_attribution_allocations(uuid, jsonb, uuid, uuid, jsonb) from public, anon, authenticated;

-- ── symmetric tie refusal (S3.4, spec delta 4): 0376 body + one lookup ─────────────────────────────
create or replace function public.cost_attribution_assert_no_conflict(p_org_id uuid, p_norm jsonb) returns void
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_name text;
  v_key uuid := (p_norm->>'rule_key')::uuid;
  v_from date := (p_norm->>'effective_from')::date;
  v_to date := (p_norm->>'effective_to')::date;
begin
  if v_to is not null and v_to < v_from then return; end if;  -- a voided window matches nothing
  select r.name into v_name
    from public.cost_attribution_rules r
   where r.org_id = p_org_id and r.is_current
     and (v_key is null or r.rule_key <> v_key)
     and r.specificity = (p_norm->>'specificity')::int
     and (r.effective_to is null or r.effective_to >= r.effective_from)
     and r.effective_from <= coalesce(v_to, 'infinity'::date)
     and v_from <= coalesce(r.effective_to, 'infinity'::date)
     and (r.match_cost_center is null or p_norm->>'cost_center' is null or r.match_cost_center = p_norm->>'cost_center')
     and (r.match_party is null or p_norm->>'party' is null
          or (r.match_party = p_norm->>'party'
              and (r.match_party_type is null or p_norm->>'party_type' is null or r.match_party_type = p_norm->>'party_type')))
     and ((r.match_account is not null and r.match_account = p_norm->>'account')
          or (r.match_account_group is not null and p_norm->>'account_group' is not null
              and (r.match_account_group = p_norm->>'account_group'
                   or exists (select 1 from public.erp_account_mirror g1 join public.erp_account_mirror g2
                                on g2.org_id = g1.org_id and g2.company = g1.company
                             where g1.org_id = p_org_id and g1.erp_name = r.match_account_group and g1.is_group
                               and g2.erp_name = p_norm->>'account_group' and g2.is_group
                               and ((g1.lft <= g2.lft and g2.rgt <= g1.rgt) or (g2.lft <= g1.lft and g1.rgt <= g2.rgt))))))
   order by r.name limit 1;
  if v_name is not null then
    raise exception 'conflicts with rule "%": same specificity, overlapping dates and matches', v_name using errcode = '23505';
  end if;
  -- 0471 (spec delta 4): also refuse a rule that ties or beats an effective actual-cost equipment setting (every effective
  -- version, not only the current one: older versions keep applying to their dates). This is exactly the set 0460's
  -- equipment_costing_assert_no_conflict (b) refuses from the other side (rule specificity >= setting specificity, FR-EQU-034),
  -- so the two checks agree whichever is saved first.
  select a.code into v_name
    from public.equipment_settings_effective(p_org_id, null) v join public.equipment_assets a on a.id = v.asset_id
   where v.basis = 'actual_cost' and v.specificity <= (p_norm->>'specificity')::int
     and v.window_from <= coalesce(v_to, 'infinity'::date) and v_from <= v.window_to
     and public.cost_attribution_matches_overlap(p_org_id, p_norm->>'account', p_norm->>'account_group', p_norm->>'cost_center',
           p_norm->>'party_type', p_norm->>'party', v.match_account, v.match_account_group, v.match_cost_center,
           v.match_party_type, v.match_party)
   order by a.code limit 1;
  if v_name is not null then
    raise exception 'conflicts with the equipment costing of asset %: equal or greater specificity, overlapping dates and matches', v_name
      using errcode = '23505';
  end if;
end $$;

-- ── previews and reads gain actual_cost (S3.5); bodies from 0460 + the marked additions ──────────────
create or replace function public.preview_equipment_costing(p_setting jsonb)
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
  if v_norm->>'basis' = 'actual_cost' then   -- 0471: the same engine a saved setting is allocated by (FR-EQU-070), draft overlaid
    return query
      select e.project_id, e.posting_date, m.category, 'actual_cost'::text, sum(e.amount), max(e.driver_total), sum(e.entry_count)::int
        from public.cost_attribution_engine(v_org, null, null, null, v_norm) e
        left join public.budget_category_account_map m on m.org_id = v_org and m.erp_account = e.account
       where e.source = 'equipment' and e.rule_id is null          -- the draft only; the project-null rows are its unallocated pools
         and (e.party_type is distinct from 'Employee' or coalesce(public.holds_spend_approval_authority(public.auth_role()), false))
       group by e.project_id, e.posting_date, m.category
       order by 2, 1;
    return;
  end if;
  return query
    select c.project_id, c.month, c.category, 'hire_rate'::text, c.amount, null::numeric, c.entry_count
      from public.equipment_hire_charges(v_org, v_norm, null) c
     where c.setting_id is null
     order by c.month, c.project_id;
end $$;

create or replace function public.list_equipment_allocations(p_asset_id uuid, p_from date, p_to date, p_project_id uuid default null)
returns table(asset_id uuid, asset_code text, project_id uuid, project_name text, month date, basis text, setting_key uuid,
              version int, status text, reason text, driver text, work_units numeric, standby_units numeric,
              work_rate numeric, standby_rate numeric, pool numeric, driver_value numeric, driver_total numeric,
              share numeric, amount numeric, category public.budget_category, line_count int, entry_count int, unit text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  -- Director ruling (2026-11-02): ledger-read stays Admin/Finance/Executive (0311). A Project Manager sees their share and the
  -- non-payroll amounts, but not the pool, its line count, the driver total, or any Employee-party amount.
  v_pm boolean := coalesce(public.auth_role()::text, '') = 'Project Manager';
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
           null::text, null::text, c.work_units, c.standby_units, c.work_rate, c.standby_rate, null::numeric, null::numeric,
           null::numeric, null::numeric, c.amount, c.category, case when v_pm then null else 0 end, c.entry_count, c.rate_unit
      from public.equipment_hire_charges(v_org, null, p_project_id) c
      join public.equipment_assets a on a.id = c.asset_id join public.projects p on p.id = c.project_id
     where (p_asset_id is null or c.asset_id = p_asset_id) and c.month between date_trunc('month', p_from)::date and p_to
    union all
    -- basis none / no setting on the work date: usage totals, no amount (FR-EQU-043)
    select e.asset_id, a.code, e.project_id, p.name, date_trunc('month', e.work_date)::date, 'none'::text, x.setting_key, x.version,
           'usage_only'::text, null::text, null::text, sum(e.quantity) filter (where e.kind = 'work'),
           sum(e.quantity) filter (where e.kind = 'standby'), null::numeric, null::numeric, null::numeric, null::numeric,
           null::numeric, null::numeric, null::numeric, null::public.budget_category, case when v_pm then null else 0 end, count(*)::int, e.unit
      from public.equipment_usage_entries e
      join public.equipment_assets a on a.id = e.asset_id join public.projects p on p.id = e.project_id
      left join eff x on x.asset_id = e.asset_id and e.work_date between x.window_from and x.window_to
     where e.org_id = v_org and e.status = 'Approved' and e.archived_at is null
       and (p_asset_id is null or e.asset_id = p_asset_id) and (p_project_id is null or e.project_id = p_project_id)
       and e.work_date >= date_trunc('month', p_from)::date and e.work_date < (date_trunc('month', p_to) + interval '1 month')::date
       and (coalesce(x.basis, 'none') = 'none' or (x.basis = 'hire_rate' and e.unit <> x.rate_unit))   -- never silently dropped
       -- 0471: an actual_cost version shares its pool over whole months (PQ-5), so every entry of a covered month already drives the
       -- allocation (the delete guard's month rule): each entry is counted in exactly one arm
       and not exists (select 1 from eff y where y.asset_id = e.asset_id and y.basis = 'actual_cost'
                         and date_trunc('month', e.work_date)::date >= date_trunc('month', y.window_from)::date
                         and date_trunc('month', e.work_date)::date <= y.window_to)
     group by e.asset_id, a.code, e.project_id, p.name, date_trunc('month', e.work_date), x.setting_key, x.version, e.unit
    union all
    -- 0471: actual_cost pools and shares from the engine (FR-EQU-041/042/044); an unallocated pool is a row, never dropped
    select e.asset_id, a.code, e.project_id, p.name, e.posting_date, 'actual_cost'::text, e.rule_key, e.version, e.status,
           case when e.status = 'unallocated' then 'no_approved_usage' end, e.driver, null::numeric, null::numeric,
           null::numeric, null::numeric, case when v_pm then null else e.pool end, e.driver_value,
           case when v_pm then null else e.driver_total end,
           case when e.status = 'allocated' then round(e.amount / nullif(e.pool, 0), 6) end,
           case when e.status = 'allocated' and not (v_pm and e.party_type = 'Employee') then e.amount end,
           m.category, case when v_pm then null else e.line_count end, e.entry_count, x.rate_unit
      from public.cost_attribution_engine(v_org, null, null, p_project_id, null) e
      join public.equipment_assets a on a.id = e.asset_id
      left join public.projects p on p.id = e.project_id
      left join eff x on x.id = e.rule_id
      left join public.budget_category_account_map m on m.org_id = v_org and m.erp_account = e.account
     where e.source = 'equipment' and (p_asset_id is null or e.asset_id = p_asset_id)
       and e.posting_date between date_trunc('month', p_from)::date and p_to
       and (e.party_type is distinct from 'Employee' or coalesce(public.holds_spend_approval_authority(public.auth_role()), false))
    order by 5, 4, 2;
end $$;

-- ── hard-delete guard (carry-forward from S1): approved usage inside a costed month is not deletable ──────────
-- S1 let an Admin hard-delete an Approved entry while archive refuses it, so a delete could restate allocated months
-- without the audited reopen (FR-EQU-012). A month is costed when an effective hire_rate or actual_cost version covers the
-- work date (actual_cost: its whole months, the pool is shared over the month, PQ-5). Draft/Submitted/Rejected rows, archived
-- rows, and usage on assets with no costing stay deletable; the Admin path for the rest is reopen -> archive/delete.
create function public.equipment_usage_guard_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'Approved' and old.archived_at is null
     and exists (select 1 from public.equipment_settings_effective(old.org_id, null) v
                  where v.asset_id = old.asset_id and v.basis in ('hire_rate', 'actual_cost')
                    and case when v.basis = 'actual_cost'
                             then date_trunc('month', old.work_date)::date >= date_trunc('month', v.window_from)::date
                                  and date_trunc('month', old.work_date)::date <= v.window_to
                             else old.work_date between v.window_from and v.window_to end) then
    raise exception 'approved usage in a costed month cannot be deleted; reopen it, then archive it' using errcode = '22023';
  end if;
  return old;
end $$;
revoke all on function public.equipment_usage_guard_delete() from public, anon, authenticated;
create trigger equipment_usage_entries_guard_delete before delete on public.equipment_usage_entries
  for each row execute function public.equipment_usage_guard_delete();

-- ── self-assertion: the engine, its wrapper and the guard stay internal ──────────────────────────────
do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    left join pg_roles r on r.oid = a.grantee
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('cost_attribution_engine', 'cost_attribution_allocations', 'equipment_usage_guard_delete')
     and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'));
  if v_bad is not null then raise exception '0471: engine, wrapper or guard is executable by a client role: %', v_bad; end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                and p.proname = 'cost_attribution_allocations' and p.pronargs <> 5) then
    raise exception '0471: a stale cost_attribution_allocations overload remains';
  end if;
end $$;
