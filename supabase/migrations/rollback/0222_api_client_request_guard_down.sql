-- 0222_api_client_request_guard_down.sql — the STAGED rollback of 0222 (#728).
--
-- Lives in supabase/migrations/rollback/ so `supabase db reset` never applies it. Run deliberately:
--   psql "$DB_URL" -f supabase/migrations/rollback/0222_api_client_request_guard_down.sql
--
-- Order matters: detach PostgREST from the function BEFORE dropping it, or every API request fails
-- until the configuration is reloaded.

do $$
begin
  execute format('alter role authenticator in database %I reset pgrst.db_pre_request', current_database());
end;
$$;
notify pgrst, 'reload config';

drop function if exists public.api_client_request_guard();
