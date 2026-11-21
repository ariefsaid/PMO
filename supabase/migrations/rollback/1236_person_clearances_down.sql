-- Reverse of 1236. Refuses while any person state exists.
do $$ begin
  if exists (select 1 from public.person_clearances) then
    raise exception 'refusing to drop person_clearances: it holds rows' using errcode = 'P0001';
  end if;
end $$;
drop table public.person_clearances;
drop function public.person_clearances_guard();
