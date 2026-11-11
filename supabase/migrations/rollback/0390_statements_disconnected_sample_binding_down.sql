-- Rollback 0390: restore 0321's activation-only predicates.

-- Generation time remains the publication timestamp; capture bounds describe native acquisitions.
create or replace view public.erp_financial_statement_availability
with (security_barrier = true)
as
select
  case when public.auth_role()::text in ('Admin','Finance','Executive')
       then nullif(btrim(binding.config->>'company'),'') else null end as company_label,
  case when latest.snapshot_id is not null then coalesce((
    select jsonb_agg(jsonb_build_object('start',entry.value->>'start','end',entry.value->>'end') order by entry.ordinality)
    from jsonb_array_elements(case when jsonb_typeof(binding.statement_calendar)='array'
      then binding.statement_calendar else '[]'::jsonb end) with ordinality entry(value,ordinality)
    where jsonb_typeof(entry.value)='object'
      and jsonb_typeof(entry.value->'start')='string' and jsonb_typeof(entry.value->'end')='string'
      and (entry.value->>'start') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and (entry.value->>'end') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ),'[]'::jsonb) else '[]'::jsonb end as calendar,
  latest.as_of as last_success_at,
  latest.snapshot_id,
  latest.source_generation,
  binding.statement_update_delayed as delayed,
  latest.capture_started_at,
  latest.capture_completed_at
from public.external_org_bindings binding
left join lateral (
  select snapshot.snapshot_id,snapshot.source_generation,snapshot.as_of,
    snapshot.capture_started_at,snapshot.capture_completed_at
  from public.erp_financial_statement_snapshot snapshot
  where snapshot.org_id=binding.org_id and snapshot.company=btrim(binding.config->>'company')
    and snapshot.capture_started_at is not null and snapshot.capture_completed_at is not null
  order by coalesce(snapshot.published_at,snapshot.as_of) desc,snapshot.snapshot_id desc limit 1
) latest on true
where binding.org_id=public.auth_org_id() and public.is_active_member()
  and public.auth_role()::text in ('Admin','Finance','Executive','Project Manager','Engineer')
  and binding.external_tier='erpnext' and binding.activated_at is not null
  and nullif(btrim(binding.config->>'company'),'') is not null;

alter view public.erp_financial_statement_availability owner to postgres;
revoke all on public.erp_financial_statement_availability from public,anon,authenticated,service_role;
grant select on public.erp_financial_statement_availability to authenticated;

