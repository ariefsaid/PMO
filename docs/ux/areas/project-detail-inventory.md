# Project detail — source inventory and builder evidence

Companion to [the capped builder brief](project-detail.md). Baseline `123d2ec9`; source inspection only, not rendered approval. All paths below are relative to repository root. `PD` = `pmo-portal/pages/project-detail/`; `T` = `PD/tabs/`; locale files = `pmo-portal/public/locales/{en,id}/<namespace>.json`. Read actual component bodies rather than historical comments naming five tabs: there are eight section values.

## Scope and discovery (/shape)

One discovery round from `PRODUCT.md`, `docs/ux/areas.md`, `docs/ux/areas/shell.md`, `ProjectDetail.tsx`, and all section bodies: a contract/project record combines delivery decisions, budget/spend, orders, billing and evidence. The first user operates both project and finance work; later PM, Finance and staff need different permitted actions in the same canonical record. First value is understanding the current position and taking one contextual next action, without expanding metadata before reaching work. No new feature, route, theme or role model is needed; obsolete blocks are merged by decision below, not retained because they exist. The owner's evidence settles the priority: consolidate trustworthy money, eliminate accidental empty space and disclosure barriers. Questions skipped: the supplied brief and product/routes provide this discovery round; this task delivers a proposal, not product implementation.

Alternatives considered: retaining eight tabs preserves the existing N-03 problem; a new finance-only route fragments record context; a permanent right metadata rail consumes work width. Choose grouped section links with secondary details after the selected work. Desktop uses the same content left edge after navigation; phone shows a current-section chooser with a grouped sheet. These are builder proposals requiring rendered approval, not new composition locks.

## Route × persona jobs — PA-00 / OD-ROUTE-JTBD

The base route and explicit Overview are the same job; unknown section uses that same fallback. All other existing section paths are separately addressed below. Pre-win/lost Work orders and Billing resolve Overview by the current route contract. Persona expectations describe intended user outcomes, never expanded permissions. First-screen answers/sketches in the brief settle these jobs; read-only roles finish by understanding or locating evidence, not by receiving unavailable writes.

### `/projects/:id and /projects/:id/overview`

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | I expect delivery and money exceptions together | I decide the next intervention |
| Executive | I expect contract exposure and delivery confidence | I identify the project decision I must make |
| Finance | I expect spending, invoices and receipts on explicit bases | I reconcile the project position |
| PM | I expect budget pressure and the next delivery blocker | I choose the next delivery action |
| Engineer | I expect phase context and my permitted project facts | I locate the work I should complete next |

### `/projects/:id/budget`

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | I expect the active budget and any blocked change | I resolve the next budget decision |
| Executive | I expect forecast final cost against the approved budget | I judge whether the plan needs intervention |
| Finance | I expect category spending, estimates and version evidence | I finish a trustworthy forecast or budget review |
| PM | I expect remaining cost and the working budget version | I update the delivery cost plan |
| Engineer | I expect the recorded budget context I may read | I understand the cost constraint on my work |

### `/projects/:id/procurement`

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | I expect purchase cases and unresolved purchasing evidence | I identify the purchase exception to resolve |
| Executive | I expect purchase status and financial exposure | I decide which purchase needs my attention |
| Finance | I expect purchase values, vendor evidence and unpaid aging | I find the purchase or bill needing action |
| PM | I expect requests for this project and their next stages | I raise or advance the purchase needed for delivery |
| Engineer | I expect my requests within this project | I raise a request or follow its outcome |

### `/projects/:id/tasks`

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | I expect due and blocked work by delivery phase | I assign or unblock project work |
| Executive | I expect task ownership and delivery risks | I identify the work needing escalation |
| Finance | I expect assigned tasks and tasks I created | I complete my assigned work or update my own task |
| PM | I expect phase work, due dates and dependencies | I plan and advance the team’s work |
| Engineer | I expect my assignments with status and context | I update my task outcome or ask through comments |

### `/projects/:id/work-orders`

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | I expect order headroom, acceptance and billing evidence | I resolve an order or acceptance decision |
| Executive | I expect issued commitments and remaining contract scope | I judge contract exposure before advancing an order |
| Finance | I expect accepted value and still-to-invoice balances | I confirm eligible acceptance or prepare the next invoice |
| PM | I expect ordered quantities and acceptance progress | I prepare the next order or delivery acceptance |
| Engineer | I expect readable order scope and status | I understand the ordered work I must deliver |

### `/projects/:id/billing`

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | I expect billable work and claim evidence | I prepare the next invoice or resolve its blocker |
| Executive | I expect earned, billed and unbilled work | I judge the billing gap or record eligible progress |
| Finance | I expect the amount to bill and supporting evidence | I prepare a supported claim or invoice |
| PM | I expect progress, quantities and the billing gap | I record eligible progress for billing |
| Engineer — ineligible | I expect to continue with permitted delivery work | I return to Tasks; I have no billing job here |

### `/projects/:id/documents`

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | I expect current project evidence and review status | I resolve or maintain a document record |
| Executive | I expect the current evidence and its approval state | I read or review the evidence for my decision |
| Finance | I expect current evidence supporting billing and purchases | I locate or record the supporting document |
| PM | I expect current revisions and review outcomes | I issue or maintain the project evidence |
| Engineer | I expect the current document and revision lineage | I open the evidence needed for my work |

### `/projects/:id/history`

| Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|
| Admin | I expect dated project and child-record changes | I trace the change that needs investigation |
| Executive | I expect consequential changes and their context | I understand how the project reached this position |
| Finance | I expect money-related record changes with dates | I trace the change behind a financial discrepancy |
| PM | I expect delivery and project changes in sequence | I establish what changed before my next action |
| Engineer | I expect changes to the project context I may read | I understand the latest instruction or outcome |

Keep these eight routes: each has the distinct persona job documented above. No route retirement is needed in this area. Engineer Billing remains explicitly ineligible; this is not a recommendation to expose it. The following **blocks** have no independent job beyond an existing fact group and are **merged in the build**, not optional candidates:

| Decision | Reason and retained home |
|---|---|
| Merge standalone header Financial summary into `/projects/:id/overview` | Contract/cost/billing figure groups own its permitted facts; other sections use only their own decision evidence |
| Merge Overview Budget snapshot headlines into `/projects/:id/overview` | Cost group owns active budget/Actual/variance/utilization; category detail remains disclosed with Budget link |
| Merge generic “Project details and actions” pre-content wrapper into `/projects/:id/:tab` frame | Identity/scope carries core context; title More carries status actions; trailing Project details carries secondary facts/ERP link |
| Merge common non-Overview phase strip into `/projects/:id/overview` | Planner and attention signal remain on Overview; Tasks retains phase grouping and blocker arrival |

Builder must remove the merged wrapper render paths, their dead component code/exports and their look-only tests; move surviving calculations, accessibility/role/money proofs and actions into the named home. List all four merges with these reasons in the build PR body. No data/schema deletion. These block merges remove no record route; if implementation removes any additional route, provide its explicit redirect to the new home and preserve record/query context. Do not retire an action with a documented user job merely because its wrapper is gone.

## Shared frame — actual render order

Role abbreviations: A Admin, X Executive, F Finance, P Project Manager, E Engineer. `All` means those five authenticated roles with access to the fetched record, not a promise of rows outside current data scope. `M` = A/X/F/P. `policy.ts` in `pmo-portal/src/auth/` decides UX role predicates; record state/identity, real-role/view-only checks and server decisions still apply. Role-specific placement never grants access.

