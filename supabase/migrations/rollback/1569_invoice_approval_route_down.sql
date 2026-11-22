-- Rollback for 1569_invoice_approval_route.sql.
-- The migration added ONE read-only security-invoker function; dropping it restores the prior state. It added no
-- table, policy, grant on any other object or write function, so there is nothing else to reverse.

drop function if exists public.get_invoice_approval_route(uuid);
