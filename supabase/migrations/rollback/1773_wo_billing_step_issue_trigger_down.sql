-- Rollback of 1773: the issue-time copy stops; lists already made stay until 1770's rollback drops them.
drop trigger if exists work_orders_zz_billing_steps on public.work_orders;
drop function if exists public.instantiate_work_order_billing_steps();
