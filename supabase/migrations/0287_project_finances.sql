-- 0287_project_finances.sql — #1008 project attribution and project-scoped finance readings.
-- Rollback: migrations/rollback/0287_project_finances_down.sql.

alter table public.sales_invoices add column erp_project text;
comment on column public.sales_invoices.erp_project is
  '#1008: source ERP Project name; provenance, not PMO attribution. Omitted feed fields do not clear it.';
create index sales_invoices_null_erp_project_scan_idx
  on public.sales_invoices(org_id,id)
  where project_id is null and not pmo_native and si_number is not null;
create index erp_actuals_snapshot_project_read_idx
  on public.erp_actuals_snapshot(org_id,snapshot_id,project_id,fiscal_year,account);
create index erp_actuals_snapshot_latest_read_idx
  on public.erp_actuals_snapshot(org_id,created_at desc,id desc) include(snapshot_id);

create function public.sales_invoice_project_org_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id
  ) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  return new;
end $$;
alter function public.sales_invoice_project_org_guard() owner to postgres;
revoke all on function public.sales_invoice_project_org_guard() from public,anon,authenticated;
create trigger sales_invoices_project_org_guard
before insert or update of org_id,project_id on public.sales_invoices
for each row execute function public.sales_invoice_project_org_guard();

create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if new.erp_project is distinct from old.erp_project then
    raise exception 'ERP project provenance is read-only' using errcode = '42501';
  end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or (new.project_id is distinct from old.project_id and current_user <> 'postgres')
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

