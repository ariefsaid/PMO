-- 1001_material_request_rpcs.sql — #2524 material requests: the ONLY writers, the approval rule, the transfer hook.
-- Spec docs/specs/material-requests.spec.md · plan docs/plans/2026-11-20-material-requests.md · tables in 1000.
-- Proven by supabase/tests/mrq_approval.test.sql (AC-MRQ-002..006, 010, 011, 013, 014) and
-- supabase/tests/mrq_submit_transfer.test.sql (AC-MRQ-001, 007, 008, 009, 012).
--
-- Reuse, not a new engine:
--   • SoD follows ADR-0019 exactly as transition_procurement / timesheet approval do: a security-definer RPC that
--     locks the record row (FOR UPDATE), re-reads state under the lock and refuses — the requester never decides a
--     step (0181's self-approval rule), one person decides at most one step of a round.
--   • Authority is the caller's real role from profiles (ADR-0016: never the impersonated view role) — the same
--     population check spend routing uses (0243 §5: active profile + role + not the requester). The spend router
--     itself is not called: it routes by money amount and budget line, and a material request carries neither.
--   • The approved request becomes a stock transfer DRAFT through the shipped create_stock_document (0413/0534):
--     keeper-or-Admin, feature gate, item and warehouse validation, numbering — all unchanged. The work order is
--     set on the draft through #2517's attribution rule trigger (check_cost_attribution), which refuses a
--     destination that is not a site of the work order's project. Nothing is posted here (OD-MRQ-5).
--
-- Mutation checks (run by hand, recorded in the build report): the lines tagged `-- mut:author`, `-- mut:twice`,
-- `-- mut:order` and `-- mut:standin_window` are each the single statement that enforces that rule.
--
-- REVERSE: supabase/migrations/rollback/1001_material_request_rpcs_down.sql.

-- ── internals (never client-callable) ─────────────────────────────────────────────────────────────────────────

-- Planned quantity of an item on a work order (OQ-MRQ-1, recorded in the spec): the BoQ material allowances
-- (0417, planned per BoQ line) of the BoQ lines this work order carries (0337 work_order_lines), prorated by the
-- share of the BoQ line's quantity the work order holds. No allowance → 0, so any request is over plan.
create or replace function public.mrq_plan_quantity(p_work_order_id uuid, p_item_id uuid) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select round(coalesce(sum(a.planned_quantity
                            * case when b.quantity > 0 then least(wl.quantity / b.quantity, 1) else 1 end), 0), 3)
    from public.work_order_lines wl
    join public.boq_items b on b.id = wl.boq_item_id and b.org_id = wl.org_id
    join public.boq_material_allowances a on a.boq_item_id = b.id and a.item_id = p_item_id and a.org_id = wl.org_id
   where wl.work_order_id = p_work_order_id
$$;

-- Quantity of an item already requested on a work order by OTHER live requests (pending, approved, fulfilled).
create or replace function public.mrq_prior_quantity(p_work_order_id uuid, p_item_id uuid, p_exclude_request uuid) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(l.quantity), 0)
    from public.material_request_lines l
    join public.material_requests r on r.id = l.request_id
   where r.work_order_id = p_work_order_id and l.item_id = p_item_id and r.id <> p_exclude_request
     and r.status in ('pending','approved','fulfilled')
$$;

