# Merged UX fix backlog — 2026-10-16

**Mode: Operate. Deliverable: planning only; one implementation dispatch / one PR per slice.** No application changes, data operations, push or deployment are authorized by this document.

## Basis and decisions applied

Inputs: [local-seed audit](2026-10-16-declutter-audit.md), the private live-data friction register (referenced only by finding IDs below), [PRODUCT.md](../../PRODUCT.md), [DESIGN.md](../../DESIGN.md), and [decisions](../decisions.md). The live register is deliberately not linked, quoted or attached. All examples below are generic; implementation fixtures must be synthetic too.

The local audit supplies breadth, role/phone evidence and conditional-state hypotheses; the live pass supplies financial and daily-operation impact. Neither proves the other's data state. Reproduce conditional findings before changing behavior. This backlog supersedes the audit's proposed dispatch grouping, not its evidence.

Binding direction, **not questions to reopen**:

- **DD-UX-1..10:** Spending vs contract now; one project money summary; keep Sales recognizable and Approvals reachable; guided setup inside PMO; review first consequential matches, retain stable accepted links; approved-PDF/manual delivery, not invented email sending; one billing start with existing methods; daily phone parity; plain labels with details on demand; receipt/line-first expense drafts.
- **DD-MONEY-1:** Actual uses mapped ERP ledger costs for ERP-ledger organizations, otherwise committed POs. Never read `projects.spent` or `budget_line_items.actual_amount` as live Actual. Preserve source currency, coverage and freshness; unknown is not zero.
- **DD-MONEY-2:** Margin = billed-work revenue less Actual. Contract less cost so far remains a distinct, explicitly named measure, not profit or cash. Invoice settlement is not cash received.
- **DD-MONEY-3:** ERP-owned procurement without open-PO coverage says **Not tracked in PMO yet** for Committed, not zero. Reading ERP open POs is not smuggled into this cleanup.
- **DD-MONEY-4:** Draft budgets never drive risk, spend percentage, utilization or pipeline margin. An Active budget is required; otherwise state **No active budget**. A genuine known zero remains a valid value.
- **DD-SETUP-1:** propose direct-cost/cost-of-sales posting accounts from the chart's grouping; optional project-tagged overhead accounts are count-only. One account belongs to one category. An absent suitable posting account needs operator resolution, not a guessed overhead substitute.
- **OD-BUDGET-6 amendment:** exactly one active organization member may activate their own drafted/edited version, with extra confirmation and recorded sole-operator provenance; the exception disappears automatically with a second active member. All other activation rules remain. No personal exemption or wider approval exception.

### Already handled / external work: do not duplicate or overclaim

- **#1047 is merged:** Project finances cost/unavailable wording only. It does **not** close the whole freshness/completeness problem; the residual wording/freshness finding stays with S-01. Preserve its en/id strings and test rather than reintroducing GL jargon.
- **RF-023 — covered by #1048 / PR #1049, awaiting merge:** tax-inclusive invoice net was displayed as gross. Its owning proof is inclusive/exclusive `Net + Tax = Total`, including the FX net row, in `pages/approvals/SalesInvoiceApprovalSection.test.tsx` and `src/lib/revenue/nativeInvoice.test.ts`. GitHub showed PR #1049 **OPEN**, with no merge commit, at planning time. This is an external fix reservation, **not “already shipped”**; S-17 must rebase onto the merged fix before editing that row. Do not dispatch a second net-calculation fix.
- **#1050 is in build, not done:** sole-operator activation is externally owned. None of the input findings specifically owns that exception, so inventing or assigning a finding to it would distort accounting. S-04's presentation work preserves the activation patch and coordinates its `ProjectBudget.tsx` edit slot; read-only money acceptance can use synthetic Active budgets without waiting for a production activation. Activation acceptance remains with #1050, including one/two active members, inactive members, other organizations, no-drafter behavior, confirmation and history.
- **#1043/#1044** are umbrella context, not proof that setup or declutter has shipped. S-08..S-12, S-21 and S-30 are bounded deliveries, not duplicate umbrella builds.
- **#1020:** reuse its SharePoint browsing/link contract. S-22 is the project-register increment only, not the entire procurement/budget/document program. Its folder-browser prerequisite is explicitly gated below.

## Dispatch and wave contract

**Risk:** `UI-only` = presentation/interaction without financial derivation or changed authority; `money-display` = financial read/derivation semantics, no posting change; `money-path/SoD/RLS` = posting, consequential matching/decision, or a new server read/authorization contract. Highest applicable tier wins. **Size:** S = local component change; M = bounded feature across a few seams; L = coordinated read model, workflow or external-system increment. L still means one bounded PR, not an epic.

All paths in slice cards are relative to **`pmo-portal/`**, unless prefixed `supabase/` or `docs/`. Listed existing files and directories were checked in this worktree. A “new leaf” means a new file in the named, existing directory; final names and migration numbers belong in the issue plan, not guessed as existing files here. Do not edit historical migrations. Give every new migration a unique number and a rollback; generated database types have one writer per wave.

### Parallelism includes the usually forgotten shared files

The source/test write sets below are disjoint **within each wave**. Imports do not confer edit ownership. No drive-by changes to shared primitives, repository barrels, generated types, route configuration, locale catalogues or retention docs.

Every wave has **one shared-file owner** (table below). Only that slice's PR edits `public/locales/en/common.json`, `public/locales/id/common.json`, `DESIGN.md`, `docs/qa-portfolio.md`, and, if needed, `docs/decisions.md` or `src/lib/supabase/database.types.ts`. Its bounded integration tail carries the wave's agreed copy, graduation notes and generated types; sibling slices supply exact keys, proofs and matrix cells without editing those files. Freeze these inputs at dispatch. Merge the shared-file owner's PR first and rebase siblings before their final gates. This is explicit same-wave merge ordering, **not permission for conflicting parallel patches** or a new localization framework. Shared-file ownership is part of that slice's one PR, not a hidden extra dispatch.

Money-family slices can all start in Wave 1 because they reuse the **shipped** mapped-actuals/project-finances and commitment seams; none waits for a new sibling API. Freeze common meanings before dispatch using the rules above. S-02 owns a collection/batched read leaf; S-03 owns all role-dashboard RPC/consumer changes. Keep existing helper exports and project identity types backwards-compatible during the wave. Neither changes the other's RPC or S-01's existing single-project API. Preserve existing scope/tenancy contracts. Do not implement a collection as one network request per row, nor sum unlike currencies into one total.

| Wave | Parallel slices | Shared-file owner | Exit / sequencing intent |
|---|---|---|---|
| **1 — Trust money; unblock daily recovery** | S-01, S-02, S-03, S-04, S-05, S-06, S-07, S-25 | S-01 | Highest-impact incorrect money, collections access, receipt attribution and actionable integration state; no unresolved product/API dependency. Coordinate external #1050's existing file reservation, without rebuilding activation. |
| **2 — Make work and setup legible** | S-08, S-10, S-12, S-13, S-14, S-17, S-18, S-20, S-28, S-31, S-32, S-34, S-37, S-38 | S-08 | Build over reconciled surfaces; S-17 also requires #1049 merged. |
| **3 — Reviewed setup and contextual entry** | S-09, S-11, S-15, S-19, S-24, S-27, S-29, S-36, S-40 | S-09 | Account catalogue from S-10; stable setup home; existing receipt destination available to search. |
| **4 — Finish contextual workflows** | S-16, S-21, S-23, S-30, S-35, S-39 | S-16 | Serialize invoice form after contextual start, integration matching after ERP setup, reporting after customer aging. |
| **5 — Empty-state and document completion** | S-22, S-26 | S-26 | S-22 is a **gated lane** until #1020's reviewed folder browser/link contract is available; do not call the whole wave ready prematurely. |
| **6 — Consequential-copy sweep** | S-33 | S-33 | One owner cleans remaining conditional financial messages after their workflows stabilize. |

Dependencies in cards distinguish true prerequisites from **file-order** predecessors. Every prerequisite is in an earlier wave or an explicitly named external gate. If a new file overlap appears during planning, move the slice to a later wave; do not quietly broaden the shared-file-owner exception. This schedule is a safe maximum parallelism, not a requirement to consume that many concurrent agents or shared-DB runs.

## Money-language family — Wave 1

### S-01 — One trustworthy project money position

**Outcome:** The owner opens a project and sees one scoped contract/spent/billed/cash-received position, with understandable drill-downs and explicit missing coverage.

**Owned findings:**
- UX-022 — overlapping project money summaries.
- UX-023 — a partial mapped-cost total can read as complete.
- UX-024 — repeated unavailable categories without role-appropriate recovery.
- UX-025 — residual source/freshness wording after #1047; date still needs a clear Updated label.
- UX-026 — request value and commitments use the same name despite different scopes.
- UX-027 — a negative variance obscures budget remaining.
- UX-032 — settlement explanation appears even without settlements.

