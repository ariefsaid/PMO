# Projects source inventory — #806 area 2

Baseline `123d2ec9`; facts below describe that checkout, not the proposed composition. Scope: `/projects` and `/projects/new`, including their mounted overlays and four collection views. [Composition brief](projects.md) supplies the target. Synthetic examples only; no production reads.

## Sources and roles

- `pmo-portal/pages/Projects.tsx`: collection, filtering/sorting, columns, transfer tools, edit/archive overlays.
- `pmo-portal/pages/ProjectNew.tsx`: full-page creation, permission fallback, leave guard and saved navigation.
- `pmo-portal/components/{ProjectCard,ProjectCardShell,ProjectKanbanBoard,ProjectCalendarView,ProjectClassificationFilters,ProjectFormModal}.tsx`: actual child render bodies.
- `pmo-portal/src/components/ui/{ListPage,DataTable,TaxRateFields}.tsx`: shared frame, responsive rows, table controls and conditional tax fields; `src/auth/policy.ts` and `src/components/import/ImportButton.tsx`: affordance gates.
- `pmo-portal/src/hooks/{useProjects,useProjectView,useListWorkingSet,useListReturn,useProjectStatusLabel}.ts*`, `src/lib/{listWorkingSet,projectClassification}.ts`, `src/lib/db/projects.ts`: source of scope, defaults, identity and status handling.

Read audience A = Admin, Executive, Project Manager, Finance, Engineer. W = Admin, Executive, Project Manager (create/edit); R = Admin, Executive (archive). These describe shipped UI affordances; server rules stay unchanged. Effective Engineer changes browse controls and My Projects semantics; write gates use existing permission hooks.

`/projects` reads on-hand ∪ internal projects. Engineer defaults to My Projects derived from own task project IDs; other roles default All; non-Engineer's My Projects matches manager ID. Status scopes are All, My Projects, Ongoing (ongoing/won-pending/on-hold), Completed (close-out/loss), At risk. Classification/customer/end-customer/PM/search intersect. Search covers name, alias, PMO number, client code, customer/end-customer names and aliases. Current ordering is stable confirmed-risk-first with remaining order inherited from the fetched array; there is no explicit page sort control. Board then groups by lifecycle; Calendar orders dates.

## Current `/projects` render order

Shared shell supplies navigation/top bar outside this page. `ListPage` itself renders h1/optional description and New project in the header, then toolbar, then body. This page passes no count. All rows below are A unless noted.

| Order / branch | Block → fact or action | Audience | EN/ID label source |
|---|---|---|---|
| 1, all branches | h1 Projects; description says pre-win projects live in Pipeline; header New project opens `/projects/new` carrying return context | A; action W | common `projects.title`, `.description`, `.actions.new` |
| 2a, pending | bordered loading list with six skeleton rows; no toolbar | A | shared ListState labels |
| 2b, failed/no data | error heading, explanation, Retry → refetch; no toolbar | A | common `projects.states.errorTitle/errorSub`; shared retry |
| 2c, zero fetched rows except at-risk scope | teaching empty state, explanation and another New project entry for W; no toolbar | A | common `projects.states.emptyTitle/emptySub`, `.actions.new`; ListState role/module guidance |
| 2d, loaded desktop toolbar, DOM order | status scopes → search → Filters → More actions → view chooser | A | common `projects.filters.*`, `.search.*`, `uxs14.filters/moreActions`, `projects.view.*` |
| 2d, desktop visual placement | page CSS grid places status/search on first row, Filters/More on second, view spanning both | A | same controls; this is layout, not an extra feature |
| 2e, loaded phone toolbar | horizontal status scopes → search + horizontally scrollable Table/Cards/Calendar/Board → Filters + More actions → active customer/PM/end-customer chips + Clear all | A; Filters omits manager-browse selects for Engineer | common `projects.mobile.*`, `projects.view.*`, `uxs14.*` |
| 3, Filters open | customer → end customer → PM → service line → sector → award type → bidding entity → location; count on trigger | A except first three not offered to effective Engineer | common `projects.filters.*`; `projectClassification.*` |
| 3a, filter options | customer uses client companies; end customer uses associated companies plus URL-restored selection; PM has All/Unassigned/named or unnamed-assigned fallback; phone query failures have Retry | as above | common `projects.unassigned/unnamedUser`, `projects.mobile.error/retry`; labels from companyDisplayName/projectManagerLabel |
| 3b, classification summary | applied classification chips with individual remove, plus Clear classifications; location debounced and reset cancels pending text | A | common `projectClassification.applied/remove/clear` and field/value keys |
| 4, More actions open | Export filtered projects (contract currency added) → Import projects → Import budgets; each import opens its wizard | export A; project import W; budget import Admin/Executive/PM/Finance | common `projects.export/import/importBudgets`; shared import/export catalogues |
| 5a, at-risk scope with rows + pending money | local loading state before view dispatch | A | shared ListState |
| 5b, at-risk scope with rows + failed money | cannot check budget risk + explanation + money Retry | A | common `uxs02.riskUnavailableTitle/riskUnavailableSub` |
| 5c | selected Board, Calendar, Table or Cards body (see next tables) | A | view-specific below |
| 6, edit target exists | ProjectFormModal editHeader: Project fields → Classification → Schedule → modal actions; values seeded from selected row | W | common `projectForm.*`, `projectClassification.*`; projects namespace `shortName.*` |
| 7, archive target exists | ConfirmDialog names project, explains hidden-from-default-list with references retained; Archive project / Cancel, pending | R | common `projects.confirm.*`, `entityForm.*`; named title currently hard-coded `Archive <name>?` |
| 8, mutation outcomes | update/archive success or classified warning toast | relevant writer | common `projects.toast.*`; classifyMutationError/shared error catalogues |

The phone Filters uses close-on-select and restores focus; More closes after export, remains mounted when an import wizard opens. Clear all restores role-default scope and clears narrowing through one working-set reset. URL owns filters/search/view/classifications/month; session view is fallback. Record opening captures list URL, scroll and focus identity.

## Current view bodies, render order

### Table / phone DataTable rows

