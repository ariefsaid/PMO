# Money in — source inventory and builder evidence

Companion to [the ≤60-line brief](money-in.md). Current facts below come from baseline `d18ba06b5c5e`; target decisions are explicitly separated. No product code, schema, tests or data change in this docs task. Source review establishes inventory, not pixel compliance. All screenshots/fixtures must be synthetic and contain no client identities or figures.

## PA-00 route-persona decisions

Each row answers arrival and completion before composition. PM means Project Manager. “Unavailable” denotes current product access, not a new proposed privilege. Read audiences are taken from `pmo-portal/src/auth/policy.ts`: invoices, receipts and management pack use the Admin/Executive/Finance/PM read set; company statements use Admin/Executive/Finance. Revenue rollup uses invoice read permission. `App.tsx` additionally feature-gates `/reports` on revenue. Preserve those distinctions in the merged home.

### `/sales-invoices` — KEEP collection

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | Invoice cases and their billing/collection status | Raise a draft or progress an eligible invoice |
| Executive | Customer/project balances and late invoices | Identify the collection case to discuss |
| Finance | Invoice identities, due dates and exact balances | Raise a draft or choose the next invoice to collect |
| PM | My project's invoicing and receipt position | Find the invoice explaining a project balance |
| Engineer | A recovery path because this money collection is unavailable | Return to my permitted work |

### `/sales-invoices/:invoiceId` — KEEP record/review

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | Invoice evidence, author, status and financial consequence | Approve an eligible other's draft or complete client delivery |
| Executive | What was billed, what remains due and its evidence | Understand the balance before a customer discussion |
| Finance | Lines, tax, due/received dates, balance and applied receipts | Approve an eligible draft or deliver/follow the issued invoice |
| PM | Project billing evidence and applied receipts | Explain this invoice's effect on project billing |
| Engineer | A recovery path because invoice evidence is unavailable | Return to permitted work |

### `/incoming-payments` — KEEP collection

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | Customer receipts with dates, status and invoice context | Record a client payment against the correct invoice |
| Executive | Receipts and their customer/invoice attribution | Find whether the customer payment was recorded |
| Finance | Recent receipts and their settlement context | Record a payment or locate the receipt to reconcile |
| PM | Receipts linked to project invoices | Find evidence that the customer paid |
| Engineer | A recovery path because receipts are unavailable | Return to permitted work |

### `/incoming-payments/:receiptId` — KEEP evidence record

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | Receipt, cash, withholding and all allocations | Verify settlement or cancel an eligible incorrect receipt |
| Executive | Received/expected/cancelled status and invoices settled | Understand what the receipt actually settled |
| Finance | Exact cash, withheld tax, unapplied cash and invoice allocations | Reconcile a receipt to invoice balances |
| PM | Which invoices this receipt settled | Explain the project's payment evidence |
| Engineer | A recovery path because receipt evidence is unavailable | Return to permitted work |

### `/revenue-by-project` — MERGE into Project revenue, Billing to date view

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | Project billing totals and unassigned invoices | Locate attribution or collection work |
| Executive | Billed revenue and open receivables by project/currency | Select the project needing a billing discussion |
| Finance | Net billed and gross open AR with separate currencies | Trace a balance to project or unassigned invoices |
| PM | Project invoice totals and unpaid balance | Explain billing position alongside earned work |
| Engineer | A recovery path because project revenue is unavailable | Return to permitted work |

The table has a job; a separate destination does not. Merge its current billing evidence into the report home; do not call its all-dates billed total period-earned revenue. Redirect to `/financial-statements?section=project-revenue&view=billing`.

### `/financial-statements` — KEEP Statements; host named Project revenue section

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | Supplied statement, scope, currency and current/prior periods | Inspect company accounts and identify a reporting exception |
| Executive | Comparable company statement evidence for the selected period | Review the period's financial position |
| Finance | Native account hierarchy, balances and generation provenance | Read and compare the selected statement reliably |
| PM | My permitted Project revenue section, not company accounts | Read project revenue; recover there from a Statements link |
| Engineer | The existing access explanation and Dashboard return | Return to permitted work |

PM's arrival describes the target shared route: today this route shows the statement denial to PM. The existing statement read remains unchanged. Project P&L choices remain restricted to admitted statement scopes and the existing statement audience; merging navigation does not make them PM-visible.

### `/reports` — MERGE evidence; RETIRE standalone Management pack destination

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | Earned, billed and backlog evidence by month/project | Find a reporting or progress exception in Project revenue |
| Executive | Period-earned versus invoiced project position | Decide which project revenue variance to investigate |
| Finance | Planned/recognised/invoiced/unbilled/backlog and export | Reconcile earned versus billed for the selected range |
| PM | My project progress basis behind recognised revenue | Inspect basis or record permitted month-end progress |
| Engineer | The existing access explanation and Dashboard return | Return to permitted work |

No persona names a second “management pack” job beside financial reporting. Keep the earned/monthly evidence, numeric CSV export and permitted progress capture in Project revenue; redirect `/reports?from=…&to=…` to `/financial-statements?section=project-revenue&view=earned&from=…&to=…`. Preserve the revenue feature gate. Dashboard Board pack becomes a quiet Project revenue doorway to Earned, not an apparent export button that navigates elsewhere.

## Current inventory

Paths in this section are relative to `pmo-portal/`. `ListPage` currently renders header/title/description/primary first, then filters → search → secondary filters → export/import → view; these pages mostly use the first, second and export slots. That is inventory, not authority over C-01. `DataTable` supplies its table/phone form, row menus and empty presentation; `EntityFormModal` supplies labeled header, validation/error summary, body, Cancel/submit, busy/error and dirty-close cycle.

Label-source notation: **common** = `public/locales/{en,id}/common.json`; **finance** = matching `finance.json`; `t('finance:…')` explicitly selects finance, otherwise these pages default to common. Keys below identify both EN/ID sources, with representative literal pairs in the catalogue appendix. Dynamic record/project/customer/account labels come from records, never translation catalogues. Missing translation falls back to source `t()` text; some raw English exceptions are noted below. The current catalogue files decide labels; the older CATALOGUES.md statement that ID is empty is not current evidence.

### Invoices — `pages/SalesInvoices.tsx`

Audience: read blocks Admin/Executive/Finance/PM; Engineer gets access explanation + Dashboard return (`financeCopy.youDonTHaveAccessToSalesInvoices` and related common keys). Create/received-date/e-Faktur/attribution/cancel/PDF are Admin/Finance, with each current ownership/status predicate. Draft approval also retains author exclusion. Role preview remains view-only. Never infer write access from the read set.

| Render order / branch | Block, fact and action | Visibility and EN/ID label source |
|---|---|---|
| Collection 1 | Sales Invoices title, client-invoice subtitle, New Invoice | Readers; creation Admin/Finance once mode resolves; common `financeCopy.salesInvoices/newInvoice`; finance `invoices.description` |
| 2 | Status segments; customer chip and Clear; project chip and Clear; Overdue only | After loading; chips only when scoped; native/ERP status choices differ; common `financeCopy.status*`, `dashboard.uxs36CustomerFilter*`, `financeCopy.project*`, `uxs05.overdueOnly`; finance `invoices.clearProject` |
| 3 | Search, then Export filtered/sorted XLSX | After loading; common `financeCopy.searchInvoices/searchSalesInvoices`; shared `ExportButton` defaults to literal English Export and entity name |
| 4 | Context-error alert and Retry context; Unassigned invoices chip and Clear | Conditional scope error/unassigned filter; common `uxs15.context*`, `invoiceProject.unassignedFilter`, `financeCopy.clearFilter` |
| 5, exclusive states | Loading rows; load-error + Retry; no invoices first-step copy; data table or no-match guidance | Readers; common `financeCopy.salesInvoicesLoadFailed/noSalesInvoicesYet/noInvoicesMatchYourFilters/tryADifferentStatusOrClearTheSearch`, `uxs26.invoiceEmptyProjectManager` |
| 5, populated table | Invoice number over customer and project link; reference; status; amount + tax basis + invoice-date FX; outstanding + latest FX; due date/overdue; conditional e-Faktur column | Readers. Columns use common `financeCopy.*`, `efaktur.column`, `uxs05.*`; e-Faktur only if any row has facts. Ordinary source order latest invoice date/created date/ID; Overdue only reorders oldest overdue first |
| 5, row menu | View; eligible PDF; assign/change project; received date; e-Faktur; cancel; eligible Approve/Submit | Read View; other actions Admin/Finance under existing predicates. `canEdit` branch exists but current policy exposes no Edit. Common `financeCopy.*`, `invoiceProject.*`, `efaktur.record` |
| 6, overlay | New/edit modal: ownership subtitle/push status → Invoice details (customer/project) → Line items (native description, ERP item lookup or code, ERP description when connected, quantity/rate, remove/add) → draft subtotal/tax/total and missing-currency/invalid-line/VAT remedy → footer | Admin/Finance creation. Native requires project; ERP project optional. Common `financeCopy.*`, `uxs16.*`, `uxs15.currencyUnavailable`. Edit component branch exists; current UI does not grant editing |
| 7, overlay | Project attribution modal: scope → project picker → Save; changing existing selection opens from/to confirmation; dirty/error cycle | Eligible Admin/Finance; `src/components/InvoiceProjectModal.tsx`, common `invoiceProject.*` |
| 8, overlay | e-Faktur modal: record identity → number/date → paired-field validation and save; discard confirmation | Eligible Admin/Finance; `src/components/EfakturModal.tsx`, common `efaktur.*`, `financeCopy.save` |
| 9, overlay | Received-date modal: help → date/min-date validation → Save/Cancel | Eligible Admin/Finance; common `financeCopy.recordReceivedDate/receivedDateHelp/receivedDate/receivedBeforeInvoiceDate/save` |
| 10, overlays | Cancel confirmation; Submit/Approve confirmation, result toast/error | Eligible Admin/Finance; common `financeCopy.cancelInvoice*`, `financeCopy.approveInvoice*`, `financeCopy.submit*`; preserve consequence, not implementation jargon |
| Record 1 | Named Back; loading/error Retry/not-found replace record content | Readers; common `financeCopy.backToInvoices/salesInvoicesLoadFailed/invoiceRecordNotFound*` |
| Record 2 | Invoice heading (issued number or draft/project fallback), customer | Readers; common `financeCopy.invoiceRecordTitle/draftInvoiceForProject/draftInvoice`, record labels |
| Record 3 | Collection details: invoice date, due date, status, outstanding/latest FX, conditional overdue days | Readers; common `uxs17.collectionSummary/invoiceDate/dueDate/status/outstandingUnavailable/overdue/daysOverdue`, `financeCopy.outstanding/statusPartlyPaid` |
| Record 4 | Client delivery: Ready to send or Received by client/date; manual-send help; approved PDF and record-received-date actions before receipt date exists | Issued ERP docstatus/status branch; actions Admin/Finance. Common `uxs17.deliverySection/readyToSend/receivedByClient/receivedDateSummary/manualHandoffHelp/downloadApprovedPdf/preparingPdf` |
| Record 5 | Bill evidence: load/error Retry; ERP line list qty × rate = amount, optional billing contact; applied receipt entries/date/amount and coverage/error copy | `SalesInvoiceEvidenceSection` in same file. Readers; common `uxs17.billEvidence/invoiceLines/billingContact/appliedReceipts` and state keys. Native line evidence is supplied separately by preview |
| Record 6 | Approval preview: project, optional customer PO, native author; native lines; net/tax/total and FX | `pages/approvals/SalesInvoiceApprovalRow.tsx::SalesInvoiceApprovalPreview`; readers; common `financeCopy.project/customerPO/lineItemsSection`, `approvals.salesInvoices.*`; customer omitted on record because already headed |
| Record 7 | Continue to approve after preview; approval confirmation | Eligible Draft reviewer only; common `financeCopy.continueToApprove/approveInvoice*`. Record early return currently renders this confirmation independently of collection overlays |

