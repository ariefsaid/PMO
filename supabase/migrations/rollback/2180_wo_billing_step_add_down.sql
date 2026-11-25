-- Rollback of 2180: drop the work-order checklist step adder. Lists already written stay (they are the work orders' own data).
drop function if exists public.add_work_order_step(uuid, integer, jsonb);
