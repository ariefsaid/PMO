-- 1235_clearance_items.sql — #2707 (map #2516): the cleared-for-site checklist, part 1.
-- Spec docs/specs/cleared-for-site-checklist.spec.md. The organisation defines its own checklist items; none are shipped.
-- The whole feature is OFF until an Admin turns on organizations.clearance_checklist_enabled (default false), so an existing
-- organisation sees nothing new. Reverse: rollback/1235_clearance_items_down.sql.

alter table public.organizations add column clearance_checklist_enabled boolean not null default false;
comment on column public.organizations.clearance_checklist_enabled is
  '#2707: when true, Administration shows the cleared-for-site checklist (items + per-person state). Default false = no change for existing organisations.';
-- Admin-only write rides the existing organizations_update_project_number_pattern policy (0231); only this column is granted here.
grant update (clearance_checklist_enabled) on public.organizations to authenticated;

create table public.clearance_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  is_required boolean not null default true,
  sort_order  integer not null default 0 check (sort_order between 0 and 100000),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, org_id)
);
create unique index clearance_items_name_live on public.clearance_items (org_id, lower(btrim(name))) where archived_at is null;
create trigger clearance_items_stamp_org_id before insert on public.clearance_items for each row execute function public.stamp_org_id();

alter table public.clearance_items enable row level security;
alter table public.clearance_items force row level security;

-- Read: the roles that read people. Define items: Admin only.
create policy clearance_items_select on public.clearance_items for select using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and (select public.auth_role()) in ('Admin','Project Manager','Finance','Executive'));
create policy clearance_items_insert on public.clearance_items for insert with check (
  org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
create policy clearance_items_update on public.clearance_items for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (org_id = (select public.auth_org_id()));

revoke all on public.clearance_items from public, anon, authenticated;
grant select on public.clearance_items to authenticated;
grant insert (name, is_required, sort_order) on public.clearance_items to authenticated;
grant update (name, is_required, sort_order, archived_at) on public.clearance_items to authenticated;
