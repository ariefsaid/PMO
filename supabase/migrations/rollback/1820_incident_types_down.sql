-- 1820_incident_types_down.sql — reverse 1820. Reverse 1821 first (its column references this table).
drop trigger if exists organizations_incident_types_seed on public.organizations;
drop function if exists public.incident_types_seed_new_org();
drop table if exists public.incident_types;
