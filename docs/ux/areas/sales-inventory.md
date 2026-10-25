# Sales pipeline inventory and builder evidence — #806

Source baseline: `d18ba06b`; read on 2026-10-25. This is a static source audit and a builder proposal, not a rendered pass. Synthetic descriptions only; no business records, personal identities or amounts are reproduced. The main brief is [sales.md](sales.md).

## PA-00 route jobs

Expectations below are the composition decisions inferred from PRODUCT.md and current affordances. A read job is valid; a hidden action does not make a permitted collection redundant. Engineer's recovery job does not justify exposing Sales data.

| Route | Persona | Arriving here I expect to see… | The job I finish here is… | Decision |
|---|---|---|---|---|
| `/sales` | Admin | Open opportunities, their owners, stages and activity | Find a stalled deal, open its evidence or start a project | KEEP collection |
| `/sales` | Executive | Stage position, credible forecast and unattended opportunities | Choose the opportunity needing intervention and open it | KEEP; forecast disclosed |
| `/sales` | Finance | Project/customer, currency, value/basis and stage | Identify a deal and inspect its commercial evidence without changing its lifecycle | KEEP permitted review |
| `/sales` | PM | My relevant opportunities and what is stale | Find a deal, open its project and progress it with evidence | KEEP; no invented “my deals” filter |
| `/sales` | Engineer | A clear explanation and route to my own work | Return to my dashboard | KEEP denied recovery only; no Sales nav |
| `/sales/:opportunityId` | Admin | The same project identity as any other link | Reach the canonical project and continue work | MERGED into `/projects/:id`; retain redirect |
| `/sales/:opportunityId` | Executive | The linked opportunity's evidence and current outcome | Decide the next legal step in its canonical record | MERGED; retain redirect |
| `/sales/:opportunityId` | Finance | The linked project's commercial context | Review it using existing project permissions | MERGED; no new lifecycle writes |
| `/sales/:opportunityId` | PM | My linked project, its stage and next action | Advance or record the win in one record | MERGED; retain redirect |
| `/sales/:opportunityId` | Engineer | The canonical project, if permitted, or clear recovery | Reach permitted project work or return safely | MERGED; destination decides access |

The compatibility route does not itself authorize, fetch or render a Sales record. Do not assume the collection's denied state determines project-record visibility. Project-detail owns destination access/missing/error states.

## Current inventory — `/sales`, render order

Evidence: `pmo-portal/pages/SalesPipeline.tsx`, `src/components/ui/ListPage.tsx`, `components/SalesKanbanBoard.tsx`, `components/ProjectCardShell.tsx`, `components/ProjectClassificationFilters.tsx`, `src/components/ui/Funnel.tsx`. Paths in this inventory are relative to the repository root unless explicitly shortened.

A/E/F/P = Admin/Executive/Finance/Project Manager. Page view gate uses `may('transition','project')`; creation uses `may('create','project')`. Read this as current UI behavior, not a change to enforcement. Label abbreviations: **common** = `pmo-portal/public/locales/{en,id}/common.json`; **sales** = the corresponding `sales.json`; **status hook** = `pmo-portal/src/hooks/useProjectStatusLabel.ts`; **literal** = English in source without a translation key. Actual label pairs appear below.

| Order / block | Fact carried or action | Who / condition | EN/ID label source |
|---|---|---|---|
| 0. Denied branch | AccessDenied title, explanation, back to `/` instead of ListPage | Engineer/direct URL; denied branch replaces all following blocks | common `sales.accessDenied.*`; shared AccessDenied back label |
| 1. ListPage title row | h1 Sales Pipeline; no description/count supplied | A/E/F/P | common `shell.nav.sales` |
| 1a. New project | Opens `/projects/new`, capturing list-return context | A/E/P only, including loading/empty/error | common `sales.newProject` |
| 2. Desktop banner skeleton | Two loading rows | Desktop + pending pipeline | shared ListState |
| 2a. Desktop five-stage Funnel | Leads → Pre-Qual → Quotation → Tender → Negotiation; stage probability when supplied, gross and weighted amounts, comparative bar; click/Enter/Space toggles URL stage | Desktop + loaded, nonempty collection | status hook `sales.stage.*`; common `sales.funnel.weighted`; Funnel accessible region key |
| 2b. Weighted forecast line | Sum of five open-stage weighted values; one-currency denomination; mixed currency gives em dash plus explanation | Same banner condition | common `sales.weightedForecast`; sales `pipeline.mixedCurrency` |
| 3. Desktop toolbar: scope | Open / Lost / Needs attention; Lost label splits lost/declined counts when needed | Table only, not pipeline loading | common `sales.scope.*`, `sales.lostCounts`, `sales.scopeToggleLabel` |
| 3a. Search | Name, short name, PMO number, client code, customer/end customer and legal names; URL-backed debounced query | Both desktop views, not pipeline loading | common `sales.search.*` |
| 3b. Classification disclosure | Service line, sector, award type, bidding entity, location; selected chips/remove/clear; location debounce | Rows have a classification OR active filter; not pipeline loading | common `projectClassification.*`; row classification values remain data |
| 3c. Export | Live XLSX of `filtered` table set, even when board's displayed set differs; no on-screen currency column | Desktop, A/E/F/P, not pipeline loading | shared ExportButton common keys; entity literal `Pipeline`; export-only `Currency` literal |
| 3d. Board/Table | Changes URL view and session preference | Desktop, not pipeline loading | common `sales.view.*`, `sales.viewToggleLabel` |
| 3-phone. Stage selector | All stages + five open stages; stage change sets Open | Phone board presentation, scope not Lost, not loading | common `uxs24.stageLabel/allStages`; status hook |
| 3-phone-a. Scope | Open / Lost / Needs attention; Lost clears stage and uses URL table scope while presentation remains list | Phone, not loading | common `sales.scope.*`, `sales.lostCounts` |
| 3-phone-b. Search | Same query fields as desktop | Phone, not loading | common `sales.search.*` |
| 3-phone-c. Classification | Same five fields, collapsed initially, in-flow expansion, applied chips/clear | Phone, same availability rule | common `projectClassification.*` |
| 4. Loading body | Six-row ListState inside bordered container | Pipeline pending; replaces content below | shared ListState loading |
| 4a. Error body | Fetch failure with Retry calling pipeline refetch | Pipeline error or absent data | common `sales.error.*`; shared retry |
| 4b. True collection empty | No projects yet / Add a project…; no body action supplied | Loaded with neither open nor lost rows | common `sales.empty.*` |
| 4c. Board no matches | Search or classification no-match explanation + Clear filters | Desktop board, nonempty collection, zero `kanbanFiltered` | common `sales.boardEmpty.classification.*`, `sales.tableEmpty.search.*`, `sales.tableEmpty.clearFilters` |
| 4d. Board | Seven declared columns; open ∪ lost input; search/classification narrow rows; selected funnel stage scrolls/marks column rather than filtering rows | Desktop board, loaded/nonempty matches | See board inventory below |
| 4e. Phone list or list state | Lost-fetch Retry for Lost/attention; otherwise scope-empty/stage-empty + optional Clear filters, or compact cards | Phone only; effective view always kanban/list, including stored table URL | common `sales.lostError.*`, `sales.tableEmpty.*`, `uxs24.stageEmpty*` |
| 4f. Table | Lost-fetch Retry for Lost/attention, otherwise DataTable rows/empty state | Desktop table, loaded | See table inventory below |

