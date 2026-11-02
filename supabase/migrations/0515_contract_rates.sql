-- #1514 T1: versioned contract rates and labour assignments.
-- The applies_to boundary preserves the historical applicability of earlier versions, following 0460.

create table public.contract_rate_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  line_key uuid not null,
  version integer not null check (version >= 1),
  is_current boolean not null default true,
  kind text not null check (kind in ('labour')),
  asset_id uuid,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  unit text not null check (unit in ('hour', 'day')),
  rate numeric(14,2) not null check (rate >= 0 and rate < 'Infinity'::numeric),
  standby_rate numeric(14,2),
  effective_from date not null,
  effective_to date,
  applies_to date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (org_id, project_id, line_key, version),
  constraint contract_rate_lines_window check (effective_to is null or effective_to >= effective_from - 1),
  constraint contract_rate_lines_applies_to_window check (applies_to is null or applies_to >= effective_from - 1),
  constraint contract_rate_lines_labour_shape check (kind <> 'labour' or (asset_id is null and standby_rate is null))
);
create unique index contract_rate_lines_one_current
  on public.contract_rate_lines (org_id, project_id, line_key) where is_current;
create index contract_rate_lines_project_idx on public.contract_rate_lines (org_id, project_id, line_key, effective_from);
create trigger contract_rate_lines_stamp_org_id before insert on public.contract_rate_lines
  for each row execute function public.stamp_org_id();
alter table public.contract_rate_lines enable row level security;
alter table public.contract_rate_lines force row level security;
create policy contract_rate_lines_select on public.contract_rate_lines for select
  using (org_id = public.auth_org_id() and public.is_active_member() and (
    public.auth_role() in ('Admin', 'Finance', 'Executive')
    or (public.auth_role() = 'Project Manager' and exists (
      select 1 from public.projects p
       where p.id = contract_rate_lines.project_id and p.org_id = contract_rate_lines.org_id
         and p.project_manager_id = auth.uid()))
  ));
revoke all on public.contract_rate_lines from public, anon, authenticated;
grant select on public.contract_rate_lines to authenticated;
grant all on public.contract_rate_lines to service_role;

create table public.contract_rate_assignees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  line_key uuid not null,
  user_id uuid not null references public.profiles(id) on delete restrict,
  effective_from date not null,
  effective_to date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint contract_rate_assignees_window check (effective_to is null or effective_to >= effective_from)
);
create index contract_rate_assignees_project_idx
  on public.contract_rate_assignees (org_id, project_id, line_key, effective_from, effective_to);
create index contract_rate_assignees_person_idx
  on public.contract_rate_assignees (org_id, project_id, user_id, effective_from, effective_to);
create trigger contract_rate_assignees_stamp_org_id before insert on public.contract_rate_assignees
  for each row execute function public.stamp_org_id();
alter table public.contract_rate_assignees enable row level security;
alter table public.contract_rate_assignees force row level security;
create policy contract_rate_assignees_select on public.contract_rate_assignees for select
  using (org_id = public.auth_org_id() and public.is_active_member() and (
    public.auth_role() in ('Admin', 'Finance', 'Executive')
    or (public.auth_role() = 'Project Manager' and exists (
      select 1 from public.projects p
       where p.id = contract_rate_assignees.project_id and p.org_id = contract_rate_assignees.org_id
         and p.project_manager_id = auth.uid()))
  ));
revoke all on public.contract_rate_assignees from public, anon, authenticated;
grant select on public.contract_rate_assignees to authenticated;
grant all on public.contract_rate_assignees to service_role;

-- Internal helpers run only as the owner from the three client RPCs.
create function public.contract_rate_line_normalize(p_org uuid, p_line jsonb) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_project uuid;
  v_key uuid;
  v_kind text;
  v_label text;
  v_unit text;
  v_rate numeric;
  v_standby numeric;
  v_from date;
  v_to date;
  v_expected integer;
  v_currency text;
  v_project_currency text;
