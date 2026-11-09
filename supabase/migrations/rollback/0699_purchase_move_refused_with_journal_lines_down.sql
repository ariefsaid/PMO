drop trigger if exists procurements_move_journal_lines_guard on public.procurements;
drop function if exists public.guard_procurement_move_with_journal_lines();
