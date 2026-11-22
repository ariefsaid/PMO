-- 1883_line_work_order_copied_to_header.sql — FR-WPL-005, AC-WPL-005..006. When every line of a purchase names the SAME work order,
-- that work order becomes the purchase header's work order (1580's procurements.work_order_id), so the request and order records the
-- header stamps (and every cost read, which resolves a record's work order) behave as if the person had set the header. Lines that
-- differ, or any line without a work order, leave the header exactly as it is (the person may still set it by hand). Nothing else moves:
-- no cost read is restated and the line value is never summed. A cancelled work order is never copied (the header rule refuses a newly
-- named cancelled one, and a harmless edit must not be blocked by it). The header write goes through check_cost_attribution like any other.
-- Proven by supabase/tests/1883_line_work_order_copied_to_header.test.sql (mutation check in its header).
-- Reverse: rollback/1883_line_work_order_copied_to_header_down.sql (a header already copied keeps its value).
create function public.copy_line_work_order_to_header() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_case uuid := case when tg_op = 'DELETE' then old.procurement_id else new.procurement_id end;
  v_lines int; v_named int; v_distinct int; v_wo uuid;
begin
  select count(*), count(i.work_order_id), count(distinct i.work_order_id), min(i.work_order_id::text)::uuid
    into v_lines, v_named, v_distinct, v_wo
    from public.procurement_items i where i.procurement_id = v_case;
  if v_lines > 0 and v_named = v_lines and v_distinct = 1                                   -- mut:copy_all_same
     and exists (select 1 from public.work_orders w where w.id = v_wo and w.status <> 'Cancelled') then
    update public.procurements set work_order_id = v_wo where id = v_case and work_order_id is distinct from v_wo;
  end if;
  return null;
end $$;
revoke all on function public.copy_line_work_order_to_header() from public, anon, authenticated;
create trigger zz_copy_line_work_order_to_header after insert or delete or update of work_order_id on public.procurement_items
  for each row execute function public.copy_line_work_order_to_header();