-- FR-MRQ-014/015: the earliest needed-by date accepted at instant p_at, or NULL when p_needed_by is accepted.
-- Pure: the caller passes the clock (mrq_submit passes now()), so the rule is testable at exact times without a
-- client-settable clock. Today and earlier are never accepted; with a cut-off set, tomorrow is accepted only
-- before the cut-off (project-local time = the organisation's time zone; projects carry no zone of their own).
create or replace function public.mrq_cutoff_earliest(p_cutoff time, p_tz text, p_needed_by date, p_at timestamptz) returns date
  language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare v_local timestamp := p_at at time zone coalesce(p_tz, 'UTC'); v_earliest date;
begin
  v_earliest := v_local::date + 1;
  if p_cutoff is not null and v_local::time >= p_cutoff then
    v_earliest := v_local::date + 2;
  end if;
  if p_needed_by >= v_earliest then return null; end if;
  return v_earliest;
end $$;

-- Who may decide a step: the caller holding the step's role directly (acting_for = null), else the caller as an
-- in-window stand-in of an active same-org delegator who holds it directly (one hop: a stand-in's own stand-ins
-- are never followed, because only the delegator's DIRECT role is read). A delegator who raised the request
-- lends no authority over it.
create or replace function public.mrq_step_authority(p_org uuid, p_uid uuid, p_role public.user_role, p_author uuid,
                                                     out ok boolean, out acting_for uuid)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := public.stock_org_today(p_org);
begin
  ok := exists (select 1 from public.profiles p
                 where p.id = p_uid and p.org_id = p_org and p.status = 'active' and p.role = p_role);
  acting_for := null;
  if ok then return; end if;
  select s.delegator_id into acting_for
    from public.approval_stand_ins s
    join public.profiles d on d.id = s.delegator_id
   where s.org_id = p_org and s.stand_in_id = p_uid and s.revoked_at is null
     and v_today between s.starts_on and s.ends_on                                                    -- mut:standin_window
     and d.org_id = p_org and d.status = 'active' and d.role = p_role and d.id <> p_author
     and exists (select 1 from public.profiles me where me.id = p_uid and me.org_id = p_org and me.status = 'active')
   order by s.created_at, s.id
   limit 1;
  ok := acting_for is not null;
end $$;

create or replace function public.mrq_log(p_req public.material_requests, p_action text, p_from text, p_to text,
                                          p_step integer, p_actor uuid, p_acted_for uuid, p_reason text) returns void
  language sql volatile security definer set search_path = public, pg_temp as $$
  insert into public.material_request_events (org_id, request_id, action, from_status, to_status, step_position, actor_id, acted_for, reason)
  values (p_req.org_id, p_req.id, p_action, p_from, p_to, p_step, p_actor, p_acted_for, p_reason)
$$;

-- Validates lines and returns them normalised. Raises on the first bad line.
create or replace function public.mrq_validate_lines(p_org uuid, p_lines jsonb) returns void
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e jsonb; v_item record; v_q numeric; v_reason text; n integer := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'MRQ_INVALID: a request needs 1 to 200 lines' using errcode = 'P0001'; end if;
  if (select count(distinct x->>'item_id') from jsonb_array_elements(p_lines) x) <> jsonb_array_length(p_lines) then
    raise exception 'MRQ_INVALID: an item appears on more than one line' using errcode = 'P0001'; end if;
  for e in select x from jsonb_array_elements(p_lines) as x loop
    n := n + 1;
    select i.id, i.archived_at, u.whole_only into v_item
      from public.stock_items i join public.stock_units u on u.id = i.unit_id
     where i.id = nullif(e->>'item_id', '')::uuid and i.org_id = p_org;
    if v_item.id is null then raise exception 'MRQ_INVALID: line % names an item that is not in your organisation', n using errcode = 'P0001'; end if;
    if v_item.archived_at is not null then raise exception 'MRQ_INVALID: line % names an archived item', n using errcode = 'P0001'; end if;
    v_q := (e->>'quantity')::numeric;
    if v_q is null or v_q <= 0 or v_q <> round(v_q, 3) or v_q >= 100000000000::numeric then
      raise exception 'MRQ_INVALID: line % needs a quantity above 0 (3 decimals at most)', n using errcode = 'P0001'; end if;
    if v_item.whole_only and v_q <> trunc(v_q) then
      raise exception 'MRQ_INVALID: line % is counted in whole units', n using errcode = 'P0001'; end if;
    v_reason := e->>'over_plan_reason';
    if v_reason is not null and length(btrim(v_reason)) > 500 then
      raise exception 'MRQ_INVALID: line % has a reason longer than 500 characters', n using errcode = 'P0001'; end if;
  end loop;
end $$;

-- Creates the transfer draft for an approved request through the shipped stock path. Runs as the caller (the
-- final approver, or the keeper retrying), so create_stock_document's keeper-or-Admin rule applies to them.
create or replace function public.mrq_create_transfer_core(p_request_id uuid, p_source_warehouse_id uuid) returns uuid
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r public.material_requests; v_to uuid; v_doc uuid; v_lines jsonb;
begin
  select * into r from public.material_requests x where x.id = p_request_id;
  if p_source_warehouse_id is null then
    raise exception 'MRQ_SOURCE_REQUIRED: choose the warehouse the material leaves from' using errcode = 'P0001'; end if;
  v_to := r.to_warehouse_id;
  if v_to is null then
    select case when count(*) = 1 then min(w.id::text)::uuid end into v_to
      from public.stock_warehouses w
     where w.org_id = r.org_id and w.kind = 'site' and w.project_id = r.project_id and w.archived_at is null;
  end if;
  if v_to is null then
    raise exception 'MRQ_NO_DESTINATION: name the site warehouse this request goes to' using errcode = 'P0001'; end if;
  select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'quantity', l.quantity) order by l.line_no) into v_lines
    from public.material_request_lines l where l.request_id = r.id;
  v_doc := public.create_stock_document(
    jsonb_build_object('kind', 'transfer', 'warehouse_id', p_source_warehouse_id, 'to_warehouse_id', v_to,
                       'note', 'Material request ' || r.number),
    v_lines, false, null);
  -- #2517's rule trigger checks the work order belongs to the destination site's project.
  update public.stock_documents set work_order_id = r.work_order_id where id = v_doc;
  update public.material_requests
     set transfer_document_id = v_doc, transfer_cancelled = false, updated_at = now()
   where id = r.id;
  perform public.mrq_log(r, 'transfer_created', r.status, r.status, null, auth.uid(), null, null);
  return v_doc;
