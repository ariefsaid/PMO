-- #770: optional PMO-local classification and org-defined option lists.
-- Reversal: supabase/migrations/rollback/0234_project_classification_down.sql.
create or replace function public.valid_project_classification_options(p_options text[])
returns boolean language sql immutable set search_path = pg_catalog as $$
  select coalesce(array_ndims(p_options), 1) = 1
    and coalesce((select bool_and(value is not null and value = btrim(value) and length(value) between 1 and 140) from unnest(p_options) value), true)
    and cardinality(p_options) = (select count(distinct value) from unnest(p_options) value);
$$;
revoke all on function public.valid_project_classification_options(text[]) from public, anon;
grant execute on function public.valid_project_classification_options(text[]) to authenticated, service_role;
alter table public.organizations
  add column service_line_options text[] not null default '{}' check (public.valid_project_classification_options(service_line_options)),
  add column sector_options text[] not null default '{}' check (public.valid_project_classification_options(sector_options));
-- Existing organizations_update_tax_default policy is own-org, active-member, Admin-only.
grant update(service_line_options, sector_options) on public.organizations to authenticated;
alter table public.projects
  add column service_line text,
  add column sector text,
  add column location text check (location is null or btrim(location) <> ''),
  add column award_type text check (award_type is null or award_type in ('tender','direct')),
  add column bidding_entity text check (bidding_entity is null or bidding_entity in ('alone','consortium'));
grant insert(service_line,sector,location,award_type,bidding_entity), update(service_line,sector,location,award_type,bidding_entity) on public.projects to authenticated;
-- No defaults on historical projects; no ERP-native ownership field is added.
create or replace function public.validate_project_classification() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_service_lines text[];
  v_sectors text[];
begin
  select o.service_line_options,o.sector_options into v_service_lines,v_sectors
    from public.organizations o where o.id=new.org_id;
  if not found then raise exception 'Project organization is not available' using errcode='42501'; end if;
  -- Retiring an option never relabels old projects or blocks unrelated header edits.
  if new.service_line is not null and (tg_op='INSERT' or new.service_line is distinct from old.service_line)
    and not (new.service_line = any(v_service_lines)) then
    raise exception 'Select a configured service line for this organization' using errcode='23514';
  end if;
  if new.sector is not null and (tg_op='INSERT' or new.sector is distinct from old.sector)
    and not (new.sector = any(v_sectors)) then
    raise exception 'Select a configured sector for this organization' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_project_classification() from public, anon, authenticated;
create trigger zz_projects_classification before insert or update of service_line,sector on public.projects
  for each row execute function public.validate_project_classification();

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
  'Latest definition: 0234. Projects include the PMO Project Number, optional Client Project Code and the five classification fields. To add a projection column, copy this body and reapply AC-CODE-003 JSON-key proof.';

notify pgrst, 'reload schema';
