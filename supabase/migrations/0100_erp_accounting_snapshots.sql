-- 0100_erp_accounting_snapshots.sql — ERPNext P2, Slice 7, task 7.1 (ADR-0048 ledger-sourced).
-- The read-only accounting read-model: two machine-written LEDGER-MIRROR tables (the mirrored-rows
-- basis FR-ENA-150/162 require — fed by the slice-8 sweep from ERPNext `GL Entry` / `Payment Ledger
-- Entry` truth) + three SNAPSHOT tables (actuals + AP/AR aging, spec §4.4) that the refreshers in
-- tasks 7.3/7.4 REPLACE per scope in one service-role tx. All five are org-scoped, machine-written
-- (service-role write + org-member SELECT — these are ERP-ledger truth, NEVER PMO-authored,
-- ADR-0048), carry the `org_id` default + `stamp_org_id()` trigger (0074 pattern), and each has a
-- reversal block. No flippable domain, no doctype-registry entry, no user write path.
--
-- pgTAP: supabase/tests/erp_accounting_snapshots_rls.test.sql (AC-ENA-060/061).
--
-- Reversibility (ADR-0006): `supabase db reset`. Manual rollback (triggers + tables, reverse order):
--   drop trigger if exists erp_ar_aging_snapshot_stamp_org_id  on public.erp_ar_aging_snapshot;
--   drop trigger if exists erp_ap_aging_snapshot_stamp_org_id  on public.erp_ap_aging_snapshot;
--   drop trigger if exists erp_actuals_snapshot_stamp_org_id  on public.erp_actuals_snapshot;
--   drop trigger if exists erp_payment_ledger_mirror_stamp_org_id on public.erp_payment_ledger_mirror;
--   drop trigger if exists erp_gl_entry_mirror_stamp_org_id   on public.erp_gl_entry_mirror;
--   drop table if exists public.erp_ar_aging_snapshot;
--   drop table if exists public.erp_ap_aging_snapshot;
--   drop table if exists public.erp_actuals_snapshot;
--   drop table if exists public.erp_payment_ledger_mirror;
--   drop table if exists public.erp_gl_entry_mirror;

-- ============================================================================
-- §1 — erp_gl_entry_mirror: mirrored GL Entry truth (ADR-0048); the actuals-sum (7.3) + the aging
-- fallback (7.4) basis. `unique (org_id, erp_name)` makes the slice-8 feed an idempotent upsert
-- (a re-fed row is a no-op, never a duplicate); `erp_modified` is the per-row source-mod cursor so
-- the feed guard (`erp_modified >=`) drops a stale older re-feed (FR-CUA-049 pattern).
-- ============================================================================
create table public.erp_gl_entry_mirror (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  erp_name      text not null,                    -- GL Entry `name`
  account       text not null,
  cost_center   text,
  fiscal_year   text,
  project       text,
  party_type    text,
  party         text,
  voucher_type  text,
  voucher_no    text,
  posting_date  date,
  debit         numeric(14,2),
  credit        numeric(14,2),
  is_cancelled  boolean not null default false,
  erp_docstatus smallint,
  erp_modified  text not null,                    -- per-row source-mod cursor (feed guard)
  as_of         timestamptz not null default now(),
  unique (org_id, erp_name)
);
create index erp_gl_entry_mirror_org_idx on public.erp_gl_entry_mirror (org_id);

-- ============================================================================
-- §2 — erp_payment_ledger_mirror: mirrored Payment Ledger Entry truth (the aging fallback's second
-- source, FR-ENA-162). Same idempotent-upsert-by-name + per-row source-mod guard invariants.
-- ============================================================================
create table public.erp_payment_ledger_mirror (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                          references public.organizations(id) on delete cascade,
  erp_name              text not null,            -- Payment Ledger Entry `name`
  account               text not null,
  party_type            text,
  party                 text,
  against_voucher_type  text,
  against_voucher_no    text,
  amount                numeric(14,2),
  posting_date          date,
  due_date              date,
  erp_docstatus         smallint,
  erp_modified          text not null,
  as_of                 timestamptz not null default now(),
  unique (org_id, erp_name)
);
create index erp_payment_ledger_mirror_org_idx on public.erp_payment_ledger_mirror (org_id);

-- ============================================================================
-- §3 — erp_actuals_snapshot (FR-ENA-150, spec §4.4). Sourced by SUMMING mirrored `GL Entry` rows
-- (7.3/actualsSnapshot.ts) per (cost_center, account, fiscal_year). `project_id`/`snapshot_id` are
-- the scope keys; a refresh mints a new `snapshot_id` and deletes the prior-scope rows in the SAME
-- service-role tx (snapshot replacement, not append → a read always sees exactly one coherent as_of).
-- ============================================================================
create table public.erp_actuals_snapshot (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  project_id    uuid,                             -- nullable PMO project scope (no FK — read-model, replaced wholesale per refresh)
  cost_center   text,
  account       text,
  fiscal_year   text,
  debit         numeric(14,2),
  credit        numeric(14,2),
  net           numeric(14,2),
  as_of         timestamptz not null default now(),
  source_report text not null default 'GL Entry',
  snapshot_id   uuid not null,
  created_at    timestamptz not null default now()
);
create index erp_actuals_snapshot_org_snapshot_idx on public.erp_actuals_snapshot (org_id, snapshot_id);