end $$;

-- ── configuration (Admin) ────────────────────────────────────────────────────────────────────────────────────

-- FR-MRQ-005: replace the org's chain atomically. In-flight requests keep their snapshot (FR-MRQ-006).
create or replace function public.mrq_set_chain(p_steps jsonb) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); e jsonb; n integer := 0; v_role public.user_role;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'MRQ_ADMIN_ONLY: only an Admin can change the approval chain' using errcode = '42501'; end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) > 10 then
    raise exception 'MRQ_INVALID: a chain has 0 to 10 steps' using errcode = 'P0001'; end if;
  delete from public.approval_chain_steps where org_id = v_org;
  for e in select x from jsonb_array_elements(p_steps) as x loop
    n := n + 1;
    begin v_role := (e->>'role')::public.user_role;
    exception when others then v_role := null; end;
    if v_role is null then raise exception 'MRQ_INVALID: step % names an unknown role', n using errcode = 'P0001'; end if;
    if nullif(btrim(e->>'label'), '') is null or length(btrim(e->>'label')) > 80 then
      raise exception 'MRQ_INVALID: step % needs a label (1 to 80 characters)', n using errcode = 'P0001'; end if;
    insert into public.approval_chain_steps (org_id, position, role, label, only_over_plan)
    values (v_org, n, v_role, btrim(e->>'label'), coalesce((e->>'only_over_plan')::boolean, false));
  end loop;
  perform public.log_audit('material_request.chain_set', v_org, v_uid, null, jsonb_build_object('steps', p_steps));
end $$;

-- FR-MRQ-014: the optional daily cut-off. NULL clears it.
create or replace function public.mrq_set_cutoff(p_cutoff time) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid();
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'MRQ_ADMIN_ONLY: only an Admin can change the cut-off' using errcode = '42501'; end if;
  insert into public.material_request_settings (org_id, cutoff_time, updated_by, updated_at)
  values (v_org, p_cutoff, v_uid, now())
  on conflict (org_id) do update set cutoff_time = excluded.cutoff_time, updated_by = excluded.updated_by, updated_at = now();
  perform public.log_audit('material_request.cutoff_set', v_org, v_uid, null, jsonb_build_object('cutoff', p_cutoff));
end $$;

