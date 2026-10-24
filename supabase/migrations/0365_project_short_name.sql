-- #1325: optional PMO display name kept separate from contractual projects.name.
-- Reversal: rollback/0365_project_short_name_down.sql; optional aliases are discarded.
alter table public.projects add column short_name text;
comment on column public.projects.short_name is 'Optional PMO display name; contractual project name remains in name.';
grant insert (short_name), update (short_name) on public.projects to authenticated;

update public.record_history_config
   set captured = captured || '{"short_name":"text"}'::jsonb
 where table_name = 'projects';

create or replace function public.get_sales_pipeline()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with pl as (
    select
      p.id,
      p.name,
      p.short_name,
      p.code,
      p.pmo_project_number,
      p.service_line,p.sector,p.location,p.award_type,p.bidding_entity,
      p.client_id,
      p.end_client_id,
      p.status,
      p.contract_value,
      p.currency,
      p.tax_treatment,
      p.tax_rate, p.tax_base_numerator, p.tax_base_denominator,
      p.last_update,
      p.project_manager_id,
      coalesce(c.win_probability, 0) as win_prob
    from projects p
    left join pipeline_stage_config c on c.status = p.status
    where p.status::text = any(pipeline_project_statuses())
      and p.archived_at is null
  )
  select json_build_object(
    'stages', coalesce((
      select json_agg(
        json_build_object(
          'status',        s.status,
          'count',         s.cnt,
          'total_value',   s.total_value,
          'win_probability', s.win_prob,
          'weighted_value',  s.total_value * s.win_prob
        )
        order by s.status
      )
      from (
        select
          status,
          count(*)::int           as cnt,
          sum(contract_value)     as total_value,
          max(win_prob)           as win_prob
        from pl
        group by status
      ) s
    ), '[]'::json),
    'projects', coalesce((
      select json_agg(
        json_build_object(
          'id',              pl.id,
          'name',            pl.name,
          'short_name',      pl.short_name,
          'code',            pl.code,
          'pmo_project_number', pl.pmo_project_number,
          'service_line', pl.service_line,
          'sector', pl.sector,
          'location', pl.location,
          'award_type', pl.award_type,
          'bidding_entity', pl.bidding_entity,
          'client_name',     coalesce(nullif(btrim(co.short_name), ''), co.name),
          'client_legal_name', co.name,
          'end_client_id',   pl.end_client_id,
          'end_client_name', coalesce(nullif(btrim(ec.short_name), ''), ec.name),
          'end_client_legal_name', ec.name,
          'status',          pl.status,
          'contract_value',  pl.contract_value,
          'currency',        pl.currency,
          'tax_treatment',   pl.tax_treatment,
          'tax_rate', pl.tax_rate,
          'tax_base_numerator', pl.tax_base_numerator,
          'tax_base_denominator', pl.tax_base_denominator,
          'win_probability', pl.win_prob,
          'last_update',     pl.last_update,
          'pm_name',         pm.full_name
        )
        order by pl.contract_value desc
      )
      from pl
      left join companies co on co.id = pl.client_id
      left join companies ec on ec.id = pl.end_client_id
      left join profiles  pm on pm.id = pl.project_manager_id
    ), '[]'::json)
  );
$$;

revoke all on function public.get_sales_pipeline() from public, anon;
grant execute on function public.get_sales_pipeline() to authenticated;

comment on function public.get_sales_pipeline() is
  'Latest definition: 0365. Projects include the PMO Project Number, optional Client Project Code and the five classification fields. To add a projection column, copy this body and reapply AC-CODE-003 JSON-key proof.';

notify pgrst, 'reload schema';

create or replace function public.search_record_references(p_query text, p_limit integer default 8)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_query_lower text;
  v_pattern text;
  v_org_id uuid;
  v_role text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 8), 8));
  v_items jsonb;
  v_has_more boolean;