| Order / source | Current block, fact or action | Audience / condition | EN/ID label source |
|---|---|---|---|
| 0 `ProjectDetail.tsx` | Cold loading, failed fetch + Retry, absent record + return are separate branches | All; no record body until loaded | common `projectDetail.loadError.*`, `notFound.*`, `backToProjects` |
| 1 same | Phone-only BackBar; desktop relies on shell breadcrumb | All; return preserves Projects working set | common `projectDetail.backToProjects`; shell owns breadcrumb |
| 2 `ProjectDetailHeader.tsx` | RecordHeader initial, short/display name h1 with full name title, status, customer and PO/date meta | All | record values; common `projectDetail.header.po*`; project status currently printed from record |
| 3 same | Header edit, archive and delete actions; corresponding edit modal and confirms mount at route/header foot | Edit A/X/P, archive A/X, delete A; applicability checks retained | common `projectDetail.header.action.*`, `archiveConfirm.*`, `deleteConfirm.*` |
| 4 same | Delivery finance strip: Contract + saved tax basis/FX; conditional PMO purchase orders + other currencies; Actual + source/coverage/as-of/attribution; conditional contract after cost and spend percent | A/X/F/P for on-hand/internal groups; native details open desktop, closed phone; does not appear for pipeline/lost | common `projectDetail.header.tile.*`, `uxs01.*`; shared TaxBasisLabel and FxEquivalent label keys |
| 5 same | Contract-value edit/lock explanation; number/tax treatment/rate/base/amount, VAT flag, Save/Cancel and audited confirm | Won value editor A/X/F; VAT A/F; read-only explanation otherwise. Pre-win value editing is in PipelineLens | common `projectDetail.header.*`; shared tax-treatment/rate strings |
| 6 `PipelineLens.tsx` | Pipeline/lost only: journey stepper, Next actions, read-only/terminal notice, Advance/Mark won/Mark lost; win capture and loss confirm on demand; Sales return; deal figures Value, probability, Weighted, Owner (lost: Value/Owner/Decision) | All read; transition/value workflow A/X/P via project edit predicate; F/E read-only | common `projectDetail.pipeline.*`; journey labels from `src/lib/db/projectTransitions.ts` and component maps |
| 7 `ProjectDetailRail.tsx` | One closed “Project details and actions”; Record status control (delivery only); Details dl: full contract name if short name differs, customer, optional end customer, PM, present service line/sector/location/award type/bidding entity, start/end, PMO number, client code, PO ref; ERP project link | All details; status control and ERP controls gate themselves; pre-win hides rail Record actions | common `uxs13.projectDetailsAndActions`, `projectDetail.rail.*`, `projectClassification.*`; projects `shortName.contractName`; shared classification label helper |
| 8 `MilestoneStrip.tsx` | Non-Overview sections show compact phase progress/blocker context above tabs | All; phase writes A/P only | common `projectDetail.milestones.*` |
| 9 `ProjectDetail.tsx` | Tabs: Overview → Budget → Procurement → Tasks → Work orders → Billing → Documents → History; selected lazy panel with loading fallback | All except Billing M; Work orders/Billing omitted pipeline/lost and those deep links resolve Overview | common `projectDetail.tabs.*` |

## Overview — actual selected-panel order

| Order / source | Current block and full contents | Audience / condition | Labels |
|---|---|---|---|
| 1 `MilestoneStrip.tsx` | Delivery phases heading/Add; empty planning affordance; ordered phase cards with name/current/target, effective %, weight, progress/override, overdue/at-risk and blocker link; edit/delete/progress forms and confirmations on demand | All read; A/P write; pipeline empty is compact | common `projectDetail.milestones.*`; locale phase vocabulary helpers |
| 2 `OverviewTab.tsx` | Read-only Financial summary: Contract/basis/FX, conditional PMO purchase orders, Actual, conditional contract after cost and Spend | E delivery-forward only on delivery groups; unavailable/partial facts remain such; no project-wide commitment query for E | common `projectDetail.overview.finance.*`, `uxs01.*` |
| 3 `ProjectDrawdown.tsx` | Contract drawdown/basis; progress bar; ceiling, issued, draft, headroom, overcommitment; loading/error+retry | All; absent if loaded issued and draft both nonpositive; feature remains on Work orders too | common `projectDetail.drawdown.*` |
| 4 `ProjectFinancesSection.tsx` | Project finances: no-linked-invoice sentence OR received cash, contract invoiced and remaining; each currency bucket's invoice count, invoiced, settled, outstanding, billed-work revenue and margin/tax basis; Recorded spending/updated/source/coverage/attribution; setup remedy; category amount disclosure; unavailable-category/setup disclosure; invoice-scope note | M via `salesInvoice.view`; on-hand contract fields conditional; accounting setup controls role-gated | common `projectFinances.*`, `uxs01.*`, `financeCopy.*`; project namespace spending/invoice strings; costAttribution `split.*` |
| 5a `OverviewTab.tsx` | Procurement summary: Open/Completed/Closed counts, total **request** value/count, three latest requests with title/code/status/amount, View all procurement | Loaded nonempty or failed scoped read; error+Retry retained; E sees its permitted request scope | common `projectDetail.overview.procSummary.*`, `uxs01.totalRequestValueAcross`; procurement stage helper |
| 5b same | Budget snapshot: active budget, Actual spent, variance/remaining/overrun, utilization/risk, category bars and Budget link | Active snapshot/comparable Actual available or budget error; cards share two columns only when both exist | common `projectDetail.overview.budgetSnapshot.*`, `budgetUtil.*`, `uxs01.*` |
| 6 `ProjectProfitLossSection.tsx` | Period-kind and period selectors (month/quarter/fiscal-year); current/prior income, expense and net; statement context/freshness/error+Retry | All via projectProfitLoss view; unavailable/default no activity/loading without catalogue omitted; chosen empty period retained | common `financialStatements.*`; `src/hooks/useFinancialStatements.ts` is eligibility authority |
| 7 `ProjectSCurve.tsx` | Progress curve heading; planned/actual progress figure, legend and accessible summary; absent/no-data states according to component | All; excluded pipeline/lost | common `projectDetail.scurve.*` and component's keys |
| 8 shared `CommentsSection` | Project comment thread, count, composer and permitted comment controls | Current authenticated/record scope; own-comment controls remain in shared component | common comments keys; `src/components/comments/CommentsSection.tsx` |

## Budget — actual selected-panel order

| Order / source | Current block and contents | Audience / condition | Labels |
|---|---|---|---|
| 1 `AttributedSpendingNote.tsx` | Attributed spending explanation and detail link | Active ERP binding and active budget only, child handles data | costAttribution namespace |
| 2 `pages/BudgetProjection.tsx` | Forecast h2 → fiscal year selector → Edit cost to finish or Save/Cancel → blocked-year status/retry/release → no projection state OR summary Budget/Recorded/Cost to finish/Final cost/Remaining-overrun + incomplete note/freshness → category table → Sources and budget enforcement disclosure with quiet push status | Same ERP+active gate; cost edit M via budgetLine; hold release A; read data stays scoped | common `uxs04.*`, `financeCopy.*`; some empty-year title text is literal English |
| 3 `pages/ProjectBudget.tsx` | Loading/error before ledger; active-budget/no-active message when needed + New version; create-version form when open; no versions state OR version selector when >1, one selected VersionCard, budget document evidence; consequence confirms at foot | All read; M draft line/version writes; activation uses draft/editor identity predicates (including existing operator path), not role alone | common `financeCopy.*`, `uxs04.*`; shared budget-category labels |
| 3a VersionCard | Version/name/status/total and contextual activation/clone/archive/delete, draft editable lines/add, fiscal year selection, line edit/save/cancel/delete; per-year breakdown as applicable | Immutable/version gates retained; no destructive shortcut | same; `BudgetDocumentLinks` keeps its document labels |

