-- Reverses 1781_claimable_headroom_twin.sql.
drop function if exists public.work_order_line_headroom(uuid, uuid, uuid);
drop function if exists public.work_order_line_accepted_quantity(uuid, uuid);
drop function if exists public.work_order_line_claimed_quantity(uuid, uuid, uuid);
drop function if exists public.survey_quantity_for_line(uuid, uuid);
drop function if exists public.claimable_headroom(numeric, numeric, numeric, numeric);
