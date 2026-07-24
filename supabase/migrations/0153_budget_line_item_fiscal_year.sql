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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — clone_budget_version COPIES fiscal_year (F7, FR-BFY-062/071, AC-BFY-003).
--
-- Phasing is authored on a DRAFT, and the shipped UI's only route to a Draft is cloning the Active
-- version. A clone that drops `fiscal_year` therefore un-phases every revision of a multi-fiscal-year
-- budget silently — and the next activation's gate REFUSES the push (a multi-FY project with NULL
-- lines, FR-BFY-010), so the operator's phasing work is destroyed by the ordinary act of revising it.
--
-- ⚑ RE-CREATED VERBATIM FROM 0005 apart from the ONE added column. Its security-definer authz — org +
-- role + the parent-project org guard (audit HIGH-BV-1) — is load-bearing and is reproduced character
-- for character; dropping any of it would let any authenticated caller clone across orgs. 0005's
-- authorization deliberately does NOT include `is_active_member()`; that is preserved here rather than
-- "improved", because widening or narrowing an authz predicate is not this migration's business.
-- `drop function` first: `create or replace` cannot change a function's signature or ownership cleanly
-- across re-runs, and dropping keeps the file re-runnable.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.clone_budget_version(uuid);

create or replace function public.clone_budget_version(version_id uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_next int; v_new uuid;
begin
  select project_id, org_id into v_project, v_org from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Defense-in-depth (audit HIGH-BV-1): the parent project must also be in the caller's org, so a definer
  -- clone can never read/write across orgs even if a grafted source version slipped past RLS.
  if (select org_id from public.projects where id = v_project) is distinct from auth_org_id()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  select coalesce(max(version),0)+1 into v_next from budget_versions where project_id = v_project;
  insert into budget_versions (org_id, project_id, version, name, status)
    select v_org, v_project, v_next, name || ' (copy)', 'Draft'
    from budget_versions where id = version_id
    returning id into v_new;
  -- ⚑ THE ONE CHANGE: `fiscal_year` rides along. `actual_amount` is still reset to 0 (a clone has spent
  -- nothing yet); a NULL year stays NULL — the clone never INVENTS a year for a line the operator
  -- deliberately left un-phased (ADR-0048).
  insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year)
    select v_org, v_new, category, description, budgeted_amount, 0, fiscal_year
    from budget_line_items where budget_version_id = version_id;
  return v_new;
end; $$;
revoke all on function public.clone_budget_version(uuid) from public;
grant execute on function public.clone_budget_version(uuid) to authenticated;
revoke execute on function public.clone_budget_version(uuid) from anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3a — get_budget_projection REWIRED TO PMO'S OWN FACTS (F6, FR-BUD-152 / FR-BFY-050/052/053/054/055).
--
-- 0149 asked the ERP mirror "which year is this budget filed under?" because `budget_versions` carried
-- no year and OQ-BUD-3 had deferred giving lines one. That deferral is over: a line now names its own
-- fiscal year, so PMO has an in-database answer of its OWN and no longer needs a push to have happened
-- in order to state its own budget (FR-BUD-152).
--
-- Exactly THREE things change. `current_snapshot` / `reading` / `mapped` / `actuals` / `etc` / `cells`
-- and the generation scoping (HIGH-1) are untouched, so `actuals_to_date`, `actuals_as_of`, `pmo_etc`
-- and `projected_final_cost` are bit-for-bit what they were:
--   1. `budget_year.on_record`  →  F-C ∨ F-A   (was: bare mirror existence, F-B — the round-1 defect)
--   2. `pmo_budget`             →  year-SCOPED sum + the new `attribution_known` fact (F-D)
--   3. variance / utilization   →  NULL when F-D is false, BEFORE the existing `-EAC` branch
--
-- Reversibility (ADR-0006): drop function if exists public.get_budget_projection(uuid, text); then
-- re-run 0149's definition.
--
-- `drop` first: `create or replace` cannot change a function's OUT columns and this adds one.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.get_budget_projection(uuid, text);

