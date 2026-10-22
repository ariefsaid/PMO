drop trigger if exists project_documents_zz_file_path_guard on public.project_documents;
drop function if exists public.guard_project_document_file_path();
drop trigger if exists expense_receipt_file_path_guard on public.expense_claim_files;
drop function if exists public.guard_expense_receipt_file_path();
alter table public.project_documents drop constraint if exists project_documents_parent_org_project_fkey;
alter table public.project_documents drop constraint if exists project_documents_id_org_project_key;

-- Restore the exact transition body from 0292_m365_document_linking.sql.
create or replace function public.transition_document_status(p_doc_id uuid, p_to public.doc_status)
  returns void language plpgsql security definer set search_path=public as $$
declare
  v_from public.doc_status;
  v_org uuid;
  v_author uuid;
  v_parent_id uuid;
  v_source public.doc_source;
  v_item_kind text;
  v_content_tag text;
  v_uid uuid:=auth.uid();
  v_role public.user_role:=auth_role();
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
revoke all on function public.transition_document_status(uuid, public.doc_status) from public;
grant execute on function public.transition_document_status(uuid, public.doc_status) to authenticated;
revoke execute on function public.transition_document_status(uuid, public.doc_status) from anon;
