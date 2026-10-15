-- 0292_m365_document_linking.sql — nullable Microsoft reference source for project documents.
-- Additive phase-1 migration; source constraints and other target relations follow in this migration.

create type public.doc_source as enum ('upload', 'onedrive');

alter table public.project_documents
  add column source public.doc_source,
  add column ms_drive_id text,
  add column ms_item_id text,
  add column ms_web_url text,
  add column ms_item_name text,
  add column ms_item_kind text,
  add column ms_linked_by uuid references public.profiles(id),
  add column ms_linked_at timestamptz,
  add column ms_last_verified_at timestamptz,
  add column ms_content_tag_at_issue text,
  add column ms_version_id_at_issue text,
  add column ms_drift_state text,
  add column ms_check_claim uuid,
  add column ms_check_claimed_at timestamptz;

-- Preserve existing uploads as uploads; metadata-only rows remain source-null.
update public.project_documents
set source = 'upload'
where file_path is not null;

create function public.m365_browser_url_valid(value text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(value ~* '^https://[[:alnum:]]([[:alnum:].-]*[[:alnum:]])?(:[0-9]{1,5})?(/[^[:space:]]*)?$'
    and value !~ '[[:cntrl:]]', false)
$$;

create function public.m365_ref_complete(
  drive text, item text, url text, name text, kind text, actor uuid, at_time timestamptz
) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(btrim(drive) <> '' and btrim(item) <> '' and btrim(name) <> ''
    and public.m365_browser_url_valid(url) and kind in ('file', 'folder')
    and actor is not null and at_time is not null, false)
$$;

revoke all on function public.m365_browser_url_valid(text) from public, anon;
revoke all on function public.m365_ref_complete(text,text,text,text,text,uuid,timestamptz) from public, anon;
grant execute on function public.m365_browser_url_valid(text) to authenticated, service_role;
grant execute on function public.m365_ref_complete(text,text,text,text,text,uuid,timestamptz) to authenticated, service_role;

alter table public.procurement_documents
  add column source public.doc_source,
  add column ms_drive_id text,
  add column ms_item_id text,
  add column ms_item_name text,
  add column ms_item_kind text,
  add column ms_linked_by uuid references public.profiles(id),
  add column ms_linked_at timestamptz,
  add column ms_last_verified_at timestamptz;

alter table public.project_documents
  add constraint project_documents_source_complete check (((
    (source is null and file_path is null and num_nonnulls(
      ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at,
      ms_last_verified_at,ms_content_tag_at_issue,ms_version_id_at_issue,ms_drift_state,
      ms_check_claim,ms_check_claimed_at)=0)
    or (source='upload' and file_path is not null and num_nonnulls(
      ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at,
      ms_last_verified_at,ms_content_tag_at_issue,ms_version_id_at_issue,ms_drift_state,
      ms_check_claim,ms_check_claimed_at)=0)
    or (source='onedrive' and file_path is null and public.m365_ref_complete(
      ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
      and (ms_content_tag_at_issue is null or btrim(ms_content_tag_at_issue)<>'')
      and (ms_version_id_at_issue is null or btrim(ms_version_id_at_issue)<>'')
      and (ms_drift_state is null or ms_drift_state in ('clean','drifted','not_verified'))
      and (ms_drift_state is null or ms_drift_state='not_verified' or ms_content_tag_at_issue is not null)
      and ((ms_check_claim is null)=(ms_check_claimed_at is null))
      and (ms_item_kind='file' or num_nonnulls(ms_content_tag_at_issue,ms_version_id_at_issue,
        ms_drift_state,ms_check_claim,ms_check_claimed_at)=0))
  ) is true));

create table public.budget_version_document_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references public.organizations(id),
  budget_version_id uuid not null references public.budget_versions(id) on delete cascade,
  ms_drive_id text not null,
  ms_item_id text not null,
  ms_web_url text not null,
  ms_item_name text not null,
  ms_item_kind text not null,
  ms_linked_by uuid not null default auth.uid() references public.profiles(id),
  ms_linked_at timestamptz not null default now(),
  ms_last_verified_at timestamptz,
  constraint budget_version_document_links_reference_complete check (
    public.m365_ref_complete(ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,
      ms_linked_by,ms_linked_at) is true
  )
);

create table public.org_m365_document_settings (
  org_id uuid primary key default public.auth_org_id()
    references public.organizations(id) on delete cascade,
  default_site_id text,
  default_site_name text,
  default_drive_id text,
  default_drive_name text,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null,
  constraint org_m365_document_settings_default_complete check (((
    num_nonnulls(default_site_id,default_site_name,default_drive_id,default_drive_name)=0
    or (default_site_id is not null and btrim(default_site_id)<>''
      and default_site_name is not null and btrim(default_site_name)<>''
      and default_drive_id is not null and btrim(default_drive_id)<>''
      and default_drive_name is not null and btrim(default_drive_name)<>'')
  ) is true))
);

alter table public.procurement_documents
  add constraint procurement_documents_source_complete check (((
    (source is null and num_nonnulls(ms_drive_id,ms_item_id,ms_item_name,ms_item_kind,
      ms_linked_by,ms_linked_at,ms_last_verified_at)=0)
    or (source='onedrive' and public.m365_ref_complete(ms_drive_id,ms_item_id,link,
      ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at))
  ) is true));

create function public.guard_project_m365_source() returns trigger
language plpgsql set search_path=public as $$
declare v_parent_org uuid;
begin
  if public.actor_bypasses_rls() then return new; end if;
  if not public.is_active_member() or public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Cannot change this document reference.' using errcode='42501';
  end if;
  select p.org_id into v_parent_org from public.projects p where p.id=new.project_id;
  if v_parent_org is distinct from public.auth_org_id() or new.org_id is distinct from public.auth_org_id() then
    raise exception 'Cannot change this document reference.' using errcode='42501';
  end if;
  if tg_op='INSERT' then
    if new.file_path is not null and new.source is null then new.source:='upload'; end if;
    if new.source='onedrive' and (new.status<>'Draft' or (new.author_id is distinct from auth.uid()
       and public.auth_role()<>'Admin')) then
      raise exception 'Cannot change this document reference.' using errcode='42501';
    end if;
    return new;
  end if;
  if old.source='onedrive' and new.file_path is not null then
    raise exception 'Clear the Microsoft reference before uploading.' using errcode='23514',detail='m365-source-collision';
  end if;
  if new.source='onedrive' and (old.source is not null or old.file_path is not null) then
    raise exception 'This entry already has a file or link.' using errcode='23514',detail='m365-source-collision';
  end if;
  if new.source='onedrive' or old.source='onedrive' then
    if old.status<>'Draft' or (old.author_id is distinct from auth.uid() and public.auth_role()<>'Admin') then
      raise exception 'Cannot change this document reference.' using errcode='42501';
    end if;
  end if;
  if old.source is distinct from 'onedrive' then
    if new.file_path is not null and new.source is null then new.source:='upload';
    elsif old.file_path is not null and new.file_path is null and new.source='upload' then new.source:=null;
    end if;
  end if;
  return new;
end; $$;

create function public.stamp_project_m365_source() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.source='onedrive' and new.source is distinct from old.source and auth.uid() is not null then
    new.ms_linked_by:=auth.uid(); new.ms_linked_at:=now(); new.ms_last_verified_at:=null;
    new.ms_content_tag_at_issue:=null; new.ms_version_id_at_issue:=null; new.ms_drift_state:=null;
    new.ms_check_claim:=null; new.ms_check_claimed_at:=null;
  elsif tg_op='UPDATE' and old.source='onedrive' and new.source is null then
    new.ms_drive_id:=null; new.ms_item_id:=null; new.ms_web_url:=null; new.ms_item_name:=null;
    new.ms_item_kind:=null; new.ms_linked_by:=null; new.ms_linked_at:=null; new.ms_last_verified_at:=null;
    new.ms_content_tag_at_issue:=null; new.ms_version_id_at_issue:=null; new.ms_drift_state:=null;
    new.ms_check_claim:=null; new.ms_check_claimed_at:=null;
  end if;
  return new;
end; $$;

create function public.guard_procurement_m365_source() returns trigger
language plpgsql set search_path=public as $$
declare v_parent_org uuid;
begin
  if public.actor_bypasses_rls() then return new; end if;
  if not public.is_active_member() or public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Cannot change this procurement reference.' using errcode='42501';
  end if;
  select p.org_id into v_parent_org from public.procurements p where p.id=new.procurement_id;
  if v_parent_org is distinct from public.auth_org_id() or new.org_id is distinct from public.auth_org_id() then
    raise exception 'Cannot change this procurement reference.' using errcode='42501';
  end if;
  if tg_op='UPDATE' and new.source='onedrive'
     and (old.source is not null or old.link is not null) then
    raise exception 'This entry already has a file or link.' using errcode='23514',detail='m365-source-collision';
  end if;
  if tg_op='UPDATE' and old.source='onedrive' and new.source='onedrive' then
    raise exception 'This entry already has a file or link.' using errcode='23514',detail='m365-source-collision';
  end if;
  return new;
end; $$;

create function public.stamp_procurement_m365_source() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.source='onedrive' and new.source is distinct from old.source and auth.uid() is not null then
    new.ms_linked_by:=auth.uid(); new.ms_linked_at:=now(); new.ms_last_verified_at:=null;
  elsif tg_op='UPDATE' and old.source='onedrive' and new.source is null then
    new.ms_drive_id:=null; new.ms_item_id:=null; new.ms_item_name:=null; new.ms_item_kind:=null;
    new.ms_linked_by:=null; new.ms_linked_at:=null; new.ms_last_verified_at:=null;
    new.link:=null;
  end if;
  return new;
end; $$;

create function public.guard_project_m365_identity() returns trigger
language plpgsql set search_path=public as $$
begin
  if old.source='onedrive' and (new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.project_id is distinct from old.project_id or new.parent_document_id is distinct from old.parent_document_id) then
    raise exception 'A linked document cannot change its parent.' using errcode='23514';
  end if;
  return new;
end; $$;

create function public.guard_procurement_m365_identity() returns trigger
language plpgsql set search_path=public as $$
begin
  if old.source='onedrive' and (new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.procurement_id is distinct from old.procurement_id) then
    raise exception 'A linked procurement reference cannot change its parent.' using errcode='23514';
  end if;
  return new;
end; $$;

create function public.guard_budget_m365_identity() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.budget_version_id is distinct from old.budget_version_id then
    raise exception 'A budget reference cannot change its parent.' using errcode='23514';
  end if;
  return new;
end; $$;

create trigger project_m365_guard before insert or update of source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,file_path
  on public.project_documents for each row execute function public.guard_project_m365_source();
create trigger project_m365_stamp before insert or update of source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,file_path
  on public.project_documents for each row execute function public.stamp_project_m365_source();
create trigger project_m365_identity_guard before update of id,org_id,project_id,parent_document_id
  on public.project_documents for each row execute function public.guard_project_m365_identity();
create trigger procurement_m365_guard before insert or update of source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind,link
  on public.procurement_documents for each row execute function public.guard_procurement_m365_source();
create trigger procurement_m365_stamp before insert or update of source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind,link
  on public.procurement_documents for each row execute function public.stamp_procurement_m365_source();
create trigger procurement_m365_identity_guard before update of id,org_id,procurement_id
  on public.procurement_documents for each row execute function public.guard_procurement_m365_identity();
create trigger budget_m365_identity_guard before update of budget_version_id
  on public.budget_version_document_links for each row execute function public.guard_budget_m365_identity();

create function public.stamp_guard_budget_m365_link() returns trigger
language plpgsql set search_path=public as $$
declare
  v_parent uuid;
  v_parent_org uuid;
  v_parent_status public.budget_status;
begin
  if tg_op='UPDATE' and new.budget_version_id is distinct from old.budget_version_id then
    raise exception 'A budget reference cannot change its parent.' using errcode='23514';
  end if;
  if tg_op='DELETE' then v_parent:=old.budget_version_id; else v_parent:=new.budget_version_id; end if;
  if auth.uid() is not null and (not public.is_active_member()
     or public.auth_role() not in ('Admin','Executive','Project Manager','Finance')) then
    raise exception 'Cannot change evidence on this budget version.' using errcode='42501';
  end if;
  select v.org_id,v.status into v_parent_org,v_parent_status
    from public.budget_versions v where v.id=v_parent for update;
  if not found then
    if tg_op='DELETE' then return old; end if;
    raise exception 'Budget version is unavailable.' using errcode='23503';
  end if;
  if auth.uid() is not null then
    if v_parent_org is distinct from public.auth_org_id() then
      raise exception 'Cannot change evidence on this budget version.' using errcode='42501';
    end if;
    if v_parent_status is distinct from 'Draft'::public.budget_status then
      raise exception 'Cannot change evidence on this budget version.' using errcode='42501';
    end if;
    if tg_op='INSERT' then
      new.org_id:=public.auth_org_id();
      new.ms_linked_by:=auth.uid();
      new.ms_linked_at:=now();
    end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;
create trigger budget_version_document_links_m365_stamp_guard
  before insert or update or delete on public.budget_version_document_links
  for each row execute function public.stamp_guard_budget_m365_link();

create function public.stamp_guard_m365_settings() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'The settings organization is immutable.' using errcode='23514';
  end if;
  if auth.uid() is not null then
    new.org_id:=public.auth_org_id();
    new.updated_by:=auth.uid();
    new.updated_at:=now();
  end if;
  return new;
end; $$;
create trigger org_m365_settings_stamp_guard
  before insert or update on public.org_m365_document_settings
  for each row execute function public.stamp_guard_m365_settings();

revoke insert on public.project_documents,public.procurement_documents from authenticated;
grant insert (id,org_id,project_id,code,category,title,revision,status,doc_date,author_id,file_path,created_at,
  source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
  on public.project_documents to authenticated;
grant insert (id,org_id,procurement_id,type,reference_number,status,date,link,
  source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind)
  on public.procurement_documents to authenticated;

revoke update on public.project_documents from authenticated;
grant update (id,org_id,project_id,code,category,title,revision,doc_date,file_path,created_at,
  source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
  on public.project_documents to authenticated;
revoke update on public.procurement_documents from authenticated;
grant update (id,org_id,procurement_id,type,reference_number,status,date,link,
  source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind)
  on public.procurement_documents to authenticated;
