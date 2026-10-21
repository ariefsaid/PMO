-- 0336_m365_record_folders.sql — guarded record-folder references and durable create receipts.
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

create or replace function public.m365_record_folder_default_matches(p_site text,p_drive text,p_updated_at timestamptz)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_org uuid; v_site text; v_drive text; v_updated timestamptz;
begin
  v_org:=public.auth_org_id();
  if v_org is null or not public.is_active_member() then return false; end if;
  select s.default_site_id,s.default_drive_id,s.updated_at into v_site,v_drive,v_updated
    from public.org_m365_document_settings s where s.org_id=v_org for share;
  return found and v_site is not distinct from p_site and v_drive is not distinct from p_drive
    and v_updated is not distinct from p_updated_at;
end $$;
revoke all on function public.m365_record_folder_default_matches(text,text,timestamptz) from public,anon;
grant execute on function public.m365_record_folder_default_matches(text,text,timestamptz) to authenticated;

create or replace function public.m365_record_folder_created(p_actor_id uuid,p_kind text,p_record_id uuid,p_drive_id text,p_item_id text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_org uuid; v_role text;
begin
  if p_actor_id is null or p_kind not in ('project','procurement') or p_record_id is null
     or nullif(btrim(p_drive_id),'') is null or nullif(btrim(p_item_id),'') is null then
    raise exception using errcode='22023',message='invalid creation receipt';
  end if;
  perform public.assert_is_active_member(p_actor_id);
  select p.org_id,p.role::text into v_org,v_role from public.profiles p where p.id=p_actor_id;
  if v_role not in ('Admin','Executive','Project Manager','Finance') then raise insufficient_privilege; end if;
  if p_kind='project' then
    if not exists(select 1 from public.projects p where p.id=p_record_id and p.org_id=v_org) then raise insufficient_privilege; end if;
  else
    if not exists(select 1 from public.procurements p where p.id=p_record_id and p.org_id=v_org) then raise insufficient_privilege; end if;
  end if;
  -- No current-default-drive check: Microsoft already returned 201, so a default changed since must not leave the folder unaudited.
  perform pg_advisory_xact_lock(hashtextextended('m365-folder-created:'||v_org::text||':'||p_drive_id||':'||p_item_id,0));
  if exists(select 1 from public.audit_events a where a.org_id=v_org and a.action='m365.folder_created'
    and a.detail->>'ms_drive_id'=p_drive_id and a.detail->>'ms_item_id'=p_item_id) then return; end if;
  perform public.log_audit('m365.folder_created',v_org,p_actor_id,p_record_id,
    jsonb_build_object('record_kind',p_kind,'record_id',p_record_id,'ms_drive_id',p_drive_id,'ms_item_id',p_item_id));
end $$;
revoke all on function public.m365_record_folder_created(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.m365_record_folder_created(uuid,text,uuid,text,text) to service_role;
create unique index m365_folder_created_identity_idx on public.audit_events
(org_id,(detail->>'ms_drive_id'),(detail->>'ms_item_id')) where action='m365.folder_created';

create or replace function public.m365_record_folder_candidates(p_kind text,p_after uuid default null)
returns table(id uuid) language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if not public.is_active_member() or public.auth_role()::text<>'Admin' then raise insufficient_privilege; end if;
  if p_kind='project' then
    return query select p.id from public.projects p where p.org_id=public.auth_org_id() and (p_after is null or p.id>p_after)
      and not exists(select 1 from public.project_documents d where d.org_id=p.org_id and d.project_id=p.id and d.source='onedrive' and d.ms_item_kind='folder')
      order by p.id limit 6;
  elsif p_kind='procurement' then
    return query select p.id from public.procurements p where p.org_id=public.auth_org_id() and (p_after is null or p.id>p_after)
      and not exists(select 1 from public.procurement_documents d where d.org_id=p.org_id and d.procurement_id=p.id and d.source='onedrive' and d.ms_item_kind='folder')
      order by p.id limit 6;
  else raise exception using errcode='22023',message='invalid record kind'; end if;
end $$;
revoke all on function public.m365_record_folder_candidates(text,uuid) from public,anon;
grant execute on function public.m365_record_folder_candidates(text,uuid) to authenticated;

create index project_documents_folder_parent_idx on public.project_documents(org_id,project_id,ms_linked_at,id)
 where source='onedrive' and ms_item_kind='folder';
create index procurement_documents_folder_parent_idx on public.procurement_documents(org_id,procurement_id,ms_linked_at,id)
 where source='onedrive' and ms_item_kind='folder';
