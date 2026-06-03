# Baseline Specification: PMO Portal (Reverse-Engineered)

> **Status:** Reverse-engineered baseline of the existing frontend-only prototype. Read-only analysis;
> no source files were modified. All line citations are `file:line` relative to `pmo-portal/`.
> Authored with the **spec-miner** methodology; conforms to house conventions in
> `CLAUDE.md` and `docs/product-expectations.md` (EARS table; `OBS-<MODULE>-###` / `NFR-###` / `AC-###`
> IDs; Given/When/Then for acceptance criteria).
>
> **"Observed" vs "Inferred":** an *observed* requirement is directly evidenced by code (cited). An
> *inferred* requirement is a reasonable design intent the code implies but does not fully implement;
> these are flagged **[INFERRED]**.

---

## 1. Overview

PMO Portal is a single-page web application for a **contract- & project-based organization** that runs
the full delivery lifecycle from sales lead → tender → won → execution → close-out, integrating
financial planning (versioned budgets), procurement workflows, time tracking, and an executive
analytics layer. The prototype is currently framed around an engineering/construction consultancy with
oil-&-gas trappings (offshore locations, BOSIET/H2S certs, an HSE incident register); the production
target is **industry-neutral** (see §8).

It is a **frontend-only prototype**: all data is hard-coded TypeScript in `data/mockData.ts`, there is
**no backend, no persistence, no real authentication, and no authorization enforcement**. "Login" is a
client-side **role-simulation dropdown**. Mutations exist only in component-local React state and are
**lost on navigation or refresh**.

Five MVP modules are depth-covered here — **Auth/roles (mock), Projects, Procurement, Timesheets,
Executive Dashboard** — with survey-level coverage of Tasks/Schedule, Companies, Work Orders, Reports,
Administration, the incident register, and document control.

---

## 2. Architecture

### 2.1 Technology stack
| Concern | Choice | Evidence |
|---|---|---|
| Language | TypeScript ~5.8 | `package.json:43` |
| UI runtime | React 19.1 | `package.json:21-22` |
| Build/dev | Vite 6 | `package.json:45`, `vite.config.ts` |
| Routing | react-router-dom 7 (**HashRouter**) | `App.tsx:3,26` |
| Charts | recharts 3.1 | `package.json:24`, used in dashboards & details |
| Styling | **Tailwind via CDN** (`cdn.tailwindcss.com`) + inline config | `index.html:9-21` |
| Module loading (in `index.html`) | **import-map to `aistudiocdn.com`** for react/router/recharts | `index.html:22-32` |
| Unit test | Vitest 4 + Testing Library + jsdom | `package.json`, `vite.config.ts:16-28` |
| E2E (configured, **no specs yet**) | Playwright | `package.json:18`, `playwright.config.ts` |
| Lint/format | ESLint 10 (typescript-eslint, react-hooks), Prettier | `package.json:27-44` |
| Backend / DB / Auth | **none** | absence; no `supabase`, no `fetch/axios`, no `services/` |

**Notable inconsistency:** `index.html` loads dependencies from a CDN import-map *and* `package.json`
declares them as bundled deps. Vite uses the bundled deps; the import-map is a leftover from the
AI-Studio origin and is dead at build time. `index.html:33` references `/index.css` which **does not
exist** (Tailwind is CDN-injected); Vite warns "`/index.css` doesn't exist at build time".

### 2.2 File / module tree (app source only)
```
pmo-portal/
├── index.html                 # CDN Tailwind config + import-map (legacy); mounts /index.tsx
├── index.tsx                  # React root; StrictMode; MetaMask/ResizeObserver error suppression
├── App.tsx                    # UserProvider → HashRouter → Sidebar+Header+<Routes>
├── types.ts                   # ALL domain types & enums (single source)
├── data/mockData.ts           # ALL seed data (companies, users, projects, procurements, budgets,
│                              #   timesheets, tasks, hseIncidents[dead], projectDocuments)
├── context/UserContext.tsx    # currentUser + switchRole (role simulation)
├── components/
│   ├── Card.tsx               # generic surface
│   ├── Header.tsx             # page title + role-switch dropdown + avatar
│   ├── Sidebar.tsx            # role-filtered nav
│   ├── icons.tsx              # ~25 inline SVG icon components
│   ├── ProjectStatusBadge.tsx · ProcurementStatusBadge.tsx · TimesheetStatusBadge.tsx
│   ├── ProjectKanbanBoard.tsx · SalesKanbanBoard.tsx
│   ├── ProcurementPipeline.tsx        # 3-orientation stepper (horizontal/vertical/compact)
│   └── ProjectPipelineStepper.tsx     # ⚠ DEAD: never imported anywhere
├── pages/
│   ├── ExecutiveDashboard.tsx (395)   # role-branched dashboard (Exec/PM/Finance/Engineer)
│   ├── Projects.tsx (378)             # grid/list/board, tabs, filters, sort
│   ├── ProjectDetails.tsx (1390)      # tabbed: Overview/Budget/Schedule/Timesheets/Procurement/Docs
│   ├── Procurement.tsx (327) · ProcurementDetails.tsx (385)
│   ├── Timesheets.tsx (547)           # weekly matrix + approvals
│   ├── SalesPipeline.tsx (121)
│   └── PlaceholderPage.tsx (23)       # "under construction" for unbuilt routes
└── test/ (render.test.tsx, smoke.test.ts — toolchain smoke only, no app coverage)
```

### 2.3 Component hierarchy (runtime)
```
<App>
 └─ <UserProvider>                 (context: currentUser, switchRole)
     └─ <HashRouter>
         ├─ <Sidebar>              (nav filtered by currentUser.role)
         └─ <Header>               (title from route; role-switch dropdown; avatar)
             └─ <main><Routes>     (one route → one page)
```
Page-level composition of note: `ProjectDetails` is a mega-component that **defines 8+ sub-components in
the same file** (`MetricCard`, `TimelineItem`, `ProcurementDrawer`, `BudgetTabContent`,
`ProcurementTabContent`, `TimesheetsTabContent`, `ScheduleTabContent`+`TaskModal`,
`DocumentStatusBadge`+`DocumentsTabContent`).

