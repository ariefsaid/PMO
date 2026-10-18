-- 0318 — safe availability metadata and strict authenticated read envelopes.
-- Rollback: rollback/0318_financial_statement_reads_down.sql

create view public.erp_financial_statement_availability
with (security_barrier = true)
as
select
  case when public.auth_role()::text in ('Admin', 'Finance', 'Executive')
       then nullif(btrim(binding.config ->> 'company'), '') else null end as company_label,
  case when latest.snapshot_id is not null then
    coalesce((
      select jsonb_agg(
        jsonb_build_object('start', entry.value ->> 'start', 'end', entry.value ->> 'end')
        order by entry.ordinality
      )
      from jsonb_array_elements(
        case when jsonb_typeof(binding.statement_calendar) = 'array'
             then binding.statement_calendar else '[]'::jsonb end
      ) with ordinality as entry(value, ordinality)
      where jsonb_typeof(entry.value) = 'object'
        and jsonb_typeof(entry.value -> 'start') = 'string'
        and jsonb_typeof(entry.value -> 'end') = 'string'
        and (entry.value ->> 'start') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and (entry.value ->> 'end') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    ), '[]'::jsonb)
    else '[]'::jsonb end as calendar,
  latest.as_of as last_success_at,
  latest.snapshot_id,
  latest.source_generation,
  binding.statement_update_delayed as delayed
from public.external_org_bindings binding
left join lateral (
  select snapshot.snapshot_id, snapshot.source_generation, snapshot.as_of
  from public.erp_financial_statement_snapshot snapshot
  where snapshot.org_id = binding.org_id
    and snapshot.company = btrim(binding.config ->> 'company')
  order by snapshot.as_of desc, snapshot.snapshot_id desc
  limit 1
) latest on true
where binding.org_id = public.auth_org_id()
  and public.is_active_member()
  and public.auth_role()::text in ('Admin', 'Finance', 'Executive', 'Project Manager', 'Engineer')
  and binding.external_tier = 'erpnext'
  and binding.activated_at is not null
  and nullif(btrim(binding.config ->> 'company'), '') is not null;

alter view public.erp_financial_statement_availability owner to postgres;
revoke all on public.erp_financial_statement_availability from public, anon, authenticated, service_role;
grant select on public.erp_financial_statement_availability to authenticated;

