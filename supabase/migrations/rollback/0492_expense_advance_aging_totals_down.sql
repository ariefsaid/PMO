-- 0492_expense_advance_aging_totals_down.sql — reverses 0492. Creates no table and writes no rows; drop the function.
drop function if exists public.get_expense_advance_aging_totals();