`ListPage` renders header → banner → toolbar → children. Its current desktop order is scope → search → classification → export → view; primary creation is in header, not toolbar. It does not supply sort. Sales table columns have no `sortKey` and the page supplies no `sort/onSort`. `useLostDeals` explicitly sorts descending `last_update`; Sales page does not sort the RPC's open array. No claim is made here about the database's implicit order.

Working-set code: `src/lib/listWorkingSet.ts`, `src/hooks/useListWorkingSet.ts`, `src/hooks/useListReturn.ts`, `src/hooks/usePipelineView.ts`, `components/salesPipeline.ts`. URL holds scope/status/q/view and classifications; no Sales sort field currently exists. Non-Open scopes normalize to table view. `Needs attention` is last update ≥30 days across open ∪ lost; missing activity does not falsely qualify as stale. No due-date or customer-contact event is available in this page projection.

### Board, cards and phone list

| Order | Current fact/action | Who / condition | EN/ID source |
|---|---|---|---|
| 1 | Stage navigation indicator before Kanban; its own responsive visibility and active-scroll tracking | Board component; page uses separate compact presentation on phone | status hook `sales.stage.*`; shared KanbanStageIndicator |
| 2 | Leads, Pre-Qual, Quotation, Tender, Negotiation, Won, Lost columns, fixed order; stage label/dot/count | All desktop board viewers | `components/salesPipeline.ts` declares seven; status hook; Won uses common `projects.kanban.won` |
| 2a | Empty-column sentence | A column has no rows; Won receives no on-hand rows from this page's input | common `projects.kanban.empty` |
| 2b | Lost and Declined counts as additional line | Lost group contains Declined rows | common `sales.lostCounts` |
| 3. Card head | Initial avatar → display/contractual title → status pill → customer; IDs explicitly passed null | Each board row; whole card is keyboard-activatable, no drag/write action | Row data; status hook `projects.status.*`; shared ProjectCardShell |
| 3a. Card body | Exact contract value in row currency → tax basis → win probability badge; no weighted figure, owner or activity on current card | Each board row, including lost rows whose projected probability is zero | `formatCurrency`, TaxBasisLabel keys and numeric probability |
| 4. Compact phone row | Initial → openable full identity → customer → status unless selected stage already names it → exact value/basis and win probability | Phone `presentation=list`; one vertical list, no export/view switcher | common `uxs24.phoneList`; shared shell/status/basis sources |

Funnel mechanics: five equal-distribution grid tracks with intrinsic amount minima in a local horizontal scroller; named stages, value, optional weighted/probability, optional bar. Interactive stages expose `aria-pressed`, keyboard activation and focus scrolling. It is a stage-value band, not a measurement of historical conversion/drop-off. Suppressed mixed-currency bars and dash explanations are current behavior; the target must keep stable figure slots and one visible scoped caveat.

### Table and export

Current columns in order: **Project** (short-first title; contractual title; identifiers on secondary mono line) → **Customer** (end customer as “for …” second line) → **Stage** (board stage names, Declined distinct) → **Value** (row currency + tax basis) → **Weighted** (value × probability) → **Win %** (progress bar + text) → **Owner** (initial/name or unavailable) → **Last touch** (relative days; ≥30-day warning text). Row activation opens canonical project. Column widths can be resized/persisted through shared DataTable; there is no Sales selection, bulk action or pagination prop.

