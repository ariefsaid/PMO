-- Reverses 1411_safety_days_tables.sql. Run 1412..1414 rollbacks first.
drop table if exists public.safety_officer_entries;
drop table if exists public.safety_permits;
drop table if exists public.safety_checklist_answers;
drop table if exists public.safety_toolbox_photos;
drop table if exists public.safety_toolbox_attendees;
drop table if exists public.safety_toolbox_talks;
drop table if exists public.safety_fitness_checks;
drop table if exists public.safety_days;
drop function if exists public.safety_days_guard();
drop function if exists public.safety_part_guard();
drop function if exists public.safety_days_copy_checklist();
drop function if exists public.safety_photo_stored(text);
drop function if exists public.safety_may_see_people_day(uuid);
drop function if exists public.safety_day_writable(uuid);
drop function if exists public.safety_may_enter_day(uuid);
drop function if exists public.safety_may_see_people(uuid);
drop function if exists public.safety_may_enter(uuid);
