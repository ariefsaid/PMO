-- Rollback of 1245. Reverse 1249 to 1246 first. Loans are lost; home placements are untouched.
drop trigger if exists zz_crews_loan_archive on public.crews;
drop function if exists public.guard_crew_loan_archive();
drop table if exists public.crew_loans;
drop function if exists public.guard_crew_loan();
