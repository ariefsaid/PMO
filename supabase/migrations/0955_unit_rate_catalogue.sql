-- 0955_unit_rate_catalogue.sql — #2520: per-contract unit-rate catalogue.
-- Sits BESIDE contract_rate_lines (0515, labour hour/day versions) and boq_items (0250, priced contract lines):
-- those answer "what do we charge per hour" and "what is this line worth"; this answers "what does each catalogue
-- item cost at each location variant, as of a date". A BOQ line copies the rate it was priced at (boq_items.rate
-- stays the single money column), so amending the catalogue never moves a line already priced.
-- Reversal: rollback/0955_unit_rate_catalogue_down.sql.

create table public.rate_catalogue_variants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);
create unique index rate_catalogue_variants_one_default on public.rate_catalogue_variants (project_id) where is_default;
create unique index rate_catalogue_variants_name_ci on public.rate_catalogue_variants (project_id, lower(name));

create table public.rate_catalogue_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  category text not null default '' check (char_length(category) <= 120),
  class text not null default '' check (char_length(class) <= 120),
  item_code text not null check (char_length(btrim(item_code)) between 1 and 140),
  description text not null check (char_length(btrim(description)) between 1 and 500),
  unit text not null check (char_length(btrim(unit)) between 1 and 40),
  work_method text not null default '' check (char_length(work_method) <= 200),
  test_type text not null default '' check (char_length(test_type) <= 200),
  created_at timestamptz not null default now(),
  unique (project_id, item_code)
);
create index rate_catalogue_items_tree_idx on public.rate_catalogue_items (project_id, category, class, item_code);

-- Append-only: an amendment is a NEW row with a later effective_from. No update or delete is granted or policied.
create table public.rate_catalogue_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.rate_catalogue_items(id) on delete cascade,
  variant_id uuid not null references public.rate_catalogue_variants(id) on delete cascade,
  rate numeric(14,2) not null check (rate >= 0 and rate < 'Infinity'::numeric),
  effective_from date not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (item_id, variant_id, effective_from)
);
create index rate_catalogue_rates_lookup_idx on public.rate_catalogue_rates (item_id, variant_id, effective_from desc);

-- Optional staged-progress weights: one set per (item, effective_from); the set sums to 100.
create table public.rate_catalogue_stage_weights (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.rate_catalogue_items(id) on delete cascade,
  effective_from date not null,
  position integer not null check (position >= 1),
  stage text not null check (char_length(btrim(stage)) between 1 and 80),
  weight_pct numeric(5,2) not null check (weight_pct > 0 and weight_pct <= 100),
  created_at timestamptz not null default now(),
  unique (item_id, effective_from, position)
);

do $$ declare t text; begin
  foreach t in array array['rate_catalogue_variants','rate_catalogue_items','rate_catalogue_rates','rate_catalogue_stage_weights'] loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.stamp_org_id()', t || '_stamp_org_id', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Read: same audience as contract_rate_lines (0515). Every table carries org_id; the item/variant ones also project_id.
create policy rate_catalogue_variants_select on public.rate_catalogue_variants for select
  using (org_id = public.auth_org_id() and public.is_active_member() and (
    public.auth_role() in ('Admin','Finance','Executive')
    or (public.auth_role() = 'Project Manager' and exists (select 1 from public.projects p
         where p.id = rate_catalogue_variants.project_id and p.org_id = rate_catalogue_variants.org_id and p.project_manager_id = auth.uid()))));
create policy rate_catalogue_items_select on public.rate_catalogue_items for select
  using (org_id = public.auth_org_id() and public.is_active_member() and (
    public.auth_role() in ('Admin','Finance','Executive')
    or (public.auth_role() = 'Project Manager' and exists (select 1 from public.projects p
         where p.id = rate_catalogue_items.project_id and p.org_id = rate_catalogue_items.org_id and p.project_manager_id = auth.uid()))));
create policy rate_catalogue_rates_select on public.rate_catalogue_rates for select
  using (org_id = public.auth_org_id() and public.is_active_member() and exists (
    select 1 from public.rate_catalogue_items i where i.id = rate_catalogue_rates.item_id));