begin
  if p_line is null or jsonb_typeof(p_line) <> 'object' then
    raise exception 'rate line must be a JSON object' using errcode = '22023';
  end if;
  begin
    v_project := nullif(p_line->>'project_id', '')::uuid;
    v_key := nullif(p_line->>'line_key', '')::uuid;
    v_kind := nullif(btrim(p_line->>'kind'), '');
    v_label := btrim(coalesce(p_line->>'label', ''));
    v_unit := nullif(btrim(p_line->>'unit'), '');
    v_rate := nullif(p_line->>'rate', '')::numeric;
    v_standby := nullif(p_line->>'standby_rate', '')::numeric;
    v_from := nullif(p_line->>'effective_from', '')::date;
    v_to := nullif(p_line->>'effective_to', '')::date;
    v_expected := nullif(p_line->>'expected_version', '')::integer;
    v_currency := upper(btrim(coalesce(p_line->>'currency', '')));
  exception when others then
    raise exception 'rate line fields are malformed' using errcode = '22023';
  end;
  if v_project is null then raise exception 'project_id is required' using errcode = '22023'; end if;
  if v_kind is distinct from 'labour' then raise exception 'kind must be labour' using errcode = '22023'; end if;
  if char_length(v_label) not between 1 and 120 then raise exception 'label is required (at most 120 characters)' using errcode = '22023'; end if;
  if v_unit is null or v_unit not in ('hour', 'day') then raise exception 'unit must be hour or day' using errcode = '22023'; end if;
  if v_rate is null or v_rate::text in ('NaN', 'Infinity', '-Infinity') or v_rate < 0
     or v_rate >= 1000000000000 or round(v_rate, 2) <> v_rate then
    raise exception 'rate must be non-negative, below 1000000000000, with at most 2 decimals' using errcode = '22023';
  end if;
  if v_standby is not null then raise exception 'standby_rate is only supported for equipment' using errcode = '22023'; end if;
  if v_from is null or (v_to is not null and v_to < v_from - 1) then
    raise exception 'effective dates are invalid' using errcode = '22023';
  end if;
  if v_expected is not null and v_expected < 1 then raise exception 'expected_version must be positive' using errcode = '22023'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'currency must be a three-letter code' using errcode = '22023'; end if;
  select p.currency into v_project_currency from public.projects p where p.id = v_project and p.org_id = p_org;
  if not found then raise exception 'project not found' using errcode = 'P0002'; end if;
  if v_currency <> v_project_currency then raise exception 'rate currency must match project currency' using errcode = '23514'; end if;
  return jsonb_build_object(
    'project_id', v_project, 'line_key', v_key, 'kind', v_kind, 'asset_id', null,
    'label', v_label, 'unit', v_unit, 'rate', v_rate, 'standby_rate', null,
    'effective_from', v_from, 'effective_to', v_to, 'expected_version', v_expected, 'currency', v_currency
  );
end $$;

create function public.contract_rate_line_content(p_id uuid) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'project_id', project_id, 'line_key', line_key, 'kind', kind, 'asset_id', asset_id,
    'label', label, 'unit', unit, 'rate', rate, 'standby_rate', standby_rate,
    'effective_from', effective_from, 'effective_to', effective_to
  ) from public.contract_rate_lines where id = p_id
$$;

