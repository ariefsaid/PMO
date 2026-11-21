-- 1318_mrq_borrowing.sql — #2693 (FR-RSV-007..009). Borrowing attaches to material requests by TRIGGERS ONLY; no shipped function is re-created
-- (mrq_submit and others are restated by other lane branches in later numbers, so a restatement here would be lost).
--   rsv_split_line: how much of a line the work order's own reservation covers, how much free stock covers, how much borrows (spec decision 5a).
--   rsv_borrow_on_submit: AFTER UPDATE when a request becomes pending: split the lines, mark the request borrowing, and (mode approve) append the
--     borrowing approver as the LAST ordinary row of that round's material_request_steps, so order, SoD, stand-ins and pins apply as to any step.
--   rsv_consume_on_approval: AFTER UPDATE when a request becomes approved: recheck borrowing, consume own then lent reservations, in the same transaction.
-- Both triggers do nothing while the organisation has reservations off. Proven by supabase/tests/1318_mrq_borrowing.test.sql.
-- ── REVERSE: rollback/1318_mrq_borrowing_down.sql.

alter table public.material_requests add column borrowing boolean not null default false,
  add column reservation_checked boolean not null default false;   -- set when the submit trigger evaluated the request, so a request submitted while reservations were off is never held to them
alter table public.material_request_lines
  add column reserved_use_qty numeric(14,3) not null default 0 check (reserved_use_qty >= 0),
  add column borrowed_qty numeric(14,3) not null default 0 check (borrowed_qty >= 0);

create or replace function public.rsv_split_line(p_org uuid, p_work_order uuid, p_item uuid, p_qty numeric, p_exclude_request uuid,
                                                 out use_qty numeric, out borrowed_qty numeric)
  language plpgsql stable security definer set search_path = public as $$
declare v_own numeric; v_claimed numeric; v_free numeric; v_others numeric; v_rest numeric; v_today date := public.rsv_today(p_org);
begin
  -- own: this work order's active reservations of the item (any reservable location), less what its other pending requests already use.
  select coalesce(sum(r.quantity - r.consumed_qty - r.released_qty), 0) into v_own
    from public.stock_reservations r join public.work_orders w on w.id = r.work_order_id
   where r.org_id = p_org and r.item_id = p_item and r.work_order_id = p_work_order and r.status = 'active'
     and (r.expires_on is null or r.expires_on >= v_today) and w.status in ('Draft', 'Issued');
  select coalesce(sum(l.reserved_use_qty), 0) into v_claimed
    from public.material_request_lines l join public.material_requests q on q.id = l.request_id
   where q.org_id = p_org and q.work_order_id = p_work_order and l.item_id = p_item and q.status = 'pending'
     and q.id is distinct from p_exclude_request;
  use_qty := least(p_qty, greatest(0, v_own - v_claimed));
  v_rest := p_qty - use_qty;
  -- free: per location, on hand less everything reserved there (own reservations included), never negative; summed over reservable locations.
  select coalesce(sum(public.rsv_free(p_org, p_item, b.warehouse_id)), 0) into v_free
    from public.stock_balances b join public.stock_warehouses w on w.id = b.warehouse_id
   where b.org_id = p_org and b.item_id = p_item and b.qty_on_hand > 0 and w.kind in ('central', 'site', 'yard', 'staging') and w.archived_at is null;
  -- others: what other work orders hold, the most that can be borrowed.
  select coalesce(sum(r.quantity - r.consumed_qty - r.released_qty), 0) into v_others
    from public.stock_reservations r join public.work_orders w on w.id = r.work_order_id
   where r.org_id = p_org and r.item_id = p_item and r.work_order_id <> p_work_order and r.status = 'active'
     and (r.expires_on is null or r.expires_on >= v_today) and w.status in ('Draft', 'Issued');
  borrowed_qty := least(v_others, greatest(0, v_rest - v_free));
end $$;

