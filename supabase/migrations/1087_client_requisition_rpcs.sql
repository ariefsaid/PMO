-- 1087_client_requisition_rpcs.sql — #2585 client material requisitions: the ONLY writers, the pickup that posts a receipt.
-- Spec docs/specs/client-material-requisitions.spec.md · plan docs/plans/2026-11-20-client-material-requisitions.md · tables 1086,
-- cost attribution for a receive naming a work order 1085. Proven by supabase/tests/csr_requisition.test.sql and csr_pickup.test.sql.
--
-- Reuse, not a new engine (ADR-0097 single writer): csr_record_pickup creates the receipt through the shipped
-- create_stock_document (unposted), names the work order on it as 1001 does for transfers, then posts it through
-- post_stock_document. No requisition code writes stock_ledger or stock_balances. The unit cost is hard-coded 0 here and the
-- RPC takes no cost parameter; #2523's guard_stock_line_zero_cost (STK_ZERO_COST) is the second layer.
--
-- Who may (OD defaults recorded in the plan): any active member raises a requisition; the author (or an Admin) edits a draft,
-- sends and cancels it; a Project Manager or above records a reservation or release (the client's confirmation); the keeper of
-- the receiving location (or an Admin) records a pickup, exactly as create_stock_document asserts.
--
-- Mutation checks (by hand, in the build report): `-- mut:zero_cost_tag` (the zero-cost refusal), `-- mut:still_to_collect`,
-- `-- mut:cancelled`, `-- mut:over_requested`, `-- mut:below_collected`, `-- mut:line_lock` mark the single statement enforcing each rule.
--
-- REVERSE: supabase/migrations/rollback/1087_client_requisition_rpcs_down.sql.

-- ── internals (never client-callable) ─────────────────────────────────────────────────────────────────────────

-- Reserved (reservations - releases) and collected (pickups) of one line, read under the caller's lock.
create or replace function public.csr_line_figures(p_line_id uuid, out requested numeric, out reserved numeric, out collected numeric)
  language sql stable security definer set search_path = public, pg_temp as $$
  select l.requested_quantity,
         coalesce((select sum(case e.kind when 'reserved' then e.quantity when 'released' then -e.quantity end)
                     from public.client_requisition_events e where e.line_id = l.id and e.kind in ('reserved','released')), 0),
         coalesce((select sum(p.quantity) from public.client_requisition_pickups p where p.line_id = l.id), 0)
    from public.client_requisition_lines l where l.id = p_line_id
$$;

create or replace function public.csr_log(p_org uuid, p_requisition uuid, p_line uuid, p_kind text, p_quantity numeric,
                                          p_reference text, p_on date, p_reason text, p_pickup uuid, p_crid uuid) returns uuid
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  insert into public.client_requisition_events (org_id, requisition_id, line_id, kind, quantity, client_reference, event_on, reason,
                                                pickup_id, client_request_id, recorded_by)
  values (p_org, p_requisition, p_line, p_kind, p_quantity, p_reference, p_on, p_reason, p_pickup, p_crid, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- A quantity must be above 0, three decimals at most, and whole where the unit demands it.
create or replace function public.csr_valid_quantity(p_q numeric, p_whole boolean) returns boolean
  language sql immutable set search_path = pg_catalog, pg_temp as $$
  select p_q is not null and p_q > 0 and p_q = round(p_q, 3) and p_q < 100000000000::numeric and (not p_whole or p_q = trunc(p_q))
$$;

-- Validates and normalises the lines of a requisition. Raises on the first bad line.
create or replace function public.csr_validate_lines(p_org uuid, p_work_order uuid, p_lines jsonb) returns void
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e jsonb; v_item record; n integer := 0; v_take numeric; v_req numeric; v_alloc uuid;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'CSR_INVALID: a requisition needs 1 to 200 lines' using errcode = 'P0001'; end if;
  for e in select x from jsonb_array_elements(p_lines) as x loop
    n := n + 1;
    select i.id, i.archived_at, u.whole_only, coalesce(t.zero_cost, false) as zero_cost into v_item
      from public.stock_items i
      join public.stock_units u on u.id = i.unit_id
      left join public.stock_tags t on t.id = i.tag_id
     where i.id = nullif(e->>'stock_item_id', '')::uuid and i.org_id = p_org;
    if v_item.id is null then raise exception 'CSR_INVALID: line % names an item that is not in your organisation', n using errcode = 'P0001'; end if;
    if v_item.archived_at is not null then raise exception 'CSR_INVALID: line % names an archived item', n using errcode = 'P0001'; end if;
    if not v_item.zero_cost then
      raise exception 'CSR_NOT_CLIENT_SUPPLIED: This item is not client-supplied' using errcode = 'P0001'; end if;
    v_take := (e->>'takeoff_quantity')::numeric;
    v_req := coalesce((e->>'requested_quantity')::numeric, v_take);
    if not public.csr_valid_quantity(v_take, false) then
      raise exception 'CSR_INVALID: line % needs a take-off quantity above 0 (3 decimals at most)', n using errcode = 'P0001'; end if;
    if not public.csr_valid_quantity(v_req, false) then
      raise exception 'CSR_INVALID: line % needs a requested quantity above 0 (3 decimals at most)', n using errcode = 'P0001'; end if;
    if v_item.whole_only and (v_take <> trunc(v_take) or v_req <> trunc(v_req)) then
      raise exception 'CSR_INVALID: line % is counted in whole units', n using errcode = 'P0001'; end if;
    v_alloc := nullif(e->>'work_order_line_id', '')::uuid;
    if v_alloc is not null and not exists (select 1 from public.work_order_lines w
         where w.id = v_alloc and w.org_id = p_org and w.work_order_id = p_work_order) then
      raise exception 'CSR_ALLOCATION: the allocation row belongs to another work order' using errcode = 'P0001'; end if;
  end loop;
end $$;

create or replace function public.csr_insert_lines(p_org uuid, p_requisition uuid, p_lines jsonb) returns void
  language sql volatile security definer set search_path = public, pg_temp as $$
  insert into public.client_requisition_lines (org_id, requisition_id, line_no, stock_item_id, work_order_line_id, takeoff_quantity, requested_quantity, unit_code)
  select p_org, p_requisition, t.n::int, (t.e->>'stock_item_id')::uuid, nullif(t.e->>'work_order_line_id', '')::uuid,
         (t.e->>'takeoff_quantity')::numeric, coalesce((t.e->>'requested_quantity')::numeric, (t.e->>'takeoff_quantity')::numeric), u.code
    from jsonb_array_elements(p_lines) with ordinality as t(e, n)
    join public.stock_items i on i.id = (t.e->>'stock_item_id')::uuid and i.org_id = p_org
    join public.stock_units u on u.id = i.unit_id
$$;

-- The author or an Admin (rank >= 50) changes, sends or cancels.
create or replace function public.csr_assert_author(p_created_by uuid) returns void
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_created_by is distinct from auth.uid() and not coalesce(public.role_rank(public.auth_role()) >= 50, false) then
    raise exception 'CSR_FORBIDDEN: only the person who raised the requisition, or an Admin, can change, send or cancel it' using errcode = '42501'; end if;
end $$;

-- Project Manager or above records a reservation or release.
create or replace function public.csr_assert_recorder() returns void
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not coalesce(public.role_rank(public.auth_role()) >= 20, false) then
    raise exception 'CSR_FORBIDDEN: only a Project Manager or above records a reservation or release' using errcode = '42501'; end if;
end $$;

-- ── writers ───────────────────────────────────────────────────────────────────────────────────────────────────

-- FR-CSR-001/005: create a draft requisition, idempotent on the caller's client_request_id.
create or replace function public.csr_create(p_header jsonb, p_lines jsonb, p_client_request_id uuid default null) returns uuid
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_wo record; v_id uuid; v_ref text;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  if p_client_request_id is not null then
    select x.id into v_id from public.client_requisitions x
     where x.org_id = v_org and x.created_by = v_uid and x.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  select w.id, w.project_id, w.status into v_wo from public.work_orders w
   where w.id = nullif(p_header->>'work_order_id', '')::uuid and w.org_id = v_org;
  if v_wo.id is null then raise exception 'CSR_WORK_ORDER: the work order is not in your organisation' using errcode = 'P0001'; end if;
  if v_wo.status not in ('Draft','Issued') then
    raise exception 'CSR_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;
  v_ref := nullif(btrim(p_header->>'client_reference'), '');
  if v_ref is not null and length(v_ref) > 120 then
    raise exception 'CSR_INVALID: the client reference is 120 characters at most' using errcode = 'P0001'; end if;
  perform public.csr_validate_lines(v_org, v_wo.id, p_lines);
  insert into public.client_requisitions (org_id, number, work_order_id, project_id, client_reference, client_request_id, created_by)
  values (v_org, public.next_procurement_doc_number(v_org, 'CSR'), v_wo.id, v_wo.project_id, v_ref, p_client_request_id, v_uid)
  on conflict (org_id, created_by, client_request_id) where client_request_id is not null do nothing
  returning id into v_id;
  if v_id is null then                                                   -- lost a race to a concurrent replay
    select x.id into v_id from public.client_requisitions x
     where x.org_id = v_org and x.created_by = v_uid and x.client_request_id = p_client_request_id;
    return v_id;
  end if;
  perform public.csr_insert_lines(v_org, v_id, p_lines);
  perform public.csr_log(v_org, v_id, null, 'created', null, null, null, null, null, p_client_request_id);
  return v_id;
end $$;

-- FR-CSR-004: a draft can be edited by its author; once sent its lines are frozen.
create or replace function public.csr_update_draft(p_requisition_id uuid, p_header jsonb, p_lines jsonb) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; r public.client_requisitions; v_ref text;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  select * into r from public.client_requisitions x where x.id = p_requisition_id and x.org_id = v_org for update;
  if not found then raise exception 'CSR_NOT_FOUND: the requisition is not in your organisation' using errcode = 'P0001'; end if;
  perform public.csr_assert_author(r.created_by);
  if r.status <> 'draft' then
    raise exception 'CSR_NOT_DRAFT: only a draft requisition can be changed or sent' using errcode = 'P0001'; end if;
  if exists (select 1 from public.work_orders w where w.id = r.work_order_id and w.status not in ('Draft','Issued')) then
    raise exception 'CSR_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;
  v_ref := nullif(btrim(p_header->>'client_reference'), '');
  if v_ref is not null and length(v_ref) > 120 then
    raise exception 'CSR_INVALID: the client reference is 120 characters at most' using errcode = 'P0001'; end if;
  perform public.csr_validate_lines(v_org, r.work_order_id, p_lines);
  update public.client_requisitions set client_reference = v_ref, updated_at = now() where id = r.id;
  delete from public.client_requisition_lines where requisition_id = r.id;
  perform public.csr_insert_lines(v_org, r.id, p_lines);
end $$;

-- FR-CSR-004/005: send a draft; it freezes the lines. A replay with the same id is a no-op.
create or replace function public.csr_send(p_requisition_id uuid, p_client_request_id uuid default null) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); r public.client_requisitions;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  select * into r from public.client_requisitions x where x.id = p_requisition_id and x.org_id = v_org for update;
  if not found then raise exception 'CSR_NOT_FOUND: the requisition is not in your organisation' using errcode = 'P0001'; end if;
  perform public.csr_assert_author(r.created_by);
  if r.status = 'open' and p_client_request_id is not null and r.send_request_id = p_client_request_id then return; end if;
  if r.status <> 'draft' then
    raise exception 'CSR_NOT_DRAFT: only a draft requisition can be changed or sent' using errcode = 'P0001'; end if;
  if exists (select 1 from public.work_orders w where w.id = r.work_order_id and w.status not in ('Draft','Issued')) then
    raise exception 'CSR_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;
  update public.client_requisitions
     set status = 'open', sent_by = v_uid, sent_at = now(), send_request_id = p_client_request_id, updated_at = now()
   where id = r.id;
  perform public.csr_log(v_org, r.id, null, 'sent', null, null, null, null, null, p_client_request_id);
end $$;

-- FR-CSR-004: cancel while no pickup is posted; the history is kept.
create or replace function public.csr_cancel(p_requisition_id uuid, p_reason text default null) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); r public.client_requisitions;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  select * into r from public.client_requisitions x where x.id = p_requisition_id and x.org_id = v_org for update;
  if not found then raise exception 'CSR_NOT_FOUND: the requisition is not in your organisation' using errcode = 'P0001'; end if;
  perform public.csr_assert_author(r.created_by);
  if r.status not in ('draft','open') then
    raise exception 'CSR_NOT_CANCELLABLE: only a draft or open requisition can be cancelled' using errcode = 'P0001'; end if;
  if exists (select 1 from public.client_requisition_pickups p where p.requisition_id = r.id) then
    raise exception 'CSR_HAS_PICKUP: a pickup is already posted, so the requisition cannot be cancelled' using errcode = 'P0001'; end if;
  update public.client_requisitions set status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(), updated_at = now() where id = r.id;
  perform public.csr_log(v_org, r.id, null, 'cancelled', null, null, null, left(nullif(btrim(p_reason), ''), 1000), null, null);
