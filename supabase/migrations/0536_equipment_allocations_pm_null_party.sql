-- 0536: keep a Project Manager share visible when the ERP party type is null.
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
           case when e.status = 'allocated' and (not v_pm or e.party_type is distinct from 'Employee') then e.amount end,
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
