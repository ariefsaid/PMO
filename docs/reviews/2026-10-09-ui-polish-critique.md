⚠️ DEGRADED: single-context (Director-approved fallback; independent critique contexts unavailable).

# PMO Portal — UI polish critique and build plan

**2026-10-09 · single-context critique · `docs/ui-polish-critique` · inspected app revision `1c0503e4`.**

## Five-line verdict

1. Preserve the zinc surfaces, PMO blue, Inter, hairlines, 32px controls, and existing component language; this is not the #806 redesign.
2. The app already feels like an operational ERP; weak glyph semantics and compressed record identities make it feel less deliberately finished.
3. The highest-impact layout problem is the project header: common context crowds the actual tab work out of the first viewport.
4. Prioritize recognizable navigation, readable records, and adjacent next actions over new decoration or wider typography changes.
5. **Fix-then-review; coverage BLOCKED, not a complete visual pass:** the final shared-local-data interruption left several required captures unverified.

**Questions skipped:** the brief fixes scope and authorizes sequential assessment; no palette/font/layout-language decision is reopened. No agents or subordinate workflows were launched. No app changes, data writes, reset, dependency installation, or push were made.

## Top ten fixes, in perceived-quality order

| Order | Fix | Findings |
|---|---|---|
| 1 | Adopt one licensed monoline family; make Projects a project folder, Procurement a cart, and the phone navigation trigger a menu. | UIP-001, UIP-002 |
| 2 | Put project navigation and the selected tab's work immediately after compact identity/context. | UIP-005 |
| 3 | Give project names real column space instead of truncating the first row to a handful of characters. | UIP-003 |
| 4 | Let approval request identities wrap before showing secondary metadata and status. | UIP-008 |
| 5 | Stack mobile record status below the title instead of squeezing the title beside it. | UIP-009 |
| 6 | Align procurement row fields on a stable desktop grid, with a quiet column header. | UIP-007 |
| 7 | Disclose classification filters; keep search and core triage controls immediately available. | UIP-004 |
| 8 | Give contract value one read presentation and one explicit, permission-preserving edit affordance. | UIP-006 |
| 9 | Use compact, explicit clear-queue states in dashboard panels so actual work is not displaced. | UIP-010 |
| 10 | Make PM dashboard exception rows open their canonical project record. | UIP-011 |

Rail/reference type cleanup and the static settings-card shadow are secondary polish, not reasons to redesign the product.

## Rendered evidence and limits

Screenshots are **local review artifacts, not repository attachments**. Preserve them with the Director's review packet before the scratch directory expires. No screenshots containing demo identities are committed here.

`SHOTS` below means:

```text
/private/tmp/claude-502/-Users-ariefsaid-Coding-PMO/abd5a194-c2a4-469e-b763-f2a75f07ec08/scratchpad/ui-critique-shots/
```

The review used `agent-browser` core + dogfood guidance, local Vite, real demo-persona sign-ins, route/tab navigation, account theme controls, the phone drawer, approval preview, and Finance create forms. No monetary or destructive action was submitted. The seeded book included long project names, multiple procurement phases, a vendor-invoiced case with captured documents, approval requests, a meeting, and genuinely empty customer-invoice/receipt lists. This is richer than an empty prototype, but **not populated coverage for every entity**.

| Surface / persona | Usable rendered evidence | Limits / completion work |
|---|---|---|
| Executive dashboard | `dashboard-1440-light.png`; `executive-dashboard-390-light.png`; actual dark dashboard shell also captured as Admin in `dashboard-1440-dark.png`, `dashboard-390-dark.png` | Files `executive-dashboard-1440-dark.png` and `executive-dashboard-390-dark.png` actually show light styling. They are excluded as dark evidence; recapture Executive in dark at both sizes. |
| PM dashboard | `pm-dashboard-{1440,390}-{light,dark}.png` | Four combinations inspected; do not infer quantitative correctness from this visual pass. |
| PM work | `pm-project-tasks-scrolled-1440-light.png`, `pm-approvals-1440-light.png`, `pm-timesheets-1440-light.png` | Broader work surfaces also inspected as Admin; this is not four-persona testing of every route. |
| Finance | `finance-dashboard-{1440,390}-{light,dark}.png`, `finance-approvals-390-light.png`, `finance-invoice-form-{1440,390}-light.png`, `finance-payment-form-390-light.png` | Invoice/receipt lists were empty. Populated lists, validation/error states, and dark forms remain acceptance work. |
| Shell / rail | Expanded rail in desktop route shots; `rail-drawer-390-{light,dark}.png`; closed phone rail in phone route shots | Shipped collapse is the ≤920px hidden rail/drawer, not a desktop icon-only mini-rail. Do not add a new mini-rail for this brief. |
| Projects / pipeline / procurement lists | `projects`, `sales`, `procurement` × `{1440,390}` × `{light,dark}` | These retained captures show real content. Pipeline is directly reachable in the inspected seed even when CRM rail entries are not exposed; no entitlement changes were made. |
| Project detail | `project-detail-1440-light.png`; `project-{budget,procurement,tasks,work-orders,billing,documents,history}-1440-light.png`; `project-tasks-390-{light,dark}.png` | First viewport and PM task-area navigation inspected. `project-tasks-1440-dark.png` is an interruption capture, excluded. Remaining tabs need the full theme/phone sweep. |
| Procurement detail / vendor bill evidence | `vendor-bills-{1440,390}-{light,dark}.png`; `procurement-documents-1440-light.png` | Vendor bill is inspected in the canonical procurement case/documents ledger, not an invented vendor-bills route. Line items, quotes, history also available through that case. |
| Invoices / receipts | `sales-invoices`, `incoming-payments` × `{1440,390}` × `{light,dark}` | Empty-state and form review only; no financial submission. |
| Timesheets / approvals / meetings | `timesheets`, `approvals`, `meetings` × `{1440,390}` × `{light,dark}` | Some phone dark shots show in-page loading rather than settled rows. Rerender those states before accepting a build. Approval previews were also inspected populated on desktop and phone light. |
| Tasks | `my-tasks-1440-{light,dark}.png`, `my-tasks-390-light.png`; populated project Tasks tab context | Admin's own task list is empty. `my-tasks-390-dark.png` is an interrupted loading capture. Do not infer populated task-card polish from an empty list. |
| Admin / settings | `administration-users-1440-{light,dark}.png`, `administration-users-390-light.png`; accounting/integrations/projects/credits desktop dark; `settings-profile-1440-{light,dark}.png`, `settings-profile-390-light.png` | `administration-users-390-dark.png` is unfinished loading; `settings-profile-390-dark.png` is an environment interruption. Recapture. |
| Login | `login-{1440,390}-{light,dark}.png` | Light sign-in drove the personas. Dark login rendering was also inspected via a temporary browser theme class; persistent dark sign-in bootstrap needs a regression test. Demo helpers are local-development content, not a production defect. |
| States | `projects-empty-1440-dark.png` is a real no-match state with Clear filters; Finance and My Tasks genuine empties; some loading frames | Network fault injection was attempted but did not produce the intended projects error. Files named `projects-loading-1440-dark.png` and `projects-error-1440-dark.png` actually show populated content and are excluded. Error-state coverage is not claimed. |

