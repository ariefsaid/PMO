-- 0303 — mark-and-sweep reconciliation for complete statement GL replays.
-- The replay UUID is temporary mark-and-sweep bookkeeping, cleared by finish_erp_gl_replay.
alter table public.erp_gl_entry_mirror
  add column replay_seen_id uuid;

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
declare
  deleted_count integer;
  bound_company text;
begin
  if p_org_id is null or p_company is null or btrim(p_company) = ''
     or p_replay_id is null or (p_watermark is not null and p_watermark = '') then
    raise exception 'invalid complete GL replay finish' using errcode = '22023';
  end if;

  -- Serialize completion with company-binding changes. A stale replay must not clear the next
  -- company's replay-needed flag or retire rows before that company's full replay runs.
  select config ->> 'company' into bound_company
    from public.external_org_bindings
   where org_id = p_org_id and external_tier = 'erpnext'
   for update;
  if not found or bound_company is distinct from p_company then
    return jsonb_build_object('deleted', 0, 'replay_id', p_replay_id, 'stale_binding', true);
  end if;

  -- A completed full replay replaces this org's company-scoped ledger. This also retires legacy
  -- NULL-company rows, but only after the first complete replay, preserving them until then.
  delete from public.erp_gl_entry_mirror
   where org_id = p_org_id
     and (company is distinct from p_company
          or (company = p_company and replay_seen_id is distinct from p_replay_id));
  get diagnostics deleted_count = row_count;

  update public.erp_gl_entry_mirror
     set replay_seen_id = null
   where org_id = p_org_id
     and company = p_company
     and replay_seen_id = p_replay_id;

  if p_watermark is not null then
    insert into public.external_sync_watermarks (org_id, external_tier, domain, watermark_cursor)
    values (p_org_id, 'erpnext', 'ledger::GL Entry', p_watermark)
    on conflict (org_id, external_tier, domain) do update
      set watermark_cursor = excluded.watermark_cursor
      where public.external_sync_watermarks.watermark_cursor < excluded.watermark_cursor;
  end if;

  update public.external_org_bindings
     set statement_full_ledger_replay_needed = false
   where org_id = p_org_id and external_tier = 'erpnext' and config ->> 'company' = p_company;

  return jsonb_build_object('deleted', deleted_count, 'replay_id', p_replay_id);
end;
$$;
revoke execute on function public.finish_erp_gl_replay(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.finish_erp_gl_replay(uuid, text, uuid, text) to service_role;
