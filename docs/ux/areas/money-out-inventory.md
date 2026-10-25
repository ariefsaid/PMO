# Money out — source inventory and builder evidence

Companion to [money-out.md](money-out.md); source baseline `d18ba06b5c5e94be3f81247d5a0ba68804590ab2`. Facts below come from the route declarations in `pmo-portal/App.tsx` and the rendered JSX, not component comments or earlier composition rulings. Target decisions are separately identified. All paths below are repository-relative; `P` means `pmo-portal/pages/`, `C` means `pmo-portal/components/`. No product code or tests change in this docs delivery.

## PA-00 route jobs

Each cell contains a concrete arrival expectation and completed job. PM means Project Manager. This is UX scope, not a replacement authorization matrix: existing policy, record ownership, routed approval, feature availability and server decisions remain binding. Own-record work applies to every role; an approver cannot infer eligibility from role alone. Engineer has an own-request doorway but no organization procurement navigation; ERP evidence remains unavailable to Engineer.

| Route / view | Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|---|
| `/procurement` | Admin | Requests and their current handoffs | Find the purchase case needing intervention |
| `/procurement` | Executive | Requested spend and purchase progress | Find a decision or follow a commitment |
| `/procurement` | Finance | Requested, ordered and invoiced cases | Find purchase evidence or a payable to process |
| `/procurement` | PM | Requests with project, requester and status | Find the request blocking project purchasing |
| `/procurement` | Engineer | My requests and next steps | Track my request or raise another |
| `/procurement/new` | Admin | Project/category and draft lines | Save a purchase request for review |
| `/procurement/new` | Executive | Project/category and draft lines | Record a request without approving it |
| `/procurement/new` | Finance | Project, vendor and estimated items | Prepare a request with financial context |
| `/procurement/new` | PM | Originating project and required items | Save the goods/services request for my project |
| `/procurement/new` | Engineer | My draft and optional project/vendor | Raise my request with line evidence |
| `/procurement/:id` or `/overview` | Admin | Current state, evidence and permitted next move | Resolve or decide this case within existing rules |
| `/procurement/:id` or `/overview` | Executive | Request basis, budget effect and selected purchase facts | Decide eligible spend or inspect its outcome |
| `/procurement/:id` or `/overview` | Finance | Amount basis, vendor, invoice/payment evidence | Advance the eligible financial handoff |
| `/procurement/:id` or `/overview` | PM | Items, project budget context and receipt state | Advance the project's purchase or confirm receipt |
| `/procurement/:id` or `/overview` | Engineer | My request, outcome and permitted handoff | Submit/correct my request or confirm my receipt when eligible |
| `/procurement/:id/items` | Admin | Purchase lines and their source | Inspect or edit permitted lines |
| `/procurement/:id/items` | Executive | Quantities, rates and line amounts | Verify what the proposed spend buys |
| `/procurement/:id/items` | Finance | Quantities, rates and currency | Check line evidence against the purchase amount |
| `/procurement/:id/items` | PM | Goods/services and editable draft lines | Correct permitted quantities and rates |
| `/procurement/:id/items` | Engineer | Lines attached to my request | Check the goods/services requested; edit only if currently permitted |
| `/procurement/:id/documents` | Admin | Case documents and linked evidence | Record/link permitted evidence and inspect exceptions |
| `/procurement/:id/documents` | Executive | Request, quote, order and subsequent evidence | Verify the documentary basis of the case |
| `/procurement/:id/documents` | Finance | Invoice, tax, payment, file and source references | Capture or reconcile permitted financial evidence |
| `/procurement/:id/documents` | PM | Order, receipt and supporting files | Record or find delivery evidence |
| `/procurement/:id/documents` | Engineer | Permitted evidence for my request | Read or attach permitted supporting evidence |
| `/procurement/:id/quotes` | Admin | Vendor bids, validity and selection | Compare or select an eligible quotation |
| `/procurement/:id/quotes` | Executive | Bids and the selected offer | Review why this vendor/amount was chosen |
| `/procurement/:id/quotes` | Finance | Bid amount/currency, validity and files | Record/compare eligible vendor quotes |
| `/procurement/:id/quotes` | PM | Offers for the project's request | Record or select an eligible bid |
| `/procurement/:id/quotes` | Engineer | Permitted quotes for my request | Understand its selected offer; no new selection rights |
| `/procurement/:id/history` → Activity | Admin | Dated actors, changes and record references | Trace the case's progression |
| `/procurement/:id/history` → Activity | Executive | Dated decisions and outcomes | Understand how the purchase reached this state |
| `/procurement/:id/history` → Activity | Finance | Financial handoffs and their evidence | Trace the chronology of the purchase |
| `/procurement/:id/history` → Activity | PM | Request/order/receipt changes | Explain a delivery handoff |
| `/procurement/:id/history` → Activity | Engineer | Permitted events on my request | Understand when my request changed |
| `/erp-purchases` | Admin | ERP documents without a purchase case | Link evidence or create the appropriate purchase case |
| `/erp-purchases` | Executive | Imported evidence, vendor/project and amount | Inspect or link eligible purchase evidence |
| `/erp-purchases` | Finance | Unlinked orders/receipts/invoices/payments | Reconcile evidence into the correct purchase case |
| `/erp-purchases` | PM | Imported documents with project attribution | Link project purchase evidence to its case |
| `/erp-purchases` | Engineer | An unavailable-destination explanation | Return to my requests; no organization ERP job is offered |
| `/expenses` | Admin | Claims, advances and outstanding cash | Find an eligible decision or settlement |
| `/expenses` | Executive | Team claims/advances with decision state | Find a claim I must review |
| `/expenses` | Finance | Claims awaiting payment and advances still outstanding | Find the expense or advance needing settlement |
| `/expenses` | PM | Team/project claims and their status | Find an eligible approval or my own claim |
| `/expenses` | Engineer | My claims and outstanding advances | Track reimbursement or start a claim/advance |
| `/expenses/new` | Admin | Receipt, expense line and project/category | Save my own expense draft |
| `/expenses/new` | Executive | Receipt, expense line and project/category | Record my own incurred expense |
| `/expenses/new` | Finance | Receipt/line evidence and optional advance | Prepare my own correctly attributed claim |
| `/expenses/new` | PM | Receipt, originating project and expense lines | Claim project expenses once |
| `/expenses/new` | Engineer | Receipt/line capture and minimal details | Save a recoverable expense draft |
| `/expenses/:claimId` | Admin | Claim evidence, settlement and eligible actions | Decide/pay/record a return when eligible |
| `/expenses/:claimId` | Executive | Purpose, lines/receipts and routing | Decide an eligible claim or track my own |
| `/expenses/:claimId` | Finance | Amount, advance application, receipts and postings | Pay an eligible claim or record returned cash |
| `/expenses/:claimId` | PM | Project/category, line evidence and status | Review eligible spend or correct my own draft |
| `/expenses/:claimId` | Engineer | My lines, receipts, outcome and advance balance | Submit/correct my claim or track reimbursement |