**Scope:** Apply all four money rulings in header and Overview; reuse `deriveMargin` and exact-money helpers. One headline summary, not parallel copies of header/drawdown/finance/budget totals. Cash is sourced from actual receipts; if the current response exposes only settlement, show cash unavailable until a receipt-backed read is present, never relabel settlement. Preserve distinct commitments, request value, Active budget, billed-work revenue and tax bases. Put coverage and freshness beside amounts; disclose category/source detail and offer Admin/Finance setup remediation versus a useful PM handoff. Keep remaining/overrun signs and empty help honest.

**Likely files:** `pages/project-detail/ProjectDetail.tsx`, `pages/project-detail/ProjectDetailHeader.tsx`, `pages/project-detail/ProjectFinancesSection.tsx`, `pages/project-detail/tabs/OverviewTab.tsx`; `src/lib/projectFinances.ts`, `src/lib/budget-snapshot.ts`; new receipt-backed composition leaf, only if needed, under `src/lib/repositories/` using existing authorized receipt reads (no new server authority contract in this display-tier slice). Shared-file-owner integration tail as defined above.

**Layer-1 proof:** extend `pages/project-detail/ProjectFinancesSection.test.tsx`, `pages/project-detail/__tests__/ProjectDetailHeader.test.tsx`, `pages/project-detail/__tests__/OverviewTab.budgetUtil.test.tsx`, `src/lib/projectFinances.test.ts`, `src/lib/__tests__/budget-snapshot.varianceSign.test.ts`. Assert complete/partial/unavailable/known-zero, restricted coverage, both budget signs, Draft versus Active, currency mismatch, billed-work margin versus contract-minus-cost, and cash versus withholding/credits. Existing pgTAP in `supabase/tests/0290_project_finances_reads.test.sql` remains the single-project read/coverage oracle. If composition would require a new server authority contract rather than existing receipt reads, re-tier/re-plan that increment before dispatch; do not quietly extend this display slice.

**Risk:** money-display · **Size:** L · **Dependencies:** none; #1047 is the baseline, not a new prerequisite. Freeze shared labels before parallel dispatch.

### S-02 — Same Actual throughout the Projects collection

**Outcome:** The PM and owner read trustworthy spending on every visible project row/card without losing their legitimate differences in portfolio scope.

**Owned findings:**
- RF-008 — delivery-project rows state zero Actual despite ledger costs being held elsewhere.

**Scope:** Batched project-money repository/query seam for the visible collection; single canonical Actual basis, freshness/coverage and Active-budget risk. Use it in list rows/cards; unavailable denominators stay unavailable. Any Margin field uses billed-work revenue less Actual; contract minus cost so far is separately named, never profit. Keep delivery progress separate. Do not change the identity/filter layout owned by S-14. Base project identity types/hooks stay unchanged: join the money query by stable project ID, not by altering the shared project-row contract during parallel dashboard work.

**Likely files:** `pages/Projects.tsx`, `components/ProjectCard.tsx`; new collection read leaves under `src/lib/repositories/`, `src/lib/db/` and `src/hooks/`; new migration under `supabase/migrations/` limited to the collection read, not dashboard RPCs.

**Layer-1 proof:** `pages/Projects.test.tsx`, `components/ProjectCard.test.tsx`; new tests beside the collection leaves and new pgTAP in `supabase/tests/` compare the collection result with the shipped single-project mapped-cost basis for the same synthetic project, with PM scope/organization isolation, pagination and no per-row fetch. Test ledger-owned versus PO-owned sources, missing snapshots, zero, restricted rows, mixed currencies, Draft and absent budgets.

**Risk:** money-path/SoD/RLS · **Size:** L · **Dependencies:** none; uses shipped single-project rules, not a new S-01 API.

### S-03 — Role dashboards tell the truth before summarizing

**Outcome:** The owner sees decisions first and financial headlines that cannot imply cash, full cost coverage or profitability that the data does not support.

**Owned findings:**
- UX-013 — the spend bar uses contract, not budget, as its denominator.
- UX-014 — same-project spending differs between role dashboards.
- UX-015 — the PM status percentage has no metric name.
- UX-016 — passive KPI cards precede attention work.
- UX-017 — booked revenue/contract remainder wording implies realized results or cash.
- RF-001 — a zero-cost headline presents full realized margin as fact.
- RF-002 — total project spend presents unavailable ledger costs as zero.
- RF-003 — pipeline margin is asserted when bids lack usable cost estimates.
- RF-004 — win rate omits the limitations of recorded outcomes.
- RF-005 — a chart labelled active-project budget/actual includes bids and uses bid value as budget.
- RF-006 — work-order-only remaining billing appears to contradict project-level remaining billing.
- RF-007 — an empty PMO purchasing chart implies no buying occurred outside PMO.

**Scope:** Spending vs contract, delivery scope stated; a separate Active-budget risk signal, never a silently changed denominator. Reconcile dashboard RPC Actual with mapped costs/PO fallback and propagate unknown into profit. Apply the same definitions in desktop, phone, Finance and PM dashboards. PM keeps its assigned-project scope; its trailing percentage has a metric label and profit basis, separate from delivery progress. PM consumes this slice's existing dashboard read seam, not S-02's new collection API. Pipeline forecast profit requires an Active cost budget. Recorded win/loss sample is explicit without inferring unrecorded losses. Keep WO remaining explicitly scoped (and compact/absent when unused), not a replacement for project contract remaining. ERP-native purchases are described as outside this PMO request chart. Lead with genuine approvals/exceptions, then quiet totals; no invented bank-cash metric.

**Likely files:** `pages/ExecutiveDashboard.tsx`, `src/components/dashboard/{MobileExecutiveDashboard,FinanceDashboard,PMDashboard,BvACard,ProjectedMarginBars,WinRateCard,StillToInvoiceCard}.tsx`; `src/lib/db/dashboard.ts`, `src/hooks/useDashboard.ts`; new migration in `supabase/migrations/` limited to dashboard RPCs. Braced paths denote those existing files individually.

**Layer-1 proof:** `pages/ExecutiveDashboard.test.tsx`, `src/components/dashboard/BvACard.test.tsx`, `src/components/dashboard/PMDashboard.test.tsx`, `src/components/dashboard/WinRateCard.test.tsx`, `src/components/dashboard/__tests__/StillToInvoiceCard.test.tsx`, `src/lib/db/dashboard.test.ts`; extend `supabase/tests/0034_dashboard_on_hand_margin.test.sql`, `0038_dashboard_margin_guards.test.sql`, `0075_at_risk_budget_from_versions.test.sql` (last two also under `supabase/tests/`). Oracles bind title + actual denominator, stage inclusion, authoritative Actual, sample caveat, Draft/unknown propagation, mixed-currency handling, WO scope and attention-before-KPIs DOM order.

**Risk:** money-path/SoD/RLS · **Size:** L · **Dependencies:** none; reads existing mapped-actuals functions and preserves existing dashboard authorization.

### S-04 — Budget and forecast answer the finish-cost question

**Outcome:** The PM can see whether work will finish within an Active budget, with the same Actual as other surfaces and one reviewed cost-to-finish edit.

**Owned findings:**
- UX-033 — budget version/status/amount is announced repeatedly.
- UX-034 — forecast is buried below a version line-item ledger.
- UX-035 — desktop final-cost/overrun outcomes are off-screen.
- UX-036 — missing forecast inputs look like unexplained dashes.
- UX-037 — forecast labels expose system ownership and acronyms.
- UX-038 — utilization is not named as forecast budget use.
- UX-039 — cost-to-finish updates require repeated per-row editing.

**Scope:** Replace budget-line stored Actual displays with the canonical source (aggregate categories without duplicating totals across fiscal-year rows). Keep one version header and a clear Forecast entry/outcome-first view; preserve existing phone stacked rows. Show Budget, Recorded spending, Cost to finish, Forecast final cost and Forecast remaining/overrun. Missing cost/budget invalidates derived figures, with a visible reason. Multi-row cost-to-finish draft uses existing validation/write semantics; cancel and failed/partial saves must not pretend all rows saved. Do not touch activation semantics or dilute the #1050 confirmation/history. This slice owns Budget-tab money including the version table, not just the lower forecast panel.

**Likely files:** `pages/ProjectBudget.tsx`, `pages/BudgetProjection.tsx`, `pages/project-detail/tabs/BudgetTab.tsx`, `src/lib/budget/budgetProjection.ts`, `src/lib/repositories/budgetProjection.ts`.

**Layer-1 proof:** `pages/ProjectBudget.test.tsx`, `pages/BudgetProjection.test.tsx`, `pages/project-detail/tabs/BudgetTab.test.tsx`, `src/lib/budget/budgetProjection.test.ts`, `src/lib/repositories/budgetProjection.test.ts`. Assert no stored line Actual is read, fiscal-year/category grain, Draft/Active/no-budget states, visible incompleteness, outcome-column priority, multi-row valid/invalid/cancel/failure behavior and existing activation affordances. pgTAP in `supabase/tests/budget_projection_rpc.test.sql` only if the save contract changes; prefer retaining it. Rendered geometry is a narrow browser gate, not a replacement for these money tests.

