-- #1033: account-grained v16 Budget mirror. The legacy mirror and its conflict target remain unchanged.
create table public.budget_version_account_erp_mirror (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001') references public.organizations(id) on delete cascade,
  budget_version_id uuid not null references public.budget_versions(id) on delete cascade,
  fiscal_year text not null,
  erp_account text not null default '',
  budget_intent text not null default 'ensure' check (budget_intent in ('ensure','remove')),
  push_state text not null default 'pending' check (push_state in ('pending','pushing','pushed','failed','held')),
  push_error text,
  unmapped_categories text[],
  activated_at_witness timestamptz,
  erp_budget_name text,
  erp_docstatus smallint,
  erp_modified text,
  erp_cancelled_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  pushed_project_start_date date,
  pushed_project_end_date date,
  unique (org_id,budget_version_id,fiscal_year,erp_account),
  check (erp_account <> '' or push_state in ('failed','held'))
);
create index budget_version_account_erp_mirror_queue_idx
  on public.budget_version_account_erp_mirror (org_id,push_state,created_at,id);
alter table public.budget_version_account_erp_mirror enable row level security;
alter table public.budget_version_account_erp_mirror force row level security;
create policy budget_version_account_erp_mirror_select on public.budget_version_account_erp_mirror for select
  using (org_id=public.auth_org_id() and public.is_active_member());
grant select on public.budget_version_account_erp_mirror to authenticated;
revoke all on public.budget_version_account_erp_mirror from anon;
grant all on public.budget_version_account_erp_mirror to service_role;
create trigger budget_version_account_erp_mirror_stamp_org_id before insert on public.budget_version_account_erp_mirror
  for each row execute function public.stamp_org_id();

create view public.budget_push_mirror_rows with (security_invoker=true) as
  select id,org_id,budget_version_id,fiscal_year,push_state,push_error,unmapped_categories,
         activated_at_witness,erp_budget_name,erp_docstatus,erp_modified,erp_cancelled_at,pushed_at,
         created_at,pushed_project_start_date,pushed_project_end_date,''::text as erp_account,'ensure'::text as budget_intent
    from public.budget_version_erp_mirror
  union all
  select id,org_id,budget_version_id,fiscal_year,push_state,push_error,unmapped_categories,
         activated_at_witness,erp_budget_name,erp_docstatus,erp_modified,erp_cancelled_at,pushed_at,
         created_at,pushed_project_start_date,pushed_project_end_date,erp_account,budget_intent
    from public.budget_version_account_erp_mirror;
grant select on public.budget_push_mirror_rows to authenticated,service_role;
revoke all on public.budget_push_mirror_rows from anon;

create function public.budget_account_identity(p_version uuid,p_fy text,p_account text)
returns text language plpgsql immutable security invoker
set search_path=public,pg_temp as $$
declare t text;
begin
  if p_version is null or p_fy is null or p_fy='' then
    raise exception 'Invalid budget account identity' using errcode='22023';
  end if;
  if p_account is null or btrim(p_account)='' then return null; end if;
  t := public.budget_fiscal_year_token(p_fy);
  return p_version::text || ':a:' || length(t)::text || ':' || t || ':' ||
    encode(convert_to(p_account,'UTF8'),'hex');
end $$;
revoke all on function public.budget_account_identity(uuid,text,text) from public,anon;
grant execute on function public.budget_account_identity(uuid,text,text) to authenticated,service_role;

