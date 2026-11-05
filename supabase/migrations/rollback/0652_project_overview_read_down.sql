-- Reverses 0652: drops the Overview read-model function. The client falls back to the per-section reads.
drop function if exists public.get_project_overview_read(uuid, boolean, boolean, boolean);
