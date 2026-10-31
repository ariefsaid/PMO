-- 0412_stock_master_data.sql - #1512 S1: units, items, warehouses, keepers (FR-STK-001..008, 060, 066).
-- Spec docs/specs/inventory-project-consumption.spec.md · plan docs/plans/2026-10-31-inventory-project-consumption.md.
-- Reversal: supabase/migrations/rollback/0412_stock_master_data_down.sql (pre-production: supabase db reset).
-- ⚑ Master data is written through RLS + COLUMN grants (the 0250 boq_items pattern). Keepers are written ONLY by
--   set_stock_warehouse_keeper. org_id is never in an INSERT grant: the stamp trigger fills it (FR-STK-065).
-- ⚑ Predicates use role RANK (ADR-0070), never a role list: master data = rank >= 20 (PM, Finance, Executive, Admin);
--   Admin-only = rank >= 50. Hosted grants lesson (0185/0210): every function revokes what it must not expose.

-- §1 helpers ----------------------------------------------------------------------------------------------
create or replace function public.stock_can_see_cost() returns boolean
  language sql stable set search_path = public as $$
  select coalesce(public.role_rank(public.auth_role()) >= 20, false)
$$;
create or replace function public.stock_master_writer() returns boolean
  language sql stable set search_path = public as $$
  select public.is_active_member() and coalesce(public.role_rank(public.auth_role()) >= 20, false)
$$;
create or replace function public.stock_admin() returns boolean
  language sql stable set search_path = public as $$
  select public.is_active_member() and coalesce(public.role_rank(public.auth_role()) >= 50, false)
$$;
revoke all on function public.stock_can_see_cost(), public.stock_master_writer(), public.stock_admin() from public, anon;
grant execute on function public.stock_can_see_cost(), public.stock_master_writer(), public.stock_admin() to authenticated;

