-- Rollback of 2101: drop the read.
drop function if exists public.get_work_order_material_completion(uuid);
