-- 1316_stock_reservation_rpcs.sql — #2693. The ONLY writers of reservations, plus the free/reserved arithmetic.
-- Proven by supabase/tests/1315_stock_reservations.test.sql. Nothing here touches stock_ledger, stock_balances or stock_write_entry.
--   rsv_today / rsv_reserved / rsv_free: free = max(0, on hand - active reserved), per item and location, computed on read (spec decisions 2-3).
--   reserve_stock, release_reservation, release_stale_reservations, set_stock_reservations: the client-callable writers.
-- ── REVERSE: rollback/1316_stock_reservation_rpcs_down.sql drops every function below.

create or replace function public.rsv_today(p_org uuid) returns date
  language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select o.default_timezone from public.organizations o where o.id = p_org), 'UTC'))::date $$;

-- Remaining quantity of ACTIVE reservations: status active, not past its date, work order still Draft or Issued.
create or replace function public.rsv_reserved(p_org uuid, p_item uuid, p_warehouse uuid) returns numeric
  language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.quantity - r.consumed_qty - r.released_qty), 0)
    from public.stock_reservations r join public.work_orders w on w.id = r.work_order_id
   where r.org_id = p_org and r.item_id = p_item and r.warehouse_id = p_warehouse and r.status = 'active'
     and (r.expires_on is null or r.expires_on >= public.rsv_today(p_org))
     and w.status in ('Draft', 'Issued') and r.quantity - r.consumed_qty - r.released_qty > 0 $$;

create or replace function public.rsv_free(p_org uuid, p_item uuid, p_warehouse uuid) returns numeric
  language sql stable security definer set search_path = public as $$
  select greatest(0, coalesce((select b.qty_on_hand from public.stock_balances b
                                where b.org_id = p_org and b.item_id = p_item and b.warehouse_id = p_warehouse), 0)
                     - public.rsv_reserved(p_org, p_item, p_warehouse)) $$;

-- Who may reserve, adjust or release at a location: its keeper, a stock planner (master-data rank), or an Admin (audited by the caller).
create or replace function public.rsv_assert_may(p_org uuid, p_warehouse uuid, p_uid uuid) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare v_rank integer := coalesce(public.role_rank(public.auth_role()), 0);
begin
  if exists (select 1 from public.stock_warehouse_keepers k where k.org_id = p_org and k.warehouse_id = p_warehouse and k.user_id = p_uid) then
    return false; end if;
  if v_rank >= 20 then return v_rank >= 50; end if;                                                    -- mut:rsv_perm
  raise exception 'RSV_FORBIDDEN: only the keeper of this location, a stock planner or an Admin can change reservations' using errcode = '42501';
end $$;

-- Records stale reservations (past date, closed or cancelled work order) as expired or released. Internal; reserve_stock runs it lazily.
create or replace function public.rsv_sweep(p_org uuid) returns integer
  language plpgsql volatile security definer set search_path = public as $$
