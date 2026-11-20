-- 1086_client_requisitions.sql — #2585 client material requisitions per work order: SCHEMA.
-- Spec docs/specs/client-material-requisitions.spec.md · plan docs/plans/2026-11-20-client-material-requisitions.md.
-- The RPCs that are the ONLY writers live in 1087_client_requisition_rpcs.sql. Proven by supabase/tests/csr_requisition.test.sql
-- and supabase/tests/csr_pickup.test.sql.
--
-- Shape (FR-CSR-001..023):
--   client_requisitions          header: draft -> open -> (cancelled); one work order; the project is copied from it.
--   client_requisition_lines     a stock item (zero-cost tagged), take-off and requested quantity, optional allocation row.
--   client_requisition_events    append-only: created, sent, cancelled (header events carry no line), reserved, released,
--                                pickup (line events carry a quantity). Reserved = reserved - released; progress is derived.
--   client_requisition_pickups   one row per posted pickup, linked to the stock receipt the RPC created and posted.
-- Nothing is stored as a counter (FR-CSR-019). No requisition field holds an amount of money (spec Context).
-- No client role holds INSERT/UPDATE/DELETE on any of these tables: every write is a security-definer RPC (ADR-0019).
-- RLS + FORCE RLS on every table; reads are same-org active members (as material_requests, 1000).
-- Secondary profile references (sent_by, cancelled_by, recorded_by) carry no FK on purpose: a second profiles FK on one
-- table makes every unqualified PostgREST `profiles` embed ambiguous (the 1000 precedent).
-- REVERSE: supabase/migrations/rollback/1086_client_requisitions_down.sql (drops the four tables; 1087 first).

create table public.client_requisitions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  number            text not null,
  work_order_id     uuid not null references public.work_orders(id),
  project_id        uuid not null references public.projects(id),          -- the work order's project, copied by the RPC
  client_reference  text check (client_reference is null or length(btrim(client_reference)) between 1 and 120),
  status            text not null default 'draft' check (status in ('draft','open','cancelled')),
  client_request_id uuid,
  send_request_id   uuid,
  created_by        uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  sent_by           uuid,
  sent_at           timestamptz,
  cancelled_by      uuid,
  cancelled_at      timestamptz,
  constraint client_requisitions_number_uniq unique (org_id, number)
);
create unique index client_requisitions_idem_uniq on public.client_requisitions (org_id, created_by, client_request_id)
  where client_request_id is not null;
create index client_requisitions_work_order_status_idx on public.client_requisitions (work_order_id, status);
create index client_requisitions_org_created_idx on public.client_requisitions (org_id, created_at desc, id desc);

create table public.client_requisition_lines (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  requisition_id      uuid not null references public.client_requisitions(id) on delete cascade,
  line_no             integer not null check (line_no between 1 and 200),
  stock_item_id       uuid not null references public.stock_items(id),
  work_order_line_id  uuid references public.work_order_lines(id),         -- the allocation row to a BoQ line (0337), optional
  takeoff_quantity    numeric(14,3) not null check (takeoff_quantity > 0 and takeoff_quantity < 100000000000),
  requested_quantity  numeric(14,3) not null check (requested_quantity > 0 and requested_quantity < 100000000000),
  unit_code           text not null,                                        -- the item's unit when the line was saved
  unique (requisition_id, line_no)
);
create index client_requisition_lines_requisition_idx on public.client_requisition_lines (requisition_id);
create index client_requisition_lines_item_idx on public.client_requisition_lines (stock_item_id);

create table public.client_requisition_pickups (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  requisition_id    uuid not null references public.client_requisitions(id),
  line_id           uuid not null references public.client_requisition_lines(id),
  quantity          numeric(14,3) not null check (quantity > 0 and quantity < 100000000000),
  picked_up_on      date not null,
  collector         text check (collector is null or length(btrim(collector)) between 1 and 200),
  paper_reference   text check (paper_reference is null or length(btrim(paper_reference)) between 1 and 200),
  warehouse_id      uuid not null references public.stock_warehouses(id),
  stock_document_id uuid not null references public.stock_documents(id),
  client_request_id uuid,
  recorded_by       uuid not null,
  created_at        timestamptz not null default now()
);
create index client_requisition_pickups_line_idx on public.client_requisition_pickups (line_id);
create index client_requisition_pickups_requisition_idx on public.client_requisition_pickups (requisition_id);
create unique index client_requisition_pickups_idem_uniq on public.client_requisition_pickups (org_id, recorded_by, client_request_id)
  where client_request_id is not null;