The advance-request modal is a capture within `/expenses`, not an invented route: every persona expects requested cash, project/category and purpose; each finishes saving their own advance request. Existing record eligibility governs approval, payout, return and cancellation. None of these jobs requires an additional dashboard or management pack.

## Label-source key

Both languages live in `pmo-portal/public/locales/{en,id}/`. `common.json` is the default namespace; `procurement.json` is explicitly addressed by `procurement:create.*` and document-type keys; `finance.json` supplies `erpLinks.*` / `erpPurchases.*`; `expenseClaims.json` supplies `new.*`. A `t(key, English fallback)` is evidence of a label source, not proof of complete Indonesian coverage. Preserve status values/URL tokens independently of localized labels.

| Source alias | Current labels / helper families | EN/ID treatment |
|---|---|---|
| CP | common: `procurement.*`, `procurementDetail.*`, `uxs19.*` | List, status/filter, record, actions and current-stage/next-step labels; status hooks use shared mappings |
| PC | procurement: `create.*` | New purchase request / draft note, details, fields, Save, validation and unsaved-change confirmation |
| PL | common: `procurementLedger.*`, `lineItems.*`, `procurementDetail.*`, `bupot.*` | Ledger filters/columns/capture, items, tax/slip and confirmation controls |
| EF | finance: `erpLinks.*`, `erpPurchases.*` | ERP title/scope, document types, linking, partial results and error/empty states |
| EX | common: `expenses.*`, `uxs29.expenseCapture.*`, `uxs12.expensePosting.*` | Expense kinds/status/type/aging labels, filters/forms, receipts, decisions, settlement/posting feedback |
| EC | expenseClaims: `new.*`; common `expenses.form.*` | New expense subtitle, permission, validation/discard, shared field labels |
| Shared | common `shell.nav.*`, `table.*`, `admin.retry`, budget-category label helper | Shell return, table actions and category labels |
| Literal | `ProcurementOverviewTab`, `DecisionSupportPanel`, quote comparison columns/actions, `daysAgo` in request row, some item aria labels/dialog titles | Current source includes literal “Detail”, “Progression”, “Budget impact”, budget figures/advisories, “Vendor / Quote #”, “Value status”, “Best value”, “Select”, “today”/“d ago”. Localize during recompose; do not copy these as ID fallback |

## Current inventory — blocks in render order

Audience shorthand: **M** = Admin, Executive, Finance, PM; **All** includes Engineer in own-record scope. Action eligibility always remains the current `usePermission`, ownership/status and routed-action result. Read facts are not grants. App-wide shell is inventoried in [shell-inventory.md](shell-inventory.md); the table inventories page bodies and their opened disclosures/dialogs.