end $$;

-- Locks a line (and shares its requisition) and checks the requisition may take a reservation, release or pickup.
create or replace function public.csr_lock_line(p_org uuid, p_line_id uuid) returns public.client_requisition_lines
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare l public.client_requisition_lines; r public.client_requisitions;
begin
  select * into l from public.client_requisition_lines x where x.id = p_line_id and x.org_id = p_org;
  if not found then raise exception 'CSR_NOT_FOUND: the line is not in your organisation' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('csr-line:' || l.id::text, 0));                              -- mut:line_lock
  select * into r from public.client_requisitions x where x.id = l.requisition_id for share;
  if r.status = 'cancelled' then                                                                               -- mut:cancelled
    raise exception 'CSR_CANCELLED: the requisition is cancelled' using errcode = 'P0001'; end if;
  if r.status <> 'open' then
    raise exception 'CSR_NOT_OPEN: only an open requisition takes a reservation, release or pickup' using errcode = 'P0001'; end if;
  if exists (select 1 from public.work_orders w where w.id = r.work_order_id and w.status not in ('Draft','Issued')) then
    raise exception 'CSR_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;
  return l;
end $$;

-- FR-CSR-006/007/009: the client confirms a reservation; reserved never exceeds requested; the creator is told.
create or replace function public.csr_record_reservation(p_line_id uuid, p_quantity numeric, p_client_reference text,
    p_reserved_on date default null, p_note text default null, p_client_request_id uuid default null) returns uuid
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; l public.client_requisition_lines; r public.client_requisitions; f record; v_whole boolean; v_id uuid; v_ref text;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  perform public.csr_assert_recorder();
  if p_client_request_id is not null then
    select e.id into v_id from public.client_requisition_events e
     where e.line_id = p_line_id and e.org_id = v_org and e.kind = 'reserved' and e.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  l := public.csr_lock_line(v_org, p_line_id);
  select * into r from public.client_requisitions x where x.id = l.requisition_id;
  select u.whole_only into v_whole from public.stock_items i join public.stock_units u on u.id = i.unit_id where i.id = l.stock_item_id;
  v_ref := nullif(btrim(p_client_reference), '');
  if v_ref is null or length(v_ref) > 200 then
    raise exception 'CSR_INVALID: a reservation needs the client''s reference (200 characters at most)' using errcode = 'P0001'; end if;
  if not public.csr_valid_quantity(p_quantity, coalesce(v_whole, false)) then
    raise exception 'CSR_INVALID: a reservation needs a quantity above 0 (3 decimals at most, whole units where the unit demands it)' using errcode = 'P0001'; end if;
  if p_note is not null and length(p_note) > 1000 then
    raise exception 'CSR_INVALID: a note is 1000 characters at most' using errcode = 'P0001'; end if;
  select * into f from public.csr_line_figures(l.id);
  if f.reserved + p_quantity > f.requested then                                                                -- mut:over_requested
    raise exception 'CSR_OVER_REQUESTED: Reserved would exceed requested by %', trim_scale(f.reserved + p_quantity - f.requested)::text using errcode = 'P0001'; end if;
  v_id := public.csr_log(v_org, r.id, l.id, 'reserved', p_quantity, v_ref, coalesce(p_reserved_on, public.stock_org_today(v_org)),
                         left(nullif(btrim(p_note), ''), 1000), null, p_client_request_id);
  perform public.notify_workflow_user(v_org, r.created_by, 'Client reserved material',
    'Requisition ' || r.number || ': ' || trim_scale(p_quantity)::text || ' reserved (' || v_ref || ')', 'info', 'client_requisition', r.id, r.number);
  return v_id;
