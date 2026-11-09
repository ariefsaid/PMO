-- 0763_m365_batch_record_lock.sql — link_m365_documents_batch serialises per record (first lock) and per
-- folder (second lock, lock order record then folder matching 0338), and enforces the one-folder-per-record
-- rule: batch refuses a second folder for a record that already has one.
-- Reversible: supabase/migrations/rollback/0763_m365_batch_record_lock_down.sql.

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
        and org_id=v_org and source='onedrive' and ms_drive_id=v_row->>'drive_id' and ms_item_id=v_row->>'item_id' limit 1;
      if v_id is not null then v_state:='already_linked'; else
        -- 0763: one-folder-per-record rule from 0338's canonical RPC: refuse a second folder for a record that already has one.
        if v_row->>'kind'='folder' and exists(select 1 from public.project_documents where project_id=(v_row->>'project_id')::uuid
          and org_id=v_org and source='onedrive' and ms_item_kind='folder') then
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