-- §2 tables -----------------------------------------------------------------------------------------------
create table public.stock_units (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  code        text not null check (length(btrim(code)) between 1 and 20),
  name        text not null check (length(btrim(name)) between 1 and 80),
  whole_only  boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index stock_units_org_code_uniq on public.stock_units (org_id, lower(code));

create table public.stock_items (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  code           text not null check (length(btrim(code)) between 1 and 40),
  name           text not null check (length(btrim(name)) between 1 and 200),
  description    text check (description is null or length(description) <= 1000),
  unit_id        uuid not null references public.stock_units(id),
  lead_time_days integer check (lead_time_days is null or lead_time_days between 0 and 365),
  archived_at    timestamptz,
  created_at     timestamptz not null default now()
);
create unique index stock_items_org_code_uniq on public.stock_items (org_id, lower(code));
create index stock_items_unit_idx on public.stock_items (unit_id);

create table public.stock_warehouses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  code        text not null check (length(btrim(code)) between 1 and 40),
  name        text not null check (length(btrim(name)) between 1 and 200),
  kind        text not null check (kind in ('central','site')),
  project_id  uuid references public.projects(id),   -- informational default for issues; NOT a restriction
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index stock_warehouses_org_code_uniq on public.stock_warehouses (org_id, lower(code));
create index stock_warehouses_project_idx on public.stock_warehouses (project_id);

create table public.stock_warehouse_keepers (
  org_id       uuid not null references public.organizations(id),
  warehouse_id uuid not null references public.stock_warehouses(id),
  user_id      uuid not null references public.profiles(id),
  created_by   uuid default auth.uid(),   -- no FK: a 2nd profiles FK makes every unqualified `profiles` embed ambiguous (postgrest_embed_ambiguity_guard)
  created_at   timestamptz not null default now(),
  primary key (warehouse_id, user_id)
);
create index stock_warehouse_keepers_user_idx on public.stock_warehouse_keepers (user_id);

-- §3 org stamp + parent-org guards (invoker: the parent is read under the caller's RLS, so another org's row
-- is invisible and fails closed - the 0250 check_boq_item_work_order_same_project precedent).
create trigger stock_units_stamp_org_id      before insert on public.stock_units      for each row execute function public.stamp_org_id();
create trigger stock_items_stamp_org_id      before insert on public.stock_items      for each row execute function public.stamp_org_id();
create trigger stock_warehouses_stamp_org_id before insert on public.stock_warehouses for each row execute function public.stamp_org_id();

create or replace function public.check_stock_item_parent() returns trigger
  language plpgsql set search_path = public as $$
begin
  if (select u.org_id from public.stock_units u where u.id = new.unit_id) is distinct from new.org_id then
    raise exception 'STK_NOT_FOUND: the unit is not in your organisation' using errcode = 'P0001';
  end if;
  return new;
end $$;
create or replace function public.check_stock_warehouse_parent() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.project_id is not null
     and (select p.org_id from public.projects p where p.id = new.project_id) is distinct from new.org_id then
    raise exception 'STK_NOT_FOUND: the project is not in your organisation' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.check_stock_item_parent(), public.check_stock_warehouse_parent() from public, anon, authenticated;
create trigger stock_items_zz_check_parent      before insert or update on public.stock_items      for each row execute function public.check_stock_item_parent();
create trigger stock_warehouses_zz_check_parent before insert or update on public.stock_warehouses for each row execute function public.check_stock_warehouse_parent();

-- §4 RLS + grants -------------------------------------------------------------------------------------------
-- ⚑ Every policy names is_active_member() literally (0203 AC-AMC-001 reads the policy text; the helpers repeat it by design).
do $$
declare t text;
begin
  foreach t in array array['stock_units','stock_items','stock_warehouses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %1$s_select on public.%1$I for select using (org_id = public.auth_org_id() and public.is_active_member())$p$, t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert with check (org_id = public.auth_org_id() and public.is_active_member() and public.stock_master_writer())$p$, t);
    execute format($p$create policy %1$s_update on public.%1$I for update using (org_id = public.auth_org_id() and public.is_active_member() and public.stock_master_writer())
                      with check (org_id = public.auth_org_id() and public.is_active_member() and public.stock_master_writer())$p$, t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete using (org_id = public.auth_org_id() and public.is_active_member() and public.stock_admin())$p$, t);
    execute format('revoke all on public.%I from authenticated, anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant delete on public.%I to authenticated', t);   -- Admin only by policy; FK 23503 blocks a referenced row
  end loop;
end $$;
grant insert (id, code, name, whole_only)                                  on public.stock_units      to authenticated;
grant update (code, name, whole_only, archived_at)                         on public.stock_units      to authenticated;
grant insert (id, code, name, description, unit_id, lead_time_days)        on public.stock_items      to authenticated;
grant update (code, name, description, unit_id, lead_time_days, archived_at) on public.stock_items    to authenticated;
grant insert (id, code, name, kind, project_id)                            on public.stock_warehouses to authenticated;
grant update (code, name, kind, project_id, archived_at)                   on public.stock_warehouses to authenticated;

alter table public.stock_warehouse_keepers enable row level security;
alter table public.stock_warehouse_keepers force row level security;
create policy stock_warehouse_keepers_select on public.stock_warehouse_keepers for select
  using (org_id = public.auth_org_id() and public.is_active_member());
revoke all on public.stock_warehouse_keepers from authenticated, anon;
grant select on public.stock_warehouse_keepers to authenticated;      -- NO write grant: set_stock_warehouse_keeper only

-- §5 audit (FR-STK-066). One definer trigger function; log_audit is not client-executable (0076).
create or replace function public.audit_stock_master() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_row record; v_action text; v_detail jsonb;
begin
  if tg_op = 'DELETE' then v_row := old; v_action := 'delete';
  elsif tg_op = 'INSERT' then v_row := new; v_action := 'create';
  else
    v_row := new;
    v_action := case when old.archived_at is null and new.archived_at is not null then 'archive'
                     when old.archived_at is not null and new.archived_at is null then 'restore'
                     else 'update' end;
  end if;
  v_detail := jsonb_build_object('code', v_row.code, 'name', v_row.name);
  if tg_op = 'UPDATE' then       -- what changed, old and new (created_at never changes; the rest is the audit value)
    v_detail := v_detail || jsonb_build_object('changed', coalesce((
      select jsonb_object_agg(k, jsonb_build_object('old', to_jsonb(old) -> k, 'new', to_jsonb(new) -> k))
        from jsonb_object_keys(to_jsonb(new)) k where to_jsonb(new) -> k is distinct from to_jsonb(old) -> k), '{}'::jsonb));
  end if;
  perform public.log_audit('stock.' || tg_argv[0] || '.' || v_action, v_row.org_id, auth.uid(), v_row.id, v_detail);
  return null;
end $$;
revoke all on function public.audit_stock_master() from public, anon, authenticated;
create trigger stock_units_audit      after insert or update or delete on public.stock_units      for each row execute function public.audit_stock_master('unit');
create trigger stock_items_audit      after insert or update or delete on public.stock_items      for each row execute function public.audit_stock_master('item');
create trigger stock_warehouses_audit after insert or update or delete on public.stock_warehouses for each row execute function public.audit_stock_master('warehouse');

-- §6 keeper assignment (FR-STK-004, FR-STK-007: Admin only). Definer: the table has no client write grant.
create or replace function public.set_stock_warehouse_keeper(p_warehouse_id uuid, p_user_id uuid, p_assigned boolean)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_admin boolean; v_n integer;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_admin := coalesce(public.role_rank(public.auth_role()) >= 50, false);   -- mut:admin_only
  if not v_admin then
    raise exception 'only an Admin assigns warehouse keepers' using errcode = '42501';
  end if;
  if p_warehouse_id is null or p_user_id is null or p_assigned is null then
    raise exception 'STK_INVALID: warehouse, user and assigned are required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.stock_warehouses w where w.id = p_warehouse_id and w.org_id = v_org) then
    raise exception 'STK_NOT_FOUND: the warehouse is not in your organisation' using errcode = 'P0001';
  end if;
  if p_assigned then
    if exists (select 1 from public.stock_warehouses w where w.id = p_warehouse_id and w.archived_at is not null) then
      raise exception 'STK_ARCHIVED: the warehouse is archived' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.profiles pr where pr.id = p_user_id and pr.org_id = v_org and pr.status = 'active') then
      raise exception 'STK_NOT_FOUND: the user is not an active member of your organisation' using errcode = 'P0001';
    end if;
    insert into public.stock_warehouse_keepers (org_id, warehouse_id, user_id, created_by)
      values (v_org, p_warehouse_id, p_user_id, auth.uid()) on conflict do nothing;
  else
    delete from public.stock_warehouse_keepers where warehouse_id = p_warehouse_id and user_id = p_user_id and org_id = v_org;
  end if;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public.log_audit(case when p_assigned then 'stock.keeper.assign' else 'stock.keeper.remove' end,
      v_org, auth.uid(), p_warehouse_id, jsonb_build_object('user_id', p_user_id));
  end if;
end $$;
revoke all on function public.set_stock_warehouse_keeper(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_stock_warehouse_keeper(uuid, uuid, boolean) to authenticated;
