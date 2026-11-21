-- Reverses 1060: removes the read-only work-in-hand function. No table, column or grant was added.
drop function if exists public.get_work_in_hand(date);