| Page / source | Order | Current block, fact / action | Who sees it | EN/ID source |
|---|---|---|---|---|
| `P/Procurement.tsx` | 1 | ListPage heading “Procurement” or “Your purchase requests”; description; conditional ERP-unlinked link | All; Engineer own scope, ERP link only non-own scope with data | CP; EF banner link |
| same | 2 | Raise request, navigates to `/procurement/new` | Create-permitted members | CP `raiseRequest` |
| same | 3 | Status segments: All, Needs approval (M only), Open, Ordered, Vendor invoiced, Paid; URL exact/group distinction | All; while not loading | CP `filter.*` |
| same | 4 | Search title/code/external references | All; while not loading | CP `search.*` |
| same | 5 | More disclosure: Export filtered rows; import headers; Import cycle data opens case-grouped wizard | All export; import create-gated; current user needed | CP `importCycleData`, `uxs19.more`; shared import/export labels |
| same | 6 | Table/Board view switch, URL + session preference | All; while not loading | CP `view.*` |
| same | 7a | Loading skeleton OR error + Retry OR real-empty scope message + permitted Raise request | All, mutually exclusive | CP `error.*`, `empty.*`; `uxs19.emptyScopeNote` |
| same | 7b | No-match + Clear filters (both views) when collection nonempty but narrowed to none | All | CP `noMatch.*` |
| same + `P/procurement/ProcurementListRow.tsx` | 7c | Table-style list: request title/code + disclosure, project, requester, value, created-age, current status + next step; title/row opens record | All, filtered newest `created_at` first | CP `columns.*`, `uxs19.*`; literal age strings |
| request row expanded | 8 | Lazy loading/error/retry; budget signal if eligible; line quantities × rates = amounts; View full request | All previews; project-wide budget only permitted M | CP `preview.*`; budget literals |
| `C/ProcurementBoard.tsx`, `C/procurement.ts` | alternate 7c | Stage columns, counts, per-currency value totals; cards open record with project/status/value evidence; stage-empty copy | All in same filtered scope; Rejected/Cancelled have no board stage and remain reachable in Table | CP and shared status/stage-label mappings |
| Procurement export | non-rendered | Separate descriptor uses request/project/requester/value/lifecycle/status + currency/external references; these are not the displayed list columns | Export users | Export headers intentionally literal, not UI labels |
| cycle wizard | overlay | Upload/validate/map/review case records and import outcomes; close refetches list after import | Create permitted | Shared import/cycle-wizard locale keys; keep wizard behaviour |
| `P/ProcurementCreate.tsx` | 1 | Denied h1 instead of form when unavailable; otherwise Back to Procurement | Permission-dependent | PC denied; Shared shell return |
| same | 2 | Form header: New purchase request + remains-draft note + Save | Create-permitted All | PC heading/draftNote/save |
| same | 3 | Request details: required title; project from `?project`; optional vendor; budget category/helper | Create-permitted All; header locked after partial save | PC; `budgetCategoryOptions.ts` |
| same | 4 | Save error explaining recovery | On failure | PC `linesFailed` or classified error |
| same + `P/procurement/LineItemsSection.tsx` | 5 | Line-items heading/formula; table name/qty/unit price/amount/actions; inline edit; add description/qty/rate/derived amount; remove confirmation | Editable on capture; record item permissions vary | PL `lineItems.*`; some literal aria/dialog copy |
| same | 6 | Unsaved or partially saved leave confirmation; Stay/Leave; retry saves only remaining failed lines | Dirty/partial-save state | PC `unsaved.*` |
| `P/ProcurementDetails.tsx` | fallback | Back + loading; Back + no-access/not-found; Back + error/Retry before record body | Record readers | CP access/error families |
| same | 1 | Phone Back; RecordHeader title, status pill, code/project/requester metadata; Edit toggles header editor | Record readers; Edit conditional | CP meta/edit/status hook |
| same | 2 | Full lifecycle bar, actual document references and stage visibility | Record readers | CP lifecycle label + shared stage mapping |
| same | 3 | Expanded header edit title/project/vendor/category and Save/Cancel | Permitted editable Draft/Rejected requester | CP and PL; header-edit component |
| same | 4 | Five tabs Overview, Line items, Documents, Vendor quotes, History; counts for items/documents/quotes | Record readers; section chosen by URL, invalid tab falls back Overview | CP `tabs.*` |
| `P/procurement/ProcurementOverviewTab.tsx` | Overview 5.1 | Conditional stat tiles: PR value; selected quote; PO committed; goods-receipt count/status | Record readers; only existing quote/order/receipt facts | CP `tile.*` |
| same + `DecisionSupportPanel.tsx` | Overview 5.2 | Project-linked pre-order budget: This request, other Reserved, Available, Project budget, After this request; remaining percentage; abnormal advisory/currency caveat; Open project | Project-wide purchasing readers, Draft through Quote Selected; own-scope viewers omit panel | Literal budget text; shared formatted currency |
| same | Overview 5.3 | Detail dl: project, vendor, requester, approver; explicit not-linked/not-yet-selected/pending values | Record readers | CP detail keys; literal heading |
| same + `ProcurementProgressionTimeline.tsx` | Overview 5.4 | Right-side dated progression, newest first, transition spine with document annotations | Record readers | Literal heading; progression component labels |
| `LineItemsSection.tsx` | Items 5 | Existing lines + optional ERP item catalog; add/edit/delete when allowed | Record readers; existing item gates | PL |
| `ProcurementLedger.tsx` | Documents 5.1 | Title; All/Financial/Has file filters; chronological seven-type ledger (PR/RFQ/Quote/PO/GR/Invoice/Payment); date/type/system number/external ref/group ref/e-faktur/amount/status/file | Permitted record evidence readers; money and editing columns keep existing gates | PL |
| same + `LedgerCaptureRow.tsx`, `RecordCaptureForm.tsx` | Documents 5.2 | Ledger capture choices from missing record kinds, inputs/references/currency/amount/status/date/vendor tax as applicable; tax basis, withholding breakdown; file cells and record/retry/remove interactions | Eligible capture/file/tax actions | PL; shared tax/form labels |
| `ProcurementDetails.tsx` | Documents 5.3 | Conditional Set vendor picker with Save/Cancel for withholding workflow | Eligible viewer when opened | `bupot.*` |
| `LinkedErpDocuments.tsx` | Documents 5.4 | Linked ERP docs: identity/type/date/amount/status; unlink confirmation when permitted | ERP-document readers; unlink current permitted roles | EF |
| `ProcurementMicrosoftReferences.tsx` | Documents 5.5 | SharePoint references grouped by case record/linked ERP target; picker/manual link, open/edit/remove/retry states | Feature/connection/record eligible | common `m365Documents.*` |
| `RecordHistory` | History 5 | Record history including children, actor/date/change evidence | Record readers, scoped results | Shared history locale keys |
| `VendorQuotesTab.tsx` | Quotes 5 | Header + Add quote; empty guidance OR sorted bid table (vendor/reference, value status, amount, validity, attachments, Select); inline vendor/amount/validity/reference inputs; selection confirmation | Readers; quote management/selection/files independently gated | CP quote families + literal table/action copy; PL files |
| `ProcurementDecisionZone.tsx` | 6 | Single sticky decision area on every tab: readiness/routing/blocked reason; payment-ceiling notice; optional review notes; current transition buttons; optional GR/VI record capture and inline tax fields; mutation errors | Record readers; action/routing/ownership/stage gates | CP decision/action/vendorInvoice; some literal ready messages |
| `ProcurementDetails.tsx` | 7 | Opened withholding-slip record form, history and detail (view/version/download/void controls as permitted) | Existing invoice/vendor/slip eligibility | `bupot.*`, shared tax labels |
| same | 8 | Approval notes then rejection notes, when present | Record readers | CP approvalNotes/rejectionNotes |
| same | 9 | Staged consequential transition/capture confirmation with object, money, project/person context, pending/error result | On eligible staged action | CP confirm families; localized `Trans` context |
| `P/ErpPurchases.tsx` | 1 | ListPage title “ERPNext documents not in a purchase”; scope says already counted in project Actuals; count and Procurement requests return | M; Engineer gets no-access body | EF |
| same | 2 | No access OR error/Retry OR loading OR “Every ERPNext document is in a purchase” + next-sync guidance OR list card | By query and permission state | EF |
| `ErpOrphansSection.tsx` | 3 | Select-all and hint, selected count, bulk Link/New purchase/Clear; ambiguous multi-project reason | Linking-permitted M; bulk actions only selection | EF `erpLinks.*` |
| same | 4 | Outcome notice for added/linked/refused/error, links to target purchases | After operation | EF |
| same | 5 | Table/cards: document + type/checkbox, supplier, project(s), date, pre-tax amount, Link menu (hidden during bulk selection) | M; actions gated; unknown amount/currency is dash | EF `erpPurchases.column.*`, `erpLinks.*` |
| same + `LinkErpDocumentsDialog.tsx` | 6 | Choose existing purchase; inspect documents, project scope and link result; single/bulk new-purchase outcomes | When Link opens; eligibility unchanged | EF |
| `P/ExpenseClaims.tsx` | 1 | Expenses title and own/team description; Request advance secondary and New claim primary | All; creation gated | EX title/description/actions |
| same | 2 | Status, kind and budget-category selects | All; in-memory control state, server-side filtering | EX `filters.*` + category helper |
| `P/expenses/AdvanceAgingCard.tsx` | 3 | Hidden pending/no rows; error + retry independently; otherwise per-currency four age-bucket totals then outstanding table (advance/claimant/project/outstanding/age), oldest-limit notice | Own/team query scope | EX `aging.*` and helper mappings |
| `ExpenseClaims.tsx` | 4 | Loading OR list error/Retry OR latest-record truncation notice | All | EX states/truncated |
| same | 5 | Table number/type/title/claimant/project/category/amount/status; row activation opens record; same empty copy even when filtered | All, scoped; latest `created_at`, then id descending, bounded result | EX columns/table/status/kind |
| `ExpenseClaimFormModal.tsx` | overlay | Request advance: title/project/category/amount/purpose, source suggestion, readiness note, validation and Save/Cancel; shared modal also edits existing details | All for own capture/edit eligibility | EX; shared form labels |
| `P/ExpenseClaimNew.tsx` | 1 | Back; denied notice OR title/subtitle | All permitted create | EC; EX title |
| same | 2 | Posting-readiness note | Permitted capture; active/unavailable/inactive state | common `uxs12.expensePosting.*` |
| same | 3 | Details: title, project/overhead, category + route helper/source suggestion, purpose, optional own advance | All permitted create | EX `form.*`, `uxs29.expenseCapture.*` |
| same | 4 | Lines: date/type/description/amount, conditional Remove, Add line; optional receipt file input/name after lines | All permitted create | EX lines and receipt keys |
| same | 5 | Inline error; sticky Cancel/Save footer; saving feedback | All permitted create; error/saving states | EX submitSave/cancel; EC saving |
| same | 6 | Discard confirmation; capture pipeline recovers saved draft on partial write failure instead of duplicate creation | Dirty leave / failure | EC discard; classified mutation toast |
| `P/ExpenseClaimDetail.tsx` | fallback | Back + loading/error Retry/not-found before record body | Scoped query reader | EX detail states |
| same | 1 | Phone Back; RecordHeader title/status; number/kind/claimant/project-or-overhead/category; Edit details | Record readers; edit owner Draft/Rejected | EX detail/kind/status + category helper |
| same | 2 | Summary heading; amount; paid claim advance-applied/cash-paid; paid advance outstanding; payment reference; linked advance; purpose; rejected/draft rejection note | Record readers; conditional facts by kind/status | EX detail summary/amount/settlement families |
| same | 3 | Approval-route note when submitted non-flat route and non-claimant viewer cannot approve | Applicable record viewer | Shared approval-route helper |
| `ExpenseDecisionBar.tsx` | 4 | Eligible Submit/Reopen/Approve/Reject/Pay/Return/Cancel; approval/rejection/pay/return/cancel dialogs, notes/reference/amount fields, settlement preview, outcome toasts | `availableExpenseActions` result; no actions means no bar | EX actions/confirm/toast |
| `ExpenseLinesCard.tsx` | 5 | Claim-only lines date/type/description/amount/actions, total; loading/error/empty; add/edit modal and remove confirmation | Claims only; editable owner Draft/Rejected | EX lines; expense-type helper |
| `ExpenseReceiptsCard.tsx` | 6 | Receipt list, upload/select and open/remove; pending/error/empty; removal confirmation | Record readers; write only editable record | EX receipts |
| `ExpensePostingsCard.tsx` | 7 | Ledger postings: kind, queued/failed/held/posted/cancelled outcome, reference and human reason; error Retry or inactive/unavailable note; nothing when pending/no rows and ready | Record readers | EX postings + `uxs12.expensePosting.*` |
| `ExpenseClaimFormModal.tsx` | 8 | Edit details modal, existing kind/title/project/category/purpose/amount/advance; Save/Cancel and recovery | Editable owner Draft/Rejected | EX form labels |

