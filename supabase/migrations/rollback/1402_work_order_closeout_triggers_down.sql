-- 1402_work_order_closeout_triggers_down.sql — reverses 1402: closing is ungated again and new work orders get no checklist.
drop trigger if exists work_orders_zzzzzz_closeout_guard on public.work_orders;
drop function if exists public.assert_work_order_closeout_complete();
drop trigger if exists work_orders_zz_closeout_items on public.work_orders;
drop function if exists public.instantiate_work_order_closeout_items();
