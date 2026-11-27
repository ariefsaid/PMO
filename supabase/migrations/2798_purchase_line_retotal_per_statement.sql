-- 2798_purchase_line_retotal_per_statement.sql — speed only. Saving N purchase lines used to re-read every line of the purchase and
-- re-write the purchase header once per line (two full line scans per line: the total roll-up of 0284 and the work-order copy of 1883).
-- Both triggers now run once per statement over a transition table and re-total each touched purchase once. Same figures, same rules:
--   * total roll-up (procurement_items_sync_total): an insert, update or delete re-totals every purchase the statement touched (an
--     update that moves a line re-totals both the old and the new purchase), only while the purchase is Draft or Rejected, and never
--     when the purchase has no lines left. Same guards as 0284; only the number of passes changes.
--   * work-order copy (zz_copy_line_work_order_to_header): same rule as 1883 (every line names one live work order, purchase Draft or
--     Rejected). An update still counts only when the statement names work_order_id in its SET list (the old `update of work_order_id`
--     column trigger); a statement trigger with a transition table cannot carry a column list, so a column-list statement trigger raises
--     a transaction-local marker that the transition trigger reads and clears. An update copies for the purchase the line now belongs to.
-- Function names, definer status, search paths and (revoked) grants are unchanged. Row triggers are replaced by statement triggers.
-- Proven by supabase/tests/2798_purchase_line_retotal_per_statement.test.sql (same sequences run against the old bodies, every stored
-- total and header work order compared). Reverse: rollback/2798_purchase_line_retotal_per_statement_down.sql.

-- drops: sync_procurement_item_total() | "declare v_id uuid;" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: sync_procurement_item_total() | "if tg_op in ('UPDATE','DELETE') then" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: sync_procurement_item_total() | "v_id := old.procurement_id;" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: sync_procurement_item_total() | "from (select sum(i.amount) as line_total from public.procurement_items i where i.procurement_id = v_id) s" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: sync_procurement_item_total() | "where p.id = v_id and p.status in ('Draft','Rejected') and s.line_total is not null;" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: sync_procurement_item_total() | "if tg_op in ('INSERT','UPDATE') then" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: sync_procurement_item_total() | "v_id := new.procurement_id;" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: sync_procurement_item_total() | "update public.procurements p" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: sync_procurement_item_total() | "set total_value = s.line_total, updated_at = now()" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: sync_procurement_item_total() | "from (select sum(i.amount) as line_total from public.procurement_items i where i.procurement_id = v_id) s" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: sync_procurement_item_total() | "where p.id = v_id and p.status in ('Draft','Rejected') and s.line_total is not null;" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: sync_procurement_item_total() | "end if;" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: sync_procurement_item_total() | "if tg_op = 'DELETE' then return old; end if;" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: sync_procurement_item_total() | "return new;" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
create or replace function public.sync_procurement_item_total() returns trigger
  language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct procurement_id) into v_ids from new_rows;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct procurement_id) into v_ids from old_rows;
  else
    select array_agg(distinct t.procurement_id) into v_ids
      from (select procurement_id from old_rows union select procurement_id from new_rows) t;
  end if;
  if v_ids is null then return null; end if;
  update public.procurements p
     set total_value = s.line_total, updated_at = now()
    from (select i.procurement_id, sum(i.amount) as line_total
            from public.procurement_items i where i.procurement_id = any (v_ids) group by i.procurement_id) s
   where p.id = s.procurement_id and p.status in ('Draft','Rejected') and s.line_total is not null;
  return null;
end; $$;
revoke all on function public.sync_procurement_item_total() from public, anon, authenticated;

