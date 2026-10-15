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

alter table public.project_documents
  alter column source set default 'upload';

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
  add constraint project_documents_source_complete check (
    (
      (
        (source in ('upload') or (source is null and file_path is null))
        and num_nonnulls(ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at,
          ms_last_verified_at,ms_content_tag_at_issue,ms_version_id_at_issue,ms_drift_state,
          ms_check_claim,ms_check_claimed_at)=0
      )
      or (source='onedrive' and file_path is null and public.m365_ref_complete(
        ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
        and (ms_content_tag_at_issue is null or btrim(ms_content_tag_at_issue)<>'')
        and (ms_version_id_at_issue is null or btrim(ms_version_id_at_issue)<>'')
        and (ms_drift_state is null or ms_drift_state in ('clean','drifted','not_verified'))
        and (ms_drift_state is null or ms_drift_state='not_verified' or ms_content_tag_at_issue is not null)
        and ((ms_check_claim is null)=(ms_check_claimed_at is null))
        and (ms_item_kind='file' or num_nonnulls(ms_content_tag_at_issue,ms_version_id_at_issue,
          ms_drift_state,ms_check_claim,ms_check_claimed_at)=0))
    ) is true
  );

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
  updated_by uuid not null default auth.uid() references public.profiles(id),
  updated_at timestamptz not null default now(),
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
  if tg_op='INSERT' and new.file_path is not null and new.source is null then new.source:='upload'; end if;
  if public.actor_bypasses_rls() then return new; end if;
  if not public.is_active_member() or public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Cannot change this document reference.' using errcode='42501';
  end if;
  select p.org_id into v_parent_org from public.projects p where p.id=new.project_id;
  if v_parent_org is distinct from public.auth_org_id() or new.org_id is distinct from public.auth_org_id() then
    raise exception 'Cannot change this document reference.' using errcode='42501';
  end if;
  if tg_op='INSERT' then
    if new.source='onedrive' and (new.status<>'Draft' or (new.author_id is distinct from auth.uid()
       and public.auth_role()<>'Admin')) then
      raise exception 'Cannot change this document reference.' using errcode='42501';
    end if;
    return new;
  end if;
  if old.source='onedrive' and new.file_path is not null then
    raise exception 'Clear the Microsoft reference before uploading.' using errcode='23514',detail='m365-source-collision';
  end if;
  if new.source='onedrive' and (old.file_path is not null
     or (old.source is not null and old.source is distinct from 'upload')) then
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
  parent_document_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
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

alter table public.budget_version_document_links enable row level security;
alter table public.budget_version_document_links force row level security;
revoke all on public.budget_version_document_links from public,anon,authenticated;
grant select,delete on public.budget_version_document_links to authenticated;
grant insert (budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
  on public.budget_version_document_links to authenticated;
create policy m365_budget_links_select on public.budget_version_document_links for select to authenticated
  using (org_id=public.auth_org_id() and public.is_active_member()
    and exists(select 1 from public.budget_versions v where v.id=budget_version_id
      and v.org_id=public.auth_org_id()));
create policy m365_budget_links_insert on public.budget_version_document_links for insert to authenticated
  with check (org_id=public.auth_org_id() and public.is_active_member()
    and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists(select 1 from public.budget_versions v where v.id=budget_version_id
      and v.org_id=public.auth_org_id() and v.status='Draft'));
create policy m365_budget_links_delete on public.budget_version_document_links for delete to authenticated
  using (org_id=public.auth_org_id() and public.is_active_member()
    and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists(select 1 from public.budget_versions v where v.id=budget_version_id
      and v.org_id=public.auth_org_id() and v.status='Draft'));

alter table public.org_m365_document_settings enable row level security;
alter table public.org_m365_document_settings force row level security;
revoke all on public.org_m365_document_settings from public,anon,authenticated;
grant select on public.org_m365_document_settings to authenticated;
grant insert (default_site_id,default_site_name,default_drive_id,default_drive_name)
  on public.org_m365_document_settings to authenticated;
grant update (default_site_id,default_site_name,default_drive_id,default_drive_name)
  on public.org_m365_document_settings to authenticated;
create policy m365_settings_select on public.org_m365_document_settings for select to authenticated
  using (org_id=public.auth_org_id() and public.is_active_member());
create policy m365_settings_insert on public.org_m365_document_settings for insert to authenticated
  with check (org_id=public.auth_org_id() and public.is_active_member()
    and public.auth_role()='Admin');
create policy m365_settings_update on public.org_m365_document_settings for update to authenticated
  using (org_id=public.auth_org_id() and public.is_active_member() and public.auth_role()='Admin')
  with check (org_id=public.auth_org_id() and public.is_active_member() and public.auth_role()='Admin');

create or replace function public.audit_project_document_update() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if (new.status,new.author_id,new.title,new.code,new.category,new.revision,new.doc_date,new.file_path,
      new.project_id,new.parent_document_id)
     is not distinct from
     (old.status,old.author_id,old.title,old.code,old.category,old.revision,old.doc_date,old.file_path,
      old.project_id,old.parent_document_id) then
    return new;
  end if;
  perform public.log_audit('project_document.update',new.org_id,auth.uid(),new.id,
    jsonb_build_object('status',new.status::text,'author_id',new.author_id,
      'from_title',old.title,'to_title',new.title,'from_code',old.code,'to_code',new.code,
      'from_category',old.category,'to_category',new.category,'from_revision',old.revision,
      'to_revision',new.revision,'from_doc_date',old.doc_date,'to_doc_date',new.doc_date,
      'from_file_path',old.file_path,'to_file_path',new.file_path));
  return new;
end; $$;

create function public.audit_project_document_m365() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    if old.source='onedrive' then
      perform public.log_audit('project_document.m365_unlinked',old.org_id,auth.uid(),old.id,
        jsonb_build_object('project_id',old.project_id,'ms_drive_id',old.ms_drive_id,
          'ms_item_id',old.ms_item_id,'ms_item_kind',old.ms_item_kind));
    end if;
    return old;
  end if;
  if tg_op='INSERT' and new.source='onedrive' then
    perform public.log_audit('project_document.m365_linked',new.org_id,auth.uid(),new.id,
      jsonb_build_object('project_id',new.project_id,'ms_drive_id',new.ms_drive_id,
        'ms_item_id',new.ms_item_id,'ms_item_kind',new.ms_item_kind));
  elsif tg_op='UPDATE' and old.source is distinct from new.source then
    if new.source='onedrive' then
      perform public.log_audit('project_document.m365_linked',new.org_id,auth.uid(),new.id,
        jsonb_build_object('project_id',new.project_id,'ms_drive_id',new.ms_drive_id,
          'ms_item_id',new.ms_item_id,'ms_item_kind',new.ms_item_kind));
    elsif old.source='onedrive' and new.source is null then
      perform public.log_audit('project_document.m365_unlinked',old.org_id,auth.uid(),old.id,
        jsonb_build_object('project_id',old.project_id,'ms_drive_id',old.ms_drive_id,
          'ms_item_id',old.ms_item_id,'ms_item_kind',old.ms_item_kind));
    end if;
  end if;
  return new;
end; $$;

create function public.audit_procurement_document_m365() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    if old.source='onedrive' then
      perform public.log_audit('procurement_document.m365_unlinked',old.org_id,auth.uid(),old.id,
        jsonb_build_object('procurement_id',old.procurement_id,'ms_drive_id',old.ms_drive_id,
          'ms_item_id',old.ms_item_id,'ms_item_kind',old.ms_item_kind));
    end if;
    return old;
  end if;
  if tg_op='INSERT' and new.source='onedrive' then
    perform public.log_audit('procurement_document.m365_linked',new.org_id,auth.uid(),new.id,
      jsonb_build_object('procurement_id',new.procurement_id,'ms_drive_id',new.ms_drive_id,
        'ms_item_id',new.ms_item_id,'ms_item_kind',new.ms_item_kind));
  elsif tg_op='UPDATE' and old.source is distinct from new.source then
    if new.source='onedrive' then
      perform public.log_audit('procurement_document.m365_linked',new.org_id,auth.uid(),new.id,
        jsonb_build_object('procurement_id',new.procurement_id,'ms_drive_id',new.ms_drive_id,
          'ms_item_id',new.ms_item_id,'ms_item_kind',new.ms_item_kind));
    elsif old.source='onedrive' and new.source is null then
      perform public.log_audit('procurement_document.m365_unlinked',old.org_id,auth.uid(),old.id,
        jsonb_build_object('procurement_id',old.procurement_id,'ms_drive_id',old.ms_drive_id,
          'ms_item_id',old.ms_item_id,'ms_item_kind',old.ms_item_kind));
    end if;
  end if;
  return new;
end; $$;

create function public.audit_budget_version_document_m365() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    perform public.log_audit('budget_version_document_link.m365_linked',new.org_id,auth.uid(),new.id,
      jsonb_build_object('budget_version_id',new.budget_version_id,'ms_drive_id',new.ms_drive_id,
        'ms_item_id',new.ms_item_id,'ms_item_kind',new.ms_item_kind));
    return new;
  end if;
  perform public.log_audit('budget_version_document_link.m365_unlinked',old.org_id,auth.uid(),old.id,
    jsonb_build_object('budget_version_id',old.budget_version_id,'ms_drive_id',old.ms_drive_id,
      'ms_item_id',old.ms_item_id,'ms_item_kind',old.ms_item_kind));
  return old;
end; $$;

create function public.audit_org_m365_document_settings() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' or (old.default_site_id,old.default_drive_id) is distinct from (new.default_site_id,new.default_drive_id) then
    perform public.log_audit('m365.default_library_changed',new.org_id,auth.uid(),new.org_id,
      jsonb_build_object('from_site_id',case when tg_op='INSERT' then null else old.default_site_id end,
        'to_site_id',new.default_site_id,
        'from_drive_id',case when tg_op='INSERT' then null else old.default_drive_id end,
        'to_drive_id',new.default_drive_id));
  end if;
  return new;
end; $$;

revoke all on function public.audit_project_document_m365() from public,anon,authenticated;
revoke all on function public.audit_procurement_document_m365() from public,anon,authenticated;
revoke all on function public.audit_budget_version_document_m365() from public,anon,authenticated;
revoke all on function public.audit_org_m365_document_settings() from public,anon,authenticated;
create trigger project_document_m365_audit after insert or update or delete on public.project_documents
  for each row execute function public.audit_project_document_m365();
create trigger procurement_document_m365_audit after insert or update or delete on public.procurement_documents
  for each row execute function public.audit_procurement_document_m365();
create trigger budget_version_document_m365_audit after insert or delete on public.budget_version_document_links
  for each row execute function public.audit_budget_version_document_m365();
create trigger org_m365_document_settings_audit after insert or update on public.org_m365_document_settings
  for each row execute function public.audit_org_m365_document_settings();

create or replace function public.transition_document_status(p_doc_id uuid, p_to doc_status)
  returns void language plpgsql security definer set search_path=public as $$
declare
  v_from doc_status;
  v_org uuid;
  v_author uuid;
  v_parent_id uuid;
  v_source public.doc_source;
  v_item_kind text;
  v_content_tag text;
  v_uid uuid:=auth.uid();
  v_role user_role:=auth_role();
  v_legal jsonb:=jsonb_build_object(
    'Draft',jsonb_build_array('Issued'),'Issued',jsonb_build_array('Approved','Rejected'),
    'Approved',jsonb_build_array('Closed'),'Rejected',jsonb_build_array('Draft','Closed'),
    'Closed',jsonb_build_array(),'Superseded',jsonb_build_array());
begin
  perform public.assert_is_active_member();
  select status,org_id,author_id,parent_document_id,source,ms_item_kind,ms_content_tag_at_issue
    into v_from,v_org,v_author,v_parent_id,v_source,v_item_kind,v_content_tag
    from public.project_documents where id=p_doc_id for update;
  if v_from is null then raise exception 'document not found' using errcode='P0002'; end if;
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to transition this document' using errcode='42501';
  end if;
  if v_source='onedrive' and v_item_kind='folder' then
    raise exception 'Folders are reference-only entries.' using errcode='23514',detail='m365-folder-reference-only';
  end if;
  if v_source='onedrive' and v_item_kind='file' and v_from='Draft' and p_to='Issued' then
    raise exception 'Issue requires a server verification.' using errcode='23514',detail='m365-issue-check-required';
  end if;
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal document transition % -> %',v_from,p_to using errcode='P0001';
  end if;
  if p_to in ('Approved','Rejected') and v_uid is not distinct from v_author then
    raise exception 'separation of duties: cannot approve or reject your own document'
      using errcode='42501';
  end if;
  update public.project_documents set status=p_to where id=p_doc_id;
  perform public.log_audit('project_document.transition',v_org,v_uid,p_doc_id,
    jsonb_build_object('from',v_from::text,'to',p_to::text));
  if p_to='Approved' and v_parent_id is not null then
    perform 1 from public.project_documents where id=v_parent_id for update;
    update public.project_documents set status='Superseded'
      where id=v_parent_id and status in ('Issued','Approved');
  end if;
end; $$;

create function public.m365_claim_document_checks(p_actor_id uuid,p_ids uuid[])
returns setof public.project_documents language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_role public.user_role;
begin
  perform public.assert_is_active_member(p_actor_id);
  select org_id,role into v_org,v_role from public.profiles where id=p_actor_id and status='active';
  if p_actor_id is null or v_org is null or v_role not in ('Admin','Executive','Project Manager','Finance')
     or coalesce(cardinality(p_ids),0)>20 or exists(select 1 from unnest(p_ids) x where x is null) then
    raise exception 'Cannot check these documents.' using errcode='42501';
  end if;
  return query update public.project_documents d set ms_check_claim=gen_random_uuid(),ms_check_claimed_at=now()
    where d.id in (select x.id from public.project_documents x where x.id=any(p_ids)
      and x.org_id=v_org and x.source='onedrive' and x.ms_item_kind='file' and x.status<>'Draft'
      and (x.ms_last_verified_at is null or x.ms_last_verified_at<=now()-interval '24 hours')
      and (x.ms_check_claimed_at is null or x.ms_check_claimed_at<=now()-interval '60 seconds')
      order by x.id for update skip locked)
    returning d.*;
end; $$;

create function public.m365_commit_document_check(p_actor_id uuid,p_doc_id uuid,p_claim uuid,
 p_drive_id text,p_item_id text,p_baseline text,p_name text,p_url text,p_content_tag text,p_success boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_role public.user_role; d public.project_documents%rowtype;
begin
  perform public.assert_is_active_member(p_actor_id);
  select org_id,role into v_org,v_role from public.profiles where id=p_actor_id and status='active';
  if p_actor_id is null or v_org is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Cannot check this document.' using errcode='42501';
  end if;
  select * into d from public.project_documents where id=p_doc_id for update;
  if not found or d.org_id is distinct from v_org or d.source<>'onedrive' or d.ms_item_kind<>'file'
     or d.ms_check_claim is distinct from p_claim or d.ms_drive_id is distinct from p_drive_id
     or d.ms_item_id is distinct from p_item_id or d.ms_content_tag_at_issue is distinct from p_baseline then
    return false;
  end if;
  if p_success and nullif(btrim(p_content_tag),'') is not null
     and nullif(btrim(p_baseline),'') is not null and public.m365_browser_url_valid(p_url)
     and nullif(btrim(p_name),'') is not null then
    update public.project_documents set ms_drift_state=case when p_content_tag=p_baseline then 'clean' else 'drifted' end,
      ms_item_name=p_name,ms_web_url=p_url,ms_last_verified_at=now(),ms_check_claim=null,ms_check_claimed_at=null
      where id=p_doc_id;
  else
    update public.project_documents set ms_drift_state='not_verified',ms_check_claim=null,ms_check_claimed_at=null
      where id=p_doc_id;
  end if;
  return true;
end; $$;

create function public.m365_issue_document(p_actor_id uuid,p_doc_id uuid,p_drive_id text,p_item_id text,
 p_content_tag text,p_version_id text,p_name text,p_url text)
returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_role public.user_role; d public.project_documents%rowtype; v_drift text;
begin
  perform public.assert_is_active_member(p_actor_id);
  select org_id,role into v_org,v_role from public.profiles where id=p_actor_id and status='active';
  if p_actor_id is null or v_org is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Cannot issue this document.' using errcode='42501';
  end if;
  select * into d from public.project_documents where id=p_doc_id for update;
  if not found or d.org_id is distinct from v_org or d.source<>'onedrive' or d.ms_item_kind<>'file'
     or d.status<>'Draft' or d.ms_drive_id is distinct from p_drive_id or d.ms_item_id is distinct from p_item_id
     or not public.m365_browser_url_valid(p_url) or nullif(btrim(p_name),'') is null then
    raise exception 'Document source changed before Issue.' using errcode='23514',detail='m365-source-changed';
  end if;
  v_drift:=case when nullif(btrim(p_content_tag),'') is null then 'not_verified' else 'clean' end;
  update public.project_documents set status='Issued',ms_content_tag_at_issue=nullif(btrim(p_content_tag),''),
    ms_version_id_at_issue=nullif(btrim(p_version_id),''),ms_drift_state=v_drift,
    ms_item_name=p_name,ms_web_url=p_url,ms_check_claim=null,ms_check_claimed_at=null where id=p_doc_id;
  perform public.log_audit('project_document.transition',v_org,p_actor_id,p_doc_id,
    jsonb_build_object('from','Draft','to','Issued'));
end; $$;

create function public.m365_refresh_reference(p_actor_id uuid,p_project_document_id uuid,
 p_procurement_document_id uuid,p_budget_link_id uuid,p_drive_id text,p_item_id text,p_name text,p_url text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_role public.user_role; d public.project_documents%rowtype;
  p public.procurement_documents%rowtype; b public.budget_version_document_links%rowtype;
  v_parent_org uuid; v_status public.budget_status;
begin
  perform public.assert_is_active_member(p_actor_id);
  select org_id,role into v_org,v_role from public.profiles where id=p_actor_id and status='active';
  if p_actor_id is null or v_org is null or num_nonnulls(p_project_document_id,p_procurement_document_id,p_budget_link_id)<>1
     or not public.m365_browser_url_valid(p_url) or nullif(btrim(p_name),'') is null then
    raise exception 'Cannot refresh this reference.' using errcode='42501';
  end if;
  if p_project_document_id is not null then
    if v_role not in ('Admin','Executive','Project Manager','Finance') then return false; end if;
    select * into d from public.project_documents where id=p_project_document_id for update;
    if not found or d.org_id is distinct from v_org or d.source<>'onedrive'
      or d.ms_drive_id is distinct from p_drive_id or d.ms_item_id is distinct from p_item_id
      or d.status<>'Draft' or (d.author_id is distinct from p_actor_id and v_role<>'Admin') then return false; end if;
    update public.project_documents set ms_item_name=p_name,ms_web_url=p_url,ms_last_verified_at=now()
      where id=d.id;
    return true;
  elsif p_procurement_document_id is not null then
    if v_role not in ('Admin','Executive','Project Manager','Finance') then return false; end if;
    select * into p from public.procurement_documents where id=p_procurement_document_id for update;
    if not found or p.org_id is distinct from v_org or p.source<>'onedrive'
      or p.ms_drive_id is distinct from p_drive_id or p.ms_item_id is distinct from p_item_id then return false; end if;
    update public.procurement_documents set ms_item_name=p_name,link=p_url,ms_last_verified_at=now()
      where id=p.id;
    return true;
  else
    if v_role not in ('Admin','Executive','Project Manager','Finance') then return false; end if;
    select * into b from public.budget_version_document_links where id=p_budget_link_id for update;
    if not found or b.org_id is distinct from v_org or b.ms_drive_id is distinct from p_drive_id
      or b.ms_item_id is distinct from p_item_id then return false; end if;
    select org_id,status into v_parent_org,v_status from public.budget_versions
      where id=b.budget_version_id for update;
    if v_parent_org is distinct from v_org or v_status is distinct from 'Draft' then return false; end if;
    update public.budget_version_document_links set ms_item_name=p_name,ms_web_url=p_url,ms_last_verified_at=now()
      where id=b.id;
    return true;
  end if;
end; $$;

revoke all on function public.m365_claim_document_checks(uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.m365_commit_document_check(uuid,uuid,uuid,text,text,text,text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.m365_issue_document(uuid,uuid,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.m365_refresh_reference(uuid,uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.m365_claim_document_checks(uuid,uuid[]) to service_role;
grant execute on function public.m365_commit_document_check(uuid,uuid,uuid,text,text,text,text,text,text,boolean) to service_role;
grant execute on function public.m365_issue_document(uuid,uuid,text,text,text,text,text,text) to service_role;
grant execute on function public.m365_refresh_reference(uuid,uuid,uuid,uuid,text,text,text,text) to service_role;

create index m365_budget_parent_idx
  on public.budget_version_document_links(org_id,budget_version_id,ms_linked_at,id);
create index project_documents_ms_identity_idx
  on public.project_documents(org_id,ms_drive_id,ms_item_id) where source='onedrive';
create index procurement_documents_ms_identity_idx
  on public.procurement_documents(org_id,ms_drive_id,ms_item_id) where source='onedrive';
create index m365_budget_identity_idx
  on public.budget_version_document_links(org_id,ms_drive_id,ms_item_id);