Export inserts End customer after Customer and Currency after Value; numbers remain numeric and each row retains its ISO denomination. It exports the page's scoped/searched/classified `filtered` array, not `kanbanFiltered`. Owner/date absence exports blank rather than fabricated values. Current Last touch export strings are English literals; status values remain stored enum data. The builder must retain machine-readable data contracts while providing complete EN/ID UI (L-02).

## Current inventory — compatibility and win capture

`pmo-portal/App.tsx`: `/sales/:opportunityId` renders only `SalesDetailRedirect`, `<Navigate replace to=/projects/{opportunityId}>`; parameter is the project ID. No translation or visible block exists on this route. Current redirect does not explicitly forward query/hash/state. Ordinary Sales clicks already bypass the alias through `openOpportunity` and capture return context on the canonical record.

Active win capture lives in `pmo-portal/pages/project-detail/PipelineLens.tsx`, within `pages/project-detail/ProjectDetail.tsx`, after its shared header. This is a record boundary owned with area 3, not a new Sales detail route. Read-only Finance can inspect the lens; Admin/Executive/PM edit gate enables its legal lifecycle actions. Engineer follows canonical project permissions if arriving via a legacy link.

| Order in lens | Current block and job | Condition / labels |
|---|---|---|
| 1 | StatTiles: Value + basis, Win probability, Weighted, Owner | Open project; common `projectDetail.pipeline.stat.*`; row currency; missing cache currently defaults probability/weighted to zero |
| 1-terminal | Value + basis, Owner, Decision date/Pending | Terminal lens replaces open probability/weighted, common `projectDetail.pipeline.pending` |
| 2 | Journey card with lifecycle stepper | Stage progression; common `projectDetail.pipeline.journeyHeading/journeyAriaLabel`; `dealJourneySteps` contains stage literals |
| 3 | Next actions card / RecordActionZone | Common `projectDetail.pipeline.nextActionsHeading` |
| 3a | Read-only notice OR terminal/lost notice | Finance/Engineer read-only; terminal notice for permitted editors; common `readOnlyNotice/lostNotice/terminalNotice` |
| 3b | Advance to next pipeline stage (filled), Mark won, Mark lost, Decline to bid (outline) | Only legal targets, editor gate; terminal hides actions; common `advanceTo/markWon/markLost/markDeclined`; next-stage suffix map is English literal |
| 3c | Inline win panel: heading → booking amount/basis/consequence → reference → reference error → contract date → date error → Confirm won / Cancel | After Mark won; common `recordWonHeading/bookingOnWin/contractRefLabel/contractDateLabel/refRequired/dateRequired/confirmWon/cancel` |
| 3d | Inline transition error | Failure; preserves current capture values; common `transitionFailed` fallback and returned error |
| 3e | Back to Sales Pipeline | Always; validated captured Sales URL or `/sales`; common `backToSalesPipeline` |
| 4 | Mark lost confirmation; Decline to bid confirmation | Consequential dialog only when selected; common `lostConfirm.*` / `declinedConfirm.*` |
| outcome | Pending disables actions; transition toast; successful win becomes delivery layout; focus to h1 for win, next-actions heading otherwise | Common `toast.*`, `projectDetail.erpLink.*`; native win remains successful if follow-up linking needs retry |

There is a second status widget, `pmo-portal/components/ProjectStatusControl.tsx`: pending follow-up notice → inline mutation error → Change status trigger → legal-target menu + Cancel OR win form (heading/reference/date/Confirm/Cancel) → confirmation dialog for non-win targets. Most labels are **English literals**, except follow-up notice `projectDetail.erpLink.statusPending`. This widget gates with `transition`, unlike PipelineLens's `edit` gate; do not import it into Sales to recreate a second lifecycle path. Its calling sites retain their existing role/domain contracts; this area does not unify those policies.

## Retire and merge ledger

| Existing block/route | Decision in builder's same recomposition PR | Why / retained destination |
|---|---|---|
| Won board column | RETIRED from Sales | No won rows are supplied, so nobody can find won work there; existing `/projects` and `/projects/:id` remain the homes. Do not delete shared on-hand status definitions. |
| Separate Sales record layout | MERGED into canonical Project record | Identical record identity/job; retain `/sales/:id` replace redirect indefinitely for compatibility. No records/schema removed. |
| Funnel stage action + phone selector + board scroll marker | MERGED into one Stage control per viewport | A PM choosing a stage must see the same subset in board/table/phone; figure becomes read-only, not a second competing filter. |
| Board-only scope semantics | MERGED with table/phone scope | Export and displayed rows must describe the same set; Lost and attention remain reachable through named scope controls. Default Open omits terminal groups; no archived/lost records deleted. |
| Card stage pill inside named stage column | MERGED into column heading | Repeated grouping fact has no additional decision job; retain stage on ungrouped phone rows and table rows. Distinguish Declined from Loss Tender inside terminal group. |
| Always-visible summary + separate forecast strip | MERGED into one optional Pipeline summary disclosure | Executive can name a forecast job; everyday follow-up can start with records. Retain all five stage values and total once, outside row evidence. |
| Repeated mixed-currency caveats | MERGED into one visible scoped abnormal-condition note | Repetition adds no decision; each affected amount still explicitly says unavailable and remains accessible. |
| Detached journey and next-actions boxes at canonical capture boundary | MERGED into record evidence/action flow with area 3 | PM deciding a win needs amount/reference/date together, not duplicated money tiles beside an action box; destination brief still governs the rest of Project detail. |

No route with a distinct allowed persona job is retired. No new dashboard, conversion chart, drag transition, due-date model, bulk editing or schema is proposed.

