-- Reverse of 1752.
drop trigger if exists zz_mr_attendance_days on public.attendance_days;
drop trigger if exists zz_mr_crew_loans on public.crew_loans;
drop trigger if exists zz_mr_crew_members on public.crew_members;
drop function if exists public.guard_medical_release_attendance();
drop function if exists public.guard_medical_release_placement();
