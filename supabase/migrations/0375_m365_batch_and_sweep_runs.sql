-- 0375_m365_batch_and_sweep_runs.sql — SharePoint batch linking and folder-sweep summary consistency.
-- (1) link_m365_documents_batch is redefined from its 0367 head body (changes marked 0375).
-- (2) The folder-sweep summary is kept per run and page: m365_record_folder_sweeps gains the run id and the last
--     accepted / next expected page cursors, and m365_record_folder_sweep_save (service-only) applies a page
--     atomically: a replayed page adds nothing and a page of an older run never appends to a newer run.
-- Rollback: supabase/migrations/rollback/0375_m365_batch_and_sweep_runs_down.sql.

-- One bounded, org-scoped SharePoint link RPC shared by the CLI and app surface. 0375 changes (marked) on 0367's body:
-- folder rows take the canonical per-folder lock (0338) in key order before the "linked elsewhere" check; a dry run
-- performs the real inserts and rolls them back, so it predicts exactly what the real call does; a missing kind is
-- refused. The SharePoint host block is 0367's, unchanged.
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
  v_host text;
  v_lock text;  -- 0375
  v_new uuid[] := '{}';  -- 0375: ids inserted by this call (hidden from a dry run's results)
begin
  if not public.is_active_member() or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise insufficient_privilege;
  end if;
  if v_org is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>500 then
    raise exception using errcode='22023',message='p_rows must contain 1 to 500 rows';
  end if;
  -- Links must point at the org's own SharePoint host: a Graph site id is `<host>,<collection>,<site>`.
  select lower(nullif(btrim(split_part(default_site_id,',',1)),'')) into v_host
    from public.org_m365_document_settings where org_id=v_org;
  if v_host is null or position('.' in v_host)=0 then
    raise exception using errcode='22023',message='m365_not_configured',
      hint='Choose the default SharePoint library in the app first';
  end if;
  -- 0375: serialise per folder with the same key as m365_link_record_folder (0338), every folder lock taken up front in
  -- one key order so the check below cannot interleave with another writer and two batches can never deadlock.
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
    if lower(substring(v_row->>'web_url' from '^https://([^/:?#]+)')) is distinct from v_host then
      raise exception using errcode='22023',message=format('web_url host is not the organisation SharePoint host (row %s)',v_n);
    end if;
    v_id := null;
    if v_row ? 'project_id' then
      if not exists(select 1 from public.projects where id=(v_row->>'project_id')::uuid and org_id=v_org) then raise insufficient_privilege; end if;
      select id into v_id from public.project_documents where project_id=(v_row->>'project_id')::uuid
        and org_id=v_org and source='onedrive' and ms_drive_id=v_row->>'drive_id' and ms_item_id=v_row->>'item_id' limit 1;
      if v_id is not null then v_state:='already_linked'; else
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
alter table public.m365_record_folder_sweeps
  add column run_id uuid,
  add column last_cursor jsonb,
  add column next_cursor jsonb;

-- Applies one sweep page to the org's summary. p_start begins a new run (replacing any earlier summary); otherwise the
-- page is added only when it belongs to the stored run and starts at the stored next cursor. Returns accepted |
-- replayed (already counted) | superseded (another run owns the summary) | out_of_order.
create or replace function public.m365_record_folder_sweep_save(
  p_org_id uuid, p_actor_id uuid, p_run_id uuid, p_start boolean,
  p_from jsonb, p_next jsonb, p_counts jsonb, p_unmatched jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare
  v_keys constant text[] := array['scanned','linked','needs_choice','missing','failed','skipped'];
  v_cap constant integer := 500;
  v_row public.m365_record_folder_sweeps%rowtype;
  v_ids text[];
  v_counts jsonb;
begin
  if p_org_id is null or p_actor_id is null or p_run_id is null or p_start is null
    or jsonb_typeof(p_from) is distinct from 'object'
    or (p_next is not null and jsonb_typeof(p_next) is distinct from 'object')
    or jsonb_typeof(p_counts) is distinct from 'object' or jsonb_typeof(p_unmatched) is distinct from 'array'
    or exists(select 1 from unnest(v_keys) k
               where jsonb_typeof(p_counts->k) is distinct from 'number' or (p_counts->>k)::numeric < 0) then
    raise exception using errcode='22023', message='invalid folder-sweep summary';
  end if;
  if not p_start then
    select * into v_row from public.m365_record_folder_sweeps where org_id=p_org_id for update;
    if not found or v_row.run_id is distinct from p_run_id then return 'superseded'; end if;
    -- Keyset cursors only move forward within a run: a page at or before the last accepted one is already counted.
    if v_row.last_cursor is not null
       and (case p_from->>'kind' when 'project' then 0 else 1 end, coalesce(p_from->>'after','') collate "C")
        <= (case v_row.last_cursor->>'kind' when 'project' then 0 else 1 end, coalesce(v_row.last_cursor->>'after','') collate "C") then
      return 'replayed';
    end if;
    if v_row.next_cursor is distinct from p_from then return 'out_of_order'; end if;
  end if;
  select array_agg(v order by o) into v_ids
    from (select v, min(o) o
            from jsonb_array_elements_text(
                   coalesce(case when p_start then null else v_row.unmatched end,'[]'::jsonb) || p_unmatched)
                 with ordinality t(v,o)
           group by v) s;
  select jsonb_object_agg(k, (case when p_start then 0 else coalesce((v_row.counts->>k)::bigint,0) end)
                             + (p_counts->>k)::bigint)
    into v_counts from unnest(v_keys) k;
  insert into public.m365_record_folder_sweeps as s
    (org_id,actor_id,run_id,state,counts,unmatched,unmatched_truncated,last_cursor,next_cursor,updated_at)
  values (p_org_id,p_actor_id,p_run_id,case when p_next is null then 'complete' else 'in_progress' end,v_counts,
    to_jsonb(coalesce(v_ids[1:v_cap],'{}'::text[])),
    (not p_start and coalesce(v_row.unmatched_truncated,false)) or coalesce(cardinality(v_ids),0) > v_cap,
    p_from,p_next,now())
  on conflict (org_id) do update set
    actor_id=excluded.actor_id, run_id=excluded.run_id, state=excluded.state, counts=excluded.counts,
    unmatched=excluded.unmatched, unmatched_truncated=excluded.unmatched_truncated,
    last_cursor=excluded.last_cursor, next_cursor=excluded.next_cursor, updated_at=excluded.updated_at;
  return 'accepted';
end;
$$;
revoke all on function public.m365_record_folder_sweep_save(uuid,uuid,uuid,boolean,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m365_record_folder_sweep_save(uuid,uuid,uuid,boolean,jsonb,jsonb,jsonb,jsonb) to service_role;
notify pgrst, 'reload config';