create table public.client_requisition_events (
  seq               bigint generated always as identity,
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  requisition_id    uuid not null references public.client_requisitions(id),
  line_id           uuid references public.client_requisition_lines(id),   -- null for a header transition
  kind              text not null check (kind in ('created','sent','cancelled','reserved','released','pickup')),
  quantity          numeric(14,3),
  client_reference  text,
  event_on          date,
  reason            text check (reason is null or length(reason) <= 1000),
  pickup_id         uuid,
  client_request_id uuid,
  recorded_by       uuid,
  created_at        timestamptz not null default now(),
  constraint client_requisition_events_shape check (
    (kind in ('created','sent','cancelled') and line_id is null and quantity is null)
    or (kind in ('reserved','released','pickup') and line_id is not null and quantity is not null and quantity > 0))
);
create index client_requisition_events_requisition_idx on public.client_requisition_events (requisition_id, seq);
create index client_requisition_events_line_idx on public.client_requisition_events (line_id, seq);
create unique index client_requisition_events_idem_uniq on public.client_requisition_events (line_id, kind, client_request_id)
  where client_request_id is not null;

-- 0074 idiom: the caller's real org overrides the seed-org default.
create trigger client_requisitions_stamp_org_id        before insert on public.client_requisitions        for each row execute function public.stamp_org_id();
create trigger client_requisition_lines_stamp_org_id   before insert on public.client_requisition_lines   for each row execute function public.stamp_org_id();
create trigger client_requisition_pickups_stamp_org_id before insert on public.client_requisition_pickups for each row execute function public.stamp_org_id();
create trigger client_requisition_events_stamp_org_id  before insert on public.client_requisition_events  for each row execute function public.stamp_org_id();

-- Append-only: events and posted pickups are never edited or deleted (FR-CSR-017, FR-CSR-023), also against the owner's own definers.
create or replace function public.guard_client_requisition_history() returns trigger
  language plpgsql set search_path = public as $$
begin
  raise exception 'CSR_IMMUTABLE: requisition history cannot be changed' using errcode = 'P0001';
end $$;
revoke all on function public.guard_client_requisition_history() from public, anon, authenticated;
create trigger client_requisition_events_append_only before update or delete on public.client_requisition_events
  for each row execute function public.guard_client_requisition_history();
create trigger client_requisition_pickups_append_only before update or delete on public.client_requisition_pickups
  for each row execute function public.guard_client_requisition_history();

alter table public.client_requisitions        enable row level security; alter table public.client_requisitions        force row level security;
alter table public.client_requisition_lines   enable row level security; alter table public.client_requisition_lines   force row level security;
alter table public.client_requisition_pickups enable row level security; alter table public.client_requisition_pickups force row level security;
alter table public.client_requisition_events  enable row level security; alter table public.client_requisition_events  force row level security;

-- Reads: same-org active members, as material requests (1000). `can('view')` only decides whether the section is offered.
create policy client_requisitions_select on public.client_requisitions for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy client_requisition_lines_select on public.client_requisition_lines for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy client_requisition_pickups_select on public.client_requisition_pickups for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy client_requisition_events_select on public.client_requisition_events for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

-- Grants: SELECT only. Explicit revokes first (hosted Supabase grants new tables to client roles by default).
revoke all on public.client_requisitions, public.client_requisition_lines, public.client_requisition_pickups, public.client_requisition_events
  from public, anon, authenticated;
grant select on public.client_requisitions, public.client_requisition_lines, public.client_requisition_pickups, public.client_requisition_events
  to authenticated;
