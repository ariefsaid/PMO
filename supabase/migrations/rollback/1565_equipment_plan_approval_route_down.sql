-- 1565 down: the plan screen reads who a Submitted plan waits for from this one read; removing it restores the bare
-- "Waiting for approval" wording. Nothing else was created, granted or changed by 1565.
drop function if exists public.get_equipment_plan_approval_route(uuid);