The shared-local-data failure was retried after the requested wait; it persisted at the end. **It is an audit-completion blocker, not a UIP finding.** This report is a bounded critique/plan, not merge approval or an all-states accessibility certificate.

## Sequential assessments

### Lens A — visual / correctness

**Strengths:** restrained token palette; consistent neutral status labels; readable Inter money; sensible card/table borders; phone list transformations; shared modal anatomy. No evidence justifies gradients, new fonts, new accents, or a different radius/elevation system. Existing categorical avatar colors are intentional, not “purple everywhere.”

**Issues:** High — UIP-003; Important/Med — UIP-001/002/006/007/009/010; Minor/Low — UIP-012/013. The first-viewport project problem is also visual hierarchy, but owned below as UIP-005. See the findings table for the exact violated rule and pinned remedy.

**Accessibility/performance scope:** visible keyboard focus was observed on the account control; drawer Escape and named controls were exercised. A targeted axe WCAG A/AA run on settled Projects at 390px returned no violations in light and after a settled dark reload. An immediate theme-switch scan reported transition-frame contrast failures that disappeared on reload; those are **not promoted into a persistent contrast finding**. No full-route axe, contrast, focus-order, zoom, touch-device, reduced-motion, or performance-budget pass is claimed. A 32px desktop-emulated button rectangle alone is not proof of a touch hit-area defect: the app has coarse-pointer target expansion.

### Lens B — interaction / task-flow naturalness

**Strengths:** preview-in-place exists for procurement/approval work; the unified inbox avoids scattered approval destinations; canonical detail pages retain explicit lifecycle controls. The invoice/receipt forms describe payment distinctions instead of pretending paid, received, and withheld amounts are interchangeable.

**Issues:** High — UIP-005/008; Important/Med — UIP-004/006/009. The PM's next task should not require a ceremonial scroll through common financial and milestone context; finding a request should not require expanding every truncated title.

Nielsen-10 friction scoring: 0 = no issue established in observed scope, 1 = cosmetic, 2 = recurring friction, 3 = serious obstruction, 4 = task failure. “Pending” is not a pass.

| Heuristic | Score | Evidence |
|---|---:|---|
| Visibility of system status | 2 | Current project tab work is buried (005); explicit empty-state copy is a strength. |
| Match with users' world | 2 | Chart/card rail metaphors misidentify entities (001/002). |
| User control / freedom | 0 | Drawer closes via Escape; existing back/breadcrumb affordances retained. |
| Consistency / standards | 2 | Glyph collisions and disconnected snapshot rows (001/011). |
| Error prevention | Pending | Write paths deliberately not submitted; existing policy/confirmation behavior must remain unchanged. |
| Recognition over recall | 3 | Heavily clipped project/request identities (003/008). |
| Flexibility / efficiency | 2 | Expanded classification controls slow triage (004). |
| Aesthetic / minimal presentation | 2 | Large clear-queue region above work (010). |
| Error recognition / recovery | Pending | Intended fault-injected error was not rendered. |
| Help / documentation | 0 | Payment distinctions and inline explanations are useful; no additional defect established. |

Persona walkthroughs: Executive scan→exception; PM portfolio→project Tasks and approval preview; Finance dashboard→vendor-invoiced case and invoice/receipt forms; Admin users→configuration/preferences. A fifth keyboard-oriented PM walkthrough and complete write-goal journeys remain acceptance work, not invented evidence.

### Lens C — information architecture / navigation

**Strengths:** one canonical project home, one procurement case with document/history tabs, and distinct personal preferences versus organization configuration. Preserve these URLs, stage-aware Projects/Pipeline navigation, URL-owned filters, and return-to-list behavior. No new entity list or route is proposed.

**Issues:** UIP-002 weakens navigation scent; UIP-005 hides the record's work hierarchy; UIP-011 turns an otherwise coherent project summary into a disconnected destination. No additional list/route overlap or entry-point-dependent rendering defect was established within the inspected routes. Conditional nav items are inventoried below even when not visible in this seed.

### Lens D — product intent / JTBD

**Oracle:** `docs/jtbd.md` §2 and §3, not a reviewer-invented feature wish list. Every proposal below keeps the existing job and interaction paradigm.