create policy rate_catalogue_stage_weights_select on public.rate_catalogue_stage_weights for select
  using (org_id = public.auth_org_id() and public.is_active_member() and exists (
    select 1 from public.rate_catalogue_items i where i.id = rate_catalogue_stage_weights.item_id));

-- The BOQ line remembers where its rate came from. The rate itself is the existing boq_items.rate.
alter table public.boq_items
  add column catalogue_item_id uuid references public.rate_catalogue_items(id),
  add column catalogue_variant_id uuid references public.rate_catalogue_variants(id),
  add column catalogue_priced_as_of date,
  add constraint boq_items_catalogue_trio check (
    (catalogue_item_id is null and catalogue_variant_id is null and catalogue_priced_as_of is null)
    or (catalogue_item_id is not null and catalogue_variant_id is not null and catalogue_priced_as_of is not null));
create index boq_items_catalogue_item_idx on public.boq_items (catalogue_item_id) where catalogue_item_id is not null;

-- Even direct column updates must not attach provenance from another contract.
create function public.check_boq_catalogue_project() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.catalogue_item_id is not null and not exists (
    select 1 from public.rate_catalogue_items i
    join public.rate_catalogue_variants v on v.project_id = i.project_id and v.org_id = i.org_id
    where i.id = new.catalogue_item_id and v.id = new.catalogue_variant_id
      and i.project_id = new.project_id and i.org_id = new.org_id
  ) then
    raise exception 'catalogue item and location variant must belong to the line''s contract' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger boq_items_catalogue_project before insert or update of project_id, org_id, catalogue_item_id, catalogue_variant_id
  on public.boq_items for each row execute function public.check_boq_catalogue_project();

-- Rate in force for (item, variant) on a date: the latest effective_from not after it.
create function public.rate_catalogue_rate_at(p_item uuid, p_variant uuid, p_as_of date) returns numeric
language sql stable set search_path = public, pg_temp as $$
  select r.rate from public.rate_catalogue_rates r
   where r.item_id = p_item and r.variant_id = p_variant and r.effective_from <= p_as_of
   order by r.effective_from desc limit 1
$$;