### 2.4 Routing map (`App.tsx:32-46`)
| Path | Element | Notes |
|---|---|---|
| `/` | `ExecutiveDashboard` | role-branched view |
| `/projects` | `Projects` | |
| `/projects/:projectId` | `ProjectDetails` | redirects to `/projects` if id not found (`:1210-1212`) |
| `/sales` | `SalesPipeline` | |
| `/procurement` | `Procurement` | |
| `/procurement/:procurementId` | `ProcurementDetails` | redirects to `/procurement` if not found (`:53-55`) |
| `/timesheets` | `Timesheets` | |
| `/tasks` | `PlaceholderPage "Tasks"` | **stub** |
| `/companies` | `PlaceholderPage "Companies"` | **stub** |
| `/work-orders` | `PlaceholderPage "Work Orders"` | **stub** (no sidebar link → unreachable via UI) |
| `/reports` | `PlaceholderPage "Reports"` | **stub** |
| `/administration` | `PlaceholderPage "Administration"` | **stub**; Exec/Admin only in sidebar |
| `*` | `ExecutiveDashboard` | catch-all |

### 2.5 State management
- **Global:** exactly one React Context — `UserContext` (`context/UserContext.tsx`). Holds `currentUser`
  (default = first `Executive`, i.e. Bob, `:16`) and `switchRole(role)` which swaps `currentUser` to the
  first user matching that role (`:18-23`). No persistence; resets to Executive on refresh.
- **Module data:** imported directly from `data/mockData.ts` as ES module constants. Pages read these
  arrays at module scope; there is no store, no fetching, no normalization layer.
- **Local mutation:** several pages copy mock data into `useState` to allow in-session edits
  (`ProcurementDetails` deep-clones via `JSON.parse(JSON.stringify(...))` `:43-46`; `Timesheets` seeds
  from mock arrays `:33-34`; `ScheduleTabContent` and `DocumentsTabContent` seed local copies). These
  mutations **never write back** to `mockData.ts` and are discarded on unmount/navigation.

---

## 3. Complete data flow

```
data/mockData.ts (ES module const arrays)
        │  import (module scope, read-only)
        ▼
 Pages / sub-components ──read── currentUser ◄── UserContext (useUser)
        │
        ├─ READ-ONLY consumers (recompute on every render):
        │    ExecutiveDashboard, Projects, SalesPipeline, Procurement (list),
        │    ProjectDetails Overview/Budget/Timesheets tabs
        │
        └─ LOCAL-MUTABLE consumers (useState copy; lost on unmount):
             ProcurementDetails  → clone, select-quote mutates clone
             Timesheets          → allTimesheets/allEntries/uiRows state
             ScheduleTabContent  → tasks state (add/edit/delete)
             DocumentsTabContent → docs state (mock upload)
```