| Screen / primary role and job (“When…, I want…, so…”) | Expectation (Q2) | Priority (Q3) | Actionability (Q4) | Consistency (Q5) |
|---|---|---|---|---|
| Executive dashboard: starting the day, see health/exceptions, decide intervention | Portfolio and exceptions belong here | Clear queues should not displace exceptions (010) | Preserve existing Review / exception links | No new dashboard language |
| PM dashboard: checking delivery, identify off-track work, keep projects moving | Project status summary is expected | At-risk rows are already first | Named status rows need a project link (011) | Match clickable project rows elsewhere |
| Projects: scanning work, recognize an off-track project, open it | Row identity + health first | Name loses space to ancillary fields (003); filters dominate (004) | Keep row open and status controls | Preserve Table/Cards/Calendar/Board and return state |
| Project detail: opening a project, see blockers/next action, keep delivery moving | Task/phase work belongs inside the record | Common header dominates selected tab (005/006) | Selected tab and its adjacent lever should be reachable without the common-card scroll | Keep canonical tabs; do not remove milestone actions |
| Pipeline: reviewing opportunities, see stalled deals, advance/de-risk | Board/list and stage controls belong here | Classification stack pushes board below the phone fold (004) | Keep open/advance and the current stage model | Do not move opportunities to a new URL |
| Procurement case, P1/P2/P3: operating a case, see evidence/quotes/budget, move it forward responsibly | Case + documents/quote comparison in one home | Mobile identity uses unnecessary vertical space (009) | Keep document capture, comparison, and budget signal adjacent to their phases | Preview/upload/ledger stay; not an off-page wizard |
| Procurement/approvals, P4: authorizing spend, recognize/preview requests, clear the queue | Preview before drilling in | Request identity must not be lost (008) | Preserve approve/reject/payment confirmation; no authority changes | Do not replace preview with mandatory navigation |
| Timesheets: finishing work/reviewing reports, log/review hours, submit/clear the queue | Entry and review are distinct jobs | No additional issue established from usable captures | Existing entry/preview/review retained | Error/phone dark settled coverage pending |
| My Tasks: starting work, find assigned/due work, choose the next task | Personal assigned-work list is appropriate | Genuine empty Admin list is honest | Populated personal-task outcome not verified | Project Tasks remains the PM oversight surface |
| Meetings: documenting coordination, find the meeting/actions, follow up | Meeting record and task context expected | No additional issue established | No action submitted | No new nav item or task home |
| Invoices/receipts: handling billing/cash, raise a draft/record a receipt, reconcile money | Current shared forms fit the job | Empty-state copy and next action are explicit | Forms opened; money writes not evaluated | Preserve one form paradigm and confirmation gates |
| Admin: onboarding/configuring, manage users/settings, keep organization setup correct | Users/org configuration remain in Administration | No new IA proposal | No role/configuration writes submitted | Personal preferences remain separate |
| Login/preferences: accessing/configuring personal use, sign in/set preferences, use the portal comfortably | Familiar sign-in and preferences form | Static card elevation is unnecessary (012) | Sign-in exercised; preferences not saved | Keep existing type/colors/form language |

**Issues:** High — UIP-005/008; Important/Med — UIP-003/004/009/010/011. Calibration: procurement preview exists and should be retained; a list Calendar is not a defect merely for being on the list when entries open records; the approved concern about analytics/common context burying actionable tabs applies directly to UIP-005. A metric-source reconciliation is **outside this UI-only plan**; do not “fix” financial figures while adjusting layout.

## Detector synthesis — after the design assessment

Impeccable source detection was actually run on `pmo-portal/src/components/shell` and returned `[]`; that narrow result is not an app-wide clearance. The live detector was injected into the Executive dashboard, Projects, and procurement detail in the browser. Its overlay/report ran; no detector-generated source edits were made.

| Detector signal | Disposition |
|---|---|
| 10.5px rail captions; 10px procurement step references | Accepted as UIP-013: known functional text below the existing Label/Overline intent. |
| Small project table metadata; ellipsized procurement breadcrumb | Triage, not automatic removal: tiny identifiers reviewed separately; breadcrumb truncation is intentional when the full record title remains available. Project primary-identity clipping is independently established as 003. |
| Overflow clipping in the fixed viewport shell | Rejected as a finding without a clipped essential control; shell scroll ownership is intentional. |
| Inter called “overused font” | Rejected: Inter is the product's mandated font. |
| Border + broad shadow | Overlay/popover elevation is legitimate. Independently observed static profile-card shadow is 012; do not flatten true overlays. |
| Bounce easing token | Not enough evidence of a rendered janky interaction; no motion finding. Preserve reduced-motion behavior. |

## Icon plan

### Adoption decision

**Recommend Lucide, copied pinned SVG child geometry into `iconPaths.tsx`, preserving `<Icon name=…>` and its public props.** Use one recorded upstream version (proposed baseline `lucide-static@0.468.0`, verified by the builder before extraction), source filenames, and the upstream license/attribution verbatim. Include the distributed ISC notice and any accompanying Feather/MIT attribution in `pmo-portal/public/licenses/lucide-icons.txt`; a comment saying “Lucide-style” is not a license or provenance record.

Why copying rather than `lucide-react`: this app already renders static geometry through a typed facade. Selected child paths avoid an additional runtime component factory and accidentally importing the whole icon catalogue or dynamic resolver. The current `Record<IconName, ReactNode>` registry still ships its selected entries; **copying does not make that registry automatically tree-shaken per use**. Named `lucide-react` imports can also tree-shake well, so this is a bounded-dependency/provenance choice, not an invented measured-kilobyte saving. Builder records production bundle delta before/after; no exact saving is promised.

Rules:

- Preserve 24×24 viewBox, stroke 2, round caps/joins, `currentColor`, no filled alternative family or CSS-filter coloring. Do not enable absolute-stroke-width; preserve existing SVG scaling.
- Keep rail glyphs 17px, normal control glyphs about 15px, existing KPI tile geometry; an icon-family migration is not permission to enlarge controls.
- Preserve decorative `aria-hidden` defaults and explicit accessible names on icon-only controls. An icon does not replace the text label or status string.
- Add descriptive keys for new entity metaphors; keep all 39 existing `IconName` keys as compatibility aliases. `doc`/`file` and `export`/`download` can share geometry without being deleted.
- Split navigation semantics from shared KPI aliases: **do not globally turn `pipe` into a Kanban board** when it also represents weighted-pipeline charts. Use a new `pipeline` key for nav, keeping `pipe` chart-like. Likewise use `projects`/`procurement` in nav while keeping existing aliases compatible until consumers are deliberately mapped.
- Update `Rail.tsx`, `shell/routeMatch.ts`, and `src/hooks/useRecordSearch.ts` together wherever those registries represent the same entity; do not change their role/feature filters or search behavior.
- The production source also contains `components/icons.tsx` with independent 1.5px and 2px vectors. Preserve its named exports as shims over the same facade rather than leaving a second family active. Charts/diagrams and vendor brand marks are not generic UI-icon replacements.
- Add a reproducible selected-icon vendor script/manifest with pinned provenance. No root-font, token, palette, status-color, or lazy stylesheet changes. In particular retain **DD-UI-CSS-1**: do not let a lazy page stylesheet join/reset the global utilities layer.

### Complete `iconPaths` inventory — 39 keys

Paths below are relative to `pmo-portal/`. “Where used” groups the source consumers by function, with concrete lookup anchors; it is not a claim that each consumer was rendered. The scan covered production `.tsx`/`.ts` in app pages, components, hooks, and shell metadata, excluding tests, dependencies, and build output; conditional consumers such as `eye-off` and KPI delta `down` were checked separately.

