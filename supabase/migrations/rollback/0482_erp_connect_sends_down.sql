-- Reverses 0482_erp_connect_sends.sql: the drain functions, the disconnect trigger and the lease columns. Proposals already settled by a send stay as they are.
drop trigger if exists erp_connect_purge_sends_on_disconnect on public.external_org_bindings;
drop function if exists public.purge_connect_sends_on_disconnect();
drop function if exists public.record_connect_record_held(uuid, text, text, text, text);
drop function if exists public.retry_connect_send(uuid);
drop function if exists public.record_connect_send_failure(uuid, uuid);
drop function if exists public.connect_send_existing_link(uuid, text, text, text);
drop function if exists public.record_connect_send_held(uuid, uuid);
drop function if exists public.record_connect_send_result(uuid, uuid, text, text);
drop function if exists public.claim_connect_sends(uuid, text, int);
alter table public.erp_connect_proposals drop column if exists send_failures;
alter table public.erp_connect_proposals drop column if exists send_claimed_at;
