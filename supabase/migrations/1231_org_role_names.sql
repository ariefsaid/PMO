-- 1231_org_role_names.sql — an organisation renames its built-in roles (#2712, map #2516).
-- One row per (org, role key, language). Absence = the catalogue default name (built_in_roles.name_en/name_id).
-- DISPLAY only: keys, profiles.role and enum values never change. Read: every active member of the org.
-- Write: Admin only, enforced by RLS. org_id is stamped by trigger, never sent by the client.
-- Reversal: supabase/migrations/rollback/1231_org_role_names_down.sql

create table public.org_role_names (
  org_id     uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  role_key   text not null references public.built_in_roles(key),
  locale     text not null check (locale in ('en','id')),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) default auth.uid(),
  primary key (org_id, role_key, locale)
);

alter table public.org_role_names enable row level security;
alter table public.org_role_names force row level security;

create policy org_role_names_select on public.org_role_names for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy org_role_names_insert on public.org_role_names for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and (select public.auth_role()) = 'Admin');
create policy org_role_names_update on public.org_role_names for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) = 'Admin')
  with check (org_id = (select public.auth_org_id()) and (select public.auth_role()) = 'Admin');
create policy org_role_names_delete on public.org_role_names for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) = 'Admin');

create trigger org_role_names_stamp_org_id before insert on public.org_role_names
  for each row execute function public.stamp_org_id();

grant select, insert, update, delete on public.org_role_names to authenticated;
grant all on public.org_role_names to service_role;

comment on table public.org_role_names is
  'Per-organisation display names for the built-in roles (#2712). Display only; absence = catalogue default.';