Current exports/imports and capture surfaces remain reachable after recomposition; record types, amounts, quote comparisons, currency/tax basis, evidence links and existing confirmations are retained. No duplicate display is evidence that a business fact can be deleted.

## Merge and retire register

These are decisions for the builder's whole-page recomposition, superseding old composition instructions. List them in the implementation PR body. No route without a job was found among these seven page types; individual blocks are still removed when they merely repeat another block.

| Current block / URL | Decision and resulting home | Persona reason / reachability |
|---|---|---|
| Full-width procurement lifecycle band on every section | RETIRE band; current status/date in identity, dated progression in Activity | Every persona needs the current handoff; no persona needs its second full-width presentation before their evidence |
| Overview PR-value tile + Budget impact “This request” | MERGE into one request-value fact in Review | Approver needs one request amount, not two matching figures; keep distinct selected-quote/order amounts, not misleading equality deduplication |
| Overview Detail panel repeats header/project/requester | MERGE project/requester/vendor into scope; approver/date into decision/activity evidence | No separate job for a duplicate identity panel; all facts remain visible in their useful context |
| Overview Progression sidebar + `/history` | MERGE into named Activity section at `/procurement/:id/activity`; redirect legacy `/history` preserving return context | Timeline and audit changes serve one chronology job; retain child changes, actors, timestamps and evidence links, avoid duplicate events |
| Overview tab label | Rename section to Review, retain `/overview` as canonical compatible URL and bare `/:id` default | First decision evidence stays reachable without inventing a second home |
| Five-tab strip | RETIRE strip; named section navigation for Review/Items/Documents/Quotes/Activity; phone labelled section selector | Distinct jobs exceed N-03's tab limit; existing section URLs remain valid |
| Expense aging tile dashboard and second table | MERGE into `/expenses?view=outstanding` | Finance/claimant finishes finding unsettled cash from the same register; retain age and exact outstanding, oldest-first ordering, per-currency basis, limit notice; old records still open `/expenses/:claimId` |
| Four aggregate age-bucket tiles | RETIRE; age stays on each outstanding row and age-bucket filter supplies narrowing | A claimant settles an advance, not an age-bucket total; no cross-currency aggregate replaces them |
| Expense Summary wrapper + repeated lines total | MERGE into purpose/amount/settlement evidence; single claim total | A reviewer checks one claim total against lines; keep distinct cash paid, advance applied and outstanding facts |
| Long-lived “ready to advance” explanatory boxes | RETIRE generic readiness boxes; keep actual disabled reasons, routing and consequential confirmation | No persona needs a second instruction to press the labelled action; necessary constraints remain beside it |

