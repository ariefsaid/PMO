-- 0580_budget_comparison_down.sql — reverse of 0580_budget_comparison.sql.
-- The comparison read is self-contained: nothing else references it yet (the Forecast lane consumes
-- it in a later slice), so a plain drop restores the 0577 schema exactly.
drop function if exists public.get_budget_comparison(uuid, text);
