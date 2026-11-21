-- 1306_stock_transfers.sql — #2690 (spec docs/specs/stock-two-step-transfer.spec.md). Proven by supabase/tests/1306_stock_two_step_transfer.test.sql.
--   §1 stock_transfers (the two-step header) and stock_transfer_lines (sent / counted / accepted / rejected / short), organisation-isolated, RPC-written.
--   §2 stock_documents.two_step_id and the rule that, while an organisation is two_step, a transfer posts only as a leg of a two-step transfer.
--   §3 stock_transit_reconciliation: ledger balance vs outstanding quantity per transit location and item (internal, no client grant).
-- The posting engine is NOT edited; nothing here writes the ledger.
-- ── REVERSE (rollback/1306_stock_transfers_down.sql): drop the view, trigger and column, then the two tables (transfers must be removed first).

-- §1 ---------------------------------------------------------------------------------------------------
create table public.stock_transfers (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id),
  number                text not null,
  from_warehouse_id     uuid not null references public.stock_warehouses(id),
  to_warehouse_id       uuid not null references public.stock_warehouses(id),
  transit_warehouse_id  uuid not null references public.stock_warehouses(id),
  work_order_id         uuid references public.work_orders(id),
  to_user_id            uuid references public.profiles(id),
  note                  text check (note is null or length(note) <= 1000),
  status                text not null default 'Sent' check (status in ('Sent', 'Received', 'Closed', 'Cancelled')),
  send_document_id      uuid references public.stock_documents(id),            -- set in the same transaction as the send leg
  sent_by               uuid not null references public.profiles(id),
  sent_at               timestamptz not null default now(),
  received_by           uuid references public.profiles(id),
  received_at           timestamptz,
  cancelled_by          uuid references public.profiles(id),
  cancelled_at          timestamptz,
  cancel_reason         text check (cancel_reason is null or length(btrim(cancel_reason)) between 1 and 500),
  client_request_id     uuid,
  constraint stock_transfers_number_uniq unique (org_id, number),
  constraint stock_transfers_ends check (from_warehouse_id <> to_warehouse_id),
  constraint stock_transfers_received_shape check ((status in ('Received', 'Closed')) = (received_at is not null and received_by is not null)),
  constraint stock_transfers_cancel_shape check ((status = 'Cancelled') = (cancelled_at is not null and cancelled_by is not null and cancel_reason is not null))
);
create unique index stock_transfers_idem_uniq on public.stock_transfers (org_id, sent_by, client_request_id) where client_request_id is not null;
create index stock_transfers_org_sent_idx on public.stock_transfers (org_id, sent_at desc, id desc);
create index stock_transfers_status_idx on public.stock_transfers (org_id, status);
create index stock_transfers_receiver_idx on public.stock_transfers (to_user_id) where to_user_id is not null;

create table public.stock_transfer_lines (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  transfer_id       uuid not null references public.stock_transfers(id),
  line_no           integer not null check (line_no > 0),
  item_id           uuid not null references public.stock_items(id),
  qty_sent          numeric(14,3) not null check (qty_sent > 0 and qty_sent < 'Infinity'::numeric),
  qty_counted       numeric(14,3),
  qty_accepted      numeric(14,3),
  qty_rejected      numeric(14,3),
  reject_reason     text check (reject_reason is null or length(btrim(reject_reason)) between 1 and 500),
  quality_result    text check (quality_result in ('pass', 'fail')),
  short_resolution  text check (short_resolution in ('delivered', 'returned', 'written_off')),
  short_reason      text check (short_reason is null or length(btrim(short_reason)) between 1 and 500),
  short_resolved_by uuid references public.profiles(id),
  short_resolved_at timestamptz,
  constraint stock_transfer_lines_uniq unique (transfer_id, line_no),
  constraint stock_transfer_lines_counts_set check ((qty_counted is null) = (qty_accepted is null) and (qty_counted is null) = (qty_rejected is null)),
  constraint stock_transfer_lines_count_cap check (qty_counted is null or (qty_counted >= 0 and qty_counted <= qty_sent)),       -- mut:count_cap
  constraint stock_transfer_lines_accept_sum check (qty_counted is null or (qty_accepted >= 0 and qty_rejected >= 0 and qty_accepted + qty_rejected = qty_counted)),   -- mut:accept_sum
  constraint stock_transfer_lines_quality_fail check (quality_result is distinct from 'fail' or qty_accepted = 0),                -- mut:quality_fail
  constraint stock_transfer_lines_reject_reason check (qty_rejected is null or qty_rejected = 0 or reject_reason is not null),
  constraint stock_transfer_lines_resolution_shape check ((short_resolution is null) = (short_resolved_at is null and short_resolved_by is null)
                                                          and (short_resolution is null or qty_counted < qty_sent)
                                                          and (short_resolution is distinct from 'written_off' or short_reason is not null))
);
create index stock_transfer_lines_transfer_idx on public.stock_transfer_lines (transfer_id);
create index stock_transfer_lines_item_idx on public.stock_transfer_lines (item_id);
create index stock_transfer_lines_open_short_idx on public.stock_transfer_lines (org_id)
  where qty_counted is not null and short_resolution is null;