List previews stay: they let a reviewer inspect budget/items without losing the register. ERP purchases stays: linking unassigned evidence is a different job from raising a request. Expense and procurement capture stay separate: incurred personal expense/advance and vendor purchasing have different evidence and handoffs. No data or schema changes follow from these UI decisions.

## Target details and section sketches

All sketches are content tracks inside the shell, not pixel/radius prescriptions. Record sections share the parent header/scope. Phone first-screen goals in the brief assume 390×844; long identities wrap and the evidence start may move down, never clipped to force a fold. Keyboard order follows reading order. Do not replace denied states with a redirect that implies access.

| Purchase section | Target order / primary | 1440 ASCII | 390 ASCII, before fold |
|---|---|---|---|
| Review (`/:id`, `/overview`) | Status/scope; request/selected offer/commitment facts; pre-order budget; items/evidence; notes + eligible transition | `[identity/scope] > [sections] > [request/quote/order] > [budget] > [items/evidence] > [decision]` | `[Back identity/status scope] > [Section: Review] > [amount/budget] > fold` |
| `/items` | Read lines, edit/add disclosure; no competing filled transition while editing; saved outcome | `[identity] > [sections] > [item qty rate amount actions] > [Add/edit] > [Save line]` | `[identity scope] > [Section: Items] > [first line qty/rate/amount] > fold` |
| `/documents` | Filter → document identity/reference/date/status/amount/basis → files/actions; add record; linked ERP docs; SharePoint refs | `[identity] > [sections] > [filters ledger] > [capture v] > [linked ERP] > [references]` | `[identity scope] > [Section: Documents] > [filters] > [document/date/amount Open] > fold` |
| `/quotes` | Compare vendor/reference/status/validity/amount/files; Add quote secondary; Select stages confirmation with selected offer evidence | `[identity] > [sections] > [vendor status/date amount files Select] > [Add quote v]` | `[identity scope] > [Section: Quotes] > [vendor amount validity files Select] > fold` |
| `/activity` (`/history` redirect) | One dated event list with actor, transition/change, reference; latest first; preserve audit detail | `[identity] > [sections] > [date actor change evidence]` | `[identity scope] > [Section: Activity] > [latest event/evidence] > fold` |

