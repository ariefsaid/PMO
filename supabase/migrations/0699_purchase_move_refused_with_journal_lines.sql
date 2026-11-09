-- 0699 A purchase with attached ERP journal lines cannot change project (#1935).
-- A journal line belongs to the ERP project on its journal, so it cannot follow the purchase; refusing the move keeps
-- project cost totals correct. Detach the lines first (Admin/Finance). Rollback: supabase/migrations/rollback/0699_purchase_move_refused_with_journal_lines_down.sql
create function public.guard_procurement_move_with_journal_lines() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if exists (select 1 from public.erp_journal_line_links k where k.procurement_id = new.id) then
    raise exception 'A purchase with attached journal lines cannot move to another project. Ask Finance or an Admin to detach the lines first.'
      using errcode = '23514', detail = 'purchase-move-has-journal-lines';
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_move_with_journal_lines() from public, anon, authenticated;
create trigger procurements_move_journal_lines_guard before update of project_id on public.procurements
  for each row when (new.project_id is distinct from old.project_id)
  execute function public.guard_procurement_move_with_journal_lines();