## Target behavior details

- C-01/03 + N-04 require a small Sales working-set extension: add a validated URL sort, retain legacy scope/status/q/classification URLs, and stop coercing a non-Open scope to table when desktop board now supports it. View changes keep scope. Stage selection explicitly sets Open; Lost hides/disables irrelevant open-stage selection with plain explanation. Clear filters clears q/scope/stage/classifications, retaining sort and presentation; reset sorting separately through Sort. Return/copy/refresh must reproduce the same visible set and ordering.
- Default oldest activity sorts unknown activity first, then oldest timestamp; use stable project name/ID ties. Newest reverses known timestamps, still labels missing data. Attention remains the existing ≥30-day rule; absence is unavailable, not stale or zero days. Use “Last activity / Aktivitas terakhir” for the timestamp, not a promise of customer contact.
- Export must use the exact displayed working set in either desktop presentation and on phone; preserve End customer/ISO currency/numeric money columns. Optional Weighted visibility does not remove its export field. Summary deliberately retains the separate, explicitly named all-open scope, so it cannot pretend to total search matches.
- Unknown stage data with existing records cannot be zero-filled merely because an aggregate row is absent. Confirmed empty successful stages can be zero. Missing record probability is unavailable; lost/declined probability and weighted value are not applicable, not live zero forecasts. Mixed currencies never produce one aggregate/bar comparison; keep figure track/labels and mark unavailable slots visibly (S-02/03).
- One collection-level abnormal-condition note can combine missing summary data and currency scope with remedy links to record evidence. Fetch failures have scoped Retry status; row placeholders label the missing fact without repeating caveat prose. Do not hide missing values solely in tooltips.
- First use teaches the real action in one sentence; use the toolbar's existing single creation primary, not another empty-state button. No tour or mock data is needed. Scope-empty is a known successful result; no-match supplies Clear filters; an unavailable Lost fetch never says “No lost projects”.
- Existing Finance lifecycle read-only behavior remains. Inline capture is the consequential confirmation: reference/date required, exact booked amount and currency/basis visible once, pending and server rejection retain evidence/inputs. Replace the record primary with Confirm won while capture is open; keep Cancel and return reachable, and focus after successful win. Area 3 owns complete project detail recomposition.

## Capture manifest

Every row below is required at **1440×900 and 390×844 × EN/ID × light/dark**. Capture synthetic rich records with long short/contractual titles, IDs, customer/end customer, large locale-formatted amounts and mixed currencies. Label every capture URL, role, state, width, locale and theme. Actual values in screenshots must be synthetic. Do not claim the static scan proves these states.

| Route / role | Decision-relevant states / before-after pairs |
|---|---|
| `/sales`, PM | Open default: desktop Board and Table, phone list for either stored view; sort default/newest; summary closed/open; each five-stage selection and All stages; selected empty stage |
| `/sales`, PM | Lost only, Lost + Declined, no terminal records; Needs attention with stale open + stale lost, no stale records, unknown activity; changing view preserves scope |
| `/sales`, PM | Search match/no-match, each classification field, multiple active chips, disclosure closed/open, clear/remove during pending location debounce; copied/reloaded URL restores all controls and sort |
| `/sales`, Executive | Summary open across both views and every stage control; one currency, known empty stage, mixed currency within stage/across stages, missing stage aggregate; stable plot form and one caveat |
| `/sales`, Finance | Review row/card and export/More actions reachable, creation absent; true empty instructions; canonical record has read-only lifecycle |
| `/sales`, Admin | Creation → `/projects/new` → cancel/return preserves source; desktop/phone creation is sole primary; preview follows existing write policy |
| `/sales`, Engineer | Direct URL denied and named Dashboard recovery; no pipeline nav/data surfaced |
| `/sales`, PM | Pipeline loading, global error + Retry, zero total records, Lost loading/error with open rows still available; error → recovered data; export result matches visible rows |
| `/sales` → `/projects/:id`, PM/Finance | Name opens identical canonical record from board/table/phone; named Sales return restores q, classification, stage, scope, sort and scroll; browser Back remains native |
| `/sales/:id`, all five personas | Legacy entry replaces URL with `/projects/:id` for open/won/lost/declined projects; destination allowed/denied/missing/error, refresh and browser Back; no extra Sales page flashes. Record route/history evidence rather than a screenshot of an instantaneous redirect. |
| `/projects/:id`, PM | Canonical pre-win state, legal Advance success/error; win capture closed/open, missing fields, server failure with entered values, pending, cancel, success → delivery header/focus; amount/currency/basis and contract date remain explicit |
| `/projects/:id`, PM/Finance | Mark lost/Decline confirm cancelled/confirmed and outcome; Finance read-only, terminal decision date or unavailable value, no misleading zero forecast; linking-pending success/retry status as existing behavior |

Acceptance: PA-00 route jobs, PA-01/02 consistent shell track, PA-03/04 each fact once and evidence beside action; N-01–04 canonical identity/return/URL; A-01–04 one primary/result labels/consequence; E-01–04 inherited scope/labels/error retention; C-01–06 toolbar/sort/columns/open/recovery; S-01–05 truthful status/money/stable figure; L-01/02 complete EN/ID. Prove one h1, no document horizontal overflow, ≥44×44 phone targets, no serious/critical axe violations, empty rendered detector and unchanged token system. Screenshots require owner approval.

## Test disposition