| Order | Contents and actions | Role / labels |
|---|---|---|
| 1 | headers: Project → PM → Status → Contract → Actual → Progress → Budget used; permitted row-menu control is separate | A; common `projects.columns.*`; shared DataTable action/resize labels |
| 2, Project cell | coloured initial tile → short-first project-name button (legal name accessible/hover) → At risk text pill when confirmed; secondary customer link + PMO/client code line + optional end-customer line | A; common `projects.atRiskPill`, `projects.identifiers.*`; names/codes are stored data |
| 3, PM | small initials avatar with full name accessible/title, Unassigned or unnamed-assigned fallback | A; common `projects.unassigned/unnamedUser` |
| 4, Status | raw stored project status in pill (not localized here) | A; DB enum text; column heading localized |
| 5, Contract | exact project-currency contract value + plain tax basis; fuller tax details available to assistive technology | A; TaxBasisLabel → shared tax catalogue |
| 6, Actual | canonical Actual via money collection; pending ellipsis, unavailable dash with accessible reason, exact localized amount or restricted-excluded tag | A; common `uxs02.*`, projects namespace `actual.restrictedTag` |
| 7, Progress | rounded delivery percent/bar; pending ellipsis, failed dash or accessible No phases yet | A; common `projects.noPhasesYet`, `.card.deliveryPercent` |
| 8, Budget used | Actual / explicit Active budget bar + rounded percent; exact numerator/denominator on title; missing, known-zero-budget, mismatch, restricted/partial reads remain unavailable | A; common `uxs02.*` |
| 9, row actions | Edit → prefilled header modal; Archive → confirmation; no hard-delete or inline status transition | W edit; R archive; common `projects.actions.edit/archive` |
| 10, table caveat | Actual-column caveat supplied once with affected/visible row counts and newest available ERP update time | A; projects namespace `coverage.partial/partialUpdated` |
| 11, no rows | Nothing at risk explanation; otherwise no-match + Clear filters, or no-projects explanation | A; common `projects.empty.*`, `.states.*` |

Progress/Budget used columns are omitted if no visible project supplies that data; pending/failed reads keep columns. DataTable retains column resize, responsive card branch and separate row menu. On phone it renders identity/secondary context first and then remaining visible column values in its responsive row/card representation; record activation and row menu remain separate. See `DataTable.tsx` for shared column semantics, not a new route. Table empty has different dispatch from Board/Calendar; those currently render their own empty bodies.

### Cards

| Order | Contents and actions | Role / labels |
|---|---|---|
| 1 | repeat ProjectCardShell: initial → project alias/name button with contractual title → customer link → lifecycle pill | A; names from stored data; raw status enum |
| 2 | Contract + plain tax basis → Active budget (or explicit absence/unavailable) → Actual (complete only), each in a three-column money grid | A; common `projects.columns.contract/actual`, `uxs02.activeBudget/noActiveBudget/unavailable`; shared tax labels |
| 3 | optional Delivery bar → optional Budget used bar and At risk text | A; common `projects.card.delivery/deliveryPercent`, `projects.columns.budgetUsed`, `uxs02.atRisk` |
| 4 | More project references disclosure → PMO Project Number → Client Project Code → customer contract reference when supplied | A; common `uxs14.projectReferences/projectReferencesFor/contractReference`, `projects.identifiers.*` |
| 5 | footer PM initial/name or unassigned/unnamed fallback → quiet Edit (stops card activation) | A; Edit W; common `projects.card.editProject`, `.actions.edit`, `.unassigned/unnamedUser` |

Cards empty/no-match uses ListState; imports/edit/archive are page-level siblings. Cards use a repeated grid with 320px minimum tracks. They currently receive no end-customer prop in the shell; its list filter/search remains available. Missing money differs from known zero; no card coverage prose is rendered.

### Board

| Order | Contents and actions | Role / labels |
|---|---|---|
| 1 | phone stage jump strip, counts and active-stage position | A; stage titles below; shared stage indicator names |
| 2 | contained horizontally scrollable board; Won → Ongoing → On Hold → Close Out → Internal columns, each header + count, including empty columns | A; common `projects.kanban.won/ongoing/onHold/closeOut/internal/board/empty` |
| 3, each card | initial + full wrapping alias/name → repeated lifecycle status pill → customer and PMO/client-code values → contract with tax basis → PM footer | A; raw status, stored identities, common identifier/PM keys and tax labels |
| 4 | first-scroll phone “Swipe for more” decorative hint, dismissed after scrolling | A; common `projects.kanban.swipe` |

Whole board card is one keyboard/click activation target; no nested links or drag-to-transition. Customer is text here. Short-name legal-title disclosure remains accessible. Group order is lifecycle, not page sort; existing stage-jump and scroll synchronization are behavior.

### Calendar

| Order | Contents and actions | Role / labels |
|---|---|---|
| 1 | Previous month → Next month → Today → localized month h2 | A; common `projects.calendar.previousMonth/nextMonth/goToday/today`; date format helpers |
| 2 desktop | seven weekday headings → month cells with day numbers, today marker and adjacent-month shading | A; weekdays currently hard-coded `Sun`…`Sat`; dates via calendar utilities |
| 3 desktop events | project starts/ends and dated phase targets in day cells; each opens canonical project | A; name from data; start/end accessible suffix currently hard-coded EN; phase label/aria use common `projects.calendar.phaseEventLabel/phaseEventAriaLabel` |
| 2 phone | chronological day-grouped agenda → dated project/phase buttons | A; localized weekday/month/day helper; same event source/actions |
| 4 | No events this month + explanation when displayed month contains none; controls/grid remain | A; common `projects.calendar.noEventsTitle/noEventsSub` |

Phase-date read is batched only when Calendar is selected; month is URL-owned. No chart with controls exists on either route. Progress bars have no independent metric/period toggle; S-02 remains binding if a builder introduces one.

## Current `/projects/new` render order

