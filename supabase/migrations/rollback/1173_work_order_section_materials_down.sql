-- Reverses 1173_work_order_section_materials.sql (#2576). Refuses when sectioned requests or allocations exist: dropping
-- the column would silently re-file them under the work order alone.
do $$
begin
  if exists (select 1 from public.material_requests where section_id is not null)
     or exists (select 1 from public.work_order_section_material_plan) then
    raise exception 'cannot reverse 1099: sectioned material requests or allocations exist; remove them first';
  end if;
end $$;

-- 1001 bodies restored.
create or replace function public.mrq_save_draft(p_request_id uuid, p_header jsonb, p_lines jsonb, p_client_request_id uuid default null)
  returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); r public.material_requests; v_wo record; v_to uuid; v_needed date; v_id uuid;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  if p_request_id is null and p_client_request_id is not null then
    select x.id into v_id from public.material_requests x
     where x.org_id = v_org and x.created_by = v_uid and x.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if p_request_id is not null then
    select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
    if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
    if r.created_by <> v_uid then
      raise exception 'MRQ_NOT_AUTHOR: only the person who raised the request can change or submit it' using errcode = '42501'; end if;
    if r.status <> 'draft' then
      raise exception 'MRQ_NOT_DRAFT: only a draft request can be changed or submitted' using errcode = 'P0001'; end if;
  end if;
  select w.id, w.project_id, w.status into v_wo from public.work_orders w
   where w.id = nullif(p_header->>'work_order_id', '')::uuid and w.org_id = v_org;
  if v_wo.id is null then raise exception 'MRQ_WORK_ORDER: the work order is not in your organisation' using errcode = 'P0001'; end if;
  if v_wo.status not in ('Draft','Issued') then
    raise exception 'MRQ_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;
  v_needed := nullif(p_header->>'needed_by', '')::date;
  if v_needed is null then raise exception 'MRQ_INVALID: a request needs a needed-by date' using errcode = 'P0001'; end if;
  v_to := nullif(p_header->>'to_warehouse_id', '')::uuid;
  if v_to is not null and not exists (select 1 from public.stock_warehouses w
        where w.id = v_to and w.org_id = v_org and w.kind = 'site' and w.project_id = v_wo.project_id and w.archived_at is null) then
    raise exception 'MRQ_DESTINATION: the destination must be a site warehouse of the work order''s project' using errcode = 'P0001'; end if;
  if p_header->>'note' is not null and length(p_header->>'note') > 1000 then
    raise exception 'MRQ_INVALID: a note is 1000 characters at most' using errcode = 'P0001'; end if;
  perform public.mrq_validate_lines(v_org, p_lines);

  if p_request_id is null then
    insert into public.material_requests (org_id, number, work_order_id, project_id, to_warehouse_id, needed_by, note,
                                          client_request_id, created_by)
    values (v_org, public.next_procurement_doc_number(v_org, 'MRQ'), v_wo.id, v_wo.project_id, v_to, v_needed,
            nullif(btrim(p_header->>'note'), ''), p_client_request_id, v_uid)
    on conflict (org_id, created_by, client_request_id) where client_request_id is not null do nothing
    returning * into r;
    if r.id is null then                                                   -- lost a race to a concurrent replay
      select x.id into v_id from public.material_requests x
       where x.org_id = v_org and x.created_by = v_uid and x.client_request_id = p_client_request_id;
      return v_id;
    end if;
    perform public.mrq_log(r, 'created', null, 'draft', null, v_uid, null, null);
  else
    update public.material_requests
       set work_order_id = v_wo.id, project_id = v_wo.project_id, to_warehouse_id = v_to, needed_by = v_needed,
           note = nullif(btrim(p_header->>'note'), ''), updated_at = now()
     where id = r.id
    returning * into r;
    delete from public.material_request_lines where request_id = r.id;
  end if;
  insert into public.material_request_lines (org_id, request_id, line_no, item_id, quantity, over_plan_reason)
  select v_org, r.id, t.n::int, (t.e->>'item_id')::uuid, (t.e->>'quantity')::numeric, nullif(btrim(t.e->>'over_plan_reason'), '')
    from jsonb_array_elements(p_lines) with ordinality as t(e, n);
  return r.id;
end $$;

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

-- 1097 archive guard restored (tasks only).
create or replace function public.wos_archive_blockers(p_section_id uuid) returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select case when n > 0 then n::text || ' task(s) of this section are not done' end
    from (select count(*) as n from public.tasks t where t.section_id = p_section_id and t.status <> 'Done') x
$$;
drop function if exists public.work_order_section_material_check(uuid);
drop function if exists public.mrq_section_plan_for(uuid, uuid, uuid[], uuid);
drop function if exists public.mrq_section_prior_quantity(uuid, uuid, uuid);
drop function if exists public.mrq_section_plan_quantity(uuid, uuid);
drop trigger if exists zz_material_requests_section_locked on public.material_requests;
drop function if exists public.guard_material_request_section();
alter table public.material_request_lines drop column if exists section_plan_qty, drop column if exists section_prior_qty;
drop trigger if exists zz_material_requests_section on public.material_requests;
drop index if exists public.material_requests_section_status_idx;
alter table public.material_requests drop constraint if exists material_requests_section_wo_fk;
alter table public.material_requests drop column if exists section_id;
drop table if exists public.work_order_section_material_plan;
drop function if exists public.guard_section_material_plan();
drop function if exists public.audit_section_material_plan();
