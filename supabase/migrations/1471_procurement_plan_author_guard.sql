-- 1471_procurement_plan_author_guard.sql — a purchase created by a monthly equipment plan cannot be approved by that plan's
-- author (SoD). The plan approver becomes the purchase requester, so the requester rule alone never reaches the author, who
-- set the quantity, vendor and rate of every line. A BEFORE UPDATE trigger on the purchase fires only when the status moves
-- to Approved and refuses the caller who created an equipment plan with a line pointing at this purchase.
-- transition_procurement is not restated: the guard sits on the table, so every path to Approved is held to it.
-- REVERSE: rollback/1471_procurement_plan_author_guard_down.sql
create function public.guard_procurement_plan_author() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is not null
     and exists (select 1 from public.equipment_plan_lines l
                   join public.equipment_plans p on p.id = l.plan_id
                  where l.procurement_id = new.id and p.created_by = auth.uid()) then
    raise exception 'separation of duties: the author of the equipment plan that created this purchase cannot approve it'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_plan_author() from public, anon, authenticated;
create trigger procurements_guard_plan_author before update on public.procurements
  for each row when (new.status = 'Approved' and old.status is distinct from 'Approved')
  execute function public.guard_procurement_plan_author();