Current forecast columns: Category → Budget → Forecast final cost → Forecast remaining/(overrun) → Recorded spending → Cost to finish → Forecast budget used. Current budget-line columns: Category → Description → Fiscal year → Amount → Actions (read breakdown ends with Budgeted). These are current facts; target column order is in the brief.

## Procurement — actual selected-panel order

| Order / source | Current block and contents | Audience / condition | Labels |
|---|---|---|---|
| 1 `ProcurementTab.tsx` | Pending skeleton or failed read+Retry replaces body | All scoped readers | common `projectDetail.procurement.error.*` |
| 2 same | Purchase Requests h2 + New request (navigates `/procurement/new?project=…`) | All may create | common `projectDetail.procurement.title`, `newRequest` |
| 3 same | Request/code → Value → Status table; newest created_at first, row opens canonical procurement; empty copy distinguishes PMO requests and ERP documents below when present | All permitted rows; E is own-request scope | common `projectDetail.procurement.column.*`, `empty.*`, `uxs19.projectEmptyScope`; status helper |
| 4 `ErpPurchasesSection.tsx` | Unlinked ERP documents heading/count-in-Actuals note/all-unlinked link → error or shared ErpPurchasesTable → unpaid invoice aging per currency (not due through over 90 days, unpaid total), shared-project exclusions | M via procurement view; omitted if no orphan/aging and no error; link role gate retained | common `erpLinks.*`, `erpPurchases.*`; shared table |

## Tasks — actual selected-panel order

| Order / source | Current block and contents | Audience / condition | Labels |
|---|---|---|---|
| 1 `TasksTab.tsx` | Tasks h2 → Show/Hide archived if any archived rows → New task | All create; archive/delete A/X/P; record edits A/X/P or creator F/E; status A/X/P or own-assignee F/E | common `projectDetail.tasks.*` |
| 2 same | List/Board/Timeline view toggle except initial loading/empty | All | common `projectDetail.tasks.view.*` |
| 3 same | Loading/error+Retry/empty OR flat depth-ordered task table when no phases; otherwise groups in phase sort_order/name with ungrouped last and Add task per group. Columns Task → Assignee → Due → Status; priority/description in form; push badge with status | All scoped rows; creator/assignee predicates at row level; external ownership changes writes/push behavior | common `projectDetail.tasks.column.*`, status/priority values are current literal enums |
| 3 alternative | Board status columns/counts → task cards(name/assignee/status/push); timeline `ProjectGantt` with dated/undated/removed-phase context and task activation | Same eligible rows; keyboard status alternative preserved | common task/Gantt keys in source |
| 4 `ProjectIntegrationsCard` | Compact project task-integration setup, after work | Current connection/role gates | shared integration component keys |
| 5 on demand | Comments drawer; create/edit modal: task, assignee, status, priority, start/due, phase, parent, description, external push, dependencies; delete confirm | Same row predicates; form preserves dependency/parent semantics | common `projectDetail.tasks.form.*`, comments and push keys |

## Work orders — actual selected-panel order

| Order / source | Current block and contents | Audience / condition | Labels |
|---|---|---|---|
| 1 `WorkOrdersTab.tsx` | If rows exist: Contract drawdown then billing summary (still to invoice, invoiced, paid, conditional not-submitted; incomplete/error handling) | All drawdown; billing facts M | common `projectDetail.drawdown.*`, `workOrders.billing.*` |
| 2 same | Work orders heading + New work order → table loading/error/empty/rows | All read; create/edit/set value/transition M, draft/state restrictions retained | common `projectDetail.workOrders.*` |
| 2a table | WO number/title/client PO → order value/tax basis/optional final closing value → conditional Billing → Status → Order date → Actions. Draft Edit/Set value/Issue; Issued Close where no BAST closure; Invoice when eligible; Cancel draft/issued. `?wo=` selects/focuses the order | Invoice A/F + client/revenue readiness; issue author relation and consequence gates remain | same; projectTabs `contractQuantities.workOrders.*` |
| 3 same + `WorkOrderAcceptances.tsx` | Contract quantities → each WO disclosure: line/BAST counts; allocated lines and edit; BAST list with date/line quantities/document/final/draft-confirmed, prepare/edit/withdraw/confirm, allocation & BAST read errors | Quantity readers M; prepare A/X/F or own P on Issued; confirm A/F with existing server identity/operator decision; withdrawal preparer or A/F | projectTabs `contractQuantities.workOrders.*` |
| 4 on demand | New/edit WO, value editor, issue/close/cancel confirm, over-ceiling acknowledgment, Invoice WO modal/created invoice link, allocation editor, BAST preparation/confirmation/withdrawal, held down-payment after close remedy | Existing state/identity and feature gates | common workOrders and projectTabs contractQuantities; dialog-local keys |

Current rows arrive newest created_at (`src/lib/db/workOrders.ts`); target changes to labelled business order date. Do not treat finalized closing value as a rewrite of the issued PO.

## Billing — actual selected-panel order

| Order / source | Current block and contents | Audience / condition | Labels |
|---|---|---|---|
| 1 `BillingTab.tsx` | Billing summary/net-tax basis + `ProjectBillingStart`: direct invoice/WO/quantity method; summary loading/error or Contract, Billed, conditional Earned/Assessed/month, WIP, DP held, Remaining, not-submitted, no-assessment note | M read; invoice start A/F + ready route/client; assessment A/X/F or own P | common `projectDetail.billing.summary.*`, projectTabs `contractQuantities.billing.*` |
| 2 same | BoQ heading + Record progress when lines/permission + Add line; table/error/empty | M lines; create/edit/delete M; same assessment predicates | common `projectDetail.billing.boq.*`, `assessment.*` |
| 2a BoQ | Item/description → Contract quantity/lot → Rate → conditional Ordered/Not-yet-ordered/Accepted → Assessed → conditional Earned → Claimed → Left to claim → Edit/Delete; overordered/overmeasured/overclaimed indications | M; unknown quantities stay unknown until summary read | same + projectTabs `contractQuantities.billing.boq.*` |
| 3 same | Claims heading/Create claim; table Claim → Gross → DP recovery → Net → Invoice status → Evidence count → actions Attach evidence/Raise invoice/Withdraw; evidence-before-raise explanation | M read; A/F writes with client/ERP/allocation readiness | common `projectDetail.billing.claims.*` |
| 2+3 wrapper | Quantity billing disclosure only when BoQ AND claims have successfully loaded empty; otherwise both visible | Same | projectTabs `billing.quantity` |
| 4 on demand | BoQ line form; progress assessment; claim scope/quantity/DP recovery form; attach evidence selector; raise confirm with gross/recovery/net and different submitter; withdraw/delete confirms | Existing author/evidence/amount gates remain; no one-click money write | component-specific common/projectTabs labels |

Current claim/BoQ row arrays retain hook/DAL order; target explicitly labels transaction business-date ordering and stable contract-line ordering. The source's Start Billing method choice must remain reachable even when quantity billing is unused.

## Documents — actual selected-panel order

| Order / source | Current block and contents | Audience / condition | Labels |
|---|---|---|---|
| 1 `DocumentsTab.tsx` | Document register heading → Add document / Link from Microsoft 365 | All read; M create; Microsoft action also feature/reference permission | common `projectDetail.documents.*`, `m365Documents.*` |
| 2 shared RecordFolderAction | Choose/create/open project folder or connection notice | Current writer/connection gates; absent for ineligible readers | recordFolders namespace + shared component |
| 3 conditional | Microsoft picker; persistent own-author SoD notice + Dismiss after attempted decision | Writer/reference permission; same identity semantics | common m365Documents and documents.sod keys |
| 4 same | Search toolbar when rows exist → loading/error+Retry/first-use empty OR filtered DataTable/no-search-match | All scoped records | common `projectDetail.documents.search*`, `empty*`, `noSearchMatch` |
| 4a register | Title + revision lineage → Code → File reference/latest metadata → Category → Document date → Status; row activates drawer, row menu separate | All read; M author edit or A, delete A; transition M with author separation, revision-state checks | common `projectDetail.documents.column.*`, file/reference keys |
| 5 on demand | Drawer fields revision/code/category/date/lineage/file/status; edit/delete; issue/approve/reject/return/revise; form title/code/category/revision/date + file/reference; hidden named file input; revision modal; unlink/transition/delete confirms | Distinguish Microsoft file/folder/read-only/rejected/linked and local-file cases; preserve all existing permission predicates | common documents/m365Documents keys + recordFolders |

