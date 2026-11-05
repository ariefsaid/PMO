-- #1472 S5: atomically fence a changed predecessor range before activating its successor.
-- Same-range whole-project revisions remain on the exact amend path; only changed mode/range queues removal.

alter table public.budget_archive_requests
  add column queued_by_activation boolean not null default false;

create function public.queue_budget_archive_cancel(
  p_version uuid, p_actor uuid, p_request uuid
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_project uuid;
  v_version_org uuid;
  v_status text;
  v_request public.budget_archive_requests%rowtype;
  v_candidate_names integer := 0;
  v_candidate_rows integer := 0;
  v_ineligible integer := 0;
  v_created integer := 0;
  v_jobs jsonb := '[]'::jsonb;
begin
  if p_actor is null or p_actor is distinct from auth.uid() or v_org is null
     or not public.is_active_member()
     or public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to queue budget cancellation' using errcode='42501';
  end if;
  select v.org_id, v.project_id into v_version_org, v_project
    from public.budget_versions v where v.id=p_version;
  if not found or v_version_org is distinct from v_org then
    raise exception 'budget version not found or not writable' using errcode='42501';
  end if;
  perform 1 from public.projects p where p.id=v_project and p.org_id=v_org for update;
  if not found then raise exception 'budget version not found or not writable' using errcode='42501'; end if;
  select v.status into v_status from public.budget_versions v
   where v.id=p_version and v.org_id=v_org and v.project_id=v_project for update;
  if not found or v_status is distinct from 'Active' then
    raise exception 'only the Active predecessor can be queued for cancellation' using errcode='P0001';
  end if;
  select r.* into v_request from public.budget_archive_requests r
   where r.id=p_request and r.org_id=v_org and r.budget_version_id=p_version;
  if found then
    select coalesce(jsonb_agg(i.id order by i.id),'[]'::jsonb) into v_jobs
      from public.budget_archive_cancel_intents i where i.request_id=v_request.id;
    return jsonb_build_object('request_id',v_request.id,'cancel_erp',v_request.cancel_erp,
      'live_target_count',v_request.live_target_count,'intent_ids',v_jobs);
  end if;
  if exists (
    select 1 from public.external_command_outbox o
     where o.org_id=v_org and o.domain='budget'
       and (o.pmo_record_id=p_version::text or o.pmo_record_id like p_version::text || ':%')
       and o.state <> 'confirmed'
  ) then
    raise exception 'an ERPNext Budget command is unsettled; retry activation after it has completed' using errcode='P0001';
  end if;

  -- Keep the integrated 0575 inventory and its mirror lock order as the authority for witnesses.
  perform 1 from public.budget_version_account_erp_mirror m
   where m.org_id=v_org and m.budget_version_id=p_version order by m.id for update;
  perform 1 from public.budget_version_erp_mirror m
   where m.org_id=v_org and m.budget_version_id=p_version order by m.id for update;
  select count(distinct i.erp_budget_name)::integer,count(*)::integer
    into v_candidate_names,v_candidate_rows
    from public.budget_archive_target_inventory(p_version) i;
  select count(*)::integer into v_ineligible
    from public.budget_archive_target_inventory(p_version) i where not i.eligible;
  if exists (select 1 from public.budget_archive_target_inventory(p_version) i where i.reason='command-unsettled') then
    raise exception 'an ERPNext Budget command is unsettled; retry activation after it has completed' using errcode='P0001';
  end if;
  if v_ineligible > 0 then
    raise exception 'predecessor ERPNext Budget cancellation is not provably safe for every live target (% of % target(s) are ineligible)' ,v_ineligible,v_candidate_rows using errcode='P0001';
  end if;

  insert into public.budget_archive_requests
    (id,org_id,project_id,budget_version_id,requested_by,cancel_erp,live_target_count,queued_by_activation)
  values (p_request,v_org,v_project,p_version,p_actor,true,v_candidate_names,true)
  returning * into v_request;
  if v_candidate_rows > 0 then
    insert into public.budget_archive_cancel_intents
      (org_id,request_id,project_id,budget_version_id,source_kind,source_mirror_id,actor_user_id,
       fiscal_year,to_fiscal_year,erp_account,erp_budget_name,erp_modified,activated_at_witness,
       pushed_project_start_date,pushed_project_end_date)
    select v_org,v_request.id,v_project,p_version,i.source_kind,i.source_mirror_id,p_actor,
           i.fiscal_year,case when i.source_kind='account' then a.to_fiscal_year else null end,
           i.erp_account,i.erp_budget_name,case when i.source_kind='account' then a.erp_modified else null end,
           i.activated_at_witness,i.pushed_project_start_date,i.pushed_project_end_date
      from public.budget_archive_target_inventory(p_version) i
      left join public.budget_version_account_erp_mirror a
        on i.source_kind='account' and a.id=i.source_mirror_id and a.org_id=v_org
     where i.eligible;
    get diagnostics v_created=row_count;
    if v_created <> v_candidate_rows then
      raise exception 'ERPNext Budget cancellation inventory changed while activating; no cancellation was queued' using errcode='P0001';
    end if;
    update public.budget_version_account_erp_mirror m
       set budget_intent='remove',push_state='pending',push_error=null
      from public.budget_archive_cancel_intents i
     where i.request_id=v_request.id and i.source_kind='account' and i.source_mirror_id=m.id;
    update public.budget_version_erp_mirror m
       set push_state='pending',push_error=null
      from public.budget_archive_cancel_intents i
     where i.request_id=v_request.id and i.source_kind='legacy' and i.source_mirror_id=m.id;
    select coalesce(jsonb_agg(i.id order by i.id),'[]'::jsonb) into v_jobs
      from public.budget_archive_cancel_intents i where i.request_id=v_request.id;
    update public.budget_archive_requests set live_target_count=v_created where id=v_request.id;
    v_request.live_target_count := v_created;
  end if;
  return jsonb_build_object('request_id',v_request.id,'cancel_erp',v_request.cancel_erp,
    'live_target_count',v_request.live_target_count,'intent_ids',v_jobs);
end $$;
revoke all on function public.queue_budget_archive_cancel(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.activate_budget_version(version_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_initial_project uuid;
  v_initial_org uuid;
  v_project uuid;
  v_project_org uuid;
  v_project_start date;
  v_project_end date;
  v_org uuid;
  v_status budget_status;
  v_drafter uuid;
  v_sole_operator boolean := false;
  v_mode text;
  v_gap text;
  v_predecessor uuid;
  v_predecessor_mode text;
  v_predecessor_basis jsonb;
  v_successor_basis jsonb;
  v_changed_range boolean := false;
  v_live_count integer;
  v_request uuid := gen_random_uuid();
begin
  select project_id,org_id into v_initial_project,v_initial_org from public.budget_versions where id=version_id;
  if not found or v_initial_project is null then raise exception 'budget version not found' using errcode='P0002'; end if;
  if v_initial_org is distinct from auth_org_id() or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member() then raise exception 'not authorized' using errcode='42501'; end if;
  select org_id into v_project_org from public.projects where id=v_initial_project;
  if not found or v_project_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode='42501'; end if;
  select org_id,start_date,end_date into v_project_org,v_project_start,v_project_end
    from public.projects where id=v_initial_project for update;
  if not found then raise exception 'not authorized' using errcode='42501'; end if;
  select project_id,org_id,status,created_by,budget_mode into v_project,v_org,v_status,v_drafter,v_mode
    from public.budget_versions where id=version_id for update;
  if not found or v_project is null then raise exception 'budget version not found' using errcode='P0002'; end if;
  if v_project is distinct from v_initial_project then raise exception 'budget version project changed while activating' using errcode='P0001'; end if;
  if v_org is distinct from auth_org_id() or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member() then raise exception 'not authorized' using errcode='42501'; end if;
  if v_project_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode='42501'; end if;
  if exists (select 1 from public.budget_version_editors e where e.budget_version_id=version_id and e.user_id=auth.uid()) then
    select count(*)=1 and bool_or(p.id=auth.uid()) into v_sole_operator
      from public.profiles p where p.org_id=v_org and public.is_active_member(p.id);
    if not coalesce(v_sole_operator,false) then
      raise exception 'separation of duties: You edited this version, so someone else must activate it.' using errcode='42501';
    end if;
  end if;
  if v_drafter is not null and v_drafter=auth.uid() and not v_sole_operator then
    select count(*)=1 and bool_or(p.id=auth.uid()) into v_sole_operator
      from public.profiles p where p.org_id=v_org and public.is_active_member(p.id);
    if not coalesce(v_sole_operator,false) then
      raise exception 'separation of duties: the person who drafted a budget version cannot activate it' using errcode='42501';
    end if;
  end if;
  if v_drafter is null and auth_role() not in ('Admin','Finance') then
    raise exception 'a budget version with no recorded drafter can be activated by Admin or Finance only' using errcode='42501';
  end if;
  if v_status <> 'Draft' then raise exception 'only a Draft version can be activated' using errcode='P0001'; end if;
  if v_mode='whole_project' then
    select gap into v_gap from public.budget_distribution_gaps(version_id) as gaps(gap) order by gap limit 1;
    if v_gap is not null then raise exception 'budget distribution is incomplete for category %',v_gap using errcode='P0001'; end if;
    select p.basis into v_successor_basis from public.budget_distribution_plans p where p.budget_version_id=version_id;
    if v_successor_basis is null or jsonb_typeof(v_successor_basis->'years') is distinct from 'array' then
      raise exception 'whole-project budget basis is unresolved; save the verified fiscal-year range before activation' using errcode='P0001';
    end if;
    if jsonb_array_length(v_successor_basis->'years')=0
       or v_successor_basis->>'projectStart' is distinct from v_project_start::text
       or v_successor_basis->>'projectEnd' is distinct from v_project_end::text then
      raise exception 'whole-project budget basis is stale; resolve the current project dates and fiscal-year range before activation' using errcode='P0001';
    end if;
  end if;

  select count(*)::integer into v_live_count from public.budget_versions b
   where b.org_id=v_org and b.project_id=v_project and b.status='Active' and b.id<>version_id;
  if v_live_count > 1 then raise exception 'project has more than one Active budget predecessor' using errcode='P0001'; end if;
  select b.id,b.budget_mode into v_predecessor,v_predecessor_mode from public.budget_versions b
   where b.org_id=v_org and b.project_id=v_project and b.status='Active' and b.id<>version_id
   order by b.id for update;
  if found then
    if v_predecessor_mode is distinct from v_mode then
      v_changed_range := true;
    elsif v_mode='whole_project' then
      select p.basis into v_predecessor_basis from public.budget_distribution_plans p where p.budget_version_id=v_predecessor;
      v_changed_range := v_predecessor_basis is null
        or v_predecessor_basis->'projectStart' is distinct from v_successor_basis->'projectStart'
        or v_predecessor_basis->'projectEnd' is distinct from v_successor_basis->'projectEnd'
        or v_predecessor_basis->'years' is distinct from v_successor_basis->'years';
    end if;
    if v_changed_range then
      perform public.queue_budget_archive_cancel(v_predecessor,auth.uid(),v_request);
    end if;
    update public.budget_versions set status='Archived'
     where id=v_predecessor and org_id=v_org and project_id=v_project and status='Active';
    if not found then raise exception 'Active budget predecessor changed while activating' using errcode='P0001'; end if;
  end if;
  update public.budget_versions set status='Active',activated_at=now(),
      activation_basis=case when v_sole_operator then 'sole_operator' else 'standard' end
   where id=version_id and org_id=v_org and project_id=v_project and status='Draft';
  if not found then raise exception 'only a Draft version can be activated' using errcode='P0001'; end if;
end $$;
revoke all on function public.activate_budget_version(uuid) from public,anon;
grant execute on function public.activate_budget_version(uuid) to authenticated;