**Risk:** money-path/SoD/RLS · **Size:** L · **Dependencies:** none for read models; coordinate/rebase #1050's in-flight `ProjectBudget.tsx` patch before merging, preserving both changes. Do not wait for a live budget activation to test.

## Other slice cards

### S-05 — Find the invoice that needs chasing · Wave 1

**Outcome:** Finance filters invoices by project and lateness, opens one directly, and understands its balance and customer reference.

**Owned findings:**
- RF-014 — invoice list lacks visible project attribution/filtering.
- RF-015 — repetitive missing tax-rate/base jargon dominates invoice rows.
- RF-016 — unpaid invoices have no useful overdue age/sort/filter.
- RF-017 — a small residual is indistinguishable from a normal collection balance.
- RF-018 — customer order references are absent despite available project context.
- RF-019 — an ERP numbering-series year can differ from the document date (source-data artifact).
- RF-020 — invoice identity/row does not directly open the record.
- RF-021 — bare Cancel is ambiguous for a consequential invoice action.
- RF-022 — company display names differ across invoice and project screens.

**Likely files:** `pages/SalesInvoices.tsx`, `src/lib/db/revenue.ts`, `src/hooks/useRevenue.ts`, `src/lib/repositories/revenueDisplay.ts`. Use existing `companyDisplayName` and tax helpers, without editing those shared helpers here.

**Layer-1 proof:** `pages/__tests__/SalesInvoices.dueDate.test.tsx`, `SalesInvoices.deepLink.test.tsx`, `SalesInvoices.vocabulary.test.tsx` (all three in `pages/__tests__/`); `src/lib/db/revenue.listFilters.test.ts`. Assert project/overdue predicates, org-zone day boundary, primary record link, reference precedence (invoice first; project reference labelled as fallback), company short/legal names, and explicit Cancel invoice confirmation. Show outstanding amount on every unpaid invoice and distinguish partial settlement, making a small residual recognizable without inventing a numerical cutoff. Residuals stay visible and actionable: no automatic write-off, threshold invented as policy, or hidden debt. The ERP numbering artifact is recorded as an operator/source-data check, **no PMO renumbering or date rewrite**; the row keeps both identifiers and document date recognizable. Tax basis remains honest without requiring a rate/base diagnostic on every row.

**Risk:** money-display · **Size:** L · **Dependencies:** none; do not edit the net-calculation row reserved by #1049.

### S-06 — Receipts show what cash settled · Wave 1

**Outcome:** Finance opens a receipt and sees every invoice allocation, unapplied cash and recorded withholding without mistaking settlement for cash.

**Owned findings:**
- RF-030 — a multi-invoice receipt looks allocated to just one invoice.
- RF-031 — unmatched received money is indistinguishable from matched cash.
- RF-032 — receipt withholding is presented as zero when its capture/coverage is unknown.
- RF-033 — receipt statuses use invoice-oriented Paid/Scheduled language.
- RF-034 — receipt rows have no useful read-only allocation detail.