Target list sort choices are labelled and URL-owned: procurement default newest request creation, Needs approval oldest request submission (use existing transition evidence; if unavailable label/order by creation rather than inventing submission dates); ERP latest document date; expense newest creation labelled “Newest claims”; outstanding advances oldest payout date. Unknown dates sort last; ties use stable identity. Label actual available date meaning (C-03/S-01), never silently substitute one business date for another.

Filters/search must cover the declared server-side scope; preserve expense list/aging bounds and partial-result notices. If a desired narrowing cannot be applied to all matching records with current repository capabilities, use supported filters and a clear bounded-scope label rather than adding schema or presenting exhaustive search. Claims/advances view retains category; Outstanding advances view uses its own applicable project/age filters and scope, without carrying an irrelevant claim status. Changing views saves each working set in URL. Procurement exact lifecycle drills must not widen to a reporting bucket.

One primary by state: collection creation; capture Save draft; record next eligible transition; quote selection/capture Save only while that task is active; ERP Link selected only after selection. Terminal/read-only states need no primary. Single-row ERP Link is a labelled quiet action; its dialog confirmation owns the filled action. Preserve existing decline/cancel/return paths. New purchase from ERP selection remains secondary and records all partial refusals with target links.

Truth: preserve status date, original amount currency and saved inclusive/exclusive/pre-tax basis. No currency aggregation or conversion is introduced. A missing budget/read failure cannot imply zero headroom; a receipt count cannot imply completed delivery; unknown advance balance prevents a fabricated cash settlement preview. Show one consolidated abnormal-data note with scope + remedy, while retaining field-specific validation and action-blocking reasons. Accounting failures get a human remedy, never raw queue/transport detail.

First value comes from completing a real draft/link, not a tour: empty requests offer Raise request; empty claims offer New claim and quiet Request advance; ERP all-linked explains the next refresh and return. No-match uses Clear filters. Capture receipts/lines before secondary details, keep required category/project choices discoverable, and preserve user-edited suggestions and partial-save recovery. Keep exact record amount readable while scrolling to the decision.

## Screenshot manifest

For each row instantiate every listed route/section and decision state with synthetic data at **390×844 and 1440×900 × EN/ID × light/dark**. URL, real role, record state and scope belong in the evidence manifest. Use paired before/after captures for each navigation/action. Show long identity/reference, multi-currency, long ID labels and keyboard focus; these are acceptance inputs, not claims about the unrendered source. Exercise each named toggle/filter/sort/dialog, not only the defaults.

| Route(s) | Decision-relevant states and roles to capture | Interaction proof |
|---|---|---|
| `/procurement` | All five personas; own/team scope; loading/error/Retry; genuine empty; search/status/project no-match; exact lifecycle drill; every offered status; Table/Board; long rows and mixed currencies | Filter/sort/view URL replay; preview collapsed/loading/error/open; title/project open then named Back restores working set; More export/import/cycle import and ERP link |
| `/procurement/new` | All create-eligible personas; project-prefilled/direct; blank/valid/invalid items; optional vendor open/closed; saving/error; header saved with failed lines; leave/discard | Retain title/lines on failure; retry does not duplicate saved request/items; Save draft opens canonical record; Cancel restores origin |
| `/procurement/:id`, `/overview` | Draft author, Requested eligible reviewer and non-decider, Approved, Vendor Quoted, Quote Selected, Ordered, Received, Vendor Invoiced, Paid, Rejected, Cancelled; own-scope reader; permitted header edit; no-data/error/loading | Budget pending/unavailable/no-active-budget/known zero/over-budget/mixed-currency exclusion; next action, reason/route and confirmation; confirmed result and declined confirmation |
| `/procurement/:id/items` | Empty/populated; read-only vs editable; ERP catalog on/off/error; invalid qty/rate; add/edit/delete pending/error/result | Correct math and locale parsing; destructive confirmation; no accidental row activation; line evidence survives section navigation |
| `/procurement/:id/documents` | Every ledger filter; each record type; capture options; unknown amount/reference; files zero/multiple/error; tax basis/withholding/slip states; linked/unlinked ERP; references unavailable/empty/populated | Capture/save/confirm/error/partial result; tax/slip view/history/vendor selection; reference picker/manual link/edit/remove; documented money gates remain; no duplicate source records |
| `/procurement/:id/quotes` | No bids, multiple bids/currencies, selected/expired bid; eligible/read-only; add/cancel/invalid/error | Compare evidence, choose bid, confirm/cancel, resulting status; quotes remain reachable from compatibility links |
| `/procurement/:id/activity`, legacy `/history` | Empty/populated/error; multiple child changes; terminal case; all permitted readers | Legacy redirect retains record identity and list return; actor/date/doc evidence available; no repeated event |
| `/erp-purchases` | M roles plus Engineer denied; loading/error/Retry; all linked; no-match; one/multi-project/no-project records; unknown pre-tax/currency; selection none/some/all; linking unavailable | Single/bulk existing purchase link; create-from-selection; ambiguity reason; cancel dialog; pending/error/partial refusals and success target; back preserves source scope |
| `/expenses` | Own Engineer + M team scope; loading/error; empty vs no-match; claim/advance/status/category/project filters; Claims/Outstanding views; outstanding empty/error/limit; mixed currencies; unknown age | New claim, request-advance modal invalid/pending/error/result; sort/view/filter URL replay; record/back restores context; no combined currency totals |
| `/expenses/new` | All own-capture personas; inherited project; blank/started/valid lines; optional receipt; unknown type; suggestions and explicit overrides; own advance/no advance; readiness active/inactive/unavailable | First receipt/line → details → Save draft; bad date/amount; discard/stay; repeated-submit prevention; partial receipt failure keeps saved draft and inputs/recovery route |
| `/expenses/:claimId` | Claim vs advance; Draft/Submitted/Approved/Rejected/Paid/Cancelled; owner, eligible reviewer, eligible payer, non-decider; unknown outstanding; no-data/loading/error | Lines add/edit/remove; receipt upload/open/remove/retry; routing; submit/reopen/approve/reject/pay/return/cancel confirmation + pending/error/success; advance-applied/cash split; linked advance; accounting collapsed/open queued/failed/held/posted/ERP-cancelled/inactive/unavailable |