| Key | Current meaning / where used | Proposed upstream geometry / treatment |
|---|---|---|
| `grid` | Dashboard/Management pack/saved-view rail; `pages/Approvals.tsx` All tab; `ExecutiveDashboard.tsx`, `MobileExecutiveDashboard.tsx`; placeholder state | Keep compatibility geometry `LayoutGrid`; new nav `dashboard` → `LayoutDashboard`, with separate reports/views keys |
| `pipe` | Chart-like pipeline; rail/module/search metadata; Executive pipeline KPI, `RevenueByProject.tsx`, `WinRateCard.tsx` | `ChartNoAxesCombined`; new nav `pipeline` → `SquareKanban` |
| `cart` | Actually a credit-card rectangle; procurement list/detail/approval tab; Executive/Finance spend KPI | `ShoppingCart` compatibility geometry for purchasing/spend; procurement nav uses explicit `procurement`; no automatic change to financial KPI consumers |
| `folder` | Actually a rising chart; Projects rail; Projects/Companies/Contacts/detail related-project empties; `BudgetProjection.tsx`, PM/Executive KPI, IntegrationsView | `FolderKanban`; explicit `projects` entity key; trend-only consumers retain a trend key |
| `clock` | Timesheets rail/approval tab; Timesheets, Engineer dashboard; AssistantPanel history; RecordHistory | `Clock3` |
| `doc` | Companies/Contacts rail/module/search collisions; invoices and expense detail; accounting/Engineer/Finance/StillToInvoice widgets; vendor quotes and project documents | `FileText`; companies/contacts get entity keys |
| `x` | Modal/drawer/toast dismiss; Combobox and timesheet remove; FileCell; AssistantPanel; import wizards; project Tasks/Meetings/AdminUsers clear controls | `X` |
| `plus` | Create/add across entity pages, TimesheetGrid/Combobox, integrations/import-adjacent forms, procurement capture/quotes/lines, project Tasks/Documents/Procurement | `Plus` |
| `help` | `src/components/ui/KPITile.tsx` definition help | `CircleHelp` |
| `up` | Executive/Finance margin; `KPITile.tsx` data-driven positive delta | `ArrowUpRight` |
| `down` | `KPITile.tsx` data-driven negative delta; not absent just because no literal JSX match | `ArrowDownRight` |
| `check` | Approvals and My Tasks nav collision; checkbox/combobox/auth feedback; timesheet approval, task push/status, approval rows, AwaitingApprovalTile, connection status | `Check`; new `approvals` → `ListChecks`, `tasks` → `ListTodo` |
| `lock` | AccessDenied; procurement constraint notices; ProjectDetailHeader/Overview contract-state copy | `LockKeyhole` |
| `alert` | Incident nav/pages; auth/error/validation/confirmation; AccountMenu/TaskPushBadge; PM/mobile risk; integration/import and procurement/pipeline notices | `TriangleAlert` |
| `inbox` | Default ListState; approvals/ProcurementApprovalSection empty; project-detail/Overview and placeholder empties | `Inbox` |
| `refresh` | ListState retry; Combobox retry; TaskPushBadge; AssistantPanel; project/integration/import retries | `RefreshCw` |
| `back` | BackBar; RevenueByProject, invoices/receipts, Timesheets, ManagementPack, AccessDenied/NotFound; ProjectCalendarView | `ArrowLeft` |
| `chev` | Breadcrumb/AccountMenu; KPI drill-in; Combobox/disclosure; HistorySection; procurement/approval previews; Timesheets/calendar/import navigation | `ChevronRight`; existing rotations retained |
| `cal` | Meetings rail/pages; Projects Calendar; ProjectCalendarView; ProjectGantt | `CalendarDays` |
| `dollar` | Incoming Payments/Expenses nav collision; Finance/PM/mobile/Executive money KPI; RevenueByProject/ManagementPack/ProjectBudget | `DollarSign`; dedicated incoming-payment and expense keys |
| `table` | Revenue by Project rail; Projects/SalesPipeline/Procurement view choice; RevenueByProject/ManagementPack | `Table2` |
| `cols` | Board choice in Projects/Procurement; wrongly reused by `shell/ContextBar.tsx` phone menu | `Columns3` for Board; new `menu` → `Menu` for phone nav |
| `cards` | Projects/SalesPipeline view choice; identical geometry to `grid` today | `LayoutGrid` |
| `export` | ExportButton; ManagementPack/BoardPackAction; M365 organization approval outbound action | `Download` compatibility alias; review outbound-action semantics separately |
| `search` | CommandPalette/ContextBar; DataTable and Combobox search | `Search` |
| `bell` | `shell/NotificationBell.tsx` | `Bell` |
| `admin` | Administration rail/module; AdminUsers/AdministrationUsage/AgentCostMetrics; App/impersonation and placeholders | `Settings` |
| `pencil` | ProjectCard; CompanyDetail/ContactDetail edit; AccountMenu preferences | `SquarePen` |
| `trash` | CompanyDetail/ContactDetail and SalesInvoices removal/destructive UI | `Trash2` |
| `upload` | ImportButton/wizards; Procurement imports; FileCell, Composer, receipts, procurement ledger/files | `Upload` |
| `file` | Sales Invoices rail; FileCell; revenue/project reporting; expense receipts and procurement ledger/files; identical to `doc` today | `File` compatibility alias; nav `invoices` → `FileText` |
| `download` | FileCell; receipts and procurement file downloads; identical to `export` today | `Download` compatibility alias |
| `eye` | FileCell/procurement preview; conditional secret reveal in FormFields/AuthInput | `Eye` |
| `eye-off` | Conditional revealed-field toggle in `ui/FormFields.tsx` and `auth/authFormPrimitives.tsx` | `EyeOff` |
| `message` | Rail Assistant; AccountMenu assistant action | `MessageSquare` |
| `sun` | AccountMenu Light theme choice | `Sun` |
| `moon` | AccountMenu Dark theme choice | `Moon` |
| `plug` | My integrations rail; ProjectIntegrationsCard; M365 personal/org cards and IntegrationsView | `Plug` |
| `info` | `src/components/integrations/IntegrationsView.tsx` explanatory notice | `Info` |