All paths below begin `pmo-portal/`. This docs task deletes no tests. In the build, delete **only named look assertions**, keeping behavior/money/role/a11y oracles in mixed files. Update interaction steps for the deliberate Stage/scope change; never reduce a return/transition goal to element existence.

| Path | Delete on recompose / keep |
|---|---|
| `pages/SalesPipeline.test.tsx` | DELETE shared ListPage wrapper identity; SUB-H card-no-IDs/one-mono-line/second-line placement assertions; mandatory no-Export phone rule; T4 two-line clamp; stage-scroll implementation mocks. KEEP all identity/search/debounce/clear/URL/history/canonical navigation/empty/error/currency/tax/full-amount goals. Change stage-scroll steps to selecting Stage and asserting visible subset. Update old Table→Board resets-Open assertions to preserve chosen scope; do not retain them as accidental behavior locks. |
| `components/SalesKanbanBoard.test.tsx` | DELETE canonical ProjectCardShell identity and fixed seven-column/Won rendering assertions; initial/avatar choice and count-only/no-weighted placement locks. KEEP correct stage grouping, Lost vs Declined, accessible activation, row currency/basis/identity, missing customer and empty group meaning. Replace obsolete Won fixture with proof that won links still open Projects. |
| `pages/__tests__/SalesPipeline.funnel.test.tsx` | KEEP stage filtering/toggle/URL/pressed-control goals, adapt action from figure to toolbar Stage. DELETE requirement that the figure stays above toolbar/in banner; do not delete the behavioral suite merely because figure is now read-only. |
| `pages/__tests__/SalesPipeline.polish.test.tsx` | KEEP single search, scope, classification filtering/chips/clear and explicit states; DELETE no-Export phone assertion, adapt Export to More actions. Preserve location/view/query during clear-classifications. |
| `pages/__tests__/SalesPipeline.attentionSignals.test.tsx` | KEEP missing activity/owner, ≥30-day open ∪ lost inclusion/exclusion and text warning; DELETE exact progress tone/class assertion, retain readable non-colour probability/status. |
| `pages/__tests__/SalesPipeline.rbac.test.tsx`, `pages/__tests__/SalesPipeline.cta.test.tsx` | KEEP authorized/denied/back and role-specific New project action/destination. |
| `pages/__tests__/SalesPipeline.taxBasis.test.tsx`, `SalesPipeline.export.test.tsx`, `SalesPipeline.endCustomer.test.tsx` (same directory) | KEEP row-based basis, mixed-currency numeric export, end-customer search/export/identity; DELETE only fixed customer second-line placement. Extend export goal to actual displayed board/phone subset. |
| `pages/__tests__/SalesPipeline.bahasa.test.tsx`, `SalesPipeline.noun.test.tsx`; `components/SalesKanbanBoard.bahasa.test.tsx` | KEEP EN/ID domain labels, accessible status and consistent Project noun; update selectors/layout assumptions only. |
| `components/salesPipeline.test.ts`; `src/components/ui/__tests__/Funnel.ariaPressed.test.tsx` | KEEP weighted arithmetic, days/attention, canonical route/journey logic, shared Funnel keyboard/pressed semantics when interactive elsewhere. Sales becoming read-only does not remove shared interactive semantics. |
| `src/components/ui/__tests__/Funnel.neutralBars.test.tsx` | KEEP token-system checks; do not delete shared theme authority to change Sales layout. No new palette or raw status colour. |
| `components/ProjectStatusControl.test.tsx` | If this shared widget is touched, DELETE right-0 CSS anchoring assertions only; KEEP legal targets/role gates/required win fields/pending/errors/confirm-before-write. Do not change its caller policies to match PipelineLens. |
| `pages/project-detail/__tests__/PipelineLens.markwon.test.tsx`, `PipelineLens.rbac.test.tsx`, `PipelineLens.writePolicy.test.tsx`, `PipelineLens.erpLink.test.tsx` | KEEP booked amount, real-role editing, legal transition policy, required evidence, native win success/follow-up retry. Delete any detached-box placement checks when area 3 recomposes; coordinate with its builder. |
| `e2e/AC-SFA-001-sales-funnel-amount-geometry.spec.ts` | DELETE AC-SFA-006 exact 8px gap/aligned bar tops (look pin). KEEP amount containment, page overflow, keyboard reach/focus visibility; open disclosure first, apply focus checks only to actual interactive controls after figure becomes read-only. Do not remove keyboard reach to overflowed text. |
| `e2e/AC-SBC-001-sales-board-card-geometry.spec.ts` | KEEP long EN/ID amounts inside cards/no sideways nested card lists; adapt locators/presentation. These prevent unreadable data rather than pinning a look. |
| `e2e/AC-S24-004-phone-pipeline-stage.spec.ts`, `e2e/AC-IXD-PROJ-007-lost-in-pipeline.spec.ts`, `e2e/AC-1117-dashboard-pipeline.spec.ts` | KEEP stage/terminal reachability and real dashboard drill goals; adapt unified scope/filter steps, retain no-overflow/a11y proof. |
| `e2e/AC-LRC-004-sales-return.spec.ts`, `e2e/AC-W2-IXD-004-new-opportunity-from-pipeline.spec.ts`, `e2e/AC-SP-pipeline-drilldown.spec.ts` | KEEP return-context/creation/canonical project/win-capture journeys and goal oracles; add alias replace-history and explicit sort restoration if not covered by existing route/working-set tests. |