| Order / branch | Block → fact or action | Role / EN/ID source |
|---|---|---|
| denied | AccessDenied heading + Projects return; no form | Finance/Engineer; projects namespace `create.accessDenied`; common `projectDetail.backToProjects` |
| 1 | page variant of ProjectFormModal: centered max-width form, PageHeader New project + “Create a project” meta | W; common `projectForm.title.create/subtitle.create` |
| 2 | linked error summary after attempted submit, before fields | W; validation messages below; links focus corresponding fields |
| 3, Project group | required Project name → optional Short name → required Client company → optional End customer → optional Project manager | W; common `projectForm.section.project/name/client/endCustomer/pm.*`; projects namespace `shortName.label/hint` |
| 4, same group | required proposed editable PMO Project Number with pending/error/duplicate helper → optional Client Project Code → Origination stage (Leads default or Internal Project) → optional Estimated value | W; common `projectForm.projectNumber/clientCode/stage.*`, `.estimatedValue`, `.value.*`; options from useProjectStatusLabel |
| 5, nonzero estimate only | TaxRateFields (nominal tax rate and DPP base; leaving rate blank uses manual tax amount) → required Tax treatment → required Tax amount (read-only when calculated) → missing-tax reason | W; shared tax keys, common `projectDetail.header.taxTreatment/taxAmount`, `projectForm.taxRequiredHint` |
| 6, Classification group | Service line → Sector → Award type → Bidding entity → Location; unset choices and option-load explanation | W; common `projectClassification.*`; configured/stored choices are data; award/bidding values use shared mapping |
| 7, Schedule group | Expected start → Expected end | W; common `projectForm.section.schedule/expectedStart/expectedEnd` |
| 8 | sticky bottom FormActions: Cancel + Create project, completeness/proposal/tax disabled state and submission pending | W; common `entityForm.cancel`, `projectForm.submit.create` |
| 9, dirty leave only | discard confirmation, explanation, Leave / Stay; browser/router guard | W; common `entityForm.discardTitle/discardBody`; projects namespace `create.leave/stay` |
| 10, submission outcome | classified warning retains values; success toast names saved project, ERP-pending variant warns; URL replaced by `/projects/:id` preserving return state | W; common `projects.toast.created`, `projectDetail.erpLink.createdPending`; classified mutation labels |

No insert occurs on entry. Number proposal is disabled until ready; duplicate number/alias errors retain user input. New project defaults currency from organization, not an arbitrary display currency. Stage is constrained to origination choices; creating an on-hand project is not offered. The list's editHeader modal omits origination, estimated value/tax and proposed number; it keeps name/alias/customer/end customer/PM/client code/classification/schedule and Save project.

## Source critique and skill evidence

Applied [impeccable-map](../impeccable-map.md) in order: **shape** discovery from PRODUCT/routes → **critique** hierarchy/IA and cognitive load → **layout** reading path/phone adaptation → **distill** one fact/one action → **onboard** first value and empty-state recovery.

Shape discovery round, grounded in PRODUCT and the route bodies: people = owner-operator initially, later PM/Finance/staff; context = finding a project during delivery or recording its business identity; success = opening the correct project with list context intact, or creating it exactly once and landing on its canonical record. Assumption: mixed product familiarity, desktop work with phone lookup. First value is a recognizable project and a reachable next action, not completing a tour. Boundary = whole-page IA/IxD, existing identity/tokens/roles/money semantics and every feature retained.

Distill ledger: merge classification/customer summaries into one removable scope summary, retaining classification-only reset inside Filters; move transfer tools and references behind named disclosures; remove duplicate first-run creation action, repeated board status, initial decoration and duplicate create subtitle. Keep every underlying field/action reachable. Onboard: empty portfolio explains create-or-win; a permitted toolbar action starts real capture; readers get guidance to their PM/Admin; no-match offers clear, no-event month retains navigation, unknown money offers review/retry. No welcome tour, fabricated records or extra setup steps.

Spatial thesis: narrow to a recognizable project, read its status/date beside delivery/money evidence, then open or maintain it. Capture follows identity → responsibility/dates → estimate and its tax basis → optional classification → submit. Repeated peer projects justify rows/cards; repeated decorative initials and status already supplied by a board column do not add decision evidence.

- Impeccable `SKILL.md`, `reference/shape.md`, `critique.md`, `layout.md`, `distill.md`, `onboard.md`, `operate.md`, `audit.md`: Operate mode, recognition over recall, co-located evidence, structural phone adaptation and source-based hierarchy/IA analysis. Independent source assessments: `projects_critique_a` (hierarchy/IA/layout and builder check) and `projects_detect_b` (directory detector). Browser/overlay and live-server steps were intentionally outside this docs-only request; no rendered heuristic score is claimed.
- Taste `SKILL.md` + `references/app-screens.md`: answer the screen's question before secondary metadata; use repetition only for peer objects, no KPI scaffolding, no repeated tinted initial decoration, honest missing-data labels and readable rows. Existing tokens and the shell override optional replacement styling. No visual-direction draw or app inspector is claimed for this docs-only pass.
- Vendor attempt: `scripts/vendor-skills.sh` fetched Impeccable but stopped because upstream Taste no longer contained `skills/taste-skill-v1`; used the shell worktree's local Taste and UI UX Pro Max copies in this worktree's ignored skill directory. No vendor script or tracked skill changed.
- Ran `.claude/skills/impeccable/scripts/impeccable context --target pmo-portal/pages/Projects.tsx` and `detect --json` against Projects, ProjectNew, ProjectCard, ProjectCardShell, ProjectKanbanBoard, ProjectCalendarView, ProjectClassificationFilters, ProjectFormModal, ListPage and DataTable: JSON `[]` (zero findings). Independent directory scan also ran `impeccable detect pmo-portal/pages pmo-portal/components pmo-portal/src/components/ui --json`: `[]`, exit 0, **0 findings and 0 advisories**. Both are static TSX pattern detection, not proof of rendered a11y, hierarchy, contrast or phone fit.
- Ran UI UX Pro Max `scripts/search.py` with `--domain ux`: `data table sorting` → Table Handling; `filter bar search` → No Results / Chip Collection Reflow; `empty state` → Empty States / Deep Linking. Applied contained/reflowed rows, wrapped removable scope, explicit recovery and URL-owned state. Unrelated search hits were discarded.
- `kanban board` (ux), retry `kanban` (style): no verified database match. `list card` (ux), retry `card layout` (ux): only positioning/stacking advice, no verified list-card pattern. Board/card guidance therefore comes from shipped behavior, UX-STANDARD and the other skills, not a claimed search match. No palette/font search was used.