**Likely files:** `pages/IncomingPayments.tsx`, `App.tsx` (only this wave's route writer), `src/lib/adapterSeam/erpnext/applyFeed.ts`, `supabase/functions/erpnext-sweep/index.ts`; new receipt-allocation repository/DAL leaves in `src/lib/repositories/`, `src/lib/db/`, plus a new migration in `supabase/migrations/`. Keep shared revenue DAL edits with S-05; add allocation reads as leaves, not competing edits to its files.

**Layer-1 proof:** `pages/__tests__/IncomingPayments.native.test.tsx`, `src/lib/adapterSeam/erpnext/applyFeed.test.ts`, `supabase/functions/erpnext-sweep/receiptWithholdingFeed.test.ts`, `repairUnlinkedReceipts.test.ts` (last file also in that function directory); new pgTAP in `supabase/tests/` owns allocation scope/cardinality and nullable withholding. Assert multiple allocation amounts, remaining unapplied cash, known-zero versus missing deductions, Received/Expected wording and a canonical read-only receipt destination. One curated cross-stack receipt→allocations→invoice journey only; no second accounting engine.

**Risk:** money-path/SoD/RLS · **Size:** L · **Dependencies:** none; preserve existing withholding read-back mechanics and use authoritative ERP allocation values.

### S-07 — Readiness and integration exceptions are actionable · Wave 1

**Outcome:** The Admin knows which business tasks are ready, what transferred successfully, and which exceptional item needs action.

**Owned findings:**
- UX-067 — Connected overwhelms task readiness and foregrounds Disconnect.
- UX-068 — the human is asked to verify transferred data manually.
- UX-069 — an empty outbound queue is styled as a warning.
- UX-070 — personal versus organization connection navigation is prose only.
- UX-071 — internal source-of-truth domains obscure what updates automatically.
- UX-072 — failed readiness checking offers only a repetitive retry.
- RF-044 — organization-owned Microsoft application approval is shown as if still required.
- RF-045 — outbound attention count has no item list or recovery doorway.
- RF-046 — an engineering verification instruction substitutes for real health evidence.

**Likely files:** `src/components/integrations/IntegrationsView.tsx`, `M365OrgApprovalCard.tsx` (same directory), `src/hooks/useIntegrations.ts`; new exceptional-item read/retry leaf under `src/lib/repositories/`. Use existing readiness/health methods rather than changing the repository barrel in this wave.

**Layer-1 proof:** `src/components/integrations/IntegrationsView.test.tsx`, `src/components/integrations/__tests__/M365OrgApprovalCard.test.tsx`, `src/hooks/useIntegrations.test.tsx`; server-contract pgTAP/new handler tests in existing `supabase/tests/` or `supabase/functions/` only where new access/retry behavior is required. Assert connected/unknown/ready independently, per-source failure, stale-state labelling, verified record+time rather than cursor-as-sync, zero/waiting/failed queues, item reason and permitted retry, personal-settings link and own-app approval state. Preserve originating-dialog errors and inputs; no blind replay of consequential writes.

**Risk:** money-path/SoD/RLS · **Size:** L · **Dependencies:** none; retry uses existing authorization/idempotency contracts, no new blanket replay power.

### S-08 — One resumable setup review · Wave 2

**Outcome:** The owner reviews proposed business connections once and later sees only unresolved exceptions.

**Owned findings:**
- UX-009 — setup responsibilities are scattered across screens.
- UX-085 — setup actions name adapters/domains/bindings rather than outcomes.
- RF-048 — integration setup reads as internal configuration instead of a business checklist.
- RF-049 — employee-readiness copy is grammatically wrong and includes members who do not use time entry.

**Likely files:** `src/components/integrations/IntegrationsView.tsx`, `ErpSetupChecklist.tsx`, `integrationLabels.ts` (same directory). Shared-file-owner tail; no matcher implementation or broad repository rewrite.

**Layer-1 proof:** `src/components/integrations/IntegrationsView.test.tsx`, `integrationLabels.test.ts` (same directory); add checklist RTL beside `ErpSetupChecklist.tsx`. Assert resumable task groups, completed link retention, direct focused-step links, unknown versus incomplete, plural forms, and employee checks based on actual time-entry participation/readiness, not a blanket exemption by role. First financial/identity matching remains explicitly reviewed.

**Risk:** UI-only · **Size:** M · **Dependencies:** S-07; later matcher slices fill the existing step links rather than blocking this setup overview.

### S-09 — Review ERP project matches, never manufacture them from the queue · Wave 3

**Outcome:** The owner confirms proposed existing delivery-project matches in one review and receives a specific recovery path for unresolved rows.

**Owned findings:**
- UX-028 — an unlinked project offers both Link and Change.
- UX-029 — failed linking offers an indistinguishable retry.
- RF-047 — the unmapped-project queue includes pre-win bids and its Link action can create an ERP project.

**Likely files:** `pages/project-detail/ProjectErpLink.tsx`, `src/components/integrations/ErpSetupChecklist.tsx`, `IntegrationsView.tsx` (same integration directory), `src/lib/repositories/projectErpSetup.ts`; new match-review server leaf/migration under `supabase/functions/` / `supabase/migrations/` if required. Shared-file-owner tail.

**Layer-1 proof:** `pages/project-detail/__tests__/ProjectErpLink.test.tsx`, `src/lib/repositories/erpSetup.test.ts`; new pgTAP/server handler tests in existing Supabase test/function directories for delivery eligibility, deterministic proposal keys, no implicit create, explicit confirmation, audit and retained existing matches. Cover confident/ambiguous/no-match/failed-save and deliberate rematch. One cross-stack review→persist→reopen proof suffices; no fuzzy auto-identity assignment.

**Risk:** money-path/SoD/RLS · **Size:** L · **Dependencies:** S-08; #1043 scope reference, not a separate duplicate prerequisite build.

### S-10 — Review budget-account proposals together · Wave 2

**Outcome:** The owner confirms a valid direct-cost posting map once instead of typing exact account names category by category.

**Owned findings:**
- UX-076 — budget mapping requires exact-name account typing.
- UX-077 — per-row map chores foreground posting mechanics.
- RF-052 — unmapped categories block useful budget setup without chart-based proposals.

**Likely files:** `pages/admin/BudgetAccountMap.tsx`, `src/lib/budget/categoryAccountMap.ts`, `src/lib/repositories/index.ts`, `types.ts` (same repository directory), `supabase/functions/external-items/index.ts`. This slice alone extends the account-catalogue contract; subsequent account consumers reuse it.

**Layer-1 proof:** `pages/admin/BudgetAccountMap.test.tsx`, `src/lib/budget/categoryAccountMap.test.ts`, `supabase/functions/external-items/items.test.ts`, `supabase/tests/budget_account_map_multi.test.sql`. Prove DD-SETUP-1 chart-group filtering, main posting versus extra read accounts, one-account/one-category, deliberate confirmation, retained prior choices, no suitable account/operator recovery, loading/ambiguous/no-match, and no re-push when a mapping changes. Handler tests bind to shipped handler; pgTAP owns persisted constraints.

**Risk:** money-path/SoD/RLS · **Size:** L · **Dependencies:** none beyond the shipped setup home. S-08 adds same-wave navigation to this step, not a prerequisite API; shared copy merges through S-08.

### S-11 — Choose tax accounts and the advance-billing item · Wave 3

**Outcome:** Finance selects valid chart/item proposals with a plain explanation of each accounting consequence.

**Owned findings:**
- UX-078 — tax-purpose accounts require exact ERP spelling.
- UX-079 — advance billing requires an item code and ledger expertise.
- RF-051 — receipt withholding, vendor-tax and advance-item setup uses error-prone free text.

**Likely files:** `pages/admin/{OrgWithholdingAccount,OrgVendorTaxAccounts,OrgDownPaymentItem}.tsx`, `src/lib/db/orgs.ts`, `src/lib/repositories/index.ts`. Reuse S-10's catalogue without reopening its endpoint or shared types in this wave.

**Layer-1 proof:** the existing `OrgWithholdingAccount.test.tsx`, `OrgVendorTaxAccounts.test.tsx`, `OrgDownPaymentItem.test.tsx` beside those components; `src/lib/db/orgs.withholding.test.ts`, `orgs.vendorTax.test.ts`, `orgs.downPaymentItem.test.ts` (same DAL directory). Assert company-scoped/purpose-valid choices, advance liability-account consequence, reviewed proposed values, retained existing choices, unknown/unavailable catalogues and explicit operator recovery. Preserve server checks; add targeted pgTAP in `supabase/tests/` only for changed persisted contracts.

**Risk:** money-path/SoD/RLS · **Size:** M · **Dependencies:** S-10; S-31 file-order baseline for focused accounting sections.

### S-12 — Explain expense-posting readiness consistently · Wave 2

**Outcome:** A connected organization sees the actual missing expense setup step and claimants know whether their draft will reach accounting.

**Owned findings:**
- UX-080 — expense-map recovery contradicts connection status.
- RF-053 — connected-but-expense-unready setup sends the Admin into a reconnect loop.
- RF-060 — expense entry offers no useful indication that posting is not active.

**Likely files:** `pages/admin/ExpenseAccountMap.tsx`, `pages/expenses/ExpenseClaimFormModal.tsx`, `pages/expenses/ExpensePostingsCard.tsx`; consume existing readiness/ownership hooks without changing S-07's hook.

**Layer-1 proof:** `pages/admin/ExpenseAccountMap.test.tsx`, `pages/ExpenseClaims.test.tsx`, `pages/expenses/ExpensePostingsCard.test.tsx`; add form RTL in existing `pages/expenses/`. Connected-but-inactive, incomplete, unknown and ready are distinct; remediation names the missing step. Display a persistent plain warning before draft creation where posting is unavailable; do not silently disable PMO-only capture, turn posting on, or retroactively enqueue old claims.

**Risk:** UI-only · **Size:** M · **Dependencies:** S-07 readiness definitions; no change to expense posting/approval policy.

### S-13 — Compact project identity; selected work owns the page · Wave 2

**Outcome:** The phone user reaches the chosen project job immediately, can identify it, and can still find full record context and permitted transitions.

**Owned findings:**
- UX-002 — record-wide status change competes with the selected task.
- UX-003 — each tab pays the repeated Overview/header cost.
- UX-004 — the selected project tab can be off-screen.
- UX-006 — routine phone actions need verified effective hit areas.
- UX-007 — functional identity/phase metadata shrinks to microtext.
- UX-012 — heading navigation does not match visible work sections.
- UX-030 — permanent details rail consumes desktop task width.
- UX-031 — cross-year overdue phase targets omit the year.
- RF-057 — long project header metadata buries customer/order context in repeated codes.

**Likely files:** `pages/project-detail/{ProjectDetail,ProjectDetailHeader,ProjectDetailRail,MilestoneStrip}.tsx`, `pages/project-detail/tabs/{BillingTab,WorkOrdersTab}.tsx`, `src/components/ui/Tabs.tsx`. Keep complete name/customer and one order-reference line with an accessible More disclosure. Task sections supply real headings; subordinate ERP details do not outrank the job. Do not duplicate job-primary actions in the fixed phone bar. No global Button/token redesign.

**Layer-1 proof:** `pages/project-detail/__tests__/ProjectDetail.tabs.test.tsx`, `ProjectDetail.tabFocus.test.tsx`, `ProjectDetailHeader.test.tsx`, `MilestoneStrip.display.test.tsx`, `MilestoneStrip.touchTarget.test.tsx` (all in that test directory); add tab visibility/section-heading RTL beside affected components. Test deep links for every tab, keyboard focus/selection, disclosures, permitted record transitions, readable identity and previous/current-year dates with timezone boundaries. Targeted rendered geometry measures active-tab visibility, actual pseudo-element hit areas, header/task depth and recovered width at 390/1280/1440; not an app-wide claim from jsdom dimensions.

**Risk:** UI-only · **Size:** L · **Dependencies:** S-01 money summary; file-order after S-04 for forecast entry layout. Manager-row recognition belongs to the project-list slice, not a competing Projects edit here.

### S-14 — Projects are recognizable before controls and filler · Wave 2

**Outcome:** The owner finds the right project quickly without decoding tiny unassigned avatars, empty columns or prominent status-change actions.

**Owned findings:**
- UX-018 — dense desktop toolbar mixes daily and rare tasks.
- UX-019 — three identifiers crowd project identity.
- UX-020 — completed delivery uses danger coloring.
- UX-021 — an abbreviated, empty optional column consumes width.
- RF-009 — unused progress/budget columns repeat filler across the current view.
- RF-010 — contract cells duplicate tax notes and taxable-base jargon.
- RF-011 — unassigned PM renders as a person-like initial.
- RF-012 — end-customer filter includes unrelated companies.
- RF-013 — every row foregrounds status change, including closed work.

**Likely files:** `pages/Projects.tsx`, `components/ProjectCard.tsx`, `components/ProjectClassificationFilters.tsx`. Keep scope/search/current view immediate; disclose transfer tools and secondary filters. All-empty optional columns may hide only with a discoverable restore control. Filter options come from actual end-customer associations, preserving current selection. Move status changes to existing permitted row/detail actions, not removal of the capability.

**Layer-1 proof:** `pages/Projects.test.tsx`, `components/ProjectCard.test.tsx`, `components/__tests__/` (existing directory for added classification/control tests). Assert selected filter persistence, restore, no-data versus loading, short/long identities, readable PM/unassigned, delivery-completion versus risk styling, one tax basis and retained row-menu actions. Rendered width gate proves identity/control visibility at 1440 and bounded scroll below the table budget.

**Risk:** UI-only · **Size:** M · **Dependencies:** S-02; preserve its canonical money reads.

### S-15 — One project billing start with retained context · Wave 3

**Outcome:** The owner starts the appropriate invoice from the project without repeating customer/order selection or navigating empty parallel billing panels.

**Owned findings:**
- UX-043 — empty work orders lead with zero summaries instead of first use.
- UX-044 — billing entry is split among project/global/model-specific screens.
- UX-050 — the global invoice form makes the owner reconstruct known context.

**Likely files:** `pages/project-detail/tabs/BillingTab.tsx`, `WorkOrdersTab.tsx` (same tab directory), `pages/project-detail/InvoiceWorkOrderModal.tsx`, `pages/SalesInvoices.tsx`. Existing contract/work-order/quantity methods remain; tracker phases are not billing records. Pass scoped context through the existing entry route/form rather than introducing another draft writer.

**Layer-1 proof:** `pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx`, `InvoiceWorkOrderModal.test.tsx` (same test directory), `pages/__tests__/SalesInvoices.createForm.test.tsx`, `src/hooks/useRevenue.workOrderBilling.test.tsx`. Assert project/customer/order prefill, global unscoped start, method choice, empty-first task, draft goal and server order-ceiling refusal. One curated project→method→draft cross-stack journey owns context persistence; do not weaken approval or order safeguards.

**Risk:** money-path/SoD/RLS · **Size:** M · **Dependencies:** S-01, S-13, S-17 (file order); use existing billing contracts, not a new billing model.

### S-16 — Review the draft amount before saving · Wave 4

**Outcome:** Finance describes the work and checks subtotal, tax and total before creating a draft invoice.

**Owned findings:**
- UX-051 — optional item code competes with the description.
- UX-052 — the invoice draft has no review total.

**Likely files:** `pages/SalesInvoices.tsx`, `src/lib/revenue/nativeInvoice.ts`; reuse connected item picker and shipped tax treatment helpers. Shared-file-owner tail.

**Layer-1 proof:** `pages/__tests__/SalesInvoices.createForm.test.tsx`, `src/lib/revenue/nativeInvoice.test.ts`. Test description-only native lines where allowed, existing connected item selection, multiple quantities/rates, inclusive/exclusive/no-VAT, decimal rounding and unknown tax readiness. `Net + Tax = Total` must hold without copying the #1048 fix or replacing authoritative ERP totals. Review does not submit/approve the draft, and missing prerequisites are not guessed away.

**Risk:** money-path/SoD/RLS · **Size:** M · **Dependencies:** S-15; #1049 is already required by S-17. Preserve manual delivery states from S-17.

### S-17 — Invoice detail supports collection and honest delivery · Wave 2

**Outcome:** Finance opens an invoice, sees the context needed to chase it, and knows the difference between approval, PDF download, delivery and receipt.

**Owned findings:**
- UX-053 — the approved invoice's client-delivery handoff is unexplained.
- RF-024 — detail omits invoice/due dates, status, overdue, applied payments and contact context.
- RF-025 — ERP line items are a dead-end message rather than readable bill evidence.
- RF-026 — ERP-origin records show non-applicable empty author/order fields.
- RF-027 — detail/list tax basis wording disagrees and foregrounds diagnostics.
- RF-028 — long project identity is truncated without usable full recognition.
- RF-029 — positive note: preserve the existing project-box link.

**Likely files:** `pages/SalesInvoices.tsx`, `pages/approvals/SalesInvoiceApprovalRow.tsx`; a new read-only invoice-evidence leaf under `src/lib/repositories/` and, if needed, a narrowly scoped handler under `supabase/functions/`. Do not edit S-06's allocation feed or shared revenue DAL in parallel.

**Layer-1 proof:** `pages/__tests__/SalesInvoices.invoicePdf.test.tsx`, `SalesInvoices.dueDate.test.tsx`, `SalesInvoices.deepLink.test.tsx` (same test directory), `pages/approvals/SalesInvoiceApprovalSection.test.tsx`; handler-bound tests for the ERP evidence proxy if added. Assert visible dates/status/age, applied receipts, useful authorized contact, long project link/name, consistent plain tax basis, origin-aware optional fields, read-only lines and unavailable/retry state. Ready to send means approved PDF/manual handoff; downloaded is not Sent. Preserve received-date terms; no requirement to send the client into ERPNext, no email feature added.

**Risk:** money-path/SoD/RLS · **Size:** L · **Dependencies:** S-05, S-06; **external gate: #1049 merged**. Due-date detail must honor DD-DUE-1; ERP aging keeps ERP's basis.

### S-18 — One mobile approval queue grammar · Wave 2

**Outcome:** The approver reviews any pending type through one predictable selection/evidence pattern and understands the scope of an empty inbox.

**Owned findings:**
- UX-060 — phone procurement and timesheet reviews use different queues/interactions.
- UX-061 — Select ambiguously starts bulk mode.
- RF-042 — an empty PMO inbox does not explain that ERP-entered documents may be approved elsewhere.

**Likely files:** `pages/Approvals.tsx`; any new common queue/preview leaf stays in existing `pages/approvals/`. Do not edit S-17's invoice evidence row or section tests. Keep approvals in PMO for PMO-origin work; do not adopt every ERP approval type as a hidden scope expansion.

**Layer-1 proof:** `pages/Approvals.test.tsx`, new tests beside any new queue/preview leaf in `pages/approvals/` (not S-17's `SalesInvoiceApprovalSection.test.tsx`). Assert shared Select items/preview semantics, eligible count/scope, type-specific evidence, role-aware clear-queue scope and distinct error/loading. Preserve decision confirmations and all eligibility rules. Empty copy explains PMO scope, not “no approvals exist anywhere.”

**Risk:** UI-only · **Size:** M · **Dependencies:** S-25 reachable inbox; S-17 owns invoice evidence-row content, so this slice does not edit `SalesInvoiceApprovalRow.tsx`.

### S-19 — Purchasing uses one readable vocabulary · Wave 3

**Outcome:** A user recognizes each purchase stage and next step across lists, project context and dashboard without an acronym tour.

**Owned findings:**
- UX-008 — the same purchasing state has several displayed names.
- UX-040 — tiny repeated lifecycle dots add no next-step meaning.
- UX-056 — the purchasing introduction is an acronym/process diagram.
- UX-057 — rare transfer tools crowd daily purchasing controls.
- RF-058 — procurement leads with acronyms and import-engine language.
- RF-059 — empty PMO requests imply ERP-native purchases do not exist.

**Likely files:** `components/procurement.ts`, `pages/Procurement.tsx`, `pages/project-detail/tabs/ProcurementTab.tsx`, `pages/ExecutiveDashboard.tsx`. Stage-label exports feed existing detail/inbox consumers; do not rewrite their layouts or stored enums.

**Layer-1 proof:** `components/procurement.test.ts`, `pages/Procurement.test.tsx`, `pages/project-detail/__tests__/ProcurementTab.newrequest.test.tsx`, `pages/ExecutiveDashboard.test.tsx`. Assert common labels, one stage plus useful next step, full journey retained on detail, transfer tools reachable under More and explicit ERP-purchase scope. No new ERP-native purchase adoption is implied; ledger costs remain separate from the PMO request register.

**Risk:** UI-only · **Size:** M · **Dependencies:** S-03, S-18, S-20 for stable consuming surfaces/file order.

### S-20 — One purchase decision area, evidence first · Wave 2

**Outcome:** The approver reviews identity, value and evidence, then uses one complete responsive decision area.

**Owned findings:**
- UX-058 — phone request detail duplicates Approve.
- UX-059 — identity/policy repetition displaces decision evidence.

**Likely files:** `pages/ProcurementDetails.tsx`; use existing decision primitives without altering global mobile-action components.

**Layer-1 proof:** `pages/ProcurementDetails.test.tsx`. Assert one responsive Approve/Return-or-Reject/Cancel set as permitted, consequential confirmation and amount/identity, evidence before repeated policy detail, keyboard order and read-only states. Keep current server decision authority. A rendered narrow-width action/evidence check complements RTL; no second confirmation layer.

**Risk:** money-path/SoD/RLS · **Size:** M · **Dependencies:** none (scheduled Wave 2 to keep Wave 1 focused).

### S-21 — Connect task lists once, then show tasks · Wave 4

**Outcome:** The PM works on tasks without a setup tour, while the owner reviews initial task-list matches once and later handles only exceptions.

**Owned findings:**
- UX-041 — disconnected integration setup precedes daily task work.
- UX-042 — connected project/list matching repeats configuration and Push/Pull choices.

**Likely files:** `pages/project-detail/tabs/TasksTab.tsx`, `src/components/projects/ProjectIntegrationsCard.tsx`, `src/components/integrations/IntegrationsView.tsx`, `src/lib/repositories/index.ts`. This slice is the Wave 4 repository-barrel writer.

**Layer-1 proof:** `pages/project-detail/__tests__/TasksTab.test.tsx`, `src/components/projects/__tests__/ProjectIntegrationsCard.test.tsx`, `src/hooks/useIntegrations.test.tsx`. Test initial PMO-versus-existing-task seed choice separately from ongoing two-way updates, deterministic/ambiguous/no-match, reviewed confirmation, retained accepted links, disconnected daily view and actionable sync exception. Persisted matching needs targeted server/pgTAP proof in existing Supabase directories; one link→refresh cross-stack journey, not a generic connector rewrite.

**Risk:** money-path/SoD/RLS · **Size:** L · **Dependencies:** S-08, S-09 (setup UI/file order); follows the same reviewed-link contract, not silent fuzzy matching.

### S-22 — Documents show attachments and linked-folder evidence honestly · Wave 5

**Outcome:** A PM can distinguish missing/unavailable attachments and reach the project's linked document folder without an empty-register dead end.

**Owned findings:**
- UX-045 — issued/approved document rows show an unexplained file dash.
- RF-055 — a project with external folder evidence appears to have no documents and gives draft-row jargon.

**Likely files:** `pages/project-detail/tabs/DocumentsTab.tsx`, `src/hooks/useDocuments.ts`; existing document-link repository surface in `src/lib/repositories/index.ts`. Reuse the reviewed folder picker/link work from #1020; this increment wires the project register, not procurement and budgets too.

**Layer-1 proof:** `pages/project-detail/tabs/DocumentsTab.test.tsx`, `src/hooks/useDocuments.test.tsx`, `src/lib/repositories/__tests__/document.m365-link.test.ts`, `document.m365-unlink.test.ts` (same repository test directory). Test No file attached versus loading/denied/unavailable, file download, external-folder presence, retained folder association, role-appropriate remediation and Microsoft access refusal. A folder link does not mean every file is registered, uploaded or approved; show contents only through the authorized browser capability. One cross-stack confirmed-folder→reopen proof if linkage persistence is newly wired.

**Risk:** money-path/SoD/RLS · **Size:** M · **Dependencies:** S-13; **external gate: #1020 reviewed folder/site-browser and project-link contract available**. If absent, this lane waits; do not fake a folder-content API or mark the live finding closed with copy alone.

### S-23 — History starts with the business event · Wave 4

**Outcome:** The owner understands what changed and can open the affected record without decoding a stream of references.

**Owned findings:** UX-046 — history foregrounds raw references/system creation events.

**Likely files:** `src/components/history/RecordHistory.tsx`, `src/components/history/historyLabels.ts`, `src/components/history/historyFields.ts`, `src/components/history/useHistoryRefs.ts`. Preserve the exact timestamps/references in detail, recognizable record links and group bulk/system events without discarding history.

**Layer-1 proof:** extend/add tests in existing `src/components/history/__tests__/` against the shipped renderer and label/reference helpers. Assert user events, grouped bulk events, expanded original details, unknown event fallback, linked child records, and loading/unavailable context without fabricated names. Query batching remains intact.

**Risk:** UI-only · **Size:** M · **Dependencies:** none; deferred behind core money/workflows, no dependency on live record identities.

### S-24 — One phone pipeline navigation · Wave 3

**Outcome:** The owner selects a sales stage and reads recognizable projects without managing three horizontal positions.

**Owned findings:**
- UX-047 — funnel, stage strip and board each pan separately on phone.
- UX-048 — cards repeat stage/identifiers/weighting/tax machinery.
- UX-049 — Sales pipeline naming differs between destination and page.

**Likely files:** `pages/SalesPipeline.tsx`, `components/SalesKanbanBoard.tsx`, `components/ProjectCard.tsx`, `src/components/shell/routeMatch.ts`. Keep desktop board/funnel power; one phone stage selector controls one list. Preserve value, customer, useful next action and on-demand weighting/identifiers.

**Layer-1 proof:** `pages/SalesPipeline.test.tsx`, `components/SalesKanbanBoard.test.tsx`, `components/ProjectCard.test.tsx`, `src/components/shell/__tests__/routeMatch.test.ts`. Assert shared stage state/result count, full project recognition, title/navigation consistency and desktop preservation; rendered phone geometry checks no triple-scroller dependency. Do not drop sales as a destination.

**Risk:** UI-only · **Size:** M · **Dependencies:** S-14 card baseline; S-25 navigation baseline.

### S-25 — Approvals stays reachable without hiding Sales · Wave 1

**Outcome:** The owner reaches the decision inbox from every screen without discovering a rail scroll first.

**Owned findings:** UX-001 — daily approval work falls below the navigation fold.

**Likely files:** `src/components/shell/Rail.tsx`, `src/components/shell/AccountMenu.tsx` only if needed to retain secondary destinations. No route/palette rewrite in this slice.

**Layer-1 proof:** `src/components/shell/Rail.test.tsx`, `src/components/shell/__tests__/Rail.finance-approvals.test.tsx`, `Rail.rbac.test.tsx` (same test directory). Assert persistently placed counted Approvals, Sales retained, correct real-role destinations and phone-menu access. Targeted rendered rail-height gate at 800px proves reachability, not merely element existence.

**Risk:** UI-only · **Size:** S · **Dependencies:** none.

### S-26 — Finance empty states offer achievable next steps · Wave 5

**Outcome:** Each viewer understands what the empty invoice/payment/revenue view means and has one useful permitted next action.

**Owned findings:**
- UX-010 — empty copy asks viewers to perform unavailable actions.
- UX-011 — equal primary create actions repeat in header and empty body.

**Likely files:** `pages/SalesInvoices.tsx`, `pages/IncomingPayments.tsx`, `pages/RevenueByProject.tsx`. Shared-file-owner tail.

**Layer-1 proof:** `pages/__tests__/SalesInvoices.native.test.tsx`, `IncomingPayments.native.test.tsx`, `RevenueByProject.honesty.test.tsx` (all in that test directory). Admin/Finance get one real permitted create/receive entry; PM gets responsible-team scope and a useful project destination, not an impossible instruction. Loading/error/unavailable are not empty. Do not hide debt or a receipt because a filtered view is clear.

**Risk:** UI-only · **Size:** S · **Dependencies:** S-16, S-27, S-37 for file order; preserve canonical collection/receipt behavior.

### S-27 — Cash, settlement and optional withholding are clear · Wave 3

**Outcome:** Finance records cash and tax withheld with an understandable reconciliation without specialist fields crowding every receipt.

**Owned findings:**
- UX-054 — withholding fields/help are always expanded.
- UX-055 — Paid Amount versus Received Amount requires translation.

**Likely files:** `pages/IncomingPayments.tsx`; no changes to S-06's allocation mirror or calculation helpers.

**Layer-1 proof:** `pages/__tests__/IncomingPayments.createForm.test.tsx`, `IncomingPayments.currency.test.tsx` (same directory). Preserve automatic no-withholding prefill; reveal required evidence when Tax withheld is selected; prove amount settled = cash + recorded withholding where applicable, partial settlement and cancel/error/retained entries. Disclosure never silently clears a recorded deduction or relaxes validation.

**Risk:** money-path/SoD/RLS · **Size:** M · **Dependencies:** S-06; use its Received/Expected and allocation conventions.

### S-28 — My time and team review are distinct jobs · Wave 2

**Outcome:** Staff see saved/unsaved time clearly and managers can enter team review directly without an empty personal-week detour.

**Owned findings:**
- UX-062 — personal time entry competes with team review at entry.
- UX-063 — unchanged/empty time is offered for saving.
- UX-084 — transfer-engine status obscures time approval status.
- RF-061 — long project names overwhelm the time-entry picker.

**Likely files:** `pages/Timesheets.tsx`, `src/components/timesheets/PushStateBadge.tsx`. My time/Team review retain the canonical Approvals destination; picker shows recognizable code + short label with full accessible name. No project eligibility expansion.

**Layer-1 proof:** `pages/Timesheets.test.tsx`, `src/components/timesheets/PushStateBadge.test.tsx`. Assert role-sensitive entry, dirty/saved state, disabled unchanged Save, Submit's existing autosave, waiting/updating/current/failed/held accounting state secondary to approval, long labels and full identity. Preserve phone total/action strip and validation reachability.

**Risk:** UI-only · **Size:** M · **Dependencies:** none beyond the shipped Approvals route. S-18's same-wave review pattern is an integration target, not a prerequisite API. Merge through S-08 for copy.

### S-29 — Capture a receipt or first expense line immediately · Wave 3

**Outcome:** A claimant records the actual expense in one draft capture, with a reviewed category suggestion and no duplicate description burden.

**Owned findings:**
- UX-064 — a blank claim shell must be created before evidence/amount entry.
- UX-065 — accounting-route/category selection precedes the actual expense.
- UX-066 — Title and Purpose duplicate the first description task.

**Likely files:** `pages/expenses/ExpenseClaimFormModal.tsx`, `ExpenseLinesCard.tsx`, `ExpenseReceiptsCard.tsx` (same expense directory), `pages/ExpenseClaims.tsx`, `src/hooks/useExpenseClaims.ts`; use a new orchestration leaf under `src/lib/repositories/` if needed, not a Wave 3 repository-barrel collision with S-11.

**Layer-1 proof:** `pages/ExpenseClaims.test.tsx`, `pages/expenses/ExpenseLinesCard.test.tsx`, `ExpenseReceiptsCard.test.tsx` (same expense directory), `src/hooks/useExpenseClaims.test.tsx`; `supabase/tests/expense_claims_routing.test.sql` remains the route oracle. Prove first line/receipt persisted, duplicate-save prevention, upload/save recovery, cancel without orphaned evidence, editable derived title and explicit category correction. No silent category-based approval change; same evidence/claimant/approval contracts. One receipt→draft→reopen journey covers the cross-stack goal.

**Risk:** money-path/SoD/RLS · **Size:** L · **Dependencies:** S-12 readiness warning; preserve it during form composition.

### S-30 — Resolve an employee proposal deliberately · Wave 4

**Outcome:** The owner can choose an alternate PMO identity when a proposed employee match is wrong or absent, without silent reassignment.

**Owned findings:** UX-082 — employee confirmation has no resolution choice for an undecidable proposal.

**Likely files:** `src/components/timesheets/EmployeeLinkConfirm.tsx`; new narrowly scoped match read/write leaf under `src/lib/repositories/`, new server/migration files under existing `supabase/functions/` / `supabase/migrations/` only if needed. Do not edit the repository barrel owned by S-21 in this wave.

**Layer-1 proof:** `src/components/timesheets/EmployeeLinkConfirm.test.tsx`; new pgTAP/handler tests in existing Supabase directories for eligible identity choices, org scope, explicit confirmation and durable/audited link. Cover confident/wrong/no-proposal/ambiguous, alternate selection, failed save with selection preserved and reopened confirmed identity. Mutation-check consequential match validation. Conditional source-only finding requires a rendered synthetic unmatched case before acceptance.

**Risk:** money-path/SoD/RLS · **Size:** M · **Dependencies:** S-08 setup-review contract; S-18 review surface. Not a request to auto-link people by fuzzy name.

### S-31 — Numbering belongs to Project setup; Accounting has focused sections · Wave 2

**Outcome:** The Admin finds the right setup task directly and sees number-format help that agrees with the real validator.

**Owned findings:**
- UX-073 — project numbering is under Accounting.
- UX-074 — Accounting is a long page without local wayfinding.
- UX-075 — number-pattern help contradicts the saved/allowed example.
- RF-050 — project numbering is in the wrong setup destination.

**Likely files:** `pages/Administration.tsx`, `pages/admin/OrgProjectNumberPattern.tsx`; consume the existing `src/lib/projectNumberPattern.ts` validator, not a second grammar.

**Layer-1 proof:** `pages/AdministrationShell.test.tsx`, `pages/admin/OrgProjectNumberPattern.test.tsx`, `src/lib/projectNumberPattern.test.ts`. Assert section/hash focus, compatibility deep-link redirect, supported-token preview and no existing-reference renumbering. Focused accounting anchors lead to maps/tax/approvers/items; moving a control does not change who may save it.

**Risk:** UI-only · **Size:** M · **Dependencies:** none; S-08 uses the stable existing setup routes until anchors land. Same-wave link text goes through S-08's shared-file tail.

### S-32 — Show the resolved approval route · Wave 2

**Outcome:** The owner can verify who is eligible to approve when no explicit reviewer list is configured.

**Owned findings:** UX-081 — Standard role rules does not identify the actual approval route.

**Likely files:** `pages/admin/SpendApprovers.tsx`; use existing resolution/read methods without changing approval-policy implementation.

**Layer-1 proof:** `pages/admin/SpendApprovers.test.tsx`. Assert intentional role fallback versus configured-but-no-eligible-reviewer versus unavailable list, resolved role labels and permitted reviewer context. Preserve default/senior-routing and all SoD rules; the budget sole-operator exception is not generalized to spend approval.

**Risk:** UI-only · **Size:** S · **Dependencies:** none; consume settled policy, not a new policy decision.

### S-33 — Financial confirmation and recovery uses business consequences · Wave 6

**Outcome:** At consequential moments the user understands what will happen, what information is missing and the next real remedy.

**Owned findings:** UX-083 — cancellation/unmapping/forecast recovery/missing invoice-balance copy exposes backend state.

**Likely files:** `pages/SalesInvoices.tsx`, `pages/IncomingPayments.tsx`, `pages/admin/BudgetAccountMap.tsx`, `pages/BudgetProjection.tsx`, `pages/project-detail/ProjectFinancesSection.tsx`. Shared-file-owner tail. This owns the cross-cutting conditional-copy sweep; earlier slices own their primary layouts, not a second sweep dispatch.

**Layer-1 proof:** existing invoice/payment command-intent tests in `pages/__tests__/`, `pages/admin/BudgetAccountMap.test.tsx`, `pages/BudgetProjection.test.tsx`, `pages/project-detail/ProjectFinancesSection.test.tsx`. Render actual conditional dialogs/toasts: clear invoice/payment cancellation, budget-update stoppage until replacement, invoice balance unavailable and truthful retry/handoff. No `docstatus`, fail-closed jargon, raw adapter code or invented retry ETA. Keep confirmations, persistence and all controls unchanged.

**Risk:** UI-only · **Size:** M · **Dependencies:** S-01, S-04, S-10, S-16, S-26, S-27; last by design to avoid editing every financial screen concurrently.

### S-34 — Reports state period, currency and edit scope honestly · Wave 2

**Outcome:** The owner can reconcile the report's period and currency without reading fully billed foreign-currency work as confidently unbilled.

**Owned findings:**
- RF-035 — selected-range monthly rows and lifetime-to-date headlines appear to describe the same period.
- RF-036 — a foreign-currency contract invoiced in another currency shows a false positive contract-currency backlog.
- RF-038 — reporting offers progress edits for closed/non-progress work.
- RF-039 — inactive currencies repeat empty monthly rows.

**Likely files:** `pages/ManagementPack.tsx`, `src/lib/reports/managementPack.ts`, `managementPackExport.ts` (same reports directory), `src/lib/db/managementPack.ts`.

**Layer-1 proof:** `pages/__tests__/ManagementPack.test.tsx`, `src/lib/reports/managementPack.test.ts`, `managementPackExport.test.ts` (same reports directory), `src/lib/db/managementPack.test.ts`. Keep DD-MMP-1..6: explicitly label cumulative measures **Since project start, through <end>**, and monthly rows **Selected period**; do not silently redefine lifetime balances as period flows. Hide only currencies with no activity, contract or meaningful balance in that range; keep a discoverable scope explanation. Only eligible open progress-basis rows get Record progress.

For cross-currency billing, show the authoritative reconciliation if present; otherwise contract-currency backlog/its subtotal is **unavailable pending reconciliation**, not the untouched full contract as a known debt and not zero. Preserve invoice-currency rows. **Do not apply the live audit's suggested JISDOR conversion to accounting backlog:** DD-MMP-5 keeps currencies separate and PMO displays ERP accounting truth. Assert missing rate/reconciliation, partial billing, completed billing, cumulative totals and export null propagation with synthetic fixtures. This resolves the misleading claim without inventing an exchange-rate accounting policy.

**Risk:** money-display · **Size:** M · **Dependencies:** S-01 definitions; no dependency on uploading real exchange-rate data.

### S-35 — A company-position view includes cost, profit and collections · Wave 4

**Outcome:** The owner sees project cost-to-date/profit plus cash received and receivables context without switching to an external accounting screen.

**Owned findings:** RF-037 — the management pack's revenue-only view cannot answer the company-position job.

**Likely files:** `pages/ManagementPack.tsx`, `src/hooks/useManagementPack.ts`; new read-only composition leaf under `src/lib/repositories/`. Reuse S-02's batched project money and S-36's aging/collections links; no second cost or aging implementation.

**Layer-1 proof:** `pages/__tests__/ManagementPack.test.tsx`, `src/hooks/useManagementPack.test.tsx`. Assert per-project canonical Actual and billed-work profit, coverage/freshness, cash received separately from settlement, receivables drill-down, role scope and currency-separated totals. Label cost-to-date separately from selected-period revenue; when period cost snapshots are absent, do not pretend to compute period profit. “Cash received” is not bank balance/cash on hand. Unavailable cash/receivable inputs propagate rather than become zero. No posting/write path is added.

**Risk:** money-display · **Size:** M · **Dependencies:** S-02, S-06, S-34, S-36; existing read-set permissions remain authoritative.

### S-36 — Collections starts from the customer · Wave 3

**Outcome:** Finance sees who owes what and how late, then opens the relevant customer invoices directly.

**Owned findings:**
- RF-041 — no discoverable customer-aging collection journey was found in the live pass.
- RF-043 — company views lack a useful balance/overdue/open-invoice doorway.

**Likely files:** `src/components/dashboard/AccountingSnapshotsSection.tsx`, `FinanceDashboard.tsx` (same dashboard directory), `pages/Companies.tsx`, `pages/CompanyDetail.tsx`, `src/lib/db/erpSnapshots.ts`; new company-finance read repository leaf under `src/lib/repositories/` if necessary. No new top-level route required: enhance the existing Finance/Companies destinations and links to S-05 filters.

**Layer-1 proof:** `src/components/dashboard/AccountingSnapshotsSection.test.tsx`, `pages/Companies.test.tsx`, `pages/CompanyDetail.related.test.tsx`, `src/lib/db/erpSnapshots.test.ts`; extend `supabase/tests/erp_accounting_snapshots_rls.test.sql` for any new read contract. The shipped snapshot component already contains AR/AP buckets: reuse and make it discoverable, **do not claim aging data infrastructure is absent**. ERP buckets/report date/range labels are verbatim, not locally re-aged using PMO due dates (DD-DUE-1). Assert separate currencies, missing versus zero buckets, balance freshness, receivable versus payable, company/party mapping ambiguity and scoped invoice drill-down. One customer→aging→overdue invoice cross-stack journey proves the collections goal.

**Risk:** money-path/SoD/RLS · **Size:** L · **Dependencies:** S-03 Finance baseline, S-05 project/customer/overdue filtering; new identity joins are reviewed, not guessed from display names.

### S-37 — Revenue and receivables state their different tax bases · Wave 2

**Outcome:** The owner can compare earned/billed work and open receivables without mistaking tax-inclusive debt for excess revenue.

**Owned findings:** RF-040 — net revenue and gross AR appear side by side without basis labels.

**Likely files:** `pages/RevenueByProject.tsx`; reuse existing revenue/tax helpers, not new accounting math.

**Layer-1 proof:** `pages/__tests__/RevenueByProject.honesty.test.tsx`, `RevenueByProject.export.test.tsx` (same test directory). Assert net-of-tax revenue, gross/inclusive-VAT AR labels and equivalent export bases, missing tax evidence and currency handling. Never net ERP outstanding by locally subtracting guessed VAT merely to make two columns look comparable.

**Risk:** money-display · **Size:** S · **Dependencies:** S-01 money definitions; no dependency on a new reporting API.

### S-38 — Exchange-rate setup gives Finance a useful next step · Wave 2

**Outcome:** Finance understands missing reference-rate coverage and can review/import an approved file without confusing reference equivalents with accounting figures.

**Owned findings:** RF-054 — empty reference-rate history leaves foreign-currency equivalents unavailable without a useful setup path.

**Likely files:** `pages/AdministrationExchangeRates.tsx`, `src/lib/import/fxRatePreview.ts`; retain the existing BI parser/importer and reference-rate repository.

**Layer-1 proof:** extend/add page RTL in existing `pages/__tests__/`; `src/lib/import/__tests__/fxRateParser.bi.test.ts`, `fxRatePreview.test.ts` (same import test directory), `src/lib/fxEquivalent.test.ts`. Assert missing/partial date coverage, valid-file preview/confirmation, duplicate/invalid rows, no guessed prior-day rate, locale/date/source notes and import failure recovery. The one-time historical upload is a **separate owner/Finance-operated data action**, not performed by this docs/build task; prepared files stay private. Automatic future fetching is a follow-up capability, not an unapproved live job in this slice.

**Risk:** UI-only · **Size:** S · **Dependencies:** none; existing import contract is the baseline. S-34 must remain correct even with no rates uploaded.

### S-39 — Show tax basis, disclose tax machinery · Wave 4

**Outcome:** People see whether money includes VAT while detailed rate/base configuration appears only when useful or blocking billing.

**Owned findings:** UX-005 — tax implementation detail is always visible across record/card money.

**Likely files:** `src/components/ui/TaxBasisLabel.tsx`, `pages/project-detail/ProjectDetailHeader.tsx`, `components/ProjectCard.tsx`, `pages/approvals/SalesInvoiceApprovalRow.tsx`. S-14/S-05 already remove their local duplicate notes; this slice owns shared disclosure behavior, not another list-layout change.

**Layer-1 proof:** `src/components/ui/__tests__/TaxBasisLabel.test.tsx`, `pages/project-detail/__tests__/ProjectDetailHeader.test.tsx`, `components/ProjectCard.test.tsx`, `pages/approvals/SalesInvoiceApprovalSection.test.tsx`. Assert before/after-tax basis survives, details reachable by keyboard/touch, no hover-only needed fact, missing-rate message appears when genuinely blocking and no loss of VAT safeguards. Cover inclusive/exclusive/unknown, reduced bases and en/id; no new tax calculation.

**Risk:** money-display · **Size:** M · **Dependencies:** S-13, S-14, S-17, S-24 for stable header/card/row baselines; keep #1049's net fix.

### S-40 — Search the references people quote · Wave 3

**Outcome:** The owner finds a project, invoice or receipt by its customer order, invoice number or payment reference and opens the right record.

**Owned findings:** RF-056 — command search misses order/invoice/payment references even when names work.

**Likely files:** `src/hooks/useRecordSearch.ts`, `src/components/shell/CommandPalette.tsx`; a new scoped reference-search read leaf under `src/lib/repositories/` / `src/lib/db/` only if existing cached reads cannot supply the references. No edit to the Wave 3 repository barrel owned by S-11.

**Layer-1 proof:** `src/hooks/__tests__/useRecordSearch.test.tsx`, `useRecordSearch.dedupe.test.ts`, `useRecordSearch.enabled.test.tsx`, `useRecordSearch.rbac.test.tsx` (same hook test directory), `src/components/shell/__tests__/CommandPalette.test.tsx`; pgTAP in existing `supabase/tests/` owns any new search RPC scope. Assert exact-reference ranking, order aliases, all matching invoice/receipt destinations, caps/deduplication, disabled/closed palette fetch behavior, permissions, error recovery and full recognizable context. Do not turn every palette open into an unbounded all-invoice download. One search→canonical invoice/receipt navigation journey is sufficient if a new server search is added.

**Risk:** money-path/SoD/RLS · **Size:** M · **Dependencies:** S-05 invoice destination/filter contract and S-06 receipt detail destination; role gates remain based on the real role.

## Acceptance and execution boundary

- Each slice becomes its own signed EARS/AC issue plan before code; this backlog is not a substitute for exact task steps. Use the normal executor routing: bounded UI/display work through the ADW; money-path/SoD/RLS work Director-dispatched. No builds were run for this docs-only commission.
- TDD against shipped components/handlers/read models, not duplicated test logic. Unit/RTL own financial formulas, labels, filter/empty/error/permission states and interaction semantics; pgTAP owns data scope/constraints/RPC contracts. Add e2e only for the named genuine cross-stack goals. Geometry/axe/visual checks need a browser, but are not invented full-stack financial journeys.
- All UI slices get rich **synthetic** data at 390 and 1280/1440, en/id and both themes as applicable, including long names, missing/partial/zero values and role differences. Respect 32px desktop controls with measured comfortable phone hit areas, token colors, tabular figures, keyboard focus and readable headings. Preserve the authored design system, not a rebrand.
- Every owned finding graduates into its lowest sufficient test, affected routes × oracles cells and a retention note. The wave's shared-file owner carries the agreed records; every sibling's PR links its own proof and the owning retention commit. Nothing is accepted because the backlog exists or a generic detector passes.
- All three reviews, rendered Discover/re-render-until-clean, scoped local gates under the required locks, then CI's full PR gate. Existing tests are not weakened to fit the current screen. Respect shared DB/test locks and one worktree per dispatch; local green is not a substitute for CI. New data reads are batched, scoped and paginated; new mappings are consequential reviewed changes.
- Pause an individual gated lane if its external prerequisite is still open; continue independent ready lanes. No client data, screenshots, exports, prepared rate files, actual references, credentials or infrastructure coordinates in implementation issues, tests or public retention notes. Keep operational/data cleanup separate from code changes.

## Exact-once accounting and dispatch totals

A finding token occurs **only in its ownership/reservation entry above**; the summaries below use counts, not repeated lists. No finding has two slices. De-duplication combines equivalent work in those entries rather than duplicating tokens in a second merge ledger. A positive preservation note and a source-data-only artifact remain accounted, not silently dropped. #1047 is a partial baseline, #1048/#1049 is an in-flight external fix, and #1050 is an external activation build—not three blanket “done” claims.

| Input set | Input IDs | Owned by slices | External fix reservation | Unaccounted | Duplicate ownership |
|---|---:|---:|---:|---:|---:|
| Local-seed UX | 85 | 85 | 0 | 0 | 0 |
| Private live RF | 61 | 60 | 1 | 0 | 0 |
| **Total** | **146** | **145** | **1** | **0** | **0** |

**Proof:** complete numbered input ranges 1–85 and 1–61; their union is 146 distinct IDs. Output = 145 slice-owned + 1 external reservation = **146**. No merged-away finding is lost; related IDs share one owning implementation slice. The external reservation is not counted as a new dispatch or a shipped fix.

| Wave | Slice count |
|---|---:|
| 1 | 8 |
| 2 | 14 |
| 3 | 9 |
| 4 | 6 |
| 5 | 2 |
| 6 | 1 |
| **Total** | **40** |

| Risk tier | Slice count |
|---|---:|
| UI-only | 15 |
| money-display | 6 |
| money-path/SoD/RLS | 19 |
| **Total** | **40** |

Planning validation: exact ID occurrence/range checks, slice/wave/risk counts, existing-path checks, dependency ordering and same-wave write-set checks; no application verification or shipment is claimed.