create function public.rate_catalogue_writer_check(p_project uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or auth.uid() is null or not public.is_active_member() then
    raise exception 'active organization required' using errcode = '42501';
  end if;
  if coalesce(public.auth_role()::text, '') not in ('Admin','Finance') then
    raise exception 'only Admin or Finance can change the rate catalogue' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  return v_org;
end $$;
revoke all on function public.rate_catalogue_writer_check(uuid) from public, anon, authenticated;

-- Serialise changes to the project's single default and validate the caller and variant.
create function public.rate_catalogue_set_default_variant(p_project uuid, p_variant uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  v_org := public.rate_catalogue_writer_check(p_project);
  perform 1 from public.projects where id = p_project for update;
  if p_variant is not null and not exists (select 1 from public.rate_catalogue_variants where id = p_variant and project_id = p_project and org_id = v_org) then
    raise exception 'variant must belong to the project' using errcode = '23514';
  end if;
  update public.rate_catalogue_variants set is_default = false where project_id = p_project and is_default;
  update public.rate_catalogue_variants set is_default = true where id = p_variant and project_id = p_project;
end $$;
revoke all on function public.rate_catalogue_set_default_variant(uuid, uuid) from public, anon;
grant execute on function public.rate_catalogue_set_default_variant(uuid, uuid) to authenticated;

-- Variant names for a contract. Adds the missing ones; never renames or removes (rates and lines point at them).
create function public.rate_catalogue_add_variants(p_project uuid, p_names text[]) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; n text; v_added integer := 0; v_rows integer;
begin
  v_org := public.rate_catalogue_writer_check(p_project);
  foreach n in array coalesce(p_names, '{}') loop
    n := btrim(n);
    if char_length(n) not between 1 and 60 then raise exception 'variant name must be 1 to 60 characters' using errcode = '22023'; end if;
    insert into public.rate_catalogue_variants (org_id, project_id, name) values (v_org, p_project, n)
      on conflict (project_id, lower(name)) do nothing;
    get diagnostics v_rows = row_count; v_added := v_added + v_rows;
  end loop;
  return v_added;
end $$;

-- One catalogue item with its rates per variant and optional stage weights, from one import row or one form.
-- p_item: {category,class,item_code,description,unit,work_method,test_type,effective_from,rates:{variant:number},stages:[{stage,weight_pct}]}
create function public.rate_catalogue_upsert_item(p_project uuid, p_item jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); v_id uuid; v_code text; v_from date; v_rate numeric;
  v_variant uuid; r record; v_latest date; v_cur numeric; v_new integer := 0; v_stage_sum numeric;
  v_stage jsonb; v_pos integer; v_latest_w date; v_item_created boolean := false;
begin
  v_org := public.rate_catalogue_writer_check(p_project);
  if p_item is null or jsonb_typeof(p_item) <> 'object' then raise exception 'item must be an object' using errcode = '22023'; end if;
  v_code := btrim(coalesce(p_item->>'item_code', ''));
  begin v_from := (p_item->>'effective_from')::date; exception when others then v_from := null; end;
  if v_from is null then raise exception 'effective_from is required' using errcode = '22023'; end if;
  if char_length(v_code) not between 1 and 140 then raise exception 'item_code is required (at most 140 characters)' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rate_catalogue:' || p_project::text, 0));

  select id into v_id from public.rate_catalogue_items where project_id = p_project and item_code = v_code for update;
  if v_id is null then
    insert into public.rate_catalogue_items (org_id, project_id, category, class, item_code, description, unit, work_method, test_type)
    values (v_org, p_project, btrim(coalesce(p_item->>'category','')), btrim(coalesce(p_item->>'class','')), v_code,
            btrim(coalesce(p_item->>'description','')), btrim(coalesce(p_item->>'unit','')),
            btrim(coalesce(p_item->>'work_method','')), btrim(coalesce(p_item->>'test_type','')))
    returning id into v_id;
    v_item_created := true;
  else
    -- Descriptive fields follow the sheet; money never does (below).
    update public.rate_catalogue_items set category = btrim(coalesce(p_item->>'category', category)), class = btrim(coalesce(p_item->>'class', class)),
      description = btrim(coalesce(p_item->>'description', description)), unit = btrim(coalesce(p_item->>'unit', unit)),
      work_method = btrim(coalesce(p_item->>'work_method', work_method)), test_type = btrim(coalesce(p_item->>'test_type', test_type))
     where id = v_id;
  end if;

  for r in select key, value from jsonb_each_text(coalesce(p_item->'rates', '{}'::jsonb)) loop
    select id into v_variant from public.rate_catalogue_variants where project_id = p_project and lower(name) = lower(btrim(r.key));
    if v_variant is null then raise exception 'unknown location variant "%"', r.key using errcode = '23503'; end if;
    begin v_rate := r.value::numeric; exception when others then v_rate := null; end;
    if v_rate is null or v_rate < 0 or v_rate >= 1000000000000 or round(v_rate, 2) <> v_rate then
      raise exception 'rate for "%" must be 0 or more with at most 2 decimals', r.key using errcode = '22023';
    end if;
    select effective_from into v_latest from public.rate_catalogue_rates where item_id = v_id and variant_id = v_variant order by effective_from desc limit 1;
    if v_latest is not null then
      v_cur := public.rate_catalogue_rate_at(v_id, v_variant, v_latest);
      if v_from < v_latest then raise exception 'a rate for "%" already exists from %; an amendment cannot be dated before it', r.key, v_latest using errcode = '23505'; end if;
      if v_from = v_latest then
        if v_cur = v_rate then continue; end if;
        raise exception 'a rate for "%" is already set from %; amend it with a later effective date', r.key, v_from using errcode = '23505';
      end if;
      if v_cur = v_rate then continue; end if;
    end if;
    insert into public.rate_catalogue_rates (org_id, item_id, variant_id, rate, effective_from, created_by) values (v_org, v_id, v_variant, v_rate, v_from, v_uid);
    v_new := v_new + 1;
  end loop;

  if jsonb_typeof(p_item->'stages') = 'array' and jsonb_array_length(p_item->'stages') > 0 then
    if exists (select 1 from jsonb_array_elements(p_item->'stages') s
               where (s->>'weight_pct')::numeric <> round((s->>'weight_pct')::numeric, 2)) then
      raise exception 'stage weights must have at most 2 decimals' using errcode = '22023';
    end if;
    select coalesce(sum((s->>'weight_pct')::numeric), 0) into v_stage_sum from jsonb_array_elements(p_item->'stages') s;
    if v_stage_sum <> 100 then raise exception 'stage weights must add up to 100 (they add up to %)', v_stage_sum using errcode = '22023'; end if;
    select max(effective_from) into v_latest_w from public.rate_catalogue_stage_weights where item_id = v_id;
    if v_latest_w is not null and v_from < v_latest_w then raise exception 'stage weights already exist from %', v_latest_w using errcode = '23505'; end if;
    if v_latest_w = v_from then
      if exists (
        (select position, stage, weight_pct from public.rate_catalogue_stage_weights where item_id = v_id and effective_from = v_from
         except select ordinality::integer, btrim(value->>'stage'), (value->>'weight_pct')::numeric from jsonb_array_elements(p_item->'stages') with ordinality)
        union all
        (select ordinality::integer, btrim(value->>'stage'), (value->>'weight_pct')::numeric from jsonb_array_elements(p_item->'stages') with ordinality
         except select position, stage, weight_pct from public.rate_catalogue_stage_weights where item_id = v_id and effective_from = v_from)
      ) then
        raise exception 'stage weights are already set from %; amend them with a later effective date', v_from using errcode = '23505';
      end if;
    else
    v_pos := 0;
    for v_stage in select * from jsonb_array_elements(p_item->'stages') loop
      v_pos := v_pos + 1;
      insert into public.rate_catalogue_stage_weights (org_id, item_id, effective_from, position, stage, weight_pct)
      values (v_org, v_id, v_from, v_pos, btrim(v_stage->>'stage'), (v_stage->>'weight_pct')::numeric);
    end loop;
    end if;
  end if;
  return jsonb_build_object('item_id', v_id, 'created', v_item_created, 'rates_added', v_new);
end $$;

-- Price one BOQ line from the catalogue at a location variant, as of a date. SECURITY INVOKER: the caller's own
-- boq_items RLS, column grants and money locks decide whether the line may change.
create function public.price_boq_line_from_catalogue(p_boq_item uuid, p_catalogue_item uuid, p_variant uuid, p_as_of date default current_date) returns numeric
language plpgsql set search_path = public, pg_temp as $$
declare v_rate numeric; v_proj uuid; v_ok boolean; v_rows integer;
begin
  select project_id into v_proj from public.boq_items where id = p_boq_item;
  if v_proj is null then raise exception 'contract line not found' using errcode = 'P0002'; end if;
  select exists (select 1 from public.rate_catalogue_items i join public.rate_catalogue_variants v on v.project_id = i.project_id
                  where i.id = p_catalogue_item and v.id = p_variant and i.project_id = v_proj) into v_ok;
  if not v_ok then raise exception 'catalogue item and location variant must belong to the line''s contract' using errcode = '23514'; end if;
  v_rate := public.rate_catalogue_rate_at(p_catalogue_item, p_variant, p_as_of);
  if v_rate is null then raise exception 'no rate in force for that item and location on %', p_as_of using errcode = 'P0002'; end if;
  update public.boq_items set rate = v_rate, catalogue_item_id = p_catalogue_item, catalogue_variant_id = p_variant, catalogue_priced_as_of = p_as_of
   where id = p_boq_item;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'contract line cannot be changed' using errcode = '42501'; end if;
  return v_rate;
end $$;
grant update (catalogue_item_id, catalogue_variant_id, catalogue_priced_as_of) on public.boq_items to authenticated;

revoke all on function public.rate_catalogue_add_variants(uuid, text[]) from public, anon;
revoke all on function public.rate_catalogue_upsert_item(uuid, jsonb) from public, anon;
revoke all on function public.price_boq_line_from_catalogue(uuid, uuid, uuid, date) from public, anon;
revoke all on function public.rate_catalogue_rate_at(uuid, uuid, date) from public, anon;
grant execute on function public.rate_catalogue_add_variants(uuid, text[]) to authenticated;
grant execute on function public.rate_catalogue_upsert_item(uuid, jsonb) to authenticated;
grant execute on function public.price_boq_line_from_catalogue(uuid, uuid, uuid, date) to authenticated;
grant execute on function public.rate_catalogue_rate_at(uuid, uuid, date) to authenticated;