Builder check resolved: the target explicitly adds an opt-in toolbar action integration across list states, optional project-card context slots without changing Sales, and validated creation origin scope/direct-entry fallback.

Source consequences driving the proposal: the current toolbar leads with scopes before search; a PM's data comparison separates delivery from lifecycle/date context; first-run can render creation twice; board repeats its column status; creation groups estimate/tax with identity while schedule is separated by classification. The proposal addresses these by job grouping and disclosure. Static source cannot establish clipping or a rendered severity score; the builder must inspect full/long/empty/localized states.

## Screenshot manifest

For each row, capture at 1440×900 and 390×844, EN/ID, light/dark; combine related states in the same synthetic dataset to avoid a record-by-record capture explosion. Record URL, role, state and viewport. Every toggle value and abnormal state below needs evidence; captions must distinguish loaded, loading and unavailable.

| Route / role | Decision-relevant states and interaction pairs |
|---|---|
| `/projects?view=table`, PM | populated mixed status, long alias/legal name/identifiers/customer/end customer, assigned/unassigned/unnamed PM; exact multi-currency amounts, known-zero/absent budget, complete/partial/restricted/unavailable money and delivery; first-screen and opened row evidence |
| `/projects?view=cards`, PM | same evidence set; references closed/open; Edit closed/open → validation failure → saved outcome; customer link navigation/return |
| `/projects?view=kanban`, PM | all five stages including empty one, long names; phone first/last stage with jump/scroll synchronization; record-open/back pair |
| `/projects?view=calendar`, PM | dated start/end/phase month, previous/next/Today, no-events month, dated agenda; phase/project open/back restores month |
| `/projects`, PM | initial list loading → loaded; list error → Retry; empty portfolio; Filters and More closed/open, option error → Retry, no-match → clear; one transfer wizard from each import entry plus export outcome |
| `/projects?filter=at-risk`, PM | money pending → failed → retry; confirmed-risk set; no confirmed signal with unassessed projects (no false assurance) |
| `/projects`, Engineer; Finance | assigned-project default versus All; Engineer classification-only filters; Finance reads with no project writer controls; denied `/projects/new` and return |
| `/projects`, Admin; Executive | Edit and Archive menu; archive confirmation → cancel/confirm outcome; verify same create/archive visibility for both without duplicating every view capture |
| `/projects/new`, PM | blank identity → selected client/proposal loading/success/error/duplicate; Leads/Internal option pair; optional classification closed/open with values; zero/blank estimate versus nonzero conditional tax incl. manual/calculated mode |
| `/projects/new`, PM | invalid numeric/tax/alias → correction retaining values; pending write → saved record; mutation failure; ERP-pending saved outcome; pristine Cancel and dirty Stay/Leave → source list; keyboard open on last field without covered actions |

Verify target sort label/order and URL reopening, search scope intersections, role-default clear and source-list restoration by interaction. Loading should retain final-view headers/geometry. Phone first result must be visible with default controls collapsed. Machine checks and owner rendered review are specified in the main brief; this inventory is not their passing evidence.

## Test disposition

Do this during recomposition, not in this docs change. Delete look-only cases/assertions; split mixed tests so business, behavior and accessible meaning survive. Updating deliberate interaction steps is allowed; weakening the outcome is not. Paths below are relative to `pmo-portal/`.

| File | Delete when recomposing | Keep / adapt behavior proof |
|---|---|---|
| `pages/Projects.test.tsx` | `#1` avatar 18px and compact-bar cases; UX-019 one mono-line/no-disclosure assertions; RF-009/UX-021 forced optional-column absence/no restore control; placement-only parts of C3/header and AC-EC-003 | AC-401–408, aliases/search, role/create gates, end-customer scope, no write on entry, no inline status transitions, exact currency/tax/risk/unknown proofs, URL working set; retain accessible PM identity and available delivery/budget evidence |
| `pages/__tests__/Projects.polish.test.tsx` | UIP-003 min-width, clamp, exact column omission/alignment assertions | UIP-004 filter intersection/count/remove/clear/debounce/focus and loading/error states |
| `pages/__tests__/Projects.calm.test.tsx` | exact subtitle/Pipeline-only copy, mono-line, columns-absent and tooltip-versus-visible placement assertions | one caveat, unknown/known-zero/restricted meaning, percentages, option Retry; adapt no-phases dash assertion to explicit label |
| `components/ProjectCards.calm.test.tsx` | one-line/no-label/`font-mono` assertions and rate/DPP placement-only expectations | distinct absence/unknown, complete Actual, budget denominator, tax basis and no-inline-transition behavior; single fact/caveat semantics survive without old containers |
| `components/ProjectCardShell.test.tsx` | CW-3b fixed molecule/shadow/carrier, AC-KTR-002 clamp/status placement, PL-1/AC-KTR-001 exact CSS/order assertions | activation, aliases/legal description, labelled identifiers, missing customer, single keyboard target without nested buttons |
| `components/ProjectCard.test.tsx` | StatusPill dot/chrome and carrier checks, freshness/tax-detail placement-only assertions | recognized names, customer/PM identity, open versus Edit, references disclosure, all exact-money/currency/basis/risk and unavailable tests |
| `components/ProjectKanbanBoard.test.tsx` | CW-3b carrier and exact one-line identifier presentation; decorative swipe-hint CSS/animation assertions | stage membership/order/count/empty columns, click/Enter/Space, stage jumping and scroll sync, identifiers, tax basis, accessible names |
| `pages/__tests__/Projects.mobileToolbar.test.tsx` | fixed toolbar DOM composition and “no toolbar while loading/error/empty” absence expectations | all controls reachable, one instance, role gates, chips/count/clear, focus/Escape, export/import lifecycle, option Retry, locale and state recovery |
| `pages/__tests__/Projects.mobileViewToggle.test.tsx` | literal CSS `hidden`-class checks | Table/Cards/Calendar/Board selectable and reachable on phone |
| `components/__tests__/ProjectCalendarView.milestoneLink.test.tsx` | `batch-3` exact shared chip styling | every project/phase event interactive with correct project destination/name |
| `components/__tests__/ProjectCalendarView.{events,nav,states,responsive}.test.tsx` | no date/agenda functionality deletions; replace only implementation-specific carrier selectors as necessary | placement by date, no fabricated dates, month navigation, no-events month, phone chronological agenda, EN/ID phase language |
| `e2e/AC-TBL-RESIZE-001-projects-table-geometry.spec.ts` | toolbar ≤120px/two-row cap, fixed 12px inter-column gap, 2px resize-indicator geometry | operable resize, control reachability, row actions and no page overflow at desktop/phone; adapt selectors for new sort/view controls |
| `e2e/AC-TBL-OVERFLOW-001-projects-table-no-page-scroll.spec.ts` | avatar/tooltip-specific representation, forbidden-column/control composition assumptions | readable complete customer/PM, reachable row actions and evidence, no page overflow; retain usable table fit |

