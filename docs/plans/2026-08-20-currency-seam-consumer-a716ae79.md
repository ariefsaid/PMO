# FR-L10N-020..023 — make the currency column a seam instead of a column with no consumer

**Spec:** `docs/specs/i18n-framework.spec.md` §0.3, §2 (FR-L10N-020..023), §5 (AC-L10N-020..022), §7 traps
**Worktree:** `.claude/worktrees/i18n-currency-consumer` (branch off `dev`, PR to `dev`)
**ADW session:** `a716ae79`
**No migration. No schema change. No new dependency. No ESLint change. No locale work.**

---

## 0. The defect, and what "done" means

`0187` shipped `organizations.default_currency` (NOT NULL, ISO-4217 CHECK, default `'USD'`) and a
NOT NULL `currency` column on **12 money tables**, trigger-stamped from the org. **Not one line of
frontend code reads any of it.** `formatCurrency(value: number)` takes no currency argument; USD is
welded into `src/lib/format.ts` (`:5` `currencyFormatter`, `:87-99` the hand-tiered `$…K/M` compact,
`:105` cents, `:121` auto, `:133` fine). An IDR invoice renders as dollars. `OD-CR-5`'s rule —
*formatting keyed off the record's currency* — is unmet.

**Done =** every money formatter takes the record's currency as a **required** second argument,
every call site passes it from the right source, `formatCompactCurrency` stops welding `$`/`K`/`M`,
platform AI billing figures stay explicitly USD, and the whole verify gate is green.

## 1. Ground truth (verified against this tree — do not re-derive)

1. **The data is already there and already typed.** All 12 money tables + `organizations` carry
   `currency` in `src/lib/supabase/database.types.ts` (verified per table). Row types derive from
   generated types (`ProjectRow = Tables<'projects'>` in `src/lib/db/projects.ts:26`;
   `ProcurementRow` likewise), so **`row.currency` is already typed** on every table-backed row.
2. **Every DAL select is `'*'` EXCEPT ONE** (`projects.ts:47`, `procurements.ts:14`,
   `procurementLifecycle.ts:164` `DETAIL_SELECT`, `budgets.ts:85`, `revenue.ts:93` are all `'*'`),
   so those rows **already return** `currency` at runtime. The one exception: `getRevenueByProject`
   (`src/lib/db/revenue.ts`) is a **keyset scan with an explicit column list**
   (`'id, project_id, amount, erp_outstanding_amount'`) — it needs `currency` added (Task 16).
   Hand-written flat row interfaces hiding the field (`SalesInvoiceRow`, `IncomingPaymentRow` in
   `revenue.ts`) get the field added to the interface only; nothing more.
3. **Child line tables deliberately have NO currency** (0187: `procurement_items`,
   `budget_line_items`) — currency belongs to the parent document. Line-item surfaces thread the
   parent's currency. Do NOT "fix" this.
4. **`Intl` throws** on `undefined`/`null` currency (`TypeError: Currency code is required`). This
   is our friend: a call site that forgets the argument fails loudly at first render, and
   `npm run typecheck` catches every omission statically (vitest does not typecheck).
5. **USD output is byte-identical under the redesign** (verified by running Node):
   `Intl.NumberFormat('en-US',{style:'currency',currency,notation:'compact',maximumFractionDigits:1})`
   with a `<1000` fall-through reproduces every current compact output including the C4 boundary
   (`999_949 → $999.9K`, `999_950 → $1.0M`) and negatives (`-$2.5M` — Intl places the sign
   natively). **No visual snapshot re-baselining.** IDR renders as `IDR 1,234` / `IDR 2.5M`.
6. **The seed org is USD** (`supabase/seed.sql` never sets `default_currency`; 0187's column
   default `'USD'` applies). So every e2e assertion of `$…` text stays green — **no e2e edits**.
7. The ESLint `no-restricted-syntax` guard (`eslint.config.js:86-98`) is **untouched** — this slice
   neither weakens nor extends it (extending it to locale literals inside `format.ts` is
   FR-L10N-013, the locale slice). If lint blocks you, the answer is in `format.ts`.
8. `src/lib/export/**` calls no money formatter (verified) — FR-L10N-050 stays intact. Touch nothing there.
9. `pages/AdministrationCredits.tsx` renders the credit balance as a plain number
   (`formatNumberMax2`) — **no money formatter → no change**. Do not "improve" it into currency.

## 2. Design decisions

**D1 — Required `currency: string` second arg on all five money formatters (FR-L10N-020).**
Never optional, never defaulted — a default is the global constant OD-CR-5 banned. Typecheck is
the enforcement net that finds all ~182 call sites.

**D2 — Per-`(shape, currency)` memoized formatter cache** replacing the four module-level
`Intl.NumberFormat` singletons (they cannot take a runtime currency). The cache key is
`shape|currency`; when the locale slice lands (FR-L10N-011) it gains the locale component. The
`'en-US'` locale literal stays for this slice — locale is explicitly out of scope here.

**D3 — `formatCompactCurrency` via `notation:'compact'`** (FR-L10N-022): no welded `$`, no
hardcoded `K`/`M` — Intl supplies the compact unit (id-ID will render "jt" when locale lands).
`Math.abs(value) < 1_000` falls through to `formatCurrency` (preserves `$500`, `$0`, `-$500`
exactly; compact would render `$500.0`). Byte-identical for USD (§1.5).

**D4 — `PLATFORM_CURRENCY = 'USD'`** exported from `format.ts` (FR-L10N-023). Platform AI billing
(`agent_usage.cost`/`provider_cost_usd`, the two admin surfaces) passes it explicitly — never the
org currency. `AC-L10N-021`'s oracle pins it.