Invoice export additionally retains customer, invoice/received dates, e-Faktur pair and ISO currency even where absent from the default columns. `EfakturCell` displays number/date without extra copy. `FxEquivalent` shows supported conversion, no-rate or rate-error text from common `fx.*`; native amounts remain the authority.

### Receipts — `pages/IncomingPayments.tsx`, `pages/incoming-payments/ReceiptRecord.tsx`

| Render order / branch | Block, fact and action | Visibility and EN/ID source |
|---|---|---|
| Access branch | Access explanation, Dashboard return | Engineer; common `financeCopy.youDonTHaveAccessToIncomingPayments/theIncomingPaymentsListIsAvailableToFinanceProjectManagersAndExecutives/backToDashboard` |
| Collection 1 | Incoming Payments title, ownership-dependent subtitle, Receive Payment | Readers; create Admin/Finance when mode resolved; common `financeCopy.incomingPayments/nativeIncomingPaymentsDescription/paymentsReceivedFromClientsMirroredFromERPNextLinkedToSalesInvoicesWhenApplicable/receivePayment` |
| 2 | Status segments, search, Export XLSX | After loading; native All/Received/Cancelled versus ERP All/Expected/Received; common `financeCopy.statusAll/statusCancelled/searchPayments/searchIncomingPayments`, `uxs06.statusExpected/statusReceived`; Export literal English |
| 3, exclusive states | Loading; error + Retry; no payments first-step; rows/no-match | Readers; common `financeCopy.incomingPaymentsLoadFailed/noIncomingPaymentsYet/noPaymentsMatchYourFilters/tryADifferentStatusOrClearTheSearch`, `uxs26.receiptsEmptyProjectManager` |
| 3, rows | Payment link → invoice (first + more) → reference → customer → status → amount → date; Cancel row menu | Readers; cancellation eligible Admin/Finance. Common `financeCopy.payment/invoice/reference/customer/status/amount/date`, `uxs06.invoiceAndMore`. Source sorts date, created date descending then ID ascending; no sort control |
| 4, overlay | Receive modal header/ownership push feedback → customer, invoice picker → amount settled, cash → Tax withheld disclosure + retained summary; withheld amount/slip fields → payment date → Record payment/Cancel | Admin/Finance. Native invoice required and defaults outstanding; ERP optional; common `financeCopy.*`, `uxs27.*`. Values/error/busy/dirty-close cycle from EntityFormModal |
| 5, overlay | Cancel confirmation with native versus ERP consequence; success/error toast | Eligible Admin/Finance; common `financeCopy.cancelPayment*/nativeCancelReceiptBody/receiptCancelled` |
| Record 1 | Back; loading or error Retry or not-found replaces content | Readers; common `uxs06.backToReceipts/receiptNotFound/receiptNotFoundBody`, `financeCopy.incomingPaymentsLoadFailed` |
| Record 2 | Receipt number title, Received/Expected/Cancelled word status, customer + date | Readers; common `uxs06.receiptTitle/statusReceived/statusExpected`, `financeCopy.statusCancelled`; data-derived customer/date |
| Record 3 | Receipt total; cash only if different; withholding + slip only if nonzero; unapplied only if positive | Readers; common `uxs06.receiptTotal/unappliedCol`, `financeCopy.cashReceived/taxWithheld`. Missing total uses `uxs06.notReported` |
| Record 4 | Some figures weren't reported | Conditional missing facts; finance `receipts.someUnreported` |
| Record 5 | Invoices this receipt settled: unknown coverage, known on-account, or full allocation table (invoice link + applied amount/currency) | Readers; common `uxs06.settledTitle/coverageUnknown/onAccount/applied/invoiceNotInPmo/notReported`, `financeCopy.invoice`. Record currently has no write CTA |

Receipt XLSX includes cash received, withheld, unapplied, slip and row currency beyond its seven visible columns. Known zero withholding/unapplied maps to None; null maps to Not reported. Do not convert those semantics into zero during recomposition.

### Revenue rollup — `pages/RevenueByProject.tsx`

| Order | Block, fact/action | Visibility and EN/ID source |
|---|---|---|
| Access branch | Revenue access explanation + Dashboard return | Engineer; common `financeCopy.youDonTHaveAccessToRevenueByProject/theRevenuePerProjectViewIsAvailableToFinanceProjectManagersAndExecutives/backToDashboard` |
| 1 | Revenue by Project title, Unassigned-group subtitle, New Invoice doorway | Readers; create Admin/Finance. Common `financeCopy.revenueByProject/newInvoice`, `revenueByProject.subtitle` |
| 2 | Total Revenue net of tax and Open AR gross-tax-included KPI tiles, each per currency, loading skeleton/error | Readers; common `financeCopy.totalRevenue/openAR`, `uxs37.billedWorkTaxBasis/openReceivablesTaxBasis`, `uxs03.notAvailableYet` |
| 3, exclusive states | Loading; revenue/currency error; no revenue first-step copy | Readers; common `revenueByProject.currencyError*`, `financeCopy.noRevenueDataYet/createSalesInvoicesToSeeRevenuePerProject`, `uxs26.revenueEmptyProjectManager`. Non-currency error title/body currently raw English |
| 3, populated | Project link or Unassigned doorway → total net revenue → gross open AR → invoice count; per-currency footer totals | Readers; common `financeCopy.project/unassigned/totalRevenue/openAR/invoices/total`. Project opens canonical project; Unassigned opens `/sales-invoices?attribution=unassigned`. Export-only currency metadata exists but no rendered Export control. Accessible Open labels currently raw English |

The rollup has no period/search/filter toolbar. Names prefer project short name for screen, contractual name for export metadata. Never assume it is the monthly pack's period-based recognised figure.

### Statements — `pages/FinancialStatements.tsx`, `src/components/financial-statements/*`

| Order | Block, fact/action | Visibility and EN/ID source |
|---|---|---|
| Identity branch | Financial statements h1 + loader while identity resolves | Current route audience awaiting identity; common `shell.nav.financialStatements` |
| Access branch | Same title, access heading/body, Dashboard return | Ineligible identity/role; common `financialStatements.accessDenied/accessDeniedDescription/backToDashboard` |
| 1 | Financial statements title | Admin/Executive/Finance; common `shell.nav.financialStatements` |
| 2 | Period type (month/quarter/fiscal year), supplied current/prior period pair; statement selector (TB/P&L/BS); scope selector only on P&L with admitted projects | Readers; `StatementPeriodPicker.tsx`, common `financialStatements.periodKind/period/month/quarter/fiscalYear/choosePeriod/noPeriods/statement/trialBalance/profitAndLoss/balanceSheet/scope/companyScope/chooseScope/prior` |
| 3 | Selected statement section heading; loading/error Retry/unavailable mutually exclusive | `FinancialStatementsSection.tsx`; common `financialStatements.*`; controls only when catalogue complete. Invalid/unadmitted selection never substitutes a fabricated statement |
| 3, complete header | Updated/as-of provenance, delayed/background-failed/refreshing status, Retry when delayed; no-activity replaces table | `AccountingSnapshotProvenance`, section component; common `financialStatements.updated/delayed/refreshing/retry/noActivity/noActivityDescription` |
| 3, table scope | Company label when supplied, report period/As at and currency; Collapse/Expand all; TB current/prior toggle | `NativeStatementPair.tsx`; common `financialStatements.current/prior/notProvided/asAt`; finance `statements.forThePeriod/amountsIn/periodShown/collapseGroup/expandGroup/collapseAll/expandAll` |
| 3, table evidence | Account hierarchy + toggles, native totals; TB one period's monetary columns; P&L/BS adjacent current/prior columns; one empty comparison side noted; contained scroll/sticky account/headers | Native payload supplies account/column labels, not EN/ID UI translations. Missing lexical cell = Not provided semantic; known zero has dash visual plus numeric accessible text. No value recomputation or export/create button |

Statement selection is currently local React state, not URL state. Native report labels are source-owned financial content; localizing surrounding controls must not rewrite account names or raw money tokens.

### Management pack — `pages/ManagementPack.tsx`, `src/components/reports/RecordProgressModal.tsx`

| Order | Block, fact/action | Visibility and EN/ID source |
|---|---|---|
| Access branch | Pack access explanation + Dashboard return | Engineer; common `managementPack.noAccessTitle/noAccessSub`, `financeCopy.backToDashboard` |
| 1 | Monthly management pack title, net-of-tax description, quiet Export CSV | Admin/Executive/Finance/PM with revenue feature; common `managementPack.title/description`, `projects.export` |
| 2 | From and As at month inputs (URL `from/to`) | Readers; common `managementPack.from/asAt` |
| 3 | Loading/error four placeholder KPIs; populated cumulative-scope line + per-currency recognised-to-date/invoiced-to-date/unbilled/backlog KPI grids | Readers; common `managementPack.col.*`, `uxs34.cumulativeScope/backlogReason/backlogUnavailable`, `uxs03.notAvailableYet`; exact title values behind compact tiles |
| 4, exclusive states | Loading table rows; error with range-specific correction (≤24 months) or Retry; no projects explanation | Readers; common `managementPack.errorTitle/invalidRange/errorSub/retry/emptyTitle/emptySub` |
| 4, populated | Projects as at month heading → project table: project/code or Unassigned/other currency; contract, recognised/invoiced-to-date, unbilled/billed-ahead, backlog, progress/invoiced basis, Record progress; per-currency footer totals | Readers; common `managementPack.projectsAsAt/col.*/unassigned/otherCurrency/billedAhead/basis.*/actions/recordProgress/total`, `uxs34.*` |
| 5 | Monthly totals heading/table: month → currency → planned/recognised/invoiced/unbilled/backlog | Readers; common `managementPack.monthlyTotals/col.*`; no graph |
| 6 | Undated-invoice exclusion note | Conditional count; common `managementPack.undated` |
| 7, overlay | Record progress: project scope → month, percent complete (delivery % suggestion only), optional note → Save progress/Cancel; inline validation/error, dirty guard, success | Eligible contract status + existing progress permission: Admin/Executive/Finance or assigned PM. Common `managementPack.progressModal.*`; `RecordProgressModal.tsx`. No automatic application of delivery percentage |

CSV is long-format project × month, including project identity, currency, tax basis, planned/recognised/invoiced, cumulative measures, unbilled/backlog and basis. Currency totals remain separate; unavailable backlog remains unavailable. Monthly totals and as-at project rows have different temporal meanings even where the final month agrees.

## Target interaction contracts

