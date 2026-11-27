drop trigger owner_material_seed_scale on public.organizations;
drop trigger owner_material_requisition_parent on public.client_requisition_lines;
drop trigger owner_material_movement_parent on public.owner_material_movement_links;
drop function public.om_material_seed_scale();
drop function public.om_material_check_parent();
drop function public.om_material_import(text,integer,jsonb,boolean);
drop function public.om_material_set_scale(jsonb);
drop function public.om_material_set_reconciliation(uuid,uuid,text);
drop function public.om_material_section_rollup(uuid);
drop function public.om_material_lines(uuid,uuid,integer,integer);
drop function public.om_material_rollup(uuid,integer,integer,uuid);
drop function public.om_material_config();
drop view public.owner_material_stage_totals;

create or replace function public.guard_section_material_plan() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.work_order_section_material_plan := case when tg_op = 'DELETE' then old else new end;
  v_org uuid; v_status public.work_order_status; v_archived timestamptz;
  v_plan numeric; v_others numeric;
begin
  select w.org_id, w.status into v_org, v_status from public.work_orders w where w.id = v_row.work_order_id;
  if v_org is null or v_org is distinct from v_row.org_id then
    raise exception 'WOS_WO: the work order is not in your organisation' using errcode = '23514'; end if;
  if v_status = 'Cancelled' then
    raise exception 'WOS_CANCELLED: a cancelled work order''s plan is frozen' using errcode = '23514'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and (new.work_order_id is distinct from old.work_order_id or new.section_id is distinct from old.section_id
                           or new.item_id is distinct from old.item_id or new.org_id is distinct from old.org_id) then
    raise exception 'WOS_KEY: an allocation keeps its work order, section and item' using errcode = '23514'; end if;
  if v_status not in ('Draft', 'Issued') then
    raise exception 'WOS_STATUS: a closed work order takes no allocation changes' using errcode = '23514'; end if;
  select s.archived_at into v_archived from public.work_order_sections s where s.id = new.section_id;
  if v_archived is not null then
    raise exception 'WOS_SECTION_ARCHIVED: an archived section takes no allocation' using errcode = '23514'; end if;
  if not exists (select 1 from public.stock_items i where i.id = new.item_id and i.org_id = new.org_id
                  and (i.archived_at is null or tg_op = 'UPDATE')) then
    raise exception 'WOS_ITEM: the item is not a live stock item of this organisation' using errcode = '23514'; end if;
  -- Serialize allocations of one item on one work order before summing, so two writers cannot both fit.
  perform pg_advisory_xact_lock(hashtextextended('wos-alloc:' || new.work_order_id::text || ':' || new.item_id::text, 0));
  v_plan := public.mrq_plan_quantity(new.work_order_id, new.item_id);
  select coalesce(sum(a.quantity), 0) into v_others from public.work_order_section_material_plan a
   where a.work_order_id = new.work_order_id and a.item_id = new.item_id and a.id is distinct from new.id;
  if v_others + new.quantity > v_plan then                                                               -- mut:alloc_cap
    raise exception 'WOS_ALLOCATION_CAP: the allocations would be % against a work-order plan of %', v_others + new.quantity, v_plan
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now(); end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