create or replace function public.get_budget_projection(p_project_id uuid, p_fiscal_year text)
returns table (
  category              public.budget_category,
  pmo_budget_amount     numeric,
  -- ⚑ F-D (FR-BFY-054, review finding 2) — IS THE BUDGET ATTRIBUTION KNOWN FOR THIS CATEGORY-YEAR?
  -- There are TWO ways `pmo_budget_amount` can be NULL on a year that IS on record, and 0149 could not
  -- tell them apart:
  --   • the category HAS lines but PMO cannot place them in this year (their only lines are un-phased
  --     and the push-time span witness has drifted) ⇒ attribution SUPPRESSED ⇒ say nothing; or
  --   • the category genuinely has NO line in a year PMO does hold a budget for ⇒ every cent spent
  --     here is unbudgeted ⇒ `-EAC`, deliberately loud.
  -- Collapsing them printed "$40,000 entirely unbudgeted" when the honest fact was "the attribution is
  -- unknown after the project's dates changed". A confident NEGATIVE variance is the same class of lie
  -- about money as a confident positive one. Returned (not merely used internally) so the SURFACE can
  -- explain itself instead of showing an unexplained dash.
  attribution_known     boolean,
  actuals_to_date       numeric,
  actuals_as_of         timestamptz,
  pmo_etc               numeric,
  projected_final_cost  numeric,
  projected_variance    numeric,
  projected_utilization numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with current_snapshot as (
    -- ⚑ HIGH-1 (audit round 10) — WHICH GENERATION OF THE LEDGER READING IS THIS? Unchanged from 0149:
    -- a money aggregate must be correct independently of its writer, and both money reads below scope
    -- to this one generation. (0150 makes snapshot-replace one statement; this is belt and braces.)
    select s.snapshot_id
      from public.erp_actuals_snapshot s
     order by s.created_at desc, s.id desc
     limit 1
  ),
  budget_year as (
    -- ⚑ THE SCOPE FLAG — "PMO has a budget ON RECORD for p_fiscal_year". F-C ∨ F-A, NEVER F-B.
    --
    -- F-C: PMO's OWN Active line items name this year. This is what closes FR-BUD-152 — a project whose
    --      push was refused, held, never dispatched, or blocked on an unmapped category still HAS a
    --      budget, and PMO does not need ERP's permission to state its own fact.
    -- F-A: a push that actually SUCCEEDED for this year. Retained because an un-phased (pre-this-issue)
    --      budget has no year of its own, and a successful push is the only in-database record of the
    --      year the gate resolved for it (FR-BFY-070 backward compat).
    --
    -- ⚑ WHY `push_state = 'pushed'` AND NOT bare existence. The mirror records ATTEMPTS. The shipped
    -- refusal writer (`recordBudgetGateFailure`) stamps a `failed` row with the START fiscal year on
    -- exactly the multi-FY and unmapped-category rejections — so "a mirror row exists for FY2026" is
    -- TRUE for a year PMO EXPLICITLY REFUSED to allocate. 0149's predicate read that as a budget on
    -- record and swept the refused un-phased lines into it (review finding 1: $140,000 stated against
    -- a year holding $90,000). A `failed`/`held` row means PMO tried and ERP holds NOTHING: the year's
    -- actuals are still stated, its budget is honestly "unavailable", and no false `-EAC` is printed.
    select coalesce(p_fiscal_year, '') <> ''
       and (
         exists (
           select 1
             from public.budget_versions v
             join public.budget_line_items li on li.budget_version_id = v.id
            where v.project_id = p_project_id and v.status = 'Active'
              and li.fiscal_year = p_fiscal_year                                     -- F-C
         )
         or exists (
           select 1
             from public.budget_version_erp_mirror em
             join public.budget_versions v on v.id = em.budget_version_id
            where v.project_id = p_project_id and v.status = 'Active'
              and em.fiscal_year = p_fiscal_year
              and em.push_state = 'pushed'                                           -- F-A
         )
       ) as on_record
  ),
  attributed_null as (
    -- ⚑ MAY AN UN-PHASED LINE BE ATTRIBUTED TO p_fiscal_year? (FR-BFY-053/070, review findings 1 + 9.)
    --
    -- A NULL `fiscal_year` line has no year of its own. The ONLY in-database record of the year the gate
    -- resolved for this project is a push that SUCCEEDED — F-A, never F-B, and never `on_record` (which
    -- F-C can satisfy on a multi-FY project whose un-phased lines the gate explicitly REFUSED).
    --
    -- ⚑ AND THAT RECORD EXPIRES. "This project is single-FY" was a fact about the project's dates AS THE
    -- GATE READ THEM. Extend `end_date` into a second fiscal year afterwards and the un-phased lines'
    -- year is no longer knowable — so attribution stops (it is NOT silently moved, and NOT split: PMO
    -- may not invent an allocation, ADR-0048). A mirror row whose START witness is NULL pre-dates this
    -- issue and cannot be drift-checked, so it attributes per backward compat (FR-BFY-070) with the
    -- residual risk named in the spec; a span is NEVER invented to fill a NULL witness.
    --
    -- `is not distinct from` (not `=`) so a project with a NULL `end_date` compares NULL-to-NULL as
    -- equal rather than collapsing the whole predicate to NULL. Both sides are `date` — no implicit
    -- timestamptz↔date comparison anywhere on this path.
    select 1
      from public.budget_version_erp_mirror em
      join public.budget_versions vv on vv.id = em.budget_version_id
      join public.projects proj on proj.id = vv.project_id
     where vv.project_id = p_project_id and vv.status = 'Active'
       and em.fiscal_year = p_fiscal_year
       and em.push_state = 'pushed'                                                  -- F-A (NOT F-B)
       and ( em.pushed_project_start_date is null                                    -- pre-issue push
             or ( em.pushed_project_start_date is not distinct from proj.start_date
                  and em.pushed_project_end_date is not distinct from proj.end_date ) )
  ),
  reading as (
    -- ⚑ NEW-4 — HAS ANYONE ACTUALLY LOOKED AT THE LEDGER? Unchanged from 0149.
    select max(s.as_of) as as_of
      from public.erp_actuals_snapshot s
     where s.project_id = p_project_id and s.fiscal_year = p_fiscal_year
       and s.snapshot_id = (select cs.snapshot_id from current_snapshot cs)
  ),
  pmo_budget as (
    -- PMO SoT (OD-BUDGET-1): Σ the ACTIVE version's line items per category — now SCOPED TO THE YEAR.
    --
    -- A line counts toward p_fiscal_year iff it NAMES it (F-C) or it is un-phased AND `attributed_null`
    -- holds (F-A + a matching witness). Anything else contributes to no year at all: an un-phased line
    -- on a multi-FY project is exactly the thing the gate refused to allocate, and inventing a year for
    -- it here would re-introduce the refusal-as-attribution defect from the read side.
    --
    -- `attribution_known` (F-D) means "this category's WHOLE budget is placeable in a year PMO can
    -- name". FALSE therefore means "this category HAS a budget, and PMO cannot place all of it in this
    -- year" — a different statement from "no line", and the two must not collapse (see the variance
    -- rule below). A category with NO line at all does not appear in this CTE, so it arrives downstream
    -- as NULL and coalesces to TRUE: nothing was suppressed for it, and `-EAC` is the honest answer.
    --
    -- ⚑ BLOCK 2 (FU-2 round 2) — IT IS A CONJUNCTION, and `bool_or` ALONE WAS THE MONEY DEFECT. Read as
    -- "at least one line is attributed here", a category with an attributed line AND a suppressed one
    -- reported F-D = TRUE while the `filter`ed SUM counted only the attributed line. Single-FY project,
    -- `Labor $100,000 fiscal_year='2026'` + `Labor $50,000` un-phased, push refused: the primary money
    -- screen STATED $100,000 where PMO holds $150,000, with a variance $50,000 too negative, no
    -- unavailability marker, and `stale_attribution` false so the FR-BFY-056 explanation never fired.
    -- The fence was defeated INSIDE one category.
    --
    -- So the fact is (something is attributed here) AND (nothing is SUPPRESSED here):
    --   • `bool_or(…)`  — at least one line lands in this year, else the category makes no claim on it;
    --   • `bool_and(…)` — every line is either PHASED (so it is knowably elsewhere — an ordinary timing
    --     difference, not an unknown) or UN-PHASED AND ATTRIBUTABLE (F-A + a matching span witness).
    --     A line that is neither is un-placeable, and one such line makes the category's TOTAL unknown.
    -- Both operands are two-valued (`coalesce`/`is not null`/`exists`), so no NULL leaks into the fact.
    --
    -- ⚑ THE ALL-PHASED-ELSEWHERE FALSE IS PRESERVED, deliberately (see below): `bool_or` is FALSE there
    -- and the conjunction cannot resurrect it. Its `bool_and` is TRUE, which is the point — the two
    -- FALSEs mean different things, and the surface tells them apart by PMO's own phased years
    -- (`fetchActiveBudgetCategoryYears`): "budgeted in FY2027" is a KNOWN fact and must never render as
    -- "unavailable", while a partly-suppressed category genuinely is unavailable.
    --
    -- ⚑ A category ALL of whose lines are phased to OTHER years also yields FALSE here, deliberately:
    -- PMO would have to assert "this category is budgeted at nothing in this year" to print `-EAC`, and
    -- while that is arguably derivable, the fail-closed direction is the one this invariant demands.
    -- Its actuals and EAC are unaffected — only the budget-derived claims are withheld.
    select li.category,
           -- ⚑ NULL-SAFE, and it is load-bearing. `li.fiscal_year = p_fiscal_year` is NULL — not FALSE —
           -- for an UN-PHASED line, and `NULL or FALSE` is NULL in SQL's three-valued logic. `filter`
           -- treats that NULL as "exclude" so the SUM is right either way, but `bool_or` IGNORES NULL
           -- inputs: a category whose ONLY line is a suppressed un-phased one aggregated to NULL, which
           -- the final `coalesce(…, true)` then read as "nothing was suppressed" — re-opening the exact
           -- `-EAC` hole F-D exists to close. `coalesce(… , false)` makes the predicate two-valued so
           -- the sum and the fact are derived from ONE expression that cannot drift apart.
           sum(li.budgeted_amount) filter (
             where coalesce(li.fiscal_year = p_fiscal_year, false)
                or (li.fiscal_year is null and exists (select 1 from attributed_null))
           ) as pmo_budget_amount,
           bool_or(
             coalesce(li.fiscal_year = p_fiscal_year, false)
             or (li.fiscal_year is null and exists (select 1 from attributed_null))
           )
           and bool_and(
             li.fiscal_year is not null                        -- phased ⇒ knowably in SOME year
             or exists (select 1 from attributed_null)         -- un-phased ⇒ only if attributable here
           ) as attribution_known
      from public.budget_versions v
      join public.budget_line_items li on li.budget_version_id = v.id
     where v.project_id = p_project_id and v.status = 'Active'
       and (select by.on_record from budget_year by)
     group by li.category
  ),
  -- ⚑ C-1 — WHICH categories PMO can even ASK the ledger about. Unchanged from 0149.
  mapped as (
    select m.category from public.budget_category_account_map m
  ),
  actuals as (
    -- ERP GL truth, mapped account → category via the BIJECTION's inverse. Unchanged from 0149.
    select m.category, sum(s.net) as actuals_to_date
      from public.erp_actuals_snapshot s
      join public.budget_category_account_map m
        on m.org_id = s.org_id and m.erp_account = s.account
     where s.project_id = p_project_id and s.fiscal_year = p_fiscal_year
       and s.snapshot_id = (select cs.snapshot_id from current_snapshot cs)
     group by m.category
  ),
  etc as (
    select bp.category, bp.pmo_etc
      from public.budget_projections bp
     where bp.project_id = p_project_id and bp.fiscal_year = p_fiscal_year
  ),
  cells as (
    -- FULL OUTER: a category with an actual or an ETC but NO budget line MUST surface. Unchanged.
    select coalesce(b.category, a.category, e.category) as category,
           b.pmo_budget_amount,
           b.attribution_known,
           -- ⚑ C-1 + NEW-4: `0` is a CLAIM, and PMO may only make it when it has an account to look at
           -- AND has actually looked. Unchanged from 0149.
           case when (select r.as_of from reading r) is null then null
                when exists (select 1 from mapped m where m.category = coalesce(b.category, a.category, e.category))
                then coalesce(a.actuals_to_date, 0)
                else null end            as actuals_to_date,
           coalesce(e.pmo_etc, 0)        as pmo_etc
      from pmo_budget b
      full outer join actuals a on a.category = b.category
      full outer join etc     e on e.category = coalesce(b.category, a.category)
  )
  select c.category,
         -- ⚑ BLOCK 2 — A SUPPRESSED ATTRIBUTION WITHHOLDS THE AMOUNT ITSELF, not only what is derived
         -- from it. The `filter`ed sum of a partly-suppressed category is a PARTIAL total, and a partial
         -- total printed as THE budget is the understatement this block is about ($100,000 shown where
         -- PMO holds $150,000). The pair (amount stated, attribution unknown) is therefore unreachable —
         -- which is what `budgetProjection.ts` has always claimed of this RPC.
         case when coalesce(c.attribution_known, true) = false then null
              else c.pmo_budget_amount end as pmo_budget_amount,
         -- A category with no line on the Active version was never suppressed — nothing to withhold.
         coalesce(c.attribution_known, true) as attribution_known,
         c.actuals_to_date,
         (select r.as_of from reading r) as actuals_as_of,
         c.pmo_etc,
         -- ⚑ C-2: every figure DERIVED from an unobtainable actual is itself unobtainable. Unchanged —
         -- and note the EAC never depends on the budget, so F-D does not touch it.
         (c.actuals_to_date + c.pmo_etc) as projected_final_cost,
         -- ⚑ THE VARIANCE RULE, in strict precedence order. Each branch is one epistemic state:
         --   1. the actual is unobtainable            (C-2)              ⇒ nothing is derivable
         --   2. the budget attribution is SUPPRESSED  (F-D false)        ⇒ say nothing — NOT -EAC
         --   3. the year is not on record at all      (F-C ∨ F-A false)  ⇒ say nothing
         --   4. an on-record year, no line here                          ⇒ -EAC, deliberately loud
         --   5. otherwise                                                ⇒ budget − EAC
         -- Branch 2 is new and MUST precede 4: with it removed, a drifted attribution falls through to
         -- 4 and the screen prints a confident "everything spent here is unbudgeted" about a budget it
         -- has just admitted it cannot place (review finding 2).
         case when c.actuals_to_date is null then null
              when coalesce(c.attribution_known, true) = false then null
              when c.pmo_budget_amount is null and not (select by.on_record from budget_year by) then null
              when c.pmo_budget_amount is null then -(c.actuals_to_date + c.pmo_etc)
              else c.pmo_budget_amount - (c.actuals_to_date + c.pmo_etc) end as projected_variance,
         -- NULLIF ⇒ NULL on a zero/absent budget: never a divide-by-zero, never Infinity (AC-BUD-051).
         -- The same F-D guard: a utilization computed against a suppressed budget is a fiction.
         case when c.actuals_to_date is null then null
              when coalesce(c.attribution_known, true) = false then null
              else (c.actuals_to_date + c.pmo_etc) / nullif(c.pmo_budget_amount, 0) end as projected_utilization
    from cells c
   order by c.category;
