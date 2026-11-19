-- 1000_material_requests.sql — #2524 material requests against a work order: SCHEMA.
-- Spec docs/specs/material-requests.spec.md · plan docs/plans/2026-11-20-material-requests.md.
-- The RPCs that are the ONLY writers live in 1001_material_request_rpcs.sql. Proven by
-- supabase/tests/mrq_approval.test.sql and supabase/tests/mrq_submit_transfer.test.sql.
--
-- Shape:
--   material_request_settings   one row per org: the optional daily cut-off (FR-MRQ-014, OD-MRQ-6).
--   approval_chain_steps        the org's ordered approval chain (FR-MRQ-005, OD-MRQ-1/2): role + purpose label.
--   approval_stand_ins          date-ranged, one-hop stand-ins (FR-MRQ-009, OD-MRQ-4).
--   material_requests           the request header; status machine draft → pending → approved → fulfilled,
--                               with returned → draft, rejected and cancelled (FR-MRQ-003).
--   material_request_lines      item, quantity, plan and prior-request snapshots, over-plan reason (FR-MRQ-002).
--   material_request_steps      the chain snapshotted per submission round (FR-MRQ-006), one decision per row,
--                               decider and the person they stood in for both stored (FR-MRQ-008/009).
--   material_request_events     append-only transition log: actor, stand-in-for, time, reason (FR-MRQ-018).
--
-- No client role holds INSERT/UPDATE/DELETE on any of these tables: every write goes through a security-definer
-- RPC (ADR-0019), so the approval order, the requester-never-approves rule and the stand-in window cannot be
-- side-stepped by a direct table write. RLS + FORCE RLS on every table; reads are same-org active members.
-- org_id is stated by the RPCs from the caller's JWT org and also covered by the 0074 stamp trigger.
--
-- Secondary profile references (decided_by, acted_for, stand_in_id, ...) carry no FK on purpose: a second
-- profiles FK on one table makes every unqualified PostgREST `profiles` embed ambiguous
-- (postgrest_embed_ambiguity_guard, the stock_warehouse_keepers.created_by precedent).
--
-- REVERSE: supabase/migrations/rollback/1000_material_requests_down.sql (drops the seven tables; 1001 first).

create table public.material_request_settings (
  org_id     uuid primary key references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  cutoff_time time,                                   -- null = no cut-off (FR-MRQ-014)
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table public.approval_chain_steps (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  position       integer not null check (position between 1 and 10),
  role           public.user_role not null,
  label          text not null check (length(btrim(label)) between 1 and 80),
  only_over_plan boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (org_id, position)
);

create table public.approval_stand_ins (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  delegator_id uuid not null references public.profiles(id),
  stand_in_id  uuid not null,
  starts_on    date not null,
  ends_on      date not null,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid,
  constraint approval_stand_ins_range check (ends_on >= starts_on and ends_on - starts_on <= 366),
  constraint approval_stand_ins_not_self check (stand_in_id <> delegator_id)
);
create index approval_stand_ins_stand_in_idx on public.approval_stand_ins (org_id, stand_in_id) where revoked_at is null;
create index approval_stand_ins_delegator_idx on public.approval_stand_ins (org_id, delegator_id) where revoked_at is null;

create table public.material_requests (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  number                text not null,
  work_order_id         uuid not null references public.work_orders(id),
  project_id            uuid not null references public.projects(id),       -- the work order's project, copied by the RPC
  to_warehouse_id       uuid references public.stock_warehouses(id),        -- the site the material goes to (optional)
  needed_by             date not null,
  note                  text check (note is null or length(note) <= 1000),
  status                text not null default 'draft'
                          check (status in ('draft','pending','approved','rejected','cancelled','fulfilled')),
  round                 integer not null default 0 check (round >= 0),     -- submissions so far; steps carry it
  client_request_id     uuid,
  submit_request_id     uuid,
  created_by            uuid not null references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  submitted_at          timestamptz,
  decided_at            timestamptz,
  transfer_document_id  uuid references public.stock_documents(id),
  transfer_cancelled    boolean not null default false,
  constraint material_requests_number_uniq unique (org_id, number),
  constraint material_requests_transfer_shape check (
    (status in ('approved','fulfilled')) or transfer_document_id is null)
);
create unique index material_requests_idem_uniq on public.material_requests (org_id, created_by, client_request_id)
  where client_request_id is not null;
create index material_requests_work_order_status_idx on public.material_requests (work_order_id, status);
create index material_requests_org_created_idx on public.material_requests (org_id, created_at desc, id desc);
create index material_requests_transfer_idx on public.material_requests (transfer_document_id) where transfer_document_id is not null;

create table public.material_request_lines (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  request_id       uuid not null references public.material_requests(id) on delete cascade,
  line_no          integer not null check (line_no between 1 and 200),
  item_id          uuid not null references public.stock_items(id),
  quantity         numeric(14,3) not null check (quantity > 0 and quantity < 100000000000),
  plan_qty         numeric(14,3),        -- snapshot at submission (FR-MRQ-002)
  prior_qty        numeric(14,3),        -- already requested/transferred on this work order, snapshot at submission
  over_plan_reason text check (over_plan_reason is null or length(btrim(over_plan_reason)) between 1 and 500),
  unique (request_id, line_no),
  unique (request_id, item_id)
);
create index material_request_lines_item_idx on public.material_request_lines (item_id);

create table public.material_request_steps (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  request_id  uuid not null references public.material_requests(id) on delete cascade,
  round       integer not null check (round >= 1),
  position    integer not null check (position >= 1),
  role        public.user_role not null,
  label       text not null,
  status      text not null default 'waiting'
                check (status in ('waiting','open','approved','returned','rejected','superseded')),
  decided_by  uuid,
  acted_for   uuid,                 -- the delegator when a stand-in decided; null when the decider held the role
  decided_at  timestamptz,
  reason      text check (reason is null or length(btrim(reason)) between 1 and 500),
  unique (request_id, round, position),
  constraint material_request_steps_decided check (
    (status in ('approved','returned','rejected')) = (decided_by is not null and decided_at is not null)),
  constraint material_request_steps_reason check (status not in ('returned','rejected') or reason is not null)
);
create index material_request_steps_open_role_idx on public.material_request_steps (org_id, role) where status = 'open';

create table public.material_request_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  request_id  uuid not null references public.material_requests(id) on delete cascade,
  action      text not null check (action in ('created','submitted','approved_step','returned','rejected','approved',
                                              'cancelled','fulfilled','transfer_cancelled','transfer_created')),
  from_status text,
  to_status   text,
  step_position integer,
  actor_id    uuid,
  acted_for   uuid,
  reason      text,
  created_at  timestamptz not null default now()
);
create index material_request_events_request_idx on public.material_request_events (request_id, created_at);

