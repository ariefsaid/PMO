-- rollback/1568_imprest_requester_route_down.sql — removes the requester who-next read added by
-- 1568_imprest_requester_route.sql. Reads only: no table, policy or grant is touched.
drop function if exists public.get_imprest_requester_route(text, text);
