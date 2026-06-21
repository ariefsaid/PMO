-- 0036_procurement_record_files.sql — Per-record procurement file tables (PR/RFQ/PO/Payment).
-- Forward-only, additive. Bucket + storage policies are UNCHANGED — reused from 0028.
-- Reversibility (pre-prod): supabase db reset. Forward rollback:
--   drop table if exists payment_files;
--   drop table if exists purchase_order_files;
--   drop table if exists rfq_files;
--   drop table if exists purchase_request_files;
--   drop function if exists stamp_payment_file_org();
--   drop function if exists stamp_purchase_order_file_org();
--   drop function if exists stamp_rfq_file_org();
--   drop function if exists stamp_purchase_request_file_org();
--
-- Pattern: mirrors 0028 per-phase procurement file tables. Four near-identical typed child tables —
-- one per new record type (PR/RFQ/PO/Payment) — with real FKs + on-delete-cascade.
-- The 0028 storage write policy (storage_objects_proc_file_write) gates on segment-2 = an in-org
-- procurement (not on the phase segment), so it already admits the new record types without
-- modification. Slice 2 reuses it as-is. AC-PR-010 proves it. Force-RLS per ADR-0004;
-- parent-record org guard per HIGH-BV-1; org-stamp trigger per 0015/0028.

-- ── §1 purchase_request_files ────────────────────────────────────────────────
create table purchase_request_files (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  purchase_request_id uuid not null references purchase_requests(id) on delete cascade,
  title               text,
  file_path           text,
  uploaded_by_id      uuid references profiles(id),
  created_at          timestamptz not null default now(),
  archived_at         timestamptz
);
-- Partial composite index matching the list hot-path: WHERE purchase_request_id = ? AND
-- archived_at IS NULL ORDER BY created_at DESC. The partial predicate keeps the index
-- to only the live (non-archived) rows. (NFR-PR-PERF-001)
create index purchase_request_files_parent_idx
  on purchase_request_files (purchase_request_id, created_at desc) where archived_at is null;
alter table purchase_request_files enable row level security;
alter table purchase_request_files force  row level security;
-- SELECT visibility = org-wide, in deliberate parity with the parent procurement (see 0028 §1
-- for the full rationale — file metadata is no more sensitive than procurement rows in-org
-- users already read). If parent SELECT is ever scoped, this must be scoped in lockstep.
create policy purchase_request_files_select on purchase_request_files
  for select using (org_id = auth_org_id());
create policy purchase_request_files_write on purchase_request_files for all
  using (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.purchase_requests r
                where r.id = purchase_request_files.purchase_request_id
                  and r.org_id = auth_org_id()))
  with check (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.purchase_requests r
                where r.id = purchase_request_files.purchase_request_id
                  and r.org_id = auth_org_id()));

-- ── §2 rfq_files ─────────────────────────────────────────────────────────────
create table rfq_files (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  rfq_id     uuid not null references rfqs(id) on delete cascade,
  title      text,
  file_path  text,
  uploaded_by_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index rfq_files_parent_idx
  on rfq_files (rfq_id, created_at desc) where archived_at is null;
alter table rfq_files enable row level security;
alter table rfq_files force  row level security;
create policy rfq_files_select on rfq_files
  for select using (org_id = auth_org_id());
create policy rfq_files_write on rfq_files for all
  using (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.rfqs r
                where r.id = rfq_files.rfq_id
                  and r.org_id = auth_org_id()))
  with check (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.rfqs r
                where r.id = rfq_files.rfq_id
                  and r.org_id = auth_org_id()));

-- ── §3 purchase_order_files ───────────────────────────────────────────────────
create table purchase_order_files (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  purchase_order_id  uuid not null references purchase_orders(id) on delete cascade,
  title              text,
  file_path          text,
  uploaded_by_id     uuid references profiles(id),
  created_at         timestamptz not null default now(),
  archived_at        timestamptz
);
create index purchase_order_files_parent_idx
  on purchase_order_files (purchase_order_id, created_at desc) where archived_at is null;
alter table purchase_order_files enable row level security;
alter table purchase_order_files force  row level security;
create policy purchase_order_files_select on purchase_order_files
  for select using (org_id = auth_org_id());
create policy purchase_order_files_write on purchase_order_files for all
  using (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.purchase_orders r
                where r.id = purchase_order_files.purchase_order_id
                  and r.org_id = auth_org_id()))
  with check (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.purchase_orders r
                where r.id = purchase_order_files.purchase_order_id
                  and r.org_id = auth_org_id()));

-- ── §4 payment_files ─────────────────────────────────────────────────────────
create table payment_files (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  payment_id uuid not null references payments(id) on delete cascade,
  title      text,
  file_path  text,
  uploaded_by_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index payment_files_parent_idx
  on payment_files (payment_id, created_at desc) where archived_at is null;
alter table payment_files enable row level security;
alter table payment_files force  row level security;
create policy payment_files_select on payment_files
  for select using (org_id = auth_org_id());
create policy payment_files_write on payment_files for all
  using (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.payments r
                where r.id = payment_files.payment_id
                  and r.org_id = auth_org_id()))
  with check (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.payments r
                where r.id = payment_files.payment_id
                  and r.org_id = auth_org_id()));

-- ── §5 org_id stamp triggers (mirror 0028 §6 / 0015 stamp_procurement_item_org) ──
-- The client NEVER sends org_id; the column default is the seed org. A BEFORE INSERT trigger
-- inherits org_id from the parent RECORD row whenever the client left it null / at the seed
-- default, so the *_write WITH CHECK (org_id = auth_org_id()) passes for any org. An
-- EXPLICITLY-sent org_id is preserved untouched — a cross-org spoof still hits WITH CHECK
-- rather than being silently rewritten. search_path pinned + schema-qualified (LOW-BV-1).

create or replace function stamp_purchase_request_file_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select r.org_id into new.org_id
      from public.purchase_requests r where r.id = new.purchase_request_id;
  end if;
  return new;
end; $$;
create trigger purchase_request_files_stamp_org
  before insert on purchase_request_files
  for each row execute function stamp_purchase_request_file_org();

create or replace function stamp_rfq_file_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select r.org_id into new.org_id
      from public.rfqs r where r.id = new.rfq_id;
  end if;
  return new;
end; $$;
create trigger rfq_files_stamp_org
  before insert on rfq_files
  for each row execute function stamp_rfq_file_org();

create or replace function stamp_purchase_order_file_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select r.org_id into new.org_id
      from public.purchase_orders r where r.id = new.purchase_order_id;
  end if;
  return new;
end; $$;
create trigger purchase_order_files_stamp_org
  before insert on purchase_order_files
  for each row execute function stamp_purchase_order_file_org();

create or replace function stamp_payment_file_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select r.org_id into new.org_id
      from public.payments r where r.id = new.payment_id;
  end if;
  return new;
end; $$;
create trigger payment_files_stamp_org
  before insert on payment_files
  for each row execute function stamp_payment_file_org();
