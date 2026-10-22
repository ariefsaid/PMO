-- Usage rows are written only by trusted edge-function service-role paths.
revoke insert, update, delete on public.agent_usage from authenticated, anon;
