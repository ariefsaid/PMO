-- Rollback of 2102: restore the 1346 line guard; drop the trigger, functions and columns.
create or replace function public.procurement_items_planning_guard() returns trigger
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
drop trigger if exists procurements_zz_needed_by on public.procurements;
drop function if exists public.guard_procurement_needed_by();
drop function if exists public.set_procurement_needed_by(uuid, date, jsonb);
drop function if exists public.po_needed_by_write_on();
alter table public.procurements drop column if exists needed_by;
drop function if exists public.set_po_needed_by_required(boolean);
drop function if exists public.po_needed_by_required_from_of(uuid);
alter table public.organizations drop column if exists po_needed_by_required_from;