end $$;

-- FR-CSR-008: the client withdraws part of a reservation; a release never takes reserved below collected.
create or replace function public.csr_record_release(p_line_id uuid, p_quantity numeric, p_reason text, p_client_request_id uuid default null) returns uuid
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; l public.client_requisition_lines; r public.client_requisitions; f record; v_whole boolean; v_id uuid; v_reason text;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  perform public.csr_assert_recorder();
  if p_client_request_id is not null then
    select e.id into v_id from public.client_requisition_events e
     where e.line_id = p_line_id and e.org_id = v_org and e.kind = 'released' and e.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  l := public.csr_lock_line(v_org, p_line_id);
  select * into r from public.client_requisitions x where x.id = l.requisition_id;
  select u.whole_only into v_whole from public.stock_items i join public.stock_units u on u.id = i.unit_id where i.id = l.stock_item_id;
  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null or length(v_reason) > 1000 then
    raise exception 'CSR_INVALID: a release needs a reason' using errcode = 'P0001'; end if;
  if not public.csr_valid_quantity(p_quantity, coalesce(v_whole, false)) then
    raise exception 'CSR_INVALID: a release needs a quantity above 0 (3 decimals at most, whole units where the unit demands it)' using errcode = 'P0001'; end if;
  select * into f from public.csr_line_figures(l.id);
  if p_quantity > f.reserved then
    raise exception 'CSR_INVALID: a release cannot exceed the reserved quantity of %', trim_scale(f.reserved)::text using errcode = 'P0001'; end if;
  if f.reserved - p_quantity < f.collected then                                                                -- mut:below_collected
    raise exception 'CSR_RELEASE_BELOW_COLLECTED: a release of % would take reserved below the % already collected',
      trim_scale(p_quantity)::text, trim_scale(f.collected)::text using errcode = 'P0001'; end if;
  return public.csr_log(v_org, r.id, l.id, 'released', p_quantity, null, public.stock_org_today(v_org), v_reason, null, p_client_request_id);
