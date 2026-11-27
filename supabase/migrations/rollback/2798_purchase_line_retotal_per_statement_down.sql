-- Reverse 2798: restore the per-row total roll-up (0284) and per-row work-order copy (1883) triggers and function bodies.
drop trigger if exists procurement_items_sync_total_ins on public.procurement_items;
drop trigger if exists procurement_items_sync_total_upd on public.procurement_items;
drop trigger if exists procurement_items_sync_total_del on public.procurement_items;
drop trigger if exists zz_copy_line_work_order_to_header_ins on public.procurement_items;
drop trigger if exists zz_copy_line_work_order_to_header_del on public.procurement_items;
drop trigger if exists zz_copy_line_work_order_to_header_1_upd_cols on public.procurement_items;
drop trigger if exists zz_copy_line_work_order_to_header_2_upd on public.procurement_items;
drop function if exists public.mark_line_work_order_set();

create or replace function public.sync_procurement_item_total() returns trigger
  language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_id uuid;
begin
  if tg_op in ('UPDATE','DELETE') then
    v_id := old.procurement_id;
    update public.procurements p
       set total_value = s.line_total, updated_at = now()
      from (select sum(i.amount) as line_total from public.procurement_items i where i.procurement_id = v_id) s
     where p.id = v_id and p.status in ('Draft','Rejected') and s.line_total is not null;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    v_id := new.procurement_id;
    update public.procurements p
       set total_value = s.line_total, updated_at = now()
      from (select sum(i.amount) as line_total from public.procurement_items i where i.procurement_id = v_id) s
     where p.id = v_id and p.status in ('Draft','Rejected') and s.line_total is not null;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
revoke all on function public.sync_procurement_item_total() from public, anon, authenticated;
create trigger procurement_items_sync_total
  after insert or update or delete on public.procurement_items
  for each row execute function public.sync_procurement_item_total();

create or replace function public.copy_line_work_order_to_header() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_case uuid := case when tg_op = 'DELETE' then old.procurement_id else new.procurement_id end;
  v_lines int; v_named int; v_distinct int; v_wo uuid;
begin
  select count(*), count(i.work_order_id), count(distinct i.work_order_id), min(i.work_order_id::text)::uuid
    into v_lines, v_named, v_distinct, v_wo
    from public.procurement_items i where i.procurement_id = v_case;
  if v_lines > 0 and v_named = v_lines and v_distinct = 1                                   -- mut:copy_all_same
     and exists (select 1 from public.work_orders w where w.id = v_wo and w.status <> 'Cancelled')
     and exists (select 1 from public.procurements p where p.id = v_case and p.status in ('Draft', 'Rejected')) then   -- mut:copy_before_submit
    update public.procurements set work_order_id = v_wo where id = v_case and work_order_id is distinct from v_wo;
  end if;
  return null;
end $$;
revoke all on function public.copy_line_work_order_to_header() from public, anon, authenticated;
create trigger zz_copy_line_work_order_to_header after insert or delete or update of work_order_id on public.procurement_items
  for each row execute function public.copy_line_work_order_to_header();
