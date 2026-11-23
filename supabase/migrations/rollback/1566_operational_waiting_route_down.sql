-- rollback/1566_operational_waiting_route_down.sql — reverse 1566_operational_waiting_route.sql.
-- The read function has no dependants and owns no data; dropping it restores the prior state exactly.
drop function if exists public.get_operational_waiting_route(text, uuid);