**Key properties of the data layer:**
- **No persistence.** All writes are ephemeral component state. There is no localStorage, no API, no DB.
  (`ProcurementDetails:42` literally comments "Initialize state from mock data to allow local mutation
  for the demo".)
- **Relationships are resolved by `.find()` at render time** — there are no foreign-key joins or maps.
  Examples: `companies.find(c => c.id === project.clientId)`, `users.find(u => u.id === ...)`. This is
  O(n) per lookup, repeated per row (see §9 perf findings).
- **Identity types are inconsistent:** `Company.id`, `User.id` are **numbers**; `Project.id`,
  `Procurement.id`, etc. are **strings** (`types.ts`). Cross-references use both.
- **Derived/aggregated values** (KPIs, margins, weighted pipeline, budget utilization) are computed
  inline in render, not memoized except where `useMemo` is explicitly used (Projects, Timesheets).
- **No auth/RLS/tenancy.** There is no `org_id`, no user→tenant scoping, no permission checks at the
  data layer. Role only affects which nav items render and which dashboard variant shows.

---

## 4. Domain model

Source: `types.ts`. Entities, key fields, relationships, and state machines below.

### 4.1 Entities & relationships
| Entity | Key fields | Relationships |
|---|---|---|
| `Company` (`:22-26`) | `id:number`, `name`, `type:CompanyType` | parent of clients/vendors referenced by Project/Procurement |
| `User` (`:36-48`) | `id:number`, `name`, `email`, `avatarUrl`, `companyId→Company`, `role:UserRole`, **`title?`**, **`location?`** (O&G enum), **`certifications?:string[]`** (O&G), **`utilization?`** | belongs to a Company |
| `Project` (`:50-62`) | `id:string`, `name`, `status:ProjectStatus`, `clientId→Company`, `projectManagerId→User`, `contractValue`, `budget`, `spent`, `startDate`, `endDate`, `lastUpdate` | 1 client, 1 PM; parent of budgets/tasks/procurements/timesheet entries/docs |
| `Kpi` (`:64-70`) | view-model only (`title/value/change/...`) | dashboard display |
| `Procurement` (`:115-129`) | `id:string`, `title`, `projectId?→Project`, `requestedById→User`, `status:ProcurementStatus`, `totalValue`, `vendorId?→Company`, `createdAt`, `items[]`, `quotations[]`, `documents[]` | child tables embedded inline |
| `ProcurementItem` (`:87-94`) | `id`,`name`,`description`,`quantity`,`rate`,`amount` | child of Procurement |
| `ProcurementQuotation` (`:96-104`) | `id`,`vendorId→Company`,`reference`,`totalAmount`,`receivedDate`,`isSelected`,`fileUrl?` | child of Procurement |
| `ProcurementDocument` (`:106-113`) | `id`,`type`(7-value union),`referenceNumber`,`status:string`(free-text),`date`,`link?` | child of Procurement |
| `BudgetVersion` (`:141-148`) | `id`,`projectId→Project`,`version:number`,`name`,`createdAt`,`status:'Draft'|'Active'|'Archived'` | versioned budget header |
| `BudgetLineItem` (`:150-157`) | `id`,`budgetVersionId→BudgetVersion`,`category:BudgetCategory`,`description`,`budgetedAmount`,`actualAmount` | child of a version |
| `Timesheet` (`:175-183`) | `id`,`userId→User`,`weekStartDate`(Mon),`status:TimesheetStatus`,`submittedAt?`,`approvedBy?→User`,`approvedAt?` | weekly per user |
| `TimesheetEntry` (`:166-173`) | `id`,`timesheetId→Timesheet`,`projectId→Project`,`date`,`hours`,`notes` | day×project line |
| `Task` (`:192-201`) | `id`,`projectId→Project`,`name`,`startDate`,`endDate`,`assigneeId→User`,`status:TaskStatus`,`dependencies:string[]`(self-ref) | Gantt node w/ predecessors |
| `HSEIncident` (`:212-221`) **[O&G]** | `id`,`date`,`type`(5-value),`severity:IncidentSeverity`,`location:string`,`description`,`status`('Open'/'Investigating'/'Closed'),`reportedBy:string` | standalone register; **data is dead (never rendered)** |
| `ProjectDocument` (`:223-233`) | `id`,`projectId→Project`,`code`,`category`(5-value),`title`,`revision`,`status`(5-value),`date`,`author:string` | document control |

### 4.2 Enums & state machines

**`UserRole`** (`:28-34`): Executive · ProjectManager · Finance · Engineer · Admin.

**`CompanyType`** (`:16-20`): Internal · Client · Vendor.

**`ProjectStatus` pipeline** (`:2-14`) — the sales→delivery lifecycle. The canonical happy-path order
observed across `ProjectPipelineStepper`, `SalesPipeline`, and `Projects` tab grouping:
```
Leads → PQ Submitted → Quotation Submitted → Tender Submitted → Negotiation → Won, Pending KoM
        → Ongoing Project → (On Hold) → Close Out
Terminal/side states:  Loss Tender   |   Internal Project
```
- `Negotiation` and `On Hold` are annotated `// Added recommendation` and **have no mock-data rows**
  (no project uses them) — enum present, behavior unexercised.
- Win-probability weights are attached to sales stages in `SalesPipeline.tsx:23-30` and
  `SalesKanbanBoard.tsx:18-51`: Leads .1 / PQ .2 / Quotation .4 / Tender .6 / Negotiation .8 / Won 1.0.

**`ProcurementStatus` lifecycle** (`:73-85`, annotated "ADR-002: Unified Procurement Lifecycle"). Ordered
steps (from `ProcurementPipeline.tsx:14-24`, `Procurement.tsx:75-90`, `ProjectDetails.tsx:390-400`):
```
Draft → Requested → Approved → Vendor Quoted → Quote Selected → Ordered → Received
       → Vendor Invoiced → Paid
Terminal: Rejected | Cancelled   (rendered as 100% / red)
```
- Status-driven UI: the "Smart Action Bar" in `ProcurementDetails.tsx:94-143` maps each status to the
  next available action button (Requested→Approve/Reject, Approved→Request Quotes, VendorQuoted→Compare &
  Select, QuoteSelected→Generate PO, Ordered→Receive Goods).
- Mock data only exercises **Requested, VendorQuoted, Ordered, Received, Paid**; Draft, Approved,
  QuoteSelected, VendorInvoiced, Rejected, Cancelled appear in enums/UI logic but have **no seed rows**.

**`BudgetCategory`** (`:131-139`): Labor · Materials · Subcontractors · Equipment · Permits & Fees ·
Overheads · Contingency.

**`TimesheetStatus`** (`:159-164`): Draft → Submitted → Approved | Rejected. Transition logic in
`Timesheets.tsx` (submit `:188-200`; approve/reject `:222-229`).

**`TaskStatus`** (`:185-190`): To Do · In Progress · Done · Blocked. Drives Gantt bar color
(`ProjectDetails.tsx:925-928`).

**`IncidentSeverity`** (`:205-210`) **[O&G-adjacent]**: Low · Medium · High · Critical.

---

## 5. Observed functional requirements (EARS)

> Module prefixes: **AUTH, PROJ, PROC, TIME, DASH, SALES, SCHED, DOC, NAV**.
> Each item cites code. **[INFERRED]** = design intent not fully implemented.

### 5.1 Auth & Roles (currently mock) — `OBS-AUTH-*`
| ID | Requirement | Evidence |
|---|---|---|
| OBS-AUTH-001 | On first load the system shall set the current user to the first user whose role is Executive. | `UserContext.tsx:16` |
| OBS-AUTH-002 | When the user selects a role from the Header role-switch dropdown, the system shall replace the current user with the first user holding that role. | `Header.tsx:37-45`, `UserContext.tsx:18-23` |
| OBS-AUTH-003 | The role-switch dropdown shall list all `UserRole` values **except `Admin`**. | `Header.tsx:37` (`.filter(r => r !== UserRole.Admin)`) |
| OBS-AUTH-004 | While no real credentials exist, the system shall grant full client-side access; there is no login screen, session token, or authorization check. | absence across codebase |
| OBS-AUTH-005 | If `useUser` is called outside `UserProvider`, the system shall throw `"useUser must be used within a UserProvider"`. | `UserContext.tsx:34` |
| OBS-AUTH-006 | The system shall persist no session state; on refresh the current user shall reset to Executive. | `useState` default, no persistence |

### 5.2 Navigation & shell — `OBS-NAV-*`
| ID | Requirement | Evidence |
|---|---|---|
| OBS-NAV-001 | The system shall render sidebar nav items filtered by the current user's role. | `Sidebar.tsx:17-31` |
| OBS-NAV-002 | While the current user's role is Executive or Admin, the system shall render an Administration nav link. | `Sidebar.tsx:77-90` |
| OBS-NAV-003 | The system shall use hash-based routing (`HashRouter`). | `App.tsx:26` |
| OBS-NAV-004 | When the viewport width is < 1024px and a nav link is clicked, the system shall close the mobile sidebar. | `Sidebar.tsx:35-39` |
| OBS-NAV-005 | When the route is unknown, the system shall render the Executive Dashboard (catch-all). | `App.tsx:45` |
| OBS-NAV-006 | The system shall derive the header page title from the current pathname. | `Header.tsx:12-18` |
| OBS-NAV-007 | When the OS prefers dark color scheme, the system shall add the `dark` class to `<html>`. | `App.tsx:18-22` |

> Note: nav role-gating (OBS-NAV-001/002) is **cosmetic only** — routes remain directly reachable by URL
> regardless of role; there is no route guard.

### 5.3 Projects — `OBS-PROJ-*`
| ID | Requirement | Evidence |
|---|---|---|
| OBS-PROJ-001 | The system shall list all projects in Grid, List, or Board view modes, defaulting to Grid. | `Projects.tsx:33,144-267` |
| OBS-PROJ-002 | The system shall provide tabs All / My Projects / Ongoing / Leads / Completed, each grouping specific `ProjectStatus` sets, with live counts. | `Projects.tsx:47-67,136-142` |
| OBS-PROJ-003 | When the "My Projects" tab is active, the system shall filter to projects where `projectManagerId === currentUser.id`. | `Projects.tsx:48-50` |
| OBS-PROJ-004 | The system shall filter projects by client and by project manager via dropdowns. | `Projects.tsx:70-75,346-353` |
| OBS-PROJ-005 | The system shall search projects by name or id (case-insensitive). | `Projects.tsx:78-83` |
| OBS-PROJ-006 | When a List-view column header is clicked, the system shall sort ascending, then descending on repeat. | `Projects.tsx:88-110,239` |
| OBS-PROJ-007 | The system shall render a budget-utilization progress bar per project (`spent/budget`), flagging >100% in red. | `Projects.tsx:155,205-214` |
| OBS-PROJ-008 | When a project card/row is clicked, the system shall navigate to `/projects/:id`. | `Projects.tsx:161,250` |
| OBS-PROJ-009 | When no projects match filters, the system shall show an empty state with a "Clear all filters" action. | `Projects.tsx:360-373` |
| OBS-PROJ-010 | The Board view shall group projects into Leads&PQ / Tendering / Closing / Execution / Closed columns with per-column count and total value. | `ProjectKanbanBoard.tsx:16-60` |
| OBS-PROJ-011 **[INFERRED]** | "New Project" shall create a project. | `Projects.tsx:301-304` — button has **no handler** (non-functional). |

#### Project Details — `OBS-PROJ-DETAIL-*`
| ID | Requirement | Evidence |
|---|---|---|
| OBS-PROJ-020 | When `:projectId` matches no project, the system shall redirect to `/projects`. | `ProjectDetails.tsx:1210-1212` |
| OBS-PROJ-021 | The system shall present tabs: Overview, Budget, Schedule, Timesheets, Procurement, Documents. | `:1231` |
| OBS-PROJ-022 | The Overview tab shall show Contract Value, Budget, Spent, and Gross Margin % metrics and a task-completion progress bar. | `:1222-1229,1355-1361` |
| OBS-PROJ-023 | The Budget tab shall select among the project's budget versions (defaulting to the Active version) and display line items with budgeted/actual/variance and a category pie chart. | `:1214-1217,227-346` |
| OBS-PROJ-024 | While a non-Active budget version is selected, the system shall show a warning banner. | `:277-281` |
| OBS-PROJ-025 | The Procurement tab shall list the project's procurements with a lifecycle progress bar and open a slide-over drawer on click. | `:349-596` |
| OBS-PROJ-026 | The Documents tab shall filter by category and search, and a mock "Upload" shall prepend a Draft document to local state. | `:1072-1200` |
| OBS-PROJ-027 **[INFERRED]** | "Edit Project"/"Actions" shall edit the project. | `:1350-1351` buttons have **no handlers**. |

### 5.4 Schedule / Tasks (Gantt) — `OBS-SCHED-*`
| ID | Requirement | Evidence |
|---|---|---|
| OBS-SCHED-001 | The Schedule tab shall render a split task-list + Gantt chart for the project's tasks, sorted by start date. | `ProjectDetails.tsx:661-951,679-681` |
| OBS-SCHED-002 | The system shall support Day/Week/Month zoom by varying day-column width. | `:665,670-677` |
| OBS-SCHED-003 | The system shall draw SVG dependency arrows between predecessor and successor task bars. | `:714-750,907-915` |
| OBS-SCHED-004 | The system shall add, edit, and delete tasks in local state via a modal (name, dates, status, assignee, dependencies). | `:753-783,961-1052` |
| OBS-SCHED-005 | Task bar color shall reflect status (Done green / InProgress blue / Blocked red / else gray). | `:925-928` |

### 5.5 Procurement — `OBS-PROC-*`
| ID | Requirement | Evidence |
|---|---|---|
| OBS-PROC-001 | The system shall list procurements in Grid or List view with a lifecycle progress %. | `Procurement.tsx:75-91,173-280` |
| OBS-PROC-002 | The system shall provide tabs My Requests (default) / To Approve / Active Orders / All, with counts. | `Procurement.tsx:21,31-52,68-73` |
| OBS-PROC-003 | The "To Approve" tab shall show procurements in `Requested` status; "Active Orders" shall show Ordered/Received/VendorInvoiced. | `Procurement.tsx:35-47` |
| OBS-PROC-004 | The system shall search procurements by title or id. | `Procurement.tsx:55-60` |
| OBS-PROC-005 | Lifecycle progress % shall be computed from the procurement's index in the 9-step pipeline; Rejected/Cancelled shall read 100%. | `Procurement.tsx:75-91` |
| OBS-PROC-006 | When a procurement is clicked, the system shall navigate to `/procurement/:id`. | `Procurement.tsx:183,261` |
| OBS-PROC-007 | "New Request" shall open a **placeholder modal** that performs no creation. | `Procurement.tsx:128,300-322` |
| OBS-PROC-008 | When `:procurementId` matches nothing, the system shall redirect to `/procurement`. | `ProcurementDetails.tsx:53-55` |
| OBS-PROC-009 | Procurement Details shall deep-clone the source record into local state so edits don't mutate shared mock data. | `ProcurementDetails.tsx:43-51` |
| OBS-PROC-010 | The system shall render the full lifecycle stepper and a status-driven "Smart Action Bar" (next-step buttons). | `ProcurementDetails.tsx:94-143,176` |
| OBS-PROC-011 | When the user selects a vendor quotation (after confirm), the system shall mark it selected, set status to `Quote Selected`, and copy that quote's `vendorId` and `totalAmount` onto the procurement. | `ProcurementDetails.tsx:62-83` |
| OBS-PROC-012 | The Worksheet tab shall hide the quotations section while status is Draft or Requested. | `ProcurementDetails.tsx:266` |
| OBS-PROC-013 | The Documents tab shall list the procurement's document chain sorted newest-first. | `ProcurementDetails.tsx:334-362,339` |
| OBS-PROC-014 **[INFERRED]** | Approve/Reject/Request Quotes/Generate PO/Receive Goods actions shall advance the lifecycle. | `:99-135` — buttons have **no handlers** except quote-select. |
| OBS-PROC-015 **[INFERRED]** | The History tab shall show an audit log. | `:364-377` — placeholder only. |

### 5.6 Timesheets — `OBS-TIME-*`
| ID | Requirement | Evidence |
|---|---|---|
| OBS-TIME-001 | The system shall hard-code the current timesheet user to id 1 (Alice), **ignoring `UserContext`**. | `Timesheets.tsx:20,30` |
| OBS-TIME-002 | The system shall render a weekly Mon–Sun matrix (project × day) with editable hour cells while the timesheet is Draft. | `Timesheets.tsx:9-13,45-49,288-429` |
| OBS-TIME-003 | The system shall navigate prev/next week and jump to today. | `:93-107,246-257` |
| OBS-TIME-004 | When a week has no timesheet, the system shall synthesize a Draft timesheet for that week. | `:51-62` |
| OBS-TIME-005 | The system shall add line-item rows by selecting a project (excluding CloseOut/Loss projects) and edit per-row task notes. | `:109-117,385-405,397-401` |
| OBS-TIME-006 | When an hours cell changes, the system shall create/update/skip the matching `TimesheetEntry` (skipping creation for 0 hours). | `:149-186` |
| OBS-TIME-007 | The system shall compute per-row totals, per-day totals, weekly total, and a 40h utilization bar. | `:202-203,312-314,410-423` |
| OBS-TIME-008 | When "Submit Timesheet" is confirmed, the system shall set status Submitted with `submittedAt`; submit shall be disabled at 0 hours. | `:188-200,274-282` |
| OBS-TIME-009 | While the current user manages any project, the system shall show an Approvals tab listing submitted timesheets with total and manager-relevant hours. | `:31,206-220,440-516` |
| OBS-TIME-010 | When a manager approves/rejects a submission, the system shall set the new status, `approvedBy`, and `approvedAt` in local state. | `:222-229,498-499` |

### 5.7 Executive Dashboard — `OBS-DASH-*`
| ID | Requirement | Evidence |
|---|---|---|
| OBS-DASH-001 | The system shall render a different dashboard per role: Engineer, ProjectManager, Finance, else Executive (Admin→Executive). | `ExecutiveDashboard.tsx:382-393` |
| OBS-DASH-002 | The Executive view shall show KPIs (Active Projects, Total Contract Value of Ongoing, Avg Gross Margin, Projects at Risk), a status-pipeline bar chart, a YTD performance line chart, and a Top-Projects-by-value table. | `:272-378` |
| OBS-DASH-003 | The Engineer view shall show the engineer's task counts and a weekly-hours chart. | `:26-98` |
| OBS-DASH-004 | The PM view shall show the PM's projects, total contract value, pending approvals, budget-health chart, and per-project margin. | `:100-175` |
| OBS-DASH-005 | The Finance view shall show contracted revenue, total spend, procurement total, outstanding invoices, a cost-distribution pie, and top-5-by-spend. | `:177-266` |
| OBS-DASH-006 | The Executive Avg Gross Margin shall be computed from `(budget - spent)/budget` averaged over Ongoing projects. | `:275-277` |
| OBS-DASH-007 **[INFERRED — hard-coded]** | Several dashboard figures are static placeholders: "Projects at Risk" = "3", KPI deltas ("+2","+5.2%"), Engineer "Hours This Week" = 40.5, PM pending counts (3+2), Finance cost-distribution split (40/35/15/10%), and the YTD performance series. | `:33-37,53,105-106,184-189,280-298` |

### 5.8 Sales Pipeline — `OBS-SALES-*`
| ID | Requirement | Evidence |
|---|---|---|
| OBS-SALES-001 | The system shall show only sales-stage projects (Leads→Negotiation + WonPendingKoM) on the pipeline board. | `SalesPipeline.tsx:13-20` |
| OBS-SALES-002 | The system shall compute Total Pipeline Value, probability-Weighted Forecast, Active Deals count + avg size, and Historical Win Rate. | `SalesPipeline.tsx:33-51` |
| OBS-SALES-003 | Win rate shall count Won/Ongoing/CloseOut as "won" and Loss as "lost" across ALL projects. | `SalesPipeline.tsx:44-47` |
| OBS-SALES-004 | The Kanban board shall show one column per sales stage with total and weighted value. | `SalesKanbanBoard.tsx:58-81` |
| OBS-SALES-005 **[INFERRED]** | "Add Lead" shall create a lead. | `SalesPipeline.tsx:64-67` — no handler. |

### 5.9 Document control — `OBS-DOC-*`
Covered as OBS-PROJ-026; the entity supports RFI/Transmittal/Submittal/Drawing/Specification categories,
revisions, and Draft/Issued/Approved/Rejected/Closed statuses (`types.ts:223-233`). Upload is mocked
(`ProjectDetails.tsx:1087-1101`); no real file handling.

### 5.10 Survey-level / stub modules
- **Tasks** (`/tasks`), **Companies** (`/companies`), **Work Orders** (`/work-orders`), **Reports**
  (`/reports`), **Administration** (`/administration`): all render `PlaceholderPage` "under
  construction" (`PlaceholderPage.tsx`). Work Orders has a route but **no sidebar link** (unreachable in
  UI). Tasks exist as data and are managed inside Project Details → Schedule, not via `/tasks`.