**D5 — Org default currency for rowless figures.** RPC aggregates (`get_executive_dashboard`,
`get_win_rate`, `get_sales_pipeline` stages, `get_revenue_by_project`, `get_projects_delivery`
summaries) and cross-record sums have no record to read — those figures ARE org-denominated (v1 is
single-currency per org, OD-CR-5). New: `src/lib/db/orgs.ts` `getOrgDefaultCurrency()` +
`src/hooks/useOrgCurrency.ts` returning a plain `string` (placeholder `'USD'` while loading — the
same default posture 0187 gave the column; matches the pattern of `useOrgFeatures.ts`).
Row-backed surfaces must NOT use it; platform billing must NOT use it (comment says so).

**D6 — ERP aging snapshot rows** keep their own `currency: string | null`
(`src/lib/db/erpSnapshots.ts:31,63` — the ERP doc's currency): render
`r.currency ?? useOrgCurrency()`. Do not stamp org currency over ERP's.

**D7 — Presentational leaf components take a `currency: string` prop** (ProjectCard, BvACard,
WinRateCard, ProjectedMarginBars, DecisionSupportPanel, LineItemsSection); container pages/
sections call `useOrgCurrency()` themselves. Rationale: leaf components already take numbers as
props — threading one more keeps them pure and keeps their tests free of a hook mock.

**D8 — `LedgerRow` gains `currency: string`**, populated by `buildLedgerRows` from each source
record's own currency field (PR/RFQ/Quote/PO/Invoice/Payment rows all carry one via the `*`
embeds). Per-record honest, no parent threading needed.

**D9 — No ADR.** Everything here implements rulings already recorded (OD-CR-5, 0187's header,
the spec). The spec + this plan are the record.

## 3. Currency-source decision table (every non-test call site)

Legend: **record** = pass the row's own `currency`; **org** = `useOrgCurrency()`; **platform** =
`PLATFORM_CURRENCY`; **parent** = thread the parent document's currency (prop).

