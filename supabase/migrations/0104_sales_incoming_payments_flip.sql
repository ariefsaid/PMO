-- 0104_sales_incoming_payments_flip.sql (ERPNext P3a, Slice 0, tasks 0.2–0.5)
-- Creates the two NEW machine-written revenue mirror tables (FR-SAR-170, OQ-SAR-SIGN-3) with the org
-- seam (0074 stamp_org_id), the four day-one erp_* feed cols (the 0103 lesson), and the per-command RLS
-- flip mirroring 0100 (forward-compat for a future PMO-native revenue path, OQ-SAR-6): INSERT
-- WITH CHECK (… and not domain_externally_owned(auth_org_id(),'revenue')) → 42501; UPDATE column-pinned
-- by *_native_mirror_guard; DELETE using (… and not …) → 0-row no-op when flipped. No GENERATED column,
-- no derived-completion trigger → no service-role bypass needed (FR-SAR-171). No org is flipped in this
-- migration; the policies are inert until an Operator employs revenue→erpnext.
--
-- Reversibility (pre-production): `supabase db reset`. Manual reverse block (forward-only if promoted):
--   drop table if exists public.sales_invoices;   -- cascades its policies + triggers
--   drop table if exists public.incoming_payments;

-- ============================================================================
-- §1 — sales_invoices (the SI read-model + project enhancement, spec §4.1)
-- ============================================================================
create table if not exists public.sales_invoices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default '00000000-0000-0000-0000-000000000001',
  project_id    uuid references public.projects(id),
  customer_id   uuid references public.companies(id),
  si_number      text,
  reference_number text,                 -- ERP po_no (the customer's PO/bill ref, OQ-SAR-1 #6)
  invoice_date  date,
  amount        numeric(14,2),
  erp_outstanding_amount numeric(14,2),  -- the paid-detection oracle (R9 §2 AR twin)
  status        text not null default 'Draft'
    check (status in ('Draft','Submitted','Unpaid','Paid','Cancelled')),
  erp_docstatus    smallint,
  erp_modified     text,
  erp_amended_from text,
  erp_cancelled_at timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists sales_invoices_org_project_idx on public.sales_invoices (org_id, project_id);
create index if not exists sales_invoices_org_customer_idx on public.sales_invoices (org_id, customer_id);

-- ============================================================================
-- §2 — incoming_payments (the PE-receive read-model, spec §4.2)
-- ============================================================================
create table if not exists public.incoming_payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default '00000000-0000-0000-0000-000000000001',
  customer_id   uuid references public.companies(id),
  sales_invoice_id uuid references public.sales_invoices(id),  -- nullable (on-account receipt)
  ip_number      text,
  reference_number text,                 -- ERP reference_no — ALSO the idempotency-anchor carrier (FR-SAR-042)
  date          date,
  amount        numeric(14,2),
  status        text not null default 'Scheduled'
    check (status in ('Scheduled','Paid')),
  erp_docstatus    smallint,
  erp_modified     text,
  erp_amended_from text,
  erp_cancelled_at timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists incoming_payments_org_customer_idx on public.incoming_payments (org_id, customer_id);
create index if not exists incoming_payments_org_si_idx     on public.incoming_payments (org_id, sales_invoice_id);

-- ============================================================================
-- §3 — stamp_org_id() BEFORE-INSERT on both (0074 pattern). Overrides null/seed org_id only.
-- ============================================================================
create trigger sales_invoices_stamp_org_id
  before insert on public.sales_invoices for each row execute function public.stamp_org_id();
create trigger incoming_payments_stamp_org_id
  before insert on public.incoming_payments for each row execute function public.stamp_org_id();

-- ============================================================================
-- §4 — enable RLS + the per-command flip (0093/0100 template). The revenue domain gates native writes.
-- ============================================================================
alter table public.sales_invoices    enable row level security;
alter table public.incoming_payments enable row level security;
-- FORCE RLS: the table owner (postgres) must ALSO be RLS-subject — the global AC-LOW-1 invariant
-- ('every RLS-enabled public table forces RLS'). Omitting it is a real hole + fails that gate.
alter table public.sales_invoices    force row level security;
alter table public.incoming_payments force row level security;
-- Table GRANTs (mirrors 0096's fresh-table pattern): RLS filters rows, but a role needs the table
-- privilege to touch the table at all — without these, a user SELECT/write raises 'permission
-- denied for table' (42501) rather than being governed by the policies, so RLS is NOT the
-- enforcement authority (ADR-0016) and grant-denial masks RLS-denial (both are SQLSTATE 42501).
-- select/insert/update/delete so the flip policies are the real gate (the 'inert-but-allowed for a
-- non-revenue org, 42501 for an employing org' behavior, spec §7); service_role bypasses RLS.
grant select, insert, update, delete on public.sales_invoices    to authenticated;
grant select, insert, update, delete on public.incoming_payments to authenticated;

create policy sales_invoices_select on sales_invoices for select
  using (org_id = auth_org_id());
create policy sales_invoices_insert on sales_invoices for insert
  with check (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
create policy sales_invoices_update on sales_invoices for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'));
create policy sales_invoices_delete on sales_invoices for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));

create policy incoming_payments_select on incoming_payments for select
  using (org_id = auth_org_id());
create policy incoming_payments_insert on incoming_payments for insert
  with check (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
create policy incoming_payments_update on incoming_payments for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'));
create policy incoming_payments_delete on incoming_payments for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));

-- ============================================================================
-- §5 — *_native_mirror_guard BEFORE-UPDATE triggers (0100 §3 template). Service-role exempt; a
-- non-service caller is exempt only while NOT flipped; while flipped, a native-field change → 42501.
-- ============================================================================
create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or new.project_id is distinct from old.project_id
     or new.reference_number is distinct from old.reference_number
     or new.invoice_date is distinct from old.invoice_date
     or new.amount is distinct from old.amount
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists sales_invoices_native_mirror_guard_trg on public.sales_invoices;
create trigger sales_invoices_native_mirror_guard_trg
  before update on public.sales_invoices for each row execute function public.sales_invoices_native_mirror_guard();

create or replace function public.incoming_payments_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.ip_number is distinct from old.ip_number
     or new.customer_id is distinct from old.customer_id
     or new.sales_invoice_id is distinct from old.sales_invoice_id
     or new.reference_number is distinct from old.reference_number
     or new.date is distinct from old.date
     or new.amount is distinct from old.amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'incoming_payments native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists incoming_payments_native_mirror_guard_trg on public.incoming_payments;
create trigger incoming_payments_native_mirror_guard_trg
  before update on public.incoming_payments for each row execute function public.incoming_payments_native_mirror_guard();