create or replace function public.get_financial_statement_catalogue(p_project_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_bad boolean;
  v_project_map jsonb;
begin
  if v_org_id is null or not coalesce(public.is_active_member(),false)
     or v_role not in ('Admin','Finance','Executive','Project Manager','Engineer') then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if p_project_id is null and v_role not in ('Admin','Finance','Executive') then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if p_project_id is not null and not exists(select 1 from public.projects p
    where p.id=p_project_id and p.org_id=v_org_id) then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if p_project_id is null then
    select binding.config->'project_map' into v_project_map
    from public.external_org_bindings binding
    where binding.org_id=v_org_id and binding.external_tier='erpnext' and binding.activated_at is not null
    limit 1;
  end if;
  select exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
    where a.snapshot_id is not null
      and ((p_project_id is null and (
          (s.scope_kind='company' and s.project_id is null)
          or (s.scope_kind='project' and s.project_id is not null
            and coalesce(jsonb_typeof(v_project_map)='object'
              and v_project_map ? s.project_id::text
              and jsonb_typeof(v_project_map->s.project_id::text)='string'
              and btrim(v_project_map->>s.project_id::text)<>'',false)
            and exists(select 1 from public.projects p where p.id=s.project_id and p.org_id=v_org_id))))
        or (p_project_id is not null and s.scope_kind='project' and s.project_id=p_project_id))
      and (s.source_generation is distinct from a.source_generation or s.as_of is distinct from a.last_success_at
        or s.capture_started_at is distinct from a.capture_started_at
        or s.capture_completed_at is distinct from a.capture_completed_at)
  ) or exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
    where a.snapshot_id is not null
      and ((p_project_id is null and (
          (s.scope_kind='company' and s.project_id is null)
          or (s.scope_kind='project' and s.project_id is not null
            and coalesce(jsonb_typeof(v_project_map)='object'
              and v_project_map ? s.project_id::text
              and jsonb_typeof(v_project_map->s.project_id::text)='string'
              and btrim(v_project_map->>s.project_id::text)<>'',false)
            and exists(select 1 from public.projects p where p.id=s.project_id and p.org_id=v_org_id))))
        or (p_project_id is not null and s.scope_kind='project' and s.project_id=p_project_id))
    group by s.snapshot_id
    having count(distinct s.display_precision)>1 or count(distinct s.display_rounding_method)>1
      or count(distinct s.capture_started_at)>1 or count(distinct s.capture_completed_at)>1
  ) or exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
    where a.snapshot_id is not null
      and ((p_project_id is null and (
          (s.scope_kind='company' and s.project_id is null)
          or (s.scope_kind='project' and s.project_id is not null
            and coalesce(jsonb_typeof(v_project_map)='object'
              and v_project_map ? s.project_id::text
              and jsonb_typeof(v_project_map->s.project_id::text)='string'
              and btrim(v_project_map->>s.project_id::text)<>'',false)
            and exists(select 1 from public.projects p where p.id=s.project_id and p.org_id=v_org_id))))
        or (p_project_id is not null and s.scope_kind='project' and s.project_id=p_project_id))
    group by s.period_kind,s.current_start
    having count(distinct (s.current_end,s.prior_start,s.prior_end))>1
  ) into v_bad;
  if v_bad then raise exception 'Invalid statement selection' using errcode='22023'; end if;

  return (
    with availability as materialized (
      select company_label,calendar,last_success_at,snapshot_id,source_generation,capture_started_at,capture_completed_at,delayed
      from public.erp_financial_statement_availability
    ), candidates as materialized (
      select s.id,s.snapshot_id,s.source_generation,s.as_of,s.capture_started_at,s.capture_completed_at,
        s.currency,s.display_precision,s.display_rounding_method,s.statement,s.scope_kind,s.project_id,s.view_kind,
        s.period_kind,s.current_start,s.current_end,s.prior_start,s.prior_end
      from availability a join public.erp_financial_statement_snapshot s
        on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
      where a.snapshot_id is not null and s.capture_started_at is not null
        and ((p_project_id is null and (
            (s.scope_kind='company' and s.project_id is null)
            or (s.scope_kind='project' and s.project_id is not null
              and coalesce(jsonb_typeof(v_project_map)='object'
                and v_project_map ? s.project_id::text
                and jsonb_typeof(v_project_map->s.project_id::text)='string'
                and btrim(v_project_map->>s.project_id::text)<>'',false)
              and exists(select 1 from public.projects p where p.id=s.project_id and p.org_id=v_org_id))))
          or (p_project_id is not null and s.scope_kind='project' and s.project_id=p_project_id))
    ), generation_row as (
      select * from candidates order by as_of desc,capture_completed_at desc,snapshot_id desc,id limit 1
    ), period_rows as (
      select distinct period_kind,current_start,current_end,prior_start,prior_end from candidates
    ), periods as (
      select coalesce(jsonb_agg(jsonb_build_object('kind',period_kind,'currentStart',current_start::text,
        'currentEnd',current_end::text,'priorStart',prior_start::text,'priorEnd',prior_end::text)
        order by current_start,case period_kind when 'month' then 0 when 'quarter' then 1 else 2 end),'[]'::jsonb) value
      from period_rows
    ), scope_keys as (select distinct scope_kind,project_id from candidates), scopes as (
      select coalesce(jsonb_agg(jsonb_build_object('scopeKind',scope.scope_kind,'projectId',scope.project_id,
        'statements',(select coalesce(jsonb_agg(k.statement order by case k.statement when 'trial_balance' then 0 when 'profit_and_loss' then 1 else 2 end),'[]'::jsonb)
          from (select distinct c.statement from candidates c where c.scope_kind=scope.scope_kind and c.project_id is not distinct from scope.project_id) k),
        'viewKinds',(select coalesce(jsonb_agg(k.view_kind order by case k.view_kind when 'account_breakdown' then 0 else 1 end),'[]'::jsonb)
          from (select distinct c.view_kind from candidates c where c.scope_kind=scope.scope_kind and c.project_id is not distinct from scope.project_id) k)
        ) order by case scope.scope_kind when 'company' then 0 else 1 end,scope.project_id),'[]'::jsonb) value
      from scope_keys scope
    )
    select jsonb_build_object(
      'state',case when exists(select 1 from candidates) then 'complete' else 'unavailable' end,
      'companyLabel',(select company_label from availability limit 1),
      'generation',case when g.snapshot_id is null then null else jsonb_build_object(
        'snapshotId',g.snapshot_id,'sourceGeneration',g.source_generation,'asOf',g.as_of,
        'captureStartedAt',g.capture_started_at,'captureCompletedAt',g.capture_completed_at,
        'currency',g.currency,'presentation',jsonb_build_object('precision',g.display_precision,'roundingMethod',g.display_rounding_method),
        'delayed',(select delayed from availability limit 1)) end,
      'periods',periods.value,'scopes',scopes.value
    ) from periods cross join scopes left join generation_row g on true
  );
end;
$$;