Add meaningful owning tests for new URL sort normalization, stable unknown-first ordering, view-preserved scopes, Stage subset equivalence, displayed-set export, partial archive failure and unavailable-vs-zero summary values. Existing behavior tests do not already prove these proposed changes. Read `docs/e2e-parallel-conventions.md` before altering any browser specs; follow the lane's current local/CI gates and area-3 ownership.

## Applied design methods and static evidence

- `/shape`: PRODUCT and PA-00 establish the job: identify the next deal requiring attention, then act in its canonical project. The brief is the requested discovery output; no product code built.
- `/critique` source assessment: current summary precedes finding work; board/table scope semantics and export sets differ; repeated stage/forecast treatment adds decisions before the record job; empty Won column cannot fulfil retrieval. This is a static critique, not a rendered score or browser approval.
- `/layout`: one aligned track with ordered controls and full-width collection; phone replaces stage board with vertical rows; capture evidence precedes submission. `/distill`: explicit retire/merge ledger; forecast disclosed and grouped stage repeated once. `/onboard`: one true-empty sentence and permitted creation, clear filters for no-match, scoped Retry for failed evidence; no tutorial ceremony.
- Taste v1: hierarchy, repetition, full identity, labeled fields and complete interaction cycles applied. User's token restrictions override optional font/colour/motion recipes.
- UI UX Pro Max `scripts/search.py` queried **kanban pipeline**, **funnel chart**, **deal card**, **stage board**. Funnel/Flow search warns against funnel geometry for non-monotonic stage values and requires named values and keyboard/list fallback. Other three returned no database match; broader `kanban`/`cards` UX retries also returned none. `data table --domain ux` returned responsive table containment/card projection guidance. No invented pattern recommendation or new visual recipe was adopted.
- `scripts/vendor-skills.sh` was run because `.claude/skills` was absent; upstream Taste directory relocation stopped it after Impeccable installed. Requested Taste/UI UX Pro Max were recovered from an existing local PMO vendored copy into ignored skill directories. No tracked skill files changed.
- Impeccable static command: `.claude/skills/impeccable/scripts/impeccable detect --json pmo-portal/pages pmo-portal/components pmo-portal/src/components/ui`; detector version `0.1.17`, output `[]`: **0 findings**. Includes the active `pages/project-detail/PipelineLens.tsx` capture source and shared Funnel/ListPage. Directory scope is wider than Sales, not a claim about all application source or rendered routes. Capture manifest remains the builder's rendered proof.

## Label sources — exact current EN/ID pairs

The tables below flatten only the relevant translation subtrees; dynamic record labels/identifiers are data. Canonical enum values stay unchanged. Source literals and stage suffixes noted above still require complete EN/ID treatment when their surface is touched. Tax-basis wording is owned by shared TaxBasisLabel, not a Sales-specific copy: common `tax.basis.inclusive/exclusive` and `tax.details.unknownRate/unknownBase`; capture can also disclose common `uxs39.showTaxDetails/hideTaxDetails`. Shared ExportButton, ListState and AccessDenied labels follow their common catalogues; no new Sales-only translation namespace is needed.

### `common.json`

