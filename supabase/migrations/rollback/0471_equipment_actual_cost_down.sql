-- 0471_equipment_actual_cost_down.sql — reverse of 0471 (#1519 S3), reverse dependency order. Restores the bodies 0471
-- replaced: 0376 (allocations, assert_no_conflict) and 0460 (preview_equipment_costing, list_equipment_allocations).
drop trigger if exists equipment_usage_entries_guard_delete on public.equipment_usage_entries;
drop function if exists public.equipment_usage_guard_delete();
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
           null::text, null::text, c.work_units, c.standby_units, c.work_rate, c.standby_rate, null::numeric, null::numeric,
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
       and (coalesce(x.basis, 'none') = 'none' or (x.basis = 'hire_rate' and e.unit <> x.rate_unit))   -- never silently dropped
     group by e.asset_id, a.code, e.project_id, p.name, date_trunc('month', e.work_date), x.setting_key, x.version, e.unit
    order by 5, 4, 2;
end $$;
-- the 5-argument wrapper FIRST: a re-created 4-argument overload would make every 3- and 4-argument call ambiguous
drop function if exists public.cost_attribution_allocations(uuid, jsonb, uuid, uuid, jsonb);
drop function if exists public.cost_attribution_engine(uuid, jsonb, uuid, uuid, jsonb);
create function public.cost_attribution_allocations(p_org_id uuid, p_draft jsonb default null, p_exclude_rule_key uuid default null,
                                                    p_project_id uuid default null)
returns table(gl_id uuid, rule_id uuid, rule_key uuid, project_id uuid, account text, fiscal_year text,
              posting_date date, party_type text, amount numeric, as_of timestamptz)
language sql stable set search_path = public, pg_temp as $$
  with draft as (
    select coalesce((p_draft->>'rule_key')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) as rule_key
    where p_draft is not null
  ), rules as (
    select r.id, r.rule_key, r.specificity, r.match_account, r.match_account_group, r.match_cost_center,
           r.match_party_type, r.match_party, r.effective_from, r.effective_to
      from public.cost_attribution_rules r
     where r.org_id = p_org_id and r.is_current
       and r.rule_key is distinct from p_exclude_rule_key
       and not exists (select 1 from draft d where d.rule_key = r.rule_key)
    union all
    select null::uuid, d.rule_key, (p_draft->>'specificity')::int, p_draft->>'account', p_draft->>'account_group',
           p_draft->>'cost_center', p_draft->>'party_type', p_draft->>'party',
           (p_draft->>'effective_from')::date, (p_draft->>'effective_to')::date
      from draft d
  ), targets as (
    select r.rule_key, t.position::int as position, t.project_id, t.percent
      from rules r join public.cost_attribution_rule_targets t on t.rule_id = r.id
    union all
    select d.rule_key, (e.ord - 1)::int, (e.v->>'project_id')::uuid, (e.v->>'percent')::numeric
      from draft d cross join lateral jsonb_array_elements(p_draft->'targets') with ordinality e(v, ord)
  ), project_rules as (
    select distinct t.rule_key from targets t where p_project_id is null or t.project_id = p_project_id
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
  ), winners as (
    select distinct on (l.id) l.id as gl_id, ra.id as rule_id, ra.rule_key, l.account, l.fiscal_year, l.posting_date,
           l.party_type, l.debit - l.credit as net, l.as_of
      from scan_accounts sa
      join public.erp_gl_entry_mirror l
        on l.org_id = p_org_id and l.account = sa.acct
       and coalesce(l.project, '') = '' and not l.is_cancelled
      join rule_accounts ra
        on ra.acct = l.account
       and l.posting_date >= ra.effective_from
       and (ra.effective_to is null or l.posting_date <= ra.effective_to)
       and (ra.match_cost_center is null or l.cost_center = ra.match_cost_center)
       and (ra.match_party is null or (l.party = ra.match_party
            and (ra.match_party_type is null or l.party_type = ra.match_party_type)))
     order by l.id, ra.specificity desc, ra.rule_key
  ), shares as (
    select w.*, t.project_id, t.position, round(w.net * t.percent / 100, 2) as share,
           row_number() over (partition by w.gl_id order by t.position desc) = 1 as is_last
      from winners w join targets t on t.rule_key = w.rule_key
     where w.rule_key in (select pr.rule_key from project_rules pr)
  ), placed as (
    select s.gl_id, s.rule_id, s.rule_key, s.project_id, s.account, s.fiscal_year, s.posting_date, s.party_type,
           case when s.is_last then s.net - (sum(s.share) over (partition by s.gl_id) - s.share) else s.share end as amount,
           s.as_of
      from shares s
  )
  select * from placed p where p_project_id is null or p.project_id = p_project_id
$$;
revoke all on function public.cost_attribution_allocations(uuid, jsonb, uuid, uuid) from public, anon, authenticated;
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
end $$;
revoke all on function public.cost_attribution_assert_no_conflict(uuid, jsonb) from public, anon, authenticated;
