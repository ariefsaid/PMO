-- 2630_work_order_cloud_folders.sql — Work order SharePoint folder under project folder & scoped Project Administrator write rights.
-- Feature: docs/specs/work-order-cloud-folder.spec.md (TC-PA-13).
-- Rollback: supabase/migrations/rollback/2630_work_order_cloud_folders_down.sql.
-- Proven by: supabase/tests/2630_work_order_folder_and_upload.test.sql.
-- drops: single-predicate project folder lookups in m365_folder_linked_elsewhere (0338), m365_record_folder_candidates (0336),
--        m365_link_record_folder (0534), and link_m365_documents_batch (0763) now require work_order_id is null on project-level folders
--        so work-order folders do not count as project folders; role checks in guard_project_m365_source (0884),
--        m365_folder_linked_elsewhere (0338), m365_link_record_folder (0534), and m365_record_folder_created (0336) admit
--        project_administrator ONLY for non-null work_order_id / kind = 'work_order' (preserving all existing guards, active membership,
--        CLI block, light-account block, Draft/self-author, and category visibility).

-- ── §1 Schema, index & column grants ─────────────────────────────────────────────────────────────────────────────────────────────
alter table public.project_documents
  add column work_order_id uuid references public.work_orders(id) on delete set null;

comment on column public.project_documents.work_order_id is
  'Optional owning work order (set on INSERT only; immutable). NULL = project-level document or folder.';

create index project_documents_org_wo_idx
  on public.project_documents (org_id, work_order_id)
  where work_order_id is not null;

create index project_documents_wo_folder_idx
  on public.project_documents (org_id, work_order_id, ms_linked_at, id)
  where work_order_id is not null and source = 'onedrive' and ms_item_kind = 'folder';

-- Settable on INSERT only; UPDATE intentionally stays withheld so a document cannot move between project and work orders.
grant insert (work_order_id) on public.project_documents to authenticated;

-- ── §2 Gate helper (SECURITY INVOKER so projects_select and work_orders_select apply under caller RLS) ────────────────────────────
create function public.actor_may_write_work_order_document(
  p_org_id uuid,
  p_project_id uuid,
  p_work_order_id uuid
) returns boolean
  language sql stable set search_path = pg_catalog, public as $$
  select coalesce(
    public.is_active_member()
    and not public.actor_is_light()
    and public.actor_holds_job_role('project_administrator')                                            -- mut:pa_wo_role
    and p_work_order_id is not null                                                                     -- mut:pa_wo_required
    and p_org_id = public.auth_org_id()                                                                 -- mut:pa_wo_org
    and exists (
      select 1 from public.projects p
       where p.id = p_project_id and p.org_id = p_org_id
    )                                                                                                   -- mut:pa_wo_project_read
    and exists (
      select 1 from public.work_orders w
       where w.id = p_work_order_id and w.org_id = p_org_id and w.project_id = p_project_id
    ),                                                                                                  -- mut:pa_wo_belongs
    false
  );
$$;

comment on function public.actor_may_write_work_order_document(uuid, uuid, uuid) is
  'Project Administrator job role only: write Draft work-order documents (work_order_id not null) inside readable projects of the caller''s active org.';
revoke all on function public.actor_may_write_work_order_document(uuid, uuid, uuid) from public, anon;
grant execute on function public.actor_may_write_work_order_document(uuid, uuid, uuid) to authenticated, service_role;

-- ── §3 Work-order foreign-key integrity & immutability trigger ───────────────────────────────────────────────────────────────────
create function public.guard_project_document_work_order() returns trigger
  language plpgsql set search_path = pg_catalog, public as $$
begin
  if not public.actor_bypasses_rls() and tg_op = 'UPDATE' and new.work_order_id is distinct from old.work_order_id then
    raise exception 'Document work order cannot be changed.' using errcode = '42501';
  end if;
  if new.work_order_id is not null then
    if not exists (
      select 1 from public.work_orders w
       where w.id = new.work_order_id and w.org_id = new.org_id and w.project_id = new.project_id
    ) then
      raise exception 'Document work order does not match its project or organization.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_project_document_work_order() from public, anon, authenticated;