- **Page frame:** use [shell.md](shell.md) for one aligned track and contextual Back; this area supersedes its Money navigation order only by replacing Revenue by Project + Management pack with the single Financial statements/report home. Keep invoice/receipt entries. `areas.md` records current routes, not a veto on this PA-00 merge.
- **Toolbar ownership:** compose these page toolbars locally with existing primitives to satisfy C-01; do not silently alter the shared ListPage order for every module. Creation moves to toolbar; record PDF stays header; draft approval and form submission stay below evidence. Never show two filled actions when a modal is active.
- **Invoices URL:** retain `q,status,customer,project,overdue,attribution,create`; add `sort` (`due-asc`, `overdue-desc`, `invoice-date-desc`). Explicit user sort persists; changing to Draft/Paid/Cancelled selects invoice-date default only when no explicit sort. Due sort puts overdue first in due-date order, then upcoming; unknown dates last; stable ID ties. `create=1` and inherited project/customer intent must still open exactly once.
- **Receipts URL:** `q,status,customer,sort=payment-date-desc`; retain accepted existing deep-link parameters. Opening a receipt carries source URL and scroll in navigation state; refresh can reconstruct list scope from query. Direct record entry falls back to owning list. Browser Back is native; named Back uses captured source, never an unconditional bare collection URL.
- **Reports URL:** `section=statements|project-revenue`; Statements owns `statement=trial_balance|profit_and_loss|balance_sheet`, `scope=company|<project>`, `periodKind=month|quarter|fiscal_year`, `periodStart=<date>`, `tbSide=current|prior`, `collapsed=<encoded group keys>`. Revenue owns `view=earned|billing`, `q,project,currency,sort=project-name-asc,history=0|1,from,to`. Preserve each section's values when switching; serialize/share/refresh reproduces selected evidence. No selector silently broadens an unavailable project scope to Company.
- **Invalid values:** normalize unknown section/view/sort to the role's permitted default, show unavailable selection for missing period/project, offer Choose scope/period; malformed or reversed earned ranges get the existing range correction, preserving entered dates. Section navigation has active text and `aria-current`; selection does not introduce fake tabs between unrelated jobs.
- **Access and redirect:** resolve requested section before applying its own existing read gate; do not run company statement hooks for PM's revenue section. PM sees only Project revenue navigation; direct Statements request explains unavailability and links there. Admin/Executive/Finance see both; Engineer existing denial/Back. Earned preserves revenue feature eligibility; Billing preserves invoice-read eligibility independent of that gate. Disabled Earned feature must not block Billing or Statements. Replace legacy URLs only after role/feature resolution; never redirect-loop.
- **Revenue evidence:** Earned is as-at cumulative position with From used for history/export; Billing is all invoice dates, not the earned range. Put time/tax basis beside the selected view; do not imply reconciliation between distinct datasets. Retain other-currency and Unassigned rows. Each view has its own per-currency totals once, not tiles plus footer. Native net billed, ERP gross AR and recognised amounts remain distinct measures.
- **Exports:** Earned keeps current long CSV semantics for the chosen range (including all months even when history is collapsed); clarify “Export monthly data”. Billing offers numeric project/currency/net-billed/gross-open-AR/count export from existing metadata; clarify “Export billing totals”. Filtering exports the same project/currency population; empty/unavailable export is disabled with an adjacent reason. Invoice/receipt XLSX keeps hidden details, numeric amounts, ISO currency and current filter/sort. Export labels and filenames must use the selected language, not hardcoded English.
- **Unknown/empty:** invoice/receipt no data teaches permitted creation in the toolbar, or says Finance records it for readers; no matches offers Clear filters. Billing no data links Finance/Admin to invoices, readers to their project. Earned no projects explains eligibility and offers Projects; no matched project/currency offers Clear filters. Statement no activity is a known empty period; no saved statement is unavailable, not zero. On report errors keep successful independent evidence; one scoped abnormal note lists affected fields/recovery, with linked cells instead of repeated caveats.
- **Disclosure:** reference/e-Faktur/secondary receipt measures remain labeled and reachable. Withholding fields auto-open on invalid retained values. History contains planned/monthly measures; contact detail hides only when absent, not on uncertain load. Preserve all native invoice lines/ERP lines once according to ownership. Applied receipt entries become actual receipt links, with native amounts and currency untouched.
- **Phone:** no new charts or compressed axes. Lists use identity/context → status/date → key amount/Open; statement comparison scroll is inside a labeled keyboard-accessible region with account identity retained. Modals fit 390px, focus traps/returns correctly, labels wrap, and error summary moves focus to offending field; submit remains after evidence and outside any covering sticky bar. At 390×844, record author/PO and secondary fields may follow the key balance, but approval cannot precede them.

## Retired or merged blocks and reasons

| Current block/home | Decision and remaining home | Why / persona outcome |
|---|---|---|
| `/reports` separate destination and Management pack navigation | MERGE into Financial statements → Project revenue → Earned | Executive/Finance's job is earned-versus-billed analysis, not choosing between two vaguely named report homes |
| `/revenue-by-project` separate destination | MERGE into Project revenue → Billing to date | Current billing context shares the project-analysis job; retain project/unassigned doorways |
| Revenue New Invoice primary | RETIRE duplicate doorway; invoice toolbar owns creation | Analysis reader does not arrive to create an unrelated transaction; direct invoice-create links remain valid |
| Revenue two KPI totals; pack four-per-currency KPI grids and skeleton grids | RETIRE duplicated totals, retain each measure in selected table/footer | Finance should read the same scoped total once; no empty tile grid delays first row |
| Pack standalone Monthly totals card | MERGE into Monthly history disclosure, retaining export and every measure | Monthly trend evidence is secondary to the chosen as-at project decision |
| Repeated backlog/FX/missing-allocation warning paragraphs | MERGE into one page-level abnormal note with affected-scope items | Finance needs one reliable remedy, not repeated contradictory caveats |
| Split invoice evidence/preview identity, lines and amounts | MERGE into one ownership-aware record sequence | Reviewer needs full lines, tax and author evidence once before approval |
| Dashboard Board pack export-shaped navigation | MERGE/rename to Project revenue doorway, Earned default | Label must name navigation result; actual CSV belongs with report evidence |

## Builder acceptance

Capture each row below at **1440×900 and 390×844, EN/ID, light/dark**. Every changed view, disclosure, status and period requires a capture, not only the happy path. Use rich synthetic fixtures: long names/labels, multiple native currencies, known zero and null, partial payment, multiple allocations and one side empty. Manifest records exact URL/role/data state; action/return pairs show before/after; owner judges rendered evidence. Static review does not prove geometry or accessibility.

| Route / view | Decision-relevant states and transitions to screenshot | Role proof |
|---|---|---|
| `/sales-invoices` | Populated default due sort; all native/ERP status choices; oldest-overdue; customer/project/unassigned scopes; loading/error Retry/no data/no match Clear; long foreign-currency and e-Faktur rows; export busy/disabled | Finance/Admin write vs Executive/PM read; Engineer denial; view-only preview |
| Invoice creation overlays | Direct/inherited `create=1`; native/ERP capture; customer change clearing incompatible project; item lookup/loading/no matches; missing project currency/VAT; invalid qty/rate; line add/remove; totals; dirty discard; pending/error retained values/success | Finance + Admin; readers never gain creation |
| `/sales-invoices/:invoiceId` | Draft author vs eligible reviewer; issued ready-to-send vs received; Paid/Cancelled/partial; all lines/tax/PO/author; evidence pending/error/unknown; applied-receipt link; unavailable due/FX; missing record; PDF idle/busy/failure; receive-date, attribution, e-Faktur save/error and cancel/approve confirmation | Finance/Admin eligible and ineligible author/status/ownership; Executive/PM read |
| `/incoming-payments` | Native Received/Cancelled and ERP Expected/Received; latest-date ordering; search/customer/status; loading/error/no data/no match; foreign-currency/excess payment; export; cancel confirmation/result | Finance/Admin writes; Executive/PM read; Engineer denial |
| Receipt capture | Native/ERP requiredness; selected invoice/outstanding/default currency; part/excess; cash versus withheld; closed/open withholding with retained summary; slip validation; date bounds; dirty/pending/error/saved | Finance/Admin only |
| `/incoming-payments/:receiptId` | Received/Expected/Cancelled; cash=total versus distinct cash/tax/slip; positive/zero/unknown unapplied; multi-invoice allocations; on-account versus unknown coverage; missing/error/loading; allocation open → invoice → return | All four readers; Finance/Admin eligible cancel; preserve read-only default |
| `/financial-statements?section=statements` | TB/P&L/BS × month/quarter/fiscal year; TB current/prior; company/admitted project P&L; group/all collapse/expand; current/prior one-side and both-side no activity; null versus lexical zero/negative/large precise amounts; loading/no catalogue/unavailable/error/Retry; fresh/delayed/background refresh/failure; invalid scope/period | Finance/Admin/Executive; PM permitted-section recovery and no company read; Engineer denial |
| `?section=project-revenue&view=earned` | Populated as-at; range change; invalid/missing/reversed/overlong range; each currency; recognised vs billed-ahead/unbilled/backlog; missing foreign-currency backlog; other-currency/Unassigned; undated count; history closed/open; progress modal dirty/invalid/error/saved; CSV busy/empty | Admin/Finance/Executive; assigned vs other PM progress permission; revenue feature off |
| `?section=project-revenue&view=billing` | Populated all-date net billed/gross AR/count; currency filter; known zero/null; org-currency pending/error; unassigned → filtered invoices; project open → return; search no match; no data/error/retry/export | Four existing revenue readers; feature-off Billing remains independent |
| `/reports?from=…&to=…`; `/revenue-by-project` | Redirect to correct view/scope; direct/reloaded legacy link; browser Back avoids bounce; role/feature recovery; both report section switches preserve independent selection | PM, Finance, Admin, Executive; Engineer denied; never acquire statement access |
| Dashboard/rail/palette doorways | Single canonical report home, no duplicate old destinations; Project revenue doorway opens Earned; direct PM entry selects permitted section | Four audiences with role-aware navigation |

Rules: PA-00–04, N-01–04, A-01–04, E-01–04, C-01–06, S-01–05, L-01/02. Prove retained filters/sort/period/scroll and browser Back by interaction; prove currency/unknown/basis/precision with behaviour tests. Run `scripts/ux-proof.sh` on every touched retained/redirect route, static detector, axe serious/critical = 0, one h1, document scrollWidth ≤ clientWidth, ≥44×44 phone targets and existing tokens only. Capture every period/view in the same figure form (S-02); no document approves pixels in advance.

### Test disposition

Delete look-pinning assertions **only when recomposing the owning surface**, not whole files containing money/role/accessibility oracles. This task deletes none. Paths below are relative to `pmo-portal/`.

