-- 1318_mrq_borrowing_down.sql — reverse 1318. No shipped function body is restored: none was re-created.
drop trigger if exists rsv_consume_on_approval on public.material_requests;
drop trigger if exists rsv_borrow_on_submit on public.material_requests;
drop function if exists public.rsv_consume_on_approval();
drop function if exists public.rsv_borrow_on_submit();
drop function if exists public.rsv_take(uuid, uuid, uuid, uuid, numeric, boolean);
drop function if exists public.rsv_split_line(uuid, uuid, uuid, numeric, uuid);
alter table public.material_request_lines drop column if exists borrowed_qty, drop column if exists reserved_use_qty;
alter table public.material_requests drop column if exists borrowing, drop column if exists reservation_checked;