Acceptance rules: PA-00 job is clear on first screen; PA-01–04 one type/alignment/evidence/fact; N-01–04 location/back/canonical sections/URL; A-01–04 one primary, correct placement, verb+object, adjacent reasons/confirmations; E-01–04 context/labels/grouping/recovery; C-01–06 toolbar/empty/sort/columns/links/loading; S-01–05 dated/based statuses, stable controlled figures, unknowns, one caveat, exact money; L-01/02 complete equivalent labels. Mechanical evidence: exactly one h1, scrollWidth ≤ clientWidth at 390, phone targets ≥44×44, axe serious/critical = 0, no new colour/font/radius and empty detector on recomposed routes. Use `scripts/ux-proof.sh`; rendered review/owner approval remains required for UI work.

## Test disposition

Delete look-only assertions when the owning page is recomposed, not whole mixed-purpose suites. Source inspection below identifies actual assertion families; the builder must retain their behaviour counterparts and introduce no replacement layout-pinning oracle. This docs delivery runs no product tests because it changes no runtime behaviour.

| Test path under `pmo-portal/` | Delete on recompose | Keep / adapt only deliberate journey steps |
|---|---|---|
| `pages/procurement/ProcurementOverviewTab.test.tsx` | StatTiles wrapper/count/first-strip dependency; side-slot placement | Real request/quote/order values, budget applicability, semantic facts, dated event ordering/current event |
| `pages/__tests__/ProcurementDetails.tabshell.test.tsx` | Five-tablist/panel/count-badge structure, roving tab arrows, action-zone outside-tab placement | Deep links and unknown-section fallback; return state; authorized transition/receipt actions; replacement named section keyboard accessibility |
| `pages/__tests__/ProcurementDetails.s6mobile.test.tsx` | Exact `hidden`, `max-[920px]:block`, `sticky`, `bottom-0` class assertions | Named Back/navigation, one decision control, no terminal transition, contextual separation-of-duties copy |
| `pages/__tests__/ProcurementDetails.stepper.test.tsx` | Exact stepper-node indexes/absence of a named node in retired band | Requested→Approved progression remains distinguishable in status and dated Activity; actual references correspond to real records |
| `pages/ProcurementDetails.test.tsx`, `pages/__tests__/ProcurementDetails.reviewFixes.test.tsx` | Only assertions requiring retired tile/stepper/summary containers | Loading/error/Retry/back, permissions, selected quote/PO/receipt facts, terminal truth and consequential transitions |
| `pages/Procurement.test.tsx`, `pages/Procurement.analytics.test.tsx`, `pages/Procurement.externalRef.test.tsx`, `pages/__tests__/Procurement.urlParam.test.tsx`, `pages/__tests__/Procurement.boardEmptyFilter.test.tsx`, `pages/__tests__/Procurement.preview.test.tsx` | Any removed layout-wrapper assertions only | Search/reference matching, exact/group status drills, no-match/empty split, view persistence, preview reads, analytics and list activation |
| `components/ProcurementBoard.test.tsx`, `components/ProcurementBoard.bahasa.test.tsx`, `pages/procurement/ProcurementListRow.test.tsx`, `pages/procurement/__tests__/ProcurementListRow.currency.test.tsx`, `pages/procurement/__tests__/ProcurementListRow.rowclick.test.tsx` | Duplicate stage-indicator presentation assertions if affected | Currency-separated totals, status/next-step/EN-ID meaning, links, row/disclosure interaction isolation |
| `pages/ProcurementCreate.test.tsx`, `pages/procurement/LineItemsSection.numericValidation.test.tsx`, `pages/procurement/LineItemsSection.test.tsx` | Header Save location only | Draft create, validation, dirty guard, partial-save retry/idempotency and item arithmetic |
| `pages/procurement/computeBudgetSignal.test.ts`, `pages/procurement/DecisionSupportPanel.test.tsx`, `pages/procurement/__tests__/DecisionSupportPanel.test.tsx`, `pages/procurement/purchaseValue.test.ts`, `pages/procurement/recordAmount.test.ts` | Duplicate tile-count/wrapper assertions only | Budget math/stage applicability, reserved double-count prevention, unknown/multi-currency truth and value basis |
| `pages/procurement/ProcurementLedger.test.tsx`, `pages/procurement/ProcurementLedger.labels.test.tsx`, `pages/procurement/ProcurementLedger.pushRouting.test.tsx`, `pages/procurement/RecordCaptureForm.vendorTax.test.tsx`, `pages/procurement/RecordCaptureForm.currency.test.tsx`, `pages/procurement/LinkedErpDocuments.test.tsx`, `pages/procurement/LinkErpDocumentsDialog.test.tsx`, `pages/procurement/ErpOrphansSection.test.tsx` | No blanket deletions | Record/currency/tax/file/source/routing, link/unlink/partial-result and invalid-input behaviours; preserve other ledger/capture/slip suites in this directory |
| `pages/ErpPurchases.test.tsx`, `pages/ExpenseClaims.test.tsx`, `pages/ExpenseClaimNew.test.tsx`, `pages/ExpenseClaimDetail.test.tsx` | Old aging-before-list and summary-wrapper placement assertions only if present | Roles, empty/error/Retry, capture/decision/settlement, exact amounts and record links; adapt receipt-first and outstanding-view journey |
| `pages/expenses/AdvanceAgingCard.test.tsx`, `pages/expenses/ExpenseLinesCard.test.tsx`, `pages/expenses/ExpenseReceiptsCard.test.tsx`, `pages/expenses/ExpensePostingsCard.test.tsx`, `pages/expenses/ExpenseClaimFormModal.capture.test.tsx` | Four aging-tile DOM/count/presentation assertions and repeated-total wrapper expectations | Per-currency aging arithmetic, oldest-first/bounded scope, lines/receipt CRUD, posting outcomes and saved-draft recovery; move aging behavioural proof to new view |
| `e2e/AC-PROC-001-procurement-crud.spec.ts`, `e2e/AC-816-procure-to-pay.spec.ts`, `e2e/AC-APR-040-routed-procurement-approval.spec.ts`, `e2e/AC-CONFIRM-001-procurement-confirm.spec.ts` | No goal-oracle deletion | Create→review→purchase/payment, eligibility and confirmation goals; adapt section navigation only |
| `e2e/AC-PVT-001-procurement-view-toggle-phone.spec.ts`, `e2e/AC-LRC-005-procurement-return.spec.ts`, `e2e/AC-1200-procurement-list-loads.spec.ts`, `e2e/AC-IMP-CYCLE-001-procurement-cycle-import.spec.ts`, `e2e/m365-procurement-reference-ui.spec.ts` | Look-only assumptions about old containers | Phone view toggle, preserved working set, import/reference and record reachability goals |
| `e2e/AC-EPR-008-erp-purchases.spec.ts`, `e2e/AC-EXP-070-expense-claim-journey.spec.ts`, `e2e/serial/AC-EXP-140-expense-postings-erp.spec.ts` | No goal-oracle deletion | ERP attribution/linking, claim→approval→payment/settlement and accounting outcomes |

