-- Reversal for 0292_m365_document_linking.sql.
-- Refuse before changing anything if operationally linked state would be lost.
do $$
begin
  if exists(select 1 from public.project_documents where source='onedrive')
     or exists(select 1 from public.procurement_documents where source='onedrive')
     or exists(select 1 from public.budget_version_document_links)
     or exists(select 1 from public.org_m365_document_settings
       where num_nonnulls(default_site_id,default_site_name,default_drive_id,default_drive_name)>0) then
    raise exception 'Unlink Microsoft references and clear the default library before reversing this migration.'
      using errcode='23514';
  end if;
end $$;

-- Remove feature-owned triggers before their functions/tables.
drop trigger if exists project_document_m365_audit on public.project_documents;
drop trigger if exists procurement_document_m365_audit on public.procurement_documents;
drop trigger if exists budget_version_document_m365_audit on public.budget_version_document_links;
drop trigger if exists org_m365_document_settings_audit on public.org_m365_document_settings;
drop trigger if exists project_m365_guard on public.project_documents;
drop trigger if exists project_m365_stamp on public.project_documents;
drop trigger if exists project_m365_identity_guard on public.project_documents;
drop trigger if exists procurement_m365_guard on public.procurement_documents;
drop trigger if exists procurement_m365_stamp on public.procurement_documents;
drop trigger if exists procurement_m365_identity_guard on public.procurement_documents;
drop trigger if exists budget_m365_identity_guard on public.budget_version_document_links;
drop trigger if exists budget_version_document_links_m365_stamp_guard on public.budget_version_document_links;
drop trigger if exists org_m365_settings_stamp_guard on public.org_m365_document_settings;

-- Restore the pre-feature transition function from 0180_rpc_active_member_gate.sql.
create or replace function public.transition_document_status(p_doc_id uuid, p_to doc_status)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from      doc_status;
  v_org       uuid;
  v_author    uuid;
  v_parent_id uuid;
  v_uid       uuid      := auth.uid();
  v_role      user_role := auth_role();
  v_legal jsonb := jsonb_build_object(
    'Draft',      jsonb_build_array('Issued'),
    'Issued',     jsonb_build_array('Approved','Rejected'),
    'Approved',   jsonb_build_array('Closed'),
    'Rejected',   jsonb_build_array('Draft','Closed'),
    'Closed',     jsonb_build_array(),
    'Superseded', jsonb_build_array()
  );
begin
  perform public.assert_is_active_member();
  select status, org_id, author_id, parent_document_id
    into v_from, v_org, v_author, v_parent_id
    from public.project_documents where id = p_doc_id for update;
  if v_from is null then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to transition this document' using errcode = '42501';
  end if;
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal document transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;
  if p_to in ('Approved','Rejected') and v_uid is not distinct from v_author then
    raise exception 'separation of duties: cannot approve or reject your own document'
      using errcode = '42501';
  end if;
  update public.project_documents set status = p_to where id = p_doc_id;
  perform public.log_audit('project_document.transition', v_org, v_uid, p_doc_id,
    jsonb_build_object('from', v_from::text, 'to', p_to::text));
  if p_to = 'Approved' and v_parent_id is not null then
    perform 1 from public.project_documents where id = v_parent_id for update;
    update public.project_documents set status = 'Superseded'
      where id = v_parent_id and status in ('Issued','Approved');
  end if;
end; $$;
revoke all on function public.transition_document_status(uuid,doc_status) from public;
grant execute on function public.transition_document_status(uuid,doc_status) to authenticated;
revoke execute on function public.transition_document_status(uuid,doc_status) from anon;

-- Restore the ordinary CRUD audit trigger function exactly as defined in 0178.
create or replace function public.audit_project_document_update() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('project_document.update', new.org_id, auth.uid(), new.id,
    jsonb_build_object('status', new.status::text, 'author_id', new.author_id,
      'from_title', old.title, 'to_title', new.title,
      'from_code', old.code, 'to_code', new.code,
      'from_category', old.category, 'to_category', new.category,
      'from_revision', old.revision, 'to_revision', new.revision,
      'from_doc_date', old.doc_date, 'to_doc_date', new.doc_date,
      'from_file_path', old.file_path, 'to_file_path', new.file_path));
  return new;
end; $$;

-- Restore authenticated register privileges from the pre-0292 effective grants.
grant insert on public.project_documents to authenticated;
grant update (id,org_id,project_id,code,category,title,revision,doc_date,author_id,file_path,created_at)
  on public.project_documents to authenticated;
grant insert,update on public.procurement_documents to authenticated;

-- Drop feature RPCs and audit/guard helpers.
drop function if exists public.m365_claim_document_checks(uuid,uuid[]);
drop function if exists public.m365_commit_document_check(uuid,uuid,uuid,text,text,text,text,text,text,boolean);
drop function if exists public.m365_issue_document(uuid,uuid,text,text,text,text,text,text);
drop function if exists public.m365_refresh_reference(uuid,uuid,uuid,uuid,text,text,text,text);
drop function if exists public.audit_project_document_m365();
drop function if exists public.audit_procurement_document_m365();
drop function if exists public.audit_budget_version_document_m365();
drop function if exists public.audit_org_m365_document_settings();
drop function if exists public.guard_project_m365_source();
drop function if exists public.stamp_project_m365_source();
drop function if exists public.guard_procurement_m365_source();
drop function if exists public.stamp_procurement_m365_source();
drop function if exists public.guard_project_m365_identity();
drop function if exists public.guard_procurement_m365_identity();
drop function if exists public.guard_budget_m365_identity();
drop function if exists public.stamp_guard_budget_m365_link();
drop function if exists public.stamp_guard_m365_settings();

-- Remove new relations and register constraints/indexes/columns without touching legacy rows.
drop table public.org_m365_document_settings;
drop table public.budget_version_document_links;
alter table public.project_documents drop constraint project_documents_source_complete;
alter table public.procurement_documents drop constraint procurement_documents_source_complete;
drop index if exists public.m365_budget_parent_idx;
drop index if exists public.project_documents_ms_identity_idx;
drop index if exists public.procurement_documents_ms_identity_idx;
drop index if exists public.m365_budget_identity_idx;
alter table public.project_documents
  drop column source, drop column ms_drive_id, drop column ms_item_id, drop column ms_web_url,
  drop column ms_item_name, drop column ms_item_kind, drop column ms_linked_by, drop column ms_linked_at,
  drop column ms_last_verified_at, drop column ms_content_tag_at_issue, drop column ms_version_id_at_issue,
  drop column ms_drift_state, drop column ms_check_claim, drop column ms_check_claimed_at;
alter table public.procurement_documents
  drop column source, drop column ms_drive_id, drop column ms_item_id, drop column ms_item_name,
  drop column ms_item_kind, drop column ms_linked_by, drop column ms_linked_at, drop column ms_last_verified_at;
drop function public.m365_ref_complete(text,text,text,text,text,uuid,timestamptz);
drop function public.m365_browser_url_valid(text);
drop type public.doc_source;