Retain these suites (adapt queries/steps only where composition deliberately changes):

- `pages/__tests__/Projects.{engineer-default,engineerToolbar,managerSemantics,projectNumber,deliveryBudget,deliveryError,atRiskFilter,atrisk,rowMenu,cardMenu,calendarMonth,createNavigation}.test.tsx`; `pages/__tests__/ProjectNew.test.tsx`; `pages/Projects.analytics.test.tsx`.
- `components/ProjectClassificationFilters.test.tsx`; `components/ProjectFormModal.{projectNumber,numericValidation,currency,classification,locale,shortName,endCustomer,contractTax,bahasa}.test.tsx`: field persistence, validation, conditional tax, identifiers, role/stage and complete labels.
- `src/hooks/useProjectView.test.ts`, `src/hooks/useProjects.test.tsx`, `src/hooks/useProjectsMoneyCollection.test.tsx`, `src/hooks/useProjectsDelivery.test.tsx`; shared working-set/return and import behavior suites remain in scope through their consumers.
- `e2e/AC-401-projects-smoke.spec.ts`, `e2e/AC-PRJ-001-projects-crud.spec.ts`, `e2e/AC-PK-005-projects-kanban.spec.ts`, `e2e/AC-LRC-003-projects-return.spec.ts`, `e2e/AC-CODE-003-project-identifiers.spec.ts`, `e2e/AC-002-project-short-name.spec.ts`, `e2e/AC-RAM-001-ris-admin-first-project.spec.ts`, `e2e/serial/AC-CODE-002-project-number-proposal.spec.ts`, `e2e/serial/AC-TAG-002-project-classification.spec.ts`.

Add lowest-sufficient-layer behavior proofs for visible/default URL sort, shared no-match handling across all views and consolidated clear behavior. Do not delete shared Sales uses of ProjectCardShell or shared table resize/keyboard/a11y tests merely because these pages change. Existing visual snapshots are evidence to regenerate after owner-approved recomposition, never an old-layout veto.

## EN/ID label lookup

The appendix below enumerates literal translation keys called by the page-specific bodies plus shared TaxRateFields. `common` means `pmo-portal/public/locales/{en,id}/common.json`; explicit `projects:` means corresponding `projects.json`. Form requests both namespaces; other calls default common. Dynamic names/options are stored data, never translated client names. Shared components add shared retry, combobox, modal, import/export, tax and error copy from the same locale catalogues. Raw status enums, weekday literals and named archive title exceptions are recorded above; target copy must use complete EN/ID equivalents (L-01/02). Example placeholders are omitted here; builders should use generic synthetic wording.

