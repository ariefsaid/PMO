-- Reverse of 1008. Refuses if it would discard job titles.
do $$ begin
  if exists (select 1 from public.people where job_title is not null) then
    raise exception '1008 rollback refused: people have job titles';
  end if;
end $$;
drop trigger if exists people_z_code_trg on public.people;
drop function if exists public.people_assign_code();
alter table public.people drop column if exists job_title;
