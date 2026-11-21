-- 1346_procurement_line_planning.sql — a category and a needed-by date on each purchase request line.
-- FR-PLP-005..007, FR-PLP-011, AC-PLP-004..007 (docs/specs/purchase-line-category-needed-by.spec.md); #2696.
-- Rollback: supabase/migrations/rollback/1346_procurement_line_planning_down.sql
--
-- create_procurement_with_items is deliberately NOT touched here; the two fields are written by set_procurement_line_planning.
-- Both columns are nullable and stay NULL for every existing line.

alter table public.procurement_items
  add column category_id uuid,
  add column needed_by date,
  add constraint procurement_items_category_fk
    foreign key (org_id, category_id) references public.purchase_line_categories (org_id, id);
create index procurement_items_category_idx on public.procurement_items (category_id) where category_id is not null;

-- Server guard for every write path (RPC, direct write, service role): a value needs the setting ON for the line's organisation,
-- a Draft case when the value changes, and an active category when the category changes.
create function public.procurement_items_planning_guard() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_on boolean; v_status public.procurement_status;
begin
  if tg_op = 'UPDATE'
     and new.category_id is not distinct from old.category_id
     and new.needed_by is not distinct from old.needed_by then
    return new;
  end if;
  if new.category_id is null and new.needed_by is null then
    -- clearing is allowed only on a Draft (the values are frozen after submit)
    if tg_op = 'UPDATE' then
      select status into v_status from public.procurements where id = new.procurement_id;
      if v_status is distinct from 'Draft' then
        raise exception 'Line planning is read-only for this request' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  select purchase_line_planning into v_on from public.organizations where id = new.org_id;
  if not coalesce(v_on, false) then
    raise exception 'Line planning is not turned on' using errcode = '42501';
  end if;
  select status into v_status from public.procurements where id = new.procurement_id;
  if tg_op = 'UPDATE' and v_status is distinct from 'Draft' then
    raise exception 'Line planning is read-only for this request' using errcode = '42501';
  end if;
  if new.category_id is not null and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id)
     and not exists (select 1 from public.purchase_line_categories c
                      where c.id = new.category_id and c.org_id = new.org_id and c.archived_at is null) then
    raise exception 'Line category is not available' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.procurement_items_planning_guard() from public, anon, authenticated;
create trigger procurement_items_zz_planning_guard before insert or update on public.procurement_items
  for each row execute function public.procurement_items_planning_guard();

-- The line write path: the caller may edit this Draft's lines (procurement_item_values_editable, 0393) and the setting is ON.
create function public.set_procurement_line_planning(p_item uuid, p_category uuid, p_needed_by date) returns boolean
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_case uuid;
begin
  if auth.uid() is null or v_org is null or not coalesce(public.is_active_member(), false) then
    raise exception 'Line planning is not permitted' using errcode = '42501';
  end if;
  select procurement_id into v_case from public.procurement_items where id = p_item and org_id = v_org;
  if v_case is null
     or not coalesce((select o.purchase_line_planning from public.organizations o where o.id = v_org), false)
     or not coalesce(public.procurement_item_values_editable(v_case), false) then
    raise exception 'Line planning is not permitted' using errcode = '42501';
  end if;
  if p_category is not null and not exists (
       select 1 from public.purchase_line_categories c where c.id = p_category and c.org_id = v_org and c.archived_at is null) then
    raise exception 'Category is not available' using errcode = '42501';
  end if;
  update public.procurement_items set category_id = p_category, needed_by = p_needed_by
   where id = p_item and org_id = v_org;
  return true;
end $$;
revoke all on function public.set_procurement_line_planning(uuid, uuid, date) from public, anon;
grant execute on function public.set_procurement_line_planning(uuid, uuid, date) to authenticated;
