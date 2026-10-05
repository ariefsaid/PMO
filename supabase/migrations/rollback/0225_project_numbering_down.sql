-- Rollback for 0225_project_numbering.sql. Drops only #771 additions; never changes projects.code.

drop trigger if exists projects_pmo_number_immutable on public.projects;
drop trigger if exists zz_projects_mint_pmo_number on public.projects;
drop function if exists public.prevent_project_number_change();
drop function if exists public.mint_project_number_on_insert();
drop function if exists public.propose_project_number(uuid);
drop function if exists public.next_project_number(uuid, uuid, timestamptz);

drop policy if exists organizations_update_project_number_pattern on public.organizations;
revoke update (project_number_pattern) on public.organizations from authenticated;

revoke insert (pmo_project_number) on public.projects from authenticated;

drop index if exists public.projects_org_pmo_project_number_uidx;
alter table public.projects
  drop constraint if exists projects_pmo_project_number_nonblank,
  drop column if exists pmo_project_number;
drop function if exists public.project_number_null_insert_default();

drop table if exists public.project_number_counters;

alter table public.companies
  drop constraint if exists companies_client_number_segment_nonblank,
  drop column if exists client_number_segment;
alter table public.organizations
  drop constraint if exists organizations_project_number_pattern_check,
  drop column if exists project_number_pattern;
drop function if exists public.is_valid_project_number_pattern(text);

-- Restore 0223's latest pipeline projection (0225 replaced its JSON keys additively).
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
      p.client_id,
      p.end_client_id,
      p.status,
      p.contract_value,
      p.currency,
      p.tax_treatment,
      p.last_update,
      p.project_manager_id,
      coalesce(c.win_probability, 0) as win_prob
    from projects p
    left join pipeline_stage_config c on c.status = p.status
    where p.status::text = any(pipeline_project_statuses())
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
          'client_name',     co.name,
          'end_client_id',   pl.end_client_id,
          'end_client_name', ec.name,
          'status',          pl.status,
          'contract_value',  pl.contract_value,
          'currency',        pl.currency,
          'tax_treatment',   pl.tax_treatment,
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
comment on function public.get_sales_pipeline() is
  'Latest definition: 0223. Forward the optional end-customer id/name; when updating, copy this body and reapply the ACL statements.';

notify pgrst, 'reload schema';