alter table public.stock_transfers      enable row level security;  alter table public.stock_transfers      force row level security;
alter table public.stock_transfer_lines enable row level security;  alter table public.stock_transfer_lines force row level security;
create policy stock_transfers_select on public.stock_transfers for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy stock_transfer_lines_select on public.stock_transfer_lines for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.stock_transfers, public.stock_transfer_lines from authenticated, anon;
revoke insert, update, delete, truncate, trigger, references on public.stock_transfers, public.stock_transfer_lines from service_role;
grant select on public.stock_transfers, public.stock_transfer_lines to authenticated;      -- no client write: the RPCs write as their owner

-- A transfer's identity never changes; counts and shortfall resolutions are set once.
create or replace function public.guard_stock_transfer() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'STK_IMMUTABLE: a transfer is never deleted' using errcode = 'P0001'; end if;
  if new.org_id is distinct from old.org_id or new.number is distinct from old.number or new.from_warehouse_id is distinct from old.from_warehouse_id
     or new.to_warehouse_id is distinct from old.to_warehouse_id or new.transit_warehouse_id is distinct from old.transit_warehouse_id
     or new.work_order_id is distinct from old.work_order_id or new.to_user_id is distinct from old.to_user_id
     or new.sent_by is distinct from old.sent_by or new.sent_at is distinct from old.sent_at
     or (old.send_document_id is not null and new.send_document_id is distinct from old.send_document_id) then
    raise exception 'STK_IMMUTABLE: the identity of a transfer cannot change' using errcode = 'P0001'; end if;
  if old.status in ('Closed', 'Cancelled') then raise exception 'STK_IMMUTABLE: a closed or cancelled transfer cannot change' using errcode = 'P0001'; end if;
  return new;
end $$;
create or replace function public.guard_stock_transfer_line() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'STK_IMMUTABLE: a transfer line is never deleted' using errcode = 'P0001'; end if;
  if new.transfer_id is distinct from old.transfer_id or new.item_id is distinct from old.item_id or new.qty_sent is distinct from old.qty_sent
     or new.line_no is distinct from old.line_no or new.org_id is distinct from old.org_id then
    raise exception 'STK_IMMUTABLE: the identity of a transfer line cannot change' using errcode = 'P0001'; end if;
  if old.qty_counted is not null and (new.qty_counted is distinct from old.qty_counted or new.qty_accepted is distinct from old.qty_accepted
       or new.qty_rejected is distinct from old.qty_rejected or new.reject_reason is distinct from old.reject_reason
       or new.quality_result is distinct from old.quality_result) then
    raise exception 'STK_IMMUTABLE: a recorded count cannot change' using errcode = 'P0001'; end if;
  if old.short_resolution is not null and new.short_resolution is distinct from old.short_resolution then
    raise exception 'STK_IMMUTABLE: a resolved shortfall cannot change' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke all on function public.guard_stock_transfer(), public.guard_stock_transfer_line() from public, anon, authenticated;
create trigger stock_transfers_guard before update or delete on public.stock_transfers for each row execute function public.guard_stock_transfer();
create trigger stock_transfer_lines_guard before update or delete on public.stock_transfer_lines for each row execute function public.guard_stock_transfer_line();

-- §2 ---------------------------------------------------------------------------------------------------
alter table public.stock_documents add column two_step_id uuid references public.stock_transfers(id);
create index stock_documents_two_step_idx on public.stock_documents (two_step_id) where two_step_id is not null;

-- While an organisation is two_step, a transfer posts only as a leg of a two-step transfer (FR-TST-003).
create or replace function public.guard_stock_document_one_step() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'transfer' and new.status = 'Posted' and new.two_step_id is null
     and public.stock_transfer_mode_of(new.org_id) = 'two_step' then                                  -- mut:one_step_block
    raise exception 'STK_TWO_STEP: your organisation sends transfers in two steps: send, then receive' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.guard_stock_document_one_step() from public, anon, authenticated;
create trigger stock_documents_zz_one_step before insert or update of status, two_step_id on public.stock_documents
  for each row execute function public.guard_stock_document_one_step();

-- §3 ---------------------------------------------------------------------------------------------------
-- Outstanding = sent - accepted - rejected - resolved short (0 once cancelled). The ledger balance at the transit location must equal it.
create view public.stock_transit_reconciliation as
select t.id as transfer_id, t.org_id, t.transit_warehouse_id, l.item_id,
       coalesce(b.qty_on_hand, 0) as ledger_qty,
       sum(case when t.status = 'Cancelled' then 0
                else l.qty_sent - coalesce(l.qty_accepted, 0) - coalesce(l.qty_rejected, 0)
                     - case when l.short_resolution is not null then l.qty_sent - l.qty_counted else 0 end end) as outstanding_qty
  from public.stock_transfers t
  join public.stock_transfer_lines l on l.transfer_id = t.id
  left join public.stock_balances b on b.warehouse_id = t.transit_warehouse_id and b.item_id = l.item_id
 group by t.id, t.org_id, t.transit_warehouse_id, l.item_id, b.qty_on_hand;
revoke all on public.stock_transit_reconciliation from public, anon, authenticated, service_role;
