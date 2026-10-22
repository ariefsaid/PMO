-- Bind uploaded evidence paths and revision lineage to their owning records.

create or replace function public.guard_project_document_file_path() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Non-Draft rows and unauthorized callers retain the established row-policy denial.
  if tg_op = 'UPDATE' and not public.actor_bypasses_rls() and old.status <> 'Draft' then
    return new;
  end if;
  if new.file_path is not null and (
    split_part(new.file_path, '/', 1) is distinct from new.org_id::text or
    split_part(new.file_path, '/', 2) is distinct from new.project_id::text or
    split_part(new.file_path, '/', 3) is distinct from new.id::text or
    array_length(string_to_array(new.file_path, '/'), 1) <> 4
  ) then
    raise exception 'Document storage key does not match its record.' using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.guard_project_document_file_path() from public, anon, authenticated;
create trigger project_documents_zz_file_path_guard
before insert or update of file_path, id, org_id, project_id on public.project_documents
for each row execute function public.guard_project_document_file_path();

create or replace function public.guard_expense_receipt_file_path() returns trigger
language plpgsql set search_path = public as $$
declare
  v_org uuid;
  v_claimant uuid;
  v_status public.expense_claim_status;
begin
  select c.org_id, c.claimant_id, c.status into v_org, v_claimant, v_status
    from public.expense_claims c where c.id = new.claim_id;
  -- Leave inaccessible or non-editable claims to RLS so callers retain its established denial.
  if not found then return new; end if;
  if not public.actor_bypasses_rls() and (
    v_org is distinct from public.auth_org_id() or v_claimant is distinct from auth.uid()
    or v_status not in ('Draft','Rejected')
  ) then return new; end if;
  if v_org is null or new.org_id is distinct from v_org
     or split_part(new.file_path, '/', 1) is distinct from v_org::text
     or split_part(new.file_path, '/', 2) is distinct from new.claim_id::text
     or array_length(string_to_array(new.file_path, '/'), 1) <> 4 then
    raise exception 'Expense receipt storage key does not match its claim.' using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.guard_expense_receipt_file_path() from public, anon, authenticated;
create trigger expense_receipt_file_path_guard
before insert or update of file_path, claim_id on public.expense_claim_files
for each row execute function public.guard_expense_receipt_file_path();

-- Composite self-reference enforces tenant and project consistency for all writers.
alter table public.project_documents
  add constraint project_documents_id_org_project_key unique (id, org_id, project_id);
alter table public.project_documents
  add constraint project_documents_parent_org_project_fkey
  foreign key (parent_document_id, org_id, project_id)
  references public.project_documents (id, org_id, project_id)
  on delete set null (parent_document_id);

create or replace function public.transition_document_status(p_doc_id uuid, p_to public.doc_status)
returns void language plpgsql security definer set search_path=public as $$
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
end; $$;

-- Historical alias audit (run before applying in each environment):
-- select id, org_id, project_id, file_path from public.project_documents where file_path is not null
-- and (split_part(file_path,'/',1)<>org_id::text or split_part(file_path,'/',2)<>project_id::text or split_part(file_path,'/',3)<>id::text or array_length(string_to_array(file_path,'/'),1)<>4);
-- select f.id,f.claim_id,f.org_id,c.org_id as claim_org_id,f.file_path
-- from public.expense_claim_files f join public.expense_claims c on c.id=f.claim_id
-- where f.org_id is distinct from c.org_id or split_part(f.file_path,'/',1)<>c.org_id::text
-- or split_part(f.file_path,'/',2)<>f.claim_id::text or array_length(string_to_array(f.file_path,'/'),1)<>4;
-- Historical alias audit results are reported by the migration operator; no historical rows are rewritten.
