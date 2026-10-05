-- 0225_project_numbering.sql — PMO-owned project identifier (#771, OD-ID-1).
-- projects.code remains the organisation's independent Client Project Code.
-- Reversible via supabase/migrations/rollback/0225_project_numbering_down.sql.

-- A NULL pattern is the system default. Custom patterns contain exactly one each of the three
-- supported tokens; literal text is otherwise unrestricted, while braces are reserved for tokens.
create or replace function public.is_valid_project_number_pattern(p_pattern text)
returns boolean
language plpgsql immutable
set search_path = pg_catalog, public
as $$
declare
  v_rest text;
  v_client_count integer;
  v_year_count integer;
  v_seq_count integer;
begin
  if p_pattern is null then return true; end if;
  if btrim(p_pattern) = '' then return false; end if;

  v_client_count := (length(p_pattern) - length(replace(p_pattern, '{CLIENT}', ''))) / length('{CLIENT}');
  v_year_count := (length(p_pattern) - length(replace(p_pattern, '{YY}', ''))) / length('{YY}');
  v_seq_count := (length(p_pattern) - length(replace(p_pattern, '{SEQ4}', ''))) / length('{SEQ4}');

  v_rest := replace(replace(replace(p_pattern, '{CLIENT}', ''), '{YY}', ''), '{SEQ4}', '');
  if position('{' in v_rest) > 0 or position('}' in v_rest) > 0 then return false; end if;
  return v_client_count = 1 and v_year_count = 1 and v_seq_count = 1;
end;
$$;
revoke all on function public.is_valid_project_number_pattern(text) from public, anon, authenticated;
grant execute on function public.is_valid_project_number_pattern(text) to authenticated;

alter table public.organizations add column project_number_pattern text;
comment on column public.organizations.project_number_pattern is
  'OD-ID-1 / #771: optional Admin-defined PMO project-number pattern. NULL means the system default PRJ-{YY}-{SEQ4}; never controls projects.code.';
alter table public.organizations
  add constraint organizations_project_number_pattern_check
  check (public.is_valid_project_number_pattern(project_number_pattern));

alter table public.companies add column client_number_segment text;
comment on column public.companies.client_number_segment is
  'OD-ID-1 / #771: optional organisation-owned segment expanded into future PMO project-number proposals; independent from company identity.';
alter table public.companies
  add constraint companies_client_number_segment_nonblank
  check (client_number_segment is null or btrim(client_number_segment) <> '');

-- Backfill by the organization's business-local creation year and a stable created_at/id order.
-- Keep `code` untouched: it is the separately owned Client Project Code (OD-ID-1).
alter table public.projects add column pmo_project_number text;
comment on column public.projects.pmo_project_number is
  'OD-ID-1 / #771: stable human-readable project identifier minted by PMO; distinct from projects.code and external_refs.';
with ranked as (
  select p.id,
         row_number() over (
           partition by p.org_id, extract(year from (p.created_at at time zone coalesce(o.default_timezone, 'UTC')))::integer
           order by p.created_at, p.id
         ) as seq,
         extract(year from (p.created_at at time zone coalesce(o.default_timezone, 'UTC')))::integer as business_year
    from public.projects p
    join public.organizations o on o.id = p.org_id
)
update public.projects p
   set pmo_project_number = 'PRJ-'
       || lpad(mod(r.business_year, 100)::text, 2, '0')
       || '-'
       || lpad(r.seq::text, greatest(4, length(r.seq::text)), '0')
  from ranked r
 where p.id = r.id;

-- A volatile NULL-valued default preserves the omission contract in Supabase's generated Insert type;
-- PostgreSQL folds a plain DEFAULT NULL away, making the trigger-backed field look required to TS.
create or replace function public.project_number_null_insert_default() returns text
language sql volatile
set search_path = pg_catalog
as $$ select null::text $$;
revoke all on function public.project_number_null_insert_default() from public, anon, authenticated;
grant execute on function public.project_number_null_insert_default() to authenticated, service_role;

alter table public.projects
  alter column pmo_project_number set default public.project_number_null_insert_default(),
  alter column pmo_project_number set not null,
  add constraint projects_pmo_project_number_nonblank check (btrim(pmo_project_number) <> '');
create unique index projects_org_pmo_project_number_uidx
  on public.projects (org_id, pmo_project_number);

create table public.project_number_counters (
  org_id uuid not null references public.organizations(id) on delete cascade,
  business_year integer not null,
  last_seq bigint not null check (last_seq > 0),
  primary key (org_id, business_year)
);
comment on table public.project_number_counters is
  '#771: private atomic allocator state, one counter per organization and business year; no client read/write surface.';
with yearly_counts as (
  select p.org_id,
         extract(year from (p.created_at at time zone coalesce(o.default_timezone, 'UTC')))::integer as business_year,
         count(*)::bigint as last_seq
    from public.projects p
    join public.organizations o on o.id = p.org_id
   group by p.org_id, extract(year from (p.created_at at time zone coalesce(o.default_timezone, 'UTC')))::integer
)
insert into public.project_number_counters(org_id, business_year, last_seq)
select org_id, business_year, last_seq from yearly_counts;

alter table public.project_number_counters enable row level security;
alter table public.project_number_counters force row level security;
revoke all on public.project_number_counters from public, anon, authenticated;

-- Existing organization config read is tenant-scoped; make active membership explicit after 0207's
-- membership-composition rule. The UPDATE grant remains column-scoped (no table-level write).
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select
  using (id = auth_org_id() and public.is_active_member());
drop policy if exists organizations_update_project_number_pattern on public.organizations;
create policy organizations_update_project_number_pattern on public.organizations for update
  using (id = auth_org_id() and public.is_active_member() and auth_role() = 'Admin')
  with check (id = auth_org_id() and public.is_active_member() and auth_role() = 'Admin');
-- 0207 grants only the default_tax_treatment column. Preserve that grant and add the PMO-local
-- configuration column without any table-level UPDATE privilege.
grant update (project_number_pattern) on public.organizations to authenticated;

-- Company writes retain their incumbent row/grant authority. The new segment is PMO-local and is
-- deliberately not added to companies_native_mirror_guard's external-native column list.
-- Existing company UPDATE grants remain as they were; no table-level grant is widened here.

-- The private allocator derives actor/org from the authenticated JWT for browser callers. A server
-- caller holding the service_role JWT may use the insert fallback during an authorised data load.
create or replace function public.next_project_number(
  p_org uuid,
  p_client_id uuid,
  p_at timestamptz default now()
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_claim_role text := coalesce(auth.jwt() ->> 'role', '');
  v_actor_org uuid;
  v_actor_role text;
  v_pattern text;
  v_timezone text;
  v_year integer;
  v_seq bigint;
  v_segment text;
  v_result text;
begin
  if v_claim_role not in ('service_role', 'postgres') and session_user not in ('postgres', 'supabase_admin') then
    if v_actor is null or not public.is_active_member(v_actor) then
      raise exception 'active_membership_required' using errcode = '42501';
    end if;
    select p.org_id, p.role::text into v_actor_org, v_actor_role
      from public.profiles p where p.id = v_actor;
    -- Obtain the tenant and role from the server-side profile, never from p_org or JWT app metadata.
    if not found then raise exception 'active_membership_required' using errcode = '42501'; end if;
    if v_actor_org is distinct from p_org then
      raise exception 'project_number_org_mismatch' using errcode = '42501';
    end if;
    if v_actor_role not in ('Admin', 'Executive', 'Project Manager', 'Finance') then
      raise exception 'project_create_role_required' using errcode = '42501';
    end if;
  end if;

  select o.project_number_pattern, coalesce(o.default_timezone, 'UTC')
    into v_pattern, v_timezone
    from public.organizations o where o.id = p_org;
  if not found then raise exception 'project_number_org_missing' using errcode = '42501'; end if;

  if p_client_id is not null then
    select c.client_number_segment into v_segment
      from public.companies c
     where c.id = p_client_id and c.org_id = p_org;
    if not found then raise exception 'project_number_client_org_mismatch' using errcode = '42501'; end if;
  end if;

  v_pattern := coalesce(v_pattern, 'PRJ-{YY}-{SEQ4}');
  if position('{CLIENT}' in v_pattern) > 0 and nullif(btrim(v_segment), '') is null then
    raise exception 'project_number_client_segment_required' using errcode = 'P0001';
  end if;

  v_year := extract(year from (coalesce(p_at, now()) at time zone v_timezone))::integer;
  insert into public.project_number_counters(org_id, business_year, last_seq)
  values (p_org, v_year, 1)
  on conflict (org_id, business_year)
  do update set last_seq = public.project_number_counters.last_seq + 1
  returning last_seq into v_seq;

  v_result := replace(v_pattern, '{CLIENT}', coalesce(v_segment, ''));
  v_result := replace(v_result, '{YY}', lpad(mod(v_year, 100)::text, 2, '0'));
  v_result := replace(v_result, '{SEQ4}', lpad(v_seq::text, greatest(4, length(v_seq::text)), '0'));
  return v_result;
end;
$$;
revoke all on function public.next_project_number(uuid, uuid, timestamptz) from public, anon, authenticated;

create or replace function public.propose_project_number(p_client_id uuid) returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_role text;
begin
  if v_actor is null or not public.is_active_member(v_actor) then
    raise exception 'active_membership_required' using errcode = '42501';
  end if;
  select p.org_id, p.role::text into v_org, v_role
    from public.profiles p where p.id = v_actor;
  if v_role not in ('Admin', 'Executive', 'Project Manager', 'Finance') then
    raise exception 'project_create_role_required' using errcode = '42501';
  end if;
  if p_client_id is null or not exists (
    select 1 from public.companies c where c.id = p_client_id and c.org_id = v_org
  ) then
    raise exception 'project_number_client_org_mismatch' using errcode = '42501';
  end if;
  return public.next_project_number(v_org, p_client_id, now());
end;
$$;
revoke all on function public.propose_project_number(uuid) from public, anon, authenticated;
grant execute on function public.propose_project_number(uuid) to authenticated;

create or replace function public.mint_project_number_on_insert() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if new.pmo_project_number is null then
    new.pmo_project_number := public.next_project_number(new.org_id, new.client_id, new.created_at);
  end if;
  return new;
end;
$$;
revoke all on function public.mint_project_number_on_insert() from public, anon, authenticated;
create trigger zz_projects_mint_pmo_number
  before insert on public.projects
  for each row execute function public.mint_project_number_on_insert();

create or replace function public.prevent_project_number_change() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.pmo_project_number is distinct from old.pmo_project_number then
    raise exception 'pmo_project_number_is_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_project_number_change() from public, anon, authenticated;
create trigger projects_pmo_number_immutable
  before update of pmo_project_number on public.projects
  for each row execute function public.prevent_project_number_change();

-- Preserve the incumbent column-scoped INSERT grants (including the later currency, tax, and
-- end-client columns); add only the new insertable identifier without revoking those grants.
grant insert (pmo_project_number) on public.projects to authenticated;
-- Intentionally no UPDATE grant for pmo_project_number: the identifier is immutable.

-- Keep the pre-win projection aligned with active project rows: both independently owned identifiers
-- must remain searchable on the Sales Pipeline surface. Preserve the current invoker/security/ACL contract.
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
          'code',            pl.code,
          'pmo_project_number', pl.pmo_project_number,
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
  'Latest definition: 0225. Projects include the PMO Project Number and optional Client Project Code. To add a projection column, copy this body and reapply AC-CODE-003 JSON-key proof.';

-- The RPC and projection are part of the API surface. Refresh PostgREST metadata for a live local
-- or hosted stack that applied this migration without restarting its API container.
notify pgrst, 'reload schema';
