-- 1400_work_order_closeout_tables_down.sql — reverses 1400. Run the 1402 and 1401 rollbacks first. A closed work order's closed_by is lost.
-- Refuses while any work order carries a checklist (dropping it would erase the record of what was collected before closing).
do $$ begin
  if exists (select 1 from public.work_order_closeout_items) then
    raise exception 'work orders carry close-out checklists; 1400 cannot be rolled back' using errcode = 'P0001';
  end if;
end $$;
update public.record_history_config set captured = captured - 'closed_by' where table_name = 'work_orders';
alter table public.work_orders drop column if exists closed_by;
drop table if exists public.work_order_closeout_items;
drop table if exists public.closeout_checklist_templates;
