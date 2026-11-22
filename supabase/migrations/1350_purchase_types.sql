-- 1350_purchase_types.sql — #2697: the purchase types an organisation keeps, and the switch that turns them on. SCHEMA + ADMIN RPCs.
-- Spec docs/specs/purchase-type-rental-extension.spec.md (FR-PTR-001..004) · plan docs/plans/2026-11-21-purchase-type-rental-extension.md.
-- Proven by supabase/tests/purchase_types.test.sql. The procurement columns that use these rows are in 1351.
--
-- The list is DATA (OD-SCOPE-2): nothing in code compares a type's name. Behaviour hangs off `is_rental`.
-- Default off: an organisation has no settings row and no type rows until an Admin turns the feature on; turning it on
-- writes three general starter rows once (idempotent), which the Admin then renames, adds, retires or re-flags.
-- No client role holds INSERT/UPDATE/DELETE: every write goes through the security-definer RPCs below (ADR-0019).
-- REVERSE: rollback/1350_purchase_types_down.sql (after 1351's rollback; refused while types are in use).

create table public.org_purchase_type_settings (
  org_id     uuid primary key references public.organizations(id) on delete cascade default '00000000-0000-0000-0000-000000000001',
  enabled    boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table public.purchase_types (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade default '00000000-0000-0000-0000-000000000001',
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  name_id    text check (name_id is null or char_length(btrim(name_id)) between 1 and 60),
  is_rental  boolean not null default false,
  position   integer not null default 0 check (position between 0 and 1000),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index purchase_types_org_name_uq on public.purchase_types (org_id, lower(btrim(name)));
create index purchase_types_org_idx on public.purchase_types (org_id, position);

alter table public.org_purchase_type_settings enable row level security; alter table public.org_purchase_type_settings force row level security;
alter table public.purchase_types enable row level security;             alter table public.purchase_types force row level security;
create policy org_purchase_type_settings_select on public.org_purchase_type_settings for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy purchase_types_select on public.purchase_types for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.org_purchase_type_settings, public.purchase_types from public, anon, authenticated;
grant select on public.org_purchase_type_settings, public.purchase_types to authenticated;
grant all on public.org_purchase_type_settings, public.purchase_types to service_role;

-- Whether the feature is on for an org. Internal: the 1351 guard calls it; clients read the settings row.
create function public.purchase_types_enabled(p_org uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select enabled from public.org_purchase_type_settings where org_id = p_org), false)
$$;
revoke all on function public.purchase_types_enabled(uuid) from public, anon, authenticated;

-- Admin switch. Turning on seeds the three starter rows only when the org has no types at all, so a second call adds nothing.
create function public.set_purchase_types_enabled(p_enabled boolean) returns void
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.auth_org_id();
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'PTYPE_ADMIN_ONLY: only an Admin can change purchase types' using errcode = '42501';
  end if;
  if p_enabled is null then raise exception 'PTYPE_INVALID: enabled must be true or false' using errcode = '22023'; end if;
  insert into public.org_purchase_type_settings (org_id, enabled, updated_by, updated_at)
  values (v_org, p_enabled, auth.uid(), now())
  on conflict (org_id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();
  if p_enabled and not exists (select 1 from public.purchase_types where org_id = v_org) then
    insert into public.purchase_types (org_id, name, name_id, is_rental, position) values
      (v_org, 'Goods',   'Barang', false, 1),
      (v_org, 'Service', 'Jasa',   false, 2),
      (v_org, 'Rental',  'Sewa',   true,  3)
    on conflict do nothing;
  end if;
end $$;

-- Admin add / edit. p_id null adds. A type's rental flag cannot change while purchases use it (1351 relies on the flag).
create function public.upsert_purchase_type(p_id uuid, p_name text, p_name_id text, p_is_rental boolean, p_position integer)
  returns public.purchase_types language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.auth_org_id(); v_row public.purchase_types%rowtype;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'PTYPE_ADMIN_ONLY: only an Admin can change purchase types' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 or p_is_rental is null
     or (p_name_id is not null and char_length(btrim(p_name_id)) not between 1 and 60) then
    raise exception 'PTYPE_INVALID: a type needs a name of 1 to 60 characters' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.purchase_types (org_id, name, name_id, is_rental, position)
    values (v_org, btrim(p_name), nullif(btrim(p_name_id), ''), p_is_rental, coalesce(p_position, 0)) returning * into v_row;
  else
    select * into v_row from public.purchase_types where id = p_id and org_id = v_org for update;
    if not found then raise exception 'PTYPE_UNAVAILABLE: type not available' using errcode = '23503'; end if;
    if v_row.is_rental is distinct from p_is_rental
       and exists (select 1 from public.procurements where purchase_type_id = p_id) then   -- 1351 column
      raise exception 'PTYPE_IN_USE: purchases use this type; retire it and add a new one instead' using errcode = '23503';
    end if;
    update public.purchase_types set name = btrim(p_name), name_id = nullif(btrim(p_name_id), ''), is_rental = p_is_rental,
           position = coalesce(p_position, position) where id = p_id returning * into v_row;
  end if;
  return v_row;
end $$;

create function public.set_purchase_type_active(p_id uuid, p_active boolean) returns void
  language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'PTYPE_ADMIN_ONLY: only an Admin can change purchase types' using errcode = '42501';
  end if;
  update public.purchase_types set active = coalesce(p_active, active) where id = p_id and org_id = public.auth_org_id();
  if not found then raise exception 'PTYPE_UNAVAILABLE: type not available' using errcode = '23503'; end if;
end $$;
revoke all on function public.set_purchase_types_enabled(boolean), public.upsert_purchase_type(uuid,text,text,boolean,integer),
  public.set_purchase_type_active(uuid,boolean) from public, anon;
grant execute on function public.set_purchase_types_enabled(boolean), public.upsert_purchase_type(uuid,text,text,boolean,integer),
  public.set_purchase_type_active(uuid,boolean) to authenticated;