-- #1033 task 12: report the worst account status without changing the yearly API shape.
create or replace function public.get_budget_push_status(p_project_id uuid)
returns table (
  push_state text,
  push_error text,
  unmapped_categories text[],
  erp_budget_name text,
  fiscal_year text,
  pushed_at timestamptz,
  hold_releasable boolean,
  stale_attribution boolean
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with active_version as (
    select v.id, v.activated_at from public.budget_versions v
     where v.project_id=p_project_id and v.status='Active' limit 1
  ),
  proj as (select p.start_date,p.end_date from public.projects p where p.id=p_project_id),
  mirror_rows as (
    select em.* from public.budget_push_mirror_rows em
    join active_version av on av.id=em.budget_version_id
  ),
  ranked_mirror as (
    select em.*,
      row_number() over (partition by em.fiscal_year order by
        case em.push_state when 'failed' then 4 when 'held' then 4
          when 'pending' then 3 when 'pushing' then 3 when 'pushed' then 1 else 0 end desc,
        case em.push_state when 'failed' then 1 when 'held' then 2 else 3 end,
        em.erp_account,em.id) as rn
    from mirror_rows em
  ),
  mirror as (select * from ranked_mirror where rn=1),
  phased as (
    select distinct li.fiscal_year from public.budget_line_items li
    join active_version av on av.id=li.budget_version_id where li.fiscal_year is not null
  ),
  has_unphased as (
    select exists(select 1 from public.budget_line_items li join active_version av on av.id=li.budget_version_id
      where li.fiscal_year is null) as v
  ),
  owns as (
    select public.org_has_active_erpnext_binding(
      (select p.org_id from public.projects p where p.id=p_project_id)) as v
  ),
  inferred as (
    select case when not (select o.v from owns o) then null
      when (select av.activated_at from active_version av) is null then 'unstamped-activation'
      else 'never-pushed' end as state where exists(select 1 from active_version)
  ),
  expected as (
    select p.fiscal_year from phased p union select m.fiscal_year from mirror_rows m
  ),
  per_year as (
    select e.fiscal_year,coalesce(m.push_state,(select i.state from inferred i)) as push_state,
      case when m.erp_account<>'' and m.push_state in ('failed','held')
        then coalesce(m.push_error,'budget-push-failed') || ': account=' || m.erp_account
        else m.push_error end as push_error,
      m.unmapped_categories,m.erp_budget_name,m.pushed_at,
      coalesce((select hu.v from has_unphased hu) and exists(
        select 1 from mirror_rows successful
         where successful.fiscal_year=e.fiscal_year and successful.budget_intent='ensure'
           and successful.push_state='pushed' and successful.pushed_project_start_date is not null
           and (successful.pushed_project_start_date is distinct from (select pr.start_date from proj pr)
             or successful.pushed_project_end_date is distinct from (select pr.end_date from proj pr))
      ),false) as stale_attribution
    from expected e left join mirror m on m.fiscal_year=e.fiscal_year
  )
  select py.push_state,py.push_error,py.unmapped_categories,py.erp_budget_name,py.fiscal_year,py.pushed_at,
    exists(select 1 from public.external_command_outbox o cross join active_version av
      where o.domain='budget' and o.state='held' and (
        exists(select 1 from mirror_rows held
          where held.fiscal_year=py.fiscal_year and held.push_state='held' and held.erp_account<>''
            and o.pmo_record_id=public.budget_account_identity(av.id,py.fiscal_year,held.erp_account))
        or o.pmo_record_id=av.id::text || ':' || public.budget_fiscal_year_token(py.fiscal_year)
        or (o.pmo_record_id=av.id::text and exists(select 1 from mirror_rows m2 where m2.fiscal_year=py.fiscal_year))
      )
    ) as hold_releasable,
    py.stale_attribution
  from per_year py
  union all
  select (select i.state from inferred i),null,null,null,null,null,
    exists(select 1 from public.external_command_outbox o cross join active_version av
      where o.domain='budget' and o.state='held' and o.pmo_record_id=av.id::text),false
  where not exists(select 1 from expected)
  order by 5 nulls last;
$$;
revoke all on function public.get_budget_push_status(uuid) from public;
grant execute on function public.get_budget_push_status(uuid) to authenticated;
revoke execute on function public.get_budget_push_status(uuid) from anon;

-- #1033 task 13: preserve current projection/list semantics over the account+legacy union.
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
  with ledger as (
    select * from public.project_mapped_actuals(p_project_id,p_fiscal_year)
    where p_fiscal_year is not null
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
             from public.budget_push_mirror_rows em
             join public.budget_versions v on v.id = em.budget_version_id
            where v.project_id = p_project_id and v.status = 'Active'
              and em.fiscal_year = p_fiscal_year
              and em.push_state = 'pushed'                                           -- F-A
              and em.budget_intent = 'ensure'
              and em.erp_docstatus is distinct from 2
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
      from public.budget_push_mirror_rows em
      join public.budget_versions vv on vv.id = em.budget_version_id
      join public.projects proj on proj.id = vv.project_id
     where vv.project_id = p_project_id and vv.status = 'Active'
       and em.fiscal_year = p_fiscal_year
       and em.push_state = 'pushed'                                                  -- F-A (NOT F-B)
       and em.budget_intent = 'ensure'
       and em.erp_docstatus is distinct from 2
       and ( em.pushed_project_start_date is null                                    -- pre-issue push
             or ( em.pushed_project_start_date is not distinct from proj.start_date
                  and em.pushed_project_end_date is not distinct from proj.end_date ) )
  ),
  reading as (select max(actuals_as_of) as as_of from ledger),
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
  mapped as (select category from ledger where mapped),
  actuals as (select category,source_sum as actuals_to_date from ledger where has_rows),
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
revoke all on function public.get_budget_projection(uuid,text) from public;
grant execute on function public.get_budget_projection(uuid,text) to authenticated;
revoke execute on function public.get_budget_projection(uuid,text) from anon;

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
          from public.budget_push_mirror_rows em
          join public.budget_versions v on v.id = em.budget_version_id
         where v.project_id = p_project_id and v.status = 'Active'
           and em.push_state = 'pushed'
      ) o
  ),
  observed as (
    select em.fiscal_year                                                            -- F-B (offer only)
      from public.budget_push_mirror_rows em
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

-- #1033 task 30: only a fenced current v16 account command may hand off an unchanged ERP Budget ref.
create or replace function public.record_outbox_ref(
  p_id uuid, p_generation int,
  p_domain text, p_pmo_record_id text, p_external_tier text, p_external_record_id text
) returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v public.external_command_outbox;
  dest public.budget_version_account_erp_mirror;
  src public.budget_version_account_erp_mirror;
  dest_version public.budget_versions;
  src_version public.budget_versions;
  src_project uuid;
  dest_project uuid;
  existing_ref public.external_refs;
begin
  select * into v from public.external_command_outbox where id=p_id for update;
  if v.id is null or v.claim_generation is distinct from p_generation or v.state <> 'committed' then
    return 0;
  end if;

  if v.domain='budget' and v.pmo_record_id ~* '^[0-9a-f-]{36}:a:' then
    -- Caller identity is deliberately ignored. The destination is derived from the locked command.
    select * into dest from public.budget_version_account_erp_mirror m
     where m.org_id=v.org_id
       and public.budget_account_identity(m.budget_version_id,m.fiscal_year,m.erp_account)=v.pmo_record_id
     for update;
    if dest.id is null then return 0; end if;
    select * into dest_version from public.budget_versions bv where bv.id=dest.budget_version_id and bv.org_id=v.org_id for update;
    if dest_version.id is null or dest_version.status <> 'Active'
       or dest.activated_at_witness is distinct from dest_version.activated_at
       or dest.erp_budget_name is distinct from p_external_record_id
       or p_external_tier is distinct from v.external_tier then
      return 0;
    end if;

    select * into existing_ref from public.external_refs r
     where r.org_id=v.org_id and r.domain='budget' and r.external_tier=v.external_tier
       and r.external_record_id=p_external_record_id
     for update;
    if existing_ref.org_id is not null and existing_ref.pmo_record_id <> v.pmo_record_id then
      select m.* into src
        from public.budget_version_account_erp_mirror m
        join public.budget_versions bv on bv.id=m.budget_version_id
       where m.org_id=v.org_id and m.erp_budget_name=p_external_record_id
         and m.push_state='pushed' and m.erp_docstatus=1
         and public.budget_account_identity(m.budget_version_id,m.fiscal_year,m.erp_account)=existing_ref.pmo_record_id
       for update of m;
      if src.id is null or src.erp_account is distinct from dest.erp_account
         or src.fiscal_year is distinct from dest.fiscal_year then return 0; end if;
      select * into src_version from public.budget_versions where id=src.budget_version_id for update;
      if src_version.id is null or src_version.status='Active'
         or src.activated_at_witness is distinct from src_version.activated_at then return 0; end if;
      src_project := src_version.project_id;
      dest_project := dest_version.project_id;
      if src_project is distinct from dest_project then return 0; end if;
      if dest.id is null then return 0; end if;
      update public.external_refs
         set pmo_record_id=v.pmo_record_id, external_tier=v.external_tier
       where org_id=v.org_id and domain='budget'
         and pmo_record_id=existing_ref.pmo_record_id and external_record_id=p_external_record_id;
      if not found then return 0; end if;
      return 1;
    elsif existing_ref.org_id is not null then
      if existing_ref.pmo_record_id=v.pmo_record_id then return 1; end if;
      return 0;
    end if;

    insert into public.external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id)
      values(v.org_id,'budget',v.pmo_record_id,v.external_tier,p_external_record_id)
      on conflict(org_id,domain,pmo_record_id) do nothing;
    if exists(select 1 from public.external_refs r where r.org_id=v.org_id and r.domain='budget'
      and r.pmo_record_id=v.pmo_record_id and r.external_tier=v.external_tier
      and r.external_record_id=p_external_record_id) then return 1; end if;
    return 0;
  end if;

  if v.domain = 'companies' and v.operation = 'create' and v.payload ->> 'erp_doc_kind' = 'contact' then
    insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
      values (v.org_id, v.domain, v.pmo_record_id, p_external_tier, p_external_record_id)
      on conflict (org_id, domain, pmo_record_id) do nothing;
    if not exists (select 1 from public.external_refs r where r.org_id=v.org_id and r.domain=v.domain
      and r.pmo_record_id=v.pmo_record_id and r.external_tier=p_external_tier
      and r.external_record_id=p_external_record_id) then
      raise exception 'Contact mapping identity conflict' using errcode='23505';
    end if;
    return 1;
  end if;
  insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
    values (v.org_id,v.domain,v.pmo_record_id,p_external_tier,p_external_record_id)
    on conflict (org_id,domain,pmo_record_id)
      do update set external_record_id=excluded.external_record_id,external_tier=excluded.external_tier;
  return 1;
