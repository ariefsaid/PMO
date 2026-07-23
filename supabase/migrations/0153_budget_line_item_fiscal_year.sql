-- 0153_budget_line_item_fiscal_year.sql — the budget fiscal-year / phasing dimension.
-- Spec: docs/specs/budget-fiscal-year-phasing.spec.md (round 2, "the four-fact fence").
-- Plan: docs/plans/2026-07-23-budget-fiscal-year-phasing.md, Phase B (T6–T12).
-- Closes: OQ-BUD-3 option (c) + FR-BUD-152 (rewire get_budget_projection to PMO's OWN facts).
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚑ THE FOUR-FACT FENCE (spec §1.1) — the root cause this migration exists to fix.
--
-- `budget_version_erp_mirror` records push ATTEMPTS — `pushed` / `failed` / `held` — not successes.
-- The shipped refusal writer (adapter-dispatch/index.ts `recordBudgetGateFailure`) stamps a `failed`
-- row with the START fiscal year on exactly the multi-FY and unmapped-category rejections. So
-- "a mirror row exists for this year" is TRUE for a year PMO explicitly REFUSED to allocate, and
-- 0149's `exists(mirror row)` predicate therefore attributed a refused NULL line to that year.
--
-- EVERY predicate below names WHICH of these four facts it tests:
--   F-A  a push SUCCEEDED for this year          → a mirror row with push_state = 'pushed'
--   F-B  an ATTEMPT exists for this year         → any mirror row. NEVER a money attribution.
--   F-C  PMO's OWN line items name this year     → an Active line with fiscal_year = <year>
--   F-D  the attribution is KNOWN (per category) → the new `attribution_known` output (§3a)
--
-- ⚑ AND the money-honesty invariant of 0149 is carried one level deeper: when F-D is false, every
-- BUDGET-DERIVED figure (variance, utilization) is NULL — never 0, never a confident `-EAC`. `-EAC`
-- ("every cent spent here is unbudgeted") is a strong claim and may only be made for a year that IS
-- on record with a category that genuinely has no line.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Sections (built task-by-task under TDD; each has its own pgTAP file):
--   §1  budget_line_items.fiscal_year                                     — T6, bfy_column_nullable
--   §4  budget_version_erp_mirror push-time span witness columns          — T6, bfy_column_nullable
--   §2  clone_budget_version copies fiscal_year                           — T7
--   §3a get_budget_projection rewired to F-C ∨ F-A + attribution_known    — T8
--   §3b list_budget_fiscal_years — is_active_push == on_record            — T9
--   §3c get_budget_push_status — one row per expected year                — T10
--   §5  RPC security modes (invoker + search_path + authenticated-only)   — T11
--
-- Reversibility (ADR-0006): `supabase db reset` pre-production. Manual reverse, in order:
--   drop function if exists public.get_budget_push_status(uuid);
--   drop function if exists public.list_budget_fiscal_years(uuid);
--   drop function if exists public.get_budget_projection(uuid, text);
--   -- then re-run 0149 verbatim to restore the previous bodies, and 0005's clone_budget_version;
--   alter table public.budget_version_erp_mirror
--     drop column if exists pushed_project_end_date, drop column if exists pushed_project_start_date;
--   alter table public.budget_line_items drop column if exists fiscal_year;
-- Reversible for the pre-issue (all-NULL, single-FY) population without data loss: nothing is
-- backfilled, so dropping the column removes only values this feature itself authored.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — THE DIMENSION (F1, FR-BFY-001).
--
-- NULLABLE, NO DEFAULT, NO CHECK, NO FK, deliberately (spec §3/§4):
--   • the value is an ERPNext `Fiscal Year` NAME — ANOTHER SYSTEM's calendar. A PMO-side enum cannot
--     enumerate it and a FK cannot reference a table that lives in ERPNext, not Postgres. Validation is
--     PUSH-TIME against the live doctype (budgetGate.ts), never schema-time.
--   • no default and no backfill: a fabricated year is a false claim about the world on a money figure
--     (the same deliberate posture as 0139's `activated_at`). Every existing row stays NULL, and NULL
--     has a precise meaning — "un-phased" — with its own attribution rule in §3a.
-- No new index: the projection's sum is per Active version, already bounded by budget_version_id.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.budget_line_items add column if not exists fiscal_year text;

comment on column public.budget_line_items.fiscal_year is
  'ERPNext Fiscal Year NAME this line is phased to; NULL = un-phased (attributed to the project''s '
  'single fiscal year when a push SUCCEEDED for it and the push-time span witness still matches — '
  'F-A, see 0153 §3a; attributed to NO year on a multi-FY project). Validated at PUSH time against the '
  'client''s Fiscal Year doctype (budgetGate.ts), never here. Copied by clone_budget_version (§2).';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — THE PUSH-TIME SPAN WITNESS (FR-BFY-080, review finding 9).
--
-- A NULL line has no year of its own. The only in-database record of "which year the gate resolved for
-- this project" is a push that SUCCEEDED (F-A) — but "this project is single-FY" is a fact about the
-- project's dates AS THEY WERE AT PUSH TIME. Extend `end_date` into a second fiscal year afterwards and
-- that fact is STALE: continuing to attribute the whole un-phased budget to the old year states a
-- number PMO can no longer stand behind (FR-BFY-053/057, AC-BFY-019/032).
--
-- So every mirror outcome stamps the project span exactly as the gate read it, and §3a attributes NULL
-- lines only while the witness still matches the project's CURRENT dates.
--
-- ⚑ `date`, NOT `timestamptz`: `projects.start_date`/`end_date` are `date` (0001), and an implicit
-- timestamptz↔date comparison is a silent-TZ bug on the input to a money-attribution decision.
-- ⚑ NULLABLE with no backfill: a push that pre-dates this issue has NO witness, and one is never
-- invented. Those rows attribute per backward-compat (FR-BFY-070) with the residual risk named in the
-- spec (the population is bench + demo).
-- ⚑ NO NEW POLICY: the mirror is machine-only (0137 §4 — force RLS + exactly one SELECT policy, so
-- every user-JWT write is 42501). Two additive nullable columns inherit that verbatim.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.budget_version_erp_mirror
  add column if not exists pushed_project_start_date date,
  add column if not exists pushed_project_end_date   date;

comment on column public.budget_version_erp_mirror.pushed_project_start_date is
  'FR-BFY-080 push-time span witness: projects.start_date exactly as the budget gate read it for THIS '
  'push attempt (stamped on every outcome, pushed AND failed). NULL = a push that pre-dates this issue '
  '— never invented. get_budget_projection attributes un-phased (NULL fiscal_year) lines only while '
  'this witness still matches the project''s CURRENT dates (FR-BFY-053).';

comment on column public.budget_version_erp_mirror.pushed_project_end_date is
  'FR-BFY-080 push-time span witness: projects.end_date exactly as the budget gate read it for THIS '
  'push attempt. NULL is ambiguous by design between "pre-issue push" and "project has no end date"; '
  'the drift check treats a NULL START witness as the pre-issue case and compares both otherwise.';
