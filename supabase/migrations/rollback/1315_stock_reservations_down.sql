-- 1315_stock_reservations_down.sql — reverse 1315.
drop table if exists public.stock_reservation_events;
drop table if exists public.stock_reservations;
drop function if exists public.guard_stock_reservation_rows();
drop function if exists public.stock_reservations_on(uuid);
alter table public.organizations drop column if exists reservation_borrow_label, drop column if exists reservation_borrow_role,
  drop column if exists reservation_borrow_mode, drop column if exists stock_reservations;