end; $$;
revoke all on function public.record_outbox_ref(uuid,integer,text,text,text,text) from public;
grant execute on function public.record_outbox_ref(uuid,integer,text,text,text,text) to service_role;

-- #1033 task 15: a staged, fail-closed rollback for an unused account mirror.
create function public.bv16_migration_0293_revert() returns void
language plpgsql security invoker set search_path=public,pg_temp as $revert$
begin
  perform pg_advisory_xact_lock(hashtext('pmo_budget_identity_rekey'));
  if exists(select 1 from public.budget_version_account_erp_mirror)
     or exists(select 1 from public.external_command_outbox where domain='budget' and pmo_record_id ~* '^[0-9a-f-]{36}:a:')
     or exists(select 1 from public.external_refs where domain='budget' and pmo_record_id ~* '^[0-9a-f-]{36}:a:') then
    raise exception 'v16 account data prevents rollback';
  end if;
  execute $restore$
create or replace function public.get_budget_push_status(p_project_id uuid)
returns table (
  push_state          text,
  push_error          text,
  unmapped_categories text[],
  erp_budget_name     text,
  fiscal_year         text,
  pushed_at           timestamptz,
  hold_releasable     boolean,
  -- FR-BFY-056 (0153): a push that SUCCEEDED but whose recorded span no longer matches the project's
  -- current dates, on a version that still has un-phased lines — reported so the surface can name it.
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
  -- ⚑ AC-BUD-003 / FR-BUD-006(a) / FR-BUD-010 (mig 0160, superseding 0153's gate) — employment is the
  -- ACTIVE ERPNext binding, NOT a `domain_externally_owned('budget')` flip (spec forbids that row, twice-
  -- stated). `org_has_active_erpnext_binding` is byte-for-byte the `orgEmploysErpnext` signal; a non-
  -- employing org (no ERP to push to) never sees a push banner. SECURITY INVOKER: RLS on
  -- `external_org_bindings` is the org boundary, exactly as it was for `domain_owned_by_tier`.
  owns as (
    select public.org_has_active_erpnext_binding(
             (select p.org_id from public.projects p where p.id = p_project_id)) as v
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
         -- MEDIUM-1, per year: only a genuinely `held` OUTBOX row leaves something to release. Two
         -- identities accepted: the year-qualified id, and — only on a year that HAS a mirror row — the
         -- legacy bare `<vid>` written by the pre-fan-out single-FY dispatcher.
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
  -- inference (`never-pushed` / `unstamped-activation`) where it applies and NULLs otherwise.
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
  $restore$;
  execute $restore$
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
  with ledger as (
    select * from public.project_mapped_actuals(p_project_id,p_fiscal_year)
    where p_fiscal_year is not null
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
  reading as (select max(actuals_as_of) as as_of from ledger),
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
  mapped as (select category from ledger where mapped),
  actuals as (select category,source_sum as actuals_to_date from ledger where has_rows),
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
  $restore$;
  execute $restore$
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
  $restore$;
  execute $restore$
create or replace function public.record_outbox_ref(
  p_id uuid, p_generation int,
  p_domain text, p_pmo_record_id text, p_external_tier text, p_external_record_id text
) returns int
  language plpgsql security definer set search_path = public as $$
  declare v public.external_command_outbox;
  begin
    select * into v from public.external_command_outbox where id = p_id for update;
    if v.id is null or v.claim_generation is distinct from p_generation or v.state <> 'committed' then
      return 0;
    end if;
    if v.domain = 'companies' and v.operation = 'create' and v.payload ->> 'erp_doc_kind' = 'contact' then
      insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
        values (v.org_id, v.domain, v.pmo_record_id, p_external_tier, p_external_record_id)
        on conflict (org_id, domain, pmo_record_id) do nothing;
      if not exists (
        select 1 from public.external_refs r
        where r.org_id = v.org_id and r.domain = v.domain and r.pmo_record_id = v.pmo_record_id
          and r.external_tier = p_external_tier and r.external_record_id = p_external_record_id
      ) then
        raise exception 'Contact mapping identity conflict' using errcode = '23505';
      end if;
      return 1;
    end if;
    insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
      values (v.org_id, v.domain, v.pmo_record_id, p_external_tier, p_external_record_id)
      on conflict (org_id, domain, pmo_record_id)
        do update set external_record_id = excluded.external_record_id, external_tier = excluded.external_tier;
    return 1;
  end; $$;
  $restore$;
  revoke all on function public.get_budget_push_status(uuid) from public;
  grant execute on function public.get_budget_push_status(uuid) to authenticated;
  revoke execute on function public.get_budget_push_status(uuid) from anon;
  revoke all on function public.get_budget_projection(uuid,text) from public;
  grant execute on function public.get_budget_projection(uuid,text) to authenticated;
  revoke execute on function public.get_budget_projection(uuid,text) from anon;
  revoke all on function public.list_budget_fiscal_years(uuid) from public;
  grant execute on function public.list_budget_fiscal_years(uuid) to authenticated;
  revoke execute on function public.list_budget_fiscal_years(uuid) from anon;
  revoke all on function public.record_outbox_ref(uuid,integer,text,text,text,text) from public;
  grant execute on function public.record_outbox_ref(uuid,integer,text,text,text,text) to service_role;
  drop view public.budget_push_mirror_rows;
  drop function public.budget_account_identity(uuid,text,text);
  drop table public.budget_version_account_erp_mirror;
end;
$revert$;
revoke all on function public.bv16_migration_0293_revert() from public,anon,authenticated,service_role;