Current DAL order is code (nulls last), then created_at descending (`src/lib/db/documents.ts`). Target deliberately adopts newest document date with stable title/code tie-break and undated last. Real file dates, revisions, latest-check failure/retry, and localized dates remain behavior, not decoration.

## History — actual selected-panel order

| Order / source | Current block and contents | Audience / condition | Labels |
|---|---|---|---|
| 1 `src/components/history/RecordHistory.tsx` | Kind chips only when at least two kinds present or filter selected | All permitted project/child history rows | common `history.filterLabel` and kind labels |
| 2 same | Loading/error+Retry/filtered empty/general empty with history start boundary OR grouped changes/event rows with actor/time/change/record-link context | Same; includeChildren on this route | common `history.*`; enum label helper |
| 3 same | Older-page loading/Load older and pagination failure recovery | Same | same |

## Distillation ledger (/distill)

| Fact / feature | Target home on a selected page | Duplicate removed / secondary detail preserved |
|---|---|---|
| Project name/status/customer/PM/dates | Identity + scope | Customer/date repeats removed from trailing details; contract name, codes/classification/PO specifics remain there |
| Contract saved value and tax basis | Overview money group; Billing/WO local scoped basis where needed | Header strip removed; net ceiling remains a separately labelled concept, not silently substituted gross |
| Actual/source/as-of/coverage | One Cost group on Overview | Header/finance/snapshot Actual repeated headlines merged; category/setup/attribution breakdown remains accessible |
| Active budget, variance/utilization | Same Cost group | Snapshot headlines merged; category bars behind named breakdown; no fake zero with no Active version |
| WO issued/draft/headroom | Contract group on Overview; WO local section summary | Repeated ceiling is a reference to same fact, not another independent tile; per-order distinctions kept |
| Invoice/receipts/currency balances | Billing group on Overview; Billing's own scoped figure set | Equal amounts of differing net/gross/currency bases are not deduplicated into a false total; bucket breakdown survives |
| P&L period totals | Overview period section | Never equated with lifetime invoice margin; same current/prior form for every period |
| Phase/work attention | Overview first-screen signal + planner | No repeated generic phase band above every section; scoped task grouping remains |
| Procurement requests and ERP evidence | Procurement register + separate evidence/aging sections | Request value not renamed commitments; ERP evidence never added again to Actual |
| Metadata/setup | Trailing Project details or named local setup disclosure | No empty rail; no financial/details accordion pile before work; controls remain findable |

## Empty / first-run contract (/onboard)

Mixed experience assumed from PRODUCT's owner-operator and later team users; use contextual first actions, no tour or invented setup milestone. First success is a saved piece of real project work. An empty project must still identify itself and distinguish unknown money from known zero.

| Section | No data / first permitted action | No match / unavailable / failure |
|---|---|---|
| Overview | No delivery phases → Add phase A/P; otherwise readable handoff. No active budget → Budget link; no invoices → Billing link only for eligible readers | One grouped explanation for missing money scope/remedy, retry only failed reads; no “healthy” conclusion from unknown spending |
| Budget | No versions → New version M; active absent is explicit; no forecast without employed ERP+active budget | Selected empty year keeps fiscal-year selector and remedy; blocked-year rows retain their individual actionable reasons |
| Procurement | No PMO requests → New request all; ERP-only evidence can still appear | Search/filter no match → Clear; ERP failed read retains independent retry, not “no purchases” |
| Tasks | No tasks → New task all, phase context prefilled in group | Archived-only → Show archived; filter no match → Clear; preserve explicit List/Board/Timeline choice; integration failure doesn't erase work |
| Work orders | No orders → New work order M; E read-only explanation | Billing unavailable doesn't erase orders; empty lines → allocate if permitted; no BAST → prepare if eligible |
| Billing | No invoice → existing Create invoice method chooser A/F; unused quantity setup disclosed, Add line M | No assessment ≠ no earned work; failed allocations never create guessed scope; evidence missing → Attach evidence before raise |
| Documents | No documents → Add document M; reference/folder setup only when eligible | No search matches → Clear search; disconnected/denied/deleted/locked Microsoft item keeps reference context and useful reconnect/retry/handoff |
| History | No history → start-boundary explanation; no artificial create action | Filter empty → All kinds; failed fetch/load older → Retry with previous history preserved |

## Capture matrix

Baseline for **each** `overview`, `budget`, `procurement`, `tasks`, `work-orders`, `billing`, `documents`, `history`: populated synthetic delivery record, 1440×900 and 390×844, EN and ID, light and dark. Use P for delivery, F for money, M document writer; add E read-only captures only where permission/placement changes. This is the base screenshot set, not a claim all state combinations need every role. Capture each state below at both widths and paired languages/themes when it changes wrapping, contrast or figure form; shared shell-only states belong to shell acceptance.

| Owning route | Decision-relevant extra states / before-after pairs |
|---|---|
| `/projects/:id`, `/overview` | Empty project; pipeline advance/win capture; lost read-only; internal; populated E; contract edit/save/cancel/locked VAT/SoD refusal; missing/partial/foreign-currency/known-zero/attributed spending; data-error Retry distinct from absent project; expanded category/source/details; P&L month/quarter/year and chosen empty period; S-curve empty/populated |
| `/budget` | No versions; Draft + Active with selected-version change; year change/empty year; full versus incomplete forecast; cost-to-finish edit/error/save; activation blocked/permitted confirm; sources/evidence disclosure; no-ERP binding variant |
| `/procurement` | PMO-only/ERP-only/mixed; empty/no-match; read error; E own-request scope; New request → scoped form → return |
| `/tasks` | List/Board/Timeline before-after; undated/subtasks/removed-phase context; overdue/blocker anchor; empty; archived; own creator/assignee F/E; pending push; edit/dependencies/comments/error recovery |
| `/work-orders?wo=…` | Focused order; draft/issued/closed/cancelled; over-ceiling acknowledgment; incomplete billing/currency; invoice capture → result; allocations; BAST draft/confirm/final/closing-value/down-payment remedy |
| `/billing` | Direct/WO/quantity chooser; empty setup; lines/progress/claims with and without assessment/evidence; invoice raise confirm gross/recovery/net; withdrawn; incomplete summary/allocation retry; DP recovery |
| `/documents` | Empty/search no-match; drawer/revision lineage; create/edit/upload and error preservation; own-author decision reason; issue/approve/reject/return/revise/delete confirm; Microsoft off/disconnected/file/folder/unavailable/latest failure; folder action/reference picker/unlink |
| `/history` | One/multiple kinds; selected kind with no events → All; grouped child changes; load older/error; no history start boundary |
| Route compatibility / return | Direct base + unknown section; pre-win Work orders/Billing fallback; E Billing denied; section switch/reload; Projects and Sales narrowed source → record → return; task anchor and WO focus preserved |

Every capture records URL, role, state, locale, theme, viewport. Do not use real customer names, figures or personal data. Keep before/after pairs for navigation, controls and writes; owner reviews rendered composition. Not all errors require a duplicate screenshot on every section: use the local primitive once plus specific distinct failures above; no state loses its test coverage.

## Test disposition