- **Incident register (`HSEIncident`)**: typed and seeded (`mockData.ts:367-371`) but **never imported
  or rendered** — fully dead.

---

## 6. Non-functional observations (`NFR-###`)

| ID | Category | Observation | Evidence |
|---|---|---|---|
| NFR-001 | Persistence | No durable storage; all state is in-memory and lost on reload/navigation. | architecture |
| NFR-002 | Security | No authentication, authorization, session, or transport security; role is client-only and bypassable by URL. | OBS-AUTH-004, OBS-NAV-001 |
| NFR-003 | Tenancy | No `org_id` / multi-tenant seam anywhere; charter requires one for production. | `types.ts` (absent) |
| NFR-004 | Performance | Production build is a **single 804.51 KB JS chunk** (227 KB gzip); no code-splitting/lazy routes; recharts bundled eagerly. Vite emits the >500 KB warning. | `npm run build` output |
| NFR-005 | Accessibility | Partial: some `aria-*`/`role`/`sr-only` (drawers, dialogs) but many clickable `<div>`s (cards, table rows) lack keyboard/`role=button` semantics. | `Projects.tsx:159-161`, `ProcurementDetails:284` |
| NFR-006 | Responsiveness | Tailwind responsive classes throughout; mobile sidebar drawer; horizontal-scroll tables. | `Sidebar.tsx`, pages |
| NFR-007 | i18n / currency | Currency hard-coded to **USD** via `Intl.NumberFormat('en-US', … 'USD')`, duplicated in ~7 files. | `Projects.tsx:117`, `ExecutiveDashboard.tsx:24`, etc. |
| NFR-008 | Error handling | Minimal: not-found detail routes redirect; no error boundaries, no loading/error/empty states for async (there is no async). MetaMask/ResizeObserver errors are suppressed globally. | `index.tsx:6-25` |
| NFR-009 | Testing | Only 2 toolchain smoke tests; **zero app behavior coverage**; no `e2e/` specs despite Playwright config. | `test/*`, no `e2e/` |
| NFR-010 | Lint health | `npx eslint .` → **21 errors + 3 warnings (24 problems)**; CI gate is `--max-warnings=0`, so the build is currently un-shippable under house policy. | lint run |
| NFR-011 | Type safety | `status` on `ProcurementDocument` is free-text `string` (not an enum), weakening the document state machine. | `types.ts:110` |
| NFR-012 | Build provenance | `index.html` carries a dead CDN import-map and references a non-existent `/index.css`; Tailwind loaded via CDN `<script>` (not viable for production CSP/perf). | `index.html` |

