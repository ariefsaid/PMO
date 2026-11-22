-- Rollback for 1564_timesheet_approval_route.sql.
-- The migration added ONE read-only security-invoker function; dropping it restores the prior state.
-- No table, policy, grant on any other object, write function or generated frontend type is touched by
-- the forward migration, so there is nothing else to reverse.

drop function if exists public.get_timesheet_approval_route(uuid);