create function public.assign_sales_invoice_project(p_si_id uuid,p_project_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_si public.sales_invoices; v_role public.user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  -- PFIN_ASSIGN_ROLE_CHECK: mutation target; keep this exact marker and predicate.
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_si from public.sales_invoices where id = p_si_id for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if v_si.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_project_id is null or not exists (
    select 1 from public.projects p where p.id = p_project_id and p.org_id = v_si.org_id
  ) then raise exception 'project not found' using errcode = 'P0002'; end if;
  if v_si.pmo_native or v_si.si_number is null or v_si.author_user_id is not null
     or exists (select 1 from public.sales_invoice_authors a where a.sales_invoice_id = p_si_id)
     or not exists (select 1 from public.external_refs r where r.org_id = v_si.org_id
                    and r.domain = 'revenue' and r.pmo_record_id = p_si_id::text
                    and r.external_record_id = v_si.si_number) then
    raise exception 'only an adopted ERP invoice can be attributed here' using errcode = '23514';
  end if;
  if (v_si.work_order_id is not null and not exists (
        select 1 from public.work_orders w where w.id = v_si.work_order_id
          and w.org_id = v_si.org_id and w.project_id = p_project_id))
     or exists (select 1 from public.progress_claims c where c.id = p_si_id
                and (c.org_id is distinct from v_si.org_id or c.project_id is distinct from p_project_id)) then
    raise exception 'project conflicts with the invoice billing context' using errcode = '23514';
  end if;
  if v_si.project_id is not distinct from p_project_id then return; end if;
  update public.sales_invoices set project_id = p_project_id where id = p_si_id;
end $$;
alter function public.assign_sales_invoice_project(uuid,uuid) owner to postgres;
revoke all on function public.assign_sales_invoice_project(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assign_sales_invoice_project(uuid,uuid) to authenticated;

update public.record_history_config
   set captured = captured || '{"project_id":"ref"}'::jsonb,
       omit_cols = array_append(array_remove(omit_cols,'project_id'),'erp_project')
 where entity_type = 'sales_invoice';

create or replace function public.record_change_capture() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_cfg      public.record_history_config%rowtype;
  v_old      jsonb;
  v_new      jsonb;
  v_changes  jsonb := '{}';
  v_col      text;
  v_parent   uuid;
  v_currency text;
  v_actor    uuid;
begin
  select * into v_cfg from public.record_history_config where table_name = tg_table_name;
  if not found then
    raise exception 'record_change_capture: table % is not in record_history_config', tg_table_name
      using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    if old is not distinct from new then return null; end if;
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    for v_col in select jsonb_object_keys(v_cfg.captured) loop
      if current_setting('role', true) is distinct from 'service_role'
         or not ((v_cfg.table_name = 'sales_invoices' and v_col in ('received_date', 'author_user_id', 'project_id'))
                 or (v_cfg.table_name = 'procurement_invoices' and v_col in ('withheld_amount', 'withheld_pph_type'))) then
        if v_old -> v_col is distinct from v_new -> v_col then
          v_changes := v_changes || jsonb_build_object(v_col,
            jsonb_build_object('old', v_old -> v_col, 'new', v_new -> v_col));
        end if;
      end if;
    end loop;
    foreach v_col in array v_cfg.flag_cols loop
      if v_old -> v_col is distinct from v_new -> v_col then
        v_changes := v_changes || jsonb_build_object(v_col, jsonb_build_object('changed', true));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;
  else
    v_new := to_jsonb(new);
  end if;

  if v_cfg.parent_col is not null then
    v_parent := (v_new ->> v_cfg.parent_col)::uuid;
    if v_cfg.parent_via = 'budget_versions' then
      select bv.project_id, bv.currency into v_parent, v_currency
        from public.budget_versions bv where bv.id = v_parent;
    elsif v_cfg.parent_via = 'procurements' then
      select p.project_id into v_parent from public.procurements p where p.id = v_parent;
    end if;
  end if;
  v_currency := coalesce(v_new ->> 'currency', v_currency);

  v_actor := auth.uid();
  if v_actor is null then
    v_actor := nullif(current_setting('app.actor_id', true), '')::uuid;
  end if;

  insert into public.record_changes
    (org_id, entity_type, entity_id, parent_type, parent_id, op, actor_id, changes, currency)
  values
    ((v_new ->> 'org_id')::uuid, v_cfg.entity_type, (v_new ->> 'id')::uuid,
     case when v_parent is not null then v_cfg.parent_type end, v_parent,
     lower(tg_op), v_actor, v_changes, v_currency);
  return null;
end $$;


create function public.fill_sales_invoice_project(
  p_org_id uuid,p_si_id uuid,p_project_id uuid,p_erp_project text
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if p_org_id is null or p_project_id is null or not exists (
    select 1 from public.projects p where p.id = p_project_id and p.org_id = p_org_id
  ) then return false; end if;
  update public.sales_invoices si set project_id = p_project_id
   where si.id = p_si_id and si.org_id = p_org_id and si.project_id is null
     and not si.pmo_native and si.si_number is not null
     and si.erp_project is not distinct from p_erp_project
     and si.author_user_id is null
     and not exists (select 1 from public.sales_invoice_authors a where a.sales_invoice_id = si.id)
     and exists (select 1 from public.external_refs r where r.org_id = si.org_id and r.domain = 'revenue'
                 and r.pmo_record_id = si.id::text and r.external_record_id = si.si_number)
     and (si.work_order_id is null or exists (select 1 from public.work_orders w
          where w.id = si.work_order_id and w.org_id = si.org_id and w.project_id = p_project_id))
     and not exists (select 1 from public.progress_claims c where c.id = si.id
                     and (c.org_id is distinct from si.org_id or c.project_id is distinct from p_project_id));
  get diagnostics v_count = row_count;
  return v_count = 1;
end $$;
alter function public.fill_sales_invoice_project(uuid,uuid,uuid,text) owner to postgres;
revoke all on function public.fill_sales_invoice_project(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fill_sales_invoice_project(uuid,uuid,uuid,text) to service_role;

create function public.project_mapped_actuals(p_project_id uuid,p_fiscal_year text default null)
returns table(category public.budget_category,mapped boolean,has_rows boolean,
              actuals_to_date numeric,actuals_as_of timestamptz,source_sum numeric)
language sql stable security invoker set search_path = public,pg_temp as $$
  with generation as (
    select s.snapshot_id from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id()
    order by s.created_at desc,s.id desc limit 1
  ), reading as (
    select s.* from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id() and s.project_id = p_project_id
      and s.snapshot_id = (select snapshot_id from generation)
      and (p_fiscal_year is null or s.fiscal_year = p_fiscal_year)
      and exists (select 1 from public.projects p where p.id = p_project_id)
  ), mapped_categories as (
    select distinct m.category from public.budget_category_account_map m
    where m.org_id = public.auth_org_id()
  ), actuals as (
    select m.category,count(*) as n,
      case when count(*) filter(where r.net is null or r.net::text in ('NaN','Infinity','-Infinity')) > 0
           then null else sum(r.net) end as amount,
      sum(r.net) as source_sum
    from reading r join public.budget_category_account_map m
      on m.org_id = r.org_id and m.erp_account = r.account
    group by m.category
  )
  select c.category,mc.category is not null,coalesce(a.n,0) > 0,
    case when mc.category is null or (select max(as_of) from reading) is null then null
         when a.n > 0 then a.amount else 0::numeric end,
    (select max(as_of) from reading),a.source_sum
  from unnest(enum_range(null::public.budget_category)) c(category)
  left join mapped_categories mc on mc.category = c.category
  left join actuals a on a.category = c.category
$$;
revoke all on function public.project_mapped_actuals(uuid,text) from public,anon,authenticated;
grant execute on function public.project_mapped_actuals(uuid,text) to authenticated;


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
