-- 0975_org_terminology.sql — an organisation renames PMO's fixed set of terms (#2529, map #2516).
-- One row per (org, term, language): the display name in singular and plural. Absence = the
-- shipped default. Read: every active member (the labels render on every screen). Write: Admin only,
-- enforced by RLS. org_id is stamped by trigger, never sent by the client.
-- Reversal: supabase/migrations/rollback/0975_org_terminology_down.sql

create table public.org_terminology (
  org_id     uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  term_key   text not null check (term_key in ('workOrder','project','clientSuppliedStock','purchaseRequest','discipline')),
  locale     text not null check (locale in ('en','id')),
  singular   text not null check (char_length(btrim(singular)) between 1 and 60),
  plural     text not null check (char_length(btrim(plural)) between 1 and 60),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) default auth.uid(),
  primary key (org_id, term_key, locale)
);

alter table public.org_terminology enable row level security;
alter table public.org_terminology force row level security;

create policy org_terminology_select on public.org_terminology for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

create policy org_terminology_insert on public.org_terminology for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and (select public.auth_role()) = 'Admin');
create policy org_terminology_update on public.org_terminology for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) = 'Admin')
  with check (org_id = (select public.auth_org_id()) and (select public.auth_role()) = 'Admin');
create policy org_terminology_delete on public.org_terminology for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) = 'Admin');

create trigger org_terminology_stamp_org_id before insert on public.org_terminology
  for each row execute function public.stamp_org_id();

grant select, insert, update, delete on public.org_terminology to authenticated;
grant all on public.org_terminology to service_role;
