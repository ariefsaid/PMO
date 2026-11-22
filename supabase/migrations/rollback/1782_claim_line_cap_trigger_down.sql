-- Reverses 1782_claim_line_cap_trigger.sql.
drop trigger if exists progress_claim_lines_cap on public.progress_claim_lines;
drop function if exists public.enforce_claim_line_cap();