-- drops: copy_line_work_order_to_header() | "declare" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: copy_line_work_order_to_header() | "v_case uuid := case when tg_op = 'DELETE' then old.procurement_id else new.procurement_id end;" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: copy_line_work_order_to_header() | "v_lines int; v_named int; v_distinct int; v_wo uuid;" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: copy_line_work_order_to_header() | "select count(*), count(i.work_order_id), count(distinct i.work_order_id), min(i.work_order_id::text)::uuid" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: copy_line_work_order_to_header() | "into v_lines, v_named, v_distinct, v_wo" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: copy_line_work_order_to_header() | "from public.procurement_items i where i.procurement_id = v_case;" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: copy_line_work_order_to_header() | "if v_lines > 0 and v_named = v_lines and v_distinct = 1" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: copy_line_work_order_to_header() | "and exists (select 1 from public.work_orders w where w.id = v_wo and w.status <> 'Cancelled')" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: copy_line_work_order_to_header() | "and exists (select 1 from public.procurements p where p.id = v_case and p.status in ('Draft', 'Rejected')) then" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
-- drops: copy_line_work_order_to_header() | "update public.procurements set work_order_id = v_wo where id = v_case and work_order_id is distinct from v_wo;" | Per-row form replaced by one per-statement pass over the transition table; same rule (2798).
create or replace function public.copy_line_work_order_to_header() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct procurement_id) into v_ids from new_rows;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct procurement_id) into v_ids from old_rows;
  else
    -- only a statement that names work_order_id in its SET list counts (marker raised by mark_line_work_order_set)
    if coalesce(current_setting('pmo.line_work_order_set', true), '') <> 'on' then return null; end if;
    perform set_config('pmo.line_work_order_set', 'off', true);
    select array_agg(distinct procurement_id) into v_ids from new_rows;
  end if;
  if v_ids is null then return null; end if;
  update public.procurements p set work_order_id = a.wo
    from (select i.procurement_id, count(*) as v_lines, count(i.work_order_id) as v_named,
                 count(distinct i.work_order_id) as v_distinct, min(i.work_order_id::text)::uuid as wo
            from public.procurement_items i where i.procurement_id = any (v_ids) group by i.procurement_id) a
   where p.id = a.procurement_id
     and a.v_lines > 0 and a.v_named = a.v_lines and a.v_distinct = 1                         -- mut:copy_all_same
     and exists (select 1 from public.work_orders w where w.id = a.wo and w.status <> 'Cancelled')
     and p.status in ('Draft', 'Rejected')                                                    -- mut:copy_before_submit
     and p.work_order_id is distinct from a.wo;
  return null;
end $$;
revoke all on function public.copy_line_work_order_to_header() from public, anon, authenticated;

create function public.mark_line_work_order_set() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('pmo.line_work_order_set', 'on', true);
  return null;
end $$;
revoke all on function public.mark_line_work_order_set() from public, anon, authenticated;

drop trigger procurement_items_sync_total on public.procurement_items;
create trigger procurement_items_sync_total_ins after insert on public.procurement_items
  referencing new table as new_rows for each statement execute function public.sync_procurement_item_total();
create trigger procurement_items_sync_total_upd after update on public.procurement_items
  referencing old table as old_rows new table as new_rows for each statement execute function public.sync_procurement_item_total();
create trigger procurement_items_sync_total_del after delete on public.procurement_items
  referencing old table as old_rows for each statement execute function public.sync_procurement_item_total();

drop trigger zz_copy_line_work_order_to_header on public.procurement_items;
create trigger zz_copy_line_work_order_to_header_ins after insert on public.procurement_items
  referencing new table as new_rows for each statement execute function public.copy_line_work_order_to_header();
create trigger zz_copy_line_work_order_to_header_del after delete on public.procurement_items
  referencing old table as old_rows for each statement execute function public.copy_line_work_order_to_header();
create trigger zz_copy_line_work_order_to_header_1_upd_cols after update of work_order_id on public.procurement_items
  for each statement execute function public.mark_line_work_order_set();
create trigger zz_copy_line_work_order_to_header_2_upd after update on public.procurement_items
  referencing new table as new_rows for each statement execute function public.copy_line_work_order_to_header();
