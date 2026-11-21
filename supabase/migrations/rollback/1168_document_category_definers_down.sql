-- Reverse of 1168: the two definers return to their pre-#2579 bodies.
CREATE OR REPLACE FUNCTION public.transition_document_status(p_doc_id uuid, p_to doc_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_from public.doc_status;
  v_org uuid;
  v_project uuid;
  v_author uuid;
  v_parent_id uuid;
  v_source public.doc_source;
  v_item_kind text;
  v_content_tag text;
  v_uid uuid := auth.uid();
  v_role public.user_role := public.auth_role();
  v_legal jsonb := jsonb_build_object(
    'Draft',jsonb_build_array('Issued'),'Issued',jsonb_build_array('Approved','Rejected'),
    'Approved',jsonb_build_array('Closed'),'Rejected',jsonb_build_array('Draft','Closed'),
    'Closed',jsonb_build_array(),'Superseded',jsonb_build_array());
begin
  perform public.assert_is_active_member();
  select status,org_id,project_id,author_id,parent_document_id,source,ms_item_kind,ms_content_tag_at_issue
    into v_from,v_org,v_project,v_author,v_parent_id,v_source,v_item_kind,v_content_tag
    from public.project_documents where id=p_doc_id for update;
  if v_from is null then raise exception 'document not found' using errcode='P0002'; end if;
  if v_org is distinct from public.auth_org_id() then raise exception 'not authorized' using errcode='42501'; end if;
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to transition this document' using errcode='42501';
  end if;
  if v_source='onedrive' and v_item_kind='folder' then raise exception 'Folders are reference-only entries.' using errcode='23514',detail='m365-folder-reference-only'; end if;
  if v_source='onedrive' and v_item_kind='file' and v_from='Draft' and p_to='Issued' then raise exception 'Issue requires a server verification.' using errcode='23514',detail='m365-issue-check-required'; end if;
  if not (v_legal -> v_from::text) ? p_to::text then raise exception 'illegal document transition % -> %',v_from,p_to using errcode='P0001'; end if;
  if p_to in ('Approved','Rejected') and v_uid is not distinct from v_author then raise exception 'separation of duties: cannot approve or reject your own document' using errcode='42501'; end if;
  update public.project_documents set status=p_to where id=p_doc_id and org_id=v_org and project_id=v_project;
  perform public.log_audit('project_document.transition',v_org,v_uid,p_doc_id,jsonb_build_object('from',v_from::text,'to',p_to::text));
  if p_to='Approved' and v_parent_id is not null then
    perform 1 from public.project_documents where id=v_parent_id and org_id=v_org and project_id=v_project for update;
    update public.project_documents set status='Superseded'
      where id=v_parent_id and org_id=v_org and project_id=v_project and status in ('Issued','Approved');
  end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.notify_workflow_user(p_org uuid, p_owner uuid, p_title text, p_body text, p_severity text, p_entity_type text, p_entity_id uuid, p_label text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Same org as the record AND an active member; never the acting user.
  if p_owner is null or p_owner is not distinct from auth.uid() then return; end if;
  if not exists (select 1 from public.profiles p where p.id = p_owner and p.org_id = p_org) then return; end if;
  if not public.is_active_member(p_owner) then return; end if;
  insert into public.notifications (org_id, owner_id, severity, title, body, metadata)
  values (p_org, p_owner, p_severity, p_title, nullif(p_body, ''),
          jsonb_build_object('entity', jsonb_build_object('type', p_entity_type, 'id', p_entity_id, 'label', p_label)));
end; $function$;