Paths are exact; PD/T abbreviations expand as defined above. This docs task deletes nothing. On recomposition delete **assertions** pinning the old composition, not entire mixed suites; retain their behavior goals, adapting steps/selectors for intentional section-link navigation. Generic shared tab keyboard tests still own actual 2–3-view tab controls elsewhere.

| Existing file(s) | Delete on recompose | Keep / migrate to new section composition |
|---|---|---|
| `PD/__tests__/ProjectDetailHeader.test.tsx` | “finance stat strip is borderless”, “SoD row sits on canvas”, exact five-tile order, prescribed figure-slot/prose/tile placement | Contract/tax/FX precision, missing/partial/currency inputs, authority/SoD/VAT gates, save/refusal/confirm, known-zero and no duplicate amounts |
| `PD/__tests__/OverviewTab.test.tsx` | `T18: second row has lg:grid-cols-2`; drawdown-before-finance DOM comparison; fixed card titles/absence as layout ownership | Counts/request-value distinction, latest rows, budget/Actual basis, risk/variance, currency format, retry, navigable procurement/budget links, data access |
| `PD/__tests__/wave5-c3-pr2-position.test.tsx` | POS assertions requiring money above/below tablist or inside tabpanel, including element type | CW-7 role-invariant default; selected section reveals correct permitted data; accessible label semantics, contract edit restrictions |
| `PD/__tests__/wave5-c3-pr2.test.tsx` | Finance tile placement and aside tag; Sales link class styling; fixed four deal-tile composition | Identity/status, read-only contracts, contextual Sales return, transitions, lost semantics and complete stage names |
| `PD/__tests__/ProjectDetail.overviewEmpty.test.tsx` | Exact “one phases line + finances + comments” composition | Empty project remains usable, permitted first actions and comments reachable; retain unknown-vs-zero proof in owning money tests |
| `PD/__tests__/ProjectDetail.prewin.test.tsx`, `ProjectDetail.lens.test.tsx` | Journey-before-planner DOM order, classification closed-rail placement and compact empty-band rules | Pipeline actions/read-only/terminal, stage-specific curve eligibility, pre-win planning access and WO/Billing fallback, list-return context |
| `PD/__tests__/ProjectDetail.tabs.test.tsx` | P&L between exact siblings; tablist/tab/tabpanel selectors as fixed IA | Every route/default/unknown/role denial, P&L once and Overview-only eligibility, `?wo=` forwarding |
| `PD/__tests__/ProjectDetail.tabFocus.test.tsx` | Arrow/Home/End roving focus contract for the removed eight-tab widget | Replace with keyboard-operable named links/sheet, focus restoration, correct destination and no focus loss; keep shared Tabs tests for actual tabs |
| `PD/__tests__/MilestonePhaseHeader.test.tsx` | Same-row/right-column/muted-style/variant placement assertions | Effective percent, weights/rounding, target/overdue meaning, zero-weight correctness and phase vocabulary |
| `pmo-portal/e2e/AC-RD-HDR-001-project-header-geometry.spec.ts` | One-rail-summary/exact tile DOM assumptions | Amounts visibly readable, currency, no bleed/overflow; rebind oracles to consolidated figures |
| `pmo-portal/e2e/UIP-005-project-tab-work-fold.spec.ts` | KPI-top alignment, `>90%` panel width, literal two-disclosure/tile/phase positions | Immediate selected work, ≥44px targets, phase edit/cancel, blocker navigation, every section route, axe/theme/no overflow; update nav steps |
| `pmo-portal/e2e/AC-BWO-004-work-order-billing-geometry.spec.ts` | “beside record panel” topology and table-to-card threshold ownership | Invoice remains visible/reachable, amounts fit, no page overflow in EN/ID; bind to resulting row list/table |

Keep remaining behavior suites under `PD/__tests__/` (scoped directory reviewed): `ProjectDetail.test.tsx`, `.defaultTab`, `.history`, `.entityContext`, `.route-chunks`, `.analytics`, `.scurve-demote`; `ProjectDetailHeader.financeDemand`, `.dateTz`; `ProjectMoneyPosition.parity`, `ProjectFxEquivalent`; `OverviewTab.atrisk`, `.budgetUtil`; `ProjectDetailRail.shortName`, `.endCustomer`, `.classification`; all `PipelineLens.*`; all `TasksTab.*`, `ProjectGantt.*`, `MilestoneStrip.*`, `MilestoneFormModal.locale`; `WorkOrdersTab.*`, `WorkOrderForms`, `ContractQuantitiesTabs`, `ContractQuantityDialogs`, `BoqItemFormModal`, `ProgressAssessmentModal`, `ProgressClaimModal`, `ClaimEvidenceModal`, `InvoiceWorkOrderModal*`, `ProjectDrawdown`, `ProjectErpLink`, `ProjectProfitLossSection`, `BillingTab.start`. For mixed milestone/display/touch suites, remove only class/variant placement assertions; preserve hit area, names, progress, blocked/overdue and write oracles. Route-chunk lazy-load checks are performance behavior, not looks.

Also keep `PD/ProjectFinancesSection.test.tsx`, `AttributedSpendingNote.test.tsx`, `OtherCurrencyCommitments.test.tsx`, `ErpPurchasesSection.test.tsx`; `T/BudgetTab.test.tsx`, `DocumentsTab.test.tsx`, every `T/__tests__/DocumentsTab.*.test.tsx`, `BillingTab.test.tsx`, `OverviewTab.budgetBasis.test.tsx`, `OverviewTab.dateTz.test.tsx`; `pmo-portal/pages/ProjectBudget.test.tsx`, and `pmo-portal/pages/__tests__/ProjectBudget.*.test.tsx`. Keep role/date/money/empty/error oracles and change only deliberate new journey steps. No money test is deleted because its component moves.

Cross-stack keep: `pmo-portal/e2e/AC-LRC-003-projects-return.spec.ts`, `AC-CHG-019-project-change-history.spec.ts`, `AC-S15-004-project-billing-context.spec.ts`, `AC-PFIN-016-project-finances.spec.ts`, `AC-1011-win-project.spec.ts`, `AC-NAR-003-no-erp-billing.spec.ts`, `AC-PRJ-001-projects-crud.spec.ts`, `m365-project-reference-ui.spec.ts`; `pmo-portal/e2e/serial/AC-SETUP-001-project-erp-link.spec.ts`, `AC-TAG-002-project-classification.spec.ts`, `AC-PB-003-progress-billing-erp.spec.ts`, `AC-BWO-003-invoice-work-order-erp.spec.ts`, `AC-732-budget-activate.spec.ts`, `AC-BUD-030-budget-activate-push.spec.ts`, `AC-BFY-031-existing-budget-rekey-no-duplicate.spec.ts`. Preserve existing goal-oracles, read e2e conventions before edits, run touched journeys through repo wrappers. Full CI remains the code merge gate.

## Tool evidence and limits

Applied [impeccable-map](../impeccable-map.md): `/shape` discovery above; `/critique` independent source assessment and detector; `/layout` reading order/grouping/density and phone reflow; `/distill` ownership ledger; `/onboard` contextual first-use table. Critique: source supports a hierarchy problem (several monetary modules separated by unrelated content), a recognition burden (eight-job tab strip) and repeated equal `gap-8` grouping. PM must reconcile multiple blocks to judge position; Finance must distinguish lifetime versus period and net versus gross. The target brings evidence together without conflating those facts. No rendered usability score claimed.

Impeccable commands run on `pmo-portal/pages/project-detail`: `detect --json` and `detect --json --scope layout`; both output `[]`: **0 findings**. Independent source assessments A/B were completed before synthesis. No browser, overlay or temporary server was used for this docs-only source brief; rendered checks are explicitly deferred to builder acceptance. No automated source scan proves whitespace quality or phone first-screen fit.

