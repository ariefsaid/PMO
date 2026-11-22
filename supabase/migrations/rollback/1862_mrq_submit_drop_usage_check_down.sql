-- Reverses 1862: the 1331 mrq_usage_check and the 1333 mrq_submit body (which calls it). Run before 1861's rollback.
create or replace function public.mrq_usage_check(p_request_id uuid) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r public.material_requests; v_p1 numeric; v_p2 numeric; v_pm uuid; v_notify uuid; l record; v_pct numeric; v_slot smallint;
  v_plan numeric; v_use numeric; v_label text; v_item text; v_unit text; v_rows integer;
begin
  select * into r from public.material_requests where id = p_request_id;
  if not found then return; end if;
  select s.usage_warn_pct_1, s.usage_warn_pct_2 into v_p1, v_p2 from public.material_request_settings s where s.org_id = r.org_id;
  if v_p1 is null and v_p2 is null then return; end if;                                                  -- mut:usage_unset  (default off)

  -- "The work order's engineer" is the project's manager until a work-order responsible person exists (spec, ruling 2026-11-21).
  select p.project_manager_id into v_pm from public.projects p where p.id = r.project_id and p.org_id = r.org_id;
  v_notify := case when v_pm is not null and v_pm is distinct from auth.uid()
                        and exists (select 1 from public.profiles pr where pr.id = v_pm and pr.org_id = r.org_id)
                        and public.is_active_member(v_pm)
                   then v_pm end;
  select coalesce(w.wo_number, w.title) into v_label from public.work_orders w where w.id = r.work_order_id;

  for l in select ml.item_id, ml.quantity from public.material_request_lines ml where ml.request_id = r.id order by ml.line_no loop
    v_plan := public.mrq_plan_quantity(r.work_order_id, l.item_id);
    v_use  := public.mrq_prior_quantity(r.work_order_id, l.item_id, r.id) + l.quantity;
    select i.name, u.code into v_item, v_unit from public.stock_items i join public.stock_units u on u.id = i.unit_id where i.id = l.item_id;
    for v_slot in 1..2 loop
      v_pct := case v_slot when 1 then v_p1 else v_p2 end;
      continue when v_pct is null;
      -- plan 0 and any use crosses every threshold; otherwise use >= pct percent of plan, in exact numeric.
      continue when not ((v_plan = 0 and v_use > 0) or (v_plan > 0 and v_use * 100 >= v_pct * v_plan));
      insert into public.material_request_usage_alerts (org_id, work_order_id, item_id, slot, pct, use_qty, plan_qty, request_id, notified_user_id)
      values (r.org_id, r.work_order_id, l.item_id, v_slot, v_pct, v_use, v_plan, r.id, v_notify)
      on conflict (work_order_id, item_id, slot) do nothing;                                              -- mut:usage_once
      get diagnostics v_rows = row_count;
      if v_rows = 1 and v_notify is not null then
        perform public.notify_workflow_user(r.org_id, v_notify, 'Material usage threshold reached',
          format('%s on work order %s has reached the %s%% usage threshold: %s of %s %s planned. Review before more is used.',
                 v_item, v_label, trim_scale(v_pct)::text, trim_scale(v_use)::text, trim_scale(v_plan)::text, v_unit),
          'warning', 'material_request', r.id, r.number);
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.mrq_usage_check(uuid) from public, anon, authenticated, service_role;