-- FR-MRQ-009 / OD-MRQ-4: the delegator (or an Admin) names an active same-org stand-in for a date range.
create or replace function public.mrq_set_stand_in(p_delegator_id uuid, p_stand_in_id uuid, p_starts_on date, p_ends_on date) returns uuid
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_id uuid;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if p_delegator_id is distinct from v_uid and public.auth_role() is distinct from 'Admin' then
    raise exception 'MRQ_STAND_IN: only the person away, or an Admin, names their stand-in' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_delegator_id and p.org_id = v_org and p.status = 'active')
     or not exists (select 1 from public.profiles p where p.id = p_stand_in_id and p.org_id = v_org and p.status = 'active') then
    raise exception 'MRQ_STAND_IN: both people must be active members of your organisation' using errcode = 'P0001'; end if;
  if p_stand_in_id = p_delegator_id then
    raise exception 'MRQ_STAND_IN: a person cannot stand in for themselves' using errcode = 'P0001'; end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on or p_ends_on - p_starts_on > 366
     or p_ends_on < public.stock_org_today(v_org) then
    raise exception 'MRQ_STAND_IN: choose a date range that has not ended (a year at most)' using errcode = 'P0001'; end if;
  insert into public.approval_stand_ins (org_id, delegator_id, stand_in_id, starts_on, ends_on, created_by)
  values (v_org, p_delegator_id, p_stand_in_id, p_starts_on, p_ends_on, v_uid)
  returning id into v_id;
  perform public.log_audit('material_request.stand_in_set', v_org, v_uid, v_id,
    jsonb_build_object('delegator_id', p_delegator_id, 'stand_in_id', p_stand_in_id, 'starts_on', p_starts_on, 'ends_on', p_ends_on));
  return v_id;
end $$;

create or replace function public.mrq_revoke_stand_in(p_id uuid) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); s public.approval_stand_ins;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into s from public.approval_stand_ins x where x.id = p_id and x.org_id = v_org for update;
  if not found then raise exception 'MRQ_NOT_FOUND: the stand-in is not in your organisation' using errcode = 'P0001'; end if;
  if s.delegator_id is distinct from v_uid and public.auth_role() is distinct from 'Admin' then
    raise exception 'MRQ_STAND_IN: only the person away, or an Admin, ends their stand-in' using errcode = '42501'; end if;
  if s.revoked_at is null then
    update public.approval_stand_ins set revoked_at = now(), revoked_by = v_uid where id = s.id;
    perform public.log_audit('material_request.stand_in_revoked', v_org, v_uid, s.id, '{}'::jsonb);
  end if;
end $$;

-- ── request lifecycle ────────────────────────────────────────────────────────────────────────────────────────

-- FR-MRQ-001/003/004: create (p_request_id null) or edit a draft. Idempotent create on p_client_request_id.
-- p_header: work_order_id, needed_by, to_warehouse_id (optional site), note. p_lines: item_id, quantity, over_plan_reason.
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

-- FR-MRQ-002/006/014: submit a draft. Over-plan lines need a reason; the cut-off is checked on the server clock;
-- the applicable chain steps are snapshotted as a fresh round (a resubmission after a return restarts at step 1).
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
  if r.status = 'pending' and p_client_request_id is not null and r.submit_request_id = p_client_request_id
     and r.created_by = v_uid then
    return;                                                                 -- FR-MRQ-004 replay
  end if;
  if r.created_by <> v_uid then
    raise exception 'MRQ_NOT_AUTHOR: only the person who raised the request can change or submit it' using errcode = '42501'; end if;
  if r.status <> 'draft' then
    raise exception 'MRQ_NOT_DRAFT: only a draft request can be changed or submitted' using errcode = 'P0001'; end if;
  select w.status into v_wo_status from public.work_orders w where w.id = r.work_order_id;
  if v_wo_status not in ('Draft','Issued') then
    raise exception 'MRQ_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;

  select s.cutoff_time into v_cutoff from public.material_request_settings s where s.org_id = v_org;
  select o.default_timezone into v_tz from public.organizations o where o.id = v_org;
  v_earliest := public.mrq_cutoff_earliest(v_cutoff, v_tz, r.needed_by, now());
  if v_earliest is not null then
    if v_cutoff is not null and v_earliest > (now() at time zone coalesce(v_tz, 'UTC'))::date + 1 then
      raise exception 'MRQ_CUTOFF: requests for tomorrow close at %; the earliest date you can request is %',
        to_char(v_cutoff, 'HH24:MI'), v_earliest using errcode = 'P0001';
    end if;
    raise exception 'MRQ_NEEDED_BY: the earliest date you can request is %', v_earliest using errcode = 'P0001';
  end if;

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
  perform public.mrq_log(r, 'submitted', 'draft', 'pending', null, v_uid, null, null);