create trigger project_documents_work_order_guard
  before insert or update of work_order_id, project_id, org_id on public.project_documents
  for each row execute function public.guard_project_document_work_order();

-- ── §4 Trigger guard: guard_project_m365_source (restated from 0884) ────────────────────────────────────────────────────────────
create or replace function public.guard_project_m365_source() returns trigger
language plpgsql set search_path=public as $$
declare v_parent_org uuid;
begin
  if tg_op='INSERT' and new.file_path is not null and new.source is null then new.source:='upload'; end if;
  if public.actor_bypasses_rls() then return new; end if;
  -- 0884: a command-line sign-in never creates, changes or clears a Microsoft reference by a direct table write; it links
  -- only through link_m365_documents_batch (a definer function, which returns above), whose host check applies.
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ? 'client_id', false)
     and (new.source = 'onedrive' or (tg_op = 'UPDATE' and old.source = 'onedrive'))
     and (tg_op = 'INSERT' or (new.source, new.ms_drive_id, new.ms_item_id, new.ms_item_kind, new.ms_item_name, new.ms_web_url)
          is distinct from (old.source, old.ms_drive_id, old.ms_item_id, old.ms_item_kind, old.ms_item_name, old.ms_web_url)) then  -- 0884
    raise exception 'Cannot change this document reference.' using errcode='42501';  -- 0884
  end if;  -- 0884
  if not public.is_active_member()
     or (public.auth_role() not in ('Admin','Executive','Project Manager','Finance')
         and not public.actor_may_write_work_order_document(
           new.org_id,
           new.project_id,
           case when tg_op = 'UPDATE' then old.work_order_id else new.work_order_id end)) then           -- mut:pa_trigger_source
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
  if new.source='onedrive' and (
       (old.file_path is not null and not (old.source='upload' and new.file_path is null))
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

-- ── §5 Scoped RLS policies (per-command INSERT + UPDATE only; ZERO delete) ───────────────────────────────────────────────────────
create policy project_documents_wo_pa_insert on public.project_documents
  for insert to authenticated
  with check (
    (select public.is_active_member())
    and public.actor_may_write_work_order_document(org_id, project_id, work_order_id)
  );

create policy project_documents_wo_pa_update on public.project_documents
  for update to authenticated
  using (
    (select public.is_active_member())
    and status = 'Draft'::public.doc_status
    and author_id = (select auth.uid())
    and public.actor_may_write_work_order_document(org_id, project_id, work_order_id)
  )
  with check (
    (select public.is_active_member())
    and status = 'Draft'::public.doc_status
    and author_id = (select auth.uid())
    and public.actor_may_write_work_order_document(org_id, project_id, work_order_id)
  );

create policy storage_objects_project_doc_wo_pa_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-documents'::text
    and (select auth.uid()) is not null
    and split_part(name, '/'::text, 1) = ((select public.auth_org_id()))::text
    and array_length(string_to_array(name, '/'::text), 1) = 4
    and (select public.actor_holds_job_role('project_administrator'))                                   -- mut:pa_storage_role
    and exists (
      select 1 from public.project_documents pd
       where pd.id::text = split_part(objects.name, '/'::text, 3)
         and pd.org_id = (select public.auth_org_id())
         and pd.project_id::text = split_part(objects.name, '/'::text, 2)
         and pd.work_order_id is not null                                                               -- mut:pa_storage_wo_only
         and pd.status = 'Draft'::public.doc_status
         and public.actor_may_write_work_order_document(pd.org_id, pd.project_id, pd.work_order_id)
    )
  );

