-- 1332_mrq_submit_usage_check.sql — #2686 mrq_submit raises threshold crossings (FR-MUT-003).
-- Same body as 1001 plus one call after the plan loop. Proven by supabase/tests/mrq_usage_thresholds.test.sql.
-- REVERSE: supabase/migrations/rollback/1332_mrq_submit_usage_check_down.sql (restores the 1001 body).

create or replace function public.mrq_submit(p_request_id uuid, p_client_request_id uuid default null) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); r public.material_requests; v_wo_status public.work_order_status;
  v_cutoff time; v_tz text; v_earliest date; l record; v_plan numeric; v_prior numeric; v_over boolean := false;
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
    v_plan  := public.mrq_plan_quantity(r.work_order_id, l.item_id);
    v_prior := public.mrq_prior_quantity(r.work_order_id, l.item_id, r.id);
    if v_prior + l.quantity > v_plan then
      v_over := true;
      if l.over_plan_reason is null then                                                               -- mut:over_plan
        raise exception 'MRQ_OVER_PLAN_REASON: line % is over plan and needs a reason (1 to 500 characters)', l.line_no
          using errcode = '23514';
      end if;
    end if;
    update public.material_request_lines set plan_qty = v_plan, prior_qty = v_prior where id = l.id;
  end loop;

  perform public.mrq_usage_check(r.id);                                    -- #2686 warns only; a no-op while both thresholds are unset

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