---

## 7. Inferred acceptance criteria (Given/When/Then) — `AC-###`

> These seed the BDD layer; each should map 1:1 to `e2e/<AC-id>.spec.ts`. Written against current
> observed behavior (the production system will re-derive these against real auth/persistence).

**AC-001 — Role simulation switches dashboard** (OBS-AUTH-002, OBS-DASH-001)
Given the app loaded as Executive
When I open the role dropdown and select "Finance"
Then the header shows "Finance" and the dashboard shows the Finance KPIs (Total Contracted Revenue, Total Project Spend).

**AC-002 — Admin hidden from role switcher** (OBS-AUTH-003)
Given the role dropdown is open
When I read its options
Then "Admin" is not listed.

**AC-003 — Sidebar reflects role** (OBS-NAV-001/002)
Given I am simulating the Engineer role
When I view the sidebar
Then "Sales Pipeline" and "Procurement" links are hidden and "Tasks" is shown; "Administration" is hidden.

**AC-004 — Project tab filtering** (OBS-PROJ-002/003)
Given I am on /projects as Alice (PM)
When I click the "My Projects" tab
Then only projects with projectManagerId = Alice's id are listed and the tab count matches.

**AC-005 — Project search** (OBS-PROJ-005)
Given I am on /projects
When I type "Quantum" in the search box
Then only projects whose name or id contains "quantum" (case-insensitive) remain.

