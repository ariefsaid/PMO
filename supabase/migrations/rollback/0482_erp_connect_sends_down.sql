-- Reverses 0482_erp_connect_sends.sql: the three drain functions and the lease column. Proposals already settled by a send stay as they are.
drop function if exists public.record_connect_send_held(uuid, uuid);
drop function if exists public.record_connect_send_result(uuid, uuid, text, text);
drop function if exists public.claim_connect_sends(uuid, text, int);
alter table public.erp_connect_proposals drop column if exists send_claimed_at;
