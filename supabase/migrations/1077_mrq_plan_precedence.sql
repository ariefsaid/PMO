-- 1077_mrq_plan_precedence.sql — #2577 consumable needs from usage standards: the plan figure a material request is checked against.
-- Spec docs/specs/consumable-usage-standards.spec.md (FR-CUS-011..013, OD-CUS-2/3) · plan docs/plans/2026-11-20-consumable-usage-standards.md (Migration C).
-- Proven by supabase/tests/cus_mrq_plan.test.sql (AC-CUS-008..010) and the existing mrq_* files. Tables in 1075/1076; 1001 is the base.
-- ⚑ APPROVAL PATH: ships alone. Reversible via supabase/migrations/rollback/1077_mrq_plan_precedence_down.sql.
--
-- Precedence (FR-CUS-011): the work order's consumable plan line for the item (planned = adjusted, else generated; a
-- line adjusted to 0 is a decision, not a gap), else the BoQ allowance figure exactly as 1001 computed it, else 0.
-- The over-plan test and the MRQ_OVER_PLAN_REASON raise in mrq_submit are 1001's, byte for byte; only the figure
-- they compare against, and the snapshot of its source, change (OD-CUS-3: warn and require a reason, never block).
-- A submitted line keeps the figure it snapshotted (FR-CUS-013): only mrq_submit writes plan_qty / plan_source.

-- 1. the source beside the snapshot; null on requests submitted before this feature (no label shown for null).
alter table public.material_request_lines
  add column plan_source text constraint material_request_lines_plan_source_check check (plan_source in ('standard','adjusted','allowance','none'));

-- 2. the precedence, in one internal place.
create or replace function public.mrq_plan_figure(p_work_order_id uuid, p_item_id uuid)
  returns table (plan_qty numeric, plan_source text)
  language sql stable security definer set search_path = public, pg_temp as $$
  select p.pq, p.src from (
    select coalesce(pl.adjusted_qty, pl.generated_qty) as pq,
           case when pl.adjusted_qty is not null then 'adjusted' else 'standard' end as src, 1 as ord
      from public.work_order_consumable_plan_lines pl
     where pl.work_order_id = p_work_order_id and pl.item_id = p_item_id                                 -- mut:plan_first
    union all
    select a.q, 'allowance', 2
      from (select round(sum(al.planned_quantity
                             * case when b.quantity > 0 then least(wl.quantity / b.quantity, 1) else 1 end), 3) as q
              from public.work_order_lines wl
              join public.boq_items b on b.id = wl.boq_item_id and b.org_id = wl.org_id
              join public.boq_material_allowances al on al.boq_item_id = b.id and al.item_id = p_item_id and al.org_id = wl.org_id
             where wl.work_order_id = p_work_order_id
            having count(al.id) > 0) a
    union all
    select 0.000::numeric, 'none', 3
  ) p order by p.ord limit 1
$$;

-- 3. same signature and result as 1001 for every caller that does not need the source.
create or replace function public.mrq_plan_quantity(p_work_order_id uuid, p_item_id uuid) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select f.plan_qty from public.mrq_plan_figure(p_work_order_id, p_item_id) f
$$;

-- 4. mrq_submit: 1001's body with the figure and its source read from mrq_plan_figure and the source snapshotted.
create or replace function public.mrq_submit(p_request_id uuid, p_client_request_id uuid default null) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); r public.material_requests; v_wo_status public.work_order_status;
  v_cutoff time; v_tz text; v_earliest date; l record; v_plan numeric; v_src text; v_prior numeric; v_over boolean := false;
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
    update public.material_request_lines set plan_qty = v_plan, plan_source = v_src, prior_qty = v_prior where id = l.id;
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

-- 5. mrq_plan_for returns the source with the figure; a changed result type cannot be create-or-replaced.
drop function if exists public.mrq_plan_for(uuid, uuid[], uuid);
create or replace function public.mrq_plan_for(p_work_order_id uuid, p_item_ids uuid[], p_exclude_request uuid default null)
  returns table (item_id uuid, plan_qty numeric, prior_qty numeric, plan_source text)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or not public.is_active_member() then return; end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then return; end if;
  if coalesce(array_length(p_item_ids, 1), 0) > 200 then
    raise exception 'MRQ_INVALID: 200 items at most' using errcode = 'P0001'; end if;
  return query
  select i.id, f.plan_qty,
         public.mrq_prior_quantity(p_work_order_id, i.id, coalesce(p_exclude_request, '00000000-0000-0000-0000-000000000000'::uuid)),
         f.plan_source
    from public.stock_items i
    cross join lateral public.mrq_plan_figure(p_work_order_id, i.id) f
   where i.id = any(p_item_ids) and i.org_id = v_org;
end $$;

revoke all on function public.mrq_plan_figure(uuid, uuid), public.mrq_plan_quantity(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.mrq_plan_for(uuid, uuid[], uuid) from public, anon;
grant execute on function public.mrq_plan_for(uuid, uuid[], uuid) to authenticated;