**AC-006 — Open project details** (OBS-PROJ-008)
Given the /projects grid
When I click the "Innovate Corp Tower" card
Then the URL becomes /projects/P001 and the details header shows "Innovate Corp Tower".

**AC-007 — Unknown project redirects** (OBS-PROJ-020)
Given I navigate to /projects/NOPE
Then I am redirected to /projects.

**AC-008 — Budget version switch warns on non-active** (OBS-PROJ-023/024)
Given /projects/P001 → Budget tab (Active version V2 shown)
When I select the Archived "Initial Budget (V1)"
Then a warning banner "viewing an archived version" appears and the line items update.

**AC-009 — Select procurement quote advances status** (OBS-PROC-011)
Given /procurement/PROC-2024-004 (Vendor Quoted) on the Worksheet tab
When I click "Select" on the Synergy Supplies quote and confirm
Then that quote is marked Selected, status becomes "Quote Selected", and Total Value updates to that quote's amount.

**AC-010 — Quotations hidden before approval** (OBS-PROC-012)
Given a procurement in "Requested" status
When I open its Worksheet tab
Then the Vendor Quotations section is not rendered.

**AC-011 — Timesheet submit transitions and locks** (OBS-TIME-008)
Given a Draft week with > 0 logged hours
When I click "Submit Timesheet" and confirm
Then the status badge becomes "Submitted" and hour cells become read-only.

**AC-012 — Submit disabled at zero hours** (OBS-TIME-008)
Given a Draft week with 0 hours
Then the "Submit Timesheet" button is disabled.

**AC-013 — Manager approves a timesheet** (OBS-TIME-009/010)
Given the Approvals tab lists a Submitted timesheet
When I click "Approve"
Then it leaves the pending list and its status becomes Approved.

**AC-014 — Add timesheet line excludes closed projects** (OBS-TIME-005)
Given a Draft week
When I open the "+ Add Line Item" select
Then projects in Close Out or Loss status are not offered.

**AC-015 — Weighted forecast computation** (OBS-SALES-002)
Given the Sales Pipeline
Then "Weighted Forecast" equals Σ(contractValue × stage probability) over sales-stage projects.

**AC-016 — Unknown procurement redirects** (OBS-PROC-008)
Given I navigate to /procurement/NOPE
Then I am redirected to /procurement.

**AC-017 — Catch-all route** (OBS-NAV-005)
Given I navigate to /totally-unknown
Then the Executive Dashboard renders.

**AC-018 — Stub pages render under-construction** (OBS-NAV / §5.10)
Given I navigate to /reports
Then an "under construction" placeholder is shown.

---

## 8. Domain-generalization deltas (de-oil-&-gas)

Goal: make the schema industry-neutral while **keeping the tender/PQ pipeline and procurement lifecycle**
(both generic to any contracting/PMO business). Every O&G-specific artifact found, with location and
disposition:

