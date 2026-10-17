revoke execute on function public.finish_erp_gl_replay(uuid, text, uuid, text) from public, anon, authenticated, service_role;
drop function if exists public.finish_erp_gl_replay(uuid, text, uuid, text);
alter table public.erp_gl_entry_mirror drop column if exists replay_seen_id;