Legacy export shims to retain from `components/icons.tsx`: DashboardIcon, ProjectsIcon, ProcurementIcon, TimesheetsIcon, TasksIcon, CompaniesIcon, ReportsIcon, AdminIcon, UserIcon, BuildingOfficeIcon, CalendarDaysIcon, CurrencyDollarIcon, CheckCircleIcon, ClockIcon, PlusIcon, ClipboardDocumentCheckIcon, ChartBarIcon, PencilSquareIcon, TrashIcon, Squares2X2Icon, TableCellsIcon, FunnelIcon, DocumentIcon, CloudArrowUpIcon, EyeIcon. Bind to matching Lucide geometry through the facade; add typed keys for circle-check, user, clipboard-check, chart-column, funnel, cloud-upload as needed. No mass rename of callers is required.

### Every rail entry — proposed metaphor

This includes conditional entries and auxiliary/footer actions, not just items visible in one seed. Existing role/entitlement gates and ordering remain unchanged.

| Entry / destination | Current glyph → proposed key / Lucide glyph | ERP rationale |
|---|---|---|
| Dashboard `/` | `grid` → `dashboard` / LayoutDashboard | Overview panels, not a table/board |
| My integrations `/integrations` | `plug` → `plug` / Plug | Personal connections; no org-configuration conflation |
| Projects `/projects` | chart-shaped `folder` → `projects` / FolderKanban | A structured project/work container |
| Sales Pipeline `/sales` | chart-shaped `pipe` → `pipeline` / SquareKanban | Opportunities progressing through stages |
| Procurement `/procurement` | card-shaped `cart` → `procurement` / ShoppingCart | Purchasing, not customer cash receipt |
| Meetings `/meetings` | `cal` → `cal` / CalendarDays | Scheduled coordination |
| Incidents `/incidents` | `alert` → `alert` / TriangleAlert | Exception/response; retain its text label |
| Sales Invoices `/sales-invoices` | `file` → `invoices` / FileText | Issued financial document |
| Incoming Payments `/incoming-payments` | `dollar` → `payments` / Banknote | Cash receipt distinct from expense claim |
| Revenue by Project `/revenue-by-project` | `table` → `table` / Table2 | Project-by-project financial comparison |
| Management pack `/reports` | `grid` → `reports` / FileSpreadsheet | A reporting artifact, not another dashboard |
| Timesheets `/timesheets` | `clock` → `clock` / Clock3 | Logged time |
| Expenses `/expenses` | `dollar` → `expenses` / Receipt | Claim/receipt, not incoming money |
| Approvals `/approvals` | `check` → `approvals` / ListChecks | A decision queue rather than a completion checkbox |
| My Tasks `/my-tasks` | `check` → `tasks` / ListTodo | Assigned work, distinct from approval authority |
| Companies `/companies` | `doc` → `companies` / Building2 | Organization/account |
| Contacts `/contacts` | `doc` → `contacts` / ContactRound | Person/contact directory, distinct from company |
| My Views saved entries | `grid` → `views` / PanelsTopLeft | Composed view; preserve entry label and view ID navigation; do not invent a Manage views rail entry |
| Assistant (panel action) | `message` → `message` / MessageSquare | Conversation; not a route or a second dashboard |
| Administration `/administration` | `admin` → `admin` / Settings | Organization configuration |
| Conditional Check Administration access `/administration/users` | `admin` → `admin` / Settings | Same configuration destination family; preserve the existing entry condition and label |
| Phone open-navigation trigger | `cols` → `menu` / Menu | Universal drawer entry; reserve columns for Board |

## Findings and deterministic graduation

**High:** impedes a primary recognition/work task. **Med:** recurring friction or coherence drift. **Low:** contained fidelity/maintenance polish. **S:** local presentation change; **M:** component/route coordination. These are relative build scopes, not promises of completion time. Every row needs its test **and** a routes×oracles cell **and** a retained DESIGN/decision note (ADR-0030). Tests below are proposed, not already passing proof.

All screenshot filenames in this table are relative to `SHOTS`. They are preserved before states; no “after” screenshot is fabricated for an unbuilt fix.