### 8.1 RENAME / RESHAPE
| O&G artifact | Location | Action |
|---|---|---|
| `HSEIncident` interface | `types.ts:212-221` | **Rename → `IncidentReport`**. "HSE" = Health/Safety/Environment (O&G/construction term). Keep the structure (type/severity/status/reportedBy) — generic incident logging is broadly useful. |
| `hseIncidents` export | `mockData.ts:367-371` | Rename → `incidents`. Currently dead data; reseed with neutral examples (drop "Offshore Platform Delta"). |
| `User.location` union `'Onshore - HQ' | 'Onshore - Site' | 'Offshore' | 'Remote'` | `types.ts:45` | **Generalize to a free-text/lookup `location: string`** (e.g., office/site/remote) or a tenant-defined enum. "Onshore/Offshore" is O&G. Used only in mock data; not rendered, so low blast radius. |
| `User.certifications: string[]` seeded with `BOSIET / H2S / HUET / OGUK / HAZOP Leader` | `types.ts:46`, `mockData.ts:14-18` | **Rename concept → `skills: string[]`** (or keep `certifications` but reseed with neutral creds: PMP, PMI-SP, CPA, etc.). Drop all O&G-specific cert strings. |
| `IncidentSeverity` | `types.ts:205-210` | **Keep** — Low/Medium/High/Critical is generic. |
| `HSEIncident.type` values (`Near Miss / Injury / Property Damage / Environmental / Safety Observation`) | `types.ts:215` | Keep but make tenant-configurable; values are generic safety categories, acceptable to retain. |

### 8.2 REMOVE / RESEED (data-only O&G flavor)
| Item | Location | Action |
|---|---|---|
| Project "Offshore Wind Farm FEED" (P010), status PQ Submitted | `mockData.ts:139-151` | Reseed with a neutral project name; "FEED" (Front-End Engineering Design) is industry jargon. |
| Incident location "Offshore Platform Delta" | `mockData.ts:369` | Reseed neutral (e.g., "Regional Site B"). |
| User titles "Structural/Process Engineer", "Operations Director" | `mockData.ts:14-18` | Acceptable as generic, but engineering-leaning; reseed to match target vertical if needed. |

### 8.3 KEEP (generic to contracting — do NOT strip)
- **`ProjectStatus` pipeline** Leads→PQ→Quotation→Tender→Negotiation→Won→Ongoing→CloseOut (+Loss,
  Internal). PQ ("Pre-Qualification") and Tender are standard B2B contracting terms, **not** O&G-specific.
- **`ProcurementStatus` lifecycle** Draft→Requested→Approved→Vendor Quoted→Quote Selected→Ordered→
  Received→Vendor Invoiced→Paid (+Rejected, Cancelled). Generic purchase-to-pay.
- **`ProjectDocument`** RFI/Transmittal/Submittal/Drawing/Specification — common to any
  project-delivery/document-control context (construction-leaning but broadly applicable; consider
  making categories tenant-configurable).
- **Budget versioning, timesheets, tasks/Gantt, companies (Client/Vendor/Internal)** — all neutral.

### 8.4 Cross-cutting note
None of the O&G strings are load-bearing for logic — they are display/seed values plus two enum unions
(`location`, the `HSE`/`certifications` naming). Generalization is low-risk: rename two types/fields and
reseed mock data. No business rule depends on offshore/onshore or any cert.

---

## 9. Existing-repo findings (architecture / perf / scalability / maintainability)

Per the charter's "Existing repo" + "Performance" sections. **Documentation only — no functionality
changed.** Severity: **Critical / High / Medium / Low**.

| # | Severity | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| F-1 | **Critical** | **Rules-of-hooks violation**: `useState(selectedVersionId…)` is called **after** an early `return <Navigate/>` in `ProjectDetails`, so the hook is conditional and hooks run in different order across renders. Latent crash / state corruption risk. | `ProjectDetails.tsx:1210-1212` (early return) then `:1217` (`useState`) — confirmed by ESLint `react-hooks/rules-of-hooks` error at 1217:55. | Move all hooks above the `if (!project)` guard; derive version defaults with `useMemo`/lazy init after hooks. (Defer the actual edit to TDD build per charter.) |
| F-2 | **Critical** | **No backend / no persistence / no real auth.** In-memory mock state only; role is client-side and bypassable by URL; no `org_id` tenancy seam. Blocks every production NFR (security, multi-user, durability). | NFR-001/002/003; `UserContext.tsx`, absence of API. | Introduce Supabase (Postgres+Auth+RLS) with an `org_id` column on every business table and RLS that is not bypassable; replace mock imports with a typed data-access layer. (Phase work, not this spec.) |
| F-3 | **High** | **Single 804 KB JS bundle, no code-splitting.** recharts + all routes ship eagerly; >500 KB Vite warning. Poor TTI on slow links; will worsen as features land. | `npm run build`: `index-*.js 804.51 kB`. | `React.lazy` + route-level `Suspense`; isolate recharts behind lazy chart components; configure `manualChunks`. |
| F-4 | **High** | **21 ESLint errors + 3 warnings** under a `--max-warnings=0` CI gate → repo is currently un-mergeable by house policy. Mostly unused imports/vars, one `prefer-const`, plus the F-1 hooks error and two `exhaustive-deps` warnings. | `npx eslint .` (NFR-010). | Clean unused symbols; fix `exhaustive-deps` deliberately (memoize `getDateLeft`; reconsider the Timesheets effect dep). |
| F-5 | **High** | **`ProjectDetails.tsx` is a 1390-line god-file** defining 8+ components, 3 status badges, a Gantt engine, and a drawer. Hard to test, review, and reuse. | `ProjectDetails.tsx` whole. | Extract each tab + `TaskModal` + Gantt + `ProcurementDrawer` into `components/project-details/` files; lift shared badges to `components/`. |
| F-6 | **Medium** | **Duplicated logic, copy-pasted across files**: `formatCurrency` (USD) defined ~7×; the 9-step procurement `steps[]` + `getProgressPercentage` defined in 3 places; status→color maps repeated. | `Projects.tsx:117`, `ExecutiveDashboard.tsx:24`, `Procurement.tsx:11/75-91`, `ProjectDetails.tsx:389-405`, `ProcurementPipeline.tsx:14-24`, etc. | Centralize: `lib/format.ts` (currency, dates), `lib/procurement.ts` (canonical lifecycle + progress), shared badge/color maps. |
| F-7 | **Medium** | **O(n) `.find()` joins recomputed every render** (clients, PMs, vendors, users per table row). Fine at 10 rows, quadratic at scale. | `Projects.tsx:255-256`, `ExecutiveDashboard.tsx:360`, `ProjectDetails.tsx:621-622` (even self-comments "inefficient … should use a map"). | Build `Map` lookups (memoized) or, post-backend, resolve via joined queries. |
| F-8 | **Medium** | **Timesheets ignores `UserContext`** — hard-codes `CURRENT_USER_ID = 1`, diverging from the rest of the app's role model; "current user" is inconsistent across pages. | `Timesheets.tsx:20,30`. | Source the user from `useUser()`; remove the constant. |
| F-9 | **Medium** | **Dead code**: `ProjectPipelineStepper.tsx` (never imported), `hseIncidents` data (never rendered), unused imports flagged by ESLint, `Procurement.tsx`/`SalesPipeline` "Add" buttons with no handlers. | grep: no importers; F-4. | Delete or wire up; keep the component only if a planned screen needs it. |
| F-10 | **Medium** | **Many primary actions are non-functional placeholders** (New Project, New Request modal, Add Lead, Edit Project, Approve/Reject/Generate PO/Receive Goods, History/audit, document upload is mocked). Risk of shipping a demo that *looks* complete. | OBS-PROJ-011/027, OBS-PROC-007/014/015, OBS-SALES-005, OBS-DASH-007. | Track each as a real feature behind the spec; don't conflate UI presence with capability. |
| F-11 | **Low** | **Hard-coded fake analytics** (YTD performance series, "Projects at Risk"=3, cost-distribution %, engineer 40.5h). Misleading once real data exists. | `ExecutiveDashboard.tsx:33-37,53,184-189,291-298`. | Replace with computed aggregates; clearly mark any intentional placeholders. |
| F-12 | **Low** | **CDN-coupled toolchain residue**: dead `aistudiocdn` import-map and missing `/index.css` in `index.html`; Tailwind via CDN `<script>` (CSP/perf/offline issues). | `index.html:22-33`. | Adopt a bundled Tailwind (PostCSS) pipeline; remove the import-map; emit real CSS. |
| F-13 | **Low** | **Identity type inconsistency** (numeric ids for Company/User, string ids for Project/Procurement) and free-text `ProcurementDocument.status`. Friction for a typed backend/ORM. | `types.ts`; NFR-011. | Standardize id types (likely string UUIDs server-side) and replace the free-text status with an enum. |
| F-14 | **Low** | **`useLayoutEffect` recomputes all Gantt dependency lines into React state on every task/zoom change**, storing JSX in state. Extra renders; brittle. | `ProjectDetails.tsx:714-750`. | Compute paths during render (memoized) instead of storing nodes in state. |

