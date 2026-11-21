-- 1167_document_category_management.sql — #2579 step 4 of 5: the Admin management functions (FR-DCV-003..006, 009, AC-DCV-008..012, 023).
-- Every write to document_categories / document_category_roles goes through these (no client write grant). Each is SECURITY DEFINER,
-- re-asserts active membership and the Admin role, and takes the organisation from the caller, never from an argument.
-- Changes are recorded in audit_events (actor, time, old and new), readable by an Admin or an operator.

create or replace function public.assert_document_category_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin manages document categories' using errcode = '42501';
  end if;
  return public.auth_org_id();
end $$;
revoke all on function public.assert_document_category_admin() from public, anon, authenticated;

create or replace function public.create_document_category(p_name text, p_roles public.user_role[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.assert_document_category_admin();
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
  v_roles public.user_role[];
begin
  perform public.assert_is_active_member();
  if v_name = '' or length(v_name) > 120 then
    raise exception 'Enter a category name' using errcode = '22023', detail = 'category-name';
  end if;
  if p_roles is null or coalesce(array_length(p_roles, 1), 0) = 0 then
    raise exception 'Choose who can see this category' using errcode = '22023', detail = 'category-roles-required';
  end if;
  if exists (select 1 from public.document_categories c where c.org_id = v_org and c.archived_at is null and lower(c.name) = lower(v_name)) then
    raise exception 'A category with this name already exists' using errcode = '23505', detail = 'category-name-taken';
  end if;
  v_roles := array(select distinct r from unnest(p_roles || array['Admin'::public.user_role]) r);
  insert into public.document_categories (org_id, name, sort_order)
    values (v_org, v_name, coalesce((select max(sort_order) from public.document_categories where org_id = v_org), 0) + 10)
    returning id into v_id;
  insert into public.document_category_roles (category_id, org_id, role) select v_id, v_org, r from unnest(v_roles) r;
  perform public.log_audit('document_category.create', v_org, auth.uid(), v_id,
    jsonb_build_object('name', v_name, 'roles', to_jsonb(v_roles)));
  return v_id;
end $$;

create or replace function public.rename_document_category(p_id uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.assert_document_category_admin();
  v_name text := btrim(coalesce(p_name, ''));
  v_cat  public.document_categories%rowtype;
begin
  perform public.assert_is_active_member();
  select * into v_cat from public.document_categories where id = p_id and org_id = v_org for update;
  if not found then raise exception 'category not found' using errcode = 'P0002'; end if;
  if v_cat.is_system then raise exception 'A system category cannot be renamed' using errcode = '42501', detail = 'category-system'; end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'Enter a category name' using errcode = '22023', detail = 'category-name';
  end if;
  if v_name = v_cat.name then return; end if;
  if v_cat.archived_at is null and exists (select 1 from public.document_categories c
        where c.org_id = v_org and c.archived_at is null and c.id <> p_id and lower(c.name) = lower(v_name)) then
    raise exception 'A category with this name already exists' using errcode = '23505', detail = 'category-name-taken';
  end if;
  update public.document_categories set name = v_name where id = p_id;
  -- the register keeps the category's current name on every document, in this same transaction (AC-DCV-023)
  update public.project_documents set category = v_name where category_id = p_id and org_id = v_org;
  perform public.log_audit('document_category.rename', v_org, auth.uid(), p_id,
    jsonb_build_object('from_name', v_cat.name, 'to_name', v_name));
end $$;

create or replace function public.set_document_category_roles(p_id uuid, p_roles public.user_role[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.assert_document_category_admin();
  v_old public.user_role[];
  v_new public.user_role[];
begin
  perform public.assert_is_active_member();
  perform 1 from public.document_categories where id = p_id and org_id = v_org for update;
  if not found then raise exception 'category not found' using errcode = 'P0002'; end if;
  if p_roles is null or not ('Admin'::public.user_role = any (p_roles)) then
    raise exception 'Admin always sees every category' using errcode = '23514', detail = 'category-admin-required';
  end if;
  v_new := array(select distinct r from unnest(p_roles) r order by r);
  v_old := array(select r.role from public.document_category_roles r where r.category_id = p_id order by r.role);
  delete from public.document_category_roles where category_id = p_id and org_id = v_org and role <> all (v_new);
  insert into public.document_category_roles (category_id, org_id, role) select p_id, v_org, r from unnest(v_new) r
    on conflict do nothing;
  perform public.log_audit('document_category.roles', v_org, auth.uid(), p_id,
    jsonb_build_object('from_roles', to_jsonb(v_old), 'to_roles', to_jsonb(v_new)));
end $$;

create or replace function public.archive_document_category(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.assert_document_category_admin();
  v_cat public.document_categories%rowtype;
begin
  perform public.assert_is_active_member();
  select * into v_cat from public.document_categories where id = p_id and org_id = v_org for update;
  if not found then raise exception 'category not found' using errcode = 'P0002'; end if;
  if v_cat.is_system then raise exception 'A system category cannot be archived' using errcode = '42501', detail = 'category-system'; end if;
  if v_cat.archived_at is not null then return; end if;
  update public.document_categories set archived_at = now() where id = p_id;
  perform public.log_audit('document_category.archive', v_org, auth.uid(), p_id, jsonb_build_object('name', v_cat.name));
end $$;

create or replace function public.restore_document_category(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.assert_document_category_admin();
  v_cat public.document_categories%rowtype;
begin
  perform public.assert_is_active_member();
  select * into v_cat from public.document_categories where id = p_id and org_id = v_org for update;
  if not found then raise exception 'category not found' using errcode = 'P0002'; end if;
  if v_cat.archived_at is null then return; end if;
  if exists (select 1 from public.document_categories c
        where c.org_id = v_org and c.archived_at is null and lower(c.name) = lower(v_cat.name)) then
    raise exception 'A category with this name already exists' using errcode = '23505', detail = 'category-name-taken';
  end if;
  update public.document_categories set archived_at = null where id = p_id;
  perform public.log_audit('document_category.restore', v_org, auth.uid(), p_id, jsonb_build_object('name', v_cat.name));
end $$;

create or replace function public.reorder_document_categories(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.assert_document_category_admin();
  v_i   int;
begin
  perform public.assert_is_active_member();
  if p_ids is null then return; end if;
  if (select count(*) from public.document_categories where org_id = v_org and id = any (p_ids)) <> cardinality(p_ids) then
    raise exception 'category not found' using errcode = 'P0002';
  end if;
  for v_i in 1 .. cardinality(p_ids) loop
    update public.document_categories set sort_order = v_i * 10 where id = p_ids[v_i] and org_id = v_org;
  end loop;
end $$;

-- A revision lineage shares one category (OD-DCV-8): re-filing moves the whole lineage in one transaction, only by a caller who
-- may edit every revision and may see both categories. Any shortfall refuses the whole move and says nothing about why.
create or replace function public.refile_document_lineage(p_document_id uuid, p_category_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid := public.auth_org_id();
  v_role  public.user_role := public.auth_role();
  v_uid   uuid := auth.uid();
  v_root  uuid;
  v_ids   uuid[];
  v_cat   public.document_categories%rowtype;
  v_n     int;
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin', 'Executive', 'Project Manager', 'Finance') then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  select * into v_cat from public.document_categories where id = p_category_id and org_id = v_org and archived_at is null;
  if not found or not public.document_category_visible(v_cat.id, v_org) then
    raise exception 'Choose an available category' using errcode = '23514', detail = 'category-unavailable';
  end if;
  -- walk up to the first revision, then collect every descendant
  with recursive up as (
    select d.id, d.parent_document_id from public.project_documents d where d.id = p_document_id and d.org_id = v_org
    union
    select p.id, p.parent_document_id from public.project_documents p join up on p.id = up.parent_document_id and p.org_id = v_org
  ) select id into v_root from up where parent_document_id is null limit 1;
  if v_root is null then raise exception 'document not found' using errcode = 'P0002'; end if;
  with recursive down as (
    select d.id from public.project_documents d where d.id = v_root and d.org_id = v_org
    union
    select c.id from public.project_documents c join down on c.parent_document_id = down.id and c.org_id = v_org
  ) select array_agg(id) into v_ids from down;
  -- every revision: visible to the caller (old category) and editable by them (author or Admin, 0348)
  if exists (select 1 from public.project_documents d where d.id = any (v_ids)
              and (not public.document_category_visible(d.category_id, d.org_id)
                   or not (d.author_id is not distinct from v_uid or v_role = 'Admin'))) then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  update public.project_documents set category_id = p_category_id where id = any (v_ids) and category_id is distinct from p_category_id;
  get diagnostics v_n = row_count;
  perform public.log_audit('document_category.refile', v_org, v_uid, v_root,
    jsonb_build_object('to_category', v_cat.name, 'documents', to_jsonb(v_ids)));
  return v_n;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_document_category(text, public.user_role[])', 'rename_document_category(uuid, text)',
    'set_document_category_roles(uuid, public.user_role[])', 'archive_document_category(uuid)',
    'restore_document_category(uuid)', 'reorder_document_categories(uuid[])', 'refile_document_lineage(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