| ID | Route / component; screenshot | Defect, affected task, and suggested fix | Severity / effort | Deterministic graduation oracle |
|---|---|---|---|---|
| UIP-001 | Rail, nav/search metadata, icon facade; `before-UIP-001-projects-1440-light.png` | Projects reads as analytics; Procurement as a payment card; several distinct entities reuse document/check/grid metaphors. A user switching modules must repeatedly read labels instead of recognizing stable entities. Adopt the mapped family/keys and bridge legacy exports. Violates DESIGN Icon System's coherent family/semantic intent, not palette. | Med / M | RTL table-driven nav→glyph mapping across roles/features; all 39 keys and legacy exports render 24/2/currentColor correctly; an icon contact-sheet visual baseline at 15/17/24px in both themes. Do not assert only that some SVG exists. |
| UIP-002 | Phone ContextBar; `before-UIP-002-vendor-bills-390-light.png` | Board columns is the navigation-menu trigger. A phone user looking for the drawer encounters a view-mode metaphor. Use `menu`; retain accessible name, focus, Escape and focus return. | Med / S | RTL expects `menu` on named navigation control; Playwright opens drawer, selects a route, closes/reopens with keyboard, and asserts focus return and no page-width overflow. |
| UIP-003 | `/projects`, Projects columns; `before-UIP-003-projects-1440-light.png` | The first at-risk project title collapses to only a few visible characters; multiple other identities ellipsize despite a wide screen. PM/Executive cannot reliably distinguish the intended project. Remove the desktop 16ch choke point, allocate a sensible minimum identity width, allow two readable lines, and keep ancillary columns accessible by bounded table scrolling. Preserve identifiers and money. | High / M | Rich long-name visual baseline at 1440; DOM title container ≥240px on desktop and no single-line truncation class; RTL full accessible name; curated journey opens the intended same-prefix project and returns to unchanged filters. |
| UIP-004 | Projects/Pipeline classification toolbars; `before-UIP-004-sales-390-dark.png` | Five classification controls remain expanded even with no selections; on phone Pipeline the board is pushed below the first screen. A PM triaging stage/health scans setup controls before opportunities. Use a labeled `Classification` disclosure with active count and visible applied-filter summary; preserve core search/status and URL-owned selections. Projects already has phone disclosure: reuse its paradigm rather than inventing another. | Med / M | RTL collapsed/expanded/active-count/clear behavior; existing URL working-set tests remain; visual baseline places first Pipeline card above 844px for the unfiltered seed; back-navigation retains classifications. |
| UIP-005 | All project detail tabs, common header/milestone block; `before-UIP-005-project-tasks-1440-light.png` | At 1440×900, tabs appear around the bottom of the screen and actual Tasks content starts at the lower edge; phone requires more scrolling. PM opening Tasks/Budget/Billing must traverse common phase cards before the selected job. Keep compact name/status and summary, then tabs/work. Put the full actionable milestone strip in Overview; retain a compact phase/blocker summary/link on other tabs. DESIGN hierarchy + JTBD detail Q3/Q4. | High / M | Playwright rich four-phase seed: selected-tab heading and first work row/empty/error string visible without scroll at 1440; tab strip within first 390×844 viewport. Overview phase edit/blocker links still work. Existing tab URLs, role gates, selected-tab focus and list-return tests remain intact. |
| UIP-006 | ProjectDetailHeader contract read/edit strip; `before-UIP-006-project-detail-1440-light.png` | Contract amount/tax context appears in StatTiles and again as a separate read/edit row, inflating common context and making the two presentations compete. Put one explicit contract-edit action next to the metric, opening the existing editor/confirm; show explanation when editing/when relevant, not a second idle read value. Keep permissions, audit, tax basis and all calculations unchanged. DESIGN content-over-containers + JTBD Q3. | Med / S | RTL one idle contract read presentation; each existing authorized/locked edit case, on-won confirm, tax label and unchanged mutation contract still asserted; visual baseline for idle/edit/locked states. No weakening of existing SoD tests. |
| UIP-007 | ProcurementListRow / list frame; `before-UIP-007-procurement-1440-light.png` | Project, requester, amount, age, status and stepper shift horizontally between rows because each row lays out independently. Finance comparing requests cannot scan a stable money/status column. Use one shared desktop column template and a quiet header; retain mobile semantic cards and preview controls. DESIGN table header/numeric alignment. | Med / M | Visual seeded mixed-title/amount/status rows; DOM right edges of amount cells agree within 1px at 1440, headers aligned with those tracks, Inter tabular numbers; phone cards keep labels and preview/open behavior. |
| UIP-008 | Approvals purchase-request rows; `before-UIP-008-approvals-390-light.png` | Request and project names truncate severely beside status/avatar/chevron. PM/Finance trying to decide which request to preview sees incomplete identity. Wrap the request over two lines, give project/ref their own readable metadata row, place status without stealing title width, and preserve preview-in-place. JTBD P4 / recognition over recall. | High / M | RTL full accessible request/project identity; 390px long-name visual baseline; journey expands the intended same-prefix request, sees its amount/evidence and existing decision controls without opening a different record. Preview remains keyboard operable. |
| UIP-009 | Shared RecordHeader / procurement case; `before-UIP-009-vendor-bills-390-light.png` | Long title is confined beside the status and takes four lines. Finance identifying a vendor-invoiced case loses useful vertical space before evidence. At phone width, use a full-width title followed by status/meta; icon may remain beside the first line. Preserve the full title, identifiers and return action. DESIGN responsive hierarchy. | Med / S | Shared RecordHeader RTL anatomy; 390px long-title visual baseline with status on a separate row, no clipped content or horizontal page overflow; project/company/incident/meeting header regression snapshots because the primitive is shared. |
| UIP-010 | Executive/Finance StillToInvoiceCard; `before-UIP-010-finance-dashboard-1440-light.png` | A clear work-order queue uses roughly 280px of height; ready-to-pay/budget work sits below it. Finance starting the day gives space to absence rather than action. Use compact explicit empty-success copy inside dashboard panels, not a full list-page empty illustration; keep the scope “issued work orders.” Do not collapse loading/error into “nothing left.” JTBD overview Q3 and Stated-State Rule. | Med / S | RTL separate loading/error/empty/populated strings; compact empty panel ≤120px at 1440; visual assertion that Ready to pay moves up while remaining adjacent to its record action. Populated table unchanged; no zero substituted for unavailable data. |
| UIP-011 | PMDashboard Project Status; `before-UIP-011-pm-dashboard-1440-light.png` | Project status rows show risk/progress/margin but the name is a plain span. PM identifies a problematic project, then must search the separate list to act. Make the name/row a canonical project link, without adding a competing status mutation. JTBD PM overarching job + project detail Q4. | Med / S | RTL each rendered row has a uniquely named `/projects/:id` link; curated PM journey opens the flagged record from that exact row in one step and returns. Preserve sorting, financial values and role scope. |
| UIP-012 | ProfileSettings static card; `before-UIP-012-settings-profile-1440-light.png` | Resting preferences card uses `shadow-sm` unlike the flat static surfaces around it, giving a routine page a floating-dialog treatment. This is a contained visual-fidelity deviation, not a broken save task. Remove only the static shadow; keep border, card tone, spacing and focus/overlay elevation. DESIGN Flat-By-Default Rule. | Low / S | RTL/computed-style `box-shadow: none` at rest; profile light/dark snapshots and existing preference-save tests unchanged. |
| UIP-013 | Rail overlines + LifecycleStepper references; `before-UIP-013-vendor-bills-1440-light.png` and `before-UIP-001-projects-1440-light.png` | Rail labels are 10.5px and phase document references 10px. The latter are functional evidence IDs that a case operator reads to match documents. Restore rail Overline 11px and reference Label/identifier 12px; preserve tracking, mono only for IDs, and stepper overflow. This is token/readability drift, not an asserted WCAG font-size failure. | Low / S | Computed-font-size assertions 11px rail/12px step references; long-reference stepper snapshots at both viewports/themes; no clipped essential phase action. |

### Deliberate non-findings

- A repeating mobile procurement primary action is an existing reachability pattern (`AC-S6-1`), not automatically a violation because the same action also appears in normal flow. Preserve it and its confirm/policy behavior.
- Empty invoices/receipts repeat a create CTA near the explanation. Both launch the same form; no wrong outcome was established. Do not remove useful empty-state actions merely to reduce a screenshot's blue pixels.
- Persistent breadcrumbs may ellipsize on phone; full record identity must be available in the page header. Fixing UIP-009 does not imply widening the top bar.
- Calendar/Board options and conditional integrations/CRM nav are existing product decisions. This pass does not remove capabilities or turn feature flags on.
- No new loading/error, authentication, financial arithmetic, or performance defect is asserted from interrupted captures or detector hints alone.

## Six bounded FE build slices

