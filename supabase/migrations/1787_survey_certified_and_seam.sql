-- 1787_survey_certified_and_seam.sql — survey-cap-record: the certified quantity of a work-order line = the sum of its confirmed,
-- not-superseded, not-archived survey records. The seam part B left (1781) now returns it. Reversal: rollback/1787_..._down.sql.
-- drops: survey_quantity_for_line stops returning null; the stub line `select null::numeric` is replaced by the certified sum (that is the seam filled).
-- Restates survey_quantity_for_line from 1781 (the only definition; created by part B, so no head dump exists): same signature,
-- return type, volatility and grants; the body changes from `null` to the certified sum (null when no record is confirmed).
create or replace function public.survey_quantity_for_line(p_work_order_id uuid, p_boq_item_id uuid)
  returns numeric language sql stable security definer set search_path = public as $$
  select sum(r.surveyed_quantity) from public.survey_records r
   where r.work_order_id = p_work_order_id and r.boq_item_id = p_boq_item_id
     and r.status = 'confirmed' and r.superseded_at is null and r.archived_at is null
$$;
revoke all on function public.survey_quantity_for_line(uuid, uuid) from public, anon, authenticated;

-- What the claim form reads. security_invoker: the caller's own RLS on survey_records applies (own organisation, not a field account).
create view public.survey_certified_lines with (security_invoker = true) as
  select r.org_id, r.work_order_id, r.boq_item_id,
         sum(r.surveyed_quantity) as certified_quantity,
         sum(r.quality_ready_quantity) as quality_ready_quantity
    from public.survey_records r
   where r.status = 'confirmed' and r.superseded_at is null and r.archived_at is null
   group by r.org_id, r.work_order_id, r.boq_item_id;
revoke all on public.survey_certified_lines from public, anon, authenticated;
grant select on public.survey_certified_lines to authenticated;
grant all on public.survey_certified_lines to service_role;
