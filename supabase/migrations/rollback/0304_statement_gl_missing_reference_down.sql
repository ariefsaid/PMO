-- Restore 0312 finish semantics and remove missing-reference detection.
drop function if exists public.mark_erp_statement_replay_for_missing_accounts(uuid, text);
create or replace function public.finish_erp_gl_replay(
  p_org_id uuid,
  p_company text,
  p_replay_id uuid,
  p_watermark text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare deleted_count integer;
begin
  if p_org_id is null or p_company is null or btrim(p_company) = ''
     or p_replay_id is null or p_watermark is null or p_watermark = '' then
    raise exception 'invalid complete GL replay finish' using errcode = '22023';
  end if;
  delete from public.erp_gl_entry_mirror where org_id = p_org_id and company = p_company and replay_seen_id is distinct from p_replay_id;
  get diagnostics deleted_count = row_count;
  update public.erp_gl_entry_mirror set replay_seen_id = null where org_id = p_org_id and company = p_company and replay_seen_id = p_replay_id;
  insert into public.external_sync_watermarks (org_id, external_tier, domain, watermark_cursor)
  values (p_org_id, 'erpnext', 'ledger::GL Entry', p_watermark)
  on conflict (org_id, external_tier, domain) do update
    set watermark_cursor = excluded.watermark_cursor
    where public.external_sync_watermarks.watermark_cursor < excluded.watermark_cursor;
  return jsonb_build_object('deleted', deleted_count, 'replay_id', p_replay_id);
end;
$$;
revoke execute on function public.finish_erp_gl_replay(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.finish_erp_gl_replay(uuid, text, uuid, text) to service_role;
