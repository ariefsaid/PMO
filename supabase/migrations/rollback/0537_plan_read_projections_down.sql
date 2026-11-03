-- rollback/0537_plan_read_projections_down.sql — reverse 0537_plan_read_projections.sql.
--
-- 0537 only adds three read-only functions and no table, grant on a table, trigger or data. The
-- reverse is therefore just the three drops, in the order that leaves no dependent behind. No
-- entitlement state is touched, so nothing has to be restored.

drop function if exists public.resolved_org_plan();
drop function if exists public.operator_org_plan(uuid);
drop function if exists public.operator_plan_catalogue();

notify pgrst, 'reload schema';