| Path / affected assertion | Disposition |
|---|---|
| `pages/__tests__/SalesInvoices.fin1.test.tsx`: at-most-seven columns, combined primary-cell placement, removed chrome/invisible secondary-label assertions | DELETE composition/visibility pins; KEEP full readable amounts, overdue predicate/order, row access, project identity and numeric export behaviour |
| `pages/__tests__/SalesInvoices.fin2.test.tsx`: exact presence/absence of empty section headings | DELETE heading-topology pins; KEEP real line/contact/receipt evidence and unknown coverage assertions in the merged record |
| `pages/__tests__/IncomingPayments.fin5.test.tsx`: seven-column cap / fixed omission from default columns | DELETE layout pins; KEEP receipt facts, withholding/unapplied/null semantics, allocations, export values and record opening |
| `pages/__tests__/RevenueByProject.honesty.test.tsx`: exact KPI skeleton/duplicate-value counts, footer/column placement and `.font-mono` query | DELETE composition-only expectations; MOVE/KEEP honest loading/error/zero, per-currency isolation, tax basis, amount precision and readable values under Billing |
| `pages/__tests__/ManagementPack.test.tsx`: exact KPI/section counts, typography classes, `.sr-only` header placement, required `<tfoot>` topology | DELETE appearance/placement pins; MOVE/KEEP cumulative vs monthly meaning, null backlog, per-currency totals, feature/role/range/retry/progress and numeric CSV oracles under Earned; totals still asserted once semantically |
| `src/components/financial-statements/NativeStatementPair.test.tsx`; `e2e/financial-statements-presentation.spec.ts` | KEEP hierarchy, grouping controls, lexical precision, source totals, null versus zero, period sides, overflow/a11y and screenshot state coverage. Replace only obsolete screenshot baselines or class/spacing pins after rendered approval; do not delete financial table semantics |
| `pages/__tests__/FinancialStatements.scope.test.tsx`; `src/components/financial-statements/{FinancialStatementsSection,StatementPeriodPicker,ProjectStatementTotals}.test.tsx` | KEEP admission/identity/role, period/scope selection, query isolation, retry/background/no-activity semantics; add merged-section deep-link/refresh/back proof at lowest sufficient layer |
| `pages/__tests__/SalesInvoices.{native,createForm,assignProject,efaktur,deepLink,customerFilter,commandIntent,invoicePdf,fx,dueDate,vocabulary}.test.tsx` | KEEP behaviour, locale, money, safeguards, PDF and single-intent/context goals; adapt intentional control steps only |
| `pages/__tests__/IncomingPayments.{native,createForm,commandIntent,currency}.test.tsx`; `src/components/{InvoiceProjectModal,EfakturModal}.test.tsx`; `pages/approvals/SalesInvoiceApprovalSection.test.tsx` | KEEP mutation contracts, amounts/date/withholding validation, permission/author checks, confirmation/discard and success/error cycles |
| `pages/__tests__/Revenue.exportNumeric.test.tsx`, `pages/__tests__/Revenue.exportAndCurrency.test.tsx`, `pages/__tests__/RevenueByProject.export.test.tsx`; `src/hooks/useManagementPack.test.tsx`; `src/components/reports/{RecordProgressModal,BoardPackAction}.test.tsx`; `src/lib/reports/managementPack.i18n.test.ts` | KEEP numeric export/per-currency/translation/progress oracles; update BoardPack navigation goal to named Earned home and rollup tests to merged component |
| `e2e/AC-MMP-016-management-pack.spec.ts`, `e2e/serial/AC-SAR-040-sales-invoice.spec.ts`, `e2e/serial/AC-WHT-002-receipt-withholding.spec.ts`, `e2e/AC-S40-005-search-finance-reference.spec.ts`, `e2e/AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts` | KEEP user goals and cross-stack assertions, including accessible reachable row actions/contained scroll; update deliberate navigation to canonical sections and reapprove visual goldens only |
| `src/components/shell/__tests__/Rail.reports.test.tsx` | Replace old independent-route expectation with single role-aware report home; KEEP feature/role visibility and accessible navigation behaviour |

Builder adds owning unit/RTL proof for query state/redirect recovery and merged section gates; retained DB/RPC money/role tests remain authoritative and are not rewritten for composition. E2E proves curated navigation/transaction journeys, not arbitrary block coordinates. Follow project e2e conventions before editing those tests.

## Skill and detector evidence

- **/shape:** one discovery round from PRODUCT and route source, as requested; transaction cases belong to collections/records, supplied account comparison to Statements, earned/billed project analysis to one named report section. Questions skipped: the owner supplied the personas, constraints, decision authority and required deliverables and instructed direct completion.
- **/critique:** independent source assessments A (design) and B (detector), then synthesis; no rendered assessment claimed. A identified unclear merged-section gating, stale navigation, inherited toolbar order, unspecified query-state keys and ambiguous all-date billing/export. The target contracts above resolve these. Strengths retained: exact native evidence, distinct account/report jobs, one action after decision evidence. Pixel hierarchy, density, emotional response and heuristic scoring await rendered review rather than invented scores.
- **/layout:** shared frame, linear evidence order, full content track, local C-01 toolbars and phone identity-first rows replace equal KPI grids and split record summaries. Scope/controls are adjacent to their result, never an empty sidebar.
- **/distill:** retire two destination labels and duplicate KPI grids; merge invoice evidence, monthly totals disclosure and caveat repetition. Preserve every distinct measure and its time/tax/currency basis.
- **/onboard:** empty teaches the permitted first transaction or report eligibility; no-match clears scope; unavailable names recovery. No tour, sample money or extra competing primary. Taste v1 lenses applied: hierarchy, repeated facts, clipped identity and generic card grids; use existing Inter/tabular tokens, not its optional font/colour/motion recipes.
- Requested `.claude/skills` was missing. `scripts/vendor-skills.sh` ran but stopped at upstream Taste's removed `skills/taste-skill-v1` directory. Impeccable installed; existing local vendored Taste v1 and UI UX Pro Max were copied into this ignored skill tree from the sibling `redesign-projects` worktree. No tracked skill/script changes. Context loaded once against `pages/SalesInvoices.tsx`; requested playbooks and token authority read.
- UI UX Pro Max `python3 .claude/skills/ui-ux-pro-max/scripts/search.py '<query>' --domain ux -n 3`: **invoice list**, **payment record**, **financial statement** returned no match; **report page** returned an off-topic Image Optimization plus relevant Active State; **aging table** returned Table Handling (Web). One narrower retry each: **table sorting** → Table Handling (usable mobile containment, no sorting recommendation); **form error feedback** → Submit Feedback/Error Recovery; **comparison table** with `--domain chart` → comparison chart guidance (reject chart recipes; exact statements remain native tables); **active section navigation** → Active State (apply; ignore unrelated Smooth Scroll). Financial-statement composition is therefore grounded in source + UX rules, not a verified domain-specific database match. No aging chart is added; due/overdue evidence stays on invoices; dashboard aging stays in its owning area.
- **Static detector: 0 findings**, exit 0, JSON `[]`, no stderr; rule counts `{}`. Exact command below. Targets contain 526 unique TS/TSX files (505 in broad pages tree, including approvals/receipt record; 21 supporting component files). The tool reports findings only, not a scanned-file count: 526 is the target-tree inventory, not a claim every file type/test is scanned. Source clean does not establish 390/1440 rendered compliance. Assessment A was completed independently before B's result entered synthesis. No browser/server/overlay was started in this docs-only task.

```sh
.claude/skills/impeccable/scripts/impeccable detect --json \
  pmo-portal/pages \
  pmo-portal/src/components/financial-statements \
  pmo-portal/src/components/reports \
  pmo-portal/src/components/InvoiceProjectModal.tsx \
  pmo-portal/src/components/EfakturModal.tsx \
  pmo-portal/src/components/EfakturCell.tsx \
  pmo-portal/src/components/fx
```

## EN/ID label-source appendix

Literal key audit follows for the five page sources and supporting record/form/statement/report components. Entries name the current catalogue source and value, not proposed copy. Native business/account labels remain payload-owned. Generic shared primitives (Cancel/Retry/Export, row menus) retain their own source; explicit raw-English exceptions are called out in the block inventory.