create function public.get_financial_statement_catalogue(p_project_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_role text;
  v_bad_catalogue boolean;
begin
  v_org_id := public.auth_org_id();
  v_role := public.auth_role()::text;
  if v_org_id is null or not coalesce(public.is_active_member(), false)
     or v_role not in ('Admin', 'Finance', 'Executive', 'Project Manager', 'Engineer') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_project_id is null and v_role not in ('Admin', 'Finance', 'Executive') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects project_row
    where project_row.id = p_project_id and project_row.org_id = v_org_id
  ) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  -- Select by the safe view's chosen snapshot identity first, then reject every inconsistent
  -- authorized candidate instead of filtering a mixed publication into an apparently valid one.
  select
    exists (
      select 1
      from public.erp_financial_statement_availability availability
      join public.erp_financial_statement_snapshot candidate
        on candidate.snapshot_id = availability.snapshot_id
       and candidate.org_id = v_org_id
      where availability.snapshot_id is not null
        and ((p_project_id is null and candidate.scope_kind in ('company','unassigned') and candidate.project_id is null)
          or (p_project_id is not null and candidate.scope_kind = 'project' and candidate.project_id = p_project_id))
        and (candidate.source_generation is distinct from availability.source_generation
          or candidate.as_of is distinct from availability.last_success_at)
    )
    or exists (
      select 1
      from public.erp_financial_statement_availability availability
      join public.erp_financial_statement_snapshot candidate
        on candidate.snapshot_id = availability.snapshot_id
       and candidate.org_id = v_org_id
      where availability.snapshot_id is not null
        and ((p_project_id is null and candidate.scope_kind in ('company','unassigned') and candidate.project_id is null)
          or (p_project_id is not null and candidate.scope_kind = 'project' and candidate.project_id = p_project_id))
      group by candidate.snapshot_id
      having count(distinct candidate.display_precision) > 1
          or count(distinct candidate.display_rounding_method) > 1
    )
    or exists (
      select 1
      from public.erp_financial_statement_availability availability
      join public.erp_financial_statement_snapshot candidate
        on candidate.snapshot_id = availability.snapshot_id
       and candidate.org_id = v_org_id
      where availability.snapshot_id is not null
        and ((p_project_id is null and candidate.scope_kind in ('company','unassigned') and candidate.project_id is null)
          or (p_project_id is not null and candidate.scope_kind = 'project' and candidate.project_id = p_project_id))
      group by candidate.period_kind, candidate.current_start
      having count(distinct (candidate.current_end, candidate.prior_start, candidate.prior_end)) > 1
    )
  into v_bad_catalogue;
  if v_bad_catalogue then
    raise exception 'Invalid statement selection' using errcode = '22023';
  end if;

  return (
    with availability as materialized (
      select company_label, calendar, last_success_at, snapshot_id, source_generation, delayed
      from public.erp_financial_statement_availability
    ), candidates as materialized (
      select snapshot.id, snapshot.snapshot_id, snapshot.source_generation, snapshot.as_of, snapshot.currency,
        snapshot.display_precision, snapshot.display_rounding_method, snapshot.statement, snapshot.scope_kind,
        snapshot.project_id, snapshot.view_kind, snapshot.period_kind, snapshot.current_start, snapshot.current_end,
        snapshot.prior_start, snapshot.prior_end
      from availability
      join public.erp_financial_statement_snapshot snapshot
        on snapshot.snapshot_id = availability.snapshot_id
       and snapshot.org_id = v_org_id
      where availability.snapshot_id is not null
        and ((p_project_id is null and snapshot.scope_kind in ('company','unassigned') and snapshot.project_id is null)
          or (p_project_id is not null and snapshot.scope_kind = 'project' and snapshot.project_id = p_project_id))
    ), generation_row as (
      select candidate.id, candidate.snapshot_id, candidate.source_generation, candidate.as_of, candidate.currency,
        candidate.display_precision, candidate.display_rounding_method
      from candidates candidate
      order by candidate.as_of desc, candidate.snapshot_id desc, candidate.id
      limit 1
    ), period_rows as (
      select distinct period_kind, current_start, current_end, prior_start, prior_end
      from candidates
    ), periods as (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'kind', period_kind,
          'currentStart', current_start::text,
          'currentEnd', current_end::text,
          'priorStart', prior_start::text,
          'priorEnd', prior_end::text
        ) order by current_start,
          case period_kind when 'month' then 0 when 'quarter' then 1 else 2 end
      ), '[]'::jsonb) as value
      from period_rows
    ), scope_keys as (
      select distinct scope_kind, project_id from candidates
    ), scopes as (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'scopeKind', scope.scope_kind,
          'projectId', scope.project_id,
          'statements', (
            select coalesce(jsonb_agg(statement_key.statement order by
              case statement_key.statement when 'trial_balance' then 0 when 'profit_and_loss' then 1 else 2 end
            ), '[]'::jsonb)
            from (select distinct candidate.statement from candidates candidate
              where candidate.scope_kind = scope.scope_kind
                and candidate.project_id is not distinct from scope.project_id) statement_key
          ),
          'viewKinds', (
            select coalesce(jsonb_agg(view_key.view_kind order by
              case view_key.view_kind when 'account_breakdown' then 0 else 1 end
            ), '[]'::jsonb)
            from (select distinct candidate.view_kind from candidates candidate
              where candidate.scope_kind = scope.scope_kind
                and candidate.project_id is not distinct from scope.project_id) view_key
          )
        ) order by
          case scope.scope_kind when 'company' then 0 when 'unassigned' then 1 else 2 end,
          scope.project_id
      ), '[]'::jsonb) as value
      from scope_keys scope
    )
    select jsonb_build_object(
      'state', case when exists (select 1 from candidates) then 'complete' else 'unavailable' end,
      'companyLabel', (select availability.company_label from availability limit 1),
      'generation', case when generation_row.snapshot_id is null then null else jsonb_build_object(
        'snapshotId', generation_row.snapshot_id,
        'sourceGeneration', generation_row.source_generation,
        'asOf', generation_row.as_of,
        'currency', generation_row.currency,
        'presentation', jsonb_build_object(
          'precision', generation_row.display_precision,
          'roundingMethod', generation_row.display_rounding_method
        ),
        'delayed', (select availability.delayed from availability limit 1)
      ) end,
      'periods', periods.value,
      'scopes', scopes.value
    )
    from periods cross join scopes left join generation_row on true
  );