end $$;

-- FR-MRQ-007/008/010/011/012: decide the open step. Row lock on the request serialises concurrent deciders.
create or replace function public.mrq_decide_step(p_request_id uuid, p_step_position integer, p_decision text,
                                                  p_reason text default null, p_source_warehouse_id uuid default null)
  returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); r public.material_requests; s public.material_request_steps;
  v_ok boolean; v_for uuid; v_reason text := nullif(btrim(p_reason), ''); v_next integer;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
  if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
  if r.status <> 'pending' then
    raise exception 'MRQ_NOT_PENDING: the request is not waiting for approval' using errcode = 'P0001'; end if;
  select * into s from public.material_request_steps x
   where x.request_id = r.id and x.round = r.round and x.status = 'open';
  if s.position is distinct from p_step_position then                                                  -- mut:order
    raise exception 'MRQ_OUT_OF_ORDER: step % is not the open step; steps are decided in order', p_step_position
      using errcode = 'P0001';
  end if;
  if r.created_by = v_uid then                                                                         -- mut:author
    raise exception 'MRQ_SOD_AUTHOR: you cannot decide a request you raised' using errcode = '42501';
  end if;
  select a.ok, a.acting_for into v_ok, v_for from public.mrq_step_authority(v_org, v_uid, s.role, r.created_by) a;
  if not v_ok then
    raise exception 'MRQ_NOT_APPROVER: you do not hold this step''s role and stand in for no one who does today'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.material_request_steps x                                             -- mut:twice
              where x.request_id = r.id and x.round = r.round and x.id <> s.id and x.status = 'approved'
                and (x.decided_by = any(array_remove(array[v_uid, v_for], null))
                     or x.acted_for = any(array_remove(array[v_uid, v_for], null)))) then
    raise exception 'MRQ_SOD_TWICE: you already decided another step of this request' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve','return','reject') then
    raise exception 'MRQ_INVALID: a decision is approve, return or reject' using errcode = 'P0001'; end if;
  if p_decision in ('return','reject') and (v_reason is null or length(v_reason) > 500) then
    raise exception 'MRQ_REASON_REQUIRED: a return or rejection needs a reason (1 to 500 characters)' using errcode = 'P0001'; end if;

  if p_decision = 'approve' then
    update public.material_request_steps
       set status = 'approved', decided_by = v_uid, acted_for = v_for, decided_at = now(), reason = v_reason
     where id = s.id;
    select min(x.position) into v_next from public.material_request_steps x
     where x.request_id = r.id and x.round = r.round and x.status = 'waiting';
    if v_next is not null then
      update public.material_request_steps set status = 'open'
       where request_id = r.id and round = r.round and position = v_next;
      perform public.mrq_log(r, 'approved_step', 'pending', 'pending', s.position, v_uid, v_for, v_reason);
    else
      -- Final step: approve and create the transfer draft in this one transaction (FR-MRQ-011). Any failure in
      -- the transfer path raises and rolls the whole decision back, leaving the step open.
      update public.material_requests set status = 'approved', decided_at = now(), updated_at = now() where id = r.id;
      perform public.mrq_log(r, 'approved_step', 'pending', 'pending', s.position, v_uid, v_for, v_reason);
      perform public.mrq_log(r, 'approved', 'pending', 'approved', s.position, v_uid, v_for, null);
      perform public.mrq_create_transfer_core(r.id, p_source_warehouse_id);
    end if;
  else
    update public.material_request_steps
       set status = case p_decision when 'return' then 'returned' else 'rejected' end,
           decided_by = v_uid, acted_for = v_for, decided_at = now(), reason = v_reason
     where id = s.id;
    update public.material_request_steps set status = 'superseded'
     where request_id = r.id and round = r.round and status = 'waiting';
    update public.material_requests
       set status = case p_decision when 'return' then 'draft' else 'rejected' end,
           decided_at = case p_decision when 'reject' then now() end, updated_at = now()
     where id = r.id;
    perform public.mrq_log(r, case p_decision when 'return' then 'returned' else 'rejected' end, 'pending',
                           case p_decision when 'return' then 'draft' else 'rejected' end, s.position, v_uid, v_for, v_reason);
  end if;
