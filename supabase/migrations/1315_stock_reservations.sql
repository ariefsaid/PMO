-- 1315_stock_reservations.sql — #2693 (spec docs/specs/stock-reservations.spec.md; plan docs/plans/2026-11-21-stock-reservations.md).
-- Proven by supabase/tests/1315_stock_reservations.test.sql. A reservation is a separate book: nothing here reads or writes the stock ledger.
--   §1 organisation settings (all default off / unset): stock_reservations, reservation_borrow_mode, reservation_borrow_role, reservation_borrow_label.
--   §2 stock_reservations: a work order holds a quantity of an item at a location. §3 stock_reservation_events: append-only history.
-- ── REVERSE (also rollback/1315_stock_reservations_down.sql): drop the tables and helper, then the four columns.

alter table public.organizations
  add column stock_reservations boolean not null default false,
  add column reservation_borrow_mode text not null default 'approve' check (reservation_borrow_mode in ('approve', 'warn')),
  add column reservation_borrow_role public.user_role,
  add column reservation_borrow_label text check (reservation_borrow_label is null or length(btrim(reservation_borrow_label)) between 1 and 80);

create or replace function public.stock_reservations_on(p_org uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select o.stock_reservations from public.organizations o where o.id = p_org), false) $$;
revoke all on function public.stock_reservations_on(uuid) from public, anon;
grant execute on function public.stock_reservations_on(uuid) to authenticated;

create table public.stock_reservations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  work_order_id uuid not null references public.work_orders(id),
  item_id      uuid not null references public.stock_items(id),
  warehouse_id uuid not null references public.stock_warehouses(id),
  quantity     numeric(14,3) not null check (quantity > 0 and quantity < 100000000000),
  consumed_qty numeric(14,3) not null default 0 check (consumed_qty >= 0),
  released_qty numeric(14,3) not null default 0 check (released_qty >= 0),
  status       text not null default 'active' check (status in ('active', 'released', 'expired', 'consumed')),
  expires_on   date,
  note         text check (note is null or length(note) <= 1000),
  created_by   uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),
  constraint stock_reservations_not_overdrawn check (consumed_qty + released_qty <= quantity)          -- mut:rsv_overdraw
);
create unique index stock_reservations_one_active on public.stock_reservations (org_id, work_order_id, item_id, warehouse_id) where status = 'active';
create index stock_reservations_item_idx on public.stock_reservations (org_id, item_id, warehouse_id) where status = 'active';
create index stock_reservations_wo_idx on public.stock_reservations (work_order_id);

create table public.stock_reservation_events (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  reservation_id uuid not null references public.stock_reservations(id),
  action         text not null check (action in ('reserve', 'adjust', 'release', 'expire', 'consume', 'lend')),
  qty            numeric(14,3) not null check (qty > 0),
  request_id     uuid references public.material_requests(id),
  actor_id       uuid,
  reason         text check (reason is null or length(reason) <= 500),
  client_request_id uuid,
  created_at     timestamptz not null default now()
);
create index stock_reservation_events_res_idx on public.stock_reservation_events (reservation_id, created_at);
create unique index stock_reservation_events_idem on public.stock_reservation_events (org_id, actor_id, client_request_id) where client_request_id is not null;

create trigger stock_reservations_stamp_org_id before insert on public.stock_reservations for each row execute function public.stamp_org_id();
create trigger stock_reservation_events_stamp_org_id before insert on public.stock_reservation_events for each row execute function public.stamp_org_id();

-- A reservation row is never deleted; its events are never changed.
create or replace function public.guard_stock_reservation_rows() returns trigger
  language plpgsql set search_path = public as $$
begin
  raise exception 'RSV_IMMUTABLE: reservations and their history cannot be deleted or rewritten; release the reservation instead' using errcode = 'P0001';
end $$;
revoke all on function public.guard_stock_reservation_rows() from public, anon, authenticated;
create trigger stock_reservations_no_delete before delete on public.stock_reservations for each row execute function public.guard_stock_reservation_rows();
create trigger stock_reservation_events_append_only before update or delete on public.stock_reservation_events for each row execute function public.guard_stock_reservation_rows();

alter table public.stock_reservations enable row level security;
alter table public.stock_reservations force row level security;
alter table public.stock_reservation_events enable row level security;
alter table public.stock_reservation_events force row level security;
create policy stock_reservations_select on public.stock_reservations for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy stock_reservation_events_select on public.stock_reservation_events for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.stock_reservations, public.stock_reservation_events from authenticated, anon;
revoke insert, update, delete, truncate, trigger, references on public.stock_reservations, public.stock_reservation_events from service_role;
grant select on public.stock_reservations, public.stock_reservation_events to authenticated;      -- no client write: the RPCs write as their owner
