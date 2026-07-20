-- 0118_p3b_timesheet_erp_storage.sql (ERPNext P3b, Slice 0 — STORAGE ONLY)
--
-- Two NEW machine-written tables for the first ADR-0059 POSTURE-B domain (timesheets):
--   §1 timesheet_erp_mirror — the 1:1 ERP-side state for a PMO-OWNED timesheet (spec §4.1)
--   §2 erp_employees        — the adopted ERP Employee master + its PMO-user link (spec §4.2, OQ-TSP-3)
--
-- ⚑ ADR-0059 POSTURE B (the P3b inversion): unlike P2/P3a, PMO is the SoT for timesheet ENTRY AND
--    APPROVAL (owner ruling: push Approved-only). So there is NO per-command RLS flip here: `timesheets`
--    and `timesheet_entries` stay user-writable and are NOT TOUCHED BY THIS MIGRATION AT ALL. A flip
--    would 42501 the shipped weekly grid on a flipped org. These SIDE tables hold only ERP-side state,
--    are machine-written (dispatch/sweep service role; the adopt feed), and are reversed by a single
--    `drop table` with ZERO PMO data loss (NFR-TSP-REV-001 — a property Posture A does not have).
--
-- ⛔ DO NOT add `alter table public.timesheets` / `public.timesheet_entries` / `public.profiles` here.
--    FR-TSP-004(ii) + ADR-0059 §3.1 + spec §13.
--
-- All four erp_* feed columns ship DAY ONE on both tables (the 0103 lesson: `companies` shipped without
-- erp_modified/erp_docstatus and broke the first live webhook with 42703).
--
-- ⚑ DEFERRED (OQ-TSP-10 — needs an owner ruling): the Employee→PMO-user resolution — the propose/confirm
--    LINK STATE MACHINE and its matching key. This migration builds the adopt TABLE + the link columns +
--    the link_state column (+ CHECK + partial-unique) the ADR pins, but builds NEITHER the adopt probe
--    that PROPOSES a link NOR the Admin confirm RPC that flips it to 'confirmed'. link_state simply
--    defaults to 'unlinked' until that logic lands in a later slice.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual reverse block:
--   drop table if exists public.timesheet_erp_mirror;   -- cascades its policies; no PMO data is lost
--   drop table if exists public.erp_employees;

-- ============================================================================================
-- §1 — timesheet_erp_mirror (the ERP-side state for a PMO-owned record, spec §4.1)
-- ============================================================================================
create table if not exists public.timesheet_erp_mirror (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default '00000000-0000-0000-0000-000000000001',
  timesheet_id  uuid not null unique references public.timesheets(id) on delete cascade,
  ts_number     text,                        -- ERP `name` (display only; the mapping lives in external_refs, 0088)
  push_state    text not null default 'pending'
    check (push_state in ('pending','pushing','pushed','failed','held')),
  push_error    text,                        -- last classified failure (client-safe), for the operator surface
  pushed_at     timestamptz,
  approved_at_pushed timestamptz,            -- the timesheets.approved_at this push was keyed on (FR-TSP-041)
  erp_total_hours          numeric(9,2),     -- ERP server-computed total_hours — mirrored VERBATIM (ADR-0048)
  erp_total_costing_amount numeric(14,2),    -- ERP server-computed total_costing_amount — mirrored VERBATIM
  erp_docstatus    smallint,
  erp_modified     text,
  erp_amended_from text,
  erp_cancelled_at timestamptz,
  created_at    timestamptz not null default now()
);

-- The sweep's hot path (NFR-TSP-PERF-001): find approved-but-unpushed without scanning history.
create index if not exists timesheet_erp_mirror_org_state_idx
  on public.timesheet_erp_mirror (org_id, push_state);

create trigger timesheet_erp_mirror_stamp_org_id
  before insert on public.timesheet_erp_mirror for each row execute function public.stamp_org_id();

alter table public.timesheet_erp_mirror enable  row level security;
-- FORCE RLS: the table owner (postgres) must ALSO be RLS-subject — the global AC-LOW-1 invariant.
alter table public.timesheet_erp_mirror force   row level security;

