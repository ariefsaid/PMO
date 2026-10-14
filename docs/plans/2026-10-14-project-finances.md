# Project finances — executable TDD design and plan (#1008)

Date: 2026-10-14. Spec: `docs/specs/project-finances.spec.md` (**Ready for owner sign-off**).
Lane: money-path, Director-dispatched. **48 tasks**, each 2–5 minutes of focused editing/testing (lock waits and suite runtime are not estimates of editing time). No implementation before owner sign-off. Migration **0287 only**; 0286 remains reserved.

## 1. Decisions and design

The spec's Decisions section resolves OQ-PFIN-001/002/003. Do not reopen them in implementation:

- **Settlement is not cash.** Invoiced = submitted invoice amounts; Settled = amount minus ERP outstanding; Outstanding = ERP outstanding. Per currency, lifetime. NULL outstanding withholds both settlement figures, not the known invoice amount. No receipt table changes, allocation mirror, proportional split or FX.
- **Audience:** `may('view', 'salesInvoice')`, the existing Admin/Finance/Executive/Project Manager predicate. Engineer keeps the existing Overview/delivery summary, not this new section. Server independently checks the same role set and active membership. These roles satisfy the existing `holds_spend_approval_authority` predicate used by Employee-party GL RLS; test that fact, not an assumption about route access.
- **Lifetime means lifetime:** include undated invoices and NULL-fiscal-year actuals, without inventing dates/years. Selected-version budget includes all its lines. Keep the separate Budget Projection year-specific.
- **D1/D2/D3:** no ERP write-back; machine fill NULL only; audited operator reassignment allowed. Assignment is not a money/body-authoring event and creates no outbox command.

### Architecture and data flow

1. ERP `Sales Invoice.project` → `siFromDoc.erp_project` (omitted key remains omitted) → existing claim-first feed adoption. A shared `invertProjectMap` maps **PMO UUID → ERP name** into ERP name → unique PMO UUID. Validate a UUID and a same-org project before using a service-role FK.
2. Feed stores provenance even when resolution fails. Adoption inserts the resolved link or NULL. Subsequent events update source provenance, then call an atomic, service-only NULL-fill RPC; never include `project_id` in a general refresh patch. Existing stale-event, amend, lifecycle and notification routing stays intact.
3. One-shot historical repair reads current external references in UUID-keyset batches, fetches the actual ERP document, checks the binding company, stores missing provenance with a compare-and-set, and uses the same resolver/fill RPC. It never adopts or mints documents. This is an explicit maintenance operation, not a migration network call or an hourly unbounded reread.
4. Finance/Admin selection → shared assignment modal → `useAssignInvoiceProject` → `repositories.revenue.setProject` → `assign_sales_invoice_project`. Row lock, active membership, role, same-org invoice/project and existing billing-context invariants precede a project-only update. Existing `record_changes` captures real actor/old/new project; identical assignment is a no-op.
5. Overview → gated `ProjectFinancesSection` → org/project query → `repositories.revenue.getProjectFinances` → `get_project_finances(uuid)` (**SECURITY INVOKER**) → one-statement invoice/budget/current-generation GL aggregates. No ERP call and no browser-supplied org authority.
6. `project_mapped_actuals(uuid,text)` is the shared invoker aggregate. NULL year means lifetime; an explicit year means that year's rows only. `get_budget_projection` consumes it without changing its public columns, Active/year attribution, unknown-reading or ETC logic.

### Surface and copy (Operate mode; incumbent DESIGN.md is authority)

Replace, not duplicate, `ProjectInvoicingSummary` in `pages/project-detail/tabs/OverviewTab.tsx`. The new section is readable on any readable project; do not hide project accounting merely because a project's lifecycle is not on-hand. Preserve the existing on-hand contract comparison inside it, and preserve the header, procurement, drawdown, delivery-role summary and budget widgets outside it.

Hierarchy: **Project finances** / **Lifetime to date** → contract and its tax basis → per-currency Invoiced / Settled / Outstanding → Billed-work revenue and same-currency margin → budget status/amount → category actuals with reading date/base currency. No new dashboard/chart. Use hairlines, `min-w-0`, `break-words`, `tabular-nums`, `text-muted-foreground`, `border-border`, responsive `grid-cols-1 sm:grid-cols-3`, shared buttons/dialogs. Do not rename committed spend to GL actuals outside this section.

Required copy:

| English | Bahasa Indonesia |
|---|---|
| Project finances | Keuangan proyek |
| Lifetime to date | Sejak awal hingga kini |
| Invoiced | Ditagihkan |
| Settled | Diselesaikan |
| Settled against invoices (cash, withholding and credits), not cash received. | Penyelesaian tagihan (kas, potongan pajak, dan kredit), bukan kas diterima. |
| Outstanding | Belum dibayar |
| Incomplete — ERP outstanding missing | Belum lengkap — saldo belum dibayar dari ERP belum tersedia |
| Billed-work revenue (net of tax, advances excluded) | Pendapatan pekerjaan ditagihkan (neto pajak, tanpa uang muka) |
| Unavailable — different currencies | Tidak tersedia — mata uang berbeda |
| Draft — not active | Draf — belum aktif |
| No budget | Belum ada anggaran |
| Actuals exclude restricted rows | Aktual tidak mencakup baris terbatas |
| GL reading unavailable | Pembacaan buku besar belum tersedia |
| Account mapping unavailable | Pemetaan akun belum tersedia |
| Assign project / Change project | Tetapkan proyek / Ubah proyek |
| PMO attribution only; the ERP invoice is unchanged. | Hanya atribusi PMO; tagihan ERP tidak berubah. |

### Exact money and epistemic states

All new server money arithmetic is PostgreSQL numeric. Every JSON money field is **text or null**, never a JSON number. Use scale-2 BigInt units for client subtraction/formatting. Do not route these totals through `Number`, JS `sumPerCurrency`, or the existing whole-org revenue scan. No receipt header SUM is part of this read.