end $$;

-- FR-MRQ-013 follow-up: an approved request whose transfer draft was cancelled (or never made) gets a new draft.
-- The requester cannot make it (same SoD line as the approval); create_stock_document requires keeper or Admin.
create or replace function public.mrq_retry_transfer(p_request_id uuid, p_source_warehouse_id uuid) returns uuid
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); r public.material_requests;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
  if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
  if r.status <> 'approved' or (r.transfer_document_id is not null and not r.transfer_cancelled) then
    raise exception 'MRQ_NOT_PENDING: this request already has a live transfer' using errcode = 'P0001'; end if;
  if r.created_by = v_uid then
    raise exception 'MRQ_SOD_AUTHOR: you cannot move stock for a request you raised' using errcode = '42501'; end if;
  return public.mrq_create_transfer_core(r.id, p_source_warehouse_id);
end $$;

-- The author withdraws a draft or pending request.
create or replace function public.mrq_cancel(p_request_id uuid, p_reason text default null) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); r public.material_requests;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
  if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
  if r.created_by <> v_uid then
    raise exception 'MRQ_NOT_AUTHOR: only the person who raised the request can cancel it' using errcode = '42501'; end if;
  if r.status not in ('draft','pending') then
    raise exception 'MRQ_NOT_PENDING: only a draft or pending request can be cancelled' using errcode = 'P0001'; end if;
  update public.material_request_steps set status = 'superseded'
   where request_id = r.id and status in ('waiting','open');
  update public.material_requests set status = 'cancelled', updated_at = now() where id = r.id;
  perform public.mrq_log(r, 'cancelled', r.status, 'cancelled', null, v_uid, null,
                         left(nullif(btrim(p_reason), ''), 500));
end $$;

-- FR-MRQ-017: the caller's queue — open steps they may decide now (directly or as a stand-in), oldest first.
-- Mirrors mrq_decide_step's rules so the queue never offers a step the RPC would refuse.
create or replace function public.mrq_waiting_for_me()
  returns table (request_id uuid, step_position integer, role public.user_role, label text, acting_for uuid, submitted_at timestamptz)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
begin
  if v_org is null or not public.is_active_member() then return; end if;
  return query
  select q.request_id, q.position, q.role, q.label, q.acting_for, q.submitted_at
    from (
      select r.id as request_id, s.position, s.role, s.label, a.acting_for, r.submitted_at, r.round, s.id as step_id
        from public.material_requests r
        join public.material_request_steps s on s.request_id = r.id and s.round = r.round and s.status = 'open'
        cross join lateral public.mrq_step_authority(v_org, v_uid, s.role, r.created_by) a
       where r.org_id = v_org and r.status = 'pending' and r.created_by <> v_uid and a.ok
    ) q
   where not exists (select 1 from public.material_request_steps x
                      where x.request_id = q.request_id and x.round = q.round and x.id <> q.step_id and x.status = 'approved'
                        and (x.decided_by = any(array_remove(array[v_uid, q.acting_for], null))
                             or x.acted_for = any(array_remove(array[v_uid, q.acting_for], null))))
   order by q.submitted_at, q.request_id;
end $$;

