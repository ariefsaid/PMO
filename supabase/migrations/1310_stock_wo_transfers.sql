-- 1310_stock_wo_transfers.sql — #2691 (spec docs/specs/stock-work-order-transfer.spec.md; plan docs/plans/2026-11-21-stock-work-order-transfer.md).
-- Proven by supabase/tests/1310_stock_wo_transfer.test.sql. Nothing here writes the ledger.
--   §1 stock_wo_transfers: the one document of a move between work orders (header only; its lines are the lines of its two stock documents).
--   §2 stock_documents.wo_transfer_id: links the return half and the issue half; set only by post_stock_wo_transfer (system switch), never changed.
-- ── REVERSE (also supabase/migrations/rollback/1310_stock_wo_transfers_down.sql): drop the trigger and function, the column, then the table.

create table public.stock_wo_transfers (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id),
  number             text not null,
  project_id         uuid not null references public.projects(id),
  warehouse_id       uuid not null references public.stock_warehouses(id),
  from_work_order_id uuid not null references public.work_orders(id),
  to_work_order_id   uuid not null references public.work_orders(id),
  note               text check (note is null or length(note) <= 1000),
  occurred_on        date not null,
  client_request_id  uuid,
  created_by         uuid not null references public.profiles(id),
  created_at         timestamptz not null default now(),
  constraint stock_wo_transfers_number_uniq unique (org_id, number),
  constraint stock_wo_transfers_ends check (from_work_order_id <> to_work_order_id)
);
create unique index stock_wo_transfers_idem_uniq on public.stock_wo_transfers (org_id, created_by, client_request_id) where client_request_id is not null;
create index stock_wo_transfers_org_created_idx on public.stock_wo_transfers (org_id, created_at desc, id desc);
create index stock_wo_transfers_from_idx on public.stock_wo_transfers (from_work_order_id);
create index stock_wo_transfers_to_idx on public.stock_wo_transfers (to_work_order_id);

alter table public.stock_wo_transfers enable row level security;
alter table public.stock_wo_transfers force row level security;
create policy stock_wo_transfers_select on public.stock_wo_transfers for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.stock_wo_transfers from authenticated, anon;
revoke insert, update, delete, truncate, trigger, references on public.stock_wo_transfers from service_role;
grant select on public.stock_wo_transfers to authenticated;                         -- no client write: the RPC writes as its owner

-- A posted move is never edited or removed; the correction is a move the other way (FR-WOT-008).
create or replace function public.guard_stock_wo_transfer() returns trigger
  language plpgsql set search_path = public as $$
begin
  raise exception 'STK_IMMUTABLE: a work-order transfer cannot be changed or deleted; move the stock back instead' using errcode = 'P0001';
end $$;
revoke all on function public.guard_stock_wo_transfer() from public, anon, authenticated;
create trigger stock_wo_transfers_guard before update or delete on public.stock_wo_transfers for each row execute function public.guard_stock_wo_transfer();

alter table public.stock_documents add column wo_transfer_id uuid references public.stock_wo_transfers(id);
create index stock_documents_wo_transfer_idx on public.stock_documents (wo_transfer_id) where wo_transfer_id is not null;

-- Only the RPC (system switch, 1305) may link a return or issue to a move, and the link never changes.
create or replace function public.guard_stock_document_wo_transfer() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.wo_transfer_id is distinct from old.wo_transfer_id then
      raise exception 'STK_WOT_SYSTEM: the work-order transfer of a document cannot change' using errcode = 'P0001'; end if;
    return new;
  end if;
  if new.wo_transfer_id is not null
     and (not public.stock_system_write_on() or new.kind not in ('return', 'issue')) then                -- mut:wot_system_only
    raise exception 'STK_WOT_SYSTEM: only a work-order transfer writes its own return and issue' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke all on function public.guard_stock_document_wo_transfer() from public, anon, authenticated;
create trigger stock_documents_zz_wo_transfer before insert or update of wo_transfer_id on public.stock_documents
  for each row execute function public.guard_stock_document_wo_transfer();
