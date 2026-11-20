-- Reverses 1129_quantity_change_reads.sql.
drop function if exists public.qcr_approval_state(uuid);
drop function if exists public.qcr_work_order_budget(uuid);
drop function if exists public.qcr_over_contract(uuid, boolean);