| # | File | Call sites (approx lines) | Source | Mechanism |
|---|------|---------------------------|--------|-----------|
| 1 | `pages/AdministrationUsage.tsx` | 91, 96, 98 (`provider_cost_usd`, `cost`, `margin_usd`) | **platform** | `formatCurrencyFine(x, PLATFORM_CURRENCY)` |
| 2 | `src/components/admin/AgentCostMetrics.tsx` | 94, 98 | **platform** | same |
| 3 | `pages/ExecutiveDashboard.tsx` | 224, 228×2, 252, 258×2 | **org** | `const orgCurrency = useOrgCurrency()` |
| 4 | `src/components/dashboard/WinRateCard.tsx` | 78 | **org via prop** | add `currency: string` prop; thread from ExecutiveDashboard |
| 5 | `src/components/dashboard/BvACard.tsx` | 54 | **org via prop** | same (thread from ExecutiveDashboard :122) |
| 6 | `src/components/dashboard/ProjectedMarginBars.tsx` | 64, 76 | **org via prop** | same (thread from ExecutiveDashboard :157) |
| 7 | `src/components/dashboard/FinanceDashboard.tsx` | 97, 157, 164, 255, 262, 304, 310, 317, 321 | **org** | `useOrgCurrency()` (BudgetReviewRow + aggregates) |
| 8 | `src/components/dashboard/MobileExecutiveDashboard.tsx` | 142, 149, 235, 249 | **org** | `useOrgCurrency()` |
| 9 | `src/components/dashboard/PMDashboard.tsx` | 67 | **org** | `useOrgCurrency()` (TopProject is RPC-shaped) |
| 10 | `src/components/dashboard/AccountingSnapshotsSection.tsx` | 49, 55, 61, 67, 73, 79 (aging table) | **record ?? org** | `r.currency ?? orgCurrency` (D6; `ErpAgingSnapshotRow.currency: string \| null`) |
| 10b | `src/components/dashboard/AccountingSnapshotsSection.tsx` | 103 (actuals `net`) | **org** ⚑ | `orgCurrency` — `ErpActualsSnapshotRow` has **no** currency field (verified: `src/lib/db/erpSnapshots.ts` ActualsDb + mig 0150), so `r.currency` is a typecheck error there; use org currency |
| 11 | `pages/Projects.tsx` | 373, 387 | **record** | `p.currency` |
| 12 | `pages/Projects.tsx` | 430 (×2: committedSpend + budget) | **org** | delivery-summary aggregate |
| 13 | `pages/RevenueByProject.tsx` | 93, 104 (per-project rows) | **record** ⚑ | add `currency` to `getRevenueByProject`'s keyset select + per-project agg map + return type → `row.currency` |
| 13b | `pages/RevenueByProject.tsx` | 139, 147 (cross-project KPI totals) | **org** | `useOrgCurrency()` — a cross-project sum is org-denominated (v1 orgs are single-currency, OD-CR-5) |
| 14 | `pages/SalesPipeline.tsx` | 150, 151, 199, 207, 378 | **org** | PipelineProject/stage rows are RPC-shaped |
| 15 | `components/SalesKanbanBoard.tsx` | 49, 52, 66, 67 | **org** | `useOrgCurrency()` inside the board |
| 16 | `pages/project-detail/PipelineLens.tsx` | 159, 161, 254 | **org** | pipeline projects |
| 17 | `components/ProcurementBoard.tsx` | 43 | **record** | `pr.currency` |
| 18 | `components/ProcurementBoard.tsx` | 94 (stage Σ) | **org** | cross-record sum |
| 19 | `src/components/import/procurementCycle/ProcurementCycleImportWizard.tsx` | 473 | **org** | ERP company currency is pinned == org currency (DD-OPS-3) |
| 20 | `pages/SalesInvoices.tsx` | 177, 188 | **record** | `inv.currency` — CONFIRMED hand-written interface: add `currency: string;` to `SalesInvoiceRow` (`src/lib/db/revenue.ts:7-19`, mapped via `toSalesInvoiceRow`'s `...row` spread from the `*` select, so only the type needs the field) |
| 21 | `pages/IncomingPayments.tsx` | 82 (`inv` sales-invoice), 188 (`p`) | **record** | `inv.currency` / `p.currency` — CONFIRMED: add `currency: string;` to `IncomingPaymentRow` (`src/lib/db/revenue.ts:38-50`) the same way |
| 22 | `pages/BudgetProjection.tsx` | 119 (`money(v,…)` helper), 658 (`row.pmoEtc`) | **org** ⚑ | RPC-shaped: `get_budget_projection` (mig 0149, verified) returns per-category aggregates with **no** `currency` column, and `row` is the mapped `BudgetProjectionCellRow`, not a `budget_projections` row — so `useOrgCurrency()` (fold into the local `money()` helper); do NOT reach for `row.currency` and do NOT modify the RPC |
| 23 | `pages/ProjectBudget.tsx` | 278, 326, 329, 439, 498, 592, 595, 603, 854, 944 | **record (parent version)** | the `BudgetVersionWithItems` in scope (`version.currency` / `selected.currency` / the active version for totals); line items are children (D3/§1.3) |
| 24 | `pages/Procurement.tsx` | 235 | **record** | `r.currency` |
| 25 | `pages/ProcurementDetails.tsx` | 447, 607 | **record** | `p.currency` |
| 26 | `pages/ProcurementDetails.tsx` | 616 | **record** | `selectedQuote.currency` (the quote's OWN currency — verified `procurement_quotations.currency`) |
| 26b | `pages/ProcurementDetails.tsx` | 633 (PO-committed tile) | **record** | value is `po.amount ?? p.total_value` (verified) → `po?.currency ?? p.currency` (purchase_orders carries its own currency; falls back to the PR's when no PO amount) |
| 27 | `pages/procurement/VendorQuotesTab.tsx` | 295, 360 | **record** | `q.currency` |
| 28 | `pages/procurement/LineItemsSection.tsx` | 252, 276, 278, 350, 376 | **parent** | add `currency: string` prop; render sites pass the procurement's currency |
| 29 | `src/lib/db/procurementLedger.ts` | `LedgerRow` + `buildLedgerRows` | **record** | new `currency` field per source record (D8) |
| 30 | `pages/procurement/ProcurementLedger.tsx` | 120 | **record** | `row.currency` (from #29) |
| 31 | `pages/procurement/ProcurementListRow.tsx` | 95, 97 (item rate/total), 192 | **parent/record** | :95/:97 the detail row is already in scope — `detail.data.currency`; :192 `row.currency` |
| 32 | `pages/procurement/DecisionSupportPanel.tsx` | 158, 161, 166, 169, 172, 201, 217 | **parent** | add `currency: string` prop; `ProcurementOverviewTab` passes `p.currency` |
| 33 | `pages/Approvals.tsx` | 99 | **record** | `row.currency` — verified `row` is `ProcurementWithRefs` from `useProcurements` (NOT purchase_requests) |
| 34 | `pages/approvals/ProcurementApprovalRow.tsx` | 141, 245, 275, 301, 201, 203 (items) | **record** | `row.currency` for the doc figures AND the item figures |
| 35 | `components/ProjectKanbanBoard.tsx` | 126 | **record** | `project.currency` |
| 36 | `components/ProjectCard.tsx` | 47, 51, 55, 80 | **parent** | add `currency: string` prop; `Projects.tsx` passes `p.currency` |
| 37 | `pages/project-detail/ProjectDetailHeader.tsx` | 61, 62, 163, 164, 170, 221, 355, 445, 446, 448 | **record** | `project.currency` (incl. pendingValue/taxAmount drafts — they edit THIS project) |
| 38 | `pages/project-detail/tabs/OverviewTab.tsx` | 32, 33, 78, 79, 81, 130, 164, 165, 229, 258, 304, 308, 318 | **record** | `project.currency` (the project row is in scope; budget snapshot figures belong to this project) |
| 39 | `pages/project-detail/tabs/OverviewTab.tsx` | 338 `formatValue={formatCurrency}` | **record** | `formatValue={(v) => formatCurrency(v, project.currency)}` (bare reference no longer type-matches) |
| 40 | `pages/project-detail/tabs/ProcurementTab.tsx` | 77 | **record** | `r.currency` |

~182 call expressions across 36 files. **The sweep rule:** a call site passes the record's own
`currency` when the figure comes from one row; the org currency when the figure is an aggregate or
RPC-shaped; `PLATFORM_CURRENCY` for the two platform-billing surfaces; the parent document's
currency for child line items.

## 4. Test-impact rules (read before touching any test)

The brief: tests asserting `$…` go red **and that is the point** — update them to assert the
record's currency. Concretely, with the seed org USD, rendered `$…` strings are **unchanged**; the
red set is exactly:

- **R1 — direct formatter calls** (`src/lib/format.test.ts`, `format.c4minors.test.ts`,
  `format.compactNegative.test.ts`): add `'USD'` to every existing call (expectations unchanged);
  add the new currency-differentiator cases (§ Task 1).
- **R2 — fixtures missing `currency`** (typecheck error where the fixture is a typed literal, or a
  runtime `TypeError: Currency code is required` where a cast bypassed it): add `currency: 'USD'`
  to the fixture. **Assertions stay `$…`** — they were correct for a USD record and remain so.
- **R3 — components that now call `useOrgCurrency()`**: add the one-line mock to the test file:
  `vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));`
- **R4 — leaf components with a new `currency` prop**: add `currency="USD"` (or the fixture record's
  currency) to every render call in tests.
- **R5 — a red assertion with correct USD fixtures is a REAL DEFECT** (e.g. a mixed-currency sum,
  or a row that genuinely renders the wrong currency). Stop and investigate. **Never** weaken,
  skip, or delete a test to go green; never change a formatter to keep an old assertion green.

Discovery is mechanical, not manual: `npm run typecheck` lists every R1/R2/R4 site; `npm test`
lists every R2-runtime/R3 red. **Count the test files and cases you touch and report the numbers**
(the spec measured 56 unit files / 9 e2e specs matching `$` patterns; e2e needs zero edits here).

**Measured sizing (final recon — worst case ~33 unit files, likely fewer):**
- **3 format files** (16 `it`s / ~30 call expressions) — R1.
- **8 Tier-A files call formatters DIRECTLY** (red at typecheck AND runtime):
  `components/SalesKanbanBoard.test.tsx`, `pages/SalesPipeline.test.tsx`,
  `src/components/dashboard/{FinanceDashboard,BvACard,ProjectedMarginBars}.test.tsx`,
  `src/components/dashboard/__tests__/ProjectedMarginBars.d1.test.tsx`,
  `pages/ExecutiveDashboard.test.tsx`, `pages/project-detail/__tests__/PipelineLens.markwon.test.tsx`.
- **~22 Tier-B fixture files** need `currency: 'USD'` added (largest: ProcurementDetails 1246 ln,
  BudgetProjection 1115 ln, ImportWizard 536 ln, ProjectBudget 712 ln, Projects 471 ln).
- **Already carry `currency:'USD'` in fixtures — expect NO red, do not churn them**:
  `pages/__tests__/VendorQuotesTab.test.tsx` (its `makeQuote` factory is the copy-pattern for new
  fixtures), `src/components/dashboard/AccountingSnapshotsSection.test.tsx`, `components/procurement.test.ts`.
- **Absence-asserting files may never call the formatter** (assert NOT `/$0 of $0/` etc.) — green
  before and after is correct, not suspicious: `OverviewTab.budgetUtil`, `PMDashboard.kpiError`,
  `Administration.usage.providerCost` (null-cost renders `—`).
- **e2e**: 9 files match `$[0-9KL]`; only ~6 assert formatted output (AC-701, AC-PRJ-001,
  AC-PROC-001, AC-IXD-WP-002, AC-732 serial, AC-1117 symbol-only); AC-AXP-011/AC-ATC-017 assert
  mock-data literals; one is comment-only. All stay green — zero e2e edits.

Known-large test files (from scan; not exhaustive — trust the reds):
`pages/ExecutiveDashboard.test.tsx`, `pages/__tests__/ExecutiveDashboard.honesty.test.tsx`,
`src/components/dashboard/{FinanceDashboard,PMDashboard,BvACard,ProjectedMarginBars,AccountingSnapshotsSection,StatusBarChart}.test.tsx`
(+ `__tests__/FinanceDashboard.w5b`, `__tests__/PMDashboard.kpiError`, `__tests__/ProjectedMarginBars.d1`),
`components/{ProjectCard,ProjectKanbanBoard,SalesKanbanBoard}.test.tsx`,
`pages/Projects.test.tsx` (+ `__tests__/Projects.atrisk`, `__tests__/Projects.deliveryBudget`),
`pages/SalesPipeline.test.tsx` (+ `attentionSignals`), `pages/project-detail/__tests__/{OverviewTab,OverviewTab.budgetUtil,ProjectDetail,ProjectDetailHeader,PipelineLens.markwon}.test.tsx`
(+ `tabs/__tests__/OverviewTab.budgetBasis`), `pages/ProjectBudget.test.tsx` (+ `wave6`),
`pages/BudgetProjection.test.tsx`, `pages/ProcurementDetails.test.tsx` (+ 4 `__tests__` variants),
`pages/Approvals.test.tsx`, `pages/procurement/{DecisionSupportPanel,LineItemsSection,ProcurementOverviewTab,ProcurementLedger}.test.tsx`,
`pages/__tests__/{VendorQuotesTab,SalesInvoices.createForm,RevenueByProject.honesty,wave5-prc,Administration.usage.providerCost}.test.tsx`,
`components/procurement.test.ts`, `src/components/import/__tests__/ProcurementCycleImportWizard.test.tsx`,
`src/lib/db/{procurementLifecycle,procurementHistory}.test.ts`,
`src/lib/{budget-snapshot,procurement-summary}.test.ts` (+ `__tests__/budget-snapshot.varianceSign`),
`src/lib/budget/budgetProjection.test.ts`, `src/lib/repositories/budgetProjection.test.ts`,
`src/hooks/useBudget.test.ts`, `components/procurement.test.ts`.

## 5. Tasks

> Verify commands run from `pmo-portal/`. Every task ends green before the next starts.
> Targeted runs are the inner loop; **Task 22 is the mandatory full gate.**

### Wave A — the seam (TDD: red → green)

**Task 1 — Failing formatter tests (AC-L10N-020, AC-L10N-022).**
File `src/lib/format.test.ts`. Add a new `describe('FR-L10N-020..023: currency-aware money formatters', …)`:

```ts
describe('FR-L10N-020..023: currency-aware money formatters', () => {
  it('AC-L10N-020: formatCurrency keys the symbol off the record currency — IDR renders "IDR 1,234"', () => {
    expect(formatCurrency(1234, 'IDR')).toBe('IDR 1,234');
  });
  it('AC-L10N-020: USD output is byte-identical to the pre-seam renderer', () => {
    expect(formatCurrency(5000000, 'USD')).toBe('$5,000,000');
    expect(formatCurrency(1234.56, 'USD')).toBe('$1,235');
  });
  it('AC-L10N-020: formatCurrencyCents/Auto/Fine take the record currency', () => {
    expect(formatCurrencyCents(1234.5, 'EUR')).toBe('€1,234.50');
    expect(formatCurrencyAuto(1234.5, 'EUR')).toBe('€1,234.5');
    expect(formatCurrencyFine(0.0123, 'IDR')).toBe('IDR 0.0123');
  });
  it('AC-L10N-022: formatCompactCurrency has no welded $ or K/M — currency + Intl compact unit', () => {
    expect(formatCompactCurrency(2500000, 'IDR')).toBe('IDR 2.5M');   // en-US locale ⇒ "M" tier; the $ is gone and the symbol follows the record
    expect(formatCompactCurrency(1500, 'EUR')).toBe('€1.5K');
  });
  it('AC-L10N-021 (format layer): PLATFORM_CURRENCY is exported and is USD', () => {
    expect(PLATFORM_CURRENCY).toBe('USD');
  });
});
```

Update the EXISTING money tests in this file to pass `'USD'` (expectations unchanged — they were
correct for USD). Also update `format.c4minors.test.ts` + `format.compactNegative.test.ts` calls
to two-arg `'USD'` form (all expectations byte-identical) and add to c4minors:
`expect(formatCompactCurrency(2500000, 'IDR')).toBe('IDR 2.5M');`
Verify RED (the IDR/EUR cases fail against old code):
`npx vitest run src/lib/format.test.ts src/lib/__tests__/format.c4minors.test.ts src/lib/__tests__/format.compactNegative.test.ts`

**Task 2 — Implement the seam in `src/lib/format.ts`.**
Replace the four currency singletons (`currencyFormatter` `:4-8`, `currencyCentsFormatter`,
`currencyAutoFormatter`, `currencyFineFormatter`) and the hand-tiered `formatCompactCurrency`
(`:87-99`) with:

```ts
// ── Money (FR-L10N-020..023, OD-CR-5): every formatter takes the RECORD's ISO-4217 currency —
// never a global constant. Locale stays 'en-US' until the locale slice (#468) lands; the cache
// key below already anticipates the (locale, currency, shape) memoization FR-L10N-011 asks for.

/** Platform AI billing is USD — NOT org money; the only callers that may pass it are the
 *  agent-usage cost surfaces (FR-L10N-023, AC-L10N-021). */
export const PLATFORM_CURRENCY = 'USD';

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();
function currencyFormatterFor(
  shape: string,
  currency: string,
  opts: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${shape}|${currency}`;
  let f = currencyFormatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { ...opts, style: 'currency', currency });
    currencyFormatterCache.set(key, f);
  }
  return f;
}

/** Whole-unit money, no fraction digits: "$5,000,000" / "IDR 1,234". */
export function formatCurrency(value: number, currency: string): string {
  return currencyFormatterFor('whole', currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

/** Money — cents-exact ERP amounts (numeric(14,2)): "$1,234.50". */
export function formatCurrencyCents(value: number, currency: string): string {
  return currencyFormatterFor('cents', currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/** Money — default-fraction KPI values: "$1,234" / "$1,234.5" / "$1,234.56" (0–3 dp). */
export function formatCurrencyAuto(value: number, currency: string): string {
  return currencyFormatterFor('auto', currency, { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(value);
}

/** Money — fine-grained agent/provider costs (sub-$1): "$0.0123" (2–4 dp). */
export function formatCurrencyFine(value: number, currency: string): string {
  return currencyFormatterFor('fine', currency, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

/** Compact currency: "$1.5M" / "$200.0K" / "$500" — space-constrained surfaces (FR-L10N-022:
 *  no welded $, no hand-coded K/M tiers — Intl supplies the compact unit, so id-ID renders its
 *  own under the locale slice). Byte-identical to the old hand-tiered output for USD, incl. the
 *  C4 999_950→$1.0M roll and negative compaction (Intl places the sign: -$2.5M). */
export function formatCompactCurrency(value: number, currency: string): string {
  if (Math.abs(value) < 1_000) return formatCurrency(value, currency);
  return currencyFormatterFor('compact', currency, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
```

Keep `parseMoneyInput`, `pct`, all date formatters, `formatNumber*` untouched. Also export
`PLATFORM_CURRENCY` in the test import line. Do NOT touch the `#477` header comment block above the
date section beyond what the replaced block covered.
Verify GREEN: same command as Task 1. Then `npm run typecheck` — expect a wall of missing-arg
errors at every call site (that is the Task-8+ worklist; it must not be silenced).

### Wave B — plumbing

**Task 3 — `src/lib/db/orgs.ts` (new) + test.**
Write the failing test `src/lib/db/orgs.test.ts` first (mock `@/src/lib/supabase/client` the way
`src/lib/db/companies.test.ts` does; assert `.from('organizations').select('default_currency')`
path resolves the value and throws on error). Then:

```ts
import { supabase } from '@/src/lib/supabase/client';

/**
 * The org's single operating currency (OD-CR-5 / migration 0187): ISO-4217 alpha-3, stamped onto
 * every money row by the `stamp_currency` trigger. Read here ONLY for figures with no money row of
 * their own (RPC aggregates, pipeline stages, cross-record sums) — those figures are
 * org-denominated. organizations carries a SELECT policy scoped to the caller's own org, so this
 * returns exactly one row under RLS. org_id is NEVER sent (ADR-0017).
 */
export async function getOrgDefaultCurrency(): Promise<string> {
  const { data, error } = await supabase.from('organizations').select('default_currency').limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.default_currency ?? 'USD';
}
```

Verify: `npx vitest run src/lib/db/orgs.test.ts`.

**Task 4 — `src/hooks/useOrgCurrency.ts` (new) + test.**
Test first (`src/hooks/useOrgCurrency.test.ts`): mock `useAuth` (currentUser with org_id) and the
DAL; renderHook with a QueryClientProvider wrapper — assert it returns the DAL value, `'USD'`
while pending, and is disabled without a user. Then:

```ts
import { useQuery } from '@tanstack/react-query';
import { getOrgDefaultCurrency } from '@/src/lib/db/orgs';
import { useAuth } from '@/src/auth/useAuth';

/**
 * The caller's org operating currency, for figures with no money row of their own (dashboard
 * aggregates, pipeline stages, board column sums). Returns 'USD' until the org row resolves —
 * the same default posture 0187 gave the column itself. Row-backed surfaces must NOT use this:
 * pass the record's `currency` (FR-L10N-020). Platform AI billing must NOT use this:
 * PLATFORM_CURRENCY (FR-L10N-023). staleTime Infinity — the org currency changes only by
 * operator action.
 */
export function useOrgCurrency(): string {
  const { currentUser } = useAuth();
  const { data } = useQuery<string>({
    queryKey: ['org-currency', currentUser?.org_id],
    queryFn: () => getOrgDefaultCurrency(),
    enabled: Boolean(currentUser),
    staleTime: Infinity,
    placeholderData: 'USD',
  });
  return data ?? 'USD';
}
```

Verify: `npx vitest run src/hooks/useOrgCurrency.test.ts`.

### Wave C — platform USD (AC-L10N-021)

**Task 5 — Oracle first: extend `pages/__tests__/Administration.usage.providerCost.test.tsx`.**
Add a case: mock `useOrgCurrency` → `'IDR'` (this file will need the mock module line anyway),
keep the agent_usage fixtures, and assert the provider-cost/cost cells still render `$…` (USD).
Against current code it passes (USD is welded); its binding is proven by Mutation M3 (Task 21).
If the file's fixtures/structure fight this, add the case in a new
`pages/__tests__/Administration.usage.platformCurrency.test.tsx` instead.
Verify: `npx vitest run pages/__tests__/Administration.usage.providerCost.test.tsx`.

**Task 6 — Call sites 1–2 (table rows 1–2): platform USD.**
`pages/AdministrationUsage.tsx` :91,:96,:98 and `src/components/admin/AgentCostMetrics.tsx` :94,:98
→ `formatCurrencyFine(x, PLATFORM_CURRENCY)` (import it). Add/keep the `useOrgCurrency` mock in
their test files (`pages/__tests__/Administration.usage.providerCost.test.tsx`,
`src/components/admin/AgentCostMetrics.test.tsx`) pinned to `'IDR'` where the test asserts costs —
that is the AC-L10N-021 oracle standing guard.
Verify: `npx vitest run pages/__tests__/Administration.usage.providerCost.test.tsx src/components/admin/AgentCostMetrics.test.tsx pages/AdministrationUsage.test.tsx 2>/dev/null || npx vitest run pages/__tests__ src/components/admin`.

### Wave D — call-site sweep, cluster by cluster

Each task: apply the table-§3 edits (mechanical), then fix that cluster's tests per §4 rules
(fixtures get `currency: 'USD'`; `useOrgCurrency` gets the one-line mock; new-prop components get
`currency="USD"` in test renders), then run the cluster's tests. Expectations of `$…` strings do
NOT change (USD seed). If one goes red with correct USD fixtures — R5: stop, investigate, report.

**Task 7 — Ledger plumbing (rows 28–29):** `src/lib/db/procurementLedger.ts`: add
`currency: string` to `LedgerRow` (doc-comment: *the source record's own currency (0187), not the
org's*); populate in `buildLedgerRows` from each source record (`pr.currency`, `rfq.currency`,
`quote.currency`, `po.currency`, `invoice.currency`, `payment.currency` — field names as the
builder reads them). ⚑ GR rows come from `procurement_receipts`, which is **NOT** a 0187 money table
and carries NO currency — stamp the parent procurement's currency there (the builder has `p` in
scope); the cell guards on `amount != null` so GR rows never render a formatted figure anyway.
`pages/procurement/ProcurementLedger.tsx` :120 → `formatCurrency(row.amount, row.currency)`.
Update `src/lib/db/procurementLedger` tests + `ProcurementLedger.test.tsx` fixtures.
Verify: `npx vitest run src/lib/db/procurementLifecycle.test.ts pages/procurement/ProcurementLedger.test.tsx`.

**Task 8 — Executive dashboard cluster (rows 3–6):** `pages/ExecutiveDashboard.tsx`
(`useOrgCurrency()`; pass `currency={orgCurrency}` to WinRateCard/BvACard/ProjectedMarginBars);
add `currency: string` prop to those three components and use it in their formats.
Tests: `pages/ExecutiveDashboard.test.tsx`, `pages/__tests__/ExecutiveDashboard.honesty.test.tsx`,
`src/components/dashboard/{BvACard,ProjectedMarginBars}.test.tsx`,
`src/components/dashboard/__tests__/ProjectedMarginBars.d1.test.tsx` (R3 mock + R4 prop).
Verify: `npx vitest run pages/ExecutiveDashboard.test.tsx pages/__tests__/ExecutiveDashboard.honesty.test.tsx src/components/dashboard`.

**Task 9 — Finance/PM/mobile dashboards (rows 7–10):** `FinanceDashboard.tsx`,
`MobileExecutiveDashboard.tsx`, `PMDashboard.tsx` → `useOrgCurrency()`;
`AccountingSnapshotsSection.tsx` → `const orgCurrency = useOrgCurrency();` then at :49–:79
(aging) `formatCurrency(r.X ?? 0, r.currency ?? orgCurrency)`, and at :103 (actuals, whose row type has
no currency field — verified) `formatCurrency(r.net ?? 0, orgCurrency)`.
Tests: the FinanceDashboard/PMDashboard/AccountingSnapshotsSection/StatusBarChart test files
(+ `__tests__` variants) — R3 mock.
Verify: `npx vitest run src/components/dashboard`.

**Task 10 — Projects list + cards + kanban (rows 11–12, 35–36):** `pages/Projects.tsx`
(`p.currency` at :373/:387; `useOrgCurrency()` for :430's two compact calls);
`components/ProjectCard.tsx` + `currency` prop; `components/ProjectKanbanBoard.tsx` `project.currency`.
Tests: `pages/Projects.test.tsx`, `__tests__/Projects.atrisk`, `__tests__/Projects.deliveryBudget`,
`components/ProjectCard.test.tsx`, `components/ProjectKanbanBoard.test.tsx`.
Verify: `npx vitest run pages/Projects.test.tsx pages/__tests__ components/ProjectCard.test.tsx components/ProjectKanbanBoard.test.tsx`.

**Task 11 — Sales pipeline cluster (rows 13b–16):** `pages/SalesPipeline.tsx`,
`components/SalesKanbanBoard.tsx`, `pages/project-detail/PipelineLens.tsx`,
`pages/RevenueByProject.tsx` :139/:147 → `useOrgCurrency()` (rows :93/:104 are Task 16's record-currency change).
Tests: `pages/SalesPipeline.test.tsx`, `__tests__/SalesPipeline.attentionSignals`,
`components/SalesKanbanBoard.test.tsx`, `__tests__/PipelineLens.markwon`,
`__tests__/RevenueByProject.honesty`.
Verify: `npx vitest run pages/SalesPipeline.test.tsx components/SalesKanbanBoard.test.tsx pages/__tests__ pages/project-detail/__tests__/PipelineLens.markwon.test.tsx`.

**Task 12 — Project detail (rows 37–40):** `ProjectDetailHeader.tsx` + `OverviewTab.tsx`
(`project.currency` everywhere, incl. the :338 `formatValue={(v) => formatCurrency(v, project.currency)}`
wrapper) and `ProcurementTab.tsx` (`r.currency`).
Tests: `project-detail/__tests__/{OverviewTab,OverviewTab.budgetUtil,ProjectDetail,ProjectDetailHeader}.test.tsx`,
`tabs/__tests__/OverviewTab.budgetBasis.test.tsx`, `ProjectDetail.tabs`, `ProjectSCurve` (if red).
Verify: `npx vitest run pages/project-detail`.

**Task 13 — Budget surfaces (rows 22–23):** `pages/BudgetProjection.tsx` (**org currency** — verified: the
page renders `BudgetProjectionCellRow` aggregates from the `get_budget_projection` RPC, which
returns NO currency column (mig 0149), so `const orgCurrency = useOrgCurrency()`, fold it into the
local `money()` helper (`formatCurrency(v, orgCurrency)`) and use it at :658
(`formatCurrency(row.pmoEtc, orgCurrency)`); do NOT modify the RPC or the repository mapper);
`pages/ProjectBudget.tsx` — the `BudgetVersionWithItems` row is already in scope and already
typed: :498/:592/:595/:603 use `version.currency` (inside `VersionCard`), :944 `selected.currency`.
The block :278/:326/:329/:439 sits in `LineItemEditor`, which receives ONLY line items — add a
`currency: string` prop to its props interface and pass `version.currency` from `VersionCard`.
:854 `derivedTotal` comes from the `get_project_budget` RPC (bare number, no currency) — use
`selected?.currency ?? orgCurrency` (`selected` is non-null whenever `derivedTotal > 0` in practice;
the org hook covers the empty/loading edge).
Tests: `pages/ProjectBudget.test.tsx`, `__tests__/ProjectBudget.wave6`, `pages/BudgetProjection.test.tsx`,
`src/lib/budget-snapshot.test.ts`, `__tests__/budget-snapshot.varianceSign`,
`src/lib/budget/budgetProjection.test.ts`, `src/lib/repositories/budgetProjection.test.ts`,
`src/hooks/useBudget.test.ts` (fixtures gain `currency: 'USD'`).
Verify: `npx vitest run pages/ProjectBudget.test.tsx pages/BudgetProjection.test.tsx src/lib/budget-snapshot.test.ts src/lib/__tests__/budget-snapshot.varianceSign.test.ts src/lib/budget src/lib/repositories/budgetProjection.test.ts src/hooks/useBudget.test.ts`.

**Task 14 — Procurement cluster A — lists/boards/approvals (rows 17–18, 24, 33–34):**
`pages/Procurement.tsx` (`r.currency`), `components/ProcurementBoard.tsx` (:43 `pr.currency`,
:94 `useOrgCurrency()`), `pages/Approvals.tsx` (`row.currency`),
`pages/approvals/ProcurementApprovalRow.tsx` (`row.currency` for doc figures AND item figures).
Tests: `pages/Approvals.test.tsx`, `components/procurement.test.ts`, and any Procurement board/list tests that go red.
Verify: `npx vitest run pages/Approvals.test.tsx components/procurement.test.ts`.

**Task 15 — Procurement cluster B — detail + children (rows 25–28, 31–32):**
`pages/ProcurementDetails.tsx` (`p.currency`, `selectedQuote.currency`; pass `currency={p.currency}`
to `LineItemsSection`); `pages/procurement/VendorQuotesTab.tsx` (`q.currency`);
`pages/procurement/LineItemsSection.tsx` (+`currency: string` prop, use at :252/:276/:278/:350/:376);
`pages/procurement/ProcurementListRow.tsx` (parent row currency for :95/:97; `row.currency` :192;
thread from its render parent); `pages/procurement/DecisionSupportPanel.tsx` (+`currency: string`
prop at :49 props interface, use at :158–:217) + `pages/procurement/ProcurementOverviewTab.tsx`
(pass `currency={p.currency}`). Grep `LineItemsSection`/`ProcurementListRow` render sites and thread
from the procurement row each site holds.
Tests: `pages/ProcurementDetails.test.tsx`, the 4 `__tests__/ProcurementDetails.*` variants,
`__tests__/VendorQuotesTab.test.tsx`, `pages/procurement/*.test.tsx`, `src/components/import/__tests__/ProcurementCycleImportWizard.test.tsx` fixtures.
Verify: `npx vitest run pages/ProcurementDetails.test.tsx pages/__tests__ pages/procurement`.

**Task 15b — `currencySymbol` helper + VendorQuotesTab `prefix="$"` weld (FR-L10N-020).**
Recon found `pages/procurement/VendorQuotesTab.tsx:412` hardcodes `prefix="$"` on the Quoted-total
`NumberField` — a money display keyed off nothing. Fix inside the seam. Failing test FIRST in
`src/lib/format.test.ts` (add to the FR-L10N describe):

```ts
  it('FR-L10N-020 (input adornment): currencySymbol returns the currency's display glyph', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('EUR')).toBe('€');
    expect(currencySymbol('IDR')).toBe('IDR'); // no native symbol — the code is the honest glyph
  });
```

Then implement in `src/lib/format.ts`:

```ts
/** The currency's display glyph for input adornments (FR-L10N-020 — a hardcoded `$` prefix is
 *  the same weld formatCurrency had). Codes without a native symbol (IDR) honestly show the code. */
export function currencySymbol(currency: string): string {
  const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency }).formatToParts(1);
  const literal = parts.find((p) => p.type === 'currency')?.value ?? currency;
  return literal === currency ? currency : literal.trim() || currency;
}
```

(`formatToParts` of `format(1)` yields the currency literal as its own part; for IDR it is the code
itself — return it as-is.) Then `VendorQuotesTab.tsx:412` → `prefix={currencySymbol(procurement.currency)}`
(thread the procurement prop it already receives; if its props carry the detail bundle, use that
row's `currency`). Test: `pages/__tests__/VendorQuotesTab.test.tsx` (its `makeQuote` factory already
stamps `currency` — mirror it for the parent). Verify: `npx vitest run src/lib/format.test.ts pages/__tests__/VendorQuotesTab.test.tsx`.

**Task 16 — Invoices/payments (rows 20–21):** `pages/SalesInvoices.tsx` (`inv.currency`;
if `SalesInvoiceRow`'s hand-written interface lacks it, add `currency: string`),
`pages/IncomingPayments.tsx` (`inv.currency` :82, `p.currency` :188). AND the one real DAL edit:
`src/lib/db/revenue.ts` `getRevenueByProject` — add `currency` to its explicit keyset select, the
per-project aggregation map (each project's first row's currency), and the return type; then
`RevenueByProject.tsx` :93/:104 pass `row.currency` (Task 11 already covers :139/:147 with org currency).
Tests: `__tests__/SalesInvoices.createForm.test.tsx`, `pages/__tests__/wave5-prc.test.tsx` (if red), plus IncomingPayments tests if any exist.
Verify: `npx vitest run pages/__tests__/SalesInvoices.createForm.test.tsx pages/__tests__/wave5-prc.test.tsx`.

**Task 17 — Import wizard (row 19):** `ProcurementCycleImportWizard.tsx` :473 →
`formatCurrency(Number(amount), useOrgCurrency())` (hoist the hook to the component top — the
line sits in a render callback). Test: `src/components/import/__tests__/ProcurementCycleImportWizard.test.tsx` (R3 mock).
Verify: `npx vitest run src/components/import`.

### Wave E — close the net

**Task 18 — Typecheck sweep.** `npm run typecheck` → zero errors. Any remaining missing-arg call
site (the sweep's safety net) gets its §3-table source. If a call site exists that the table
missed: apply the §3 sweep rule, note it in the builder report.

**Task 19 — Lint.** `npm run lint:ci` → zero errors/warnings. (The `no-restricted-syntax` guard
must still pass with zero exceptions added — if it fires, the fix is inside `format.ts`.)

**Task 20 — Full unit suite.** `npm test` → green. Apply §4 rules to any file not yet touched;
count files + cases touched (report duty).

**Task 21 — Mutation checks (mandatory; run each, observe RED, revert, observe GREEN again):**
- **M1 (AC-L10N-020):** in `currencyFormatterFor`, weld `currency: 'USD'` over the argument →
  the IDR symbol tests (`formatCurrency(1234,'IDR')`, cents/auto/fine EUR cases) must go red.
- **M2 (AC-L10N-022):** make `formatCompactCurrency` return the old welded template
  `` `${sign}$…` `` ignoring currency → the `IDR 2.5M` compact tests must go red.
- **M3 (AC-L10N-021):** in `AdministrationUsage.tsx`, pass `useOrgCurrency()` instead of
  `PLATFORM_CURRENCY` → the provider-cost test (org mocked `'IDR'`) must go red.
- **M4 (negative compaction):** remove the `Math.abs` gate (test raw `value < 1_000`) →
  `format.compactNegative.test.ts` must go red.
- **M5 (required-arg enforcement):** delete the currency argument from one swept call site →
  `npm run typecheck` must go red.
Record each observation in the builder report.

**Task 22 — Full gate.** `npm run verify` from `pmo-portal/` (13 gates — read `package.json` for
the current list, don't trust the count). If the machine is contended: `npm run verify:locked`.
NOT DONE UNTIL GREEN. e2e needs no edits (§1.6); if an e2e goes red, that is R5 — investigate,
do not bend.

## 6. Traceability (ADR-0010)

| AC | Owning layer & test | Covered by tasks |
|----|--------------------|------------------|
| AC-L10N-020 | Unit — `src/lib/format.test.ts` (currency-argument cases) | 1, 2, sweep 7–17 |
| AC-L10N-021 | Unit (RTL) — `pages/__tests__/Administration.usage.providerCost.test.tsx` (org IDR ⇒ costs still USD) + `PLATFORM_CURRENCY` export test | 1, 2, 5, 6 (M3) |
| AC-L10N-022 | Unit — `src/lib/format.test.ts` + `format.c4minors` / `format.compactNegative` (USD byte-identical battery + IDR compact) | 1, 2 (M2, M4) |
| FR-L10N-020 | all five signatures + every call site | 2, 7–18 |
| FR-L10N-021 | currency half only (symbol off record, grouping unchanged — number_locale is the locale slice, deliberately) | 1, 2 |
| FR-L10N-022 | compact redesign | 1, 2 |
| FR-L10N-023 | `PLATFORM_CURRENCY` + the two platform surfaces | 2, 5, 6 |

## 7. Out of scope (do not touch)

- `organizations`/`profiles` preference columns, `operator_create_org` (sibling ADW worktree).
- Any locale parameter, `number_locale`, date/relative-time locale, `document.lang`, i18n
  libraries, catalogues — the locale slice.
- `parseMoneyInput` / masked money input (FR-L10N-030/031 — locale slice).
- The ESLint guard (`eslint.config.js:86-98`) — neither weakened nor extended.
- `src/lib/export/**` (FR-L10N-050), `pages/AdministrationCredits.tsx`, any migration/RPC/seed.
- `formatRelativeTime`, date formatters, `pct`, `formatNumber*` — untouched in this slice.

## 8. Builder's report must include

1. Test files + cases touched (R1–R4 counts) — the brief demands the number.
2. Mutation-check observations M1–M5 (RED observed, reverted, GREEN).
3. Any call site the §3 table missed and how it was sourced.
4. Any R5 stop-and-investigate events.
5. Confirmation: no migration, no eslint change, no export-path change, no locale work.