end;
$$;

create function public.get_financial_statement(
  p_period_kind text,
  p_period_start date,
  p_statement text,
  p_project_id uuid default null,
  p_view_kind text default 'account_breakdown',
  p_unassigned boolean default false
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_role text;
  v_scope text;
  v_bad_catalogue boolean;
begin
  if p_period_kind is null or p_period_kind not in ('month', 'quarter', 'fiscal_year')
     or p_period_start is null or not isfinite(p_period_start)
     or p_statement is null or p_statement not in ('trial_balance', 'profit_and_loss', 'balance_sheet')
     or p_view_kind is null or p_view_kind not in ('account_breakdown', 'project_totals')
     or p_unassigned is null then
    raise exception 'Invalid statement selection' using errcode = '22023';
  end if;
  if p_unassigned and (p_project_id is not null or p_statement <> 'profit_and_loss' or p_view_kind <> 'account_breakdown') then
    raise exception 'Invalid statement selection' using errcode = '22023';
  end if;
  if p_project_id is not null and (p_statement <> 'profit_and_loss' or p_unassigned) then
    raise exception 'Invalid statement selection' using errcode = '22023';
  end if;
  if p_project_id is null and not p_unassigned and p_view_kind <> 'account_breakdown' then
    raise exception 'Invalid statement selection' using errcode = '22023';
  end if;

  v_org_id := public.auth_org_id();
  v_role := public.auth_role()::text;
  if v_org_id is null or not coalesce(public.is_active_member(), false)
     or v_role not in ('Admin', 'Finance', 'Executive', 'Project Manager', 'Engineer') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  if p_project_id is not null then
    -- This is intentionally evaluated before any statement absence lookup. Projects RLS decides visibility.
    if not exists (
      select 1 from public.projects project_row
      where project_row.id = p_project_id and project_row.org_id = v_org_id
    ) then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
    v_scope := 'project';
  elsif p_unassigned then
    v_scope := 'unassigned';
  else
    v_scope := 'company';
  end if;

  if v_role in ('Project Manager', 'Engineer') then
    if p_project_id is null or p_unassigned or p_statement <> 'profit_and_loss' or p_view_kind <> 'project_totals' then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
  elsif v_scope = 'unassigned' and v_role not in ('Admin', 'Finance', 'Executive') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  select
    exists (
      select 1
      from public.erp_financial_statement_availability availability
      join public.erp_financial_statement_snapshot candidate
        on candidate.snapshot_id = availability.snapshot_id
       and candidate.org_id = v_org_id
      where availability.snapshot_id is not null
        and candidate.scope_kind = v_scope and candidate.project_id is not distinct from p_project_id
        and (candidate.source_generation is distinct from availability.source_generation
          or candidate.as_of is distinct from availability.last_success_at)
    )
    or exists (
      select 1
      from public.erp_financial_statement_availability availability
      join public.erp_financial_statement_snapshot candidate
        on candidate.snapshot_id = availability.snapshot_id
       and candidate.org_id = v_org_id
      where availability.snapshot_id is not null
        and candidate.scope_kind = v_scope and candidate.project_id is not distinct from p_project_id
      group by candidate.snapshot_id
      having count(distinct candidate.display_precision) > 1
          or count(distinct candidate.display_rounding_method) > 1
    )
    or exists (
      select 1
      from public.erp_financial_statement_availability availability
      join public.erp_financial_statement_snapshot candidate
        on candidate.snapshot_id = availability.snapshot_id
       and candidate.org_id = v_org_id
      where availability.snapshot_id is not null
        and candidate.scope_kind = v_scope and candidate.project_id is not distinct from p_project_id
      group by candidate.period_kind, candidate.current_start
      having count(distinct (candidate.current_end, candidate.prior_start, candidate.prior_end)) > 1
    )
  into v_bad_catalogue;
  if v_bad_catalogue then
    raise exception 'Invalid statement selection' using errcode = '22023';
  end if;

  return (
    with availability as materialized (
      select company_label, calendar, last_success_at, snapshot_id, source_generation, delayed
      from public.erp_financial_statement_availability
    ), candidates as materialized (
      select snapshot.id, snapshot.snapshot_id, snapshot.source_generation, snapshot.as_of, snapshot.currency,
        snapshot.display_precision, snapshot.display_rounding_method, snapshot.statement, snapshot.scope_kind,
        snapshot.project_id, snapshot.view_kind, snapshot.period_kind, snapshot.current_start, snapshot.current_end,
        snapshot.prior_start, snapshot.prior_end, snapshot.has_activity, snapshot.payload,
        snapshot.source_report, snapshot.report_version, snapshot.filters, snapshot.settings
      from availability
      join public.erp_financial_statement_snapshot snapshot
        on snapshot.snapshot_id = availability.snapshot_id
       and snapshot.org_id = v_org_id
      where availability.snapshot_id is not null
        and snapshot.scope_kind = v_scope and snapshot.project_id is not distinct from p_project_id
    ), generation_row as (
      select candidate.id, candidate.snapshot_id, candidate.source_generation, candidate.as_of, candidate.currency,
        candidate.display_precision, candidate.display_rounding_method
      from candidates candidate
      order by candidate.as_of desc, candidate.snapshot_id desc, candidate.id
      limit 1
    ), selected as (
      select candidate.id, candidate.snapshot_id, candidate.source_generation, candidate.as_of, candidate.currency,
        candidate.display_precision, candidate.display_rounding_method, candidate.statement, candidate.scope_kind,
        candidate.project_id, candidate.view_kind, candidate.period_kind, candidate.current_start, candidate.current_end,
        candidate.prior_start, candidate.prior_end, candidate.has_activity, candidate.payload,
        candidate.source_report, candidate.report_version, candidate.filters, candidate.settings
      from candidates candidate
      where candidate.period_kind = p_period_kind
        and candidate.current_start = p_period_start
        and candidate.statement = p_statement
        and candidate.scope_kind = v_scope
        and candidate.project_id is not distinct from p_project_id
        and candidate.view_kind = p_view_kind
      limit 1
    )
    select jsonb_build_object(
      'state', case when selected.id is null then 'unavailable' else 'complete' end,
      'companyLabel', (select availability.company_label from availability limit 1),
      'generation', case when generation_row.snapshot_id is null then null else jsonb_build_object(
        'snapshotId', generation_row.snapshot_id,
        'sourceGeneration', generation_row.source_generation,
        'asOf', generation_row.as_of,
        'currency', generation_row.currency,
        'presentation', jsonb_build_object(
          'precision', generation_row.display_precision,
          'roundingMethod', generation_row.display_rounding_method
        ),
        'delayed', (select availability.delayed from availability limit 1)
      ) end,
      'selection', jsonb_build_object(
        'periodKind', p_period_kind,
        'periodStart', p_period_start::text,
        'statement', p_statement,
        'scopeKind', v_scope,
        'projectId', p_project_id,
        'viewKind', p_view_kind
      ),
      'result', case when selected.id is null then null else jsonb_build_object(
        'viewKind', selected.view_kind,
        'period', jsonb_build_object(
          'kind', selected.period_kind,
          'currentStart', selected.current_start::text,
          'currentEnd', selected.current_end::text,
          'priorStart', selected.prior_start::text,
          'priorEnd', selected.prior_end::text
        ),
        'hasActivity', selected.has_activity,
        'payload', selected.payload
      ) || case when selected.view_kind = 'account_breakdown' then jsonb_build_object(
        'provenance', jsonb_build_object(
          'sourceReport', selected.source_report,
          'reportVersion', selected.report_version,
          'filters', selected.filters,
          'settings', selected.settings
        )
      ) else '{}'::jsonb end end
    )
    from (select 1) singleton
    left join generation_row on true
    left join selected on true
  );
end;
$$;

revoke all on function public.get_financial_statement_catalogue(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_financial_statement(text, date, text, uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.get_financial_statement_catalogue(uuid) to authenticated;
grant execute on function public.get_financial_statement(text, date, text, uuid, text, boolean) to authenticated;