- Missing invoice amount: Invoiced/Settled unknown, not a successful zero. Missing outstanding: Invoiced remains known, Settled/Outstanding incomplete. Missing work net: revenue/margin unknown independently of outstanding.
- No submitted invoices: show **No submitted invoices** with no invented currency bucket. A known mapped category with a real current reading and no entries can be zero; an unmapped/never-read category cannot.
- Total GL cost means **mapped GL costs**, not every GL leg. All accounts mapped to a category count (push-target designation is irrelevant). Unmapped category rows display unavailable; the mapped subtotal is labelled as such.
- No visible project reading / no map / malformed net: GL total unavailable. Do not infer a successful project zero from another project's reading.
- NULL fiscal-year GL facts participate in lifetime totals. Explicit-year projection still excludes them.
- Base currency comes from `organizations.default_currency` (0187's ERP-company/base seam), not the contract/invoice currency. Missing base currency withholds margin. No conversion.
- Native invoices keep all existing mutations/settlement logic unchanged. New settlement cards follow the Director's literal `amount` formula; the existing normalized **Invoiced against contract / Remaining to invoice** comparison remains separately labelled on the contract's tax basis. Never substitute that normalized comparison for the new Invoiced card.

### Scaling and quality work without behavior change

Server aggregates one project, not the entire org and not a capped client page. Invoice `(org_id,project_id)` and receipt `(org_id,sales_invoice_id)` indexes are reused; add a GL `(org_id,snapshot_id,project_id,fiscal_year,account)` index and a partial NULL-ERP-invoice scan index. Add `(org_id,created_at desc,id desc) INCLUDE(snapshot_id)` for the one-row generation selection, retaining current snapshot ordering `created_at desc,id desc`; otherwise finding the latest reading would sort an org's whole snapshot for each project view. Analyze synthetic query plans before merge; reject a plan with per-invoice correlated reads. Repair caps 100 candidates per request and has an explicit cursor/failure result. No per-render ERP calls. One resolver and one mapping SQL definition prevent drift.

### Architectural authorities / ADR threshold

ADR-0010 (test ownership), ADR-0017 (repository seam), ADR-0048 (ledger oracle), ADR-0055 (money ownership), ADR-0080 (billing context), ADR-0082 (GL project cost) already govern this design. No new ledger, payment schema, dependency, tenancy model or irreversible decision is introduced; no new ADR is required. Director rulings are retained in the spec rather than minting an ADR for routine aggregate/UI implementation.

## 2. Frozen implementation contracts

### Files and API

```ts
// pmo-portal/src/lib/projectFinances.ts
export type ExactMoney = string;
export interface InvoiceFinanceBucket {
  currency: string;
  invoice_count: number;
  invoiced: ExactMoney | null;
  settled: ExactMoney | null;
  outstanding: ExactMoney | null;
  missing_amount: number;
  missing_outstanding: number;
  tax_basis: 'inclusive' | 'exclusive' | 'mixed';
  work_revenue: ExactMoney | null;
  missing_work: number;
}
export interface ProjectFinances {
  project_id: string;
  contract_invoiced: ExactMoney | null;
  remaining_to_invoice: ExactMoney | null;
  invoices: InvoiceFinanceBucket[];
  budget: null | {
    id: string; name: string; version: number;
    status: 'Active' | 'Draft'; currency: string; amount: ExactMoney | null;
  };
  actuals: {
    currency: string | null; as_of: string | null;
    total: ExactMoney | null; excludes_restricted_rows: boolean;
    categories: Array<{
      category: string; mapped: boolean; amount: ExactMoney | null;
    }>;
  };
}
export type Margin =
  | { amount: ExactMoney; reason: null }
  | { amount: null; reason: 'different-currencies' | 'work-unavailable' | 'actuals-unavailable' | 'restricted-rows' };
// Existing RevenueRepository gains ONLY:
setProject(siId: string, projectId: string): Promise<void>;
getProjectFinances(projectId: string): Promise<ProjectFinances>;
// Dedicated mutation variables (old project is cache context, not server authority):
export interface AssignInvoiceProjectInput {
  siId: string; projectId: string; oldProjectId: string | null;
}
```

SQL signatures:

```sql
public.assign_sales_invoice_project(p_si_id uuid, p_project_id uuid) returns void
public.fill_sales_invoice_project(p_org_id uuid, p_si_id uuid, p_project_id uuid, p_erp_project text) returns boolean
public.project_mapped_actuals(p_project_id uuid, p_fiscal_year text default null)
  returns table(category public.budget_category, mapped boolean, has_rows boolean,
                actuals_to_date numeric, actuals_as_of timestamptz, source_sum numeric)
public.get_project_finances(p_project_id uuid) returns jsonb
```

Assignment is to a non-null project; clearing is not requested. UI eligibility is ERP number present, non-native, no recorded body author. Server additionally requires a current ERP revenue external reference; PMO-raised/native rows are not the adopted-invoice correction path. A conflicting work-order or claim project is refused, never silently cleared. Cancelled ERP mirrors can have PMO attribution corrected but do not enter submitted totals.

Query keys:

```ts
['project-finances', orgId, projectId]
['salesInvoices', orgId]                       // prefix includes all filtered lists
['salesInvoice', orgId, siId]
['incomingPayments', orgId]
['incomingPayment', orgId]
['revenueByProject', orgId]
['record-history', orgId, 'sales_invoice', siId]
['record-history', orgId, 'project', oldProjectId]
['record-history', orgId, 'project', projectId]
['project-vat-editability']                    // attribution moves invoice-related eligibility
```

## 3. Executable migration blocks (append in task order to 0287)

These blocks are actual forward SQL. Existing definitions copied below by exact extraction are intentionally retained instead of restating/changing their unrelated logic. Run SQL through local migration reset only; never against a cloud environment during this build.

### SQL A — provenance, same-org service-write invariant, indexes

```sql
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
```

### SQL B — narrow operator command

```sql
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
```

Guard coexistence: append the **entire** `sales_invoices_native_mirror_guard` definition from `0275_native_revenue.sql`, replacing only its project comparison with:

```sql
or (new.project_id is distinct from old.project_id and current_user <> 'postgres')
```

Immediately after its existing service-role early return, before its `domain_externally_owned` early return, insert:

```sql
if new.erp_project is distinct from old.erp_project then
  raise exception 'ERP project provenance is read-only' using errcode = '42501';
end if;
```

This new mirror column is machine-written in both ownership states. The trigger remains INVOKER: a direct authenticated write is not postgres; the checked definer update is. No caller-set GUC is authority. Everything else in that guard remains verbatim, including native fields and SoD stamps. Explicit function ownership is part of the contract. Audit/history uses retained `auth.uid()`, not the definer identity.

### SQL C — atomic service-only NULL fill

```sql
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
```

The `project_id is null` predicate is the concurrency authority. A newer provenance write or an operator correction makes a stale machine fill a no-op. Historical provenance hydration also compares the previously read `erp_modified` and `erp_project IS NULL` before writing; it cannot regress a newer feed event.

### SQL D — existing history registration

```sql
update public.record_history_config
   set captured = captured || '{"project_id":"ref"}'::jsonb,
       omit_cols = array_append(array_remove(omit_cols,'project_id'),'erp_project')
 where entity_type = 'sales_invoice';
```

Append the complete `record_change_capture` definition from `0278_invoice_change_history.sql`, changing only the sales-invoice service-role omission list from `('received_date', 'author_user_id')` to `('received_date', 'author_user_id', 'project_id')`. Keep all other entity/currency/actor logic. A user correction's event has `parent_id = new project` and `changes.project_id.old/new`; the invoice's history remains canonical across moves. Do not duplicate the event in the old project or change global history visibility semantics.

### SQL E — shared mapping/reading aggregate

```sql
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
```

Projection refactor: append the entire `get_budget_projection` definition from 0153 with these exact CTE replacements (its OUT list and final SELECT remain byte-for-byte):

```sql
-- Replace current_snapshot CTE with:
ledger as (
  select * from public.project_mapped_actuals(p_project_id,p_fiscal_year)
  where p_fiscal_year is not null
),
-- Replace reading CTE with:
reading as (select max(actuals_as_of) as as_of from ledger),
-- Replace mapped CTE with:
mapped as (select category from ledger where mapped),
-- Replace actuals CTE with:
actuals as (select category,source_sum as actuals_to_date from ledger where has_rows),
```

Keep `budget_year`, `attributed_null`, `pmo_budget`, `etc`, `cells` and every grant unchanged. NULL year to the existing projection must not accidentally become lifetime. Existing pgTAP projection fixtures are the behavior-preservation oracle. `source_sum` preserves the prior projection's raw numeric SUM semantics; the new section uses the strict `actuals_to_date` epistemic reading. Add a partial-NULL-net fixture proving projection output is unchanged while new finance withholds an incomplete total. No legacy projection expected value is weakened.

### SQL F — one project finance statement

```sql
create function public.get_project_finances(p_project_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public,pg_temp as $$
declare v_result jsonb; v_role public.user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists(select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id()) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  with invoice_rows as (
    select si.* from public.sales_invoices si
    where si.org_id = public.auth_org_id() and si.project_id = p_project_id
      and si.status in ('Submitted','Unpaid','Paid')
      and coalesce(si.erp_docstatus,1) <> 2 and si.erp_cancelled_at is null
  ), inv as (
    select currency,count(*)::int as invoice_count,
      count(*) filter(where amount is null or amount::text in ('NaN','Infinity','-Infinity'))::int as missing_amount,
      count(*) filter(where erp_outstanding_amount is null or erp_outstanding_amount::text in ('NaN','Infinity','-Infinity'))::int as missing_outstanding,
      sum(amount) as invoiced,sum(erp_outstanding_amount) as outstanding,
      sum(amount-erp_outstanding_amount) as settled,
      case when count(distinct tax_treatment) = 1 then min(tax_treatment) else 'mixed' end as tax_basis
    from invoice_rows group by currency
  ), work as (
    select w.currency,
      count(*) filter(where w.net is null or w.net::text in ('NaN','Infinity','-Infinity')
                     or w.recovery is null or w.recovery::text in ('NaN','Infinity','-Infinity'))::int as missing_work,
      sum(w.net+w.recovery) as revenue
    from public.sales_invoice_work_billed w join invoice_rows i on i.id = w.id and i.org_id = w.org_id
    where not w.is_down_payment group by w.currency
  ), chosen_budget as (
    select v.* from public.budget_versions v
    where v.org_id = public.auth_org_id() and v.project_id = p_project_id and v.status in ('Active','Draft')
    order by (v.status = 'Active') desc,v.version desc,v.created_at desc,v.id desc limit 1
  ), budget_sum as (
    select case when count(*) filter(where li.budgeted_amount is null
                    or li.budgeted_amount::text in ('NaN','Infinity','-Infinity')) > 0 then null
                else coalesce(sum(li.budgeted_amount),0) end as amount
    from public.budget_line_items li join chosen_budget b on b.id = li.budget_version_id and b.org_id = li.org_id
  ), gl as (
    select * from public.project_mapped_actuals(p_project_id,null)
  ), contract_rows as (
    select case when i.currency <> p.currency or p.tax_treatment not in ('inclusive','exclusive')
                     or i.tax_treatment not in ('inclusive','exclusive') or i.amount is null or i.tax_amount is null
                     or i.amount::text in ('NaN','Infinity','-Infinity') or i.tax_amount::text in ('NaN','Infinity','-Infinity')
                then null
                when i.tax_treatment = p.tax_treatment then i.amount
                when p.tax_treatment = 'inclusive' then i.amount+i.tax_amount
                else i.amount-i.tax_amount end as amount
    from invoice_rows i cross join public.projects p where p.id = p_project_id
  ), contract_sum as (
    select case when count(*) filter(where amount is null) > 0 then null
                else coalesce(sum(amount),0) end as amount from contract_rows
  )
  select jsonb_build_object(
    'project_id',p.id,
    'contract_invoiced',case when p.contract_value is null or p.tax_treatment not in ('inclusive','exclusive')
                                or p.contract_value < 0 or p.contract_value::text in ('NaN','Infinity','-Infinity')
                           then null else cs.amount::text end,
    'remaining_to_invoice',case when p.contract_value is null or p.tax_treatment not in ('inclusive','exclusive')
                                    or p.contract_value < 0 or p.contract_value::text in ('NaN','Infinity','-Infinity')
                               then null else (p.contract_value-cs.amount)::text end,
    'invoices',coalesce((select jsonb_agg(jsonb_build_object(
      'currency',i.currency,'invoice_count',i.invoice_count,'missing_amount',i.missing_amount,
      'missing_outstanding',i.missing_outstanding,'tax_basis',i.tax_basis,
      'invoiced',case when i.missing_amount = 0 then i.invoiced::text end,
      'outstanding',case when i.missing_outstanding = 0 then i.outstanding::text end,
      'settled',case when i.missing_amount = 0 and i.missing_outstanding = 0 then i.settled::text end,
      'work_revenue',case when coalesce(w.missing_work,0) = 0 then coalesce(w.revenue,0)::text end,
      'missing_work',coalesce(w.missing_work,0)
    ) order by i.currency) from inv i left join work w on w.currency = i.currency),'[]'::jsonb),
    'budget',(select jsonb_build_object('id',b.id,'name',b.name,'version',b.version,'status',b.status,
                                      'currency',b.currency,'amount',bs.amount::text)
              from chosen_budget b cross join budget_sum bs),
    'actuals',jsonb_build_object(
      'currency',o.default_currency,'as_of',(select max(actuals_as_of) from gl),
      'excludes_restricted_rows',not coalesce(public.holds_spend_approval_authority(v_role),false),
      'total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and actuals_to_date is null) > 0 then null
                          else sum(actuals_to_date) filter(where mapped) end::text from gl),
      'categories',(select jsonb_agg(jsonb_build_object('category',category,'mapped',mapped,
                                                       'amount',actuals_to_date::text) order by category) from gl)
    )
  ) into v_result from public.projects p join public.organizations o on o.id = p.org_id
    cross join contract_sum cs where p.id = p_project_id;
  return v_result;
end $$;
revoke all on function public.get_project_finances(uuid) from public,anon,authenticated;
grant execute on function public.get_project_finances(uuid) to authenticated;
```

For consistency, new finance settlement excludes an explicitly cancelled lifecycle even if a fixture's status is inconsistent. Preserve the existing revenue page's read behavior rather than rewriting its whole-org rollup in this issue.

### SQL G — grants/catalog assertions

```sql
do $$
begin
  if has_function_privilege('anon','public.assign_sales_invoice_project(uuid,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.assign_sales_invoice_project(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.fill_sales_invoice_project(uuid,uuid,uuid,text)','EXECUTE')
     or has_function_privilege('anon','public.fill_sales_invoice_project(uuid,uuid,uuid,text)','EXECUTE')
     or not has_function_privilege('service_role','public.fill_sales_invoice_project(uuid,uuid,uuid,text)','EXECUTE')
     or has_function_privilege('anon','public.get_project_finances(uuid)','EXECUTE')
     or has_function_privilege('anon','public.project_mapped_actuals(uuid,text)','EXECUTE') then
    raise exception '0287 grants do not match the project finance contract';
  end if;
  if exists(select 1 from pg_class where oid in ('public.sales_invoices'::regclass,
       'public.erp_actuals_snapshot'::regclass,'public.record_changes'::regclass)
       and (not relrowsecurity or not relforcerowsecurity)) then
    raise exception '0287 requires existing forced RLS';
  end if;
  if exists(select 1 from pg_proc where oid in ('public.get_project_finances(uuid)'::regprocedure,
       'public.project_mapped_actuals(uuid,text)'::regprocedure) and prosecdef) then
    raise exception '0287 read surfaces must be invoker';
  end if;
end $$;
```

No new business table and no RLS policy widening. Existing table/org defaults remain authoritative. New column is not added to authenticated INSERT/UPDATE column grants. Register the two non-trigger definer commands in `scripts/isolation-probe-denominator.json` (its catalog enumerator excludes trigger functions); only `assign_sales_invoice_project` joins the authenticated-client allow-list in `supabase/tests/0178_anon_executable_definers.test.sql`.

### Rollback — preserve operator attribution/history, refuse provenance loss

File: `supabase/migrations/rollback/0287_project_finances_down.sql`.

Execute this exact assembly recipe after Tasks 03–23; the generated file contains complete prior function bodies and correctly ordered SQL, not restoration comments:

```bash
python3 - <<'PY'
from pathlib import Path

def body(path, name):
    text=Path(path).read_text()
    start=text.index('create or replace function public.'+name+'(')
    opening=text.index('$$',start)
    closing=text.index('$$;',opening+2)+3
    return text[start:closing]+'\n'
projection=body('supabase/migrations/0153_budget_line_item_fiscal_year.sql','get_budget_projection')
guard=body('supabase/migrations/0275_native_revenue.sql','sales_invoices_native_mirror_guard')
down='''begin;
do $$ begin
  if exists(select 1 from public.sales_invoices where erp_project is not null) then
    raise exception 'export ERP project provenance before removing 0287; rollback refused';
  end if;
end $$;
drop function public.get_project_finances(uuid);
'''+projection+'''
drop function public.project_mapped_actuals(uuid,text);
drop function public.assign_sales_invoice_project(uuid,uuid);
drop function public.fill_sales_invoice_project(uuid,uuid,uuid,text);
drop trigger sales_invoices_project_org_guard on public.sales_invoices;
drop function public.sales_invoice_project_org_guard();
drop index public.sales_invoices_null_erp_project_scan_idx;
drop index public.erp_actuals_snapshot_project_read_idx;
drop index public.erp_actuals_snapshot_latest_read_idx;
'''+guard+'''
alter table public.sales_invoices drop column erp_project;
update public.record_history_config set omit_cols = array_remove(omit_cols,'erp_project')
where entity_type = 'sales_invoice';
commit;
'''
Path('supabase/migrations/rollback/0287_project_finances_down.sql').write_text(down)
# A transaction-local test runner exercises the ACTUAL rollback body, without committing fixtures.
inner=down.removeprefix('begin;\n').removesuffix('commit;\n')
Path('supabase/tests/0287_project_finances_down_runner.sql').write_text(
  "create function pg_temp.run_pfin_down() returns void language plpgsql as $runner$\n"
  "begin execute $down$"+inner+"$down$; end $runner$;\n")
print('Complete rollback and transaction-local runner written')
PY
```

Assembly order is binding: refusal → finance RPC drop → restore 0153 projection → helper drop → operator/machine RPC and org-trigger drops → index drops → restore 0275 guard → provenance column drop → omit-list update → commit. Down migration includes the actual prior projection and guard bodies, not comment-only restore steps. No assignment/history is deleted. Removing provenance requires an explicit retention/export step and clearing that column only after export, not a silent automated discard. `project_id` already existed before this issue. Rollback testing uses transaction fixtures, no production export.

### Appendix H — project names in the existing history renderer (Task 06)

Exact targeted changes (test first):

- `pmo-portal/src/components/history/historyFields.ts`: add `project_id: 'ref'` to `sales_invoice`; append `'projects'` to `RefSource`; add `project_id: 'projects'` to `REF_SOURCE`. No new entity type.
- `pmo-portal/src/lib/repositories/recordHistory.ts`: append `'project'` to `HistoryNameKind`. Before `return result` in `lookupNames`, add this bounded, RLS-scoped name read (supports loaded older pages without per-event queries):

```ts
const projectIds = [...new Set(ids.project ?? [])].filter(Boolean);
const projectNames = new Map<string,string>();
for (let start=0; start<projectIds.length; start+=200) {
  const {data,error} = await supabase.from('projects').select('id,name')
    .in('id',projectIds.slice(start,start+200));
  if (error) throw toAppError(error);
  for (const row of data ?? []) projectNames.set(row.id,row.name);
}
result.project = projectNames;
```

- `RecordHistory.tsx`, inside its existing `for (const event of events)` collection loop, add:

```ts
const projectChange = event.changes.project_id;
for (const id of [projectChange?.old,projectChange?.new]) {
  if (typeof id === 'string' && id) (ids.project ??= []).push(id);
}
```

- `useHistoryRefs.ts`: add `projects: eventNames.data?.project ?? new Map()` to the returned map. Existing `historyLabels.ts` `project_id` already labels Project through localized `history.field.project_id`. Update the typed map in `src/components/history/__tests__/RecordHistory.test.tsx` with `projects: new Map()` and its new old/new name fixtures. Add a repository test for >200 IDs, project read error, unreadable ID and no `archived_at` filter; returned absent name remains Unavailable, never a UUID.

### Appendix I — exact denominator registration recipe (Task 23)

After migration is complete, this derives genuine source-line citations and appends only the two non-trigger definers and client writer. No bogus `read` class, invented HTTP mapping, stale line number or trigger denominator entry:

```bash
python3 - <<'PY'
import json
from pathlib import Path
p=Path('scripts/isolation-probe-denominator.json')
d=json.loads(p.read_text())
for signature in ['assign_sales_invoice_project(uuid,uuid)','fill_sales_invoice_project(uuid,uuid,uuid,text)']:
    assert signature not in d['definer_functions']
    d['definer_functions'].append(signature)
sql=Path('supabase/migrations/0287_project_finances.sql').read_text().splitlines()
a=next(i for i,line in enumerate(sql) if line.startswith('create function public.assign_sales_invoice_project('))
b=next(i for i in range(a+1,len(sql)) if sql[i].startswith('end $$;'))
sources=['supabase/migrations/0287_project_finances.sql:'+str(i+1)
         for i in range(a,b+1) if "errcode = '42501'" in sql[i] or "errcode = 'P0002'" in sql[i]]
assert sources
assert not any(r['name']=='assign_sales_invoice_project' for r in d['rpcs'])
d['rpcs'].append({'name':'assign_sales_invoice_project','class':'write',
    'expect_denial':[{'http':403,'sqlstate':'42501'},{'http':500,'sqlstate':'P0002'}], 'source':sources})
p.write_text(json.dumps(d,indent=2)+'\n')
PY
scripts/with-db-lock.sh node scripts/check-isolation-denominator.mjs
node scripts/check-isolation-denominator.test.mjs
```

### Appendix J — complete shared form body (Tasks 34–35)

`pmo-portal/src/components/InvoiceProjectModal.tsx`. Import React's `useRef/useState`, `useTranslation`, `SalesInvoiceRow`, `classifyMutationError`, and `EntityFormModal`, `Combobox`, `ConfirmDialog`, `FormGrid`, `useEntityForm`, `SubmitError`, `ComboboxOption` from their existing paths shown in `SalesInvoices.tsx`. Props are the §2/Task 34 contract plus `loadProjects: () => Promise<ComboboxOption[]>` (real loader errors reach the shared picker Retry state).

```tsx
export function InvoiceProjectModal({invoice,projects,loadProjects,currentProjectName,loading,onClose,onSave}: InvoiceProjectModalProps) {
  const {t} = useTranslation();
  const [confirming,setConfirming] = useState(false);
  const [saveError,setSaveError] = useState<SubmitError|null>(null);
  const [saving,setSaving] = useState(false);
  const inFlight = useRef(false);
  const form = useEntityForm({
    initialValues:{projectId:invoice.project_id ?? ''},requiredFields:['projectId'],
    validate: v=>v.projectId ? {} : {projectId:t('invoiceProject.required','Select a project.')},
    idPrefix:'invoice-project',
  });
  const selected = projects.find(p=>p.value===form.values.projectId) ?? null;
  const busy = loading || saving;
  const unchanged = form.values.projectId===invoice.project_id;
  const save = async () => {
    if (inFlight.current || loading || !form.values.projectId || unchanged) return;
    inFlight.current=true; setSaving(true); setSaveError(null);
    try { await onSave(form.values.projectId); onClose(); }
    catch(error) {
      const classified=classifyMutationError(error);
      setSaveError({headline:classified.headline,detail:classified.detail});
      setConfirming(false);
    } finally { inFlight.current=false; setSaving(false); }
  };
  if (confirming) return <ConfirmDialog open loading={busy}
    title={t('invoiceProject.change','Change project')}
    description={t('invoiceProject.fromTo','From {{old}} to {{new}}. PMO attribution only; the ERP invoice is unchanged.',{
      old:currentProjectName ?? t('invoiceProject.current','Current project'),
      new:selected?.label ?? t('projectFinances.unavailable','Unavailable'),
    })}
    confirmLabel={t('invoiceProject.change','Change project')}
    onConfirm={()=>void save()} onCancel={()=>setConfirming(false)}/>;
  return <EntityFormModal open
    title={invoice.project_id ? t('invoiceProject.change','Change project') : t('invoiceProject.assign','Assign project')}
    subtitle={`${invoice.si_number ?? ''} · ${t('invoiceProject.scope','PMO attribution only; the ERP invoice is unchanged.')}`}
    onClose={onClose} loading={busy} dirty={form.isDirty} submitError={saveError}
    submitLabel={t('invoiceProject.save','Save project')} submitDisabled={!form.isComplete || unchanged}
    onSubmit={e=>{e.preventDefault(); if (busy) return; void form.handleSubmit(async()=>{
      if (invoice.project_id) setConfirming(true); else await save();
    });}}
    discardCopy={{title:t('invoiceProject.discardTitle','Discard project selection?'),
      description:t('invoiceProject.discardDetail','The selected project will not be saved.'),
      confirmLabel:t('invoiceProject.discard','Discard'),cancelLabel:t('invoiceProject.keep','Keep editing')}}>
    <FormGrid><Combobox label={t('invoiceProject.project','Project')} required
      id={form.fieldProps('projectId').id} value={form.values.projectId || null}
      selectedOption={selected} loadOptions={loadProjects} disabled={busy}
      error={form.errors.projectId} onChange={value=>form.setValue('projectId',value)}/></FormGrid>
  </EntityFormModal>;
}
```

Page adapter (inside `SalesInvoices.tsx`; keep loader stable with `useCallback`):

```tsx
const projectOptionsQuery = useInvoiceProjectOptions();
const loadAssignmentProjects = useCallback(async()=>{
  const result=await projectOptionsQuery.refetch();
  if (result.error) throw result.error;
  return result.data ?? [];
},[projectOptionsQuery.refetch]);
const assignProject=useAssignInvoiceProject();
const [assignmentTarget,setAssignmentTarget]=useState<SalesInvoiceRow|null>(null);
// Mount in the page's modal area:
{assignmentTarget && <InvoiceProjectModal invoice={assignmentTarget}
  projects={projectOptionsQuery.data ?? []} loadProjects={loadAssignmentProjects}
  currentProjectName={projectOptionsQuery.data?.find(p=>p.value===assignmentTarget.project_id)?.label ?? null}
  loading={assignProject.isPending} onClose={()=>setAssignmentTarget(null)}
  onSave={projectId=>assignProject.mutateAsync({siId:assignmentTarget.id,projectId,oldProjectId:assignmentTarget.project_id})}/>}
```

Replace the existing destructured `useInvoiceProjectOptions` call with `projectOptionsQuery`; retain `const projectOptions=projectOptionsQuery.data` for the existing invoice-create form. Do not call two copies of the hook. Do not apply create-form client/VAT filtering to historical attribution; server same-org/billing context is its authority.

### Appendix K — complete reading/section body (Tasks 38–41)

`pmo-portal/pages/project-detail/ProjectFinancesSection.tsx`, imports:

```tsx
import React from 'react';
import {useTranslation} from 'react-i18next';
import {Button,TaxBasisLabel} from '@/src/components/ui';
import type {ProjectWithRefs} from '@/src/lib/db/projects';
import {useProjectFinances} from '@/src/hooks/useProjectFinances';
import {deriveMargin,formatExactMoney} from '@/src/lib/projectFinances';
import {isTaxTreatment} from '@/src/lib/taxTreatment';
import {ON_HAND_STATUSES} from '@/src/lib/db/projectTransitions';
import {formatInstantDate} from '@/src/lib/format';
import {budgetCategoryLabel} from '@/src/lib/i18n/budgetCategoryLabel';
```

```tsx
export default function ProjectFinancesSection({project}:{project:ProjectWithRefs}) {
  const {t,i18n}=useTranslation();
  const query=useProjectFinances(project.id);
  const unknown=t('projectFinances.unavailable','Unavailable');
  const money=(value:string|null,currency:string|null)=>currency
    ? formatExactMoney(value,currency,i18n.language) ?? unknown : unknown;
  const title=<><h2 className="text-sm font-semibold">{t('projectFinances.title','Project finances')}</h2>
    <p className="text-xs text-muted-foreground">{t('projectFinances.lifetime','Lifetime to date')}</p></>;
  if (query.isPending) return <section data-testid="project-finances" aria-label={t('projectFinances.title','Project finances')}>
    {title}<p role="status">{t('projectFinances.loading','Loading project finances…')}</p></section>;
  if (query.isError || !query.data) return <section data-testid="project-finances" aria-label={t('projectFinances.title','Project finances')}>
    {title}<div role="alert">{t('projectFinances.error',"Couldn't load project finances.")}
      <Button variant="outline" onClick={()=>void query.refetch()}>{t('projectFinances.retry','Retry')}</Button></div></section>;
  const data=query.data;
  const actuals=data.actuals;
  const contract=project.contract_value === null || !isTaxTreatment(project.tax_treatment)
    ? unknown : money(String(project.contract_value),project.currency);
  const onHand=ON_HAND_STATUSES.includes(project.status as string);
  const field=(label:string,value:string,basis?:React.ReactNode)=> <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="break-words text-sm font-semibold tabular-nums">{value}</dd>{basis && <dd>{basis}</dd>}</div>;
  return <section className="min-w-0 space-y-4 border-y border-border py-4" data-testid="project-finances"
    aria-label={t('projectFinances.title','Project finances')}>
    {title}
    <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
      {field(t('projectFinances.contract','Contract value'),contract,isTaxTreatment(project.tax_treatment) &&
        <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} testId="project-contract-basis"/>)}
      {onHand && field(t('projectFinances.contractInvoiced','Invoiced against contract'),money(data.contract_invoiced,project.currency),
        isTaxTreatment(project.tax_treatment) && <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} testId="project-invoiced-basis"/>)}
      {onHand && field(t('projectFinances.remaining','Remaining to invoice'),money(data.remaining_to_invoice,project.currency),
        isTaxTreatment(project.tax_treatment) && <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} testId="project-remaining-basis"/>)}
    </dl>
    {data.invoices.length===0 && <p role="status">{t('projectFinances.noInvoices','No submitted invoices')}</p>}
    {data.invoices.map(bucket=>{
      const margin=deriveMargin(bucket,actuals);
      const incomplete=t('projectFinances.incomplete','Incomplete — ERP outstanding missing');
      const reasons={
        'different-currencies':t('projectFinances.differentCurrencies','Unavailable — different currencies'),
        'work-unavailable':t('projectFinances.workUnavailable','Billed-work revenue unavailable'),
        'actuals-unavailable':t('projectFinances.actualsUnavailable','GL reading unavailable'),
        'restricted-rows':t('projectFinances.restricted','Actuals exclude restricted rows'),
      };
      return <div key={bucket.currency} className="min-w-0 space-y-2" data-testid={`project-finances-${bucket.currency}`}>
        <h3 className="text-sm font-semibold">{bucket.currency}</h3>
        <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
          {field(t('projectFinances.invoiced','Invoiced'),money(bucket.invoiced,bucket.currency))}
          {field(t('projectFinances.settled','Settled'),bucket.missing_outstanding>0 ? incomplete : money(bucket.settled,bucket.currency))}
          {field(t('projectFinances.outstanding','Outstanding'),bucket.missing_outstanding>0 ? incomplete : money(bucket.outstanding,bucket.currency))}
          {field(t('projectFinances.work','Billed-work revenue (net of tax, advances excluded)'),money(bucket.work_revenue,bucket.currency))}
          {field(t('projectFinances.margin','Margin'),margin.reason ? reasons[margin.reason] : money(margin.amount,bucket.currency))}
        </dl>
        <div className="text-xs text-muted-foreground">
          {bucket.tax_basis==='mixed' ? t('projectFinances.mixedTaxBases','Mixed tax bases') :
            <TaxBasisLabel treatment={bucket.tax_basis} showDetails={false}/>}
        </div>
      </div>;
    })}
    <p className="text-xs text-muted-foreground">{t('projectFinances.settlementNote',
      'Settled against invoices (cash, withholding and credits), not cash received.')}</p>
    <div className="min-w-0">
      <h3 className="text-sm font-semibold">{t('projectFinances.budget','Budget')}</h3>
      {data.budget ? <p className="break-words tabular-nums">
        {data.budget.status==='Draft' ? t('projectFinances.draft','Draft — not active') : t('projectFinances.active','Active')}
        {` · ${data.budget.name} · v${data.budget.version} · ${data.budget.currency} · ${money(data.budget.amount,data.budget.currency)}`}
      </p> : <p>{t('projectFinances.noBudget','No budget')}</p>}
    </div>
    <div className="min-w-0 space-y-2">
      <h3 className="text-sm font-semibold">{t('projectFinances.mappedCosts','Mapped GL costs')}{actuals.currency ? ` · ${actuals.currency}` : ''}</h3>
      <p className="break-words font-semibold tabular-nums">{money(actuals.total,actuals.currency)}</p>
      <p className="text-xs text-muted-foreground">{actuals.as_of ? formatInstantDate(actuals.as_of) :
        t('projectFinances.actualsUnavailable','GL reading unavailable')}</p>
      {actuals.excludes_restricted_rows && <p role="status">{t('projectFinances.restricted','Actuals exclude restricted rows')}</p>}
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <caption className="sr-only">{t('projectFinances.mappedCosts','Mapped GL costs')}</caption>
        <thead><tr><th scope="col" className="text-left">{t('projectFinances.category','Category')}</th>
          <th scope="col" className="text-right">{t('projectFinances.actuals','GL actuals')}</th></tr></thead>
        <tbody>{actuals.categories.map(row=><tr key={row.category}>
          <th scope="row" className="break-words text-left font-normal">{budgetCategoryLabel(row.category as Parameters<typeof budgetCategoryLabel>[0],t)}</th>
          <td className="break-words text-right tabular-nums">{row.mapped ? money(row.amount,actuals.currency) :
            t('projectFinances.mappingUnavailable','Account mapping unavailable')}</td>
        </tr>)}</tbody></table></div>
    </div>
    <p className="text-xs text-muted-foreground" data-testid="project-invoicing-scope">{t('projectDetail.overview.invoicing.scopeNote',
      'Counts invoices linked to this project. Invoices raised in the ERP without a project are not included.')}</p>
  </section>;
}
```

Currency codes are printed on each invoice group and on budget/GL headings. Each contract-basis label is inside its corresponding definition cell, preserving its exact test ID. No detached basis label or inferred currency.

### Appendix L — full payload guard (Task 28)

In `src/lib/projectFinances.ts`, after `moneyUnits` and types:

```ts
export function isProjectFinances(value: unknown): value is ProjectFinances {
  const object=(v:unknown):v is Record<string,unknown>=>v!==null && typeof v==='object' && !Array.isArray(v);
  const exact=(v:unknown)=>v===null || (typeof v==='string' && moneyUnits(v)!==null);
  const count=(v:unknown)=>typeof v==='number' && Number.isInteger(v) && v>=0;
  const currency=(v:unknown)=>typeof v==='string' && /^[A-Z]{3}$/.test(v);
  const uuid=(v:unknown)=>typeof v==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
  if (!object(value) || !uuid(value.project_id) || !exact(value.contract_invoiced) || !exact(value.remaining_to_invoice)
      || !Array.isArray(value.invoices) || !value.invoices.every(v=>object(v) && currency(v.currency)
        && count(v.invoice_count) && count(v.missing_amount) && count(v.missing_outstanding) && count(v.missing_work)
        && ['inclusive','exclusive','mixed'].includes(String(v.tax_basis)) && exact(v.invoiced) && exact(v.settled)
        && exact(v.outstanding) && exact(v.work_revenue))) return false;
  const b=value.budget;
  if (b!==null && (!object(b) || !uuid(b.id) || typeof b.name!=='string' || !count(b.version)
      || (b.status!=='Active' && b.status!=='Draft') || !currency(b.currency) || !exact(b.amount))) return false;
  const a=value.actuals;
  return object(a) && (a.currency===null || currency(a.currency))
    && (a.as_of===null || (typeof a.as_of==='string' && Number.isFinite(Date.parse(a.as_of))))
    && exact(a.total) && typeof a.excludes_restricted_rows==='boolean' && Array.isArray(a.categories)
    && a.categories.every(v=>object(v) && typeof v.category==='string' && typeof v.mapped==='boolean' && exact(v.amount));
}
```

No Number conversion of money; `Date.parse` handles reading metadata only. DAL rejects a payload whose project ID is not the requested ID.

### Appendix M — exact locale objects (Task 42)

Merge these **two new top-level objects only** into the existing common.json files (retain all other locale content). No untranslated key is left for the builder to invent.

`pmo-portal/public/locales/en/common.json`:

```json
{
  "projectFinances": {
    "title":"Project finances", "lifetime":"Lifetime to date", "contract":"Contract value",
    "invoiced":"Invoiced", "settled":"Settled", "outstanding":"Outstanding",
    "settlementNote":"Settled against invoices (cash, withholding and credits), not cash received.",
    "incomplete":"Incomplete — ERP outstanding missing",
    "work":"Billed-work revenue (net of tax, advances excluded)", "margin":"Margin",
    "differentCurrencies":"Unavailable — different currencies", "workUnavailable":"Billed-work revenue unavailable",
    "draft":"Draft — not active", "active":"Active", "noBudget":"No budget", "budget":"Budget",
    "restricted":"Actuals exclude restricted rows", "actualsUnavailable":"GL reading unavailable",
    "mappingUnavailable":"Account mapping unavailable", "mappedCosts":"Mapped GL costs",
    "category":"Category", "actuals":"GL actuals", "unavailable":"Unavailable",
    "loading":"Loading project finances…", "error":"Couldn't load project finances.", "retry":"Retry",
    "noInvoices":"No submitted invoices", "mixedTaxBases":"Mixed tax bases",
    "contractInvoiced":"Invoiced against contract", "remaining":"Remaining to invoice"
  },
  "invoiceProject": {
    "assign":"Assign project", "change":"Change project", "project":"Project", "save":"Save project",
    "scope":"PMO attribution only; the ERP invoice is unchanged.", "required":"Select a project.",
    "current":"Current project", "fromTo":"From {{old}} to {{new}}. PMO attribution only; the ERP invoice is unchanged.",
    "discardTitle":"Discard project selection?", "discardDetail":"The selected project will not be saved.",
    "discard":"Discard", "keep":"Keep editing", "unassignedFilter":"Unassigned invoices"
  }
}
```

`pmo-portal/public/locales/id/common.json`:

```json
{
  "projectFinances": {
    "title":"Keuangan proyek", "lifetime":"Sejak awal hingga kini", "contract":"Nilai kontrak",
    "invoiced":"Ditagihkan", "settled":"Diselesaikan", "outstanding":"Belum dibayar",
    "settlementNote":"Penyelesaian tagihan (kas, potongan pajak, dan kredit), bukan kas diterima.",
    "incomplete":"Belum lengkap — saldo belum dibayar dari ERP belum tersedia",
    "work":"Pendapatan pekerjaan ditagihkan (neto pajak, tanpa uang muka)", "margin":"Margin",
    "differentCurrencies":"Tidak tersedia — mata uang berbeda", "workUnavailable":"Pendapatan pekerjaan ditagihkan belum tersedia",
    "draft":"Draf — belum aktif", "active":"Aktif", "noBudget":"Belum ada anggaran", "budget":"Anggaran",
    "restricted":"Aktual tidak mencakup baris terbatas", "actualsUnavailable":"Pembacaan buku besar belum tersedia",
    "mappingUnavailable":"Pemetaan akun belum tersedia", "mappedCosts":"Biaya buku besar terpetakan",
    "category":"Kategori", "actuals":"Aktual buku besar", "unavailable":"Tidak tersedia",
    "loading":"Memuat keuangan proyek…", "error":"Keuangan proyek tidak dapat dimuat.", "retry":"Coba lagi",
    "noInvoices":"Belum ada tagihan yang diajukan", "mixedTaxBases":"Dasar pajak berbeda",
    "contractInvoiced":"Ditagihkan terhadap kontrak", "remaining":"Sisa untuk ditagihkan"
  },
  "invoiceProject": {
    "assign":"Tetapkan proyek", "change":"Ubah proyek", "project":"Proyek", "save":"Simpan proyek",
    "scope":"Hanya atribusi PMO; tagihan ERP tidak berubah.", "required":"Pilih proyek.",
    "current":"Proyek saat ini", "fromTo":"Dari {{old}} ke {{new}}. Hanya atribusi PMO; tagihan ERP tidak berubah.",
    "discardTitle":"Buang pilihan proyek?", "discardDetail":"Proyek yang dipilih tidak akan disimpan.",
    "discard":"Buang", "keep":"Lanjutkan mengedit", "unassignedFilter":"Tagihan tanpa proyek"
  }
}
```

## 4. Test conventions and exact verify commands

All commands below run from repo root. Every behavior task: write its ID-tagged failing test **first**, run its listed command and inspect actual RED assertions, implement the stated block/change, rerun and require GREEN. Never skip/weaken a test. Tests import shipped code; edge tests import `./index.ts` and mock `globalThis.fetch`. No production DI and no copied handler/resolver. Use synthetic data only.

Named commands used by tasks are complete commands, not an instruction to choose tests:

```bash
# V-MONEY
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/projectFinances.test.ts'
# V-FORM
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/SalesInvoices.assignProject.test.tsx'
# V-SECTION
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/project-detail/ProjectFinancesSection.test.tsx'
# V-HOOK
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/hooks/useRevenue.assignProject.test.tsx src/hooks/useProjectFinances.test.tsx'
# V-DAL
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/db/projectFinances.test.ts'
# V-FEED
(cd supabase/functions/erpnext-sweep && deno test --allow-env --allow-net projectInvoiceAttribution.test.ts)
# V-BACKFILL
(cd supabase/functions/erpnext-sweep && deno test --allow-env --allow-net projectInvoiceBackfill.test.ts)
# V-WRITER
(cd supabase/functions/adapter-dispatch && deno test --allow-env --allow-net readModelWriters.test.ts)
# V-ASSIGN (migration edit => reset and test within ONE lock)
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0287_assign_invoice_project.test.sql'
# V-FILL
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0287_project_invoice_backfill.test.sql'
# V-READ
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0287_project_finances_reads.test.sql'
# V-COMPAT
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0287_project_finances_reads.test.sql supabase/tests/budget_projection_rpc.test.sql supabase/tests/bfy_projection_null_lines.test.sql supabase/tests/bfy_projection_refused_push.test.sql supabase/tests/bfy_map_edit_reinterprets_history.test.sql supabase/tests/erp_snapshot_generation_honesty.test.sql'
# V-ACL
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0287_assign_invoice_project.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/record_changes_catalog_gate.test.sql'
# V-TYPE
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck'
```

Test scaffolds: pgTAP uses `begin; select no_plan();` / `select * from finish(); rollback;` and namespaced synthetic `02870000-...` UUIDs, per `0278_invoice_change_history.test.sql`; insert auth/profile/project/reference fixtures as owner/service, clear retained JWT claims before service writes, then set authenticated claims for each assertion. Do not print real fixtures or credentials. Use `example.test` dummy addresses only where schema requires one. SQL snippets' expected figures compare `numeric`/`jsonb`/strings, not float tolerances. The canonical test descriptions lead with the AC ID. Use parameterized cases with individual ID-tagged descriptions.

## 5. Bite-sized implementation tasks

**TDD assembly order:** code blocks above are reference implementations, not permission to copy future untested behavior early. Tasks 04–05 are two RED-test chunks for the operator RPC: copy SQL B only in Task 05 after both role and billing-context tests are written. Tasks 18–21 are four 2–4-minute RED-test chunks for one multi-contract SQL RPC; write all their tests before Task 22 appends SQL F and makes the entire group GREEN. Likewise Task 34 writes selection tests before Task 35 writes correction/error tests and copies Appendix J; Tasks 38–39 write reading-state tests before Task 40 writes remaining presentation tests and copies Appendix K. These RED chunks are not completion checkpoints: do not commit or claim any group complete until its shared implementation and every owning test are GREEN. All other tasks run their own RED→GREEN immediately.

### Task 01 (3 min) — Extract the exact resolver; AC-PFIN-001/002

**RED:** `pmo-portal/src/lib/adapterSeam/erpnext/projectMap.test.ts`: importing `invertProjectMap` must return `[ERP-A → p1, ERP-B → null]` for `{p1:'ERP-A',p2:'ERP-B',p3:'ERP-B',p4:7,p5:''}`; undefined map returns empty; `' ERP-A '` is a distinct untrimmed name. Verify:
` scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/projectMap.test.ts src/lib/adapterSeam/erpnext/actualsSnapshot.test.ts' `.

**GREEN:** move the complete `invertProjectMap` function from `actualsSnapshot.ts` to new `projectMap.ts`, prefix it `export`, retain signature `Readonly<Record<string, unknown>> | undefined → ReadonlyMap<string,string|null>`, import it via `./projectMap.ts` in actualsSnapshot. No other actuals behavior changes.

### Task 02 (3 min) — Carry source provenance; AC-PFIN-001/003

**RED:** add mapper assertions in `projectMap.test.ts`: `siFromDoc({name:'SI-A',project:'ERP-A'}).erp_project === 'ERP-A'`; explicit null → own key null; omitted project → no own key; poll fields include `project`. Same Vitest command as Task 01.

**GREEN:** `bodies/salesInvoice.ts`, at the start of its return object:

```ts
...(Object.prototype.hasOwnProperty.call(d, 'project')
  ? { erp_project: typeof d.project === 'string' ? d.project : null }
  : {}),
```

Append `'project'` to `SI_FROM_DOC_FIELDS`. Outbound `siToBody` remains unchanged.

### Task 03 (4 min) — Provenance/org seam migration; AC-PFIN-001/007

**RED:** start `supabase/tests/0287_assign_invoice_project.test.sql`: `has_column` nullable `erp_project`; assert sales-invoice RLS remains forced, authenticated cannot write provenance in either ownership state; service-role insert/update with a foreign project raises `P0002`. Verify V-ASSIGN.

**GREEN:** create `supabase/migrations/0287_project_finances.sql`, append SQL A. Append the existing guard with the precise change in SQL B (including provenance comparison). Native/DAL grants and all other guard clauses are unchanged. Keep 0286 untouched.

### Task 04 (4 min) — Checked operator assignment; AC-PFIN-006/007

**RED:** same pgTAP file: active Finance and Admin assign a synthetic adopted invoice with a current external ref; `project_id` changes and `to_jsonb(si)-'project_id'` remains identical. Try Executive, PM, Engineer, inactive Finance, NULL/anonymous role, foreign invoice/project and NULL project; assert refusal/no update. Verify V-ASSIGN.

**Implementation binding:** Task 05 appends SQL B's full function/grants/owner after both RED chunks. Fixtures must give adopted invoices no body authors and must establish an ERP revenue ownership binding for the direct-write refusal case (insert `external_domain_ownership(org_id,external_tier,domain) values (fixture_org,'erpnext','revenue')` as in `0275_native_revenue_erp_path.test.sql`; use synthetic org only).

### Task 05 (3 min) — Preserve billing context; AC-PFIN-006/007

**RED:** same pgTAP file: native invoice, PMO-authored ERP invoice, missing external ref, conflicting work-order project and claim project are refused; matching work-order retains its link; repeated same project succeeds without changing any field. Verify V-ASSIGN.

**GREEN:** after all Task 04/05 tests demonstrate RED, append SQL B's function/grants/owner exactly. Require V-ASSIGN GREEN for both role and context matrices. Existing 0262 billing authority stays; no link clearing, money write, author-set or approval-rule change.

### Task 06 (4 min) — Join existing history; AC-PFIN-008

**RED:** same pgTAP file: change NULL→P1 then P1→P2, repeat P2; exactly two update events, actor=JWT user, latest parent=P2, old/new refs correct. Service fill/provenance refresh does not add operator history. Verify V-ASSIGN.

**GREEN:** append SQL D and the precisely amended full 0278 capture body. `pmo-portal/src/components/history/historyFields.ts`: add `project_id: 'ref'` to `FIELD_KINDS.sales_invoice`. `historyLabels.ts` already has the shared project field label; retain it. Complete the project reference source using Appendix H below in `historyFields.ts`, `useHistoryRefs.ts`, `RecordHistory.tsx`, and `src/lib/repositories/recordHistory.ts`; batch old/new project names (including archived) and never print raw IDs. Add the actor/project-name assertion to `src/components/history/__tests__/RecordHistory.test.tsx`, verified by `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/history/__tests__/RecordHistory.test.tsx src/lib/repositories/__tests__/recordHistory.test.ts'`.

### Task 07 (4 min) — NULL-only machine fill; AC-PFIN-003/004

**RED:** `supabase/tests/0287_project_invoice_backfill.test.sql`: first service fill returns true, second returns false; existing P2 correction stays P2 when machine asks for P1; wrong org/nonexistent project/stale provenance/native row/ref mismatch return false; authenticated/anon cannot execute. Verify V-FILL.

**GREEN:** append SQL C. Add pgTAP `is(project_id,...)` after every no-op, and assert the exact UPDATE predicate mechanism via `pg_get_functiondef` contains `si.project_id is null` (concurrency cannot be proved by single-session scheduling alone).

### Task 08 (4 min) — Live shared project resolution; AC-PFIN-001/002

**RED:** `supabase/functions/erpnext-sweep/projectInvoiceAttribution.test.ts` imports `sweepOrgDoctypesLive` from `./index.ts`, stubs `Deno.serve`, mocks global fetch, drives a Sales Invoice poll with `config.project_map`; assert adopted INSERT has P1/provenance and no unassigned notification. For duplicate, unmapped, absent, malformed UUID, deleted/foreign-org target assert NULL, adoption success and existing notice. Process gate on does not refuse inbound adoption. Verify V-FEED.

**GREEN:** new `supabase/functions/_shared/projectInvoiceAttribution.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { invertProjectMap } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/projectMap.ts';
export async function resolveInvoiceProjects(
  db: SupabaseClient, orgId: string, names: readonly unknown[],
): Promise<ReadonlyMap<string,string|null>> {
  const result=new Map<string,string|null>();
  const strings=[...new Set(names.filter((n):n is string=>typeof n==='string' && n.length>0))];
  if (strings.length===0) return result;
  const {data:binding,error:bindingError}=await db.from('external_org_bindings')
    .select('config').eq('org_id',orgId).eq('external_tier','erpnext').not('activated_at','is',null).maybeSingle();
  if (bindingError) throw new AppError(bindingError.message,bindingError.code);
  const config=binding?.config as {project_map?:Record<string,unknown>}|undefined;
  const inverse=invertProjectMap(config?.project_map);
  const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const candidates=[...new Set(strings.flatMap(name=>{
    const id=inverse.get(name); return id && uuid.test(id) ? [id] : [];
  }))];
  const valid=new Set<string>();
  for (let start=0;start<candidates.length;start+=200) {
    const {data,error}=await db.from('projects').select('id').eq('org_id',orgId)
      .in('id',candidates.slice(start,start+200));
    if (error) throw new AppError(error.message,error.code);
    for (const row of data ?? []) valid.add(row.id);
  }
  for (const name of strings) {
    const id=inverse.get(name); result.set(name,id && valid.has(id) ? id : null);
  }
  return result;
}
export async function resolveInvoiceProject(db:SupabaseClient,orgId:string,erpProject:unknown):Promise<string|null> {
  if (typeof erpProject!=='string') return null;
  return (await resolveInvoiceProjects(db,orgId,[erpProject])).get(erpProject) ?? null;
}
```

Import it into `_shared/erpnextFeedDeps.ts`. This is the only live inverse-resolution helper, shared by webhook/sweep/backfill. A DB lookup failure is an error, not a falsely successful unresolved target. The deciding query `listEmployingOrgsLive` uses `external_tier = ERPNEXT_TIER`; this helper uses that same column/value.

### Task 09 (3 min) — Adopt with resolved project; AC-PFIN-001/002

**RED:** extend V-FEED to assert claim precedes insert; notification only for an unresolved result. **GREEN:** in `mintMirrorRow` sales-invoice branch:

```ts
const projectId = await resolveInvoiceProject(serviceClient, orgId, canonical.erp_project);
// In existing insert object replace project_id:null with:
project_id: projectId,
erp_project: canonical.erp_project ?? null,
// Wrap the existing notifyFinanceUnassignedInvoice call:
if (projectId === null) await notifyFinanceUnassignedInvoice(serviceClient,orgId,{
  salesInvoiceId:id, siNumber:String(canonical.si_number ?? canonical.id ?? ''),
  amount:(canonical as { amount?: string | number | null }).amount ?? null,
});
```

Keep the existing financial/lifecycle insert fields and claim-first engine unchanged. Verify V-FEED.

### Task 10 (4 min) — Refresh provenance and NULL-fill only; AC-PFIN-003

**RED:** V-FEED cases: assigned P2 plus ERP-A stays P2; omitted field leaves recorded provenance; explicit null clears provenance, not attribution; a later ERP-A fill calls SQL C; newer/stale feed handling still controls event application. Mock RPC and assert it never carries money/body fields.

**GREEN:** `revenueFieldPatch`, sales-invoice branch:

```ts
if (Object.prototype.hasOwnProperty.call(canonical,'erp_project')) {
  patch.erp_project = canonical.erp_project;
}
```

After the existing scoped update succeeds in `updateMirror`, for `kind === 'sales-invoice'` and a present string provenance resolve and call:

```ts
const projectId = await resolveInvoiceProject(serviceClient,orgId,canonical.erp_project);
if (projectId) {
  const { error: fillError } = await serviceClient.rpc('fill_sales_invoice_project',{
    p_org_id:orgId,p_si_id:pmoRecordId,p_project_id:projectId,p_erp_project:canonical.erp_project,
  });
  if (fillError) throw new AppError(fillError.message,fillError.code);
}
```

No project field in the general patch, no unconditional second update. Verify V-FEED.

### Task 11 (3 min) — Dispatch read-back preserves provenance; AC-PFIN-003

**RED:** extend `supabase/functions/adapter-dispatch/readModelWriters.test.ts`: SI read-back carries ERP-A into `erp_project`; omitted project does not clear old provenance; explicit null is preserved; canonical source does not replace a PMO project link. Verify V-WRITER.

**GREEN:** in `salesInvoicesWriter` patch add:

```ts
...(Object.prototype.hasOwnProperty.call(canonical,'erp_project')
  ? { erp_project:canonical.erp_project } : {}),
```

Include provenance in the SI create insert as `erp_project: canonical.erp_project ?? null`. Keep command's same-org PMO project authority on creation and existing authorship behavior. No outbound `project` rewrite is added.

### Task 12 (4 min) — Bounded historical candidate query; AC-PFIN-004

**RED:** new `supabase/functions/erpnext-sweep/projectInvoiceBackfill.test.ts`, importing the live repair entry exported from `./index.ts`: fake DB with 101 candidates; only 100 read, stable `id` cursor, no INSERT, assigned mirrors excluded, refs fetched once per batch and same-org scoped. Verify V-BACKFILL.

**GREEN:** add/export `repairInvoiceProjectsLive(serviceClient: SupabaseClient, org: OrgBinding, afterId: string | null, cache?: ErpAuthPairCache)` in `erpnext-sweep/index.ts`. Candidate query is:

```ts
let query = serviceClient.from('sales_invoices').select('id,si_number,erp_project,erp_modified')
  .eq('org_id',org.orgId).is('project_id',null).eq('pmo_native',false)
  .not('si_number','is',null).order('id',{ascending:true}).limit(100);
if (afterId) query = query.gt('id',afterId);
```

Read current revenue `external_refs` once with `.in('pmo_record_id', rows.map(r=>r.id))`; match the ref's ERP name to SI identity. Return `{scanned,repaired,unresolved,failedIds,nextCursor,done}`. Empty page means done. Only owned revenue/activated ERP bindings are eligible.

### Task 13 (4 min) — Hydrate and repair existing mirrors; AC-PFIN-004

**RED:** V-BACKFILL: missing provenance fetched from current ref; binding-company mismatch remains unresolved; old watermark does not matter; changed source modification cannot overwrite concurrent provenance. Run twice: second successful pass writes nothing/new invoices zero. Source fetch/DB errors appear as failed IDs, never `done:true`.

**GREEN:** for each candidate use existing `erpClientForOrg` + `fetchErpDoc(client,DOCTYPE_REGISTRY['sales-invoice'].doctype,ref.external_record_id)`, enforce `admitsDocForBindingCompany('sales-invoice',doc,org.company)` and `doc.name === ref.external_record_id`. `siFromDoc` supplies provenance. Missing stored provenance is hydrated only with this CAS:

```ts
let hydration = serviceClient.from('sales_invoices').update({erp_project:canonical.erp_project ?? null})
  .eq('org_id',org.orgId).eq('id',row.id).is('project_id',null).is('erp_project',null);
hydration = row.erp_modified === null
  ? hydration.is('erp_modified',null) : hydration.eq('erp_modified',row.erp_modified);
const { data: hydrated, error } = await hydration.select('id');
```

Skip fill after a lost CAS. If the source project is null, perform no redundant null→null update. Collect all successfully hydrated/stored source names in this candidate batch, call `resolveInvoiceProjects` **once** (one binding lookup and bounded same-org target query), then SQL C for each resolved row. For non-null stored provenance, resolve without a redundant ERP fetch. Count unresolved separately. Cap missing-provenance ERP GETs at 10 per request: after the tenth, return `done:false` and cursor of the last actually processed candidate (not the last merely queried row); next batch resumes after it. Assigned/known-provenance rows cost no ERP GET. Add a V-BACKFILL assertion that ten fetched docs among 100 candidates produces this continuation rather than an invocation-sized unbounded network loop. On any source/DB failure retain the **input cursor** as `nextCursor` and `done:false`, so retry repeats the batch safely; on a fully processed successful page use its last scanned id and `done` iff page length <100. A GET-cap continuation is not a completed page and uses the last processed id. A retry after partial success remains idempotent because assigned rows leave the candidate set. Verify V-BACKFILL.

### Task 14 (4 min) — Explicit maintenance request, not recurring load; AC-PFIN-004

**RED:** V-BACKFILL captures the shipped serve handler from `Deno.serve`; normal empty-body cron request still takes existing cycle; authenticated maintenance request calls only one repair batch; browser/unauthorized request refuses before reads. Invalid UUID cursor/org is 400. A failed batch returns `ok:false`, failures and unchanged cursor.

**GREEN:** after the existing sweep authorization/client initialization and before the normal cycle, parse a non-empty JSON body into `{mode:'repair-invoice-projects',org_id:string,after_id:string|null}`. Validate UUIDs and exact mode (unknown non-empty modes → 400); normal missing/empty body keeps existing behavior. Obtain the named org from `listEmployingOrgsLive`, require owned revenue, call `repairInvoiceProjectsLive`; return JSON with its explicit result. No new credential, public browser API or scheduler pass. Add maintenance instructions to `docs/runbooks/project-invoice-attribution.md`: authorized local operator sends one batch, follows cursor until done, retries failures at unchanged cursor, then verifies unresolved counts. No credentials, actual tenant IDs or secret coordinates in tracked examples. Verify V-BACKFILL.

### Task 15 (3 min) — Receipt identity follows invoice; AC-PFIN-005

**RED:** begin `supabase/tests/0287_project_finances_reads.test.sql`: linked payment joins invoice NULL→P1→P2 after operator corrections; on-account payment remains no project. Assert no `incoming_payments.project_id` column and no allocation relation is introduced. Verify V-READ (assignment migration available).

**GREEN:** no payment schema or writer changes. The proof query is `incoming_payments ip left join sales_invoices si on si.id=ip.sales_invoice_id and si.org_id=ip.org_id`; assert `si.project_id` follows the invoice. Keep payment caches in the mutation invalidation list for derived displays.

### Task 16 (4 min) — Current-generation mapping aggregate; AC-PFIN-011

**RED:** same read pgTAP file: old generation Labor=999; current generation accounts A=20/B=30 both Labor, C=7 Materials, NULL-fiscal-year A=4; no budget. Assert lifetime Labor=54/Materials=7, mapped no-entry category zero only with reading, unmapped category NULL, as_of current, no foreign-org contribution. Verify V-READ.

**GREEN:** append SQL E. Add a no-project-reading fixture and a mapped row with NULL net; both withhold actuals rather than masking them. `has_rows` preserves projection category enumeration.

### Task 17 (4 min) — Projection compatibility; AC-PFIN-018

**RED:** extend read pgTAP: explicit FY2026 helper excludes FY2027/NULL; compare `get_budget_projection` return metadata and canonical projection fixtures before/after factoring; NULL year does not become lifetime. Verify V-COMPAT.

**GREEN:** append the 0153 projection definition with only SQL E's CTE replacements. The prior definitions are extracted with a brace/dollar-body-aware read, not an imprecise `.*` across every function. No drop/recreate: public OUT shape remains the same. Existing tests must all remain green; do not update their expected money.

### Task 18 (4 min) — Concrete settlement SQL; AC-PFIN-017

**RED:** same read pgTAP fixtures: USD 100/25 +80/0 → 180/155/25; IDR 1000/200 →1000/800/200; Draft/Cancelled excluded. Add USD20/NULL → Invoiced200, Settled/Outstanding null, missing_outstanding1. Assert JSON money strings, not numbers. NULL amount and malformed numeric are separately unknown. Verify V-READ.

**Implementation, after the RED chunks through Task 22:** SQL F's invoice CTEs implement these exact tests. Do not append the whole function yet: Tasks 19–22 write its remaining failing contracts first. Row statuses use the positive submitted allow-list; no incoming-payment scan contributes to these amounts. The shared GREEN gate is V-READ in Task 22.

### Task 19 (3 min) — Billed-work and lifetime semantics; AC-PFIN-018

**RED:** same read pgTAP: dated two-year and undated submitted invoices all count; down-payment excluded from work but included in Invoiced/Outstanding; claim net100/recovery30 → work130. No invoice date filter. Verify V-READ.

**Implementation binding:** Task 22 appends SQL F's work join consuming `sales_invoice_work_billed`, with no duplicated tax/advance/claim revenue formula; actuals use explicit NULL for lifetime. This RED chunk does not change `getRevenueByProject` or native mutations. Shared GREEN: V-READ in Task 22.

### Task 20 (3 min) — Budget version selection; AC-PFIN-012

**RED:** same read pgTAP: Active1 beats Draft3; remove Active → Draft3 beats Draft2; deterministic timestamp/id tiebreaks; no versions → null; two fiscal years plus unphased lines on selected version sum once. Verify V-READ.

**Implementation binding:** Task 22 appends SQL F `chosen_budget`/`budget_sum`. Server numeric, no client line scan, header currency/status/name/version retained. Shared GREEN: V-READ in Task 22; no function copy before the next RED authority/contract chunks.

### Task 21 (4 min) — Read authority and restricted-row contract; AC-PFIN-014

**RED:** same read pgTAP role matrix: Admin/Finance/Executive/PM lives; Engineer/inactive/anonymous refused; foreign project returns no payload. Synthetic Employee-party GL row is visible to each allowed role via the existing `erp_gl_entry_mirror` policy and `holds_spend_approval_authority`, false for Engineer. Assert new reads are invoker, same-org rows only, false `excludes_restricted_rows` for the proved complete audience. Verify V-READ.

**Implementation binding:** after Task 22's final RED contract tests, append SQL F's checked invoker read and SQL G. No definer read or table-policy widening. This chunk adds no public read until the complete authority tests exist. Future restricted flags qualify readings/withhold margin (Task 30); no restricted raw detail is returned. Shared GREEN: V-READ in Task 22.

### Task 22 (3 min) — Preserve contract-basis comparison; AC-PFIN-020

**RED:** same read pgTAP: USD inclusive contract220/exclusive invoice100/tax10 → contract_invoiced110/remaining110; separate Invoiced100. Add foreign-currency submitted row → comparison null; Draft/Cancelled foreign rows don't invalidate it. NULL tax basis/amount → unknown. Verify V-READ.

**GREEN:** now append the complete SQL F plus SQL G, after every Task 18–22 oracle has demonstrated RED. `contract_rows`/`contract_sum` retain `calculateProjectInvoiceSummary` normalization, existing negative remaining values and basis labels. Settlement/margin do not use contract-currency conversion. Run V-READ and require all five test chunks GREEN before continuing or committing.

### Task 23 (4 min) — Catalog/inventory registration; AC-PFIN-007/014

**RED:** V-ACL reports new definer inventory/column classification before registration; `scripts/with-db-lock.sh node scripts/check-isolation-denominator.mjs` compares the local catalog and reports the two unlisted non-trigger commands. Retain actual missing-entry output as RED.

**GREEN:** `0178_anon_executable_definers.test.sql` add `('assign_sales_invoice_project')` to retained client names, never service fill/trigger. Increase the two retained-count assertions from 69 to 70 and their explanatory titles from 69 to 70; no other ACL assertion changes. `scripts/isolation-probe-denominator.json`: add signatures `assign_sales_invoice_project(uuid,uuid)`, `fill_sales_invoice_project(uuid,uuid,uuid,text)` to definer inventory; the trigger is excluded by the enumerator. Add the assign writer entry with source-derived line citations using Appendix I. The RPC denominator accepts only registered definers/classes `write` or `inert`; invoker reads do not join it. Their role/org authority is proved in pgTAP. Read invoker/trigger functions do not join non-trigger definer inventory. History catalog must classify project as captured, provenance as omitted. Verify V-ACL and `node scripts/check-isolation-denominator.test.mjs`.

### Task 24 (4 min) — Reversible down migration; AC-PFIN-006/008

**RED:** `supabase/tests/0287_project_finances_rollback.test.sql` runs transaction fixtures: non-null provenance causes `P0001` before DDL; an exported/cleared-provenance fixture permits rollback; existing assigned project and two `record_changes` survive; prior guard and projection are restored. Include `\ir 0287_project_finances_down_runner.sql` and use `throws_ok('select pg_temp.run_pfin_down()','P0001',null,'AC-PFIN-008 rollback refuses provenance loss')`. Dynamic DDL is transactional: the failed call must leave all 0287 surfaces intact. Verify:
` scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0287_project_finances_rollback.test.sql' `.

**GREEN:** write the complete down file in the binding order above with exact 0153 projection and 0275 guard bodies embedded. The assembly recipe creates `supabase/tests/0287_project_finances_down_runner.sql` from the exact down-file body, removing only its outer transaction boundary for the test function. After clearing synthetic provenance call `lives_ok('select pg_temp.run_pfin_down()', 'AC-PFIN-006 rollback preserves attribution')`, then assert old assignments/history, helper/RPC absence and restored function bodies; end the owning pgTAP file with `rollback` so DDL/fixtures are undone. The `_runner.sql` suffix intentionally does not match `*.test.sql` discovery. Catalog assertions verify restored function body/columns. Preserve assignments and audit classifications.

### Task 25 (2 min) — Regenerate types; AC-PFIN-010/014

**RED:** add `pmo-portal/src/lib/db/projectFinances.types.test.ts` using Vitest `expectTypeOf` and generated `Database/Tables`: `expectTypeOf<Tables<'sales_invoices'>['erp_project']>().toEqualTypeOf<string|null>()` and `expectTypeOf<Database['public']['Functions']['assign_sales_invoice_project']['Args']>().toEqualTypeOf<{p_si_id:string;p_project_id:string}>()`. Missing generated keys make **V-TYPE** fail before regeneration; do not reference not-yet-written DAL exports.

**GREEN:** under DB lock run:
` scripts/with-db-lock.sh bash -c 'supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts' `.
Add `erp_project: string | null` to `SalesInvoiceRow` in `src/lib/db/revenue.ts`; generated SQL types must expose the four RPC signatures and nullable mirror column. Do not regenerate lockfiles or change dependency versions. Verify V-TYPE now, then `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/db/projectFinances.types.test.ts'`; both must be GREEN before the next task.

### Task 26 (3 min) — Exact decimal utilities; AC-PFIN-013

**RED:** new `pmo-portal/src/lib/projectFinances.test.ts` asserts 0.30−0.10=0.20, negative margin, `9007199254740993.99` survives, rejects null/NaN/Infinity/empty/three decimals. V-MONEY.

**GREEN:** new `src/lib/projectFinances.ts` types from §2 and code:

```ts
export function moneyUnits(value: ExactMoney | null): bigint | null {
  if (value === null || !/^-?\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const negative = value.startsWith('-');
  const [whole,fraction=''] = (negative ? value.slice(1) : value).split('.');
  const units = BigInt(whole)*100n + BigInt(fraction.padEnd(2,'0'));
  return negative ? -units : units;
}
export function moneyText(units: bigint): ExactMoney {
  const n = units < 0n ? -units : units;
  return `${units < 0n ? '-' : ''}${n/100n}.${String(n%100n).padStart(2,'0')}`;
}
```

No Number arithmetic. Verify V-MONEY.

### Task 27 (3 min) — Exact localized display; AC-PFIN-013/015

**RED:** V-MONEY expects English/Bahasa money parts for large amounts, signs and cents without Number conversion; invalid currency/money gives unavailable (not zero). Add formatter to `projectFinances.ts`:

```ts
export function formatExactMoney(value: ExactMoney | null,currency: string,locale: string): string | null {
  const units = moneyUnits(value);
  if (units === null || !/^[A-Z]{3}$/.test(currency)) return null;
  const absolute = units < 0n ? -units : units;
  try {
    const parts = new Intl.NumberFormat(locale,{style:'currency',currency,
      minimumFractionDigits:2,maximumFractionDigits:2}).formatToParts(absolute/100n);
    const body = parts.map(p=>p.type === 'fraction' ? String(absolute%100n).padStart(2,'0') : p.value).join('');
    return units < 0n ? `−${body}` : body;
  } catch { return null; }
}
```

Render with explicitly printed currency codes (Intl symbols alone are not the currency oracle). V-MONEY.

### Task 28 (4 min) — Runtime shape validation; AC-PFIN-015

**RED:** `src/lib/projectFinances.test.ts` imports `isProjectFinances` and tests a valid §2 fixture plus arrays/null/missing actuals/non-string money/unknown budget status/non-integer counts/malformed categories. Verify V-MONEY and inspect missing-export RED.

**GREEN:** add the complete Appendix L guard to `src/lib/projectFinances.ts`. It checks every §2 field, does no money coercion, and handles NULL readings. Verify V-MONEY + V-TYPE; no unchecked `as ProjectFinances`.

### Task 29 (4 min) — DAL and repository signatures; AC-PFIN-010/014

**RED:** `src/lib/db/projectFinances.test.ts` mocks Supabase: assign exact RPC args/no org, get exact project arg; DB error → AppError, null/malformed payload → AppError, no dispatchDomainCommand/outbox or invoice page scans. V-DAL.

**GREEN:** `src/lib/db/revenue.ts`:

```ts
export async function setSalesInvoiceProject(siId: string,projectId: string): Promise<void> {
  const { error } = await supabase.rpc('assign_sales_invoice_project',{p_si_id:siId,p_project_id:projectId});
  if (error) throwWrite(error);
}
export async function getProjectFinances(projectId: string): Promise<ProjectFinances> {
  const { data,error } = await supabase.rpc('get_project_finances',{p_project_id:projectId});
  if (error) throwWrite(error);
  if (!isProjectFinances(data) || data.project_id !== projectId) {
    throw new AppError('Project finance reading unavailable','invalid-project-finances');
  }
  return data;
}
```

Import types/validator from `src/lib/projectFinances.ts`. Add exactly §2's methods to `repositories/types.ts`; bind `setProject: setSalesInvoiceProject` and `getProjectFinances` in existing revenue repository `index.ts`, importing from DAL. Do not route through native/external ownership dispatch: this command is PMO attribution in either ownership state for an existing adopted row. V-DAL + V-TYPE.

### Task 30 (3 min) — Same-currency margin; AC-PFIN-013

**RED:** V-MONEY: USD work130−cost50=80; IDR invoice/baseUSD unavailable; missing work/cost propagate; NULL outstanding doesn't change known work; restricted reading does not make a complete margin.

**GREEN:** `projectFinances.ts`:

```ts
export function deriveMargin(bucket: InvoiceFinanceBucket,actuals: ProjectFinances['actuals']): Margin {
  if (actuals.currency && bucket.currency !== actuals.currency) return {amount:null,reason:'different-currencies'};
  if (actuals.excludes_restricted_rows) return {amount:null,reason:'restricted-rows'};
  const revenue = moneyUnits(bucket.work_revenue);
  if (revenue === null || bucket.missing_work > 0) return {amount:null,reason:'work-unavailable'};
  const cost = moneyUnits(actuals.total);
  if (cost === null || !actuals.currency) return {amount:null,reason:'actuals-unavailable'};
  return {amount:moneyText(revenue-cost),reason:null};
}
```

Never derive margin from Invoiced, Settled, contract, receipts or committed spend. V-MONEY.

### Task 31 (4 min) — Assignment mutation/cache; AC-PFIN-010

**RED:** new `src/hooks/useRevenue.assignProject.test.tsx` with real QueryClient: seed org A/B keys, invoice history and old/new finance; invoke assignment, assert specified org-A scopes stale and org-B unchanged; rejection leaves modal state/no optimistic money; no ERP dispatch. V-HOOK.

**GREEN:** in `src/hooks/useRevenue.ts` add:

```ts
export function useAssignInvoiceProject() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useMutation({
    mutationFn: ({siId,projectId}: AssignInvoiceProjectInput) => repositories.revenue.setProject(siId,projectId),
    onSuccess: async (_data,{siId,projectId,oldProjectId}) => {
      const keys: readonly unknown[][] = [
        ['salesInvoices',orgId],['salesInvoice',orgId,siId],['incomingPayments',orgId],
        ['incomingPayment',orgId],['revenueByProject',orgId],['project-vat-editability'],
        ['record-history',orgId,'sales_invoice',siId],
        ...[...new Set([oldProjectId,projectId].filter((id): id is string => Boolean(id)))].flatMap(id=>[
          ['project-finances',orgId,id],['record-history',orgId,'project',id],
        ]),
      ];
      await Promise.all(keys.map(queryKey=>qc.invalidateQueries({queryKey})));
    },
  });
}
```

Keys are org-scoped except the existing VAT-eligibility family. No onMutate optimistic totals, command intent or pending ERP push. Add/import `AssignInvoiceProjectInput` from the frozen contract. Also write failing hook tests for successful create/submit/cancel/receipt and budget mutations refreshing the new cached reading: `useRevenue.ts` existing `invalidate` adds `qc.invalidateQueries({queryKey:['project-finances',currentUser?.org_id]})`, with `useAuth` called once inside `useRevenueMutations`; `src/hooks/useBudget.ts` existing `invalidateBoth` adds `queryClient.invalidateQueries({queryKey:['project-finances',orgId,projectId]})`. Native money paths already route through `useRevenueMutations` and get this same invalidation, not a new native hook. Add these assertions to `src/hooks/useRevenue.assignProject.test.tsx` and verify V-HOOK plus `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/hooks/useBudget.test.ts'`. The new reading must not stay stale after ordinary money/budget changes.

### Task 32 (3 min) — Finance hook and audience; AC-PFIN-019

**RED:** new `src/hooks/useProjectFinances.test.tsx`: permitted real roles with org/project call repository and key is org/project; Engineer/no auth/missing project disabled; no cross-org cache reuse. V-HOOK.

**GREEN:** new `src/hooks/useProjectFinances.ts`:

```ts
export function useProjectFinances(projectId: string) {
  const {currentUser} = useAuth();
  const may = usePermission();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey:['project-finances',orgId,projectId],
    queryFn:()=>repositories.revenue.getProjectFinances(projectId),
    enabled:Boolean(orgId && projectId) && may('view','salesInvoice'),
  });
}
```

Use existing imports `useAuth`, `usePermission`, `useQuery`, `repositories`; hook must not thread org to repository. Keep it separate from whole-org invoice query. V-HOOK + V-TYPE.

### Task 33 (3 min) — Assignment permission; AC-PFIN-009

**RED:** `pages/__tests__/SalesInvoices.assignProject.test.tsx` asserts new action permits Admin/Finance real roles only, no native/PMO-authored eligibility, no effect of view-as on real mutation authority. V-FORM.

**GREEN:** `src/auth/policy.ts` Action union gains `'assign_project'`; salesInvoice entry `assign_project: allow(REVENUE_WRITE)`. New `src/lib/invoiceProjectAssignment.ts`:

```ts
export function canAttributeInvoice(invoice: SalesInvoiceRow): boolean {
  return !invoice.pmo_native && Boolean(invoice.si_number)
    && invoice.author_user_id === null && invoice.author_user_ids.length === 0;
}
```

Server remains authority for refs/org/context. Page visibility also uses real-role `may`, not generic edit or submit. V-FORM.

### Task 34 (5 min) — Shared selection modal; AC-PFIN-009

**RED:** V-FORM renders `InvoiceProjectModal`: project Combobox keyboard selection, empty cannot submit, pending blocks double saves, selection survives failed save; required project field has accessible label; axe reports no violations.

**Implementation binding:** Appendix J is copied in Task 35 only after both form-test chunks demonstrate RED. This selection chunk reserves new `pmo-portal/src/components/InvoiceProjectModal.tsx`; exact props:

```ts
export interface InvoiceProjectModalProps {
  invoice: SalesInvoiceRow;
  projects: ComboboxOption[];
  loadProjects: () => Promise<ComboboxOption[]>;
  currentProjectName: string | null;
  loading: boolean;
  onClose: () => void;
  onSave: (projectId: string) => Promise<void>;
}
```

Use mounted edit session, `useEntityForm<{projectId:string}>` with initial `invoice.project_id ?? ''`, validate nonempty; `EntityFormModal` title Assign/Change based on old link, subtitle invoice number + PMO-only explanation, `FormGrid` + `Combobox` with `label`, `loadOptions`, `selectedOption`, `value`, `onChange`, `required` (Appendix J); never pass a nonexistent `options` prop; `submitDisabled={!projectId || projectId===invoice.project_id}`, `loading`, dirty/discard props, selection isn't reset on catch. Match the existing `useEntityForm` API (`setValue`, `values`, `handleSubmit`) rather than introducing another form abstraction. V-FORM.

### Task 35 (4 min) — Correction confirmation/error/retry; AC-PFIN-009

**RED:** V-FORM: correcting P1→P2 names both projects in ConfirmDialog; Cancel doesn't write; confirm writes exactly once; rejected request returns to form with retained P2 and classified error; retry succeeds/closes only on success. **GREEN:** copy the complete Appendix J after Task 34 and this task's tests have both demonstrated RED. Modal maintains confirmation, selected form values, classified error and an in-flight ref. The core save/request behavior is:

```ts
const save = async () => {
  if (loading) return;
  setSaveError(null);
  try { await onSave(values.projectId); onClose(); }
  catch (error) {
    const classified = classifyMutationError(error);
    setSaveError({headline:classified.headline,detail:classified.detail});
    setConfirming(false);
  }
};
const requestSave = () => {
  if (invoice.project_id) setConfirming(true);
  else void save();
};
```

Render only one active form/confirmation surface at once; retain the mounted form state when confirmation opens. Confirm title `Change project`, description `From {{old}} to {{new}}. PMO attribution only; the ERP invoice is unchanged.`, old name fallback `Current project` (never opaque UUID), onConfirm `void save()`, onCancel returns to form. Error headline/retry stays within EntityFormModal. V-FORM.

### Task 36 (4 min) — Invoice row entry points; AC-PFIN-009

**RED:** V-FORM mounts actual `pages/SalesInvoices.tsx`: eligible Unassigned row has Assign project, assigned row Change project; viewers/native/authored rows have neither; opens the shared modal, save calls `assign.mutateAsync({siId,projectId,oldProjectId})`. **GREEN:** add target state `SalesInvoiceRow|null`, `useAssignInvoiceProject`, predicate, and one row-menu item gated by `may('assign_project','salesInvoice') && canAttributeInvoice(inv)`. Item label depends on `inv.project_id`; action sets target. Mount modal only with target, using existing `useInvoiceProjectOptions` results directly (`InvoiceProjectOption` extends `{value,label}`, not `{id,name}`). Pass a `loadProjects` callback that calls `projectOptionsQuery.refetch()` and throws its error; failed option lookup is not an empty project list. Add `useSearchParams` filter `attribution=unassigned` which filters `project_id === null` before existing search/status matching. Show dismissible filter chip `Unassigned invoices`; preserve other status/search filters and default page behavior. V-FORM.

### Task 37 (3 min) — Unassigned group journey; AC-PFIN-009

**RED:** V-FORM mounts `pages/RevenueByProject.tsx`: Unassigned row shows Finance/Admin Assign project button, viewer doesn't; button navigates to `/sales-invoices?attribution=unassigned`; keyboard group activation opens that list for any revenue reader without promising write authority. **GREEN:** in project-name cell add outline/ghost button only for `row.project_id===null && may('assign_project','salesInvoice')`; stop row click propagation and navigate to filtered list. In `onActivate`, NULL row navigates to the same list, nonnull row keeps project navigation. Page `canView` reuses `may('view','salesInvoice')`, aligning the section audience rather than inventing a new predicate. V-FORM.

### Task 38 (4 min) — Section loading/error/empty; AC-PFIN-015

**RED:** new `pmo-portal/pages/project-detail/ProjectFinancesSection.test.tsx`: pending announces loading with no zero; rejected query has role alert/Retry calling refetch; empty submitted buckets show No submitted invoices; missing GL reading shows GL reading unavailable; no budget text appears. V-SECTION.

**Implementation binding:** reserve new `ProjectFinancesSection.tsx`, props `{project:ProjectWithRefs}`. Copy Appendix K in Task 40 only after all three section-test chunks are RED. Call `useProjectFinances(project.id)` and `useTranslation`; render `section aria-label=Project finances data-testid=project-finances` with heading/scope. Pending/error return distinct ListState/Retry within section; successful empty invoice array is not a query failure. Keep contract value/tax label sourced from `project` and unavailable for invalid basis/unknown value. Use `formatExactMoney` for new payload money and existing formatCurrency solely for the existing project header value. V-SECTION.

### Task 39 (4 min) — Honest invoice/settlement cards; AC-PFIN-015/017

**RED:** V-SECTION: per-currency buckets render USD/IDR independently; missing outstanding renders Incomplete/explanation in Settled and Outstanding but known Invoiced; no label Cash received; visible settlement definition; missing amount unavailable. **Implementation binding:** Task 40 copies Appendix K, where each bucket is a `dl` with three settlement cells and its independent work/margin readings; the formatter contract is:

```ts
const reading = (amount: string | null,currency: string) =>
  formatExactMoney(amount,currency,i18n.language) ?? t('projectFinances.unavailable','Unavailable');
```

For missing outstanding replace both cells' amount text with `t('projectFinances.incomplete','Incomplete — ERP outstanding missing')`. Print `bucket.currency`, invoice count and stored `tax_basis` (mixed → Mixed tax bases, not false inclusive). Display the exact settlement copy in §1. Do not replace null with `'0.00'`. V-SECTION.

### Task 40 (4 min) — Revenue, margin and budget context; AC-PFIN-013/015

**RED:** V-SECTION: work130/cost50 USD margin80; IDR group differing base unavailable exact copy; Draft label + currency/amount, Active label and No budget; missing work doesn't use invoice amount as fallback; restricted flag shows qualification and margin unavailable.

**GREEN:** now copy complete Appendix K after Tasks 38–40's section tests are RED, then run V-SECTION and require all of them GREEN. Render billed-work per bucket, use `deriveMargin` and map its four reasons to localized visible explanations. Render budget payload as Active or Draft — not active with name/version/currency, not a guessed active value. Category cost table has Category / Mapped GL actuals, amount in actuals currency, known-zero only when payload states zero, null mapping label, `as_of` formatted using existing instant-date formatter. Show **Actuals exclude restricted rows** when flag true; don't render restricted details. V-SECTION.

### Task 41 (4 min) — Consolidate Overview and preserve comparison; AC-PFIN-019/020

**RED:** V-SECTION mounts actual Overview: four permitted roles have exactly one project-finances section and no old competing section; Engineer no new hook fetch/section, existing project content/delivery summary stays; on-hand contract220/comparison110/remaining110 both inclusive labels, separately Invoiced100. Pending old invoice list is not requested by the replacement section. **GREEN:** delete internal `ProjectInvoicingSummary` and its `useSalesInvoices`/calculate imports; import `ProjectFinancesSection` and `usePermission`, mount `may('view','salesInvoice') && <ProjectFinancesSection project={project}/>` once. Inside section, on-hand contract comparison renders server `contract_invoiced`/`remaining_to_invoice` in project currency/basis with existing `project-contract-basis`, `project-invoiced-basis`, `project-remaining-basis` test IDs and existing scope note. Keep all unrelated Overview components unchanged. Update existing Overview tests' **steps/selectors** only for deliberate consolidation; contract-basis goal assertions must remain. V-SECTION and `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/project-detail'`.

### Task 42 (3 min) — Localization and accessibility retention; AC-PFIN-009/015

**RED:** V-FORM/V-SECTION under `en` and `id`: no raw key, all §1 copy translated; keyboard focus reaches selector and confirm, Escape returns, selected project survives failure; axe no violations for successful/error/modal views. Narrow content wraps; viewport oracle is in Task 44. **GREEN:** merge the exact Appendix M objects into `pmo-portal/public/locales/en/common.json` and `id/common.json`. These keys match Appendix J/K verbatim, including `invoiceProject.current`/`required`/`unassignedFilter`. Retain existing currency, budget-category and tax-basis localization. Project-name interpolation uses `fromTo` in both languages. No UUID-as-user-label fallback, nested competing dialogs or custom focus traps. V-FORM + V-SECTION.

### Task 43 (5 min) — Curated persisted assignment journey; AC-PFIN-016

**RED:** new `pmo-portal/e2e/AC-PFIN-016-project-finances.spec.ts`, `// @e2e-isolation: self-isolated — owns its project/invoice/ref and cleans them up.` Read `docs/e2e-parallel-conventions.md`. Use `login` and `requireServiceRoleKey` from `pmo-portal/e2e/helpers.ts` and the local service-client fixture pattern in `e2e/AC-DEL-022-milestone-journey.spec.ts`. Require the local fixture dependency explicitly (throw if unavailable; never silently skip this owning journey). No new environment-key name or client credential appears in this plan. Create unique project, adopted USD100/outstanding25 invoice and revenue external ref as service; no budget, no singleton ownership toggle. Log in Finance → Revenue by Project → Unassigned Assign project → filtered invoice list → choose its invoice row → select project → Save → project Overview. Assert persisted DB link, assigned row absent from filtered list, visible USD100/75/25, No budget, reload same goal. Spy for adapter commands to assert **none**, but never intercept the assignment RPC/read-model responses. Cleanup history/ref/invoice/project in reverse FK order in `afterEach` even on failure. Verify `scripts/e2e-local.sh --reset AC-PFIN-016`.

**GREEN:** fix only actual wiring in the named page/modal/hook/repository/RPC paths when this cross-stack test exposes a mismatch; expected goal is fixed by the spec, not adjusted to current app state. No real ERP is required for PMO-only attribution.

### Task 44 (4 min) — Narrow-screen deterministic oracle; AC-PFIN-015

**RED:** in the same owning section RTL suite verify long project/currency strings remain semantic fields; add auxiliary Playwright `test('AC-PFIN-015 support: project finance mobile layout')` in the same self-isolated e2e file, 390px viewport, rich local synthetic fixture, call `waitForFonts(page)` from `e2e/helpers.ts` before measuring, assert `scrollWidth <= clientWidth`, settlement copy visible, modal keyboard-operable. AC-PFIN-015 ownership remains RTL; this is a support oracle, not another cross-stack business journey. Verify `scripts/e2e-local.sh AC-PFIN-016-project-finances`.

**GREEN:** section `min-w-0 break-words`, responsive grids, table overflow wrapper and numeric text wrapping preserve current DESIGN tokens; modal shared primitive handles mobile bottom sheet. No CSS global/token changes. Capture portfolio Discover on rich seed, graduate findings to tests and `docs/decisions.md` plus the owning route/oracle cell in `docs/qa-portfolio.md`; review does not replace deterministic money/a11y/layout assertions.

### Task 45 (4 min) — Query-plan and compatibility evidence; AC-PFIN-011/018

**RED:** read fixture extends to >1000 synthetic submitted invoices (use `generate_series`), known exact sum; RPC remains complete, no truncated PostgREST response. Add two generation cases with latest generation in another project: never mix old target rows. V-COMPAT.

**GREEN:** capture `EXPLAIN (ANALYZE,BUFFERS)` for the equivalent invoice org/project and snapshot-generation/category selects using synthetic fixtures in `docs/verification/1008-project-finances.md`. Required properties: project-scoped invoice selection, no per-invoice subquery/HTTP fetch, one generation, all mapped accounts. Indexes are SQL A; don't add speculative denormalization/caches. Run existing invoice-history test and record-history inventory in the final targeted pgTAP set. Note output evidence only (no real client rows). V-COMPAT.

### Task 46 (3 min) — Edge/test binding and changed code coverage; AC-PFIN-001/004/009/015

**RED:** inspect actual coverage report and fail if changed-code lines <80%; prove edge binding guard sees new test imports. **GREEN:** tests assert branch behavior from tasks above rather than copied logic; use targeted coverage:

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/projectFinances.test.ts src/lib/db/projectFinances.test.ts src/hooks/useRevenue.assignProject.test.tsx src/hooks/useProjectFinances.test.tsx pages/__tests__/SalesInvoices.assignProject.test.tsx pages/project-detail/ProjectFinancesSection.test.tsx --coverage'
node scripts/check-edge-fn-test-binding.mjs
(cd supabase/functions/erpnext-sweep && deno test --allow-env --allow-net projectInvoiceAttribution.test.ts projectInvoiceBackfill.test.ts)
(cd supabase/functions/adapter-dispatch && deno test --allow-env --allow-net readModelWriters.test.ts)
```

Record the actual failed/passed assertion names and coverage output in `docs/verification/1008-project-finances.md`. No statement that runtime tests passed merely because the docs plan exists. Three reviewers (spec/quality/security) remain required; they reuse builder evidence and rerun only doubted targeted checks.

### Task 47 (5 min) — Mutation proof of the assign RPC role check; AC-PFIN-007

Write/verify denied-role pgTAP cases first (Task 04); normal V-ASSIGN must be GREEN. Mutate **only** the marked assignment-role predicate in migration 0287, leaving org/membership/row checks intact. In an isolated build worktree, run this exact experiment from root (never commit mutant):

```bash
python3 - <<'PY'
from pathlib import Path
p=Path('supabase/migrations/0287_project_finances.sql')
s=p.read_text()
needle="-- PFIN_ASSIGN_ROLE_CHECK: mutation target; keep this exact marker and predicate.\n  if v_role is null or v_role not in ('Admin','Finance') then"
assert s.count(needle)==1
backup=Path('/tmp/1008-project-finances-role-check.sql')
assert not backup.exists(), 'preserve an existing backup; do not overwrite'
backup.write_text(s)
p.write_text(s.replace(needle,"-- PFIN_ASSIGN_ROLE_CHECK: mutation target; keep this exact marker and predicate.\n  if false then"))
PY
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0287_assign_invoice_project.test.sql'
```

**Require RED for Executive, PM and Engineer assignment assertions**, not an unrelated reset/parser failure. Read pgTAP body; command exit alone is not proof. Restore immediately, including on exception/interruption:

```bash
python3 - <<'PY'
from pathlib import Path
p=Path('supabase/migrations/0287_project_finances.sql')
backup=Path('/tmp/1008-project-finances-role-check.sql')
assert backup.exists()
p.write_text(backup.read_text())
backup.unlink()
PY
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0287_assign_invoice_project.test.sql'
git diff --check
```

Restored result must be GREEN. Record specific mutant failures/restored passes; any mutant remaining in diff is a hard stop. No `--no-verify`, skip, weakened test or commit while red.

### Task 48 (5 min) — Local final gate (CLAUDE.md), then traceability acceptance

This is the plan's final execution task. Follow **CLAUDE.md “Local final gate”**, not a local full-suite repeat. Before `--changed`, stage only the issue-owned new source/test paths explicitly named above so Git-based changed-test discovery includes them (never `git add -A`; staging is not a commit). The lint inventory below includes untracked files too. After final edits and restored mutation, run from root:

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck'
{ git diff --name-only -z origin/dev -- pmo-portal; git ls-files --others --exclude-standard -z -- pmo-portal; } | \
  python3 -c 'import sys,subprocess; from pathlib import Path; paths=sorted({p.removeprefix("pmo-portal/") for p in sys.stdin.buffer.read().decode().split("\0") if p.endswith((".ts",".tsx",".js",".jsx",".mjs")) and Path(p).is_file()}); sys.exit(subprocess.call(["npx","eslint","--max-warnings=0",*paths],cwd="pmo-portal") if paths else 0)'
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run --changed origin/dev'
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0287_assign_invoice_project.test.sql supabase/tests/0287_project_invoice_backfill.test.sql supabase/tests/0287_project_finances_reads.test.sql supabase/tests/0287_project_finances_rollback.test.sql supabase/tests/0278_invoice_change_history.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/record_changes_catalog_gate.test.sql supabase/tests/budget_projection_rpc.test.sql supabase/tests/bfy_projection_null_lines.test.sql supabase/tests/bfy_projection_refused_push.test.sql supabase/tests/bfy_map_edit_reinterprets_history.test.sql supabase/tests/erp_snapshot_generation_honesty.test.sql'
scripts/e2e-local.sh --reset AC-PFIN-016-project-finances
node scripts/check-edge-fn-test-binding.mjs
scripts/check-e2e-isolation.sh
git diff --check
```

The migration/reset/touched-pgTAP hold is atomic; e2e's `--reset` owns its own reset+journey hold, preventing schema contamination. The scoped search of `pmo-portal/e2e` for `project-invoicing-summary`, `project-invoiced-basis`, and `Remaining to invoice` returned no existing journey; do not invent one to rerun. Existing contract comparison is proved by `pages/project-detail` unit tests plus AC-PFIN-020's SQL test. The touched e2e file is the exact AC-PFIN-016 file listed above. No unrelated full suite on the shared Mac. CI's full verify/pgtap or verify/integration decides merge. Reviewers read evidence; no outer reverify chain. No push, PR, merge or deploy authorized by this planning dispatch.

## 6. Final traceability table

Each criterion has **one owning layer**; support tests listed in tasks do not replace canonical proof. Every owning test title/pgTAP description starts with its AC ID. No product question remains open; owner spec sign-off is the only pre-build approval outstanding.

| AC-PFIN | Owning layer and exact canonical file | Tasks covering the behavior |
|---|---|---|
| 001 | Deno `supabase/functions/erpnext-sweep/projectInvoiceAttribution.test.ts` | 01,02,03,08,09,46 |
| 002 | Deno `supabase/functions/erpnext-sweep/projectInvoiceAttribution.test.ts` | 01,08,09 |
| 003 | Deno `supabase/functions/erpnext-sweep/projectInvoiceAttribution.test.ts` | 02,07,10,11 |
| 004 | Deno `supabase/functions/erpnext-sweep/projectInvoiceBackfill.test.ts` | 07,12,13,14,46 |
| 005 | pgTAP `supabase/tests/0287_project_finances_reads.test.sql` | 15 |
| 006 | pgTAP `supabase/tests/0287_assign_invoice_project.test.sql` | 04,05,24 |
| 007 | pgTAP `supabase/tests/0287_assign_invoice_project.test.sql` | 03,04,05,23,47 |
| 008 | pgTAP `supabase/tests/0287_assign_invoice_project.test.sql` | 06,24 |
| 009 | RTL `pmo-portal/pages/__tests__/SalesInvoices.assignProject.test.tsx` | 33,34,35,36,37,42,46 |
| 010 | RTL `pmo-portal/src/hooks/useRevenue.assignProject.test.tsx` | 25,29,31 |
| 011 | pgTAP `supabase/tests/0287_project_finances_reads.test.sql` | 16,45 |
| 012 | pgTAP `supabase/tests/0287_project_finances_reads.test.sql` | 20 |
| 013 | Vitest `pmo-portal/src/lib/projectFinances.test.ts` | 26,27,30,40 |
| 014 | pgTAP `supabase/tests/0287_project_finances_reads.test.sql` | 21,23,25,29 |
| 015 | RTL `pmo-portal/pages/project-detail/ProjectFinancesSection.test.tsx` — `AC-PFIN-015 renders the finance section from translated English and Indonesian catalogues without raw keys`; loading, error/retry, empty, exact-money, and narrow semantic-field cases are additional support oracles in this owning suite | 27,28,38,39,40,42,44,46 |
| 016 | E2E `pmo-portal/e2e/AC-PFIN-016-project-finances.spec.ts` — `AC-PFIN-016: Finance assigns an adopted invoice to a project — attribution persists, the section reads USD 100/75/25, no budget, and no ERP command is dispatched` | 43 |
| 017 | pgTAP `supabase/tests/0287_project_finances_reads.test.sql` | 18,39 |
| 018 | pgTAP `supabase/tests/0287_project_finances_reads.test.sql` | 17,19,45 |
| 019 | RTL `pmo-portal/pages/project-detail/ProjectFinancesSection.test.tsx` | 32,41 |
| 020 | pgTAP `supabase/tests/0287_project_finances_reads.test.sql` | 22,41 |

Task 48 is the final gate for **all 20 criteria**; it records evidence, not new behavior. The Director accepts only a green owning-test matrix, restored mutation proof, ≥80% changed-line coverage, three reviews and UI Discover graduation evidence. This document is a plan, not a report that those runtime checks have already passed.
