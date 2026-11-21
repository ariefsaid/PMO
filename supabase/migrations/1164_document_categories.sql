-- 1164_document_categories.sql — #2579 document categories with per-role visibility (spec docs/specs/document-category-visibility.spec.md).
-- Step 1 of 5: the two tables and the system seed. Nothing reads them yet; 1165 gives every register document a category
-- reference, 1166 enforces visibility, 1167 adds the Admin management functions, 1168 patches the two definers that read the register.
--
-- document_categories   one row per category per organisation (name, order, system flag, archive state).
-- document_category_roles  the viewer roles of a category (absence of a role = no access). Admin is always present.
-- Every write goes through the 1167 functions (no client write grant); reads are for any active member of the organisation
-- (category names are not sensitive, the documents are).

create table public.document_categories (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id) on delete cascade,
  name        text not null check (btrim(name) <> '' and length(name) <= 120),
  sort_order  integer not null default 0,
  is_system   boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (id, org_id)
);
-- a name is unique among the organisation's live categories, case-insensitively (FR-DCV-001)
create unique index document_categories_live_name_uniq on public.document_categories (org_id, lower(name)) where archived_at is null;

create table public.document_category_roles (
  category_id uuid not null,
  org_id      uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id) on delete cascade,
  role        public.user_role not null,
  primary key (category_id, role),
  foreign key (category_id, org_id) references public.document_categories (id, org_id) on delete cascade
);
create index document_category_roles_org_idx on public.document_category_roles (org_id, category_id);

create trigger document_categories_stamp_org_id before insert on public.document_categories
  for each row execute function public.stamp_org_id();
create trigger document_category_roles_stamp_org_id before insert on public.document_category_roles
  for each row execute function public.stamp_org_id();

do $$
declare t text;
begin
  foreach t in array array['document_categories', 'document_category_roles'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format($p$create policy %I on public.%I for select to authenticated
                      using (org_id = (select public.auth_org_id()) and (select public.is_active_member()))$p$, t || '_select', t);
  end loop;
end $$;

-- ── the system set (FR-DCV-001/002, OD-DCV-11): eight names, every role, seeded now and for every new organisation ────────
create or replace function public.seed_document_categories(p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_names text[] := array['Drawing', 'Specification', 'Report', 'Transmittal', 'Submittal', 'Certificate', 'Other', 'Reference'];
  v_i int;
  v_id uuid;
begin
  for v_i in 1 .. array_length(v_names, 1) loop
    select id into v_id from public.document_categories
      where org_id = p_org and lower(name) = lower(v_names[v_i]) and archived_at is null;
    if v_id is null then
      insert into public.document_categories (org_id, name, sort_order, is_system)
        values (p_org, v_names[v_i], v_i * 10, true) returning id into v_id;
    end if;
    insert into public.document_category_roles (category_id, org_id, role)
      select v_id, p_org, r from unnest(enum_range(null::public.user_role)) r
      on conflict do nothing;
  end loop;
end $$;
revoke all on function public.seed_document_categories(uuid) from public, anon, authenticated;

create or replace function public.seed_document_categories_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.seed_document_categories(new.id); return new; end $$;
revoke all on function public.seed_document_categories_trigger() from public, anon, authenticated;
create trigger organizations_seed_document_categories after insert on public.organizations
  for each row execute function public.seed_document_categories_trigger();

select public.seed_document_categories(id) from public.organizations;
