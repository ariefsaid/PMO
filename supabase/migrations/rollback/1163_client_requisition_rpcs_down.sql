-- 1163_client_requisition_rpcs_down.sql — reverse 1163: drop the requisition functions (then rollback/1162, then 1161).
drop function if exists public.csr_work_order_rollup(uuid);
drop function if exists public.csr_record_pickup(uuid, numeric, uuid, date, text, text, uuid);
drop function if exists public.csr_record_release(uuid, numeric, text, uuid);
drop function if exists public.csr_record_reservation(uuid, numeric, text, date, text, uuid);
drop function if exists public.csr_lock_line(uuid, uuid);
drop function if exists public.csr_cancel(uuid, text);
drop function if exists public.csr_send(uuid, uuid);
drop function if exists public.csr_update_draft(uuid, jsonb, jsonb);
drop function if exists public.csr_create(jsonb, jsonb, uuid);
drop function if exists public.csr_assert_recorder();
drop function if exists public.csr_assert_author(uuid);
drop function if exists public.csr_insert_lines(uuid, uuid, jsonb);
drop function if exists public.csr_validate_lines(uuid, uuid, jsonb);
drop function if exists public.csr_valid_quantity(numeric, boolean);
drop function if exists public.csr_log(uuid, uuid, uuid, text, numeric, text, date, text, uuid, uuid);
drop function if exists public.csr_line_figures(uuid);
