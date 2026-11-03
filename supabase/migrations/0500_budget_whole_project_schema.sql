-- 0500_budget_whole_project_schema.sql
-- Whole-project version mode and normalized, organization-scoped yearly distribution storage.
-- Reverse: rollback/0500_budget_whole_project_schema_down.sql.

alter table public.budget_versions
  add column budget_mode text not null default 'per_year'
  constraint budget_versions_budget_mode_check check (budget_mode in ('whole_project','per_year'));

update public.record_history_config
   set captured = captured || '{"budget_mode":"enum"}'::jsonb
 where entity_type = 'budget_version'
   and not (captured ? 'budget_mode');

-- New client-created versions may select a mode, but existing UPDATE grants remain status-only.
revoke insert (budget_mode) on public.budget_versions from public, anon;
grant insert (budget_mode) on public.budget_versions to authenticated;

create table public.budget_distribution_plans (
  budget_version_id uuid primary key references public.budget_versions(id) on delete cascade,
  org_id uuid not null default public.auth_org_id()
    references public.organizations(id) on delete cascade,
  method text not null check (method in ('by_days','percent_by_year','amount_by_year')),
  inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(inputs) = 'object'),
  basis jsonb not null check (jsonb_typeof(basis) = 'object'),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index budget_distribution_plans_org_version_idx
  on public.budget_distribution_plans (org_id, budget_version_id);

create table public.budget_year_distributions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id()
    references public.organizations(id) on delete cascade,
  budget_version_id uuid not null references public.budget_versions(id) on delete cascade,
  category public.budget_category not null,
  fiscal_year text not null check (fiscal_year <> ''),
  ordinal integer not null check (ordinal >= 0),
  amount numeric(14,2) not null check (amount >= 0),
  method text not null check (method in ('by_days','percent_by_year','amount_by_year')),
  is_override boolean not null default false,
  unique (budget_version_id, category, fiscal_year)
);
create index budget_year_distributions_org_version_idx
  on public.budget_year_distributions (org_id, budget_version_id);

alter table public.budget_distribution_plans enable row level security;
alter table public.budget_distribution_plans force row level security;
create policy budget_distribution_plans_select on public.budget_distribution_plans
  for select using (
    org_id = public.auth_org_id()
    and public.is_active_member()
    and exists (
      select 1
        from public.budget_versions v
        join public.projects p on p.id = v.project_id
       where v.id = budget_distribution_plans.budget_version_id
         and v.org_id = public.auth_org_id()
         and p.org_id = public.auth_org_id()
    )
  );
revoke all on public.budget_distribution_plans from public, anon, authenticated;
grant select on public.budget_distribution_plans to authenticated;
grant all on public.budget_distribution_plans to service_role;

alter table public.budget_year_distributions enable row level security;
alter table public.budget_year_distributions force row level security;
create policy budget_year_distributions_select on public.budget_year_distributions
  for select using (
    org_id = public.auth_org_id()
    and public.is_active_member()
    and exists (
      select 1
        from public.budget_versions v
        join public.projects p on p.id = v.project_id
       where v.id = budget_year_distributions.budget_version_id
         and v.org_id = public.auth_org_id()
         and p.org_id = public.auth_org_id()
    )
  );
revoke all on public.budget_year_distributions from public, anon, authenticated;
grant select on public.budget_year_distributions to authenticated;
grant all on public.budget_year_distributions to service_role;

create trigger budget_distribution_plans_stamp_org_id
  before insert on public.budget_distribution_plans
  for each row execute function public.stamp_org_id();
create trigger budget_year_distributions_stamp_org_id
  before insert on public.budget_year_distributions
  for each row execute function public.stamp_org_id();

create or replace function public.assert_budget_mode_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.budget_mode is distinct from old.budget_mode then
    if old.status is distinct from 'Draft' or new.status is distinct from 'Draft' then
      raise exception 'budget mode is immutable after a version leaves Draft' using errcode = 'P0001';
    end if;
    if new.budget_mode = 'whole_project'
       and exists (
         select 1 from public.budget_line_items li
          where li.budget_version_id = old.id
            and li.fiscal_year is not null
       ) then
      raise exception 'whole-project budget lines cannot carry a fiscal year' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.assert_budget_mode_immutable() from public, anon, authenticated;
create trigger budget_versions_budget_mode_immutable
  before update of budget_mode on public.budget_versions
  for each row execute function public.assert_budget_mode_immutable();

create or replace function public.assert_budget_line_item_whole_project_year()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_mode text;
begin
  select budget_mode into v_mode
    from public.budget_versions
   where id = new.budget_version_id;
  if v_mode = 'whole_project' and new.fiscal_year is not null then
    raise exception 'whole-project budget lines cannot carry a fiscal year' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.assert_budget_line_item_whole_project_year() from public, anon, authenticated;
create trigger budget_line_items_whole_project_fiscal_year_guard
  before insert or update on public.budget_line_items
  for each row execute function public.assert_budget_line_item_whole_project_year();

-- Line writes, plan saves and activation serialize on the version row. Lock both parents in UUID order
-- when a line is moved so a concurrent save cannot reconcile against a partial source-line change.
create or replace function public.enforce_draft_line_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.budget_status;
  v_version_id uuid;
  v_version_ids uuid[];
begin
  if tg_op = 'INSERT' then
    v_version_id := new.budget_version_id;
    select array_agg(distinct id order by id) into v_version_ids
      from unnest(array[new.budget_version_id]) as versions(id);
  elsif tg_op = 'DELETE' then
    v_version_id := old.budget_version_id;
    select array_agg(distinct id order by id) into v_version_ids
      from unnest(array[old.budget_version_id]) as versions(id);
  else
    v_version_id := new.budget_version_id;
    select array_agg(distinct id order by id) into v_version_ids
      from unnest(array[old.budget_version_id, new.budget_version_id]) as versions(id);
  end if;

  if auth.uid() is null and auth.role() in ('anon', 'authenticated') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- A parent-version cascade removes its row before this child DELETE trigger runs. No client can
  -- create an orphan line (the FK is immediate), so preserve that cleanup path without acquiring
  -- or disclosing a now-deleted parent row.
  if tg_op = 'DELETE'
     and not exists (select 1 from public.budget_versions where id = any(v_version_ids)) then
    return old;
  end if;

  -- JWT callers may lock only versions and projects in their active organization. The trigger runs
  -- with its owner rights solely so it can serialize against the version row without widening the
  -- client's budget_versions UPDATE grant.
  if auth.uid() is not null and (
    not public.is_active_member()
    or (
      select count(*)
        from public.budget_versions versions
        join public.projects projects on projects.id = versions.project_id
       where versions.id = any(v_version_ids)
         and versions.org_id = public.auth_org_id()
         and projects.org_id = public.auth_org_id()
    ) <> cardinality(v_version_ids)
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform 1
    from public.budget_versions
   where id = any(v_version_ids)
   order by id
   for update;

  select status into v_status
    from public.budget_versions
   where id = v_version_id;
  if v_status is distinct from 'Draft' then
    raise exception 'line-items can only change while the owning version is Draft' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.enforce_draft_line_item() from public, anon, authenticated;

comment on column public.budget_versions.budget_mode is
  'Budget shape: per_year preserves historical annual behavior; whole_project stores category/year distributions separately.';
comment on table public.budget_distribution_plans is
  'Approved whole-project distribution inputs and the calendar basis witness; clients write only through save_budget_distribution.';
comment on table public.budget_year_distributions is
  'Exact resolved yearly amounts by budget version and category; clients write only through save_budget_distribution.';
