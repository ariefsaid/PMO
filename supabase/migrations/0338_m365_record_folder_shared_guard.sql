-- 0338_m365_record_folder_shared_guard.sql — a folder already linked to another record of the same kind is
-- never auto-linked a second time. The org-wide existence check is a definer helper (the caller's RLS may
-- hide other records' rows) and reveals nothing to a caller without a writer role; the guarded link RPC stays
-- security invoker and returns a safe state. The check-and-insert is serialised per record (first lock) and per
-- folder (second lock, always taken after the first), so two records cannot link one folder concurrently.
-- Reversible: supabase/migrations/rollback/0338_m365_record_folder_shared_guard_down.sql.
create or replace function public.m365_folder_linked_elsewhere(p_kind text,p_record_id uuid,p_drive_id text,p_item_id text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_org uuid;
begin
  v_org:=public.auth_org_id();
  if v_org is null or not public.is_active_member() then return false; end if;
  if public.auth_role()::text not in ('Admin','Executive','Project Manager','Finance') then return false; end if;
  if p_kind='project' then
    return exists(select 1 from public.project_documents d where d.org_id=v_org and d.source='onedrive'
      and d.ms_item_kind='folder' and d.ms_drive_id=p_drive_id and d.ms_item_id=p_item_id and d.project_id<>p_record_id);
  elsif p_kind='procurement' then
    return exists(select 1 from public.procurement_documents d where d.org_id=v_org and d.source='onedrive'
      and d.ms_item_kind='folder' and d.ms_drive_id=p_drive_id and d.ms_item_id=p_item_id and d.procurement_id<>p_record_id);
  end if;
  return false;
end $$;
revoke all on function public.m365_folder_linked_elsewhere(text,uuid,text,text) from public,anon;
grant execute on function public.m365_folder_linked_elsewhere(text,uuid,text,text) to authenticated;

create index if not exists project_documents_folder_item_idx on public.project_documents(org_id,ms_drive_id,ms_item_id)
 where source='onedrive' and ms_item_kind='folder';
create index if not exists procurement_documents_folder_item_idx on public.procurement_documents(org_id,ms_drive_id,ms_item_id)
 where source='onedrive' and ms_item_kind='folder';

create or replace function public.m365_link_record_folder(
  p_kind text, p_record_id uuid, p_reference jsonb,
  p_default_site_id text, p_default_drive_id text, p_settings_updated_at timestamptz
) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  v_org uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_existing uuid;
  v_id uuid;
  v_drive text;
  v_item text;
  v_url text;
  v_name text;
  v_shared boolean;
begin
  if not public.is_active_member() then raise insufficient_privilege; end if;
  if v_role not in ('Admin','Executive','Project Manager','Finance') then raise insufficient_privilege; end if;
  if p_kind not in ('project','procurement') or p_record_id is null
    or p_reference is null or jsonb_typeof(p_reference)<>'object'
    or (select array_agg(key order by key) from jsonb_object_keys(p_reference) key)
       is distinct from array['drive_id','item_id','item_kind','name','web_url']::text[]
    or p_reference->>'item_kind'<>'folder'
    or nullif(btrim(p_reference->>'drive_id'),'') is null
    or nullif(btrim(p_reference->>'item_id'),'') is null
    or nullif(btrim(p_reference->>'name'),'') is null
    or not public.m365_browser_url_valid(p_reference->>'web_url') then
    raise exception using errcode='22023', message='invalid folder reference';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('m365-record-folder:'||p_kind||':'||p_record_id::text,0));
  if p_kind='project' then
    if not exists(select 1 from public.projects p where p.id=p_record_id and p.org_id=v_org) then raise insufficient_privilege; end if;
    select d.id into v_existing from public.project_documents d
     where d.project_id=p_record_id and d.org_id=v_org and d.source='onedrive' and d.ms_item_kind='folder'
     order by d.ms_linked_at,d.id limit 1;
  else
    if not exists(select 1 from public.procurements p where p.id=p_record_id and p.org_id=v_org) then raise insufficient_privilege; end if;
    select d.id into v_existing from public.procurement_documents d
     where d.procurement_id=p_record_id and d.org_id=v_org and d.source='onedrive' and d.ms_item_kind='folder'
     order by d.ms_linked_at,d.id limit 1;
  end if;
  if v_existing is not null then return jsonb_build_object('document_id',v_existing,'state','already_linked'); end if;
  if not public.m365_record_folder_default_matches(p_default_site_id,p_default_drive_id,p_settings_updated_at) then
    raise exception using errcode='23514', message='m365 default changed', detail='m365-default-changed';
  end if;
  v_drive:=p_reference->>'drive_id'; v_item:=p_reference->>'item_id';
  v_url:=p_reference->>'web_url'; v_name:=p_reference->>'name';
  -- Serialise per folder (after the record lock, always in this order) so the check and the insert below cannot
  -- interleave with another record linking the same folder.
  perform pg_advisory_xact_lock(hashtextextended('m365-folder-item:'||v_org::text||':'||v_drive||':'||v_item,0));
  -- Two records of one kind must never silently share a folder: refuse and insert nothing.
  v_shared:=public.m365_folder_linked_elsewhere(p_kind,p_record_id,v_drive,v_item);
  if v_shared then return jsonb_build_object('state','needs_choice'); end if;
  if p_kind='project' then
    insert into public.project_documents(project_id,category,title,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
    values(p_record_id,'Reference',v_name,auth.uid(),'onedrive',v_drive,v_item,v_url,v_name,'folder') returning id into v_id;
  else
    insert into public.procurement_documents(procurement_id,type,status,link,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind)
    values(p_record_id,'Microsoft reference','Draft',v_url,'onedrive',v_drive,v_item,v_name,'folder') returning id into v_id;
  end if;
  return jsonb_build_object('document_id',v_id,'state','linked');
end $$;
revoke all on function public.m365_link_record_folder(text,uuid,jsonb,text,text,timestamptz) from public,anon;
grant execute on function public.m365_link_record_folder(text,uuid,jsonb,text,text,timestamptz) to authenticated;