create or replace function public.mrq_submit(p_request_id uuid, p_client_request_id uuid default null) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); r public.material_requests; v_wo_status public.work_order_status;
  v_cutoff time; v_tz text; v_earliest date; l record; v_plan numeric; v_src text; v_prior numeric; v_over boolean := false;
  v_splan numeric; v_sprior numeric;
  v_round integer; v_steps integer;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
  if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
  if r.created_by <> v_uid then
    raise exception 'MRQ_NOT_AUTHOR: only the person who raised the request can change or submit it' using errcode = '42501'; end if;
  if p_client_request_id is not null and exists (
    select 1 from public.material_request_events e where e.request_id = r.id and e.action = 'submitted'
      and e.client_request_id = p_client_request_id
  ) then
    return;                                                                 -- FR-MRQ-004 replay, including earlier rounds
  end if;
  if r.status <> 'draft' then
    raise exception 'MRQ_NOT_DRAFT: only a draft request can be changed or submitted' using errcode = 'P0001'; end if;
  select w.status into v_wo_status from public.work_orders w where w.id = r.work_order_id;
  if v_wo_status not in ('Draft','Issued') then
    raise exception 'MRQ_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;

  select s.cutoff_time into v_cutoff from public.material_request_settings s where s.org_id = v_org;
  select o.default_timezone into v_tz from public.organizations o where o.id = v_org;
  v_earliest := public.mrq_cutoff_earliest(v_cutoff, v_tz, r.needed_by, now());
  if v_earliest is not null then
    raise exception 'MRQ_CUTOFF: requests for tomorrow close at %; the earliest date you can request is %',
      to_char(v_cutoff, 'HH24:MI'), v_earliest using errcode = 'P0001';
  end if;

  -- Serialize submissions sharing a work order before reading prior quantities.
  perform pg_advisory_xact_lock(hashtextextended('mrq-plan:' || r.work_order_id::text, 0));
  for l in select * from public.material_request_lines x where x.request_id = r.id order by x.line_no for update loop
    select f.plan_qty, f.plan_source into v_plan, v_src from public.mrq_plan_figure(r.work_order_id, l.item_id) f;
    v_prior := public.mrq_prior_quantity(r.work_order_id, l.item_id, r.id);
    if v_prior + l.quantity > v_plan then
      v_over := true;
      if l.over_plan_reason is null then                                                               -- mut:over_plan
        raise exception 'MRQ_OVER_PLAN_REASON: line % is over plan and needs a reason (1 to 500 characters)', l.line_no
          using errcode = '23514';
      end if;
    end if;
    -- #2576 FR-WOS-015: the section's own allocation, when one is set, is a second check beside the work order's;
    -- the stricter applies, and both ask for the one existing over-plan reason. A section with no allocation for the
    -- item is checked against the work order's plan only.
    v_splan := null; v_sprior := null;
    if r.section_id is not null then
      v_splan := public.mrq_section_plan_quantity(r.section_id, l.item_id);
      if v_splan is not null then
        v_sprior := public.mrq_section_prior_quantity(r.section_id, l.item_id, r.id);
        if v_sprior + l.quantity > v_splan then                                                          -- mut:section_plan
          v_over := true;
          if l.over_plan_reason is null then
            raise exception 'MRQ_OVER_PLAN_REASON: line % is over its section''s plan and needs a reason (1 to 500 characters)', l.line_no
              using errcode = '23514';
          end if;
        end if;
      end if;
    end if;
    update public.material_request_lines set plan_qty = v_plan, plan_source = v_src, prior_qty = v_prior,
           section_plan_qty = v_splan, section_prior_qty = v_sprior where id = l.id;
  end loop;

  perform public.mrq_usage_check(r.id);                                    -- 1332 carried: #2686 warns only; a no-op while both thresholds are unset

  v_round := r.round + 1;
  insert into public.material_request_steps (org_id, request_id, round, position, role, label, status)
  select v_org, r.id, v_round, row_number() over (order by c.position), c.role, c.label, 'waiting'
    from public.approval_chain_steps c
   where c.org_id = v_org and (not c.only_over_plan or v_over);
  get diagnostics v_steps = row_count;
  if v_steps = 0 then
    raise exception 'MRQ_NO_CHAIN: no approval chain is set up for material requests; ask an Admin' using errcode = 'P0001'; end if;
  update public.material_request_steps set status = 'open' where request_id = r.id and round = v_round and position = 1;
  update public.material_requests
     set status = 'pending', round = v_round, submitted_at = now(), submit_request_id = p_client_request_id,
         decided_at = null, updated_at = now()
   where id = r.id;
  insert into public.material_request_events (org_id, request_id, action, from_status, to_status, actor_id, client_request_id)
  values (v_org, r.id, 'submitted', 'draft', 'pending', v_uid, p_client_request_id);
end $$;
