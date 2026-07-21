-- 0137_budget_push_seam.sql — ERPNext P3c slice 0 (spec §4; ADR-0055 §6 + ADR-0059 Posture B).
--
-- ⚑ POSTURE B — PMO IS SoT. There is deliberately NO RLS FLIP here: no domain_externally_owned('budget'),
-- no per-command RLS split, no *_native_mirror_guard, and NOT ONE existing table/RPC/policy is altered.
-- budget_versions / budget_line_items / activate_budget_version / get_project_budget remain THE authority
-- (OD-BUDGET-1) for every KPI in employing AND non-employing orgs (FR-BUD-006). If a future edit adds a
-- flip here, it has misread the owner's one-authority ruling.
--
-- Three additive tables (the schema slice; no push/gate/key logic lands here):
--   §1 budget_version_erp_mirror   — ADR-0059 §6 side mirror: EXTERNAL-SIDE STATE ONLY (machine-written,
--                                    the 0101 template). Reversible by `drop table` with ZERO PMO data loss.
--   §2 budget_category_account_map — ⚑ THE CRUX (FR-BUD-110..113): org-scoped, ADMIN-only, and a BIJECTION.
--   §3 budget_projections          — the PMO-owned forward view (`pmo_etc`); NEVER pushed (FR-BUD-160).
--
-- ⚑ DEFERRED — NOT in this migration (ruling-gated, spec §3):
--   OQ-BUD-2 — the ADR-0059 §4 deterministic-key STATE STAMP. `budget_versions` has NO `activated_at`, so a
--     roll-back re-activation of an Archived version would derive a key identical to that version's original
--     push ⇒ 23505 ⇒ silently suppressed ⇒ ERP enforces the WRONG version. Adding `budget_versions.activated_at`
--     (+ one `set` in activate_budget_version) modifies the transition's schema+RPC, which ADR-0059 §3.1
--     forbids and §8 says is "its own issue with its own owner ruling". NOT done. The mirror's
--     `activated_at_witness` column below is inert until that ruling: it is a nullable witness slot, written
--     from DB truth by a later slice, not from any logic added here.
--   OQ-BUD-3 — multi-fiscal-year fan-out. `fiscal_year` is a plain column on both new tables (forward-compat
--     for OQ-BUD-3(c)); the fail-closed multi-FY handling is a dispatch concern (later slice), not schema.
--
-- ⚑ NO ERP-NATIVE ANCHOR (budget-write spike 2026-07-16 §7): the ERP `Budget` doctype carries NO stock
--   free-text field surviving `validate` (no remarks/title/note/reference_no). So there is nowhere to stamp a
--   PMO idempotency key on the ERP side; the outbox must derive idempotency from the natural uniqueness grain
--   + a post-create `external_refs` name mapping (a later slice). This is why `budget_version_erp_mirror` has
--   no anchor column — an ERP anchor field would normally live where `erp_budget_name` sits, but none exists.
--
-- pgTAP: supabase/tests/budget_erp_mirror_rls.test.sql / budget_category_account_map_rls.test.sql (AC-BUD-010)
--        / budget_projections_rls.test.sql (AC-BUD-052).
--
-- Reversibility (ADR-0006): `supabase db reset`. Manual rollback (triggers + tables, reverse order):
--   drop trigger if exists budget_projections_stamp_org_id           on public.budget_projections;
--   drop trigger if exists budget_category_account_map_stamp_org_id  on public.budget_category_account_map;
--   drop trigger if exists budget_version_erp_mirror_stamp_org_id    on public.budget_version_erp_mirror;
--   drop table if exists public.budget_projections;
--   drop table if exists public.budget_category_account_map;
--   drop table if exists public.budget_version_erp_mirror;
-- ⇒ PMO's budget module is untouched and fully functional (ADR-0059 §3.7).

-- ============================================================================
-- §1 — budget_version_erp_mirror (ADR-0059 §6). Grain (budget_version_id × fiscal_year); fiscal_year is in
-- the key for forward-compat with OQ-BUD-3(c) multi-FY at zero cost today (one row per version under the
-- deferred single-FY default). `push_state` is BOTH the operator surface AND the sweep's work queue ⇒
-- index (org_id, push_state), so a bounded-per-tick sweep is index-served and one org's backlog cannot
-- starve another's. Machine-written ONLY (the 0101 idiom): force RLS + a SELECT-only policy denies every
-- user-JWT write with 42501 — this is external-side state, never user-authored.
-- ============================================================================
create table public.budget_version_erp_mirror (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                         references public.organizations(id) on delete cascade,
  budget_version_id    uuid not null references public.budget_versions(id) on delete cascade,
  fiscal_year          text not null,
  push_state           text not null default 'pending'
                         check (push_state in ('pending','pushing','pushed','failed','held')),
  push_error           text,                              -- classified, client-safe reason (budget-category-unmapped, …)
  unmapped_categories  text[],                            -- FR-BUD-113: NAME the blocking categories (actionable, not just red)
  activated_at_witness timestamptz,                       -- ADR-0059 §6 witness of the keyed state stamp (OQ-BUD-2, deferred — inert slot)
  erp_budget_name      text,                              -- ERP Budget `name` (display + the UPSERT target); NOT an anchor (spike §7)
  erp_docstatus        smallint,                          -- feed column, day one
  erp_modified         text,                              -- feed column (per-row source-mod cursor), day one
  erp_cancelled_at     timestamptz,                       -- feed column (external cancel → tombstone), day one
  pushed_at            timestamptz,
  created_at           timestamptz not null default now(),
  unique (org_id, budget_version_id, fiscal_year)
);
create index budget_version_erp_mirror_queue_idx on public.budget_version_erp_mirror (org_id, push_state);

