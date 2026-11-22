drop view if exists public.survey_certified_lines;
create or replace function public.survey_quantity_for_line(p_work_order_id uuid, p_boq_item_id uuid)
  returns numeric language sql stable set search_path = public as $$ select null::numeric $$;
revoke all on function public.survey_quantity_for_line(uuid, uuid) from public, anon, authenticated;