begin
  if char_length(v_query) < 2 or char_length(v_query) > 120 then
    return jsonb_build_object('items', '[]'::jsonb, 'hasMore', false);
  end if;

  v_org_id := public.auth_org_id();
  v_role := public.auth_role()::text;
  if v_org_id is null
     or not coalesce(public.is_active_member(), false)
     or v_role not in ('Admin', 'Executive', 'Project Manager', 'Finance') then
    return jsonb_build_object('items', '[]'::jsonb, 'hasMore', false);
  end if;

  v_query_lower := lower(v_query);
  -- Treat %, _ and backslash as literal user characters. Only the trailing % is a wildcard.
  v_pattern := replace(replace(replace(v_query_lower, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';

  with candidate_ids as (
    (select 'project'::text as kind, p.id, true as exact
       from public.projects p
      where p.org_id = v_org_id and p.archived_at is null
        and lower(p.customer_contract_ref) = v_query_lower
      order by p.id limit v_limit + 1)
    union all
    (select 'project'::text, p.id, false
       from public.projects p
      where p.org_id = v_org_id and p.archived_at is null
        and lower(p.customer_contract_ref) like v_pattern escape E'\\'
        and lower(p.customer_contract_ref) <> v_query_lower
      order by p.id limit v_limit + 1)
    union all
    (select 'project'::text, p.id, true
       from public.projects p
      where p.org_id = v_org_id and p.archived_at is null and lower(p.code) = v_query_lower
      order by p.id limit v_limit + 1)
    union all
    (select 'project'::text, p.id, false
       from public.projects p
      where p.org_id = v_org_id and p.archived_at is null
        and lower(p.code) like v_pattern escape E'\\' and lower(p.code) <> v_query_lower
      order by p.id limit v_limit + 1)
    union all
    (select 'project'::text, p.id, true
       from public.projects p
      where p.org_id = v_org_id and p.archived_at is null and lower(p.pmo_project_number) = v_query_lower
      order by p.id limit v_limit + 1)
    union all
    (select 'project'::text, p.id, false
       from public.projects p
      where p.org_id = v_org_id and p.archived_at is null
        and lower(p.pmo_project_number) like v_pattern escape E'\\' and lower(p.pmo_project_number) <> v_query_lower
      order by p.id limit v_limit + 1)
    union all
    (select 'invoice'::text, si.id, true
       from public.sales_invoices si
      where si.org_id = v_org_id and lower(si.si_number) = v_query_lower
      order by si.id limit v_limit + 1)
    union all
    (select 'invoice'::text, si.id, false
       from public.sales_invoices si
      where si.org_id = v_org_id and lower(si.si_number) like v_pattern escape E'\\' and lower(si.si_number) <> v_query_lower
      order by si.id limit v_limit + 1)
    union all
    (select 'invoice'::text, si.id, true
       from public.sales_invoices si
      where si.org_id = v_org_id and lower(si.pmo_number) = v_query_lower
      order by si.id limit v_limit + 1)
    union all
    (select 'invoice'::text, si.id, false
       from public.sales_invoices si
      where si.org_id = v_org_id and lower(si.pmo_number) like v_pattern escape E'\\' and lower(si.pmo_number) <> v_query_lower
      order by si.id limit v_limit + 1)
    union all
    (select 'invoice'::text, si.id, true
       from public.sales_invoices si
      where si.org_id = v_org_id and lower(si.reference_number) = v_query_lower
      order by si.id limit v_limit + 1)
    union all
    (select 'invoice'::text, si.id, false
       from public.sales_invoices si
      where si.org_id = v_org_id and lower(si.reference_number) like v_pattern escape E'\\' and lower(si.reference_number) <> v_query_lower
      order by si.id limit v_limit + 1)
    union all
    (select 'receipt'::text, ip.id, true
       from public.incoming_payments ip
      where ip.org_id = v_org_id and lower(ip.ip_number) = v_query_lower
      order by ip.id limit v_limit + 1)
    union all
    (select 'receipt'::text, ip.id, false
       from public.incoming_payments ip
      where ip.org_id = v_org_id and lower(ip.ip_number) like v_pattern escape E'\\' and lower(ip.ip_number) <> v_query_lower
      order by ip.id limit v_limit + 1)
    union all
    (select 'receipt'::text, ip.id, true
       from public.incoming_payments ip
      where ip.org_id = v_org_id and lower(ip.pmo_number) = v_query_lower
      order by ip.id limit v_limit + 1)
    union all
    (select 'receipt'::text, ip.id, false
       from public.incoming_payments ip
      where ip.org_id = v_org_id and lower(ip.pmo_number) like v_pattern escape E'\\' and lower(ip.pmo_number) <> v_query_lower
      order by ip.id limit v_limit + 1)
    union all
    (select 'receipt'::text, ip.id, true
       from public.incoming_payments ip
      where ip.org_id = v_org_id and lower(ip.reference_number) = v_query_lower
      order by ip.id limit v_limit + 1)
    union all
    (select 'receipt'::text, ip.id, false
       from public.incoming_payments ip
      where ip.org_id = v_org_id and lower(ip.reference_number) like v_pattern escape E'\\' and lower(ip.reference_number) <> v_query_lower
      order by ip.id limit v_limit + 1)
  ), candidate_records as (
    select kind, id, bool_or(exact) as exact
      from candidate_ids
     group by kind, id
  ), selected_ids as (
    select kind, id, exact
      from candidate_records
     order by exact desc, kind, id
     limit v_limit + 1
  ), all_aliases as (
    select s.kind, p.id, coalesce(nullif(btrim(p.short_name), ''), p.name) as title,
           nullif(btrim(concat_ws(' · ',
                                 case when nullif(btrim(p.short_name), '') is not null and btrim(p.short_name) <> p.name then p.name end,
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''),
                                 nullif(btrim(p.code), ''), nullif(btrim(p.pmo_project_number), ''))), '') as context,
           p.customer_contract_ref as matched_reference, 1 as alias_priority,
           lower(p.customer_contract_ref) = v_query_lower as exact
      from selected_ids s join public.projects p on s.kind = 'project' and p.id = s.id and p.org_id = v_org_id
      left join public.companies c on c.id = p.client_id and c.org_id = p.org_id
     where p.archived_at is null and lower(p.customer_contract_ref) like v_pattern escape E'\\'
    union all
    select s.kind, p.id, coalesce(nullif(btrim(p.short_name), ''), p.name),
           nullif(btrim(concat_ws(' · ',
                                 case when nullif(btrim(p.short_name), '') is not null and btrim(p.short_name) <> p.name then p.name end,
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''),
                                 nullif(btrim(p.code), ''), nullif(btrim(p.pmo_project_number), ''))), ''),
           p.code, 2, lower(p.code) = v_query_lower
      from selected_ids s join public.projects p on s.kind = 'project' and p.id = s.id and p.org_id = v_org_id
      left join public.companies c on c.id = p.client_id and c.org_id = p.org_id
     where p.archived_at is null and lower(p.code) like v_pattern escape E'\\'
    union all
    select s.kind, p.id, coalesce(nullif(btrim(p.short_name), ''), p.name),
           nullif(btrim(concat_ws(' · ',
                                 case when nullif(btrim(p.short_name), '') is not null and btrim(p.short_name) <> p.name then p.name end,
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''),
                                 nullif(btrim(p.code), ''), nullif(btrim(p.pmo_project_number), ''))), ''),
           p.pmo_project_number, 3, lower(p.pmo_project_number) = v_query_lower
      from selected_ids s join public.projects p on s.kind = 'project' and p.id = s.id and p.org_id = v_org_id
      left join public.companies c on c.id = p.client_id and c.org_id = p.org_id
     where p.archived_at is null and lower(p.pmo_project_number) like v_pattern escape E'\\'
    union all
    select s.kind, si.id,
           coalesce(nullif(btrim(si.pmo_number), ''), nullif(btrim(si.si_number), ''),
                    nullif(btrim(si.reference_number), ''), 'Sales invoice'),
           nullif(btrim(concat_ws(' · ', nullif(btrim(p.name), ''),
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''))), ''),
           si.pmo_number, 1, lower(si.pmo_number) = v_query_lower
      from selected_ids s join public.sales_invoices si on s.kind = 'invoice' and si.id = s.id and si.org_id = v_org_id
      left join public.projects p on p.id = si.project_id and p.org_id = si.org_id
      left join public.companies c on c.id = si.customer_id and c.org_id = si.org_id
     where lower(si.pmo_number) like v_pattern escape E'\\'
    union all
    select s.kind, si.id,
           coalesce(nullif(btrim(si.pmo_number), ''), nullif(btrim(si.si_number), ''),
                    nullif(btrim(si.reference_number), ''), 'Sales invoice'),
           nullif(btrim(concat_ws(' · ', nullif(btrim(p.name), ''),
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''))), ''),
           si.si_number, 2, lower(si.si_number) = v_query_lower
      from selected_ids s join public.sales_invoices si on s.kind = 'invoice' and si.id = s.id and si.org_id = v_org_id
      left join public.projects p on p.id = si.project_id and p.org_id = si.org_id
      left join public.companies c on c.id = si.customer_id and c.org_id = si.org_id
     where lower(si.si_number) like v_pattern escape E'\\'
    union all
    select s.kind, si.id,
           coalesce(nullif(btrim(si.pmo_number), ''), nullif(btrim(si.si_number), ''),
                    nullif(btrim(si.reference_number), ''), 'Sales invoice'),
           nullif(btrim(concat_ws(' · ', nullif(btrim(p.name), ''),
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''))), ''),
           si.reference_number, 3, lower(si.reference_number) = v_query_lower
      from selected_ids s join public.sales_invoices si on s.kind = 'invoice' and si.id = s.id and si.org_id = v_org_id
      left join public.projects p on p.id = si.project_id and p.org_id = si.org_id
      left join public.companies c on c.id = si.customer_id and c.org_id = si.org_id
     where lower(si.reference_number) like v_pattern escape E'\\'
    union all
    select s.kind, ip.id,
           coalesce(nullif(btrim(ip.pmo_number), ''), nullif(btrim(ip.ip_number), ''),
                    nullif(btrim(ip.reference_number), ''), 'Incoming payment'),
           nullif(btrim(concat_ws(' · ', nullif(btrim(p.name), ''),
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''),
                                 nullif(btrim(coalesce(si.pmo_number, si.si_number)), ''))), ''),
           ip.pmo_number, 1, lower(ip.pmo_number) = v_query_lower
      from selected_ids s join public.incoming_payments ip on s.kind = 'receipt' and ip.id = s.id and ip.org_id = v_org_id
      left join public.sales_invoices si on si.id = ip.sales_invoice_id and si.org_id = ip.org_id
      left join public.projects p on p.id = si.project_id and p.org_id = si.org_id
      left join public.companies c on c.id = ip.customer_id and c.org_id = ip.org_id
     where lower(ip.pmo_number) like v_pattern escape E'\\'
    union all
    select s.kind, ip.id,
           coalesce(nullif(btrim(ip.pmo_number), ''), nullif(btrim(ip.ip_number), ''),
                    nullif(btrim(ip.reference_number), ''), 'Incoming payment'),
           nullif(btrim(concat_ws(' · ', nullif(btrim(p.name), ''),
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''),
                                 nullif(btrim(coalesce(si.pmo_number, si.si_number)), ''))), ''),
           ip.ip_number, 2, lower(ip.ip_number) = v_query_lower
      from selected_ids s join public.incoming_payments ip on s.kind = 'receipt' and ip.id = s.id and ip.org_id = v_org_id
      left join public.sales_invoices si on si.id = ip.sales_invoice_id and si.org_id = ip.org_id
      left join public.projects p on p.id = si.project_id and p.org_id = si.org_id
      left join public.companies c on c.id = ip.customer_id and c.org_id = ip.org_id
     where lower(ip.ip_number) like v_pattern escape E'\\'
    union all
    select s.kind, ip.id,
           coalesce(nullif(btrim(ip.pmo_number), ''), nullif(btrim(ip.ip_number), ''),
                    nullif(btrim(ip.reference_number), ''), 'Incoming payment'),
           nullif(btrim(concat_ws(' · ', nullif(btrim(p.name), ''),
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''),
                                 nullif(btrim(coalesce(si.pmo_number, si.si_number)), ''))), ''),
           ip.reference_number, 3, lower(ip.reference_number) = v_query_lower
      from selected_ids s join public.incoming_payments ip on s.kind = 'receipt' and ip.id = s.id and ip.org_id = v_org_id
      left join public.sales_invoices si on si.id = ip.sales_invoice_id and si.org_id = ip.org_id
      left join public.projects p on p.id = si.project_id and p.org_id = si.org_id
      left join public.companies c on c.id = ip.customer_id and c.org_id = ip.org_id
     where lower(ip.reference_number) like v_pattern escape E'\\'
  ), distinct_aliases as (
    select distinct on (kind, id, lower(matched_reference))
           kind, id, title, context, matched_reference, alias_priority, exact
      from all_aliases
     order by kind, id, lower(matched_reference), alias_priority, matched_reference
  ), grouped as (
    select kind, id, title, context,
           array_agg(matched_reference order by alias_priority, matched_reference) as aliases,
           bool_or(exact) as exact
      from distinct_aliases
     group by kind, id, title, context
  ), ranked as (
    select kind, id, title, context, aliases, exact,
           row_number() over (order by exact desc, kind, id) as ordinal
      from grouped
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', kind,
           'id', id,
           'title', title,
           'context', context,
           'reference', aliases[1],
           'aliases', to_jsonb(aliases),
           'exact', exact
         ) order by ordinal) filter (where ordinal <= v_limit), '[]'::jsonb),
         coalesce(bool_or(ordinal > v_limit), false)
    into v_items, v_has_more
    from ranked;

  return jsonb_build_object('items', v_items, 'hasMore', v_has_more);