end $$;

-- FR-CSR-010..016: record a pickup and post ONE zero-cost receipt for it, in this transaction.
create or replace function public.csr_record_pickup(p_line_id uuid, p_quantity numeric, p_warehouse_id uuid, p_picked_up_on date default null,
    p_collector text default null, p_paper_reference text default null, p_client_request_id uuid default null) returns uuid
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); l public.client_requisition_lines; r public.client_requisitions; f record;
  v_zero boolean; v_whole boolean; v_on date; v_doc uuid; v_pickup uuid; v_still numeric; v_collector text; v_paper text;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  if p_client_request_id is not null then                                                                      -- FR-CSR-015: a replay returns the original
    select p.id into v_pickup from public.client_requisition_pickups p
     where p.org_id = v_org and p.recorded_by = v_uid and p.client_request_id = p_client_request_id;
    if v_pickup is not null then return v_pickup; end if;
  end if;
  perform public.stock_assert_standalone(v_org);                                                               -- FR-CSR-016: before any row
  l := public.csr_lock_line(v_org, p_line_id);
  select * into r from public.client_requisitions x where x.id = l.requisition_id;
  select coalesce(t.zero_cost, false), u.whole_only into v_zero, v_whole
    from public.stock_items i join public.stock_units u on u.id = i.unit_id left join public.stock_tags t on t.id = i.tag_id
   where i.id = l.stock_item_id;
  if not coalesce(v_zero, false) then                                                                          -- mut:zero_cost_tag
    raise exception 'CSR_NOT_CLIENT_SUPPLIED: This item is not client-supplied' using errcode = 'P0001'; end if;
  if not public.csr_valid_quantity(p_quantity, coalesce(v_whole, false)) then
    raise exception 'CSR_INVALID: a pickup needs a quantity above 0 (3 decimals at most, whole units where the unit demands it)' using errcode = 'P0001'; end if;
  v_collector := nullif(btrim(p_collector), '');
  v_paper := nullif(btrim(p_paper_reference), '');
  if length(coalesce(v_collector, '')) > 200 or length(coalesce(v_paper, '')) > 200 then
    raise exception 'CSR_INVALID: the collector and the delivery paper reference are 200 characters at most' using errcode = 'P0001'; end if;
  select * into f from public.csr_line_figures(l.id);
  v_still := f.reserved - f.collected;
  if p_quantity > v_still then                                                                                 -- mut:still_to_collect
    raise exception 'CSR_OVER_COLLECT: only % is still to collect', trim_scale(greatest(v_still, 0))::text using errcode = 'P0001'; end if;
  v_on := coalesce(p_picked_up_on, public.stock_org_today(v_org));
  -- The receipt goes through the shipped path: keeper-or-Admin, item/warehouse validation, numbering, dates (0413/0534).
  -- Unit cost is 0 by construction (spec FR-CSR-012); the payload carries no client cost.
  v_doc := public.create_stock_document(
    jsonb_build_object('kind', 'receive', 'warehouse_id', p_warehouse_id, 'occurred_on', v_on,
                       'note', left('Client requisition ' || r.number || ' pickup' || coalesce(' - ' || v_collector, ''), 500)),
    jsonb_build_array(jsonb_build_object('item_id', l.stock_item_id, 'quantity', p_quantity, 'unit_cost', 0)),
    false, null);
  -- Check 1085's rule trigger: the receiving location's project must be the work order's.
  update public.stock_documents set work_order_id = r.work_order_id where id = v_doc;
  perform public.post_stock_document(v_doc);
  insert into public.client_requisition_pickups (org_id, requisition_id, line_id, quantity, picked_up_on, collector, paper_reference,
                                                 warehouse_id, stock_document_id, client_request_id, recorded_by)
  values (v_org, r.id, l.id, p_quantity, v_on, v_collector, v_paper, p_warehouse_id, v_doc, p_client_request_id, v_uid)
  returning id into v_pickup;
  perform public.csr_log(v_org, r.id, l.id, 'pickup', p_quantity, null, v_on, null, v_pickup, p_client_request_id);
  return v_pickup;
