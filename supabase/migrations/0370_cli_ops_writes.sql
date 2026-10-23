-- 0370 link a SharePoint source file to a budget version (CLI `pmo budgets activate --source`; #1270 B).
-- Rollback: supabase/migrations/rollback/0370_cli_ops_writes_down.sql
-- The app writes this table directly (0292 grants + insert policy); the API client cannot, so the CLI gets one
-- RPC with the same predicate: active member, Admin/Executive/Project Manager/Finance, own org, Draft version.
-- Activation itself is NOT touched: the CLI calls the existing activate_budget_version, whose rules and
-- separation of duties stay the authority.
create function public.link_budget_version_sharepoint_item(p_version_id uuid, p_item jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id();
  v_status public.budget_status;
  v_id uuid;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Cannot change evidence on this budget version.' using errcode = '42501';
  end if;
  select v.status into v_status from public.budget_versions v where v.id = p_version_id and v.org_id = v_org for update;
  if not found then
    raise exception 'budget version not found' using errcode = 'P0002';
  end if;
  if v_status <> 'Draft' then
    raise exception 'A source file can only be attached to a Draft budget version.' using errcode = 'P0001';
  end if;
  if p_item is null or jsonb_typeof(p_item) <> 'object'
     or coalesce(p_item->>'kind', '') not in ('file','folder')
     or coalesce(btrim(p_item->>'drive_id'), '') = '' or coalesce(btrim(p_item->>'item_id'), '') = ''
     or coalesce(btrim(p_item->>'name'), '') = '' or not public.m365_browser_url_valid(p_item->>'web_url') then
    raise exception 'A SharePoint item needs drive_id, item_id, web_url (https), name and kind (file or folder).' using errcode = '22023';
  end if;
  -- Linking the same item twice is a no-op, so a retried command does not stack duplicate evidence.
  select l.id into v_id from public.budget_version_document_links l
   where l.budget_version_id = p_version_id and l.ms_drive_id = p_item->>'drive_id' and l.ms_item_id = p_item->>'item_id';
  if found then return v_id; end if;
  insert into public.budget_version_document_links (org_id, budget_version_id, ms_drive_id, ms_item_id, ms_web_url, ms_item_name, ms_item_kind)
  values (v_org, p_version_id, p_item->>'drive_id', p_item->>'item_id', p_item->>'web_url', p_item->>'name', p_item->>'kind')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.link_budget_version_sharepoint_item(uuid, jsonb) from public, anon;
grant execute on function public.link_budget_version_sharepoint_item(uuid, jsonb) to authenticated;