create policy storage_objects_project_doc_wo_pa_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-documents'::text
    and (select auth.uid()) is not null
    and split_part(name, '/'::text, 1) = ((select public.auth_org_id()))::text
    and array_length(string_to_array(name, '/'::text), 1) = 4
    and (select public.actor_holds_job_role('project_administrator'))
    and exists (
      select 1 from public.project_documents pd
       where pd.id::text = split_part(objects.name, '/'::text, 3)
         and pd.org_id = (select public.auth_org_id())
         and pd.project_id::text = split_part(objects.name, '/'::text, 2)
         and pd.work_order_id is not null
         and pd.status = 'Draft'::public.doc_status
         and public.actor_may_write_work_order_document(pd.org_id, pd.project_id, pd.work_order_id)
    )
  )
  with check (
    bucket_id = 'project-documents'::text
    and (select auth.uid()) is not null
    and split_part(name, '/'::text, 1) = ((select public.auth_org_id()))::text
    and array_length(string_to_array(name, '/'::text), 1) = 4
    and (select public.actor_holds_job_role('project_administrator'))
    and exists (
      select 1 from public.project_documents pd
       where pd.id::text = split_part(objects.name, '/'::text, 3)
         and pd.org_id = (select public.auth_org_id())
         and pd.project_id::text = split_part(objects.name, '/'::text, 2)
         and pd.work_order_id is not null
         and pd.status = 'Draft'::public.doc_status
         and public.actor_may_write_work_order_document(pd.org_id, pd.project_id, pd.work_order_id)
    )
  );