Keep the existing `src/lib/expenses/expenseRules` tests, permissions, money, date/TZ and database proof unchanged in purpose. Before editing e2e read `docs/e2e-parallel-conventions.md`; before any build route the executor via `docs/factory-workflow.md` and use `docs/money-path-primer.md` for this money area. Run the project's required local scoped gates and CI gates; no full-suite claims derive from this static spec pass.

## Method and detector

`/shape`: PRODUCT and PA-00 establish request → review → purchase/pay, link imported evidence, and claim → settle as distinct jobs. `/critique`: independent source assessment A and detector assessment B; source-only, no rendered score or approval claimed. `/layout`: one evidence track, decision after evidence, no sparse progression sidebar; phone drops secondary details behind named disclosures. `/distill`: the register above removes duplicate facts/chronologies/aging lists. `/onboard`: first real draft/link, optional receipt, distinct first-use/no-match and recoverable partial-save outcomes. Taste v1 lenses apply to hierarchy, repeated facts, untruncated identity and anti-slop; its new font/colour/motion recipes are superseded by the user's locked tokens.

UI UX Pro Max `scripts/search.py` was run for **purchase request**, **approval flow**, **expense claim**, **receipt capture**, **stepper** with `--domain ux --max-results 2`. All five exact phrases returned no database match. Narrow retries `form labels`, `confirmation feedback`, `form validation`, `file upload`, `step progress` returned associated labels + submit feedback, success/destructive confirmations, form feedback and progress indicators; `file upload` still had no match. Receipt capture guidance therefore comes from shipped capture behaviour, PRODUCT, E-01–04 and explicit designer judgment, not a claimed search match. No replacement visual system was generated.

The requested `scripts/vendor-skills.sh` was run because this worktree lacked `.claude/skills`. It installed Impeccable, then stopped because the upstream Taste v1 source path was absent. Existing vendored Taste v1 and UI UX Pro Max from sibling `redesign-shell` were copied into this worktree’s ignored `.claude/skills`; those local references/tools supplied the requested guidance. No tracked skill files were changed. `impeccable context` loaded PRODUCT/DESIGN for `pmo-portal/pages/Procurement.tsx` once; composition authority remains UX-STANDARD.

Static detector command, run from this worktree root with the existing vendored executable:

```sh
../redesign-shell/.claude/skills/impeccable/scripts/impeccable detect --json pmo-portal/pages pmo-portal/components
```

Result: **0 findings**, output `[]`, exit **0**. Repeated with `--no-config`: **0 findings**, `[]`, exit **0**. Scope: recursive `pmo-portal/pages` plus `pmo-portal/components`, including these page bodies and their procurement/expense components; it does not claim coverage of every shared `src/components` primitive or rendered route. Static TSX/JSX detection uses pattern matching; no browser/axe/phone validation is implied. Builder must run the detector and rendered proof on the recomposed surfaces.