end $$;

-- ── read (security invoker: the caller's RLS decides) ─────────────────────────────────────────────────────────

-- FR-CSR-018/019: per-line figures of a work order, derived at read time; nothing is stored.
create or replace function public.csr_work_order_rollup(p_work_order_id uuid)
  returns table (line_id uuid, requisition_id uuid, requisition_number text, requisition_status text, stock_item_id uuid,
                 item_code text, item_name text, unit_code text, takeoff_quantity numeric, requested_quantity numeric,
                 reserved numeric, collected numeric, still_to_collect numeric, awaiting_reservation numeric)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select l.id, r.id, r.number, r.status, l.stock_item_id, i.code, i.name, l.unit_code, l.takeoff_quantity, l.requested_quantity,
         f.reserved, f.collected, f.reserved - f.collected, greatest(l.requested_quantity - f.reserved, 0)
    from public.client_requisitions r
    join public.client_requisition_lines l on l.requisition_id = r.id
    join public.stock_items i on i.id = l.stock_item_id
    cross join lateral (
      select coalesce((select sum(case e.kind when 'reserved' then e.quantity else -e.quantity end)
                         from public.client_requisition_events e where e.line_id = l.id and e.kind in ('reserved','released')), 0) as reserved,
             coalesce((select sum(p.quantity) from public.client_requisition_pickups p where p.line_id = l.id), 0) as collected) f
   where r.work_order_id = p_work_order_id
   order by r.number, l.line_no
$$;

-- ── ACL: internals nobody; client RPCs authenticated only (hosted default-grant lesson) ───────────────────────
revoke all on function
  public.csr_line_figures(uuid), public.csr_log(uuid, uuid, uuid, text, numeric, text, date, text, uuid, uuid),
  public.csr_valid_quantity(numeric, boolean), public.csr_validate_lines(uuid, uuid, jsonb), public.csr_insert_lines(uuid, uuid, jsonb),
  public.csr_assert_author(uuid), public.csr_assert_recorder(), public.csr_lock_line(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  public.csr_create(jsonb, jsonb, uuid), public.csr_update_draft(uuid, jsonb, jsonb), public.csr_send(uuid, uuid), public.csr_cancel(uuid, text),
  public.csr_record_reservation(uuid, numeric, text, date, text, uuid), public.csr_record_release(uuid, numeric, text, uuid),
  public.csr_record_pickup(uuid, numeric, uuid, date, text, text, uuid), public.csr_work_order_rollup(uuid)
  from public, anon;
grant execute on function
  public.csr_create(jsonb, jsonb, uuid), public.csr_update_draft(uuid, jsonb, jsonb), public.csr_send(uuid, uuid), public.csr_cancel(uuid, text),
  public.csr_record_reservation(uuid, numeric, text, date, text, uuid), public.csr_record_release(uuid, numeric, text, uuid),
  public.csr_record_pickup(uuid, numeric, uuid, date, text, text, uuid), public.csr_work_order_rollup(uuid)
  to authenticated;