| Source key | EN | ID |
|---|---|---|
| `common.json` → `approvals.salesInvoices.gross` | Total due | Total tagihan |
| `common.json` → `approvals.salesInvoices.net` | Net (before tax) | Neto (sebelum pajak) |
| `common.json` → `approvals.salesInvoices.raisedBy` | Raised by | Dibuat oleh |
| `common.json` → `approvals.salesInvoices.showDetails` | Show invoice details for {{customer}} | Tampilkan detail faktur untuk {{customer}} |
| `common.json` → `approvals.salesInvoices.tax` | Tax | Pajak |
| `common.json` → `dashboard.boardPack.ariaLabel` | Board pack (coming soon) | Board pack (segera hadir) |
| `common.json` → `dashboard.boardPack.label` | Board pack | Board pack |
| `common.json` → `dashboard.boardPack.tooltip` | Board pack export arrives with Reports | Ekspor board pack hadir bersama Laporan |
| `common.json` → `dashboard.uxs36CustomerFilterClear` | Clear customer filter | Hapus filter pelanggan |
| `common.json` → `dashboard.uxs36CustomerFilterLabel` | Customer | Pelanggan |
| `common.json` → `dashboard.uxs36CustomerFilterUnavailable` | Selected customer is unavailable | Pelanggan yang dipilih tidak tersedia |
| `common.json` → `efaktur.cancel` | Cancel | Batal |
| `common.json` → `efaktur.column` | e-Faktur | e-Faktur |
| `common.json` → `efaktur.date` | e-Faktur date | Tanggal e-Faktur |
| `common.json` → `efaktur.dateMissing` | Enter the e-Faktur date as well, or clear the number. | Isi juga tanggal e-Faktur, atau kosongkan nomornya. |
| `common.json` → `efaktur.disabledReason` | Fix the highlighted e-Faktur value to save. | Perbaiki nilai e-Faktur yang ditandai untuk menyimpan. |
| `common.json` → `efaktur.discard` | Discard | Buang |
| `common.json` → `efaktur.discardDescription` | The number and date you entered will not be saved. | Nomor dan tanggal yang Anda isi tidak akan disimpan. |
| `common.json` → `efaktur.discardTitle` | Discard these e-Faktur details? | Buang detail e-Faktur ini? |
| `common.json` → `efaktur.futureDate` | The e-Faktur date cannot be in the future. | Tanggal e-Faktur tidak boleh di masa depan. |
| `common.json` → `efaktur.invalidDate` | Enter a valid date. | Masukkan tanggal yang valid. |
| `common.json` → `efaktur.invalidNumber` | Use up to 32 digits, dots, or dashes. | Gunakan maksimal 32 angka, titik, atau tanda hubung. |
| `common.json` → `efaktur.issuedSalesInvoice` | Issued sales invoice number | Nomor faktur penjualan terbit |
| `common.json` → `efaktur.keepEditing` | Keep editing | Lanjut mengedit |
| `common.json` → `efaktur.notSaved` | e-Faktur not saved | e-Faktur tidak disimpan |
| `common.json` → `efaktur.number` | e-Faktur number | Nomor e-Faktur |
| `common.json` → `efaktur.numberMissing` | Enter the e-Faktur number as well, or clear the date. | Isi juga nomor e-Faktur, atau kosongkan tanggalnya. |
| `common.json` → `efaktur.record` | Record e-Faktur | Catat e-Faktur |
| `common.json` → `efaktur.refusedCancelled` | This invoice has been cancelled, so its e-Faktur can no longer be recorded. The list has been refreshed. | Faktur ini sudah dibatalkan, sehingga e-Fakturnya tidak dapat dicatat lagi. Daftar telah diperbarui. |
| `common.json` → `efaktur.refusedIncomplete` | Record the e-Faktur number and its date together. | Catat nomor e-Faktur beserta tanggalnya. |
| `common.json` → `efaktur.saved` | e-Faktur details saved | Detail e-Faktur disimpan |
| `common.json` → `efaktur.subtitle` | Record the number and its date together, or leave both empty for a non-VAT document. | Catat nomor beserta tanggalnya, atau biarkan keduanya kosong untuk dokumen non-PPN. |
| `common.json` → `efaktur.title` | Record e-Faktur details | Catat detail e-Faktur |
| `common.json` → `financeCopy.addLineItem` | Add line item | Tambah baris item |
| `common.json` → `financeCopy.amount` | Amount | Jumlah |
| `common.json` → `financeCopy.amountOutstanding` | {{amount}} outstanding | {{amount}} belum dibayar |
| `common.json` → `financeCopy.approve` | Approve | Setujui |
| `common.json` → `financeCopy.approveInvoice` | Approve invoice | Setujui faktur |
| `common.json` → `financeCopy.approveInvoiceBody` | Approving issues the invoice: it gets its number, becomes Unpaid and can receive payments. Its author cannot approve it. | Persetujuan menerbitkan faktur: faktur mendapat nomor, menjadi Belum Dibayar, dan dapat menerima pembayaran. Pembuatnya tidak dapat menyetujuinya. |
| `common.json` → `financeCopy.approveInvoiceNamed` | Approve the invoice for {{customer}}? | Setujui faktur untuk {{customer}}? |
| `common.json` → `financeCopy.backToDashboard` | Back to dashboard | Kembali ke dasbor |
| `common.json` → `financeCopy.backToInvoices` | Back to Sales Invoices | Kembali ke Faktur Penjualan |
| `common.json` → `financeCopy.cancel` | Cancel | Batal |
| `common.json` → `financeCopy.cancelInvoice` | Cancel invoice | Batalkan faktur |
| `common.json` → `financeCopy.cancelInvoiceNamed` | Cancel {{invoice}}? | Batalkan {{invoice}}? |
| `common.json` → `financeCopy.cancelInvoiceQuestion` | Cancel invoice? | Batalkan faktur? |
| `common.json` → `financeCopy.cancelPayment` | Cancel payment | Batalkan pembayaran |
| `common.json` → `financeCopy.cancelPaymentDescription` | This cancels the payment in ERPNext (docstatus 1→2). The payment will be marked Cancelled and the linked invoice's outstanding amount will be restored. | Tindakan ini membatalkan pembayaran di ERPNext (docstatus 1→2). Pembayaran akan ditandai Dibatalkan dan sisa tagihan faktur tertaut akan dipulihkan. |
| `common.json` → `financeCopy.cancelPaymentNamed` | Cancel {{payment}}? | Batalkan {{payment}}? |
| `common.json` → `financeCopy.cancelPaymentQuestion` | Cancel payment? | Batalkan pembayaran? |
| `common.json` → `financeCopy.carriedIntoErpOpening` | Carried into the ERP opening balance: {{amount}} on {{date}} | Dibawa ke saldo awal ERP: {{amount}} pada {{date}} |
| `common.json` → `financeCopy.cashReceived` | Cash received | Kas diterima |
| `common.json` → `financeCopy.clearFilter` | Clear filter | Hapus filter |
| `common.json` → `financeCopy.continueToApprove` | Continue to approve | Lanjutkan untuk menyetujui |
| `common.json` → `financeCopy.createInvoice` | Create invoice | Buat faktur |
| `common.json` → `financeCopy.createSalesInvoicesToSeeRevenuePerProject` | No invoice revenue has been recorded yet. New Invoice starts billing; revenue appears here after invoices are recorded. | Belum ada pendapatan dari faktur yang dicatat. Faktur Baru memulai penagihan; pendapatan akan tampil di sini setelah faktur dicatat. |
| `common.json` → `financeCopy.createYourFirstInvoiceToStartBillingClients` | No client invoices have been recorded yet. Use New Invoice to start billing. | Belum ada faktur klien yang dicatat. Gunakan Faktur Baru untuk mulai menagih. |
| `common.json` → `financeCopy.currency` | Currency | Mata uang |
| `common.json` → `financeCopy.customer` | Customer | Pelanggan |
| `common.json` → `financeCopy.customerNotRecorded` | Customer not recorded | Pelanggan belum dicatat |
| `common.json` → `financeCopy.customerPO` | Customer PO | PO Pelanggan |
| `common.json` → `financeCopy.customerRequired` | Customer is required. | Pelanggan wajib diisi. |
| `common.json` → `financeCopy.date` | Date | Tanggal |
| `common.json` → `financeCopy.describeWorkOrGoods` | Describe the work or goods… | Jelaskan pekerjaan atau barang… |
| `common.json` → `financeCopy.description` | Description | Deskripsi |
| `common.json` → `financeCopy.draftInvoice` | Draft invoice | Draf faktur |
| `common.json` → `financeCopy.draftInvoiceForProject` | Draft invoice · {{project}} | Draf faktur · {{project}} |
| `common.json` → `financeCopy.draftInvoiceLabel` | Draft · {{customer}} | Draf · {{customer}} |
| `common.json` → `financeCopy.dueDate` | Due Date | Tanggal jatuh tempo |
| `common.json` → `financeCopy.edit` | Edit | Ubah |
| `common.json` → `financeCopy.editInvoiceSubtitle` | Update this sales invoice | Perbarui faktur penjualan ini |
| `common.json` → `financeCopy.editInvoiceTitle` | Edit invoice | Ubah faktur |
| `common.json` → `financeCopy.editPaymentSubtitle` | Update this incoming payment | Perbarui pembayaran masuk ini |
| `common.json` → `financeCopy.editPaymentTitle` | Edit payment | Ubah pembayaran |
| `common.json` → `financeCopy.erpItem` | ERP item | Item ERP |
| `common.json` → `financeCopy.erpLineItemsStoredInErpNext` | Line items are kept in ERPNext for this invoice. | Rincian item untuk faktur ini disimpan di ERPNext. |
| `common.json` → `financeCopy.filterByStatus` | Filter by status | Filter berdasarkan status |
| `common.json` → `financeCopy.iTEM001` | ITEM-001 | ITEM-001 |
| `common.json` → `financeCopy.incomingPayments` | Incoming Payments | Pembayaran Masuk |
| `common.json` → `financeCopy.incomingPaymentsLoadFailed` | Couldn't load incoming payments | Pembayaran masuk tidak dapat dimuat |
| `common.json` → `financeCopy.invoice` | Invoice # | No. Faktur |
| `common.json` → `financeCopy.invoiceApproved` | Invoice approved | Faktur disetujui |
| `common.json` → `financeCopy.invoiceCancelled` | Invoice cancelled | Faktur dibatalkan |
| `common.json` → `financeCopy.invoiceCreated` | Invoice created | Faktur dibuat |
| `common.json` → `financeCopy.invoiceDetails` | Invoice details | Detail faktur |
| `common.json` → `financeCopy.invoiceLineCodeOrDescription` | Line {{line}}: Enter an item code or a description. | Baris {{line}}: Isi kode item atau deskripsi. |
| `common.json` → `financeCopy.invoiceLineItemCodeRequired` | Line {{line}}: Item code is required. | Baris {{line}}: Kode item wajib diisi. |
| `common.json` → `financeCopy.invoiceLineQuantityPositive` | Line {{line}}: Quantity must be positive. | Baris {{line}}: Kuantitas harus lebih dari nol. |
| `common.json` → `financeCopy.invoiceLineRateNonNegative` | Line {{line}}: Rate cannot be negative. | Baris {{line}}: Tarif tidak boleh negatif. |
| `common.json` → `financeCopy.invoiceLineRateValid` | Line {{line}}: Enter a valid rate with no more than 2 decimal places. | Baris {{line}}: Masukkan tarif valid dengan maksimal 2 angka desimal. |
| `common.json` → `financeCopy.invoiceLineRequired` | At least one line item is required. | Minimal satu item baris diperlukan. |
| `common.json` → `financeCopy.invoicePdf.download` | Download PDF | Unduh PDF |
| `common.json` → `financeCopy.invoicePdf.preparing` | Preparing PDF… | Menyiapkan PDF… |
| `common.json` → `financeCopy.invoiceRecordNotFound` | Invoice not found | Faktur tidak ditemukan |
| `common.json` → `financeCopy.invoiceRecordNotFoundBody` | This invoice is no longer available. | Faktur ini tidak lagi tersedia. |
| `common.json` → `financeCopy.invoiceRecordTitle` | Invoice {{number}} | Faktur {{number}} |
| `common.json` → `financeCopy.invoiceSubmitted` | Invoice submitted | Faktur diajukan |
| `common.json` → `financeCopy.invoices` | Invoices | Faktur |
| `common.json` → `financeCopy.invoicesWithAmountsWillAppearHere` | Invoices with amounts will appear here. | Faktur dengan jumlah akan muncul di sini. |
| `common.json` → `financeCopy.itemCode` | Item code | Kode item |
| `common.json` → `financeCopy.lineItemsSection` | Line items | Item faktur |
| `common.json` → `financeCopy.linkToSalesInvoice` | Link to sales invoice… | Tautkan ke faktur penjualan… |
| `common.json` → `financeCopy.nativeCancelInvoiceBody` | This cancels the invoice in PMO and it stops counting as billed. An invoice with receipts can be cancelled only after its receipts are cancelled. | Ini membatalkan faktur di PMO sehingga tidak lagi dihitung sebagai tagihan. Faktur yang memiliki penerimaan hanya dapat dibatalkan setelah penerimaannya dibatalkan. |
| `common.json` → `financeCopy.nativeCancelReceiptBody` | This cancels the receipt in PMO and puts its amount back on the invoice's balance. | Ini membatalkan penerimaan di PMO dan mengembalikan jumlahnya ke saldo faktur. |
| `common.json` → `financeCopy.nativeIncomingPaymentsDescription` | Customer receipts recorded in PMO against approved invoices. | Penerimaan pelanggan yang dicatat di PMO atas faktur yang telah disetujui. |
| `common.json` → `financeCopy.nativeNewInvoiceSubtitle` | Raises a draft. A different Finance or Admin user approves it. | Membuat draf. Pengguna Finance atau Admin lain yang menyetujuinya. |
| `common.json` → `financeCopy.nativeProjectRequired` | Project is required: it decides the invoice's VAT. | Proyek wajib diisi: proyek menentukan PPN faktur. |
| `common.json` → `financeCopy.nativeReceiptAmountHelper` | Starts at the {{amount}} outstanding. Enter less for a part payment, or more if the client paid more; the excess shows as overpaid. | Diisi dengan sisa tagihan {{amount}}. Isi lebih kecil untuk pembayaran sebagian, atau lebih besar jika klien membayar lebih; kelebihannya ditampilkan sebagai kelebihan bayar. |
| `common.json` → `financeCopy.nativeSelectProject` | Select project… | Pilih proyek… |
| `common.json` → `financeCopy.newInvoice` | New Invoice | Faktur Baru |
| `common.json` → `financeCopy.newInvoiceSubtitle` | Create a new sales invoice for a client | Buat faktur penjualan baru untuk klien |
| `common.json` → `financeCopy.newInvoiceTitle` | New invoice | Faktur baru |
| `common.json` → `financeCopy.noIncomingPaymentsYet` | No incoming payments yet | Belum ada pembayaran masuk |
| `common.json` → `financeCopy.noInvoicesMatchYourFilters` | No invoices match your filters | Tidak ada faktur yang cocok dengan filter |
| `common.json` → `financeCopy.noPaymentsMatchYourFilters` | No payments match your filters | Tidak ada pembayaran yang cocok dengan filter |
| `common.json` → `financeCopy.noRevenueData` | No revenue data | Tidak ada data pendapatan |
| `common.json` → `financeCopy.noRevenueDataYet` | No revenue data yet | Belum ada data pendapatan |
| `common.json` → `financeCopy.noSalesInvoicesYet` | No sales invoices yet | Belum ada faktur penjualan |
| `common.json` → `financeCopy.openAR` | Open AR | Piutang Terbuka |
| `common.json` → `financeCopy.outstanding` | Outstanding | Belum dibayar |
| `common.json` → `financeCopy.overpaidBy` | Overpaid by {{amount}} | Kelebihan bayar {{amount}} |
| `common.json` → `financeCopy.paidAmountPositive` | Paid amount must be positive, with no more than 2 decimal places. | Jumlah dibayar harus lebih dari nol dengan maksimal 2 angka desimal. |
| `common.json` → `financeCopy.paidToDateAmount` | Paid {{amount}} | Dibayar {{amount}} |
| `common.json` → `financeCopy.payment` | Payment # | No. Pembayaran |
| `common.json` → `financeCopy.paymentCancelled` | Payment cancelled | Pembayaran dibatalkan |
| `common.json` → `financeCopy.paymentCreated` | Payment created | Pembayaran dibuat |
| `common.json` → `financeCopy.paymentDateBeforeInvoice` | The payment date cannot be before the invoice date. | Tanggal pembayaran tidak boleh sebelum tanggal faktur. |
| `common.json` → `financeCopy.paymentDateLabel` | Payment date | Tanggal pembayaran |
| `common.json` → `financeCopy.paymentDateNotFuture` | The payment date cannot be in the future. | Tanggal pembayaran tidak boleh di masa depan. |
| `common.json` → `financeCopy.paymentDateRequired` | Date is required. | Tanggal wajib diisi. |
| `common.json` → `financeCopy.paymentDetails` | Payment details | Detail pembayaran |
| `common.json` → `financeCopy.paymentsReceivedFromClientsMirroredFromERPNextLinkedToSalesInvoicesWhenApplicable` | Payments received from clients, mirrored from ERPNext. Linked to sales invoices when applicable. | Pembayaran yang diterima dari klien dan dicerminkan dari ERPNext. Ditautkan ke faktur penjualan jika sesuai. |
| `common.json` → `financeCopy.preErpBadge` | Pre-ERP | Pra-ERP |
| `common.json` → `financeCopy.project` | Project | Proyek |
| `common.json` → `financeCopy.projectLoading` | Project details loading | Detail proyek sedang dimuat |
| `common.json` → `financeCopy.projectNotRecorded` | Project not recorded | Proyek belum dicatat |
| `common.json` → `financeCopy.projectUnavailable` | Project details unavailable | Detail proyek tidak tersedia |
| `common.json` → `financeCopy.pushingToERPNext` | Pushing to ERPNext… | Mengirim ke ERPNext… |
| `common.json` → `financeCopy.qty` | Qty | Jml. |
| `common.json` → `financeCopy.rate` | Rate | Tarif |
| `common.json` → `financeCopy.receiptCancelled` | Receipt cancelled | Penerimaan dibatalkan |
| `common.json` → `financeCopy.receivePayment` | Receive Payment | Terima Pembayaran |
| `common.json` → `financeCopy.receivePaymentSubtitle` | Record a new incoming payment from a client | Catat pembayaran masuk baru dari klien |
| `common.json` → `financeCopy.receivedAmountHelper` | The cash actually received. | Kas yang benar-benar diterima. |
| `common.json` → `financeCopy.receivedAmountPositive` | Received amount must be positive, with no more than 2 decimal places. | Jumlah diterima harus lebih dari nol dengan maksimal 2 angka desimal. |
| `common.json` → `financeCopy.receivedBeforeInvoiceDate` | Cannot be before the invoice date | Tidak boleh sebelum tanggal faktur |
| `common.json` → `financeCopy.receivedDate` | Received | Diterima |
| `common.json` → `financeCopy.receivedDateHelp` | The date the client received this invoice. The due date follows it. | Tanggal klien menerima faktur ini. Tanggal jatuh tempo mengikuti tanggal ini. |
| `common.json` → `financeCopy.receivedDateSaved` | Received date saved | Tanggal diterima disimpan |
| `common.json` → `financeCopy.recordPayment` | Record payment | Catat pembayaran |
| `common.json` → `financeCopy.recordReceivedDate` | Record received date | Catat tanggal diterima |
| `common.json` → `financeCopy.recordVatRateOnProject` | Record the VAT rate on the project | Catat tarif PPN di proyek |
| `common.json` → `financeCopy.recordYourFirstPaymentReceivedFromAClient` | No client receipts have been recorded yet. Use Receive Payment when a client payment arrives. | Belum ada penerimaan dari klien yang dicatat. Gunakan Terima Pembayaran saat pembayaran klien masuk. |
| `common.json` → `financeCopy.recordedBeforeErp` | Recorded in PMO before the ERP was connected | Dicatat di PMO sebelum ERP terhubung |
| `common.json` → `financeCopy.reference` | Reference | Referensi |
| `common.json` → `financeCopy.removeLine` | Remove line {{line}} | Hapus baris {{line}} |
| `common.json` → `financeCopy.revenueByProject` | Revenue by Project | Pendapatan per Proyek |
| `common.json` → `financeCopy.salesInvoiceLabel` | Sales Invoice | Faktur Penjualan |
| `common.json` → `financeCopy.salesInvoiceOptional` | Sales Invoice (optional) | Faktur Penjualan (opsional) |
| `common.json` → `financeCopy.salesInvoiceRequired` | Choose the invoice this receipt settles. | Pilih faktur yang dilunasi penerimaan ini. |
| `common.json` → `financeCopy.salesInvoices` | Sales Invoices | Faktur Penjualan |
| `common.json` → `financeCopy.salesInvoicesLoadFailed` | Couldn't load sales invoices | Faktur penjualan tidak dapat dimuat |
| `common.json` → `financeCopy.save` | Save | Simpan |
| `common.json` → `financeCopy.saveInvoice` | Save invoice | Simpan faktur |
| `common.json` → `financeCopy.savePayment` | Save payment | Simpan pembayaran |
| `common.json` → `financeCopy.searchIncomingPayments` | Search incoming payments | Cari pembayaran masuk |
| `common.json` → `financeCopy.searchInvoices` | Search invoices… | Cari faktur… |
| `common.json` → `financeCopy.searchItemCodeOrName` | Search item code or name… | Cari kode atau nama item… |
| `common.json` → `financeCopy.searchPayments` | Search payments… | Cari pembayaran… |
| `common.json` → `financeCopy.searchSalesInvoices` | Search sales invoices | Cari faktur penjualan |
| `common.json` → `financeCopy.selectOrSearchCustomer` | Select or search customer… | Pilih atau cari pelanggan… |
| `common.json` → `financeCopy.selectOrSearchItem` | Select or search item… | Pilih atau cari item… |
| `common.json` → `financeCopy.selectProjectOptional` | Select project (optional)… | Pilih proyek (opsional)… |
| `common.json` → `financeCopy.status` | Status | Status |
| `common.json` → `financeCopy.statusAll` | All | Semua |
| `common.json` → `financeCopy.statusCancelled` | Cancelled | Dibatalkan |
| `common.json` → `financeCopy.statusDraft` | Draft | Draf |
| `common.json` → `financeCopy.statusPaid` | Paid | Dibayar |
| `common.json` → `financeCopy.statusPartlyPaid` | Partly paid | Dibayar sebagian |
| `common.json` → `financeCopy.statusSubmitted` | Submitted | Diajukan |
| `common.json` → `financeCopy.statusUnpaid` | Unpaid | Belum dibayar |
| `common.json` → `financeCopy.submit` | Submit | Ajukan |
| `common.json` → `financeCopy.submitInvoice` | Submit invoice | Ajukan faktur |
| `common.json` → `financeCopy.submitInvoiceForApprovalThisCommitsItToTheLedgerAndCannotBeUndoneByTheSubmitter` | Submit invoice for approval? This commits it to the ledger and cannot be undone by the submitter. | Ajukan faktur untuk persetujuan? Tindakan ini mencatatnya ke buku besar dan tidak dapat dibatalkan oleh pengaju. |
| `common.json` → `financeCopy.submitInvoiceNamed` | Submit {{invoice}}? | Ajukan {{invoice}}? |
| `common.json` → `financeCopy.submitInvoiceQuestion` | Submit invoice? | Ajukan faktur? |
| `common.json` → `financeCopy.taxWithheld` | Tax withheld | Pajak dipotong |
| `common.json` → `financeCopy.theIncomingPaymentsListIsAvailableToFinanceProjectManagersAndExecutives` | The incoming payments list is available to Finance, Project Managers, and Executives. | Daftar pembayaran masuk tersedia untuk Finance, Manajer Proyek, dan Eksekutif. |
| `common.json` → `financeCopy.theRequestFailedCheckYourConnectionAndTryAgain` | The request failed. Check your connection and try again. | Permintaan gagal. Periksa koneksi Anda lalu coba lagi. |
| `common.json` → `financeCopy.theRevenuePerProjectViewIsAvailableToFinanceProjectManagersAndExecutives` | The revenue per project view is available to Finance, Project Managers, and Executives. | Tampilan pendapatan per proyek tersedia untuk Finance, Manajer Proyek, dan Eksekutif. |
| `common.json` → `financeCopy.theSalesInvoicesDirectoryIsAvailableToFinanceProjectManagersAndExecutives` | The sales invoices directory is available to Finance, Project Managers, and Executives. | Daftar faktur penjualan tersedia untuk Finance, Manajer Proyek, dan Eksekutif. |
| `common.json` → `financeCopy.thisCancelsTheInvoiceInERPNextDocstatus12TheInvoiceWillBeMarkedCancelledAndCanNoLongerBeSubmittedOutstandingAmountIsReleased` | This cancels the invoice in ERPNext (docstatus 1→2). The invoice will be marked Cancelled and can no longer be submitted. Outstanding amount is released. | Tindakan ini membatalkan faktur di ERPNext (docstatus 1→2). Faktur akan berstatus Dibatalkan dan tidak dapat diajukan lagi. Jumlah terutang akan dilepaskan. |
| `common.json` → `financeCopy.total` | Total | Total |
| `common.json` → `financeCopy.totalDueAmount` | Total due {{amount}} | Total tagihan {{amount}} |
| `common.json` → `financeCopy.totalRevenue` | Total Revenue | Total Pendapatan |
| `common.json` → `financeCopy.tryADifferentStatusOrClearTheSearch` | Try a different status or clear the search. | Coba status lain atau hapus pencarian. |
| `common.json` → `financeCopy.unassigned` | Unassigned | Belum ditetapkan |
| `common.json` → `financeCopy.unnamedInvoice` | invoice | faktur |
| `common.json` → `financeCopy.vatRateMissing` | This project has no VAT rate recorded | Proyek ini belum memiliki tarif PPN yang tercatat |
| `common.json` → `financeCopy.vatRateMissingInline` | This project has no VAT rate recorded, so it cannot be invoiced yet. | Proyek ini belum memiliki tarif PPN yang tercatat, sehingga belum dapat ditagihkan. |
| `common.json` → `financeCopy.viewInvoice` | View invoice | Lihat faktur |
| `common.json` → `financeCopy.withheldAmountHelper` | Enter the amount the client withheld; PMO does not calculate income tax. Enter 0 for no withholding. | Masukkan jumlah yang dipotong klien; PMO tidak menghitung pajak penghasilan. Isi 0 bila tidak ada pemotongan. |
| `common.json` → `financeCopy.withheldAmountInvalid` | Withheld tax must be non-negative, with no more than 2 decimal places. | Pajak dipotong tidak boleh negatif, dengan maksimal 2 angka desimal. |
| `common.json` → `financeCopy.withheldAmountLabel` | Withheld tax amount | Jumlah pajak dipotong |
| `common.json` → `financeCopy.withheldAmountUnbalanced` | Cash received plus withheld tax must equal the amount allocated to the invoice. | Kas diterima ditambah pajak dipotong harus sama dengan jumlah yang dialokasikan ke faktur. |
| `common.json` → `financeCopy.withholdingSlip` | Withholding slip | Bukti potong |
| `common.json` → `financeCopy.withholdingSlipHelper` | Required when the client withheld tax. | Wajib diisi bila klien memotong pajak. |
| `common.json` → `financeCopy.withholdingSlipInvalid` | Enter a withholding-slip number of at most 140 characters. | Masukkan nomor bukti potong maksimal 140 karakter. |
| `common.json` → `financeCopy.withholdingSlipNumberLabel` | Withholding-slip number | Nomor bukti potong |
| `common.json` → `financeCopy.youDonTHaveAccessToIncomingPayments` | You don't have access to Incoming Payments | Anda tidak memiliki akses ke Pembayaran Masuk |
| `common.json` → `financeCopy.youDonTHaveAccessToRevenueByProject` | You don't have access to Revenue by Project | Anda tidak memiliki akses ke Pendapatan per Proyek |
| `common.json` → `financeCopy.youDonTHaveAccessToSalesInvoices` | You don't have access to Sales Invoices | Anda tidak memiliki akses ke Faktur Penjualan |
| `common.json` → `financialStatements.accessDenied` | You don't have access to financial statements | Anda tidak memiliki akses ke laporan keuangan |
| `common.json` → `financialStatements.accessDeniedDescription` | Company statements are available to Admin, Finance, and Executive roles. | Laporan perusahaan tersedia bagi role Admin, Finance, dan Executive. |
| `common.json` → `financialStatements.asAt` | As at | Per tanggal |
| `common.json` → `financialStatements.backToDashboard` | Back to dashboard | Kembali ke dashboard |
| `common.json` → `financialStatements.balanceSheet` | Balance sheet | Neraca |
| `common.json` → `financialStatements.choosePeriod` | Choose a period | Pilih periode |
| `common.json` → `financialStatements.chooseScope` | Choose a scope | Pilih cakupan |
| `common.json` → `financialStatements.companyScope` | Company | Perusahaan |
| `common.json` → `financialStatements.current` | Current period | Periode berjalan |
| `common.json` → `financialStatements.delayed` | Update delayed | Pembaruan tertunda |
| `common.json` → `financialStatements.error` | Couldn't load financial statements | Laporan keuangan tidak dapat dimuat |
| `common.json` → `financialStatements.errorDescription` | The request failed. Check your connection and try again. | Permintaan gagal. Periksa koneksi lalu coba lagi. |
| `common.json` → `financialStatements.fiscalYear` | Fiscal year | Tahun fiskal |
| `common.json` → `financialStatements.month` | Month | Bulan |
| `common.json` → `financialStatements.noActivity` | No activity in this period | Tidak ada aktivitas pada periode ini |
| `common.json` → `financialStatements.noActivityDescription` | There was no activity in the selected period. | Tidak ada aktivitas pada periode yang dipilih. |
| `common.json` → `financialStatements.noPeriods` | No periods available | Tidak ada periode tersedia |
| `common.json` → `financialStatements.notProvided` | Not provided | Tidak tersedia |
| `common.json` → `financialStatements.period` | Period | Periode |
| `common.json` → `financialStatements.periodKind` | Period type | Jenis periode |
| `common.json` → `financialStatements.prior` | Previous period | Periode sebelumnya |
| `common.json` → `financialStatements.profitAndLoss` | Profit and loss | Laba rugi |
| `common.json` → `financialStatements.quarter` | Quarter | Triwulan |
| `common.json` → `financialStatements.refreshing` | Refreshing statements… | Memperbarui laporan… |
| `common.json` → `financialStatements.retry` | Retry | Coba lagi |
| `common.json` → `financialStatements.scope` | Scope | Cakupan |
| `common.json` → `financialStatements.statement` | Statement | Laporan |
| `common.json` → `financialStatements.trialBalance` | Trial balance | Neraca saldo |
| `common.json` → `financialStatements.unavailable` | Statements are not available yet | Laporan keuangan belum tersedia |
| `common.json` → `financialStatements.unavailableDescription` | Saved statements will appear here when available. | Laporan tersimpan akan muncul di sini saat tersedia. |
| `common.json` → `financialStatements.updated` | Updated | Diperbarui |
| `common.json` → `fx.noRateForDate` | No JISDOR rate for {{date}}. | Kurs JISDOR untuk {{date}} tidak tersedia. |
| `common.json` → `fx.rateError` | Could not load JISDOR rate. | Kurs JISDOR tidak dapat dimuat. |
| `common.json` → `invoiceProject.assign` | Assign project | Tetapkan proyek |
| `common.json` → `invoiceProject.change` | Change project | Ubah proyek |
| `common.json` → `invoiceProject.current` | Current project | Proyek saat ini |
| `common.json` → `invoiceProject.discard` | Discard | Buang |
| `common.json` → `invoiceProject.discardDetail` | The selected project will not be saved. | Proyek yang dipilih tidak akan disimpan. |
| `common.json` → `invoiceProject.discardTitle` | Discard project selection? | Buang pilihan proyek? |
| `common.json` → `invoiceProject.fromTo` | From {{old}} to {{new}}. PMO attribution only; the ERP invoice is unchanged. | Dari {{old}} ke {{new}}. Hanya atribusi PMO; tagihan ERP tidak berubah. |
| `common.json` → `invoiceProject.keep` | Keep editing | Lanjutkan mengedit |
| `common.json` → `invoiceProject.project` | Project | Proyek |
| `common.json` → `invoiceProject.required` | Select a project. | Pilih proyek. |
| `common.json` → `invoiceProject.save` | Save project | Simpan proyek |
| `common.json` → `invoiceProject.scope` | PMO attribution only; the ERP invoice is unchanged. | Hanya atribusi PMO; tagihan ERP tidak berubah. |
| `common.json` → `invoiceProject.unassignedFilter` | Unassigned invoices | Tagihan tanpa proyek |
| `common.json` → `managementPack.actions` | Actions | Tindakan |
| `common.json` → `managementPack.asAt` | As at | Per |
| `common.json` → `managementPack.basis.invoiced` | Invoiced | Ditagih |
| `common.json` → `managementPack.basis.progress` | {{pct}}% complete | {{pct}}% selesai |
| `common.json` → `managementPack.basis.progressShort` | Progress | Progres |
| `common.json` → `managementPack.billedAhead` | billed ahead | ditagih di muka |
| `common.json` → `managementPack.col.backlog` | Backlog | Backlog |
| `common.json` → `managementPack.col.basis` | Basis | Dasar |
| `common.json` → `managementPack.col.client` | Client | Klien |
| `common.json` → `managementPack.col.contract` | Contract | Kontrak |
| `common.json` → `managementPack.col.currency` | Currency | Mata uang |
| `common.json` → `managementPack.col.invoiced` | Invoiced | Ditagih |
| `common.json` → `managementPack.col.invoicedToDate` | Invoiced to date | Ditagih s.d. saat ini |
| `common.json` → `managementPack.col.month` | Month | Bulan |
| `common.json` → `managementPack.col.planned` | Planned | Rencana |
| `common.json` → `managementPack.col.project` | Project | Proyek |
| `common.json` → `managementPack.col.projectNumber` | Project number | Nomor proyek |
| `common.json` → `managementPack.col.recognised` | Recognised | Diakui |
| `common.json` → `managementPack.col.recognisedToDate` | Recognised to date | Diakui s.d. saat ini |
| `common.json` → `managementPack.col.taxBasis` | Tax basis | Dasar pajak |
| `common.json` → `managementPack.col.unbilled` | Unbilled | Belum ditagih |
| `common.json` → `managementPack.description` | Planned, recognised and invoiced revenue per project and month. All figures exclude tax. | Pendapatan rencana, diakui, dan ditagih per proyek dan bulan. Semua angka belum termasuk pajak. |
| `common.json` → `managementPack.emptySub` | Won and ongoing projects, and any project invoiced in this period, appear here. | Proyek yang dimenangkan dan berjalan, serta proyek yang ditagih pada periode ini, tampil di sini. |
| `common.json` → `managementPack.emptyTitle` | No projects to report | Tidak ada proyek untuk dilaporkan |
| `common.json` → `managementPack.errorSub` | The request failed. Check your connection and try again. | Permintaan gagal. Periksa koneksi Anda lalu coba lagi. |
| `common.json` → `managementPack.errorTitle` | Couldn't load the management pack | Laporan manajemen gagal dimuat |
| `common.json` → `managementPack.from` | From | Dari |
| `common.json` → `managementPack.invalidRange` | Choose a start month on or before the as-at month, at most 24 months apart. | Pilih bulan awal pada atau sebelum bulan laporan, paling jauh 24 bulan. |
| `common.json` → `managementPack.monthlyTotals` | Monthly totals | Total bulanan |
| `common.json` → `managementPack.noAccessSub` | The management pack is available to Finance, Project Managers, Executives and Admins. | Laporan manajemen tersedia untuk Finance, Project Manager, Executive, dan Admin. |
| `common.json` → `managementPack.noAccessTitle` | You don't have access to the management pack | Anda tidak memiliki akses ke laporan manajemen |
| `common.json` → `managementPack.otherCurrency` | Invoiced in {{currency}}, not the contract currency | Ditagih dalam {{currency}}, bukan mata uang kontrak |
| `common.json` → `managementPack.progressModal.month` | Month | Bulan |
| `common.json` → `managementPack.progressModal.monthInvalid` | Choose a month. | Pilih bulan. |
| `common.json` → `managementPack.progressModal.note` | Note | Catatan |
| `common.json` → `managementPack.progressModal.pct` | Percent complete to date | Persen selesai s.d. saat ini |
| `common.json` → `managementPack.progressModal.pctHelper` | Phase delivery: {{pct}}% | Progres fase: {{pct}}% |
| `common.json` → `managementPack.progressModal.pctInvalid` | Enter a number from 0 to 100, with at most two decimals. | Masukkan angka 0 sampai 100, maksimal dua desimal. |
| `common.json` → `managementPack.progressModal.save` | Save progress | Simpan progres |
| `common.json` → `managementPack.progressModal.saved` | Progress saved | Progres disimpan |
| `common.json` → `managementPack.progressModal.title` | Record progress | Catat progres |
| `common.json` → `managementPack.projectsAsAt` | Projects as at {{month}} | Proyek per {{month}} |
| `common.json` → `managementPack.recordProgress` | Record progress | Catat progres |
| `common.json` → `managementPack.retry` | Retry | Coba lagi |
| `common.json` → `managementPack.title` | Monthly management pack | Laporan manajemen bulanan |
| `common.json` → `managementPack.total` | Total | Total |
| `common.json` → `managementPack.unassigned` | Unassigned | Tanpa proyek |
| `common.json` → `managementPack.undated` | {{count}} invoices have no date and are not counted | {{count}} faktur tanpa tanggal tidak dihitung |
| `common.json` → `projectFinances.unavailable` | Unavailable | Tidak tersedia |
| `common.json` → `projects.export` | Export | Ekspor |
| `common.json` → `revenueByProject.currencyErrorSub` | Try again to view revenue. | Coba lagi untuk melihat pendapatan. |
| `common.json` → `revenueByProject.currencyErrorTitle` | Couldn't load organization currency | Mata uang organisasi tidak dapat dimuat |
| `common.json` → `revenueByProject.subtitle` | Project revenue, net of tax, in each invoice's own currency, with a separate Unassigned group for invoices not linked to a project. | Pendapatan per proyek, tidak termasuk pajak, dalam mata uang masing-masing invoice, dengan kelompok Tanpa Proyek untuk invoice yang belum ditautkan ke proyek. |
| `common.json` → `shell.nav.financialStatements` | Financial statements | Laporan keuangan |
| `common.json` → `tax.basis.exclusive` | excl. PPN | belum termasuk PPN |
| `common.json` → `ui.listState.retry` | Retry | Coba lagi |
| `common.json` → `uxs03.notAvailableYet` | Not available yet | Belum tersedia |
| `common.json` → `uxs05.customerReference` | Customer reference | Referensi pelanggan |
| `common.json` → `uxs05.overdueDay` | {{count}} day overdue | Terlambat {{count}} hari |
| `common.json` → `uxs05.overdueDays` | {{count}} days overdue | Terlambat {{count}} hari |
| `common.json` → `uxs05.overdueOnly` | Overdue only | Hanya yang terlambat |
| `common.json` → `uxs06.applied` | Applied | Dialokasikan |
| `common.json` → `uxs06.backToReceipts` | Back to Incoming Payments | Kembali ke Pembayaran Masuk |
| `common.json` → `uxs06.coverageUnknown` | The accounting system has not reported which invoices this receipt settled. | Sistem akuntansi belum melaporkan faktur mana yang dilunasi penerimaan ini. |
| `common.json` → `uxs06.invoiceAndMore` | {{first}} +{{count}} more | {{first}} +{{count}} lainnya |
| `common.json` → `uxs06.invoiceNotInPmo` | This invoice is not in PMO yet. | Faktur ini belum ada di PMO. |
| `common.json` → `uxs06.none` | None | Tidak ada |
| `common.json` → `uxs06.notReported` | Not reported | Belum dilaporkan |
| `common.json` → `uxs06.onAccount` | This receipt is not applied to any invoice. The cash is held on account. | Penerimaan ini tidak dialokasikan ke faktur mana pun. Uangnya ditahan sebagai titipan. |
| `common.json` → `uxs06.receiptNotFound` | We couldn't find this receipt | Penerimaan ini tidak ditemukan |
| `common.json` → `uxs06.receiptNotFoundBody` | It may have been removed, or you may not have access to it. | Mungkin sudah dihapus, atau Anda tidak punya akses ke sana. |
| `common.json` → `uxs06.receiptTitle` | Receipt {{number}} | Penerimaan {{number}} |
| `common.json` → `uxs06.receiptTotal` | Receipt total | Total penerimaan |
| `common.json` → `uxs06.settledTitle` | Invoices this receipt settled | Faktur yang dilunasi penerimaan ini |
| `common.json` → `uxs06.statusExpected` | Expected | Diharapkan |
| `common.json` → `uxs06.statusReceived` | Received | Diterima |
| `common.json` → `uxs06.unappliedCol` | Not yet applied | Belum dialokasikan |
| `common.json` → `uxs15.contextInvalid` | This project or its customer is no longer available. Start a new invoice and choose from the current options. | Proyek ini atau kliennya tidak lagi tersedia. Mulai faktur baru dan pilih dari opsi yang tersedia. |
| `common.json` → `uxs15.contextOptionsUnavailable` | Project and customer options could not be loaded. Retry to confirm the invoice context. | Daftar proyek dan klien tidak dapat dimuat. Coba lagi untuk memastikan konteks faktur. |
| `common.json` → `uxs15.currencyUnavailable` | Project currency unavailable. | Mata uang proyek tidak tersedia. |
| `common.json` → `uxs15.retryContext` | Retry context | Coba lagi |
| `common.json` → `uxs16.completeLinesForReview` | Enter valid line details, quantities, and rates to review totals. | Lengkapi detail baris, kuantitas, dan harga yang valid untuk meninjau total. |
| `common.json` → `uxs16.currencyUnavailable` | Currency is unavailable, so draft totals cannot be displayed. | Mata uang tidak tersedia, sehingga total draf tidak dapat ditampilkan. |
| `common.json` → `uxs16.invoiceDraftReview` | Invoice draft review | Tinjauan draf faktur |
| `common.json` → `uxs16.invoiceLineQuantityValid` | Line {{line}}: Quantity must be positive with no more than 3 decimal places. | Baris {{line}}: Kuantitas harus positif dengan maksimal 3 angka desimal. |
| `common.json` → `uxs16.projectTaxUnavailable` | Project tax details are unavailable, so tax and final total cannot be previewed yet. | Informasi pajak proyek tidak tersedia, sehingga pajak dan total akhir belum dapat dipratinjau. |
| `common.json` → `uxs16.reviewProjectTax` | Review project tax settings | Tinjau pengaturan pajak proyek |
| `common.json` → `uxs16.subtotal` | Subtotal | Subtotal |
| `common.json` → `uxs16.tax` | Tax | Pajak |
| `common.json` → `uxs16.total` | Total | Total |
| `common.json` → `uxs17.allocationAmountUnavailable` | Applied amount not available | Jumlah yang dialokasikan tidak tersedia |
| `common.json` → `uxs17.appliedReceipts` | Applied receipts | Penerimaan yang dialokasikan |
| `common.json` → `uxs17.billEvidence` | Bill evidence | Bukti faktur |
| `common.json` → `uxs17.billingContact` | Billing contact | Kontak penagihan |
| `common.json` → `uxs17.collectionSummary` | Invoice collection details | Rincian penagihan faktur |
| `common.json` → `uxs17.dateNotRecorded` | Not recorded | Belum dicatat |
| `common.json` → `uxs17.daysOverdue` | {{count}} days overdue | Terlambat {{count}} hari |
| `common.json` → `uxs17.deliverySection` | Client delivery | Pengiriman kepada klien |
| `common.json` → `uxs17.downloadApprovedPdf` | Download approved PDF | Unduh PDF yang disetujui |
| `common.json` → `uxs17.dueDate` | Due date | Tanggal jatuh tempo |
| `common.json` → `uxs17.dueDateUnavailable` | Due date not available | Tanggal jatuh tempo tidak tersedia |
| `common.json` → `uxs17.evidenceLoading` | Loading invoice evidence… | Memuat bukti faktur… |
| `common.json` → `uxs17.evidenceRetry` | Retry invoice evidence | Coba lagi memuat bukti faktur |
| `common.json` → `uxs17.evidenceUnavailable` | Bill evidence is temporarily unavailable. | Bukti faktur sementara tidak tersedia. |
| `common.json` → `uxs17.invoiceDate` | Invoice date | Tanggal faktur |
| `common.json` → `uxs17.invoiceLines` | Invoice lines | Rincian faktur |
| `common.json` → `uxs17.lineDescriptionUnavailable` | Description not available | Deskripsi tidak tersedia |
| `common.json` → `uxs17.linesUnknown` | Line details are not available. | Rincian baris tidak tersedia. |
| `common.json` → `uxs17.manualHandoffHelp` | Download the PDF and send it to your client yourself. | Unduh PDF dan kirim sendiri ke klien Anda. |
| `common.json` → `uxs17.outstandingUnavailable` | Outstanding amount not available | Jumlah terutang tidak tersedia |
| `common.json` → `uxs17.overdue` | Overdue | Terlambat |
| `common.json` → `uxs17.preparingPdf` | Preparing PDF… | Menyiapkan PDF… |
| `common.json` → `uxs17.readyToSend` | Ready to send | Siap dikirim |
| `common.json` → `uxs17.receiptReferenceUnavailable` | Receipt reference not recorded | Referensi penerimaan belum dicatat |
| `common.json` → `uxs17.receiptsCoverageUnknown` | Receipt allocations have not all been reported. | Belum semua alokasi penerimaan dilaporkan. |
| `common.json` → `uxs17.receiptsUnavailable` | Applied receipt details are unavailable. | Rincian penerimaan yang dialokasikan tidak tersedia. |
| `common.json` → `uxs17.receivedByClient` | Received by client | Sudah diterima klien |
| `common.json` → `uxs17.receivedDateSummary` | Client receipt was recorded for {{date}}. | Penerimaan oleh klien tercatat pada {{date}}. |
| `common.json` → `uxs17.status` | Status | Status |
| `common.json` → `uxs26.invoiceEmptyProjectManager` | No client invoices have been recorded yet. Finance manages invoice creation. | Belum ada faktur klien yang dicatat. Finance mengelola pembuatan faktur. |
| `common.json` → `uxs26.receiptsEmptyProjectManager` | No client receipts have been recorded yet. Finance records client payments. | Belum ada penerimaan dari klien yang dicatat. Finance mencatat pembayaran klien. |
| `common.json` → `uxs26.revenueEmptyProjectManager` | No invoice revenue has been recorded yet. Finance manages invoice creation. | Belum ada pendapatan dari faktur yang dicatat. Finance mengelola pembuatan faktur. |
| `common.json` → `uxs27.amountSettled` | Amount settled | Jumlah yang dilunasi |
| `common.json` → `uxs27.cashReceived` | Cash received | Kas diterima |
| `common.json` → `uxs27.taxWithheldDisclosure` | Tax withheld | Pajak dipotong |
| `common.json` → `uxs27.withheldSummary` | Tax withheld: {{amount}} | Pajak dipotong: {{amount}} |
| `common.json` → `uxs27.withholdingSlipMissing` | Withholding slip not entered (required for a deduction). | Nomor bukti potong belum diisi (wajib untuk pemotongan pajak). |
| `common.json` → `uxs27.withholdingSlipSummary` | Withholding slip: {{slip}} | Bukti potong: {{slip}} |
| `common.json` → `uxs34.backlogReason` | A foreign-currency invoice needs reconciliation before this balance can be known. | Tagihan dalam mata uang asing perlu direkonsiliasi sebelum saldo ini dapat diketahui. |
| `common.json` → `uxs34.backlogUnavailable` | Unavailable | Belum tersedia |
| `common.json` → `uxs34.cumulativeScope` | Cumulative amounts · since project start through {{month}} | Jumlah kumulatif · sejak awal proyek hingga {{month}} |
| `common.json` → `uxs37.billedWorkTaxBasis` | net of tax | di luar pajak |
| `common.json` → `uxs37.openReceivablesTaxBasis` | gross, tax included | bruto, termasuk pajak |
| `finance.json` → `invoices.clearProject` | Clear project filter | Hapus filter proyek |
| `finance.json` → `invoices.description` | Client invoices. | Faktur klien. |
| `finance.json` → `receipts.someUnreported` | Some figures weren't reported. | Beberapa angka tidak dilaporkan. |
| `finance.json` → `statements.amountsIn` | Amounts in | Jumlah dalam |
| `finance.json` → `statements.collapseAll` | Collapse all | Ciutkan semua |
| `finance.json` → `statements.collapseGroup` | Collapse {{group}} | Ciutkan {{group}} |
| `finance.json` → `statements.expandAll` | Expand all | Bentangkan semua |
| `finance.json` → `statements.expandGroup` | Expand {{group}} | Bentangkan {{group}} |
| `finance.json` → `statements.forThePeriod` | For the period | Untuk periode |
| `finance.json` → `statements.periodShown` | Period shown | Periode yang ditampilkan |