| Namespace:key | EN | ID | Caller |
|---|---|---|---|
| `common:companies.type.client` | Client | Klien | ProjectFormModal |
| `common:entityForm.cancel` | Cancel | Batal | ProjectFormModal |
| `common:entityForm.discardBody` | This form has unsaved changes. Discarding will lose them. | Formulir ini memiliki perubahan yang belum disimpan. Membuangnya akan menghilangkannya. | ProjectNew |
| `common:entityForm.discardTitle` | Discard your changes? | Buang perubahan Anda? | ProjectNew |
| `common:projectClassification.all` | All | Semua | ProjectClassificationFilters |
| `common:projectClassification.applied` | Applied classifications | Klasifikasi yang diterapkan | ProjectClassificationFilters |
| `common:projectClassification.awardType` | Award type | Jenis perolehan | ProjectClassificationFilters, ProjectFormModal |
| `common:projectClassification.biddingEntity` | Bidding entity | Entitas penawar | ProjectClassificationFilters, ProjectFormModal |
| `common:projectClassification.clear` | Clear classifications | Hapus klasifikasi | ProjectClassificationFilters |
| `common:projectClassification.filterAwardType` | Filter by award type | Filter menurut jenis perolehan | ProjectClassificationFilters |
| `common:projectClassification.filterBiddingEntity` | Filter by bidding entity | Filter menurut entitas penawar | ProjectClassificationFilters |
| `common:projectClassification.filterLocation` | Filter by location | Filter menurut lokasi | ProjectClassificationFilters |
| `common:projectClassification.filterSector` | Filter by sector | Filter menurut sektor | ProjectClassificationFilters |
| `common:projectClassification.filterServiceLine` | Filter by service line | Filter menurut lini layanan | ProjectClassificationFilters |
| `common:projectClassification.location` | Location | Lokasi | ProjectClassificationFilters, ProjectFormModal |
| `common:projectClassification.notSet` | Not set | Belum diatur | ProjectFormModal |
| `common:projectClassification.remove` | Remove classification: {{selection}} | Hapus klasifikasi: {{selection}} | ProjectClassificationFilters |
| `common:projectClassification.sector` | Sector | Sektor | ProjectClassificationFilters, ProjectFormModal |
| `common:projectClassification.serviceLine` | Service line | Lini layanan | ProjectClassificationFilters, ProjectFormModal |
| `common:projectClassification.title` | Classification | Klasifikasi | ProjectClassificationFilters, ProjectFormModal |
| `common:projectClassification.tooLong` | Use {{max}} characters or fewer. | Gunakan maksimal {{max}} karakter. | ProjectFormModal |
| `common:projectClassification.unavailable` | Options could not be loaded. Reopen this form to retry. | Pilihan tidak dapat dimuat. Buka kembali formulir untuk mencoba lagi. | ProjectFormModal |
| `common:projectDetail.backToProjects` | Projects | Proyek | ProjectNew |
| `common:projectDetail.erpLink.createdPending` | {{name}} saved. ERP linking needs attention; retry from the project page. | {{name}} tersimpan. Penghubungan ERP perlu ditinjau; coba lagi dari halaman proyek. | ProjectNew |
| `common:projectDetail.header.invalidContractValue` | Enter a valid non-negative amount with no more than 2 decimal places. | Masukkan jumlah non-negatif yang valid dengan maksimal 2 angka desimal. | ProjectFormModal |
| `common:projectDetail.header.taxAmount` | Tax amount | Jumlah pajak | ProjectFormModal |
| `common:projectDetail.header.taxTreatment` | Tax treatment | Perlakuan pajak | ProjectFormModal |
| `common:projectForm.client.label` | Client company | Perusahaan klien | ProjectFormModal |
| `common:projectForm.client.noun` | company | perusahaan | ProjectFormModal |
| `common:projectForm.client.required` | Select a client company. | Pilih perusahaan klien. | ProjectFormModal |
| `common:projectForm.client.search` | Search companies… | Cari perusahaan… | ProjectFormModal |
| `common:projectForm.clientCode.label` | Client Project Code | Kode Proyek Klien | ProjectFormModal |
| `common:projectForm.endCustomer.label` | End customer | Pelanggan akhir | ProjectFormModal |
| `common:projectForm.endCustomer.noun` | company | perusahaan | ProjectFormModal |
| `common:projectForm.endCustomer.search` | Search companies… | Cari perusahaan… | ProjectFormModal |
| `common:projectForm.estimatedValue` | Estimated value | Nilai estimasi | ProjectFormModal |
| `common:projectForm.expectedEnd` | Expected end | Perkiraan selesai | ProjectFormModal |
| `common:projectForm.expectedStart` | Expected start | Perkiraan mulai | ProjectFormModal |
| `common:projectForm.name.label` | Project name | Nama proyek | ProjectFormModal |
| `common:projectForm.name.required` | Project name is required. | Nama proyek wajib diisi. | ProjectFormModal |
| `common:projectForm.pm.label` | Project manager | Manajer proyek | ProjectFormModal |
| `common:projectForm.pm.noun` | manager | manajer | ProjectFormModal |
| `common:projectForm.projectNumber.duplicate` | That PMO Project Number is already in use. Choose another number. | Nomor Proyek PMO tersebut sudah digunakan. Pilih nomor lain. | ProjectFormModal |
| `common:projectForm.projectNumber.helper` | PMO assigns this identifier. You can edit it before creating the project. | PMO menetapkan identitas ini. Anda dapat mengubahnya sebelum membuat proyek. | ProjectFormModal |
| `common:projectForm.projectNumber.label` | PMO Project Number | Nomor Proyek PMO | ProjectFormModal |
| `common:projectForm.projectNumber.loading` | Proposing a PMO Project Number… | Mengusulkan Nomor Proyek PMO… | ProjectFormModal |
| `common:projectForm.projectNumber.proposalError` | A PMO Project Number could not be proposed. Select the client again to retry. | Nomor Proyek PMO tidak dapat diusulkan. Pilih klien lagi untuk mencoba ulang. | ProjectFormModal |
| `common:projectForm.projectNumber.segmentRequired` | The selected company needs a Client number segment before a PMO Project Number can be proposed. | Perusahaan yang dipilih memerlukan segmen nomor klien sebelum Nomor Proyek PMO dapat dibuat. | ProjectFormModal |
| `common:projectForm.section.project` | Project | Proyek | ProjectFormModal |
| `common:projectForm.section.schedule` | Schedule | Jadwal | ProjectFormModal |
| `common:projectForm.stage.helper` | On-hand is reached only by winning a project in the pipeline, never created directly. | Status on-hand hanya dicapai dengan memenangkan proyek di pipeline, tidak pernah dibuat langsung. | ProjectFormModal |
| `common:projectForm.stage.label` | Origination stage | Tahap awal | ProjectFormModal |
| `common:projectForm.submit.create` | Create project | Buat proyek | ProjectFormModal |
| `common:projectForm.submit.edit` | Save project | Simpan proyek | ProjectFormModal |
| `common:projectForm.subtitle.create` | Create a project | Buat proyek | ProjectFormModal |
| `common:projectForm.subtitle.edit` | Update the project header details | Perbarui detail header proyek | ProjectFormModal |
| `common:projectForm.taxRequiredHint` | State the tax treatment and the tax amount for this contract value — enter 0 if there is no tax. Without it the work-order drawdown compares this ceiling against order values on an unknown basis. | Nyatakan perlakuan pajak dan jumlah pajak untuk nilai kontrak ini — isi 0 jika tidak ada pajak. Tanpa itu, penyerapan work order membandingkan pagu ini dengan nilai order pada basis yang tidak diketahui. | ProjectFormModal |
| `common:projectForm.title.create` | New project | Proyek baru | ProjectFormModal |
| `common:projectForm.title.edit` | Edit project | Edit proyek | ProjectFormModal |
| `common:projectForm.value.formatError` | Use "{{group}}" to group thousands and "{{decimal}}" for decimals — for example {{example}}. | Gunakan "{{group}}" untuk pemisah ribuan dan "{{decimal}}" untuk desimal — misalnya {{example}}. | ProjectFormModal |
| `common:projectForm.value.helper` | Estimate, pre-win. Editable by Admin, Executive, and PM. | Estimasi, sebelum menang. Dapat diedit oleh Admin, Eksekutif, dan PM. | ProjectFormModal |
| `common:projects.actions.archive` | Archive | Arsipkan | Projects |
| `common:projects.actions.edit` | Edit | Edit | ProjectCard, Projects |
| `common:projects.actions.new` | New project | Proyek baru | Projects |
| `common:projects.atRiskPill` | At risk | Berisiko | Projects |
| `common:projects.calendar.goToday` | Go to today | Ke hari ini | ProjectCalendarView |
| `common:projects.calendar.nextMonth` | Next month | Bulan berikutnya | ProjectCalendarView |
| `common:projects.calendar.noEventsSub` | No project or phase target dates fall in this month. | Tidak ada tanggal target proyek atau fase pada bulan ini. | ProjectCalendarView |
| `common:projects.calendar.noEventsTitle` | No events this month | Tidak ada acara bulan ini | ProjectCalendarView |
| `common:projects.calendar.phaseEventAriaLabel` | {{project}} — Phase: {{phase}} | {{project}} — Fase: {{phase}} | ProjectCalendarView |
| `common:projects.calendar.phaseEventLabel` | {{project}} · {{phase}} | {{project}} · {{phase}} | ProjectCalendarView |
| `common:projects.calendar.previousMonth` | Previous month | Bulan sebelumnya | ProjectCalendarView |
| `common:projects.calendar.today` | Today | Hari ini | ProjectCalendarView |
| `common:projects.card.delivery` | Delivery | Penyelesaian | ProjectCard |
| `common:projects.card.deliveryPercent` | Delivery {{percent}}% | Penyelesaian {{percent}}% | ProjectCard, Projects |
| `common:projects.card.editProject` | Edit {{name}} | Edit {{name}} | ProjectCard |
| `common:projects.columns.actual` | Actual | Realisasi | ProjectCard, Projects |
| `common:projects.columns.budgetUsed` | Budget used | Anggaran terpakai | ProjectCard, Projects |
| `common:projects.columns.contract` | Contract | Kontrak | ProjectCard, Projects |
| `common:projects.columns.pm` | PM | PM | Projects |
| `common:projects.columns.progress` | Progress | Progres | Projects |
| `common:projects.columns.project` | Project | Proyek | Projects |
| `common:projects.columns.status` | Status | Status | Projects |
| `common:projects.confirm.archiveConfirm` | Archive project | Arsipkan proyek | Projects |
| `common:projects.confirm.archiveDescription` | It will be hidden from the default project list. Existing references stay intact. You can restore it later. | Proyek akan disembunyikan dari daftar proyek default. Referensi yang ada tetap utuh. Anda dapat memulihkannya nanti. | Projects |
| `common:projects.confirm.archiveTitle` | Archive project? | Arsipkan proyek ini? | Projects |
| `common:projects.description` | Pre-win projects live in the Pipeline. | Proyek pra-menang ada di Pipeline. | Projects |
| `common:projects.empty.clearFilters` | Clear filters | Hapus filter | Projects |
| `common:projects.empty.noMatchSub` | Try a different status, customer, PM, or search term. | Coba status, klien, PM, atau kata kunci lain. | Projects |
| `common:projects.empty.noMatchTitle` | No projects match these filters | Tidak ada proyek yang cocok dengan filter | Projects |
| `common:projects.empty.nothingAtRiskSub` | No confirmed budget-risk signal is showing. Missing spending or Active budget data can't be assessed. | Belum ada sinyal risiko anggaran yang terkonfirmasi. Data pengeluaran atau Anggaran Aktif yang tidak lengkap belum dapat dinilai. | Projects |
| `common:projects.empty.nothingAtRiskTitle` | Nothing at risk | Tidak ada yang berisiko | Projects |
| `common:projects.export` | Export | Ekspor | Projects |
| `common:projects.filters.all` | All | Semua | Projects |
| `common:projects.filters.allCustomers` | All customers | Semua klien | Projects |
| `common:projects.filters.allEndCustomers` | All end customers | Semua pelanggan akhir | Projects |
| `common:projects.filters.allManagers` | All managers | Semua manajer | Projects |
| `common:projects.filters.ariaLabel` | Status filter | Filter status | Projects |
| `common:projects.filters.atRisk` | At risk | Berisiko | Projects |
| `common:projects.filters.completed` | Completed | Selesai | Projects |
| `common:projects.filters.customerLabel` | Filter by customer | Filter berdasarkan klien | Projects |
| `common:projects.filters.endCustomerLabel` | Filter by end customer | Saring berdasarkan pelanggan akhir | Projects |
| `common:projects.filters.myProjects` | My Projects | Proyek Saya | Projects |
| `common:projects.filters.ongoing` | Ongoing | Berjalan | Projects |
| `common:projects.filters.pmLabel` | Filter by project manager | Filter berdasarkan manajer proyek | Projects |
| `common:projects.identifiers.client` | Client Project Code | Kode Proyek Klien | ProjectCard, ProjectCardShell |
| `common:projects.identifiers.pmo` | PMO Project Number | Nomor Proyek PMO | ProjectCard, ProjectCardShell, Projects |
| `common:projects.import` | Import | Impor | Projects |
| `common:projects.importBudgets` | Import budgets | Impor anggaran | Projects |
| `common:projects.kanban.board` | Projects kanban board | Papan kanban proyek | ProjectKanbanBoard |
| `common:projects.kanban.closeOut` | Close Out | Penutupan | ProjectKanbanBoard |
| `common:projects.kanban.empty` | No projects in {{stage}} | Tidak ada proyek pada tahap {{stage}} | ProjectKanbanBoard |
| `common:projects.kanban.internal` | Internal | Internal | ProjectKanbanBoard |
| `common:projects.kanban.onHold` | On Hold | Ditunda | ProjectKanbanBoard |
| `common:projects.kanban.ongoing` | Ongoing | Berjalan | ProjectKanbanBoard |
| `common:projects.kanban.swipe` | Swipe for more → | Geser untuk melihat lainnya → | ProjectKanbanBoard |
| `common:projects.kanban.won` | Won | Menang | ProjectKanbanBoard |
| `common:projects.mobile.activeCount` | Active filters | Filter aktif | Projects |
| `common:projects.mobile.clearAll` | Clear all | Hapus semua | Projects |
| `common:projects.mobile.customer` | Customer | Klien | Projects |
| `common:projects.mobile.endCustomer` | End customer | Pelanggan akhir | Projects |
| `common:projects.mobile.error` | Couldn't load options | Gagal memuat opsi | Projects |
| `common:projects.mobile.manager` | Project manager | Manajer proyek | Projects |
| `common:projects.mobile.removeCustomer` | Remove customer filter | Hapus filter klien | Projects |
| `common:projects.mobile.removeEndCustomer` | Remove end customer filter | Hapus filter pelanggan akhir | Projects |
| `common:projects.mobile.removeManager` | Remove project manager filter | Hapus filter manajer proyek | Projects |
| `common:projects.mobile.retry` | Retry | Coba lagi | Projects |
| `common:projects.mobile.unavailable` | Unavailable selection | Pilihan tidak tersedia | Projects |
| `common:projects.noPhasesYet` | No phases yet | Belum ada fase | Projects |
| `common:projects.search.ariaLabel` | Search projects | Cari proyek | Projects |
| `common:projects.states.emptySub` | Projects you create or win will appear here. | Proyek yang Anda buat atau menangkan akan muncul di sini. | Projects |
| `common:projects.states.emptyTitle` | No projects yet | Belum ada proyek | Projects |
| `common:projects.states.errorSub` | Something went wrong fetching your projects. | Terjadi kesalahan saat mengambil proyek Anda. | Projects |
| `common:projects.states.errorTitle` | Couldn't load projects | Gagal memuat proyek | Projects |
| `common:projects.title` | Projects | Proyek | Projects |
| `common:projects.toast.archived` | Project archived | Proyek diarsipkan | Projects |
| `common:projects.toast.created` | Project created | Proyek dibuat | ProjectNew |
| `common:projects.toast.updated` | Project updated | Proyek diperbarui | Projects |
| `common:projects.unassigned` | Unassigned | Belum ditugaskan | ProjectCard, ProjectKanbanBoard, Projects |
| `common:projects.unnamedUser` | Unnamed user | Pengguna tanpa nama | ProjectCard, ProjectKanbanBoard, Projects |
| `common:projects.view.ariaLabel` | Projects view | Tampilan proyek | Projects |
| `common:projects.view.board` | Board | Board | Projects |
| `common:projects.view.calendar` | Calendar | Kalender | Projects |
| `common:projects.view.cards` | Cards | Kartu | Projects |
| `common:projects.view.table` | Table | Tabel | Projects |
| `common:tax.fields.base` | Tax base (DPP) | Dasar pengenaan pajak (DPP) | TaxRateFields |
| `common:tax.fields.baseError` | Use a positive fraction no greater than 1, such as 11/12. | Gunakan pecahan positif maksimal 1, seperti 11/12. | TaxRateFields |
| `common:tax.fields.baseHint` | 1 means the full price. For a reduced base, enter a fraction such as 11/12. | 1 berarti harga penuh. Untuk dasar lain, masukkan pecahan seperti 11/12. | TaxRateFields |
| `common:tax.fields.nominalRate` | Nominal tax rate (%) | Tarif pajak nominal (%) | TaxRateFields |
| `common:tax.fields.rateError` | Enter a rate from 0 to 100 with no more than 3 decimal places. | Masukkan tarif 0 sampai 100 dengan maksimal 3 angka desimal. | TaxRateFields |
| `common:tax.fields.rateHint` | Leave blank when the rate is not recorded; enter the tax amount instead. | Kosongkan jika tarif belum dicatat; masukkan nilai pajak. | TaxRateFields |
| `common:uxs02.activeBudget` | Active budget | Anggaran Aktif | ProjectCard |
| `common:uxs02.atRisk` | At risk | Berisiko | ProjectCard |
| `common:uxs02.budgetSummary` | {{actual}} of {{budget}} Active budget | {{actual}} dari anggaran Aktif {{budget}} | Projects |
| `common:uxs02.budgetUsed` | {{percent}}% of Active budget | {{percent}}% dari anggaran Aktif | ProjectCard, Projects |
| `common:uxs02.currencyMismatch` | Budget currency differs from Actual | Mata uang anggaran berbeda dari Aktual | Projects |
| `common:uxs02.incompleteCoverage` | Incomplete source coverage | Cakupan sumber belum lengkap | Projects |
| `common:uxs02.noActiveBudget` | No active budget | Tidak ada anggaran aktif | ProjectCard, Projects |
| `common:uxs02.restrictedRowsExcluded` | Restricted rows excluded | Baris terbatas dikecualikan | Projects |
| `common:uxs02.riskUnavailableSub` | Project spending and Active budget information could not be checked. | Informasi pengeluaran proyek dan anggaran Aktif tidak dapat diperiksa. | Projects |
| `common:uxs02.riskUnavailableTitle` | Couldn't check project budget risk | Risiko anggaran proyek tidak dapat diperiksa | Projects |
| `common:uxs02.unavailable` | Unavailable | Tidak tersedia | ProjectCard, Projects |
| `common:uxs02.zeroActiveBudget` | {{budget}} Active budget; usage unavailable | Anggaran Aktif {{budget}}; pemakaian tidak tersedia | Projects |
| `common:uxs14.contractReference` | Customer contract reference | Referensi kontrak pelanggan | ProjectCard |
| `common:uxs14.filters` | Filters | Filter | Projects |
| `common:uxs14.moreActions` | More actions | Tindakan lainnya | Projects |
| `common:uxs14.projectReferences` | More project references | Referensi proyek lainnya | ProjectCard |
| `common:uxs14.projectReferencesFor` | More project references for {{name}} | Referensi proyek lainnya untuk {{name}} | ProjectCard |
| `projects:actual.restrictedTag` | Restricted excluded | Dikecualikan (terbatas) | Projects |
| `projects:coverage.partial` | Actual is partial on {{partial}} of {{total}} projects. | Aktual belum lengkap pada {{partial}} dari {{total}} proyek. | Projects |
| `projects:coverage.partialUpdated` | Actual is partial on {{partial}} of {{total}} projects. Updated {{date}}. | Aktual belum lengkap pada {{partial}} dari {{total}} proyek. Diperbarui {{date}}. | Projects |
| `projects:create.accessDenied` | You can't create projects | Anda tidak dapat membuat proyek | ProjectNew |
| `projects:create.leave` | Leave | Keluar | ProjectNew |
| `projects:create.stay` | Stay | Tetap di sini | ProjectNew |
| `projects:shortName.duplicate` | Another project already uses this short name | Proyek lain sudah memakai nama singkat ini | ProjectFormModal |
| `projects:shortName.hint` | Shown in lists. Contract name is unchanged. | Tampil di daftar. Nama kontrak tidak berubah. | ProjectFormModal |
| `projects:shortName.label` | Short name (optional) | Nama singkat (opsional) | ProjectFormModal |
