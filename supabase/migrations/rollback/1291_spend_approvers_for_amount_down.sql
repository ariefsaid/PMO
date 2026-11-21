-- Rollback 1291 (run after rolling back 1292).
drop function if exists public.spend_approvers_for_amount(uuid, uuid, numeric, text);
