-- Restore the 0234 check (non-blank only). Normalised location values are left as stored.
alter table public.projects drop constraint projects_location_check;
alter table public.projects add constraint projects_location_check check (location is null or btrim(location) <> '');
notify pgrst, 'reload schema';
