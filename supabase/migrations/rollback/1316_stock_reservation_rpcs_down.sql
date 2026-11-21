-- 1316_stock_reservation_rpcs_down.sql — reverse 1316.
drop function if exists public.set_stock_reservations(boolean, text, public.user_role, text);
drop function if exists public.release_stale_reservations();
drop function if exists public.release_reservation(uuid, numeric, text);
drop function if exists public.reserve_stock(uuid, uuid, uuid, numeric, date, text, uuid);
drop function if exists public.rsv_sweep(uuid);
drop function if exists public.rsv_assert_may(uuid, uuid, uuid);
drop function if exists public.rsv_free(uuid, uuid, uuid);
drop function if exists public.rsv_reserved(uuid, uuid, uuid);
drop function if exists public.rsv_today(uuid);
