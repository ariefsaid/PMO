begin;
do $$ begin
  if exists(select 1 from public.sales_invoices where erp_project is not null) then
    raise exception 'export ERP project provenance before removing 0290; rollback refused' using errcode = 'P0001';
  end if;
end $$;
drop function public.get_project_finances(uuid);
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
    -- (`fetchActiveBudgetCategoryPhasing`): "budgeted in FY2027" is a KNOWN fact and must never render as
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

drop function public.project_mapped_actuals(uuid,text);
drop function public.assign_sales_invoice_project(uuid,uuid);
drop function public.fill_sales_invoice_project(uuid,uuid,uuid,text);
drop trigger sales_invoices_project_org_guard on public.sales_invoices;
drop function public.sales_invoice_project_org_guard();
drop index public.sales_invoices_null_erp_project_scan_idx;
drop index public.erp_actuals_snapshot_project_read_idx;
drop index public.erp_actuals_snapshot_latest_read_idx;
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
     or new.author_user_id is distinct from old.author_user_id   -- Luna BLOCK 3: pin the SoD-author column
     or new.currency is distinct from old.currency               -- 0187 (#478): re-denominates the row
     or new.tax_treatment is distinct from old.tax_treatment     -- 0188 (#478): the irrecoverable marker
     or new.tax_amount is distinct from old.tax_amount           -- 0188 (#478)
     or new.tax_rate is distinct from old.tax_rate               -- 0188 (#478)
     or new.tax_template is distinct from old.tax_template       -- 0188 (#478)
     or new.work_order_id is distinct from old.work_order_id     -- 0193 (#498): which scope grant this bills
     or new.pmo_native is distinct from old.pmo_native           -- 0275 (#784)
     or new.pmo_number is distinct from old.pmo_number           -- 0275 (#784)
     or new.native_lines is distinct from old.native_lines       -- 0275 (#784)
     or new.approved_by_id is distinct from old.approved_by_id   -- 0275 (#784)
     or new.approved_at is distinct from old.approved_at         -- 0275 (#784)
     or new.overpaid_amount is distinct from old.overpaid_amount -- 0275 (#784, DD-NAR-17)
     or new.erp_opening_amount is distinct from old.erp_opening_amount -- 0275 (#784, DD-NAR-16)
     or new.erp_opening_at is distinct from old.erp_opening_at   -- 0275 (#784, DD-NAR-16)
     or (old.pmo_native and new.received_date is distinct from old.received_date) -- 0275: a PMO invoice is frozen whole
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

alter table public.sales_invoices drop column erp_project;
update public.record_history_config
   set captured = captured - 'project_id',
       omit_cols = array_remove(omit_cols,'erp_project')
 where entity_type = 'sales_invoice';
commit;