declare r record; v_n integer := 0; v_rem numeric; v_expired boolean;
begin
  for r in select x.id, x.quantity, x.consumed_qty, x.released_qty, x.expires_on, w.status as wo_status
             from public.stock_reservations x join public.work_orders w on w.id = x.work_order_id
            where x.org_id = p_org and x.status = 'active'
              and ((x.expires_on is not null and x.expires_on < public.rsv_today(p_org)) or w.status not in ('Draft', 'Issued'))
            order by x.id for update of x loop
    v_rem := r.quantity - r.consumed_qty - r.released_qty;
    v_expired := r.expires_on is not null and r.expires_on < public.rsv_today(p_org);
    update public.stock_reservations set released_qty = released_qty + v_rem, status = case when v_expired then 'expired' else 'released' end where id = r.id;
    if v_rem > 0 then
      insert into public.stock_reservation_events (org_id, reservation_id, action, qty, actor_id, reason)
      values (p_org, r.id, case when v_expired then 'expire' else 'release' end, v_rem, auth.uid(),
              case when v_expired then 'expired' else 'work order closed' end);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.reserve_stock(p_work_order_id uuid, p_item_id uuid, p_warehouse_id uuid, p_quantity numeric,
                                                p_expires_on date default null, p_note text default null, p_client_request_id uuid default null)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); v_wo_status public.work_order_status; v_kind text; v_arch timestamptz; v_whole boolean;
  v_item_ok boolean; v_free numeric; v_res public.stock_reservations; v_admin boolean; v_id uuid; v_note text := nullif(btrim(p_note), '');
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if not public.stock_reservations_on(v_org) then                                                        -- mut:rsv_off
    raise exception 'RSV_OFF: reservations are not turned on for your organisation' using errcode = 'P0001'; end if;
  perform public.stock_assert_standalone(v_org);
  if p_client_request_id is not null then
    select e.reservation_id into v_id from public.stock_reservation_events e
     where e.org_id = v_org and e.actor_id = v_uid and e.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity >= 100000000000 or p_quantity <> round(p_quantity, 3) then
    raise exception 'RSV_INVALID: the quantity must be a positive number with at most three decimals' using errcode = 'P0001'; end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'RSV_INVALID: the note is too long' using errcode = 'P0001'; end if;
  select w.status into v_wo_status from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org;
  if not found then raise exception 'RSV_NOT_FOUND: the work order is not in your organisation' using errcode = 'P0001'; end if;
  if v_wo_status not in ('Draft', 'Issued') then
    raise exception 'RSV_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;
  select i.archived_at is null, u.whole_only into v_item_ok, v_whole
    from public.stock_items i join public.stock_units u on u.id = i.unit_id where i.id = p_item_id and i.org_id = v_org;
  if v_item_ok is null then raise exception 'RSV_NOT_FOUND: the item is not in your organisation' using errcode = 'P0001'; end if;
  if not v_item_ok then raise exception 'RSV_NOT_FOUND: the item is archived' using errcode = 'P0001'; end if;
  if v_whole and p_quantity <> trunc(p_quantity) then
    raise exception 'RSV_INVALID: this item is counted in whole units' using errcode = 'P0001'; end if;
  select w.kind, w.archived_at into v_kind, v_arch from public.stock_warehouses w where w.id = p_warehouse_id and w.org_id = v_org;
  if v_kind is null then raise exception 'RSV_NOT_FOUND: the location is not in your organisation' using errcode = 'P0001'; end if;
  if v_kind not in ('central', 'site', 'yard', 'staging') or v_arch is not null then
    raise exception 'RSV_LOCATION: reservations are held at central, site, yard or staging locations that are not archived' using errcode = 'P0001'; end if;
  if p_expires_on is not null and p_expires_on < public.rsv_today(v_org) then
    raise exception 'RSV_INVALID: the expiry date is in the past' using errcode = 'P0001'; end if;
  v_admin := public.rsv_assert_may(v_org, p_warehouse_id, v_uid);

  perform pg_advisory_xact_lock(hashtextextended('rsv:' || v_org::text || ':' || p_item_id::text || ':' || p_warehouse_id::text, 0));
  perform public.rsv_sweep(v_org);
  v_free := public.rsv_free(v_org, p_item_id, p_warehouse_id);
  if p_quantity > v_free then                                                                           -- mut:rsv_exceeds_free
    raise exception 'RSV_EXCEEDS_FREE: only % is free at this location', trim_scale(v_free) using errcode = 'P0001'; end if;

  select * into v_res from public.stock_reservations x
   where x.org_id = v_org and x.work_order_id = p_work_order_id and x.item_id = p_item_id and x.warehouse_id = p_warehouse_id and x.status = 'active' for update;
  if found then
    update public.stock_reservations set quantity = quantity + p_quantity, expires_on = coalesce(p_expires_on, expires_on), note = coalesce(v_note, note)
     where id = v_res.id returning id into v_id;
    insert into public.stock_reservation_events (org_id, reservation_id, action, qty, actor_id, client_request_id)
    values (v_org, v_id, 'adjust', p_quantity, v_uid, p_client_request_id);
  else
    insert into public.stock_reservations (org_id, work_order_id, item_id, warehouse_id, quantity, expires_on, note, created_by)
    values (v_org, p_work_order_id, p_item_id, p_warehouse_id, p_quantity, p_expires_on, v_note, v_uid) returning id into v_id;
    insert into public.stock_reservation_events (org_id, reservation_id, action, qty, actor_id, client_request_id)
    values (v_org, v_id, 'reserve', p_quantity, v_uid, p_client_request_id);
  end if;
  if v_admin then perform public.log_audit('stock.reservation_admin', v_org, v_uid, v_id, jsonb_build_object('action', 'reserve', 'qty', p_quantity)); end if;
  return v_id;
end $$;

