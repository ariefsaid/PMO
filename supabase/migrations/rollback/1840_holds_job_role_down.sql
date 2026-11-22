-- Reverses 1840_holds_job_role.sql. Run after 1841-1843's rollbacks (they call it).
drop function if exists public.holds_job_role(uuid, text);