**Planning, not build authorization.** Builders start from a stable rich local seed and the signed issue/spec. Use the factory executor routing for ordinary bounded FE slices; if a proposed adjustment actually changes authority, financial mutations or SoD, stop and route it as a Director-dispatched money-path slice. “Sol” = stronger builder; “Luna” = standard builder. Assignments below are recommendations, not dispatched agents.

All application paths below are relative to `pmo-portal/`; scripts and documentation paths are repo-root-relative. New tests explicitly carry the UIP ID in their test titles. Reuse existing owning tests where possible; do not create one end-to-end test for every CSS assertion.

### 1. Recognizable rail and one icon family — Luna

**Findings:** 001, 002, 013. Mostly mechanical once the mappings are approved.

**Exact production files:** `src/components/ui/iconPaths.tsx`, `src/components/ui/icons.tsx`, `components/icons.tsx`, `src/components/shell/Rail.tsx`, `src/components/shell/ContextBar.tsx`, `src/components/shell/routeMatch.ts`, `src/hooks/useRecordSearch.ts`, `src/components/ui/LifecycleStepper.tsx`; new `public/licenses/lucide-icons.txt` and repo `scripts/vendor-ui-icons.mjs` with pinned manifest/provenance.

**Test files:** extend `src/components/ui/__tests__/icons.test.tsx` (create if absent), add `src/components/shell/__tests__/Rail.iconSemantics.test.tsx`; extend existing routeMatch/record-search suites; new curated `e2e/UIP-002-navigation-polish.spec.ts` for drawer/focus and icon contact-sheet snapshots in the existing visual lane.

**Acceptance:** all 39 keys and 25 legacy exports work; every rail metadata mapping agrees for the same entity; no role/feature behavior changes; rail/menu sizes retained; 11/12px caption/ref rules; license shipped; production bundle delta reported without a whole-catalogue dynamic import. No package-lock regeneration is required for copied geometry.

### 2. Triage lists: identity and progressive filters — Sol

**Findings:** 003, 004. Dense columns, URL-owned selections and responsive board/list presentation need coordinated judgment.

**Exact production files:** `pages/Projects.tsx`, `pages/SalesPipeline.tsx`, `components/ProjectClassificationFilters.tsx`. Reuse existing `MobileToolbarDisclosure` rather than changing its global behavior.

**Test files:** extend Projects/SalesPipeline classification and URL-working-set tests; new `pages/__tests__/Projects.polish.test.tsx`, `pages/__tests__/SalesPipeline.polish.test.tsx`; curated `e2e/UIP-003-list-triage-polish.spec.ts` for same-prefix record selection + return state.

**Acceptance:** first project identity gets ≥240px desktop width, title wraps predictably, all ancillary columns remain accessible, numeric alignment retained; classification selections/count/clear persist through record return; unfiltered phone Pipeline exposes a first opportunity within the initial viewport. Do not change entity filtering or stage transitions.

### 3. Project detail: compact common context, immediate work — Sol

**Findings:** 005, 006. Stronger builder because moving the common header must preserve finance-only context, phase interactions and the contract-edit contract.

**Exact production files:** `pages/project-detail/ProjectDetail.tsx`, `pages/project-detail/ProjectDetailHeader.tsx`, `pages/project-detail/MilestoneStrip.tsx`, `pages/project-detail/tabs/OverviewTab.tsx`. Keep `RecordHeader` API changes owned by slice 4; use existing slots/classes here.

**Test files:** extend existing ProjectDetail/ProjectDetailHeader/MilestoneStrip/OverviewTab suites; new `e2e/UIP-005-project-tab-work-fold.spec.ts` using the rich four-phase project and existing role fixtures.

**Acceptance:** tab navigation and selected job appear above fold per 005; full Overview milestone editing/blocker navigation remains; compact phase summary has an adjacent Overview/blocker link; one idle contract read, unchanged explicit edit/confirm; all existing role/SoD/tax/return-state tests retained. No financial calculation or mutation changes.

### 4. Buying/approvals: scan columns and readable phone identity — Sol

**Findings:** 007, 008, 009. Shared header/approval anatomy and policy-sensitive preview/decision placement justify stronger review.

**Exact production files:** `pages/Procurement.tsx`, `pages/procurement/ProcurementListRow.tsx`, `src/components/ui/ApprovalRow.tsx`, `pages/approvals/ProcurementApprovalRow.tsx`, `src/components/ui/RecordHeader.tsx`. Avoid touching `ProcurementDetails.tsx` unless a required presentation prop cannot be passed otherwise; if it becomes necessary, record the added file before build.

**Test files:** extend procurement preview/list tests, ApprovalRow tests, `pages/approvals/__tests__/ProcurementApprovalRow.test.tsx`, and shared RecordHeader tests; new `e2e/UIP-008-request-recognition-polish.spec.ts` for preview of the intended request, not a write journey.

**Acceptance:** aligned desktop requester/value/status columns; numeric right-edge oracle; readable two-line request identity; phone record title/status stack; preview stays inline and accessible. **Preserve** budget signals, capture/upload controls, lifecycle, mobile repeated action, confirmation text and authority checks. Shared-header consumer visual sweep is mandatory.

### 5. Dashboards: compact clear queues and actionable PM rows — Luna

**Findings:** 010, 011. Local presentation and canonical links; do not reconcile monetary sources here.

**Exact production files:** `src/components/dashboard/StillToInvoiceCard.tsx`, `src/components/dashboard/PMDashboard.tsx`. Do not change global ListState height; the compact empty treatment is dashboard-local.

**Test files:** new `src/components/dashboard/__tests__/StillToInvoiceCard.polish.test.tsx`; extend `src/components/dashboard/PMDashboard.test.tsx`; curated PM row-open assertion in the owning dashboard journey, plus empty/error/populated visual snapshots.

**Acceptance:** clear queue ≤120px desktop, all states explicit; correct next panel rises; populated data unaffected; every status-row name opens the matching project in one step; sorting/metrics/scope unchanged.

### 6. Preferences: flat resting elevation — Luna

**Finding:** 012. A small, independent fidelity fix; no additional settings redesign.

**Exact production file:** `pages/ProfileSettings.tsx`.

**Test files:** extend the existing ProfileSettings suite and add the no-rest-shadow assertion; reuse shared visual infrastructure for profile/theme snapshots.

