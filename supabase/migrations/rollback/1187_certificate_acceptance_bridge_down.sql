-- 1187_certificate_acceptance_bridge_down.sql — functions only; no rows of its own.
drop function if exists public.work_order_certified_cost(uuid);
drop function if exists public.prepare_certificate_acceptance(uuid, text);
