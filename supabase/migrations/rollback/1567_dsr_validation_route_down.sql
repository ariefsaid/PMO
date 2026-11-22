-- Rollback for 1567_dsr_validation_route.sql.
-- The migration added ONE read-only security-invoker function; dropping it restores the prior state.
-- It added no table, policy, grant on any other object, write function or generated frontend type, so
-- there is nothing else to reverse.

drop function if exists public.get_dsr_validation_route(uuid);