**Acceptance:** border/card surface retained, resting shadow absent, both themes match existing tokens, saved preferences and focus remain intact. This slice can be batched later if the Director prefers fewer tiny PRs; do not inflate it with unproven Finance/login defects.

### Parallelism, overlaps, and gates

- Slices 1–6 have disjoint production-file ownership as written. Slice 3 uses RecordHeader while slice 4 edits it: **API/DOM interaction overlap**, not permission for both builders to edit the file. Keep its props stable and run merged shared-header snapshots.
- Slice 1 changes global glyph rendering; all other slices consume it. Land/freeze mappings first, or defer final visual-baseline approval until slice 1 is integrated. Do not let different branches approve incompatible snapshots.
- Slice 2 changes the classification component shared by Projects/Pipeline only. Slice 4 owns ApprovalRow: its sales-invoice/expense consumers require regression coverage even though those pages are not edited.
- `DESIGN.md`, `docs/decisions.md`, and `docs/qa-portfolio.md` (routes×oracles denominator / Graduation registry) are **Director-owned integration files**, not parallel builder edits. Proposed amendments below are not applied by this documentation task. Merge the ID→oracle→rule retention updates once all slices agree.
- Each slice follows failing-test→implementation→green and all three code reviews. Follow `docs/e2e-parallel-conventions.md` before authoring e2e. Use isolated branches/worktrees; no parallel reset of the shared DB.
- Local final gates: lock-wrapped typecheck and `vitest run --changed origin/dev`, zero-warning lint on touched files, only touched curated e2e through `scripts/e2e-local.sh`/DB lock. No full local suite re-run for this docs critique. CI remains the full-suite merge gate.
- Final Discover rerender: stable rich seed; all four personas, both required sizes and themes, all changed states. Complete the coverage gaps above. Retain reviewed before/after shots, not screenshots taken mid-transition or during another build's reset. No ship assessment until that rerender is clean.

### Routes × oracles graduation cells (proposed integration updates)

| Route/state | Oracle cell to retain in `docs/qa-portfolio.md` and the owning issue/spec matrix | Rule retention |
|---|---|---|
| Role/feature rail + menu | 001/002 mapping RTL + drawer keyboard journey + contact-sheet visuals | Icon-family/semantic rule |
| Rail + procurement step references | 013 computed sizes + long-ref visuals | Functional reference legibility |
| Projects rich long-name list | 003 DOM width/wrap + record selection/return journey | Primary identity over ancillary columns |
| Projects/Pipeline classifications | 004 URL-owned state + count/clear + phone fold | Progressive disclosure without lost selection |
| Project detail all tabs + role states | 005 viewport content + Overview actions; 006 idle/edit/locked anatomy + existing mutation contract | Selected-job-first / one contract read presentation |
| Procurement list mixed rows | 007 amount/header alignment + mobile preview | Stable comparative columns |
| Approvals long names + expanded preview | 008 identity/keyboard preview + intended request selection | Recognition before decision |
| Long record headers / all consumers | 009 responsive anatomy + no overflow | Title/status phone stacking |
| Dashboard loading/error/empty/populated | 010 distinct states + height + next-action placement | Compact clear queue, never silence |
| PM status snapshot rich rows | 011 canonical link + correct-record journey | Adjacent next action |
| Preferences light/dark | 012 computed elevation + existing save tests | Flat-by-default |

## Proposed `DESIGN.md` amendments (not applied)

Targeted additions, not token changes. Insert adjacent to the existing Icon System, Data Table and detail/dashboard guidance. The diff is intentionally additive; it does not invalidate existing role, lifecycle or AA rules.

```diff
--- a/DESIGN.md
+++ b/DESIGN.md
@@ Icon System
+**One licensed geometry family.** UI glyph geometry comes from a pinned Lucide
+release, copied into the typed icon registry with source provenance and the
+distributed license/attributions. `<Icon name=…>` is the public facade; legacy
+named icon exports delegate to it. Do not mix independent 1.5px/2px families.
+Keep 24×24 / stroke 2 / round caps and joins / currentColor. Keep existing
+rendered sizes: about 17px rail, 15px controls; icons remain decorative unless
+explicitly named. Vendor marks and charts are not UI-glyph substitutions.
+
+**Entity semantics stay stable.** Projects uses FolderKanban; Procurement uses
+ShoppingCart; Pipeline uses SquareKanban; Companies Building2; Contacts
+ContactRound; Approvals ListChecks; My Tasks ListTodo; Expenses Receipt;
+Incoming Payments Banknote; Management pack FileSpreadsheet. Use Menu for
+the phone drawer trigger, never the Board/Columns glyph. Rail, Navigate and
+record-search metadata agree for the same entity. Preserve old icon aliases
+until callers are deliberately mapped; do not repurpose financial chart keys
+globally to fix a navigation metaphor.
@@ Typography
+**Functional reference legibility.** Rail overlines use the existing 11px
+Overline token. Action/evidence document IDs in a lifecycle stepper use 12px
+identifier text, not decorative 10px microtype. Mono remains identifier-only.
@@ Data Table
+**Recognition before compression.** Primary record identity gets enough space
+to distinguish same-prefix records before ancillary columns. On the desktop
+Projects table, target a minimum 240px identity region and two readable lines;
+use bounded table scrolling before reducing a name to a few characters.
+Keep full accessible names, numeric comparison alignment and available fields.
+Repeating procurement rows share one column template and aligned headers.
@@ Detail pages
+**Selected-job-first.** Compact common identity/status comes before the tab
+strip; the selected tab's work follows without a mandatory tour of Overview
+cards. Full project phase cards remain actionable in Overview; other tabs
+retain concise phase/blocker context with an adjacent link. Keep existing
+tab URLs, permission gates, confirmations and return-to-list working sets.
+On phone, a long record title uses the available width; status/metadata may
+stack below it instead of forcing the title into a narrow side-by-side column.
+Approval previews keep readable request identity before secondary metadata.
@@ Dashboard states
+**A clear queue is compact, not absent.** A dashboard work panel with no items
+states its exact scope in a compact region (target ≤120px desktop), allowing
+active work below to rise. Loading, error and unavailable states remain
+distinct. A displayed project exception has an adjacent canonical-record
+link; adjusting presentation must not change financial calculations.
```

**Assessment:** findings are actionable within the existing design system; implement and rerender. This committed critique is **not a completed coverage gate** until the named persona/theme/state gaps are resolved. Fixes go to the assigned FE builders; the reviewer has not edited application source.
