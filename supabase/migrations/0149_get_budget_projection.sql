-- 0149_get_budget_projection.sql — ERPNext P3c slice 6 (spec §5.7, FR-BUD-151/153, AC-BUD-053).
--
-- PMO's FORWARD VIEW, derived ON READ, never stored, NEVER pushed (FR-BUD-160). ⚑ "Projection" here is
-- PMO's own forward-looking derived view — NOT ADR-0055 §6's "projected into the ERP object" (that means
-- PUSHED; see pmo-portal/src/lib/adapterSeam/erpnext/bodies/budget.ts). Nothing this function computes
-- is ever sent to ERP.
--
-- SECURITY INVOKER (the get_project_budget idiom, 0005): it runs under the CALLER'S RLS, so org isolation
-- comes from the underlying tables' SELECT policies — no hand-rolled org filter, no security-definer.
--
-- Grain = PMO's CATEGORY (PMO is SoT, OD-BUDGET-1). Joining ERP account-grained actuals back to a
-- category requires the map's INVERSE — which is exactly why budget_category_account_map is a BIJECTION
-- (FR-BUD-111): without unique(org, erp_account) this join would be ambiguous and PMO would have to
-- INVENT a split (ADR-0048 violation).
--
-- A FULL OUTER join across (pmo budget lines) × (mapped actuals) × (PMO ETC rows): a category with an
-- actual or an ETC but NO budget line at all must still surface — an inner join would silently drop it,
-- hiding spend against a category the team never budgeted (worse than a big negative variance).
--
-- Money arithmetic is SQL `numeric`; the JS twin (pmo-portal/src/lib/budget/budgetProjection.ts) is the
-- unit oracle and MUST agree (AC-BUD-050/051 ↔ AC-BUD-053; supabase/tests/budget_projection_rpc.test.sql).
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚑ THE MONEY-HONESTY INVARIANT (audit round 6 + rendered re-verification, 2026-07-22) — ONE RULE,
-- stated once, enforced per INPUT rather than patched per symptom.
--
--   ⚑ A MONEY FIGURE MAY BE STATED ONLY WHEN ITS INPUTS ARE KNOWN. Otherwise it is NULL —
--     "unobtainable" — and EVERY figure derived from it is NULL too. `0` is a CLAIM about the world,
--     and PMO may only make it when it actually looked.
--
-- This class has now been found three times at three scopes: project (f9b48500 — actuals structurally
-- 0.00), category (93827008 — an unmapped category printed a confident $0) and, below, fiscal-year +
-- never-synced. Each fix was correct and each was scoped to its symptom, which is why a fourth scope
-- kept existing. So the rule is now applied to the three money INPUTS this function has, exhaustively:
--
--   pmo_budget_amount  KNOWN ⇔ the ACTIVE version is ON RECORD as covering p_fiscal_year.
--   actuals_to_date    KNOWN ⇔ the category has a mapped ERP account (C-1)
--                              AND the ERP ledger has been READ for this (project, fiscal_year) (NEW-4).
--   pmo_etc            ALWAYS KNOWN — PMO authors it; an absent row is a real, PMO-owned 0.
--
-- Every derived column (`projected_final_cost`, `projected_variance`, `projected_utilization`) is a
-- pure function of those three, so its knowability is the conjunction of theirs and nothing else. Both
-- directions of all three are pinned in supabase/tests/budget_projection_rpc.test.sql.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Reversibility (ADR-0006): drop function if exists public.get_budget_projection(uuid, text);

-- `create or replace` CANNOT change a function's OUT columns ("cannot change return type of existing
-- function"), and NEW-6 adds one. Dropping first keeps this migration re-runnable against a database
-- that already has the previous shape, instead of failing halfway through the file.
drop function if exists public.get_budget_projection(uuid, text);