---

## 10. Uncertainties & questions (for the owner)

- [ ] **Target vertical:** which industry framing should seed data use once O&G is removed (generic
      consultancy? IT services? a specific named client)?
- [ ] **`location`/`skills` model:** free-text, a fixed neutral enum, or tenant-configurable lookups?
- [ ] **Incident register:** is `IncidentReport` an MVP module or deferred? (Currently dead data.)
- [ ] **Procurement lifecycle authority:** is the 9-step ADR-002 flow final, and who can perform each
      transition (role × status authorization matrix)? Current buttons are unguarded placeholders.
- [ ] **Timesheet approval rule:** approval is by *managing-any-project*; should it be per-project PM,
      line-manager, or a configurable approver chain? Should approval require all entries on the
      manager's projects, or whole-timesheet?
- [ ] **Budget semantics:** `Project.budget/spent` (header) vs `BudgetLineItem` totals can diverge (e.g.
      P001 header budget 4.7M vs V2 line sum 4.7M but V1 1.3M). Which is authoritative? Should `spent`
      derive from procurement + timesheet actuals rather than being stored?
- [ ] **Work Orders:** routed but unlinked and unbuilt — in MVP scope or not?
- [ ] **Currency/i18n:** single-currency USD acceptable for the first client, or multi-currency from day
      one?
- [ ] **Win-rate definition:** counting Ongoing+CloseOut as "won" — is that the intended business metric?
- [ ] **Roles:** Admin is hidden from the switcher but used for nav gating — is Admin a real role with
      screens, or an internal super-user?

---

## 11. Recommendations / refactoring strategy (prioritized)

> Sequenced so each step is shippable and de-risks the next. Code changes happen in later TDD phases;
> this spec only records the plan. **Do not change behavior during quality-only refactors** (charter).

1. **Make the repo green (P0).** Fix F-1 (hooks) and F-4 (lint) so CI's `--max-warnings=0` gate can
   pass. Pure correctness/cleanup; behavior-preserving except the latent F-1 crash.
2. **De-O&G the schema (P0, this spec's §8).** Rename `HSEIncident→IncidentReport`, generalize
   `location`/`certifications→skills`, reseed neutral mock data. Small, reviewable.
3. **Stand up the backend seam (P1).** Supabase Postgres + Auth + RLS; add `org_id` to every business
   table; replace mock imports with a typed data-access layer behind the same component APIs. Resolves
   F-2; enables real auth to replace OBS-AUTH mock.
4. **Centralize shared logic (P1).** `lib/format.ts`, `lib/procurement.ts` (canonical lifecycle), shared
   badge/color maps, `Map`-based lookups. Resolves F-6/F-7; cuts duplication before more screens land.
5. **Decompose `ProjectDetails` (P1).** Split the god-file into per-tab components + extracted Gantt and
   drawer; add unit tests as pieces become testable. Resolves F-5; pairs with F-14.
6. **Code-split & trim the bundle (P2).** Route-level `React.lazy`, lazy recharts, `manualChunks`; adopt
   bundled Tailwind and remove `index.html` CDN residue. Resolves F-3/F-12.
7. **Replace placeholder actions with real features (P2).** Wire create/edit/approve/PO flows to the new
   data layer, each behind its own spec + AC + Playwright test (the `e2e/` layer is currently empty).
   Resolves F-10/F-11.
8. **Establish the BDD layer (ongoing).** Implement the §7 `AC-###` as `e2e/AC-###.spec.ts` so the
   baseline behavior is regression-locked before the production rewrite proceeds.
