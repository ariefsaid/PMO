-- 1367 down.
drop function if exists public.move_claim_billing_step(uuid, integer);
drop function if exists public.remove_claim_billing_step(uuid, text);
drop function if exists public.add_claim_billing_step(uuid, integer, jsonb);
drop function if exists public.update_claim_billing_step(uuid, jsonb);
drop function if exists public.renumber_claim_steps(uuid, uuid[], date);
drop function if exists public.lock_claim_for_step_edit(uuid, boolean);