Skill recovery: `scripts/vendor-skills.sh` ran but stopped at upstream's moved Taste v1 folder. Generated ignored skills were recovered from the declared upstreams: Taste's available `skills/taste-skill` (v2, including app-screen guidance) and UI UX Pro Max's `.claude/skills/ui-ux-pro-max`. No vendor script or tracked skill override changed. Apply requested Taste hierarchy/repetition/truncated-identity/anti-slop lenses: one leading answer, consistent row alignment, complete readable names, money as aligned text without ornamental icon tiles; no new palette/type/radii. Taste's marketing conventions do not override the app's tokens or UX standard.

UI UX Pro Max `search.py` queries (`--domain ux`) ran for record page, tabs navigation, detail header, summary cards and progressive disclosure. Relevant hits: Active State and Keyboard Navigation; narrower retries navigation hierarchy, heading hierarchy and data table density supplied Breadcrumbs, Heading Hierarchy and Table Handling. Detail-header match was absent initially; heading-hierarchy retry supplies general heading guidance only. Summary-cards and progressive-disclosure results were unrelated (error summary/heading wrapping); density retry supports table handling, disclosure-complexity retry remained unrelated. No verified database match for progressive disclosure or a bespoke summary-card/detail-header pattern: those decisions use PRODUCT, UX-STANDARD and Impeccable/Taste, not invented search evidence. Optional palette recommendations were not adopted.

Taste static `lint.mjs PD --app --json` also ran: 45 source findings (35 FAIL, 10 WARN), including test fixture matches and JSX comments. These are advisory lexical matches, not rendered failures: emoji flags occur in source comments; the gradient match is the S-curve dashed-line legend background (`ProjectSCurve.tsx:171`), not an ornamental chart fill; preserve the planned/actual distinction with existing tokens. The applicable shadow/identity/numbering warnings feed rendered review, with repository code/identifier conventions retained. No claim of a passing Taste browser inspector is made.

## EN/ID label ledger

Literal heading, section, scope, metric and column keys extracted from the inspected production components (no runtime record content). Unprefixed keys use `common`; `namespace:key` uses that JSON file. Exact files are `pmo-portal/public/locales/en/<namespace>.json` and `id/<namespace>.json`; `src/lib/i18n/index.ts` selects catalogues and English source fallback. Status/task enums and imported shared controls are identified separately in the inventory; do not assume a literal English enum has a catalogue key. New section-group labels need EN/ID additions at build time (Delivery / Pelaksanaan; Money / Keuangan; Evidence / Bukti; Project sections / Bagian proyek); existing section labels below remain.