create or replace function public.get_budget_projection(p_project_id uuid, p_fiscal_year text)
returns table (
  category              public.budget_category,
  pmo_budget_amount     numeric,
  -- ⚑ C-1 (rendered Discover pass, 2026-07-22) — NULL means "this figure is UNOBTAINABLE", and is a
  -- different statement from 0.00. See the `mapped`/`reading`/`cells` CTEs below.
  actuals_to_date       numeric,
  -- ⚑ NEW-4 — WHEN the ERP ledger was last read for this (project, fiscal_year). NULL = never read,
  -- which is precisely why `actuals_to_date` is NULL on every category of such a year. Non-NULL, it is
  -- the provenance the surface shows ("Actuals as of …") so an operator can judge how current a figure
  -- is instead of trusting an undated one. Stored on every snapshot row since 0101 and, until now,
  -- read by NOTHING.
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
    -- ⚑ HIGH-1 (audit round 10) — WHICH GENERATION OF THE LEDGER READING IS THIS?
    --
    -- `erp_actuals_snapshot` is GENERATIONAL: a sweep pass mints one `snapshot_id`, removes the org's
    -- previous generation and publishes its own. Both money reads below used to carry NO `snapshot_id`
    -- predicate at all — they summed every row for a (project, fiscal_year) regardless of which pass
    -- wrote it. Two overlapping sweeps could therefore make a $40,000 category report $80,000: an EAC
    -- of $115,000 against a $100,000 budget, a −$15,000 overrun that does not exist, 1.15 utilization
    -- — and, because `max(as_of)` takes the NEWEST generation's stamp, all of it dated fresh under the
    -- "Enforced by ERPNext" pill. The actuals card two clicks away showed $40,000, because it filters
    -- generations. Both claimed to be ERP truth.
    --
    -- 0150 makes snapshot-replace ONE statement, so two generations are now unreachable. This CTE is
    -- deliberately kept ANYWAY: a money aggregate must be correct independently of its writer, and the
    -- previous defect hid precisely because the guarantee lived only on the write side while the
    -- comment claiming it (0101) was false. Belt and braces, and it costs one index-backed row.
    --
    -- Org-scoped by RLS like every other read here, so this is "the caller's own org's current
    -- generation". Empty table ⇒ NULL ⇒ the equality below matches nothing, which is exactly the
    -- never-read state the money-honesty invariant already renders as unobtainable.
    select s.snapshot_id
      from public.erp_actuals_snapshot s
     order by s.created_at desc, s.id desc
     limit 1
  ),
  budget_year as (
    -- ⚑ HIGH-1 (audit round 6, found independently by the rendered pass as NEW-6) — IS THE PMO BUDGET
    -- KNOWABLE FOR THIS YEAR AT ALL?
    --
    -- C-3 added a guard here that read `coalesce(p_fiscal_year,'') <> ''`. That is a PRESENCE test, not
    -- a SCOPE: every other input joins `= p_fiscal_year`, the budget joined on nothing. So a project
    -- pushed for FY '2025-2026' that later takes one late GL posting in '2026-2027' — a year
    -- `list_budget_fiscal_years` then OFFERS, because it unions the actuals' years — answered the
    -- CURRENT budget, a full-budget variance and a ~0% utilization about a year that has no budget at
    -- all: three false statements in tabular-nums beside one correct actual.
    --
    -- ⚑ WHY THE MIRROR IS THE AUTHORITY, and why no year is invented. `budget_versions` carries NO
    -- fiscal year (0001) — giving it one is OQ-BUD-3, which the owner DEFERRED (option (a) now, the
    -- phasing dimension as the next issue), so this migration may not mint one. The pre-push authority
    -- (`budgetGate.ts`) derives the year from the client's own ERPNext `Fiscal Year` doctype, which is
    -- fetched live over the API and exists NOWHERE in Postgres — SQL cannot consult it. That leaves
    -- exactly one in-database fact about which year a budget was filed under: the year it was actually
    -- PUSHED for, `budget_version_erp_mirror.fiscal_year`. It is a record of a real act, not a guess.
    --
    -- This predicate is byte-for-byte `list_budget_fiscal_years.is_active_push` (below), deliberately:
    -- the selector's "this is the Active version's year" flag and this function's "the budget is
    -- knowable here" test must be the SAME question, or the surface could offer a year whose budget it
    -- then refuses to state without being able to say why.
    --
    -- Fail-closed, and it costs no legitimate figure: a year with NO budget on record simply states the
    -- facts it does have (the ERP actuals) and says "unavailable" for the rest, which is what the C-1/
    -- C-2 machinery already renders. A year with a budget on record is unaffected.
    select coalesce(p_fiscal_year, '') <> ''
       and exists (
             select 1
               from public.budget_version_erp_mirror em
               join public.budget_versions v on v.id = em.budget_version_id
              where v.project_id = p_project_id and v.status = 'Active'
                and em.fiscal_year = p_fiscal_year
           ) as on_record
  ),
  reading as (
    -- ⚑ NEW-4 (rendered re-verification, 2026-07-22) — HAS ANYONE ACTUALLY LOOKED AT THE LEDGER?
    --
    -- C-1 asked "is there an ACCOUNT to look at?" and stopped there. A project whose GL has never been
    -- synced (never mapped to an ERP project, or simply never swept) has no snapshot row for the
    -- (project, fiscal_year) at all — and the old `coalesce(a.actuals_to_date, 0)` answered $0.00
    -- actuals, a FULL-BUDGET variance and 0% utilization, under a green "Enforced by ERPNext" pill,
    -- while the version grid two inches above showed real PMO-recorded spend.
    --
    -- The snapshot is written ORG-WIDE and wholesale on every refresh (actualsSnapshot.ts: one
    -- snapshot_id, one as_of, prior rows deleted in the SAME STATEMENT since 0150), so the absence of
    -- ANY row for a project-year is exactly "PMO holds no ledger reading about this project-year" —
    -- whatever the cause. That is one epistemic state and it is reported as one. `max(as_of)` doubles
    -- as the provenance the surface renders.
    --
    -- ⚑ HIGH-1 (round 10): scoped to the CURRENT generation, exactly like the sum it certifies. A
    -- provenance stamp taken from a different generation than the money it dates is a false statement
    -- about how current that money is — the worst kind here, because it is the field an operator uses
    -- to decide whether to trust the figure.
    select max(s.as_of) as as_of
      from public.erp_actuals_snapshot s
     where s.project_id = p_project_id and s.fiscal_year = p_fiscal_year
       and s.snapshot_id = (select cs.snapshot_id from current_snapshot cs)
  ),
  pmo_budget as (
    -- PMO SoT (OD-BUDGET-1): Sigma the ACTIVE version's line items per category. Not an ERP read-back.
    --
    -- ⚑ C-3 — THE YEAR GUARD (now a real scope, see `budget_year`). This function's grain is
    -- (project x FISCAL YEAR). Without it the PMO budget was the ONE unscoped input, so a project with
    -- no ERP linkage at all still rendered a complete, plausible, entirely FABRICATED money grid — the
    -- whole budget "budgeted", $0 spent, 0% utilized — and `rows.length = 0` (the surface's honest
    -- empty state) was unreachable by construction. The alarm that matters survives the empty grid
    -- because the push state is read at PROJECT grain (`get_budget_push_status`, below).
    select li.category, sum(li.budgeted_amount) as pmo_budget_amount
      from public.budget_versions v
      join public.budget_line_items li on li.budget_version_id = v.id
     where v.project_id = p_project_id and v.status = 'Active'
       and (select by.on_record from budget_year by)
     group by li.category
  ),
  -- ⚑ C-1 — WHICH categories PMO can even ASK the ledger about. The map is the ONLY route from a PMO
  -- category to ERP GL accounts (it is a bijection, FR-BUD-111), so a category with no map row has no
  -- account to sum: its actuals are not zero, they are UNKNOWN. Merging those two into one `$0` (the
  -- old `coalesce(a.actuals_to_date, 0)`) made a genuine zero, "no GL rows this year", and "no ERP
  -- account mapped at all" byte-identical on the primary money screen — while the SAME screen banners
  -- the third case as unmapped two inches above. Org-scoped by RLS, exactly like every other read here.
  mapped as (
    select m.category from public.budget_category_account_map m
  ),
  actuals as (
    -- ERP GL truth (P2's shipped snapshot), mapped account -> category via the BIJECTION's inverse.
    --
    -- ⚑ HIGH-1 (round 10) — ONE GENERATION. Without the `snapshot_id` predicate this `sum` counted the
    -- same money once per coexisting snapshot generation. See `current_snapshot` above.
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
    -- FULL OUTER: an ETC or an actual on a category the Active version does not budget MUST surface —
    -- never an inner join that silently drops it.
    select coalesce(b.category, a.category, e.category) as category,
           b.pmo_budget_amount,
           -- ⚑ C-1 + NEW-4: 0 is a CLAIM ("the ledger holds nothing for this account"), and PMO may
           -- only make it when it has an account to look at AND has actually looked. Both inputs
           -- present -> a real, computed zero. Either missing -> NULL, i.e. "not knowable from here",
           -- which the surface renders as unavailable rather than as money. The two absences are
           -- DIFFERENT facts and the surface tells them apart via `actuals_as_of`.
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
         c.pmo_budget_amount,
         c.actuals_to_date,
         (select r.as_of from reading r) as actuals_as_of,
         c.pmo_etc,
         -- ⚑ C-2: every figure DERIVED from an unobtainable actual is itself unobtainable. The screen
         -- used to print a confident EAC, a full-budget variance and 0% utilization for a category it
         -- had just told the operator it could not read — stating a figure it knows it cannot know.
         -- `+` already propagates NULL; the two explicit CASEs below would not, so they say it outright.
         (c.actuals_to_date + c.pmo_etc) as projected_final_cost,
         -- the JS oracle yields -EAC when there is no budget line at all; keep the two in step with an
         -- explicit case (a plain subtraction would yield NULL and lose the signal that spend happened
         -- against an unbudgeted category).
         --
         -- ⚑ HIGH-1: that -EAC signal is only honest when the budget IS knowable for this year and this
         -- category simply has no line — "everything spent here is unbudgeted" is a strong claim. When
         -- the budget is not on record for the year at all, PMO does not know whether the spend is
         -- budgeted, so it says nothing rather than asserting a variance about a year it has no budget
         -- for. The two NULL budgets are different facts and must not collapse into one number.
         case when c.actuals_to_date is null then null
              when c.pmo_budget_amount is null and not (select by.on_record from budget_year by) then null
              when c.pmo_budget_amount is null then -(c.actuals_to_date + c.pmo_etc)
              else c.pmo_budget_amount - (c.actuals_to_date + c.pmo_etc) end as projected_variance,
         -- NULLIF => NULL on a zero/absent budget: never a divide-by-zero, never Infinity (AC-BUD-051).
         case when c.actuals_to_date is null then null
              else (c.actuals_to_date + c.pmo_etc) / nullif(c.pmo_budget_amount, 0) end as projected_utilization
    from cells c
   order by c.category;
$$;

revoke all on function public.get_budget_projection(uuid, text) from public;
grant execute on function public.get_budget_projection(uuid, text) to authenticated;
revoke execute on function public.get_budget_projection(uuid, text) from anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- H-4 (Luna audit round 3, 2026-07-22) — WHICH fiscal years may be asked for.
--
-- `p_fiscal_year` above is matched by EQUALITY against `erp_actuals_snapshot.fiscal_year` and
-- `budget_version_erp_mirror.fiscal_year`, and both carry the ERPNext **Fiscal Year NAME** — whatever
-- the client declared in their own calendar (round-2 OQ-BUD-3b: `budgetGate.ts` resolves the push's
-- fiscal year from the client's `Fiscal Year` doctype BY NAME). A Jul–Jun client's is '2025-2026'.
--
-- The screen used to synthesize `new Date().getFullYear()`. For any non-calendar client that joins
-- NOTHING: actuals 0.00, variance = the entire budget, utilization ~0, no push banner — every figure
-- on the primary money screen silently wrong, with no way to navigate to the real year. The fix is
-- not a smarter format guess (PMO does not own the client's calendar and must never invent it) but to
-- offer ONLY years that exist in data, for ANY fiscal calendar:
--   • the mirror's own pushed years (every version, not just the Active one — a prior year's push is
--     legitimately inspectable), flagging the ACTIVE version's year as the sensible default;
--   • the ERP GL actuals' years;
--   • the PMO ETC rows' years.
-- No rows at all is an honest empty state ("no fiscal year on record"), never a fabricated year.
--
-- SECURITY INVOKER, exactly as above: RLS on the three source tables is the org boundary.
--
-- Reversibility (ADR-0006): drop function if exists public.list_budget_fiscal_years(uuid);
create or replace function public.list_budget_fiscal_years(p_project_id uuid)
returns table (fiscal_year text, is_active_push boolean)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  -- ⚑ HIGH-1: `is_active_push` is the SAME predicate as `get_budget_projection`'s `budget_year`
  -- CTE — "the ACTIVE version is on record as covering this year". It is therefore also the surface's
  -- answer to "why is the Budget column unavailable on this year?", which is why the two must stay one
  -- question: the selector may offer a year whose budget is unknowable (a late GL posting is worth
  -- looking at), but it must be able to SAY so rather than leave a bare dash.
  with active_push as (
    select em.fiscal_year
      from public.budget_version_erp_mirror em
      join public.budget_versions v on v.id = em.budget_version_id
     where v.project_id = p_project_id and v.status = 'Active'
  ),
  observed as (
    select em.fiscal_year
      from public.budget_version_erp_mirror em
      join public.budget_versions v on v.id = em.budget_version_id
     where v.project_id = p_project_id
    union
    select s.fiscal_year from public.erp_actuals_snapshot s where s.project_id = p_project_id
    union
    select bp.fiscal_year from public.budget_projections bp where bp.project_id = p_project_id
  )
  select o.fiscal_year,
         exists (select 1 from active_push ap where ap.fiscal_year = o.fiscal_year) as is_active_push
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
-- C-5 / C-3 (rendered Discover pass, 2026-07-22) — get_budget_push_status: the push state, at the
-- grain it has always actually had.
--
-- ⚑ WHY IT MOVED. `push_state` used to ride on every category cell of `get_budget_projection`, and the
-- surface read it off `rows[0]` — its own comment already conceded the truth ("one banner per project,
-- not per category"). Two defects fell out of that mismatch:
--
--   • C-3 — the alarm was HOSTAGE TO THE GRID. Once the projection is honestly year-scoped (above), a
--     project with no fiscal year on record returns zero rows — and with the state riding on the rows,
--     "ERPNext is enforcing nothing" would have gone silent for exactly the projects most likely to be
--     in that state. The two findings therefore have ONE fix, not two.
--   • C-5 — three of the five push states (`pending`, `pushing`, `pushed`) rendered NOTHING, making
--     them indistinguishable from each other AND from "this org has no ERP at all", while
--     `erp_budget_name` — the ERP document the push actually created — was stored and never read by
--     anything. The cell grain had no room for it. *A state that renders nothing is a defect, not a
--     default: silence is indistinguishable from absence* (DESIGN.md, recorded from this pass).
--
-- Also fixes a subtler scoping error inherited from the cell version: the old `push` CTE matched
-- `em.fiscal_year = p_fiscal_year`, so a REAL failed push vanished the instant the user picked another
-- year in the selector — the alarm's visibility made contingent on an unrelated navigation choice. It
-- is now reported once, project-wide, and RETURNS the year it covers so it can name it instead.
--
-- Exactly one row, always (a `select` over `active_version`-less scalars still yields one row of
-- NULLs). `push_state is null` is the honest "nothing to report": no Active version, no ERP tier, or a
-- push that has not begun. RLS on `budget_versions` / `budget_version_erp_mirror` / `projects` is the
-- org boundary, so a cross-org read yields all NULLs and leaks no ERP document name.
--
-- Reversibility (ADR-0006): drop function if exists public.get_budget_push_status(uuid);
create or replace function public.get_budget_push_status(p_project_id uuid)
returns table (
  push_state          text,
  push_error          text,
  unmapped_categories text[],
  -- C-5: the ERP `Budget` document the push created. Stored since 0137, read by nothing until now — so
  -- a successful push could not even be shown to have produced anything.
  erp_budget_name     text,
  -- The fiscal year this status is ABOUT, so the banner names it rather than being suppressed on every
  -- other year.
  fiscal_year         text,
  pushed_at           timestamptz,
  -- ⚑ MEDIUM-1 (money-safety audit round 7) — IS THERE ACTUALLY A HOLD TO RELEASE?
  --
  -- `budget_version_erp_mirror.push_state = 'held'` has TWO producers, and only one of them leaves a
  -- releasable command behind:
  --   (a) the dispatch's real `command-held` outcome — the `external_command_outbox` row genuinely IS
  --       `held`, it wedges `external_command_outbox_one_inflight_per_record`, and releasing it is the
  --       operator's only route out;
  --   (b) the SWEEP parking a row it may not re-drive (`budget-push-attempts-exhausted` /
  --       `budget-push-no-outbox-candidate`, `erpnext-sweep/index.ts`) — here the outbox row is
  --       `failed`/`pending`/absent, so there is nothing in a `held` state at all.
  -- The mirror alone cannot tell them apart, so the banner offered "Release the hold" in BOTH, and in
  -- (b) the click could only ever fail ("There is no held ERP command to release for this project.") —
  -- on the screen that is telling the operator ERPNext is enforcing the wrong budget, or none. A button
  -- whose only outcome is an error is worse than no button: it costs the reader their remaining trust in
  -- the screen. So the surface asks the OUTBOX, which is the only thing that knows.
  --
  -- Read under `security invoker`, so `external_command_outbox_select` (`org_id = auth_org_id() and
  -- is_active_member()`) is the org boundary exactly as it is for the repository's own lookup — another
  -- org's held row is not visible here and would be refused by the RPC regardless.
  hold_releasable     boolean
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
  recorded as (
    select em.push_state, em.push_error, em.unmapped_categories, em.erp_budget_name, em.fiscal_year, em.pushed_at
      from public.budget_version_erp_mirror em
      join active_version av on av.id = em.budget_version_id
     -- Under the deferred single-FY default there is exactly one row; ordering makes the choice
     -- DETERMINISTIC rather than incidental should OQ-BUD-3(c) ever fan it out, and prefers the most
     -- recently settled year.
     order by em.pushed_at desc nulls last, em.fiscal_year desc
     limit 1
  ),
  -- ⚑ HIGH-C (Luna re-audit round 2, 2026-07-21) — "no row" is a STATE, not an absence of news.
  -- EVERY writer of `budget_version_erp_mirror` lives inside the `adapter-dispatch` edge function, so a
  -- dispatch that never REACHES it (dropped connection, tab closed mid-request, platform 502) leaves NO
  -- mirror row at all — and the sweep backstop's work queue IS that mirror, so nothing re-drives it and
  -- nobody is ever notified. `push_state` then came back NULL, which the operator surface renders as a
  -- perfectly clean screen while ERPNext keeps enforcing the previous budget (or none) indefinitely.
  -- Gated on real domain ownership, so a non-employing org — which has no ERP to push to — never sees a
  -- push banner at all. A RECORDED push state always wins (this is only consulted when `recorded` is
  -- empty).
  --
  -- ⚑ H-3 (Luna audit round 3, 2026-07-22) — the alarm does not require an activation STAMP.
  -- `0139` added `budget_versions.activated_at` nullable with NO backfill, so every version already
  -- Active at migration time carries NULL. Requiring the stamp made that entire population INVISIBLE.
  -- The stamp is not what makes an Active version real; it is what makes it PUSHABLE — so an unstamped
  -- Active version gets its OWN state, because its route out is different: `budgetPushKey` AND the
  -- server-side budget gate both refuse it (deliberately — a money command keyed on an invented
  -- timestamp is worse than one that never runs), so Retry cannot help and is not offered. Activating a
  -- fresh version records a REAL activation act, which is both truthful and pushable.
  unrecorded as (
    select case when (select av.activated_at from active_version av) is null
                then 'unstamped-activation'
                else 'never-pushed' end as state
     where exists (select 1 from active_version)
       and not exists (select 1 from recorded)
       and exists (
             select 1 from public.projects p
              where p.id = p_project_id
                and public.domain_owned_by_tier(p.org_id, 'budget', 'erpnext'))
  ),
  -- MEDIUM-1: a genuinely `held` outbox command for THIS project's Active version. `pmo_record_id` is
  -- `text` (0096), so the version id is cast rather than the column — the index stays usable.
  releasable as (
    select 1
      from public.external_command_outbox o
      join active_version av on o.pmo_record_id = av.id::text
     where o.domain = 'budget' and o.state = 'held'
     limit 1
  )
  select coalesce((select r.push_state from recorded r), (select u.state from unrecorded u)),
         (select r.push_error          from recorded r),
         -- Only ever from a RECORDED push row (NEW-6). The `unrecorded` inference is derived from the
         -- ABSENCE of a mirror row, so by construction it has no names to offer — NULL is the truth.
         (select r.unmapped_categories from recorded r),
         (select r.erp_budget_name     from recorded r),
         (select r.fiscal_year         from recorded r),
         (select r.pushed_at           from recorded r),
         exists (select 1 from releasable);
$$;

revoke all on function public.get_budget_push_status(uuid) from public;
grant execute on function public.get_budget_push_status(uuid) to authenticated;
revoke execute on function public.get_budget_push_status(uuid) from anon;