| Key | EN | ID |
|---|---|---|
| `projectDetail.pipeline.backToSalesPipeline` | ← Back to Sales Pipeline | ← Kembali ke Pipeline Penjualan |
| `projectDetail.pipeline.advanceTo` | Advance to | Lanjutkan ke |
| `projectDetail.pipeline.bookingOnWin` | Booking <1>{{amount}}</1> <3></3> to contract value on win | Mencatat <1>{{amount}}</1> <3></3> ke nilai kontrak saat menang |
| `projectDetail.pipeline.cancel` | Cancel | Batal |
| `projectDetail.pipeline.confirmWon` | Confirm won | Konfirmasi menang |
| `projectDetail.pipeline.contractDateLabel` | Contract date | Tanggal kontrak |
| `projectDetail.pipeline.contractRefLabel` | Customer contract reference | Referensi kontrak klien |
| `projectDetail.pipeline.contractRefPlaceholder` | e.g. CPO-2026-0042 | mis. CPO-2026-0042 |
| `projectDetail.pipeline.dateRequired` | Contract date is required | Tanggal kontrak wajib diisi |
| `projectDetail.pipeline.journeyAriaLabel` | Project stage journey | Perjalanan tahap proyek |
| `projectDetail.pipeline.journeyHeading` | Project journey | Perjalanan proyek |
| `projectDetail.pipeline.lostConfirm.body` | This moves {{project}} to a terminal lost stage. You can still review it, but it will leave the active pipeline. | Ini memindahkan {{project}} ke tahap kalah yang bersifat akhir. Anda masih dapat meninjaunya, tetapi proyek akan keluar dari pipeline aktif. |
| `projectDetail.pipeline.lostConfirm.confirm` | Mark lost | Tandai kalah |
| `projectDetail.pipeline.lostConfirm.title` | Mark project as lost | Tandai proyek kalah |
| `projectDetail.pipeline.lostNotice` | This project is marked lost. It has left the active pipeline. | Proyek ini ditandai kalah. Proyek sudah keluar dari pipeline aktif. |
| `projectDetail.pipeline.markLost` | Mark lost | Tandai kalah |
| `projectDetail.pipeline.markDeclined` | Decline to bid | Tidak ikut tender |
| `projectDetail.pipeline.declinedConfirm.title` | Decline to bid | Tidak ikut tender |
| `projectDetail.pipeline.declinedConfirm.body` | This records {{project}} as declined: we chose not to bid. It leaves the active pipeline and is not counted against the win rate. | Ini mencatat {{project}} sebagai tidak diikuti: kami memilih tidak mengajukan penawaran. Proyek keluar dari pipeline aktif dan tidak dihitung dalam win rate. |
| `projectDetail.pipeline.declinedConfirm.confirm` | Decline to bid | Tidak ikut tender |
| `projectDetail.pipeline.markWon` | Mark won | Tandai menang |
| `projectDetail.pipeline.nextActionsHeading` | Next actions | Tindakan berikutnya |
| `projectDetail.pipeline.notSet` | Not set | Belum diisi |
| `projectDetail.pipeline.pending` | Pending | Menunggu |
| `projectDetail.pipeline.readOnlyNotice` | Pipeline managed by the project owner. You can review this project’s stage and journey here; lifecycle changes are made by the project manager. | Pipeline dikelola oleh pemilik proyek. Anda dapat meninjau tahap dan perjalanan proyek ini di sini; perubahan siklus dilakukan oleh manajer proyek. |
| `projectDetail.pipeline.recordWonHeading` | Record the won project | Catat proyek yang menang |
| `projectDetail.pipeline.refRequired` | Customer contract reference is required | Referensi kontrak klien wajib diisi |
| `projectDetail.pipeline.stat.decision` | Decision | Keputusan |
| `projectDetail.pipeline.stat.owner` | Owner | Pemilik |
| `projectDetail.pipeline.stat.value` | Value | Nilai |
| `projectDetail.pipeline.stat.weighted` | Weighted | Tertimbang |
| `projectDetail.pipeline.stat.winProbability` | Win probability | Peluang menang |
| `projectDetail.pipeline.terminalNotice` | This project has reached a terminal stage. No further pipeline actions. | Proyek ini sudah mencapai tahap akhir. Tidak ada tindakan pipeline lagi. |
| `projectDetail.pipeline.toast.movedTo` | Moved to | Dipindahkan ke |
| `projectDetail.pipeline.toast.updated` | Project updated | Proyek diperbarui |
| `projectDetail.pipeline.transitionFailed` | Transition failed | Transisi gagal |
| `sales.accessDenied.sub` | The Sales Pipeline is available to managers and finance. Your work lives on your dashboard, projects, and tasks. | Pipeline Penjualan tersedia untuk manajer dan keuangan. Pekerjaan Anda ada di dashboard, proyek, dan tugas Anda. |
| `sales.accessDenied.title` | You don't have access to the Sales Pipeline | Anda tidak memiliki akses ke Pipeline Penjualan |
| `sales.column.customer` | Customer | Klien |
| `sales.column.lastTouch` | Last touch | Aktivitas terakhir |
| `sales.column.owner` | Owner | Pemilik |
| `sales.column.project` | Project | Proyek |
| `sales.column.stage` | Stage | Tahap |
| `sales.column.value` | Value | Nilai |
| `sales.column.weighted` | Weighted | Tertimbang |
| `sales.column.winPct` | Win % | % menang |
| `sales.column.endCustomer` | End customer | Pelanggan akhir |
| `sales.empty.sub` | Add a project to start tracking the pipeline. | Tambahkan proyek untuk mulai memantau pipeline. |
| `sales.empty.title` | No projects yet | Belum ada proyek |
| `sales.error.sub` | Something went wrong fetching your pipeline. | Terjadi kesalahan saat mengambil pipeline Anda. |
| `sales.error.title` | Couldn't load the sales pipeline | Gagal memuat pipeline penjualan |
| `sales.funnel.weighted` | {{value}} weighted | {{value}} tertimbang |
| `sales.lastTouch.daysAgo` | days ago | hari lalu |
| `sales.lastTouch.oneDayAgo` | 1 day ago | 1 hari lalu |
| `sales.lastTouch.stale` | Untouched for {{days}} days — needs attention | Tidak tersentuh selama {{days}} hari — perlu perhatian |
| `sales.lastTouch.today` | today | hari ini |
| `sales.lastTouchUnavailable` | Last touch not available | Aktivitas terakhir tidak tersedia |
| `sales.lostError.sub` | Something went wrong fetching lost projects. | Terjadi kesalahan saat mengambil proyek yang kalah. |
| `sales.lostError.title` | Couldn't load lost projects | Gagal memuat proyek yang kalah |
| `sales.newProject` | New project | Proyek baru |
| `sales.openRow` | Open | Buka |
| `sales.ownerUnavailable` | Owner not available | Pemilik tidak tersedia |
| `sales.scope.lost` | Lost | Kalah |
| `sales.scope.needsAttention` | Needs attention | Perlu perhatian |
| `sales.scope.open` | Open | Aktif |
| `sales.scopeToggleLabel` | Project scope | Cakupan proyek |
| `sales.search.label` | Search projects | Cari proyek |
| `sales.search.placeholder` | Search projects… | Cari proyek… |
| `sales.summaryLabel` | Pipeline summary | Ringkasan pipeline |
| `sales.boardEmpty.classification.sub` | Clear a classification filter to see more projects. | Hapus filter klasifikasi untuk melihat lebih banyak proyek. |
| `sales.boardEmpty.classification.title` | No projects match these classifications | Tidak ada proyek yang cocok dengan klasifikasi ini |
| `sales.tableEmpty.clearFilters` | Clear filters | Hapus filter |
| `sales.tableEmpty.lost.sub` | Projects marked lost will appear here. | Proyek yang ditandai kalah akan muncul di sini. |
| `sales.tableEmpty.lost.title` | No lost projects | Tidak ada proyek yang kalah |
| `sales.tableEmpty.needsAttention.sub` | No project has been untouched for {{days}}+ days — pipeline is active. | Tidak ada proyek yang tak tersentuh selama {{days}}+ hari — pipeline aktif. |
| `sales.tableEmpty.needsAttention.title` | No projects need attention | Tidak ada proyek yang perlu perhatian |
| `sales.tableEmpty.search.sub` | Try a different name or customer. | Coba nama atau klien lain. |
| `sales.tableEmpty.search.title` | No projects match your search | Tidak ada proyek yang cocok dengan pencarian |
| `sales.view.board` | Board | Board |
| `sales.view.table` | Table | Tabel |
| `sales.viewToggleLabel` | Pipeline view | Tampilan pipeline |
| `sales.weightedForecast` | Weighted pipeline forecast | Proyeksi pipeline tertimbang |
| `sales.winProbability` | Win probability | Peluang menang |
| `sales.board.ariaLabel` | Sales pipeline board | Papan pipeline penjualan |
| `sales.stage.leads` | Leads | Prospek |
| `sales.stage.preQual` | Pre-Qual | Pra-kualifikasi |
| `sales.stage.quotation` | Quotation | Penawaran |
| `sales.stage.tender` | Tender | Tender |
| `sales.stage.negotiation` | Negotiation | Negosiasi |
| `sales.stage.lost` | Lost | Kalah |
| `sales.lostCounts` | Lost {{lost}} · Declined {{declined}} | Kalah {{lost}} · Tidak ikut tender {{declined}} |
| `shell.nav.sales` | Sales Pipeline | Pipeline Penjualan |
| `shell.nav.salesInvoices` | Sales Invoices | Faktur Penjualan |
| `projectClassification.tooLong` | Use {{max}} characters or fewer. | Gunakan maksimal {{max}} karakter. |
| `projectClassification.title` | Classification | Klasifikasi |
| `projectClassification.serviceLine` | Service line | Lini layanan |
| `projectClassification.sector` | Sector | Sektor |
| `projectClassification.location` | Location | Lokasi |
| `projectClassification.awardType` | Award type | Jenis perolehan |
| `projectClassification.biddingEntity` | Bidding entity | Entitas penawar |
| `projectClassification.notSet` | Not set | Belum diatur |
| `projectClassification.tender` | Tender | Tender |
| `projectClassification.direct` | Direct award | Penunjukan langsung |
| `projectClassification.alone` | Alone | Sendiri |
| `projectClassification.consortium` | Consortium | Konsorsium |
| `projectClassification.unavailable` | Options could not be loaded. Reopen this form to retry. | Pilihan tidak dapat dimuat. Buka kembali formulir untuk mencoba lagi. |
| `projectClassification.loadError` | Couldn't load classification options | Pilihan klasifikasi tidak dapat dimuat |
| `projectClassification.saved` | Classification options saved | Pilihan klasifikasi disimpan |
| `projectClassification.retained` | Existing project classifications stay recorded. | Klasifikasi proyek yang ada tetap tersimpan. |
| `projectClassification.setupHelp` | Define the service lines and sectors available on project forms. Removing an option keeps it on existing projects. | Tentukan lini layanan dan sektor pada formulir proyek. Menghapus pilihan tidak mengubah proyek yang sudah menggunakannya. |
| `projectClassification.serviceLines` | Service lines | Lini layanan |
| `projectClassification.sectors` | Sectors | Sektor |
| `projectClassification.onePerLine` | One option per line. Leave empty to offer no options. | Satu pilihan per baris. Kosongkan jika tidak ada pilihan. |
| `projectClassification.save` | Save options | Simpan pilihan |
| `projectClassification.adminOnly` | Only an Admin can change these options. | Hanya Admin yang dapat mengubah pilihan ini. |
| `projectClassification.all` | All | Semua |
| `projectClassification.filterServiceLine` | Filter by service line | Filter menurut lini layanan |
| `projectClassification.filterSector` | Filter by sector | Filter menurut sektor |
| `projectClassification.filterAwardType` | Filter by award type | Filter menurut jenis perolehan |
| `projectClassification.filterBiddingEntity` | Filter by bidding entity | Filter menurut entitas penawar |
| `projectClassification.filterLocation` | Filter by location | Filter menurut lokasi |
| `projectClassification.applied` | Applied classifications | Klasifikasi yang diterapkan |
| `projectClassification.remove` | Remove classification: {{selection}} | Hapus klasifikasi: {{selection}} |
| `projectClassification.clear` | Clear classifications | Hapus klasifikasi |
| `uxs24.stageLabel` | Pipeline stage | Tahap pipeline |
| `uxs24.allStages` | All stages | Semua tahap |
| `uxs24.phoneList` | Projects in selected pipeline stage | Proyek pada tahap pipeline yang dipilih |
| `uxs24.stageEmptyTitle` | No projects in this stage | Tidak ada proyek pada tahap ini |
| `uxs24.stageEmptyBody` | Choose another stage or clear filters to see more projects. | Pilih tahap lain atau hapus filter untuk melihat proyek lainnya. |

### `sales.json`

| Key | EN | ID |
|---|---|---|
| `pipeline.endCustomerLine` | for {{name}} | untuk {{name}} |
| `pipeline.mixedCurrency` | Mixed currencies, so no single total | Mata uang campuran, jadi tidak ada total tunggal |
