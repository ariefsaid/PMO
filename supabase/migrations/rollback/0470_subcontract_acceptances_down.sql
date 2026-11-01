-- 0470_subcontract_acceptances_down.sql — reverses 0470 (#1513 S2). Refuses while subcontract acceptances exist (NFR-SCA-007):
-- export (scripts/prod-read.sh / pg_dump -t) and remove them first. Never copy rows into a table in `public`: that schema is
-- API-exposed and an `as select *` copy carries no RLS.
do $$ begin
  if exists (select 1 from public.subcontract_acceptances) or exists (select 1 from public.subcontract_acceptance_lines) then
    raise exception 'rollback refused: subcontract acceptances exist — export and remove them first';
  end if;
end $$;
drop function if exists public.confirm_subcontract_acceptance(uuid);
drop function if exists public.withdraw_subcontract_acceptance(uuid);
drop function if exists public.prepare_subcontract_acceptance(uuid, date, jsonb, uuid, text, uuid);
drop function if exists public.subcontract_verified(uuid);
drop table if exists public.subcontract_acceptance_lines;
drop table if exists public.subcontract_acceptances;
drop function if exists public.guard_subcontract_acceptance_line_immutable();
drop function if exists public.guard_subcontract_acceptance_immutable();
