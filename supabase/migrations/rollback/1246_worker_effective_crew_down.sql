-- Rollback of 1246. Reverse 1248 and 1247 first (they call it).
drop function if exists public.worker_effective_crew(uuid, date);