-- ============================================================================
-- §2 — budget_category_account_map — ⚑ THE CRUX. `category` is the SHIPPED ENUM (a table, not jsonb, is
-- exactly why: an enum-typed key + DB-enforced uniqueness + RLS + pgTAP integrity — OQ-BUD-4(a)). ⚑ BOTH
-- uniques are load-bearing (FR-BUD-111): (org,category) makes the PUSH well-defined (one category → exactly
-- one account, no fan-out); (org,erp_account) makes the PROJECTION's inverse well-defined — without it,
-- account-grained actuals (erp_actuals_snapshot) could not be attributed back to a category without PMO
-- inventing a split (ADR-0048). The map is a BIJECTION. ADMIN-only writes (FR-BUD-112 — deliberately
-- STRICTER than OD-BUDGET-3: it is a per-org accounting-config change, not a per-budget toggle).
-- ============================================================================
create table public.budget_category_account_map (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  category    public.budget_category not null,
  erp_account text not null,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  unique (org_id, category),
  unique (org_id, erp_account)
);

-- ============================================================================
-- §3 — budget_projections — the PMO-owned forward view. Grain = PMO's (category), NOT ERP's (account): PMO
-- is SoT, so the projection speaks PMO's vocabulary. `pmo_etc` is a PMO-authored estimate-to-complete and is
-- NEVER pushed (FR-BUD-160). OD-BUDGET-3 write gate + the parent-project-org guard, mirroring
-- budget_versions_write (0002) so a projection cannot be grafted onto another org's project.
-- ============================================================================
create table public.budget_projections (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  fiscal_year text not null,
  category    public.budget_category not null,
  pmo_etc     numeric(14,2) not null default 0,
  note        text,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (org_id, project_id, fiscal_year, category)
);
create index budget_projections_scope_idx on public.budget_projections (org_id, project_id, fiscal_year);

-- ============================================================================
-- §4 — RLS. Side mirror: machine-only (the 0101 idiom — force RLS + a SELECT-only policy + NO non-SELECT
-- policy ⇒ every user-JWT write is 42501). Map: ADMIN-only (FR-BUD-112). Projections: OD-BUDGET-3 + the
-- project-org guard. NONE of these is flip-gated.
-- ============================================================================
alter table public.budget_version_erp_mirror enable row level security;
alter table public.budget_version_erp_mirror force  row level security;
create policy budget_version_erp_mirror_select on public.budget_version_erp_mirror
  for select using (org_id = public.auth_org_id() and public.is_active_member());
grant select on public.budget_version_erp_mirror to authenticated, anon;

alter table public.budget_category_account_map enable row level security;
alter table public.budget_category_account_map force  row level security;
create policy budget_category_account_map_select on public.budget_category_account_map
  for select using (org_id = public.auth_org_id() and public.is_active_member());
create policy budget_category_account_map_write on public.budget_category_account_map
  for all
  using      (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() = 'Admin')
  with check (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() = 'Admin');
grant select, insert, update, delete on public.budget_category_account_map to authenticated;
revoke all on public.budget_category_account_map from anon;

alter table public.budget_projections enable row level security;
alter table public.budget_projections force  row level security;
create policy budget_projections_select on public.budget_projections
  for select using (org_id = public.auth_org_id() and public.is_active_member());
create policy budget_projections_write on public.budget_projections
  for all
  using      (org_id = public.auth_org_id() and public.is_active_member()
              and public.auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = public.auth_org_id() and public.is_active_member()
              and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
              and exists (select 1 from public.projects p
                          where p.id = budget_projections.project_id and p.org_id = public.auth_org_id()));
grant select, insert, update, delete on public.budget_projections to authenticated;
revoke all on public.budget_projections from anon;

-- ── stamp_org_id() triggers (0074 pattern) — belt-and-suspenders alongside the coalesce-default column,
-- consistent with every other seed-org-default table (0101). ──────────────────────────────────────────
create trigger budget_version_erp_mirror_stamp_org_id before insert on public.budget_version_erp_mirror
  for each row execute function public.stamp_org_id();
create trigger budget_category_account_map_stamp_org_id before insert on public.budget_category_account_map
  for each row execute function public.stamp_org_id();
create trigger budget_projections_stamp_org_id before insert on public.budget_projections
  for each row execute function public.stamp_org_id();
