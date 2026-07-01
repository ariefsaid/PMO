-- Dedicated role for agent-native's framework-managed tables.
--
-- Usage:
--   psql "$POSTGRES_URL" -f scripts/create-agent-native-role.sql
--
-- After this runs, point DATABASE_URL at the agent_native_app role, not postgres.
-- The role-level search_path is the load-bearing isolation seam: agent-native emits
-- unqualified DDL, so its framework tables land in agent_native instead of public.

create schema if not exists agent_native;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'agent_native_app') then
    create role agent_native_app
      login
      password 'agent_native_pw';
  end if;
end
$$;

alter role agent_native_app set search_path = agent_native, public;

grant usage, create on schema agent_native to agent_native_app;
grant usage on schema public to agent_native_app;
