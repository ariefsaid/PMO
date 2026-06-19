-- 0035_procurement_record_tables.sql — Procurement record tables: PR / RFQ / PO / Payment
-- Forward-only, additive; reversibility contract is `supabase db reset` (pre-production, ADR-0006).
--
-- Adds the four ERP-canonical record tables under the `procurements` case folder (ADR-0033 Model C):
--   • purchase_requests  — PR record (1:N under procurement)
--   • rfqs               — RFQ record (1:N under procurement)
--   • purchase_orders    — PO record (1:N under procurement)
--   • payments           — Payment evidence (1:N under procurement; nullable invoice_id FK)
-- Adds settlement predecessor FKs to the reused child tables:
--   • procurement_receipts.po_id  → purchase_orders (nullable, FR-PR-004b)
--   • procurement_invoices.po_id  → purchase_orders (nullable, FR-PR-004b/004d)
-- Adds P2-seam columns to procurement_quotations:
--   • rfq_id     → rfqs (nullable, FR-PR-004 RFQ→Quotation 1:N)
--   • valid_until date (nullable, FR-PR-009)
--
-- force-RLS per ADR-0004; parent-org guard per HIGH-BV-1; org-stamp trigger per 0015/0028 pattern.
--
-- Forward rollback (drop in reverse dependency order):
--   alter table procurement_quotations drop column if exists valid_until;
--   alter table procurement_quotations drop column if exists rfq_id;
--   alter table procurement_invoices   drop column if exists po_id;
--   alter table procurement_receipts   drop column if exists po_id;
--   drop table if exists payments;
--   drop table if exists purchase_orders;
--   drop table if exists rfqs;
--   drop table if exists purchase_requests;
--   drop function if exists stamp_payment_org();
--   drop function if exists stamp_purchase_order_org();
--   drop function if exists stamp_rfq_org();
--   drop function if exists stamp_purchase_request_org();

-- ============================================================================
-- §1 — Four record tables (FR-PR-002/003/004)
-- status = text + CHECK per [PD-1]: four uniform tables, no enum sprawl, reversible.
-- ============================================================================

create table purchase_requests (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id   uuid not null references procurements(id) on delete cascade,
  pr_number        text,
  reference_number text,
  status           text not null default 'Draft' check (status in ('Draft','Submitted','Approved','Closed')),
  date             date,
  amount           numeric(14,2),
  created_at       timestamptz not null default now()
);
create index purchase_requests_procurement_idx on purchase_requests (procurement_id);

create table rfqs (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id   uuid not null references procurements(id) on delete cascade,
  rfq_number       text,
  reference_number text,
  status           text not null default 'Draft' check (status in ('Draft','Issued','Closed')),
  date             date,
  amount           numeric(14,2),
  created_at       timestamptz not null default now()
);
create index rfqs_procurement_idx on rfqs (procurement_id);

create table purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id   uuid not null references procurements(id) on delete cascade,
  po_number        text,
  reference_number text,
  status           text not null default 'Draft' check (status in ('Draft','Issued','Acknowledged','Closed')),
  date             date,
  amount           numeric(14,2),
  created_at       timestamptz not null default now()
);
create index purchase_orders_procurement_idx on purchase_orders (procurement_id);

create table payments (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id   uuid not null references procurements(id) on delete cascade,
  invoice_id       uuid references procurement_invoices(id),   -- nullable settlement predecessor (FR-PR-004b)
  pay_number       text,
  reference_number text,
  status           text not null default 'Scheduled' check (status in ('Scheduled','Paid')),
  date             date,
  amount           numeric(14,2),
  created_at       timestamptz not null default now()
);
create index payments_procurement_idx on payments (procurement_id);

-- ============================================================================
-- §2 — Settlement predecessor FKs + quotation P2-seam columns (Task 1.2)
-- ============================================================================

alter table procurement_receipts add column po_id uuid references purchase_orders(id);  -- FR-PR-004b nullable
alter table procurement_invoices add column po_id uuid references purchase_orders(id);  -- FR-PR-004b/004d nullable

alter table procurement_quotations
  add column rfq_id      uuid references rfqs(id),  -- FR-PR-004 RFQ→Quotation 1:N, nullable
  add column valid_until date;                      -- FR-PR-009 P2 seam, nullable

-- ============================================================================
-- §3 — Force-RLS + select/write policies (Task 1.3 / NFR-PR-SEC-001)
-- Pattern: exact shape of procurement_receipts_write (0006) — read-in-org SELECT +
-- 4-role-write + parent-case-org-guard FOR ALL.
-- ============================================================================

alter table purchase_requests enable row level security;
alter table purchase_requests force  row level security;
create policy purchase_requests_select on purchase_requests for select using (org_id = auth_org_id());
create policy purchase_requests_write on purchase_requests for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = purchase_requests.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = purchase_requests.procurement_id and p.org_id = auth_org_id()));

alter table rfqs enable row level security;
alter table rfqs force  row level security;
create policy rfqs_select on rfqs for select using (org_id = auth_org_id());
create policy rfqs_write on rfqs for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = rfqs.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = rfqs.procurement_id and p.org_id = auth_org_id()));

alter table purchase_orders enable row level security;
alter table purchase_orders force  row level security;
create policy purchase_orders_select on purchase_orders for select using (org_id = auth_org_id());
create policy purchase_orders_write on purchase_orders for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id()));

alter table payments enable row level security;
alter table payments force  row level security;
create policy payments_select on payments for select using (org_id = auth_org_id());
create policy payments_write on payments for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id()));

-- ============================================================================
-- §4 — BEFORE INSERT org-stamp triggers (Task 1.4)
-- Mirrors stamp_procurement_item_org (0015): inherit org_id from the parent procurement
-- when the client left it null or at the seed-default. An explicit cross-org org_id is
-- preserved so it hits WITH CHECK (the cross-org spoof path). search_path pinned + schema-
-- qualified (LOW-BV-1). INVOKER (no definer rights needed — reads procurements, which the
-- org-stamp trigger fires even when inserted as table owner).
-- ============================================================================

create or replace function stamp_purchase_request_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select p.org_id into new.org_id from public.procurements p where p.id = new.procurement_id;
  end if;
  return new;
end; $$;
create trigger purchase_requests_stamp_org
  before insert on purchase_requests for each row execute function stamp_purchase_request_org();

create or replace function stamp_rfq_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select p.org_id into new.org_id from public.procurements p where p.id = new.procurement_id;
  end if;
  return new;
end; $$;
create trigger rfqs_stamp_org
  before insert on rfqs for each row execute function stamp_rfq_org();

create or replace function stamp_purchase_order_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select p.org_id into new.org_id from public.procurements p where p.id = new.procurement_id;
  end if;
  return new;
end; $$;
create trigger purchase_orders_stamp_org
  before insert on purchase_orders for each row execute function stamp_purchase_order_org();

create or replace function stamp_payment_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select p.org_id into new.org_id from public.procurements p where p.id = new.procurement_id;
  end if;
  return new;
end; $$;
create trigger payments_stamp_org
  before insert on payments for each row execute function stamp_payment_org();