| Key | EN | ID | Call-site file |
|---|---|---|---|
| `erpPurchases.aging.title` | Unpaid by age (English call-site fallback) | Unpaid by age (English call-site fallback) | `PD/ErpPurchasesSection.tsx` |
| `history.empty.title` | No changes recorded yet | Belum ada perubahan tercatat | `pmo-portal/src/components/history/RecordHistory.tsx` |
| `history.filterLabel` | Filter by record kind | Saring menurut jenis catatan | `pmo-portal/src/components/history/RecordHistory.tsx` |
| `projectDetail.billing.assessment.title` | Record progress | Catat progres | `PD/ProgressAssessmentModal.tsx` |
| `projectDetail.billing.boq.column.actions` | Actions | Aksi | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.boq.column.assessed` | Assessed | Dinilai | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.boq.column.claimed` | Claimed | Ditagih | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.boq.column.item` | Item | Item | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.boq.column.quantity` | Contract | Kontrak | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.boq.column.rate` | Rate | Harga satuan | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.boq.column.remaining` | Left to claim | Sisa untuk ditagih | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.boq.confirmDelete.title` | Delete this line? | Hapus baris ini? | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.boq.title` | Bill of quantities | Bill of quantities | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.boqForm.titleEdit` | Edit bill of quantities line | Ubah baris bill of quantities | `PD/BoqItemFormModal.tsx` |
| `projectDetail.billing.boqForm.titleNew` | Add a bill of quantities line | Tambah baris bill of quantities | `PD/BoqItemFormModal.tsx` |
| `projectDetail.billing.claimForm.title` | New billing claim | Tagihan baru | `PD/ProgressClaimModal.tsx` |
| `projectDetail.billing.claims.column.actions` | Actions | Aksi | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.claims.column.claim` | Claim | Tagihan | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.claims.column.evidence` | Evidence | Bukti | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.claims.column.gross` | Claimed | Ditagih | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.claims.column.invoice` | Invoice | Faktur | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.claims.column.net` | Net | Neto | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.claims.column.recovery` | Down payment recovered | Uang muka dipulihkan | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.claims.confirmRaise.title` | Raise this claim's invoice? | Terbitkan faktur tagihan ini? | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.claims.confirmWithdraw.title` | Withdraw this claim? | Tarik tagihan ini? | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.claims.title` | Billing claims | Tagihan | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.evidence.title` | Attach billing evidence | Lampirkan bukti penagihan | `PD/ClaimEvidenceModal.tsx` |
| `projectDetail.billing.summary.assessed` | Assessed to date | Dinilai s.d. saat ini | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.summary.assessedAsOf` | as of {{month}}, {{pct}}% complete | per {{month}}, {{pct}}% selesai | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.summary.billed` | Billed to date | Ditagih s.d. saat ini | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.summary.contract` | Contract value | Nilai kontrak | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.summary.dpHeld` | Down payment held | Uang muka tertahan | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.summary.error` | Couldn't load billing | Data penagihan tidak dapat dimuat | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.summary.exclTax` | excl. PPN | belum termasuk PPN | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.summary.gap` | Work done, not yet billed | Pekerjaan selesai, belum ditagih | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.summary.notSubmitted` | Claims raised, not yet submitted | Klaim diterbitkan, belum dikirim | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.summary.remaining` | Contract not yet billed | Kontrak belum ditagih | `PD/tabs/BillingTab.tsx` |
| `projectDetail.billing.summary.title` | Billing summary | Ringkasan penagihan | `PD/tabs/BillingTab.tsx` |
| `projectDetail.documents.addDocument` | Add document | Tambah dokumen | `PD/tabs/DocumentsTab.tsx` |
| `projectDetail.documents.column.category` | Category | Kategori | `PD/tabs/DocumentsTab.tsx` |
| `projectDetail.documents.column.code` | Code | Kode | `PD/tabs/DocumentsTab.tsx` |
| `projectDetail.documents.column.date` | Date | Tanggal | `PD/tabs/DocumentsTab.tsx` |
| `projectDetail.documents.column.document` | Document | Dokumen | `PD/tabs/DocumentsTab.tsx` |
| `projectDetail.documents.column.file` | File | File | `PD/tabs/DocumentsTab.tsx` |
| `projectDetail.documents.column.status` | Status | Status | `PD/tabs/DocumentsTab.tsx` |
| `projectDetail.documents.deleteConfirm.titleFallback` | Delete document? | Hapus dokumen ini? | `PD/tabs/DocumentsTab.tsx` |
| `projectDetail.documents.form.errors.titleRequired` | Title is required. | Judul wajib diisi. | `PD/tabs/DocumentsTab.tsx` |
| `projectDetail.documents.form.title` | Title | Judul | `PD/tabs/DocumentsTab.tsx` |
| `projectDetail.documents.form.titlePlaceholder` | e.g. Foundation general arrangement | mis. Foundation general arrangement | `PD/tabs/DocumentsTab.tsx` |
| `projectDetail.documents.heading` | Document register | Register dokumen | `PD/tabs/DocumentsTab.tsx` |
| `projectDetail.documents.transitionConfirm.titleFallback` | Update status? | Perbarui status? | `PD/tabs/DocumentsTab.tsx` |
| `projectDetail.drawdown.error.title` | Couldn't load the drawdown | Gagal memuat penyerapan | `PD/ProjectDrawdown.tsx` |
| `projectDetail.drawdown.title` | Contract drawdown | Penyerapan kontrak | `PD/ProjectDrawdown.tsx` |
| `projectDetail.gantt.summary.connectors` | one: {{count}} dependency connector drawn; other: {{count}} dependency connectors drawn | one: {{count}} konektor dependensi digambar; other: {{count}} konektor dependensi digambar | `PD/ProjectGantt.tsx` |
| `projectDetail.gantt.summary.head` | Task Gantt timeline: {{tasks}} across {{phases}} | Timeline Gantt task: {{tasks}} pada {{phases}} | `PD/ProjectGantt.tsx` |
| `projectDetail.gantt.summary.hidden` | one: {{count}} dependency hidden (endpoint undated); other: {{count}} dependencies hidden (endpoint undated) | one: {{count}} dependensi disembunyikan (titik ujung tanpa tanggal); other: {{count}} dependensi disembunyikan (titik ujung tanpa tanggal) | `PD/ProjectGantt.tsx` |
| `projectDetail.gantt.summary.milestones` | one: {{count}} phase; other: {{count}} phases | one: {{count}} fase; other: {{count}} fase | `PD/ProjectGantt.tsx` |
| `projectDetail.gantt.summary.scale` | scale: {{scale}} | skala: {{scale}} | `PD/ProjectGantt.tsx` |
| `projectDetail.gantt.summary.tasks` | one: {{count}} task; other: {{count}} tasks | one: {{count}} task; other: {{count}} task | `PD/ProjectGantt.tsx` |
| `projectDetail.gantt.summary.today` | today at {{pct}}% of the span | hari ini di {{pct}}% dari rentang | `PD/ProjectGantt.tsx` |
| `projectDetail.header.archiveConfirm.title` | Archive {{name}}? | Arsipkan {{name}}? | `PD/ProjectDetailHeader.tsx` |
| `projectDetail.header.contractValueConfirm.title` | Change the contract value? | Ubah nilai kontrak? | `PD/ProjectDetailHeader.tsx` |
| `projectDetail.header.deleteConfirm.title` | Delete {{name}}? | Hapus {{name}}? | `PD/ProjectDetailHeader.tsx` |
| `projectDetail.header.tile.actual` | Actual | Realisasi | `PD/ProjectDetailHeader.tsx` |
| `projectDetail.header.tile.contract` | Contract | Kontrak | `PD/ProjectDetailHeader.tsx` |
| `projectDetail.header.tile.spend` | Spend | Pengeluaran | `PD/ProjectDetailHeader.tsx` |
| `projectDetail.loadError.title` | Couldn't load this project | Gagal memuat proyek ini | `PD/ProjectDetail.tsx` |
| `projectDetail.milestones.deleteConfirm.title` | Delete "{{name}}"? | Hapus "{{name}}"? | `PD/MilestoneStrip.tsx` |
| `projectDetail.milestones.deleteConfirm.titleFallback` | Delete phase? | Hapus fase ini? | `PD/MilestoneStrip.tsx` |
| `projectDetail.milestones.heading` | Delivery phases | Fase pelaksanaan | `PD/MilestoneStrip.tsx` |
| `projectDetail.notFound.title` | Project not found | Proyek tidak ditemukan | `PD/ProjectDetail.tsx` |
| `projectDetail.overview.budgetSnapshot.title` | Budget snapshot | Ringkasan anggaran | `PD/tabs/OverviewTab.tsx` |
| `projectDetail.overview.finance.title` | Financial summary | Ringkasan keuangan | `PD/ProjectDetailHeader.tsx`, `PD/tabs/OverviewTab.tsx` |
| `projectDetail.overview.procSummary.title` | Procurement summary | Ringkasan pengadaan | `PD/tabs/OverviewTab.tsx` |
| `projectDetail.pipeline.declinedConfirm.title` | Decline to bid | Tidak ikut tender | `PD/PipelineLens.tsx` |
| `projectDetail.pipeline.lostConfirm.title` | Mark project as lost | Tandai proyek kalah | `PD/PipelineLens.tsx` |
| `projectDetail.pipeline.stat.decision` | Decision | Keputusan | `PD/PipelineLens.tsx` |
| `projectDetail.pipeline.stat.owner` | Owner | Pemilik | `PD/PipelineLens.tsx` |
| `projectDetail.pipeline.stat.value` | Value | Nilai | `PD/PipelineLens.tsx` |
| `projectDetail.pipeline.stat.weighted` | Weighted | Tertimbang | `PD/PipelineLens.tsx` |
| `projectDetail.pipeline.stat.winProbability` | Win probability | Peluang menang | `PD/PipelineLens.tsx` |
| `projectDetail.procurement.column.request` | Request | Permintaan | `PD/tabs/ProcurementTab.tsx` |
| `projectDetail.procurement.column.status` | Status | Status | `PD/tabs/ProcurementTab.tsx` |
| `projectDetail.procurement.column.value` | Value | Nilai | `PD/tabs/ProcurementTab.tsx` |
| `projectDetail.procurement.empty.title` | No purchase requests for this project yet | Belum ada permintaan pembelian untuk proyek ini | `PD/tabs/ProcurementTab.tsx` |
| `projectDetail.procurement.error.title` | Couldn't load procurement | Gagal memuat pengadaan | `PD/tabs/ProcurementTab.tsx` |
| `projectDetail.procurement.newRequest` | New request | Permintaan baru | `PD/tabs/ProcurementTab.tsx` |
| `projectDetail.procurement.title` | Purchase Requests | Permintaan pembelian | `PD/tabs/ProcurementTab.tsx` |
| `projectDetail.rail.actionsAriaLabel` | Project rail actions | Tindakan panel proyek | `PD/ProjectDetailRail.tsx` |
| `projectDetail.rail.ariaLabel` | Project details rail | Panel detail proyek | `PD/ProjectDetailRail.tsx` |
| `projectDetail.rail.clientCode` | Client Project Code | Kode Proyek Klien | `PD/ProjectDetailRail.tsx` |
| `projectDetail.rail.customer` | Customer | Klien | `PD/ProjectDetailRail.tsx` |
| `projectDetail.rail.customerPoRef` | Customer PO ref | Ref PO klien | `PD/ProjectDetailRail.tsx` |
| `projectDetail.rail.detailsHeading` | Details | Detail | `PD/ProjectDetailRail.tsx` |
| `projectDetail.rail.endCustomer` | End customer | Pelanggan akhir | `PD/ProjectDetailRail.tsx` |
| `projectDetail.rail.notSet` | Not set | Belum diisi | `PD/ProjectDetailRail.tsx` |
| `projectDetail.rail.pmoNumber` | PMO Project Number | Nomor Proyek PMO | `PD/ProjectDetailRail.tsx` |
| `projectDetail.rail.projectManager` | Project manager | Manajer proyek | `PD/ProjectDetailRail.tsx` |
| `projectDetail.rail.recordHeading` | Record | Data | `PD/ProjectDetailRail.tsx` |
| `projectDetail.rail.start` | Start | Mulai | `PD/ProjectDetailRail.tsx` |
| `projectDetail.rail.targetEnd` | Target end | Target selesai | `PD/ProjectDetailRail.tsx` |
| `projectDetail.rail.unassigned` | Unassigned | Belum ditugaskan | `PD/ProjectDetailRail.tsx` |
| `projectDetail.scurve.heading` | Progress curve | Kurva progres | `PD/ProjectSCurve.tsx` |
| `projectDetail.tabs.ariaLabel` | Project sections | Bagian proyek | `PD/ProjectDetail.tsx` |
| `projectDetail.tabs.billing` | Billing | Penagihan | `PD/ProjectDetail.tsx` |
| `projectDetail.tabs.budget` | Budget | Anggaran | `PD/ProjectDetail.tsx` |
| `projectDetail.tabs.documents` | Documents | Dokumen | `PD/ProjectDetail.tsx` |
| `projectDetail.tabs.history` | History | Riwayat | `PD/ProjectDetail.tsx` |
| `projectDetail.tabs.overview` | Overview | Ringkasan | `PD/ProjectDetail.tsx` |
| `projectDetail.tabs.procurement` | Procurement | Pengadaan | `PD/ProjectDetail.tsx` |
| `projectDetail.tabs.tasks` | Tasks | Tugas | `PD/ProjectDetail.tsx` |
| `projectDetail.tabs.workOrders` | Work orders | Work Order | `PD/ProjectDetail.tsx` |
| `projectDetail.tasks.column.assignee` | Assignee | PIC | `PD/tabs/TasksTab.tsx` |
| `projectDetail.tasks.column.due` | Due | Tenggat | `PD/tabs/TasksTab.tsx` |
| `projectDetail.tasks.column.status` | Status | Status | `PD/tabs/TasksTab.tsx` |
| `projectDetail.tasks.column.task` | Task | Tugas | `PD/tabs/TasksTab.tsx` |
| `projectDetail.tasks.deleteConfirm.titleFallback` | Delete task? | Hapus tugas ini? | `PD/tabs/TasksTab.tsx` |
| `projectDetail.tasks.heading` | Tasks | Tugas | `PD/tabs/TasksTab.tsx` |
| `projectDetail.tasks.newTask` | New task | Tugas baru | `PD/tabs/TasksTab.tsx` |
| `projectDetail.workOrderForm.errors.titleRequired` | A title is required | Judul wajib diisi | `PD/WorkOrderFormModal.tsx` |
| `projectDetail.workOrderForm.title` | Title | Judul | `PD/WorkOrderFormModal.tsx` |
| `projectDetail.workOrderForm.titlePlaceholder` | e.g. Phase 1 fabrication | mis. Fabrikasi Fase 1 | `PD/WorkOrderFormModal.tsx` |
| `projectDetail.workOrderValue.title` | Set the work order value | Tetapkan nilai Work Order | `PD/WorkOrderValueModal.tsx` |
| `projectDetail.workOrders.billing.modal.title` | Invoice this work order | Tagih Work Order ini | `PD/InvoiceWorkOrderModal.tsx` |
| `projectDetail.workOrders.column.actions` | Actions | Tindakan | `PD/tabs/WorkOrdersTab.tsx` |
| `projectDetail.workOrders.column.number` | WO number | Nomor WO | `PD/tabs/WorkOrdersTab.tsx` |
| `projectDetail.workOrders.column.orderDate` | Order date | Tanggal order | `PD/tabs/WorkOrdersTab.tsx` |
| `projectDetail.workOrders.column.status` | Status | Status | `PD/tabs/WorkOrdersTab.tsx` |
| `projectDetail.workOrders.column.value` | Order value | Nilai order | `PD/tabs/WorkOrdersTab.tsx` |
| `projectDetail.workOrders.confirm.cancel.title` | Cancel this work order? | Batalkan Work Order ini? | `PD/tabs/WorkOrdersTab.tsx` |
| `projectDetail.workOrders.confirm.close.title` | Close this work order? | Tutup Work Order ini? | `PD/tabs/WorkOrdersTab.tsx` |
| `projectDetail.workOrders.confirm.issue.title` | Issue this work order? | Terbitkan Work Order ini? | `PD/tabs/WorkOrdersTab.tsx` |
| `projectDetail.workOrders.confirm.overCommit.title` | This would go past the contract ceiling | Ini akan melewati pagu kontrak | `PD/tabs/WorkOrdersTab.tsx` |
| `projectDetail.workOrders.empty.title` | No work orders on this project yet | Belum ada Work Order pada proyek ini | `PD/tabs/WorkOrdersTab.tsx` |
| `projectDetail.workOrders.error.title` | Couldn’t load the work orders | Gagal memuat Work Order | `PD/tabs/WorkOrdersTab.tsx` |
| `projectDetail.workOrders.title` | Work orders | Work Order | `PD/tabs/WorkOrdersTab.tsx` |
| `projectFinances.title` | Project finances | Keuangan proyek | `PD/ProjectFinancesSection.tsx` |
| `projectTabs:contractQuantities.billing.boq.column.accepted` | Accepted (BAST) | Diterima (BAST) | `PD/tabs/BillingTab.tsx` |
| `projectTabs:contractQuantities.billing.boq.column.balance` | Not yet ordered | Belum dipesan | `PD/tabs/BillingTab.tsx` |
| `projectTabs:contractQuantities.billing.boq.column.earned` | Earned | Diperoleh | `PD/tabs/BillingTab.tsx` |
| `projectTabs:contractQuantities.billing.boq.column.ordered` | Ordered | Dipesan | `PD/tabs/BillingTab.tsx` |
| `projectTabs:contractQuantities.billing.summary.earned` | Earned to date | Diperoleh s.d. saat ini | `PD/tabs/BillingTab.tsx` |
| `projectTabs:contractQuantities.billing.summary.noAssessment` | No assessment yet | Belum ada penilaian | `PD/tabs/BillingTab.tsx` |
| `projectTabs:contractQuantities.workOrders.acceptances.confirmFinal.title` | Confirm the final BAST? | Konfirmasi BAST final? | `PD/tabs/WorkOrdersTab.tsx` |
| `projectTabs:contractQuantities.workOrders.acceptances.confirmStage.title` | Confirm this BAST? | Konfirmasi BAST ini? | `PD/tabs/WorkOrdersTab.tsx` |
| `projectTabs:contractQuantities.workOrders.acceptances.confirmWithdraw.title` | Withdraw this BAST draft? | Tarik draft BAST ini? | `PD/tabs/WorkOrdersTab.tsx` |
| `projectTabs:contractQuantities.workOrders.acceptances.form.titleEdit` | Edit BAST — {{wo}} | Ubah BAST — {{wo}} | `PD/WorkOrderAcceptanceModal.tsx` |
| `projectTabs:contractQuantities.workOrders.acceptances.form.titleNew` | Prepare BAST — {{wo}} | Siapkan BAST — {{wo}} | `PD/WorkOrderAcceptanceModal.tsx` |
| `projectTabs:contractQuantities.workOrders.acceptances.heading` | Acceptances (BAST) | Penerimaan (BAST) | `PD/tabs/WorkOrdersTab.tsx` |
| `projectTabs:contractQuantities.workOrders.contractLines.confirmRemove.title` | Remove this allocation? | Hapus alokasi ini? | `PD/WorkOrderLinesModal.tsx` |
| `projectTabs:contractQuantities.workOrders.contractLines.heading` | Contract lines | Baris kontrak | `PD/tabs/WorkOrdersTab.tsx` |
| `projectTabs:contractQuantities.workOrders.contractLines.title` | Contract lines — {{wo}} | Baris kontrak — {{wo}} | `PD/WorkOrderLinesModal.tsx` |
| `projectTabs:contractQuantities.workOrders.quantities.title` | Contract quantities | Kuantitas kontrak | `PD/tabs/WorkOrdersTab.tsx` |
| `uxs04.forecast` | Forecast | Perkiraan | `pmo-portal/pages/BudgetProjection.tsx` |
| `uxs04.sourcesAndStatus` | Sources and budget enforcement | Sumber dan penegakan anggaran | `pmo-portal/pages/BudgetProjection.tsx` |
| `uxs13.projectDetailsAndActions` | Project details and actions | Detail dan tindakan proyek | `PD/ProjectDetailRail.tsx` |
