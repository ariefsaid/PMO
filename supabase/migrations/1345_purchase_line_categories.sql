-- 1345_purchase_line_categories.sql — the organisation setting and the client-controlled category list for purchase request lines.
-- FR-PLP-001..004, AC-PLP-001..003 (docs/specs/purchase-line-category-needed-by.spec.md); #2696.
-- Rollback: supabase/migrations/rollback/1345_purchase_line_categories_down.sql
--
-- Default OFF: organizations.purchase_line_planning is false for every organisation, and the list is empty until an Admin turns the
-- setting on (the setter then seeds two general starter rows, idempotently). Code never branches on a category name.

alter table public.organizations add column purchase_line_planning boolean not null default false;
comment on column public.organizations.purchase_line_planning is
  'FR-PLP-004 purchase request lines carry a category and a needed-by date; default OFF. Written only by set_purchase_line_planning().';

create table public.purchase_line_categories (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  name        text not null check (btrim(name) <> '' and length(name) <= 60),
  position    integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (org_id, id)
);
create unique index purchase_line_categories_name_idx
  on public.purchase_line_categories (org_id, lower(btrim(name))) where archived_at is null;
create index purchase_line_categories_org_idx on public.purchase_line_categories (org_id, position);

alter table public.purchase_line_categories enable row level security;
alter table public.purchase_line_categories force row level security;
revoke all on public.purchase_line_categories from public, anon, authenticated;
grant select on public.purchase_line_categories to authenticated;
grant all on public.purchase_line_categories to service_role;
create policy purchase_line_categories_select on public.purchase_line_categories for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

create function public.get_purchase_line_planning() returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select o.purchase_line_planning from public.organizations o
   where o.id = public.auth_org_id() and public.is_active_member()
$$;
revoke all on function public.get_purchase_line_planning() from public, anon;
grant execute on function public.get_purchase_line_planning() to authenticated;

create function public.set_purchase_line_planning(p_enabled boolean) returns boolean
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_old boolean;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'Only an Admin can change purchase rules.' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'The setting is on or off.' using errcode = '22023';
  end if;
  select purchase_line_planning into v_old from public.organizations where id = v_org for update;
  update public.organizations set purchase_line_planning = p_enabled where id = v_org;
  -- Starter rows only when the organisation has no category at all (idempotent; never after an Admin has edited the list).
  if p_enabled and not exists (select 1 from public.purchase_line_categories where org_id = v_org) then
    insert into public.purchase_line_categories (org_id, name, position) values (v_org, 'Project', 1), (v_org, 'Overhead', 2);
  end if;
  perform public.log_audit('organization.purchase_line_planning', v_org, auth.uid(), v_org,
    jsonb_build_object('from', v_old, 'to', p_enabled));
  return p_enabled;
end $$;
revoke all on function public.set_purchase_line_planning(boolean) from public, anon;
grant execute on function public.set_purchase_line_planning(boolean) to authenticated;

-- Add (p_id null) or rename / reorder (p_id given) a category. Admin only.
create function public.set_purchase_line_category(p_id uuid, p_name text, p_position integer) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'Only an Admin can change purchase rules.' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 60 then
    raise exception 'A category name is 1 to 60 characters.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.purchase_line_categories (org_id, name, position)
    values (v_org, v_name, coalesce(p_position, (select coalesce(max(position), 0) + 1 from public.purchase_line_categories where org_id = v_org)))
    returning id into v_id;
  else
    update public.purchase_line_categories
       set name = v_name, position = coalesce(p_position, position)
     where id = p_id and org_id = v_org and archived_at is null
    returning id into v_id;
    if v_id is null then
      raise exception 'Category is not available' using errcode = '42501';
    end if;
  end if;
  perform public.log_audit('organization.purchase_line_category', v_id, auth.uid(), v_org,
    jsonb_build_object('name', v_name, 'position', p_position));
  return v_id;
end $$;
revoke all on function public.set_purchase_line_category(uuid, text, integer) from public, anon;
grant execute on function public.set_purchase_line_category(uuid, text, integer) to authenticated;

create function public.archive_purchase_line_category(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_id uuid;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'Only an Admin can change purchase rules.' using errcode = '42501';
  end if;
  update public.purchase_line_categories set archived_at = now()
   where id = p_id and org_id = v_org and archived_at is null returning id into v_id;
  if v_id is null then
    raise exception 'Category is not available' using errcode = '42501';
  end if;
  perform public.log_audit('organization.purchase_line_category_retired', v_id, auth.uid(), v_org, '{}'::jsonb);
  return true;
end $$;
revoke all on function public.archive_purchase_line_category(uuid) from public, anon;
grant execute on function public.archive_purchase_line_category(uuid) to authenticated;