create or replace function public.release_reservation(p_reservation_id uuid, p_quantity numeric default null, p_reason text default null)
  returns numeric language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); r public.stock_reservations; v_rem numeric; v_take numeric; v_reason text := nullif(btrim(p_reason), ''); v_admin boolean;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if not public.stock_reservations_on(v_org) then
    raise exception 'RSV_OFF: reservations are not turned on for your organisation' using errcode = 'P0001'; end if;
  select * into r from public.stock_reservations x where x.id = p_reservation_id and x.org_id = v_org for update;
  if not found then raise exception 'RSV_NOT_FOUND: the reservation is not in your organisation' using errcode = 'P0001'; end if;
  v_admin := public.rsv_assert_may(v_org, r.warehouse_id, v_uid);
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'RSV_INVALID: a release needs a reason (1 to 500 characters)' using errcode = 'P0001'; end if;
  if r.status <> 'active' then raise exception 'RSV_NOT_ACTIVE: the reservation is no longer active' using errcode = 'P0001'; end if;
  v_rem := r.quantity - r.consumed_qty - r.released_qty;
  v_take := coalesce(p_quantity, v_rem);
  if v_take <= 0 or v_take <> round(v_take, 3) then
    raise exception 'RSV_INVALID: the quantity must be a positive number with at most three decimals' using errcode = 'P0001'; end if;
  if v_take > v_rem then                                                                                 -- consumed quantity is never released
    raise exception 'RSV_EXCEEDS_REMAINING: only % remains on this reservation' , trim_scale(v_rem) using errcode = 'P0001'; end if;
  update public.stock_reservations
     set released_qty = released_qty + v_take,
         status = case when quantity - consumed_qty - (released_qty + v_take) = 0 then 'released' else 'active' end
   where id = r.id;
  insert into public.stock_reservation_events (org_id, reservation_id, action, qty, actor_id, reason) values (v_org, r.id, 'release', v_take, v_uid, v_reason);
  if v_admin then perform public.log_audit('stock.reservation_admin', v_org, v_uid, r.id, jsonb_build_object('action', 'release', 'qty', v_take)); end if;
  return v_take;
end $$;

create or replace function public.release_stale_reservations() returns integer
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if not public.stock_reservations_on(v_org) then
    raise exception 'RSV_OFF: reservations are not turned on for your organisation' using errcode = 'P0001'; end if;
  if not coalesce(public.role_rank(public.auth_role()) >= 50, false) then
    raise exception 'RSV_FORBIDDEN: only an Admin sweeps stale reservations' using errcode = '42501'; end if;
  return public.rsv_sweep(v_org);
end $$;

create or replace function public.set_stock_reservations(p_on boolean, p_borrow_mode text default 'approve',
                                                         p_borrow_role public.user_role default null, p_borrow_label text default null)
  returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; o public.organizations; v_label text := nullif(btrim(p_borrow_label), '');
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if not coalesce(public.role_rank(public.auth_role()) >= 50, false) then
    raise exception 'RSV_FORBIDDEN: only an Admin changes reservation settings' using errcode = '42501'; end if;
  if p_on is null or p_borrow_mode is null or p_borrow_mode not in ('approve', 'warn') then
    raise exception 'RSV_INVALID: reservations are on or off, and borrowing is approve or warn' using errcode = 'P0001'; end if;
  if (p_borrow_role is null) <> (v_label is null) or (v_label is not null and length(v_label) > 80) then
    raise exception 'RSV_INVALID: name both the borrowing approver role and its step label, or neither' using errcode = 'P0001'; end if;
  perform public.stock_assert_standalone(v_org);
  select * into o from public.organizations x where x.id = v_org for update;
  if (o.stock_reservations, o.reservation_borrow_mode, o.reservation_borrow_role, o.reservation_borrow_label)
       is not distinct from (p_on, p_borrow_mode, p_borrow_role, v_label) then return p_on; end if;
  update public.organizations
     set stock_reservations = p_on, reservation_borrow_mode = p_borrow_mode, reservation_borrow_role = p_borrow_role, reservation_borrow_label = v_label
   where id = v_org;
  perform public.log_audit('stock.reservations', v_org, auth.uid(), v_org,
    jsonb_build_object('from', jsonb_build_object('on', o.stock_reservations, 'mode', o.reservation_borrow_mode, 'role', o.reservation_borrow_role),
                       'to', jsonb_build_object('on', p_on, 'mode', p_borrow_mode, 'role', p_borrow_role)));
  return p_on;
end $$;

revoke all on function public.rsv_today(uuid), public.rsv_reserved(uuid, uuid, uuid), public.rsv_free(uuid, uuid, uuid),
  public.rsv_assert_may(uuid, uuid, uuid), public.rsv_sweep(uuid) from public, anon, authenticated;
revoke all on function public.reserve_stock(uuid, uuid, uuid, numeric, date, text, uuid), public.release_reservation(uuid, numeric, text),
  public.release_stale_reservations(), public.set_stock_reservations(boolean, text, public.user_role, text) from public, anon;
grant execute on function public.reserve_stock(uuid, uuid, uuid, numeric, date, text, uuid), public.release_reservation(uuid, numeric, text),
  public.release_stale_reservations(), public.set_stock_reservations(boolean, text, public.user_role, text) to authenticated;