create or replace function public.rsv_borrow_on_submit() returns trigger
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare l record; s record; v_any boolean := false; v_mode text; v_role public.user_role; v_label text; v_pos integer;
begin
  if not public.stock_reservations_on(new.org_id) then return null; end if;
  for l in select x.id, x.item_id, x.quantity from public.material_request_lines x where x.request_id = new.id order by x.line_no loop
    select * into s from public.rsv_split_line(new.org_id, new.work_order_id, l.item_id, l.quantity, new.id);
    update public.material_request_lines set reserved_use_qty = s.use_qty, borrowed_qty = s.borrowed_qty where id = l.id;
    if s.borrowed_qty > 0 then v_any := true; end if;
  end loop;
  update public.material_requests set borrowing = v_any, reservation_checked = true where id = new.id;
  if not v_any then return null; end if;
  select o.reservation_borrow_mode, o.reservation_borrow_role, o.reservation_borrow_label into v_mode, v_role, v_label
    from public.organizations o where o.id = new.org_id;
  if v_mode <> 'approve' then return null; end if;                                                     -- warn: marked and shown, no extra step
  if v_role is null then
    raise exception 'RSV_NO_BORROW_APPROVER: this request takes another work order''s reserved stock and no borrowing approver is set; ask an Admin' using errcode = 'P0001'; end if;
  select coalesce(max(x.position), 0) + 1 into v_pos from public.material_request_steps x where x.request_id = new.id and x.round = new.round;
  insert into public.material_request_steps (org_id, request_id, round, position, role, label, status)    -- mut:rsv_borrow_step
  values (new.org_id, new.id, new.round, v_pos, v_role, v_label, case when v_pos = 1 then 'open' else 'waiting' end);
  return null;
end $$;

create or replace function public.rsv_take(p_org uuid, p_request uuid, p_work_order uuid, p_item uuid, p_qty numeric, p_own boolean)
  returns numeric language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r record; v_left numeric := p_qty; v_take numeric; v_today date := public.rsv_today(p_org);
begin
  for r in select x.id, x.quantity, x.consumed_qty, x.released_qty
             from public.stock_reservations x join public.work_orders w on w.id = x.work_order_id
            where x.org_id = p_org and x.item_id = p_item and x.status = 'active'
              and (x.expires_on is null or x.expires_on >= v_today) and w.status in ('Draft', 'Issued')
              and ((p_own and x.work_order_id = p_work_order) or (not p_own and x.work_order_id <> p_work_order))
              and x.quantity - x.consumed_qty - x.released_qty > 0
            order by case when p_own then 0 else -(x.quantity - x.consumed_qty - x.released_qty) end, x.created_at, x.id
            for update of x loop
    exit when v_left <= 0;
    v_take := least(v_left, r.quantity - r.consumed_qty - r.released_qty);
    update public.stock_reservations
       set consumed_qty = consumed_qty + v_take,
           status = case when quantity - (consumed_qty + v_take) - released_qty = 0 and released_qty = 0 then 'consumed'
                         when quantity - (consumed_qty + v_take) - released_qty = 0 then 'released' else 'active' end
     where id = r.id;
    insert into public.stock_reservation_events (org_id, reservation_id, action, qty, request_id, actor_id)
    values (p_org, r.id, case when p_own then 'consume' else 'lend' end, v_take, p_request, auth.uid());
    v_left := v_left - v_take;
  end loop;
  return v_left;
end $$;

create or replace function public.rsv_consume_on_approval() returns trigger
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare l record; s record; v_left numeric;
begin
  if not public.stock_reservations_on(new.org_id) or not new.reservation_checked then return null; end if;
  for l in select x.id, x.item_id, x.quantity, x.borrowed_qty from public.material_request_lines x where x.request_id = new.id order by x.line_no loop
    select * into s from public.rsv_split_line(new.org_id, new.work_order_id, l.item_id, l.quantity, new.id);
    if s.borrowed_qty > l.borrowed_qty then                                                              -- mut:rsv_borrow_recheck
      raise exception 'RSV_BORROW_CHANGED: more reserved stock would be borrowed than was approved; return the request and submit it again' using errcode = 'P0001'; end if;
    v_left := public.rsv_take(new.org_id, new.id, new.work_order_id, l.item_id, s.use_qty, true);
    if v_left > 0 then raise exception 'RSV_OVERDRAW: the reservation holds less than the request uses' using errcode = 'P0001'; end if;    -- mut:rsv_overdraw
    v_left := public.rsv_take(new.org_id, new.id, new.work_order_id, l.item_id, s.borrowed_qty, false);                                    -- mut:rsv_consume
    if v_left > 0 then raise exception 'RSV_OVERDRAW: the lending reservations hold less than the request borrows' using errcode = 'P0001'; end if;
    update public.material_request_lines set reserved_use_qty = s.use_qty, borrowed_qty = s.borrowed_qty where id = l.id;
  end loop;
  return null;
end $$;

revoke all on function public.rsv_split_line(uuid, uuid, uuid, numeric, uuid), public.rsv_take(uuid, uuid, uuid, uuid, numeric, boolean),
  public.rsv_borrow_on_submit(), public.rsv_consume_on_approval() from public, anon, authenticated;
create trigger rsv_borrow_on_submit after update of status on public.material_requests
  for each row when (old.status = 'draft' and new.status = 'pending') execute function public.rsv_borrow_on_submit();
create trigger rsv_consume_on_approval after update of status on public.material_requests
  for each row when (old.status = 'pending' and new.status = 'approved') execute function public.rsv_consume_on_approval();
