-- 1382_work_order_areas_groups.sql — #2668: the organisation's own lists of work-order areas and groups.
-- Spec: docs/specs/work-order-area-group.spec.md (FR-WAG-001/002). Proven by supabase/tests/2668_work_order_area_group.test.sql.
-- Nothing is coded: the entries are the client's data, kept by an Admin, soft-archived.
-- ── REVERSE (also supabase/migrations/rollback/1382_work_order_areas_groups_down.sql) ─────────────────
--   drop table if exists public.work_order_groups; drop table if exists public.work_order_areas;  (1383 first)

create table public.work_order_areas (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  code        text not null check (char_length(btrim(code)) between 1 and 20),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  -- the target of work_orders' composite foreign key: a work order can only name an entry of its own org
  constraint work_order_areas_org_id_id_key unique (org_id, id)
);
create unique index work_order_areas_code_live on public.work_order_areas (org_id, lower(btrim(code))) where archived_at is null;
create index work_order_areas_org_idx on public.work_order_areas (org_id, name);
create trigger work_order_areas_stamp_org_id before insert on public.work_order_areas
  for each row execute function public.stamp_org_id();

alter table public.work_order_areas enable row level security;
alter table public.work_order_areas force row level security;

-- Every active member reads the list (the work-order list and form need it).
create policy work_order_areas_select on public.work_order_areas for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
-- An Admin keeps the list. Soft-archive (ADR-0018); a referenced row FK-blocks a delete (23503).
create policy work_order_areas_insert on public.work_order_areas for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
create policy work_order_areas_update on public.work_order_areas for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (org_id = (select public.auth_org_id()));
create policy work_order_areas_delete on public.work_order_areas for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');

revoke all on public.work_order_areas from public, anon, authenticated;
grant select, delete on public.work_order_areas to authenticated;
grant insert (code, name) on public.work_order_areas to authenticated;
grant update (code, name, archived_at) on public.work_order_areas to authenticated;
grant all on public.work_order_areas to service_role;

create table public.work_order_groups (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  code        text not null check (char_length(btrim(code)) between 1 and 20),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  -- the target of work_orders' composite foreign key: a work order can only name an entry of its own org
  constraint work_order_groups_org_id_id_key unique (org_id, id)
);
create unique index work_order_groups_code_live on public.work_order_groups (org_id, lower(btrim(code))) where archived_at is null;
create index work_order_groups_org_idx on public.work_order_groups (org_id, name);
create trigger work_order_groups_stamp_org_id before insert on public.work_order_groups
  for each row execute function public.stamp_org_id();

alter table public.work_order_groups enable row level security;
alter table public.work_order_groups force row level security;

-- Every active member reads the list (the work-order list and form need it).
create policy work_order_groups_select on public.work_order_groups for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
-- An Admin keeps the list. Soft-archive (ADR-0018); a referenced row FK-blocks a delete (23503).
create policy work_order_groups_insert on public.work_order_groups for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
create policy work_order_groups_update on public.work_order_groups for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (org_id = (select public.auth_org_id()));
create policy work_order_groups_delete on public.work_order_groups for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');

revoke all on public.work_order_groups from public, anon, authenticated;
grant select, delete on public.work_order_groups to authenticated;
grant insert (code, name) on public.work_order_groups to authenticated;
grant update (code, name, archived_at) on public.work_order_groups to authenticated;
grant all on public.work_order_groups to service_role;
