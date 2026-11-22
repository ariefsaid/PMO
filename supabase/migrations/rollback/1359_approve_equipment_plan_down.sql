-- 1359_approve_equipment_plan_down.sql — reverses 1359 (#2700). Run before 1358's rollback.
drop function if exists public.approve_equipment_plan(uuid);
