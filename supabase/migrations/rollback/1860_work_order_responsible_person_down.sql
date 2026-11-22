-- Reverses 1860_work_order_responsible_person.sql (run any later migration that reads the column first).
drop function if exists public.set_work_order_responsible_person(uuid, uuid);
drop trigger if exists work_orders_zzzzzz_responsible_person on public.work_orders;
drop function if exists public.guard_work_order_responsible_person();
update public.record_history_config set captured = captured - 'responsible_person_id' where table_name = 'work_orders';
drop index if exists public.work_orders_responsible_person_idx;
alter table public.work_orders drop column if exists responsible_person_id;