end;
$$;

revoke all on function public.search_record_references(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.search_record_references(text, integer) to authenticated;

-- Dashboard "Spending vs contract" / "Project Status" show the short name (contractual `name` stays in the payload).
create or replace function public.get_pm_dashboard_projects()
  returns json language sql stable security invoker set search_path = public
as $$
  with billed_work as (
    select si.project_id,si.currency,sum(w.net+w.recovery) as revenue,
      bool_or(w.net is null or w.recovery is null
        or w.net::text in ('NaN','Infinity','-Infinity')
        or w.recovery::text in ('NaN','Infinity','-Infinity')) as incomplete
    from public.sales_invoice_work_billed w
    join public.sales_invoices si on si.id=w.id and si.org_id=w.org_id
    where si.org_id=public.auth_org_id() and si.status in ('Submitted','Unpaid','Paid') and coalesce(si.erp_docstatus,1)<>2
      and si.erp_cancelled_at is null and not w.is_down_payment
    group by si.project_id,si.currency
  ), rows as (
  select p.id,p.name,p.short_name,coalesce(nullif(btrim(c.short_name),''),c.name) as client_name,
    p.contract_value,p.currency,p.status,
    (select sum(li.budgeted_amount) from public.budget_versions v
      join public.budget_line_items li on li.budget_version_id=v.id where v.project_id=p.id and v.status='Active') as budget,
    (select v.currency from public.budget_versions v where v.project_id=p.id and v.status='Active' order by v.version desc,v.created_at desc,v.id desc limit 1) as budget_currency,
    case when public.org_reads_erp_ledger() then (select o.default_currency from public.organizations o where o.id=p.org_id) else p.currency end as actual_currency,
    case when not public.org_reads_erp_ledger() then true else
      (select count(distinct li.category) > 0 and count(distinct li.category) = count(distinct li.category) filter
        (where exists (select 1 from public.project_mapped_actuals(p.id,null) x
          where x.category=li.category and x.mapped and x.actuals_to_date is not null))
       from public.budget_versions v join public.budget_line_items li on li.budget_version_id=v.id
       where v.project_id=p.id and v.status='Active') end as actual_complete,
    case when public.org_reads_erp_ledger() then
      case when (select o.default_currency=p.currency from public.organizations o where o.id=p.org_id)
        then (select sum(x.actuals_to_date) from public.project_mapped_actuals(p.id,null) x where x.actuals_to_date is not null)
        else null end
      else coalesce((select sum(pr.total_value) from public.procurements pr where pr.project_id=p.id
        and pr.status::text=any(public.committed_procurement_statuses())),0) end as spent,
    public.org_reads_erp_ledger() as ledger_owned,
    case when public.org_reads_erp_ledger() then
      (select count(*)::int from public.project_mapped_actuals(p.id,null) x where x.mapped and x.actuals_to_date is not null)
      else 1 end as actual_coverage_count,
    case when public.org_reads_erp_ledger() then
      (select count(*)::int from public.project_mapped_actuals(p.id,null) x where x.mapped)
      else 1 end as actual_coverage_total,
    (select bw.revenue from billed_work bw where bw.project_id=p.id and bw.currency=p.currency) as billed_revenue,
    (coalesce((select bw.incomplete from billed_work bw where bw.project_id=p.id and bw.currency=p.currency),false)
      or exists (select 1 from billed_work bw where bw.project_id=p.id and bw.currency<>p.currency)) as billed_incomplete
  from public.projects p left join public.companies c on c.id=p.client_id
  where p.project_manager_id=auth.uid() and p.org_id=public.auth_org_id()
  )
  select coalesce(json_agg(json_build_object(
    'id',p.id,'name',p.name,'short_name',p.short_name,'client_name',p.client_name,
    'contract_value',p.contract_value,'currency',p.currency,'status',p.status,
    'budget',p.budget,'budget_currency',p.budget_currency,'spent',p.spent,
    'actual_currency',p.actual_currency,'actual_complete',p.actual_complete,
    'actual_coverage_count',p.actual_coverage_count,'actual_coverage_total',p.actual_coverage_total,
    'realized_margin',case when p.spent is null or not p.actual_complete or p.actual_currency<>p.currency or p.billed_incomplete then null else coalesce(p.billed_revenue,0)-p.spent end,
    'realized_margin_pct',case when p.spent is null or not p.actual_complete or p.actual_currency<>p.currency or p.billed_incomplete or coalesce(p.billed_revenue,0)<=0 then null
      else (p.billed_revenue-p.spent)/p.billed_revenue end,
    'contract_remaining',case when p.spent is null or not p.actual_complete or p.actual_currency<>p.currency then null else p.contract_value-p.spent end
  ) order by p.name),'[]'::json) from rows p;
$$;
revoke all on function public.get_pm_dashboard_projects() from public;
grant execute on function public.get_pm_dashboard_projects() to authenticated;
revoke execute on function public.get_pm_dashboard_projects() from anon;

-- Short names identify a project in everyday lists, so they must not repeat within an organization.
-- Case-insensitive and whitespace-insensitive; NULL / blank aliases are exempt.
create unique index projects_org_short_name_uidx
  on public.projects (org_id, lower(btrim(short_name)))
  where nullif(btrim(short_name), '') is not null;

notify pgrst, 'reload schema';