-- ============================================================================
-- §4 — erp_ap_aging_snapshot / erp_ar_aging_snapshot (FR-ENA-160/161/162, spec §4.4). Bucket values +
-- `range_labels` mirror the report RPC's `range1..4` VERBATIM (PMO never re-buckets, FR-ENA-161);
-- `report_date`/`ageing_based_on`/`report_version` are the provenance the UI shows. Snapshot-replace
-- per scope, same tx discipline as actuals. `company_id` is a nullable display scope (no FK — read-model).
-- ============================================================================
create table public.erp_ap_aging_snapshot (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                      references public.organizations(id) on delete cascade,
  party             text,
  party_type        text,
  company_id        uuid,                         -- nullable display scope (no FK — read-model, replaced wholesale)
  currency          text,
  total_outstanding numeric(14,2),
  current           numeric(14,2),
  b_0_30            numeric(14,2),
  b_31_60           numeric(14,2),
  b_61_90           numeric(14,2),
  b_90_plus         numeric(14,2),
  range_labels      jsonb,
  report_date       date,
  ageing_based_on   text,
  as_of             timestamptz not null default now(),
  source_report     text,
  report_version    text,
  snapshot_id       uuid not null,
  created_at        timestamptz not null default now()
);
create index erp_ap_aging_snapshot_org_snapshot_idx on public.erp_ap_aging_snapshot (org_id, snapshot_id);

create table public.erp_ar_aging_snapshot (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                      references public.organizations(id) on delete cascade,
  party             text,
  party_type        text,
  company_id        uuid,                         -- nullable display scope (no FK — read-model, replaced wholesale)
  currency          text,
  total_outstanding numeric(14,2),
  current           numeric(14,2),
  b_0_30            numeric(14,2),
  b_31_60           numeric(14,2),
  b_61_90           numeric(14,2),
  b_90_plus         numeric(14,2),
  range_labels      jsonb,
  report_date       date,
  ageing_based_on   text,
  as_of             timestamptz not null default now(),
  source_report     text,
  report_version    text,
  snapshot_id       uuid not null,
  created_at        timestamptz not null default now()
);
create index erp_ar_aging_snapshot_org_snapshot_idx on public.erp_ar_aging_snapshot (org_id, snapshot_id);

-- ============================================================================
-- §5 — RLS: machine-written (service-role write + org-member SELECT), the 0095 idiom. No
-- INSERT/UPDATE/DELETE policy is created for org members — `force row level security` + a SELECT-only
-- policy denies every user-JWT write with 42501 (these are ERP-ledger truth, never user-authored).
-- ============================================================================
alter table public.erp_gl_entry_mirror enable row level security;
alter table public.erp_gl_entry_mirror force  row level security;
create policy erp_gl_entry_mirror_select on public.erp_gl_entry_mirror
  for select using (org_id = public.auth_org_id() and public.is_active_member());
grant select on public.erp_gl_entry_mirror to authenticated, anon;

alter table public.erp_payment_ledger_mirror enable row level security;
alter table public.erp_payment_ledger_mirror force  row level security;
create policy erp_payment_ledger_mirror_select on public.erp_payment_ledger_mirror
  for select using (org_id = public.auth_org_id() and public.is_active_member());
grant select on public.erp_payment_ledger_mirror to authenticated, anon;

alter table public.erp_actuals_snapshot enable row level security;
alter table public.erp_actuals_snapshot force  row level security;
create policy erp_actuals_snapshot_select on public.erp_actuals_snapshot
  for select using (org_id = public.auth_org_id() and public.is_active_member());
grant select on public.erp_actuals_snapshot to authenticated, anon;

alter table public.erp_ap_aging_snapshot enable row level security;
alter table public.erp_ap_aging_snapshot force  row level security;
create policy erp_ap_aging_snapshot_select on public.erp_ap_aging_snapshot
  for select using (org_id = public.auth_org_id() and public.is_active_member());
grant select on public.erp_ap_aging_snapshot to authenticated, anon;

alter table public.erp_ar_aging_snapshot enable row level security;
alter table public.erp_ar_aging_snapshot force  row level security;
create policy erp_ar_aging_snapshot_select on public.erp_ar_aging_snapshot
  for select using (org_id = public.auth_org_id() and public.is_active_member());
grant select on public.erp_ar_aging_snapshot to authenticated, anon;

-- ── stamp_org_id() trigger (0074 pattern) — belt-and-suspenders alongside the coalesce-default
-- column, consistent with every other seed-org-default table. ─────────────────────────────────────
create trigger erp_gl_entry_mirror_stamp_org_id before insert on public.erp_gl_entry_mirror
  for each row execute function public.stamp_org_id();
create trigger erp_payment_ledger_mirror_stamp_org_id before insert on public.erp_payment_ledger_mirror
  for each row execute function public.stamp_org_id();
create trigger erp_actuals_snapshot_stamp_org_id before insert on public.erp_actuals_snapshot
  for each row execute function public.stamp_org_id();
create trigger erp_ap_aging_snapshot_stamp_org_id before insert on public.erp_ap_aging_snapshot
  for each row execute function public.stamp_org_id();
create trigger erp_ar_aging_snapshot_stamp_org_id before insert on public.erp_ar_aging_snapshot
  for each row execute function public.stamp_org_id();
