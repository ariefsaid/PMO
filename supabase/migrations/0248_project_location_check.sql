-- #830: projects.location is stored trimmed and at most 140 characters (the option-list length rule).
-- Reversal: supabase/migrations/rollback/0248_project_location_check_down.sql.
-- Normalise any pre-existing value first so the stricter check can be validated. This deliberately
-- TRUNCATES locations over 140 characters (rather than refusing the migration); the count is
-- reported in a NOTICE so the loss is visible in the migration output.
do $$
declare n int;
begin
  select count(*) into n from public.projects where length(btrim(location)) > 140;
  raise notice '#830: truncating % project location(s) longer than 140 characters', n;
end $$;
update public.projects
   set location = nullif(btrim(left(btrim(location), 140)), '')
 where location is not null
   and location is distinct from nullif(btrim(left(btrim(location), 140)), '');
alter table public.projects drop constraint projects_location_check;
alter table public.projects add constraint projects_location_check
  check (location is null or (location = btrim(location) and length(location) between 1 and 140));
notify pgrst, 'reload schema';
