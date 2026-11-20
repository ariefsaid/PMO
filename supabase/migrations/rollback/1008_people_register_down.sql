-- Reverse of 1008. The job_title column belongs to 0988_crews_roster and is left in place.
drop trigger if exists people_z_code_trg on public.people;
drop function if exists public.people_assign_code();