-- SELECT ONLY, and only for the audience that may already read the parent sheet (FR-TSP-171 — the ERP
-- state of a sheet is never more visible than the sheet). The exists() mirrors timesheets_select (0007
-- A2): own row OR privileged role OR the owner's line manager. NO INSERT/UPDATE/DELETE policy exists for
-- `authenticated` ⇒ default-deny; the service role bypasses RLS. No *_native_mirror_guard trigger is
-- needed: there is no legitimate user UPDATE to column-pin (stricter AND simpler than P3a's flip).
grant select on public.timesheet_erp_mirror to authenticated;
create policy timesheet_erp_mirror_select on public.timesheet_erp_mirror for select
  using (org_id = auth_org_id() and exists (
    select 1 from public.timesheets t
     where t.id = timesheet_erp_mirror.timesheet_id
       and t.org_id = auth_org_id()
       and (t.user_id = auth.uid()
            or auth_role() in ('Admin','Executive','Project Manager','Finance')
            or exists (select 1 from public.profiles p
                        where p.id = t.user_id and p.manager_id = auth.uid()))));

-- ============================================================================================
-- §2 — erp_employees (the adopted ERP Employee master + its PMO-user link, spec §4.2, OQ-TSP-3)
-- ============================================================================================
create table if not exists public.erp_employees (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default '00000000-0000-0000-0000-000000000001',
  employee_number text,                      -- ERP `name` (HR-EMP-#####; display — mapping in external_refs)
  employee_name text,                        -- ERP `employee_name` (display)
  work_email    text,                        -- the OQ-TSP-10(C) match candidate — never authoritative alone
  erp_user_id   text,                        -- ERP `user_id` (the Frappe User link), if populated
  erp_status    text,                        -- ERP `status` (Active/Left/…) — mirrored + surfaced; NOT a push gate
  -- ── the LINK (OQ-TSP-10 — the propose/confirm TRANSITION LOGIC is DEFERRED; only the storage lands here)
  profile_id    uuid references public.profiles(id),   -- the PMO user; written ONLY by the (deferred) link RPC
  link_state    text not null default 'unlinked'
    check (link_state in ('unlinked','proposed','confirmed','rejected')),  -- only 'confirmed' authorizes a push
  link_proposed_reason text,                 -- e.g. 'work-email-exact-match' (auditability)
  linked_by     uuid references public.profiles(id),   -- the confirming Admin (server-resolved, never a payload)
  linked_at     timestamptz,
  -- ── day-one feed columns (the 0103 / party-adopt lesson)
  erp_docstatus    smallint,
  erp_modified     text,                      -- the per-row source-mod cursor (staleness guard)
  erp_amended_from text,
  erp_cancelled_at timestamptz,
  created_at    timestamptz not null default now()
);

-- One PMO user has at most one CONFIRMED Employee (OQ-TSP-10(ii) drafted) — a PARTIAL unique index.
create unique index if not exists erp_employees_confirmed_profile_uq
  on public.erp_employees (org_id, profile_id) where link_state = 'confirmed';
-- The operator queue (link_state) + the match probe (lower(work_email)).
create index if not exists erp_employees_org_link_idx  on public.erp_employees (org_id, link_state);
create index if not exists erp_employees_org_email_idx on public.erp_employees (org_id, lower(work_email));

create trigger erp_employees_stamp_org_id
  before insert on public.erp_employees for each row execute function public.stamp_org_id();

alter table public.erp_employees enable row level security;
alter table public.erp_employees force  row level security;

-- This table carries employee names + work emails (PII) ⇒ deliberately NOT org-wide readable (unlike
-- companies). SELECT = a privileged role OR the user's OWN link. NO INSERT/UPDATE/DELETE policy for
-- `authenticated` ⇒ default-deny; the feed writes as service_role and the link is an Admin-only RPC
-- (deferred, OQ-TSP-10) — never a direct table write.
grant select on public.erp_employees to authenticated;
create policy erp_employees_select on public.erp_employees for select
  using (org_id = auth_org_id()
         and (auth_role() in ('Admin','Executive','Finance','Project Manager')
              or profile_id = auth.uid()));