$$;

revoke all on function public.get_budget_projection(uuid, text) from public;
grant execute on function public.get_budget_projection(uuid, text) to authenticated;
revoke execute on function public.get_budget_projection(uuid, text) from anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3b — list_budget_fiscal_years: the OFFER unions F-B, the FLAG is F-C ∨ F-A (FR-BFY-051, AC-BFY-015).
--
-- Two different questions, two different facts, and 0149's own comment already demanded that the
-- second be byte-identical to `get_budget_projection.budget_year.on_record`:
--
--   `observed`       — WHICH years may be asked for. Unions every mirror year (**F-B** — a failed push
--                      is legitimately inspectable; refusing to offer the year would hide the GL
--                      actuals that posted against it), the actuals' years, the ETC years, and NOW
--                      every phased line's year (**F-C**, any version — a prior version's year is
--                      inspectable too). F-B is right for an OFFER and never for an attribution.
--   `is_active_push` — the FLAG on the offer: "does the ACTIVE version have a budget ON RECORD for
--                      this year?" = **F-C ∨ F-A**, character-for-character §3a's `on_record`. The
--                      selector may offer a year whose budget is unknowable, but it must be able to
--                      SAY so instead of leaving a bare dash the operator cannot interpret.
--
-- The column keeps its name (a mild misnomer now — it means "has a budget on record", not "was
-- pushed") because renaming it would churn the repository/page for no behavioural gain; the comment
-- carries the meaning. Reversibility (ADR-0006): re-run 0149's definition.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.list_budget_fiscal_years(uuid);

create or replace function public.list_budget_fiscal_years(p_project_id uuid)
returns table (fiscal_year text, is_active_push boolean)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with on_record_fy as (
    -- ⚑ BYTE-FOR-BYTE §3a's `budget_year.on_record`, split into its two facts. Keep these two EXISTS
    -- clauses and §3a's identical: a divergence would let the selector offer a year it then refuses to
    -- explain (or flag one whose budget the grid withholds).
    select o.fiscal_year
      from (
        select li.fiscal_year                                                        -- F-C
          from public.budget_versions v
          join public.budget_line_items li on li.budget_version_id = v.id
         where v.project_id = p_project_id and v.status = 'Active'
           and li.fiscal_year is not null
        union
        select em.fiscal_year                                                        -- F-A
          from public.budget_version_erp_mirror em
          join public.budget_versions v on v.id = em.budget_version_id
         where v.project_id = p_project_id and v.status = 'Active'
           and em.push_state = 'pushed'
      ) o
  ),
  observed as (
    select em.fiscal_year                                                            -- F-B (offer only)
      from public.budget_version_erp_mirror em
      join public.budget_versions v on v.id = em.budget_version_id
     where v.project_id = p_project_id
    union
    select s.fiscal_year from public.erp_actuals_snapshot s where s.project_id = p_project_id
    union
    select bp.fiscal_year from public.budget_projections bp where bp.project_id = p_project_id
    union
    -- NEW (F-C): PMO's own phased years, on ANY version. Without this a phased-but-never-pushed
    -- project could not be navigated to AT ALL — the very projects FR-BUD-152 exists to unblock.
    select li.fiscal_year
      from public.budget_versions v
      join public.budget_line_items li on li.budget_version_id = v.id
     where v.project_id = p_project_id and li.fiscal_year is not null
  )
  select o.fiscal_year,
         exists (select 1 from on_record_fy r where r.fiscal_year = o.fiscal_year) as is_active_push
    from observed o
   -- `erp_actuals_snapshot.fiscal_year` is nullable (0101): a GL row whose fiscal year ERPNext never
   -- stated cannot be selected by an equality match anyway, so offering it would be an option that
   -- returns nothing. The empty string is the "no year selected" sentinel and is never an offer.
   where o.fiscal_year is not null and o.fiscal_year <> ''
   order by o.fiscal_year desc;
$$;

revoke all on function public.list_budget_fiscal_years(uuid) from public;
grant execute on function public.list_budget_fiscal_years(uuid) to authenticated;
revoke execute on function public.list_budget_fiscal_years(uuid) from anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3c — get_budget_push_status: ONE ROW PER EXPECTED YEAR (FR-BFY-056, AC-BFY-025). Review finding 6.
--
-- ⚑ THE FACT: the expected-year set deliberately includes **F-B rows AS STATUS ROWS**. A `failed` or
-- `held` year IS something the operator must see — that is the whole purpose of this function.
-- Attribution is NOT consulted here (that is §3a's job, and the two must not be confused): F-B is the
-- right fact for "what happened", and never for "what is budgeted".
--
-- 0149 took `limit 1` over the mirror ordered by `pushed_at desc`. Once a push fans out per year, that
-- ordering commonly selects the PUSHED row on a partial failure (it is the one with a `pushed_at`), so
-- the screen reports "pushed" while ERPNext enforces nothing for the other year — and if the process
-- died before writing the second year's mirror row, that year vanished entirely. The expected set is
-- therefore derived from PMO's OWN phased lines (F-C) ∪ the mirror's years, LEFT-JOINed to the mirror,
-- so an absent year is an EXPLICIT `never-pushed` row rather than a silent omission.
--
-- ⚑ EXACTLY-ONE-ROW IS PRESERVED FOR THE "NOTHING TO REPORT" STATES. When the expected set is empty
-- (no Active version, a cross-org read, a non-employing org, or an Active version with neither mirror
-- rows nor phased lines) the function still yields exactly one row — carrying 0149's `unrecorded`
-- inference where it applies, and all-NULLs otherwise. That keeps every shipped consumer and assertion
-- working unchanged, and it keeps the alarm audible: a project with nothing on record is precisely the
-- one most likely to have ERPNext enforcing nothing.
--
-- Reversibility (ADR-0006): re-run 0149's definition.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ⚑ THE FISCAL-YEAR TOKEN, SHARED WITH TYPESCRIPT (FR-BFY-031). `hold_releasable` must find the outbox
-- row the dispatcher created, and from this release onward that row is keyed on the YEAR-QUALIFIED
-- identity `<budget_version_id>:<encoded_fy>`. The encoding is defined by
-- `pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts`: each UTF-8 byte becomes two symbols
-- (hi nibble, lo nibble) over the 16-symbol alphabet `0123456789TZ.+-:` — chosen because the shipped
-- served key guard's charset forbids base32/percent-encoding. That is exactly lowercase hex with
-- `abcdef` mapped to `TZ.+-:`, so it is reproducible here in one expression with no new dependency.
--
-- The two implementations are pinned against each other by the documented examples in
-- bfy_push_status_per_year.test.sql ('2026' → '32303236', 'A:B 2026' → '413T422032303236'); if they
-- ever drift, that test fails rather than this function silently reporting "no hold to release" on a
-- wedged money command.
create or replace function public.budget_fiscal_year_token(p_fiscal_year text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select translate(encode(convert_to(p_fiscal_year, 'UTF8'), 'hex'), 'abcdef', 'TZ.+-:');
$$;
comment on function public.budget_fiscal_year_token(text) is
  'FR-BFY-031 canonical fiscal-year token — the SQL twin of fiscalYearEncoding.ts encodeFiscalYear(). '
  'Used to reconstruct the year-qualified outbox identity <budget_version_id>:<token>.';
revoke all on function public.budget_fiscal_year_token(text) from public;
grant execute on function public.budget_fiscal_year_token(text) to authenticated;
revoke execute on function public.budget_fiscal_year_token(text) from anon;

drop function if exists public.get_budget_push_status(uuid);

create or replace function public.get_budget_push_status(p_project_id uuid)
returns table (
  push_state          text,
  push_error          text,
  unmapped_categories text[],
  erp_budget_name     text,
  fiscal_year         text,
  pushed_at           timestamptz,
  hold_releasable     boolean,
  -- ⚑ FR-BFY-056 — WHY did the budget column go blank on this year? `stale_attribution` is §3a's
  -- suppression, named so the surface can say it: this year had a push that SUCCEEDED, the version
  -- still has UN-PHASED lines, and the project's dates have since moved off the span that push
  -- recorded — so those lines now attribute to no year at all. The actionable fix is a PMO action
  -- ("phase these lines"), not a retry, which is exactly why it is reported beside the push state
  -- rather than as a push failure.
  stale_attribution   boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with active_version as (
    select v.id, v.activated_at
      from public.budget_versions v
     where v.project_id = p_project_id and v.status = 'Active'
     limit 1
  ),
  proj as (
    select p.start_date, p.end_date from public.projects p where p.id = p_project_id
  ),
  mirror as (
    select em.fiscal_year, em.push_state, em.push_error, em.unmapped_categories, em.erp_budget_name,
           em.pushed_at, em.pushed_project_start_date, em.pushed_project_end_date
      from public.budget_version_erp_mirror em
      join active_version av on av.id = em.budget_version_id
  ),
  phased as (
    select distinct li.fiscal_year
      from public.budget_line_items li
      join active_version av on av.id = li.budget_version_id
     where li.fiscal_year is not null
  ),
  has_unphased as (
    select exists (
      select 1 from public.budget_line_items li
       join active_version av on av.id = li.budget_version_id
      where li.fiscal_year is null) as v
  ),
  -- ⚑ H-C / H-3 (0149) — the INFERENCE for a year with no mirror row. Gated on real domain ownership,
  -- so a non-employing org — which has no ERP to push to — never sees a push banner at all; and an
  -- Active version with NO activation stamp gets its own state, because its route out is different
  -- (Retry cannot help: both `budgetPushKey` and the server gate refuse an unstamped version).
  owns as (
    select exists (
      select 1 from public.projects p
       where p.id = p_project_id
         and public.domain_owned_by_tier(p.org_id, 'budget', 'erpnext')) as v
  ),
  inferred as (
    select case when not (select o.v from owns o) then null
                when (select av.activated_at from active_version av) is null then 'unstamped-activation'
                else 'never-pushed' end as state
     where exists (select 1 from active_version)
  ),
  expected as (
    select p.fiscal_year from phased p
    union
    select m.fiscal_year from mirror m
  ),
  per_year as (
    select e.fiscal_year,
           coalesce(m.push_state, (select i.state from inferred i)) as push_state,
           m.push_error, m.unmapped_categories, m.erp_budget_name, m.pushed_at,
           -- §3a's drift result, per year: a SUCCESSFUL push whose recorded span no longer matches the
           -- project's CURRENT dates, on a version that still has un-phased lines to be stranded by it.
           -- A NULL witness pre-dates this issue and cannot be drift-checked — never reported as stale.
           coalesce(
             (select hu.v from has_unphased hu)
             and m.push_state = 'pushed'
             and m.pushed_project_start_date is not null
             and ( m.pushed_project_start_date is distinct from (select pr.start_date from proj pr)
                or m.pushed_project_end_date   is distinct from (select pr.end_date   from proj pr) ),
             false) as stale_attribution
      from expected e
      left join mirror m on m.fiscal_year = e.fiscal_year
  )
  select py.push_state, py.push_error, py.unmapped_categories, py.erp_budget_name,
         py.fiscal_year, py.pushed_at,
         -- ⚑ MEDIUM-1, now PER YEAR. Only a genuinely `held` OUTBOX row leaves something to release
         -- (the sweep also parks the MIRROR at `held` with nothing behind it, and a button whose only
         -- outcome is an error costs the reader their remaining trust in the screen). Two identities
         -- are accepted: the year-qualified one this release introduces, and — only on a year that HAS
         -- a mirror row — the LEGACY bare `<vid>`, which by construction was written by the pre-fan-out
         -- single-FY dispatcher and therefore names that one year.
         exists (
           select 1
             from public.external_command_outbox o
             cross join active_version av
            where o.domain = 'budget' and o.state = 'held'
              and ( o.pmo_record_id = av.id::text || ':' || public.budget_fiscal_year_token(py.fiscal_year)
                 or (o.pmo_record_id = av.id::text
                     and exists (select 1 from mirror m2 where m2.fiscal_year = py.fiscal_year)) )
         ) as hold_releasable,
         py.stale_attribution
    from per_year py
  union all
  -- The "nothing to report" row: exactly one, only when no year is expected at all. Carries the
  -- inference (`never-pushed` / `unstamped-activation`) where it applies and NULLs otherwise, which is
  -- byte-identical to what 0149 returned for these states.
  select (select i.state from inferred i), null, null, null, null, null,
         exists (
           select 1 from public.external_command_outbox o
             cross join active_version av
            where o.domain = 'budget' and o.state = 'held' and o.pmo_record_id = av.id::text
         ),
         false
   where not exists (select 1 from expected)
   order by 5 nulls last;
$$;

revoke all on function public.get_budget_push_status(uuid) from public;
grant execute on function public.get_budget_push_status(uuid) to authenticated;
revoke execute on function public.get_budget_push_status(uuid) from anon;