-- ── §6 M365 record-folder RPCs (restated from 0338, 0534, 0336, 0763) ─────────────────────────────────────────────────────────────
create or replace function public.m365_folder_linked_elsewhere(p_kind text,p_record_id uuid,p_drive_id text,p_item_id text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_org uuid;
begin
  v_org:=public.auth_org_id();
  if v_org is null or not public.is_active_member() then return false; end if;
  if public.auth_role()::text not in ('Admin','Executive','Project Manager','Finance')
     and not (p_kind='work_order' and not public.actor_is_light() and public.actor_holds_job_role('project_administrator')) then
    return false;
  end if;
  if p_kind='project' then
    return exists(select 1 from public.project_documents d where d.org_id=v_org and d.source='onedrive'
      and d.ms_item_kind='folder' and d.ms_drive_id=p_drive_id and d.ms_item_id=p_item_id
      and d.work_order_id is null and d.project_id<>p_record_id);
  elsif p_kind='work_order' then
    return exists(select 1 from public.project_documents d where d.org_id=v_org and d.source='onedrive'
      and d.ms_item_kind='folder' and d.ms_drive_id=p_drive_id and d.ms_item_id=p_item_id
      and (d.work_order_id is null or d.work_order_id<>p_record_id));
  elsif p_kind='procurement' then
    return exists(select 1 from public.procurement_documents d where d.org_id=v_org and d.source='onedrive'
      and d.ms_item_kind='folder' and d.ms_drive_id=p_drive_id and d.ms_item_id=p_item_id and d.procurement_id<>p_record_id);
  end if;
  return false;
end $$;
revoke all on function public.m365_folder_linked_elsewhere(text,uuid,text,text) from public,anon;
grant execute on function public.m365_folder_linked_elsewhere(text,uuid,text,text) to authenticated;

create or replace function public.m365_link_record_folder(
  p_kind text, p_record_id uuid, p_reference jsonb,
  p_default_site_id text, p_default_drive_id text, p_settings_updated_at timestamptz
) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  v_org uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_project_id uuid;
  v_existing uuid;
  v_id uuid;
  v_drive text;
  v_item text;
  v_url text;
  v_name text;
  v_shared boolean;
begin
  if not public.is_active_member() or public.actor_is_light() then raise insufficient_privilege; end if;
  if v_role not in ('Admin','Executive','Project Manager','Finance')
     and not (p_kind = 'work_order' and public.actor_holds_job_role('project_administrator')) then         -- mut:pa_link_wo_only
    raise insufficient_privilege;
  end if;

  if p_kind not in ('project','procurement','work_order') or p_record_id is null
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
     where d.project_id=p_record_id and d.org_id=v_org and d.work_order_id is null
       and d.source='onedrive' and d.ms_item_kind='folder'
     order by d.ms_linked_at,d.id limit 1;
  elsif p_kind='work_order' then
    select w.project_id into v_project_id
      from public.work_orders w
      join public.projects p on p.id = w.project_id and p.org_id = w.org_id
     where w.id = p_record_id and w.org_id = v_org;
    if v_project_id is null then raise insufficient_privilege; end if;
    select d.id into v_existing from public.project_documents d
     where d.work_order_id=p_record_id and d.org_id=v_org and d.source='onedrive' and d.ms_item_kind='folder'
     order by d.ms_linked_at,d.id limit 1;
  else
    if not exists(select 1 from public.procurements p where p.id=p_record_id and p.org_id=v_org) then raise insufficient_privilege; end if;
    select d.id into v_existing from public.procurement_documents d
     where d.procurement_id=p_record_id and d.org_id=v_org and d.source='onedrive' and d.ms_item_kind='folder'
     order by d.ms_linked_at,d.id limit 1;
  end if;
  -- 0534: SECURITY INVOKER, so the gate uses the client-callable RLS hook and raises the same typed refusal.
  if not public.org_feature_enabled(v_org, 'm365_integration') then
    raise exception 'feature_off' using errcode = 'P0001', detail = 'm365_integration';
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
  elsif p_kind='work_order' then
    insert into public.project_documents(project_id,work_order_id,category,title,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
    values(v_project_id,p_record_id,'Reference',v_name,auth.uid(),'onedrive',v_drive,v_item,v_url,v_name,'folder') returning id into v_id;
  else
    insert into public.procurement_documents(procurement_id,type,status,link,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind)
    values(p_record_id,'Microsoft reference','Draft',v_url,'onedrive',v_drive,v_item,v_name,'folder') returning id into v_id;
  end if;
  return jsonb_build_object('document_id',v_id,'state','linked');
end $$;
revoke all on function public.m365_link_record_folder(text,uuid,jsonb,text,text,timestamptz) from public,anon;
grant execute on function public.m365_link_record_folder(text,uuid,jsonb,text,text,timestamptz) to authenticated;

create or replace function public.m365_record_folder_created(p_actor_id uuid,p_kind text,p_record_id uuid,p_drive_id text,p_item_id text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_org uuid; v_role text; v_built_in_role text;
begin
  if p_actor_id is null or p_kind not in ('project','procurement','work_order') or p_record_id is null
     or nullif(btrim(p_drive_id),'') is null or nullif(btrim(p_item_id),'') is null then
    raise exception using errcode='22023',message='invalid creation receipt';
  end if;
  perform public.assert_is_active_member(p_actor_id);
  select p.org_id,p.role::text,p.built_in_role into v_org,v_role,v_built_in_role from public.profiles p where p.id=p_actor_id;
  if v_role not in ('Admin','Executive','Project Manager','Finance')
     and not (p_kind='work_order' and v_built_in_role='project_administrator') then
    raise insufficient_privilege;
  end if;
  if p_kind='project' then
    if not exists(select 1 from public.projects p where p.id=p_record_id and p.org_id=v_org) then raise insufficient_privilege; end if;
  elsif p_kind='work_order' then
    if not exists(select 1 from public.work_orders w where w.id=p_record_id and w.org_id=v_org) then raise insufficient_privilege; end if;
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

create or replace function public.m365_record_folder_candidates(p_kind text,p_after uuid default null)
returns table(id uuid) language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if not public.is_active_member() or public.auth_role()::text<>'Admin' then raise insufficient_privilege; end if;
  if p_kind='project' then
    return query select p.id from public.projects p where p.org_id=public.auth_org_id() and (p_after is null or p.id>p_after)
      and not exists(select 1 from public.project_documents d where d.org_id=p.org_id and d.project_id=p.id
        and d.work_order_id is null and d.source='onedrive' and d.ms_item_kind='folder')
      order by p.id limit 6;
  elsif p_kind='procurement' then
    return query select p.id from public.procurements p where p.org_id=public.auth_org_id() and (p_after is null or p.id>p_after)
      and not exists(select 1 from public.procurement_documents d where d.org_id=p.org_id and d.procurement_id=p.id and d.source='onedrive' and d.ms_item_kind='folder')
      order by p.id limit 6;
  else raise exception using errcode='22023',message='invalid record kind'; end if;
end $$;
revoke all on function public.m365_record_folder_candidates(text,uuid) from public,anon;
grant execute on function public.m365_record_folder_candidates(text,uuid) to authenticated;

create or replace function public.link_m365_documents_batch(p_rows jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_org uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_row jsonb;
  v_target_count integer;
  v_state text;
  v_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_lock text;
  v_new uuid[] := '{}';
begin
  perform public.assert_not_light();
  if not public.is_active_member() or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise insufficient_privilege;
  end if;
  perform public.assert_feature_on(v_org, 'm365_integration');

  if v_org is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>500 then
    raise exception using errcode='22023',message='p_rows must contain 1 to 500 rows';
  end if;
  -- Links must point at the org's own SharePoint host (0372: the shared rule). Asked once before any row is read, so an
  -- organisation with no library is refused m365_not_configured whatever the rows hold.
  perform public.sharepoint_url_on_org_host(v_org, null);

  -- 0763: serialise per record (first lock), matching m365_link_record_folder (0338). The id is normalised through uuid::text
  -- (0338 keys on p_record_id::text), so an upper-case or unhyphenated id still takes the same lock.
  -- Taken up front in deterministic key order so two concurrent batches or a batch racing with
  -- m365_link_record_folder can never deadlock. Lock order: record, then folder.
  for v_lock in
    select distinct ('m365-record-folder:'||rec.kind||':'||rec.id) collate "C"
      from jsonb_array_elements(p_rows) r,
      lateral (
        select 'project' as kind, case when pg_input_is_valid(r->>'project_id','uuid') then (r->>'project_id')::uuid::text else r->>'project_id' end as id
          where r ? 'project_id' and r->>'project_id' is not null
        union all
        select 'procurement' as kind, case when pg_input_is_valid(r->>'procurement_id','uuid') then (r->>'procurement_id')::uuid::text else r->>'procurement_id' end as id
          where r ? 'procurement_id' and r->>'procurement_id' is not null
      ) rec
     where jsonb_typeof(r)='object' and r->>'kind'='folder'
     order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock,0));
  end loop;

  -- 0375 / 0763: serialise per folder (second lock, always taken after the record lock).
  for v_lock in
    select distinct ('m365-folder-item:'||v_org::text||':'||(r->>'drive_id')||':'||(r->>'item_id')) collate "C"
      from jsonb_array_elements(p_rows) r
     where jsonb_typeof(r)='object' and r->>'kind'='folder' and (r ? 'project_id' or r ? 'procurement_id')
       and r->>'drive_id' is not null and r->>'item_id' is not null
     order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock,0));
  end loop;

  -- 0375: a dry run performs every real insert inside this block and then rolls the block back.
  begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_n := v_n + 1;
    v_target_count := (case when v_row ? 'project_id' then 1 else 0 end)
      + (case when v_row ? 'budget_version_id' then 1 else 0 end)
      + (case when v_row ? 'procurement_id' then 1 else 0 end);
    if v_target_count<>1 or jsonb_typeof(v_row)<>'object'
      or v_row - array['project_id','budget_version_id','procurement_id','drive_id','item_id','web_url','name','kind']::text[] <> '{}'::jsonb
      or nullif(btrim(v_row->>'drive_id'),'') is null or nullif(btrim(v_row->>'item_id'),'') is null
      or nullif(btrim(v_row->>'name'),'') is null or coalesce(v_row->>'kind','') not in ('file','folder')  -- 0375: a missing kind is refused
      or not public.m365_browser_url_valid(v_row->>'web_url') then
      raise exception using errcode='22023',message=format('invalid document link row %s',v_n);
    end if;
    if not public.sharepoint_url_on_org_host(v_org, v_row->>'web_url') then
      raise exception using errcode='22023',message=format('web_url host is not the organisation SharePoint host (row %s)',v_n);
    end if;
    v_id := null;
    if v_row ? 'project_id' then
      if not exists(select 1 from public.projects where id=(v_row->>'project_id')::uuid and org_id=v_org) then raise insufficient_privilege; end if;
      select id into v_id from public.project_documents where project_id=(v_row->>'project_id')::uuid
        and org_id=v_org and work_order_id is null and source='onedrive' and ms_drive_id=v_row->>'drive_id' and ms_item_id=v_row->>'item_id' limit 1;
      if v_id is not null then v_state:='already_linked'; else
        -- 0763: one-folder-per-record rule from 0338's canonical RPC: refuse a second folder for a record that already has one.
        if v_row->>'kind'='folder' and exists(select 1 from public.project_documents where project_id=(v_row->>'project_id')::uuid
          and org_id=v_org and work_order_id is null and source='onedrive' and ms_item_kind='folder') then
          raise exception using errcode='23514',message='project already has a folder';
        end if;
        if v_row->>'kind'='folder' and public.m365_folder_linked_elsewhere('project',(v_row->>'project_id')::uuid,v_row->>'drive_id',v_row->>'item_id') then
          raise exception using errcode='23514',message='folder already linked to another project';
        end if;
        v_state:='linked';
        -- 0375: inserted on a dry run too, then rolled back with the block
        insert into public.project_documents(project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
        values((v_row->>'project_id')::uuid,'Reference',v_row->>'name','Draft',auth.uid(),'onedrive',v_row->>'drive_id',v_row->>'item_id',v_row->>'web_url',v_row->>'name',v_row->>'kind') returning id into v_id;
        v_new := v_new || v_id;  -- 0375
      end if;
    elsif v_row ? 'budget_version_id' then
      if not exists(select 1 from public.budget_versions b join public.projects p on p.id=b.project_id
        where b.id=(v_row->>'budget_version_id')::uuid and p.org_id=v_org and b.status='Draft') then raise insufficient_privilege; end if;
      select id into v_id from public.budget_version_document_links where budget_version_id=(v_row->>'budget_version_id')::uuid
        and org_id=v_org and ms_drive_id=v_row->>'drive_id' and ms_item_id=v_row->>'item_id' limit 1;
      if v_id is not null then v_state:='already_linked'; else
        v_state:='linked';
        -- 0375: inserted on a dry run too, then rolled back with the block
        insert into public.budget_version_document_links(budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
        values((v_row->>'budget_version_id')::uuid,v_row->>'drive_id',v_row->>'item_id',v_row->>'web_url',v_row->>'name',v_row->>'kind') returning id into v_id;
        v_new := v_new || v_id;  -- 0375
      end if;
    else
      if not exists(select 1 from public.procurements where id=(v_row->>'procurement_id')::uuid and org_id=v_org) then raise insufficient_privilege; end if;
      select id into v_id from public.procurement_documents where procurement_id=(v_row->>'procurement_id')::uuid
        and source='onedrive' and ms_drive_id=v_row->>'drive_id' and ms_item_id=v_row->>'item_id' limit 1;
      if v_id is not null then v_state:='already_linked'; else
        -- 0763: one-folder-per-record rule from 0338's canonical RPC: refuse a second folder for a record that already has one.
        if v_row->>'kind'='folder' and exists(select 1 from public.procurement_documents where procurement_id=(v_row->>'procurement_id')::uuid
          and org_id=v_org and source='onedrive' and ms_item_kind='folder') then
          raise exception using errcode='23514',message='purchase already has a folder';
        end if;
        if v_row->>'kind'='folder' and public.m365_folder_linked_elsewhere('procurement',(v_row->>'procurement_id')::uuid,v_row->>'drive_id',v_row->>'item_id') then
          raise exception using errcode='23514',message='folder already linked to another purchase';
        end if;
        v_state:='linked';
        -- 0375: inserted on a dry run too, then rolled back with the block
        insert into public.procurement_documents(procurement_id,type,status,link,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind)
        values((v_row->>'procurement_id')::uuid,'Microsoft reference','Draft',v_row->>'web_url','onedrive',v_row->>'drive_id',v_row->>'item_id',v_row->>'name',v_row->>'kind') returning id into v_id;
        v_new := v_new || v_id;  -- 0375
      end if;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('row',v_n,'state',v_state,
      'document_id',case when p_dry_run and v_id = any (v_new) then null else v_id end));  -- 0375
  end loop;
  if p_dry_run then
    raise exception using errcode='P0001',message='pmo_dry_run_complete';  -- 0375: rolls back this block's inserts
  end if;
  exception when sqlstate 'P0001' then  -- 0375
    if sqlerrm<>'pmo_dry_run_complete' then raise; end if;  -- 0375
  end;  -- 0375
  return jsonb_build_object('dry_run',p_dry_run,'results',v_results);
end;
$$;
revoke all on function public.link_m365_documents_batch(jsonb,boolean) from public,anon;
grant execute on function public.link_m365_documents_batch(jsonb,boolean) to authenticated;