-- FR-MRQ-002: what the form shows per line before submit — plan and already-requested for items on a work order.
-- The same two internals mrq_submit snapshots, so the screen and the server never compute plan differently.
create or replace function public.mrq_plan_for(p_work_order_id uuid, p_item_ids uuid[], p_exclude_request uuid default null)
  returns table (item_id uuid, plan_qty numeric, prior_qty numeric)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or not public.is_active_member() then return; end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then return; end if;
  if coalesce(array_length(p_item_ids, 1), 0) > 200 then
    raise exception 'MRQ_INVALID: 200 items at most' using errcode = 'P0001'; end if;
  return query
  select i.id, public.mrq_plan_quantity(p_work_order_id, i.id),
         public.mrq_prior_quantity(p_work_order_id, i.id, coalesce(p_exclude_request, '00000000-0000-0000-0000-000000000000'::uuid))
    from public.stock_items i
   where i.id = any(p_item_ids) and i.org_id = v_org;
end $$;

-- FR-MRQ-013: the linked transfer posted → fulfilled; cancelled → approved with the transfer-cancelled flag.
create or replace function public.mrq_on_transfer_status() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.material_requests;
begin
  if new.status is not distinct from old.status or new.kind <> 'transfer' then return new; end if;
  select * into r from public.material_requests x where x.transfer_document_id = new.id and x.org_id = new.org_id for update;
  if not found then return new; end if;
  if new.status = 'Posted' and r.status = 'approved' then
    update public.material_requests set status = 'fulfilled', updated_at = now() where id = r.id;
    perform public.mrq_log(r, 'fulfilled', 'approved', 'fulfilled', null, new.posted_by, null, null);
  elsif new.status = 'Cancelled' and r.status = 'approved' then
    update public.material_requests set transfer_cancelled = true, updated_at = now() where id = r.id;
    perform public.mrq_log(r, 'transfer_cancelled', 'approved', 'approved', null, new.cancelled_by, null, null);
  end if;
  return new;
end $$;
drop trigger if exists zz_material_request_transfer_status on public.stock_documents;
create trigger zz_material_request_transfer_status after update of status on public.stock_documents
  for each row execute function public.mrq_on_transfer_status();

-- ── ACL: internals nobody; client RPCs authenticated only (hosted default-grant lesson) ───────────────────────
revoke all on function
  public.mrq_plan_quantity(uuid, uuid), public.mrq_prior_quantity(uuid, uuid, uuid),
  public.mrq_cutoff_earliest(time, text, date, timestamptz),
  public.mrq_step_authority(uuid, uuid, public.user_role, uuid),
  public.mrq_log(public.material_requests, text, text, text, integer, uuid, uuid, text),
  public.mrq_validate_lines(uuid, jsonb), public.mrq_create_transfer_core(uuid, uuid),
  public.mrq_on_transfer_status()
  from public, anon, authenticated, service_role;
revoke all on function
  public.mrq_set_chain(jsonb), public.mrq_set_cutoff(time), public.mrq_set_stand_in(uuid, uuid, date, date),
  public.mrq_revoke_stand_in(uuid), public.mrq_save_draft(uuid, jsonb, jsonb, uuid), public.mrq_submit(uuid, uuid),
  public.mrq_decide_step(uuid, integer, text, text, uuid), public.mrq_retry_transfer(uuid, uuid),
  public.mrq_cancel(uuid, text), public.mrq_waiting_for_me(), public.mrq_plan_for(uuid, uuid[], uuid)
  from public, anon;
grant execute on function
  public.mrq_set_chain(jsonb), public.mrq_set_cutoff(time), public.mrq_set_stand_in(uuid, uuid, date, date),
  public.mrq_revoke_stand_in(uuid), public.mrq_save_draft(uuid, jsonb, jsonb, uuid), public.mrq_submit(uuid, uuid),
  public.mrq_decide_step(uuid, integer, text, text, uuid), public.mrq_retry_transfer(uuid, uuid),
  public.mrq_cancel(uuid, text), public.mrq_waiting_for_me(), public.mrq_plan_for(uuid, uuid[], uuid)
  to authenticated;