create function public.contract_rate_line_write(p_line jsonb, p_action text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_norm jsonb;
  v_project uuid;
  v_key uuid;
  v_expected integer;
  v_from date;
  v_to date;
  v_cur public.contract_rate_lines;
  v_before jsonb;
  v_after jsonb;
  v_id uuid;
  v_version integer := 1;
  v_content jsonb;
begin
  if v_org is null or v_uid is null then raise exception 'active organization required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('contract_rates:' || v_org::text, 0));
  v_norm := public.contract_rate_line_normalize(v_org, p_line);
  v_project := (v_norm->>'project_id')::uuid;
  v_key := coalesce((v_norm->>'line_key')::uuid, gen_random_uuid());
  v_expected := nullif(v_norm->>'expected_version', '')::integer;
  v_from := (v_norm->>'effective_from')::date;
  v_to := nullif(v_norm->>'effective_to', '')::date;
  v_norm := jsonb_set(v_norm, '{line_key}', to_jsonb(v_key));
  v_content := v_norm - 'expected_version' - 'currency';

  select * into v_cur from public.contract_rate_lines l
   where l.org_id = v_org and l.project_id = v_project and l.line_key = v_key and l.is_current for update;
  if found then
    if v_expected is null or v_expected <> v_cur.version then
      raise exception 'rate line changed since it was loaded (current version %)', v_cur.version using errcode = '40001';
    end if;
    v_before := public.contract_rate_line_content(v_cur.id);
    if v_before = v_content then
      return jsonb_build_object('id', v_cur.id, 'line_key', v_key, 'version', v_cur.version, 'changed', false);
    end if;
    if p_action <> 'end' and v_from <= v_cur.effective_from then
      raise exception 'a new rate version cannot rewrite an already applied effective window' using errcode = '23505';
    end if;
    if p_action = 'end' and (v_from <> v_cur.effective_from or (v_cur.effective_to is not null and v_to > v_cur.effective_to)) then
      raise exception 'ending a rate line cannot move or extend its effective window' using errcode = '22023';
    end if;
    v_version := v_cur.version + 1;
    update public.contract_rate_lines l
       set applies_to = greatest(l.effective_from, v_from) - 1
     where l.org_id = v_org and l.project_id = v_project and l.line_key = v_key
       and least(coalesce(l.effective_to, 'infinity'::date), coalesce(l.applies_to, 'infinity'::date)) >= v_from;
    update public.contract_rate_lines set is_current = false where id = v_cur.id;
  elsif v_expected is not null then
    raise exception 'rate line not found' using errcode = 'P0002';
  elsif p_action = 'end' then
    raise exception 'rate line not found' using errcode = 'P0002';
  end if;

  insert into public.contract_rate_lines (
    org_id, project_id, line_key, version, is_current, kind, asset_id, label, unit,
    rate, standby_rate, effective_from, effective_to, created_by
  ) values (
    v_org, v_project, v_key, v_version, true, v_norm->>'kind', null,
    v_norm->>'label', v_norm->>'unit', (v_norm->>'rate')::numeric, null,
    v_from, v_to, v_uid
  ) returning id into v_id;
  v_after := public.contract_rate_line_content(v_id);
  perform public.log_audit(
    'contract_rate_line.' || case when v_cur.id is null then 'create' else p_action end,
    v_org, v_uid, v_id,
    jsonb_build_object('line_key', v_key, 'version', v_version, 'before', v_before, 'after', v_after)
  );
  return jsonb_build_object('id', v_id, 'line_key', v_key, 'version', v_version, 'changed', true);
end $$;

create function public.save_contract_rate_line(p_line jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin', 'Finance') then
    raise exception 'not authorized to save contract rates' using errcode = '42501';
  end if;
  return public.contract_rate_line_write(p_line, 'update');
end $$;

create function public.end_contract_rate_line(p_project uuid, p_line_key uuid, p_effective_to date, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_line public.contract_rate_lines;
  v_currency text;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin', 'Finance') then
    raise exception 'not authorized to end contract rates' using errcode = '42501';
  end if;
  if p_effective_to is null then raise exception 'effective_to is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('contract_rates:' || public.auth_org_id()::text, 0));
  select * into v_line from public.contract_rate_lines l
   where l.org_id = public.auth_org_id() and l.project_id = p_project and l.line_key = p_line_key and l.is_current for update;
  if not found then raise exception 'rate line not found' using errcode = 'P0002'; end if;
  select p.currency into v_currency from public.projects p where p.id = p_project and p.org_id = public.auth_org_id();
  return public.contract_rate_line_write(jsonb_build_object(
    'project_id', p_project, 'line_key', p_line_key, 'expected_version', p_expected_version,
    'kind', v_line.kind, 'label', v_line.label, 'unit', v_line.unit, 'rate', v_line.rate,
    'currency', v_currency, 'effective_from', v_line.effective_from, 'effective_to', p_effective_to
  ), 'end');
end $$;

create function public.set_contract_rate_assignee(
  p_project uuid, p_line_key uuid, p_user uuid, p_from date, p_to date
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin', 'Finance') then
    raise exception 'not authorized to assign contract rates' using errcode = '42501';
  end if;
  if p_from is null or (p_to is not null and p_to < p_from) then
    raise exception 'assignment dates are invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('contract_rates:' || v_org::text, 0));
  if not exists (select 1 from public.projects p where p.id = p_project and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.contract_rate_lines l
                  where l.org_id = v_org and l.project_id = p_project and l.line_key = p_line_key and l.is_current) then
    raise exception 'rate line not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles u where u.id = p_user and u.org_id = v_org and public.is_active_member(u.id)) then
    raise exception 'active organization member not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.contract_rate_assignees a
     where a.org_id = v_org and a.project_id = p_project and a.user_id = p_user
       and a.effective_from <= coalesce(p_to, 'infinity'::date)
       and p_from <= coalesce(a.effective_to, 'infinity'::date)
  ) then
    raise exception 'person already has a labour line over those dates' using errcode = '23505';
  end if;
  insert into public.contract_rate_assignees (org_id, project_id, line_key, user_id, effective_from, effective_to, created_by)
  values (v_org, p_project, p_line_key, p_user, p_from, p_to, v_uid)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.contract_rate_line_normalize(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.contract_rate_line_content(uuid) from public, anon, authenticated;
revoke all on function public.contract_rate_line_write(jsonb, text) from public, anon, authenticated;
revoke all on function public.save_contract_rate_line(jsonb) from public, anon, authenticated;
revoke all on function public.end_contract_rate_line(uuid, uuid, date, integer) from public, anon, authenticated;
revoke all on function public.set_contract_rate_assignee(uuid, uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public.save_contract_rate_line(jsonb) to authenticated;
grant execute on function public.end_contract_rate_line(uuid, uuid, date, integer) to authenticated;
grant execute on function public.set_contract_rate_assignee(uuid, uuid, uuid, date, date) to authenticated;
alter function public.save_contract_rate_line(jsonb) owner to postgres;
alter function public.end_contract_rate_line(uuid, uuid, date, integer) owner to postgres;
alter function public.set_contract_rate_assignee(uuid, uuid, uuid, date, date) owner to postgres;

do $$
declare v_bad text;
begin
  select p.oid::regprocedure::text into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'contract_rate_line_normalize', 'contract_rate_line_content', 'contract_rate_line_write',
       'save_contract_rate_line', 'end_contract_rate_line', 'set_contract_rate_assignee'
     )
     and (
       (p.proname in ('contract_rate_line_normalize', 'contract_rate_line_content', 'contract_rate_line_write')
          and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       or has_function_privilege('anon', p.oid, 'EXECUTE')
       or exists (
         select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
       )
     )
   limit 1;
  if v_bad is not null then raise exception '0515 rate function has an unsafe client grant: %', v_bad; end if;
end $$;