-- 0074 idiom: the caller's real org overrides the seed-org default.
create trigger material_request_settings_stamp_org_id before insert on public.material_request_settings for each row execute function public.stamp_org_id();
create trigger approval_chain_steps_stamp_org_id      before insert on public.approval_chain_steps      for each row execute function public.stamp_org_id();
create trigger approval_stand_ins_stamp_org_id        before insert on public.approval_stand_ins        for each row execute function public.stamp_org_id();
create trigger material_requests_stamp_org_id         before insert on public.material_requests         for each row execute function public.stamp_org_id();
create trigger material_request_lines_stamp_org_id    before insert on public.material_request_lines    for each row execute function public.stamp_org_id();
create trigger material_request_steps_stamp_org_id    before insert on public.material_request_steps    for each row execute function public.stamp_org_id();
create trigger material_request_events_stamp_org_id   before insert on public.material_request_events   for each row execute function public.stamp_org_id();

-- Append-only event log, also against the owner's own definers.
create or replace function public.guard_material_request_events_append_only() returns trigger
  language plpgsql set search_path = public as $$
begin
  raise exception 'MRQ_IMMUTABLE: request history cannot be changed' using errcode = 'P0001';
end $$;
revoke all on function public.guard_material_request_events_append_only() from public, anon, authenticated;
create trigger material_request_events_append_only before update or delete on public.material_request_events
  for each row execute function public.guard_material_request_events_append_only();

alter table public.material_request_settings enable row level security; alter table public.material_request_settings force row level security;
alter table public.approval_chain_steps      enable row level security; alter table public.approval_chain_steps      force row level security;
alter table public.approval_stand_ins        enable row level security; alter table public.approval_stand_ins        force row level security;
alter table public.material_requests         enable row level security; alter table public.material_requests         force row level security;
alter table public.material_request_lines    enable row level security; alter table public.material_request_lines    force row level security;
alter table public.material_request_steps    enable row level security; alter table public.material_request_steps    force row level security;
alter table public.material_request_events   enable row level security; alter table public.material_request_events   force row level security;

-- Reads: same-org active members (work orders and stock documents are org-wide reads today, 0193/0413).
create policy material_request_settings_select on public.material_request_settings for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy approval_chain_steps_select on public.approval_chain_steps for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy approval_stand_ins_select on public.approval_stand_ins for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy material_requests_select on public.material_requests for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy material_request_lines_select on public.material_request_lines for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy material_request_steps_select on public.material_request_steps for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy material_request_events_select on public.material_request_events for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

-- Grants: SELECT only. Explicit revokes first (hosted Supabase grants new tables to client roles by default).
revoke all on public.material_request_settings, public.approval_chain_steps, public.approval_stand_ins,
  public.material_requests, public.material_request_lines, public.material_request_steps, public.material_request_events
  from public, anon, authenticated;
grant select on public.material_request_settings, public.approval_chain_steps, public.approval_stand_ins,
  public.material_requests, public.material_request_lines, public.material_request_steps, public.material_request_events
  to authenticated;
