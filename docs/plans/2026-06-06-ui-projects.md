# Design Plan — Projects index + ProjectDetails decomposition → IA-3 hybrid

**Date:** 2026-06-06
**Surface #4** of the UI realignment program · Issue 4 in `docs/plans/2026-06-06-ui-realignment.md` §4.3
**Author:** design-architect
**Status:** Design+Plan (per-surface). Hands off to `eng-planner` for the traceability table + TDD task IDs, then `ui-implementer`.
**Authorities:** `DESIGN.md` (token/identity authority — light scheme, "Token System A") · `docs/design-mockups/proposal-IA-3-hybrid.html` (layout/IA authority) · `docs/product-expectations.md` Part C (charter)
**Depends on:** Issue 1 Foundation (shell + primitives) merged; reuses Issue 2/3 primitives (DataTable, ViewToggle, StatusPill, ProgressBar, LifecycleStepper pips, ListState, BackBar, Breadcrumb, GateNotice).
**Method:** `impeccable shape` (UX shaped before code) + `ui-ux-pro-max plan` (layout + 99-guideline checklist) + `taste` required-states / a11y / anti-slop folded into the acceptance list. **Identity preserved — no new token, palette, or font.**

> **Identity-preservation note (carried from the master plan §"Identity-preservation").** `taste`'s aesthetic directives (ban Inter, perpetual motion, `rounded-[2.5rem]`, diffusion shadows) are **overridden** by `DESIGN.md`: Inter mandated, borders-not-shadows, radius scale 4/6/8/10/999, motion = 120–250ms CSS transitions. We fold in only `taste`'s **discipline**: full state cycles, `state-clarity`, disabled/focus semantics, anti-slop (no emoji, no fake data, SVG-only icons, one accent, `−` not `-` for negatives). When `taste` and `DESIGN.md` conflict on look, `DESIGN.md` wins.

---

## 1. What this issue is

Two coupled deliverables, presentation-only — query contracts unchanged where a real DAL already exists, one **new project-scoped read** required (see §4 and the blocking Open Question OQ-1):

1. **Projects index** (`pages/Projects.tsx`) re-skinned to IA-3: index-first **Table (default) + Cards** `ViewToggle`; a row/card drills to the full-page project detail route (`/projects/:projectId`, already in `App.tsx`) and opens/refocuses a workspace record tab. Status via `StatusPill` (retire `ProjectStatusBadge`). The legacy Grid/List/Board tri-toggle collapses to Table + Cards; the **Board (Kanban) view is dropped** from the index per IA-3 (Projects is index-first Table+Cards; Kanban is Pipeline's pattern, not Projects').
2. **ProjectDetails DECOMPOSITION**: the ~1250-line `pages/ProjectDetails.tsx` mockData god-component is split into one-responsibility components under `pmo-portal/pages/project-detail/`, re-skinned to `PageHeader` + in-page `Tabs`, with each real tab consuming the DB snake_case shape (no `data/mockData`, no `as unknown as` in the page).

**Non-goals (locked, from program §1).** Not a data rewrite of existing hooks; not a behavior change to routes/role-gating/auth/impersonation; no new tokens/brand/font; light scheme only; the `dark:` variant + `primary-50..950` ramp are **removed**.

### 1.1 Current-state inventory (what we are tearing out)

`pages/ProjectDetails.tsx` (read in full) is a single file holding **all** of:

| Block | Lines (approx) | Data source today | Disposition |
|---|---|---|---|
| `MetricCard` (local) | 15–34 | — | Replace with foundation `KPITile` / stat-strip cell. |
| `ProcurementDrawer` (slide-over) | 58–222 | `companies`, `ProcurementStatus` mockData | **Delete.** IA-3 drills to `/procurement/:id` (full page), not a drawer. |
| `ProcurementTabContent` + pie chart + "tip" card | 226–474 | `procurements`, `companies` mockData | Rebuild as real project-scoped PR `DataTable` (see §4 Procurement). Drop the pie chart + hard-coded `COLORS` + the "$50k / 3 quotes" advisory card (fake guidance). |
| `TimesheetsTabContent` | 476–518 | `timesheetEntries`, `timesheets`, `users` mockData | Rebuild as real project-scoped entries `DataTable` (see §4 Timesheets). |
| `ScheduleTabContent` + Gantt + `TaskModal` + `TaskStatusBadge` | 520–930 | `allTasks`, `users` mockData | **DEFERRED module** — replace the whole Schedule/Tasks tab with a `ListState` "coming soon" placeholder. Do NOT port the Gantt. (OQ-2.) |
| `DocumentStatusBadge` + `DocumentsTabContent` | 934–1077 | `projectDocuments` mockData + mock upload | **DEFERRED module** — replace with `ListState` empty/"coming soon" placeholder. Do NOT port the upload. (OQ-2.) |
| `ProjectDetails` shell (header + Overview + tab nav) | 1081–1247 | `projects`, `users`, `companies` mockData | Rebuild header as `PageHeader`, Overview from real project fields, tab nav as in-page `Tabs`. |

The whole file imports `projects, users, companies, procurements, timesheetEntries, timesheets, tasks, projectDocuments` from `../data/mockData` (line 7) and uses the **camelCase prototype shape** (`project.contractValue`, `project.projectManagerId`, `procurement.totalValue`, `entry.hours`). The re-skin moves every surviving tab onto the **snake_case DB shape** (`contract_value`, `project_manager_id`, `total_value`, `hours`) via real hooks.

Legacy components to retire from this surface: `ProjectStatusBadge`, `ProcurementStatusBadge`, `DocumentStatusBadge`, `TaskStatusBadge`, local `MetricCard` → all replaced by `StatusPill` / `KPITile`.

---

## 2. Decomposition — target component tree

New directory `pmo-portal/pages/project-detail/` (the detail page; index stays at `pages/Projects.tsx`). Every component is one responsibility, token-mapped, full-state, test-first.

```
pages/Projects.tsx                         # index — Table + Cards ViewToggle (re-skin in place)
pages/project-detail/
  ProjectDetail.tsx                        # route component: loads project, renders PageHeader + stat strip + Tabs; owns ptabs local state
  ProjectDetailHeader.tsx                  # PageHeader(phead): icon + name + StatusPill + meta row + stat strip (5 stats)
  tabs/
    OverviewTab.tsx                        # real project fields (info + progress + at-a-glance)
    BudgetTab.tsx                          # thin wrapper that mounts the already-real <ProjectBudget projectId>
    ProcurementTab.tsx                     # real project-scoped PR DataTable (reuses Procurement row + lifecycle pips)
    TimesheetsTab.tsx                      # real project-scoped logged-time DataTable
    TasksTab.tsx                           # DEFERRED — ListState "coming soon" placeholder (NO Gantt, NO mockData)
    DocumentsTab.tsx                       # DEFERRED — ListState "coming soon" placeholder (NO upload, NO mockData)
components/ProjectCard.tsx                 # index Cards-view card (foundation composite; first consumer = this issue)
```

`ProjectBudget.tsx` is **kept and still mounted** by `BudgetTab` (it is already real-data; its own internal re-skin from `gray-*`/`dark:`/`rounded-full` badges to tokens + `StatusPill` is tracked as a sub-task here, see §4 Budget, but its query/version logic is untouched).

`ProjectKanbanBoard.tsx` is **no longer imported** by Projects (Board view dropped from the index). Leave the file in place for now (out of scope to delete; flag in §8 for a later cleanup PR so we don't touch unrelated surfaces).

---

## 3. Index — `pages/Projects.tsx` (Table + Cards)

**Index-first IA (mockup "Projects" screen).** `PageHeader` is not used on the index (that's a detail-route component); the index uses the standard page head: title `Projects` + sub + **New Project** `Button(primary)` → standalone `Toolbar` (`ViewToggle` · spacer · `SearchMini`) → body. The legacy "smart tabs" (All / My Projects / Ongoing / Leads / Completed) and the two `<select>` filters (Client, PM) are **retained as behavior** but re-skinned: the status-group tabs become a `SegFilter` in the toolbar; the Client + PM selects become `control` chips. (Preserving the existing filter behavior is a non-goal-to-change; only the chrome changes.)

**View toggle (`ViewToggle` segmented control).** **Table (default)** + **Cards**. Persisted per-surface as `VIEW.project` in the tab's view-state (sessionStorage, per Foundation). The legacy default was `Grid`; **new default is `Table`** per IA-3 (index-first, scannable). *Note for implementer:* AC-1011 e2e currently drives the **Cards** view (it targets `h3` project name inside a card + the inline status control) — see §6 / OQ-3; either keep Cards reachable and update the spec to switch to Cards, or keep the status-control inline in both views.

### 3.1 Table view (default)
`DataTable` (foundation) with columns:

| Column | Cell pattern | Token(s) |
|---|---|---|
| Project | proj cell: 28px colored icon + name (`label`/600) + mono code (`project.code`) on line 2; customer-PO ref dimmed under it if present | `mono`, `muted-foreground`, icon tile uses categorical `violet` or derived series color (non-interactive) |
| Customer | `project.client?.name ?? '—'` | `body`, em-dash for missing |
| PM | avatar (initial) + `project.pm?.full_name ?? 'Unassigned'` | avatar gradient blue→`violet` |
| Status | `StatusPill` (Ongoing → `open`/blue tint; At-risk/On-hold → `overdue`/`warning` tint; Won-pending → `won`/`success`; Loss → `lost`/`destructive`; Leads/submitted → `draft`/`neutral`) | tinted-status: status hue ~10–18% bg + darkened-text variant |
| Contract | `formatCurrency(project.contract_value)` | `tnum` |
| Committed | committed total, `sub` (muted) | `tnum`, `muted-foreground` |
| Actual | `formatCurrency(project.spent)` | `tnum` |
| Progress | `ProgressBar` = `spent / contract_value`; ≤55% neutral, 55–100% `warning`, >100% `destructive` fill | track `secondary`, threshold fills |

Row hover → `accent/60%`; row click → `navigate('/projects/' + project.id)` (drill). Sortable `<th>` preserved (existing `requestSort` behavior re-skinned to the DataTable sortable header). Keep `data-testid="projects-loading"` on the loading state (load-bearing for AC-1011).

### 3.2 Cards view (`ProjectCard`)
`ProjectCard` grid: `repeat(auto-fill, minmax(320px, 1fr))` (foundation auto-fit pattern, no breakpoint math). Each card:
- Head: 28px icon + name (`subheading`-ish, 600) + customer/mono-code + `StatusPill`.
- Body: Contract / Committed / Actual rows (`tnum`).
- Dual `ProgressBar`s: committed (at `warning/.55` track-relative) + actual (threshold-colored).
- Foot: PM avatar + role; the inline `ProjectStatusControl` (existing component — **kept**, it owns the win-transition RPC that AC-1011 exercises) wrapped in `onClick=stopPropagation`.

Card hover → `state-lift` shadow only (per DESIGN.md Elevation; **no static shadow**). Drop the legacy top colored-border strip (`getStatusColorBorder`) — it is a side-stripe-ish multi-hue device; status now lives in the `StatusPill` (color-not-only: dot + text).

### 3.3 Index states
- **Loading:** `ListState` loading — Table → shimmer rows; Cards → skeleton cards. Keep `data-testid="projects-loading"`.
- **Empty (no projects):** `ListState` empty — "No projects yet" + **New Project** CTA.
- **Empty (filter no-match):** `ListState` empty within current view — "No projects match these filters" + **Clear filters** action (preserve existing clear-all behavior).
- **Error:** `ListState` error — destructive-tinted, "Couldn't load projects" + **Retry** (`refetch()`).
- **Edge:** progress >100% → `destructive` fill + value; missing customer/PM/end-date → em-dash (`—`), never blank; long names ellipsis at ~40ch.

---

## 4. Detail route — `pages/project-detail/` and per-tab data sourcing

`/projects/:projectId` (existing route). Loads the project via the existing `useProjects()` cache (find by id) or a thin `useProject(id)` selector — **no new project-by-id DAL needed** for the header/Overview; the row already carries `client`, `pm`, and all `contract_value`/`spent`/`customer_contract_ref` fields (`ProjectWithRefs`). If the project is not in cache (deep-link cold load), show `ListState` loading then resolve from the list query; if truly absent → `ListState` error with a "Back to Projects" action (replaces the old hard `<Navigate to="/projects">`).

### 4.1 `ProjectDetailHeader` (PageHeader / phead)
`PageHeader`: 44px project icon + name (`page-title`) + `StatusPill` + meta row: customer · mono `project.code` · **Customer PO ref + date** (`project.customer_contract_ref` + contract date). Actions: **Edit Project** `Button(outline)` (no-op stub this issue — existing button is also a stub; keep as outline, not a fake primary), and `BackBar` + `Breadcrumb` ("Projects › {name}") for drill-return.

**5-stat strip** below the header (replaces the Overview-only `MetricCard` row): Contract / Proposed / Committed / Actual / **On-hand margin** (`contract_value − spent`, shown `success` when positive, `destructive` when negative, with a true `−` glyph). All `tnum`. The proposed-vs-contract delta is shown as a small muted sub-value under Contract (proposed value from `project` fields if present, else omitted — do not fabricate).

### 4.2 In-page `Tabs` (ptabs)
Tab order: **Overview · Budget · Procurement · Timesheets · Tasks · Documents**. **Default tab = Budget** per master plan §4.3 (the budget survivor is the most-used detail surface) — confirm against owner; if the owner prefers Overview-first, that is a one-line change (OQ-4). `ptabs` are **local UI state** in `ProjectDetail.tsx`, `role="tablist"`/`role="tab"`/`aria-selected`, keyboard-arrow navigable; they do **not** create global workspace `TabStrip` tabs. The legacy "Schedule" tab is renamed **Tasks** (matches the deferred module name).

`/projects/:projectId/budget` (existing route) is preserved as a deep-link that opens the detail page with the Budget tab pre-selected.

### 4.3 Per-tab data sourcing (explicit — REAL vs PLACEHOLDER)

| Tab | Source today | Target this issue | DAL status |
|---|---|---|---|
| **Overview** | mockData `projects/users/companies/tasks` | **REAL** — render from the `ProjectWithRefs` row already loaded (name, client, pm, dates, contract/spent). Drop the fake "Team Members = first 4 users" list and the task-based progress bar (tasks are deferred). Progress = budget actual/contract (real). | ✅ existing `useProjects()` |
| **Budget** | already REAL `<ProjectBudget projectId>` | **REAL — keep mounting `<ProjectBudget>`** unchanged in `BudgetTab`. Re-skin `ProjectBudget`'s own chrome (the `gray-*`/`dark:`/`rounded-full` status badges → `StatusPill` with `vpill` active/draft/archived tints `success`/`warning`/`secondary`; the budget table → token DataTable + `TableFoot` totals; version controls → `Toolbar` + `control`). Query/version/RPC logic untouched. | ✅ existing `useProjectBudget`/`useBudgetVersions`/`useBudgetMutations` |
| **Procurement** | mockData `procurements` + drawer + pie chart | **REAL — but needs a project filter.** Render a project-scoped PR `DataTable` (reuses Procurement issue's row: title + mono PR-id · value · inline lifecycle pips · `StatusPill`), row → drill to `/procurement/:id`. **No drawer, no pie chart, no advisory card.** | ⚠️ **DAL GAP — see OQ-1.** `listProcurements()` returns ALL org PRs with no project filter. Two options: (a) filter the cached `useProcurements()` list client-side by `p.project_id === projectId` (zero new DAL, matches the "page filters cached list client-side" pattern already documented in `procurements.ts`); (b) add `listProcurementsByProject(projectId)`. **Recommend (a)** for this issue — no new query, RLS already scopes the org, the list is already cached for the Procurement surface. |
| **Timesheets** | mockData `timesheetEntries/timesheets/users` | **REAL — but needs a project filter the current DAL cannot serve.** Render a project-scoped logged-time `DataTable` (date · engineer · hours · notes). | ⚠️ **DAL GAP — see OQ-1 (blocking).** `listTimesheets(userId)` is **user-scoped** (own rows only) and has **no project filter** — it cannot answer "all hours logged against project X across all engineers." Client-side filtering of the current cache is **insufficient and wrong** (it would only show the current user's hours). This tab requires a **new project-scoped read**, e.g. `listTimesheetEntriesByProject(projectId)` returning entries joined to engineer name, RLS-scoped to the org and gated so only authorized roles see cross-user hours. **This is the one genuinely-new query the issue forces.** |
| **Tasks** (was Schedule) | mockData `tasks` + Gantt + TaskModal | **PLACEHOLDER — DEFERRED MODULE.** Render `ListState` empty/"coming soon": "Task scheduling is coming soon" + a one-line note. NO Gantt, NO TaskModal, NO mockData. Schema-ready, no DAL/UI, pending owner scope decision (OQ-2). | ❌ deferred — no DAL, do not build |
| **Documents** | mockData `projectDocuments` + mock upload | **PLACEHOLDER — DEFERRED MODULE.** Render `ListState` empty/"coming soon": "Document management is coming soon" + (disabled) Upload affordance or no CTA. NO upload, NO mockData. Schema-ready, no DAL/UI, pending owner scope decision (OQ-2). | ❌ deferred — no DAL, do not build |

**Hard rule for every real tab:** kill the `data/mockData` import; consume snake_case DB shape; **no `as unknown as`** in page code (the `as unknown as` casts in the DALs are the documented data-boundary pattern and stay in `src/lib/db/*`, not in the page). Retire `ProcurementStatusBadge` usage → `StatusPill`.

### 4.4 Per-tab states (every real tab)
- **Overview:** loading skeleton; never empty (a project always has fields); error only if the project itself fails to load (handled at the route level).
- **Budget:** `ProjectBudget` already has loading/empty/error; verify they route through `ListState` after re-skin (skeleton table, not spinner).
- **Procurement:** loading → `ListState` skeleton rows; empty → `ListState` "No purchase requests for this project yet"; error → `ListState` + retry; edge → paid PR shows `won`-style pill, skipped lifecycle step renders dashed pip.
- **Timesheets:** loading → skeleton; empty → `ListState` "No time logged against this project yet"; error → `ListState` + retry; edge → hours `tnum`, zero-hour entries hidden or shown as `0.00` consistently (pick shown, per number rigor).
- **Tasks / Documents:** the placeholder IS the state — a composed `ListState` empty (not a blank "coming soon" card; teach what's coming), `prefers-reduced-motion`-safe, no fake rows.

---

## 5. Tokens consumed (named, never literal)

Every visual decision names a `DESIGN.md` token. The full migration target is: **remove all `gray-*`, `dark:`, `primary-50..950`/`primary-600`/`primary-700`, raw hex (`#3b82f6`, `#9ca3af`, `rgba(31,41,55,…)`), `shadow-*`, `rounded-xl`** from `Projects.tsx`, `ProjectDetails.tsx` (→ deleted/decomposed), and `ProjectBudget.tsx`.

| Piece | Tokens |
|---|---|
| Page surfaces | `background`, `card` (white on `secondary/35%` main), `border` (1px, single-border rule) |
| Primary actions (New Project, Confirm) | `primary` + `primary-foreground`, `button-primary`, brand `0 1px 2px primary/.25` rest shadow |
| Secondary actions (Edit, Retry, Clear) | `button-outline` (`background` fill, `input` border, `accent` hover) |
| Status pills | `StatusPill` — `open`/blue, `won`/`success`, `lost`/`destructive`, `overdue`/`warning`, `draft`/`neutral`; bg = hue ~10–18%, text = **darkened variant** (won `hsl(142 64% 30%)`, amber `warning-foreground`) — preserve darker text for AA |
| Version pills (Budget) | `vpill` active→`success`, draft→`warning`, archived→`secondary` |
| Progress / utilization | `ProgressBar` track `secondary`; fill threshold `success` / `warning` / `destructive` |
| Stat strip / KPI | `KPITile` value `page-title`-class (~23px/700) `tnum`; label `muted-foreground` 12.5px; margin `success`/`destructive` |
| Tables | `table-header-cell` (Overline 11.5px/600 uppercase, `muted-foreground`), `table-body-cell` (54px, `border/70%` divider, `accent/60%` hover); `TableFoot` totals `secondary/40%` |
| Toolbar / filters | `control` chips (32px, `input` border, `muted` icon), `SegFilter` (`secondary` track, on = white pill + `0 1px 2px` lift), `SearchMini` |
| In-page Tabs | active = `primary` indicator + `foreground`/600; inactive = `muted-foreground` |
| Icons / avatars | categorical `violet` + derived series colors for the project icon tile / avatar gradient — **non-interactive only** (One Blue Rule: blue is the only interactive color, ≤10% of screen) |
| Type | `page-title`, `subheading`, `label`, `overline`, `mono` (codes/PO refs), `tnum` (every figure) |
| Radius | `md` (cards/controls/8px), `sm` (nav-ish), `full` (pills/avatars) — no `rounded-xl` |
| Focus | global `*:focus-visible` = `2px ring` + 2px offset |
| Motion | 120–250ms CSS transitions; row/card hover; `prefers-reduced-motion` disables shimmer + transitions |

---

## 6. Accessibility (WCAG-AA) and responsive

**A11y (ui-ux-pro-max §1 + DESIGN.md posture):**
- AA contrast: status pills use darkened-text variants (never base hue); `muted-foreground` at L40 clears AA on `secondary` fills.
- Color-not-only: status = dot + text in `StatusPill`; progress also shows the `%` value (not bar-only).
- Focus: global `:focus-visible` ring on every focusable (rows, cards, tabs, controls, toggle).
- Tab order = DOM = page head → toolbar → table/cards → (detail) header → ptabs → tab body.
- `role="tablist"`/`role="tab"`/`aria-selected` on `ViewToggle`, `SegFilter`, and in-page `Tabs`; arrow-key nav on tabs.
- `aria-label` on icon-only buttons (view toggle icons, sort glyph, `⋯` row menu).
- Clickable table rows: row is `role="link"` or the project name is the real focusable `<a>`/button (don't make a bare `<tr onClick>` the only affordance — keyboard users need a focusable target).
- `aria-current="page"` not used here (that's rail); active ptab uses `aria-selected`.
- Avatars decorative (`alt=""` / `aria-hidden`) since the PM name is adjacent text.
- Deferred-tab placeholders: `ListState` empty carries a real heading + descriptive text (screen-reader meaningful), not just an icon.

**Responsive (DESIGN.md + mockup breakpoints):**
- `≤1180px`: stat strip wraps to fewer columns; Cards grid auto-fit reflows.
- `≤920px`: rail hides (shell concern, not this surface); the detail in-page `Tabs` become horizontally scrollable; Table gets an intentional horizontal-scroll region (the only permitted body scroll).
- `≤560px`: stat strip → 2-col; Cards → 1-col; Table → either horizontal scroll or stacked key-value rows (pick horizontal scroll to match mockup; revisit at 360px).
- No unintended horizontal body scroll.

---

## 7. Acceptance list (folded: ui-ux-pro-max 99-guideline + taste discipline + program §5)

The eng-planner assigns `AC-###` ids + owning test layers (ADR-0010). This is the behavior the PR must prove:

**Index**
- A. Table is the default view; `ViewToggle` switches Table↔Cards; selection persists in `VIEW.project` (sessionStorage). *(unit/RTL)*
- B. A project row/card click navigates to `/projects/:projectId`. *(unit/RTL; covered cross-stack by AC-401/AC-1011)*
- C. Status renders as `StatusPill` (dot + text), not `ProjectStatusBadge`; correct tint per status. *(unit/RTL)*
- D. Loading shows `ListState` skeleton with `data-testid="projects-loading"`; empty shows composed empty + New-Project CTA; filter-no-match shows clear-filters; error shows retry. *(unit/RTL)*
- E. Progress >100% renders `destructive` fill + value; missing fields render `—`. *(unit/RTL)*
- **AC-401 (preserved):** PM sees real seeded projects with joined client + PM names (`Innovate Corp HQ Fit-Out`, `Innovate Corp`, `Alice Manager` visible). *(e2e — must still pass; the re-skin must keep these strings rendered in both Table and Cards)*
- **AC-1011 (preserved):** PM wins `Northwind ERP Rollout` via the inline status control; Won badge + `CPO-E2E-1` ref show. *(e2e — see OQ-3: the spec's `div.rounded-xl` + `h3` + Cards-view selectors are brittle against the re-skin; coordinate the selector update with the spec owner)*

**Detail / decomposition**
- F. `ProjectDetails` is decomposed into `pages/project-detail/*`; **zero `data/mockData` imports** remain in the detail page; **zero `as unknown as`** in page code. *(grep-asserted in review + unit)*
- G. Header renders `PageHeader` with name + `StatusPill` + customer · mono code · Customer-PO ref+date; 5-stat strip with `tnum` and `−`-glyph negative margin. *(unit/RTL)*
- H. Budget tab mounts the real `<ProjectBudget>`; version pills use `success`/`warning`/`secondary` tints; totals in `TableFoot`. *(unit/RTL; budget RPC behavior already covered by AC-732)*
- I. Procurement tab shows only this project's PRs (filtered), rows drill to `/procurement/:id`, retires `ProcurementStatusBadge` → `StatusPill`. *(unit/RTL with mocked hook)*
- J. Timesheets tab shows project-scoped logged time from the **new** project-scoped read (OQ-1), RLS/role-gated. *(unit/RTL for render; **pgTAP** owns the cross-user RLS read contract for the new query — lowest sufficient layer per ADR-0010)*
- K. Tasks + Documents tabs render `ListState` "coming soon" placeholders — no mockData, no fabricated rows. *(unit/RTL)*

**Cross-cutting (every item)**
- States via shared `ListState` (skeleton not spinner; composed empty; inline error + retry).
- Tokens-only: zero `gray-*`/`dark:`/`primary-NNN`/raw-hex/`shadow-*`/`rounded-xl` in changed files (grep-asserted in `/design-review`).
- Anti-slop: SVG icons (one family), `tnum` on all figures, `−` not `-` for negatives, one `primary` blue ≤10%, borders-not-shadows, no glass/neon/purple-as-action, `prefers-reduced-motion` honored.
- `npm run typecheck` zero errors; ESLint `--max-warnings=0`; ≥80% line coverage on changed code; `/design-review` passes before merge.

---

## 8. Open questions (build pauses on the blocking ones)

1. **(BLOCKING — Timesheets tab) New project-scoped timesheet read.** The existing `listTimesheets(userId)` is user-scoped (own rows only) with **no project filter**; it cannot serve "all hours logged against this project across engineers." This tab requires a **new DAL function** (e.g. `listTimesheetEntriesByProject(projectId)`) returning entries joined to engineer name, RLS-scoped to org, and **role-gated** (should an Engineer see other engineers' hours on a shared project? — needs an explicit authorization decision + a pgTAP read-contract). **Cannot build the Timesheets tab as real data without this.** Options: (a) author the new query + RLS contract this issue; (b) ship the Timesheets tab as a deferred `ListState` placeholder too, like Tasks/Documents, until the query lands. **Recommend (a)** if the read is in scope; else (b). Owner/Director to decide scope + the cross-user visibility rule.
2. **(Owner scope decision) Tasks + Documents deferred modules.** Confirmed schema-ready, no DAL/UI. This plan ships them as on-brand `ListState` "coming soon" placeholders (NOT mockData). Confirm they stay deferred for this issue (default: yes, deferred).
3. **(BLOCKING-ish — e2e) AC-1011 selector brittleness.** The spec targets `div.rounded-xl` (gone after re-skin — radius becomes `md`/`rounded-lg`, and `rounded-xl` is banned) and an `h3` project name **in the Cards/Grid view** plus `project-status-control`. Default index view becomes **Table**, where the inline status control may not be present. Decision needed: (a) keep the inline `ProjectStatusControl` in **both** Table and Cards rows so the win-flow works from the default view and update the spec's container selector to a stable `data-testid` (recommend a `data-testid="project-row"` / `project-card`); or (b) have the spec switch to Cards view first. **Recommend (a)** + add stable test-ids during the re-skin so the journey stops depending on Tailwind class names. Coordinate with the spec owner (qa-acceptance).
4. **(Minor) Detail default tab.** Master plan §4.3 says Budget is the default ptab; confirm vs. Overview-first. Default: Budget.
5. **(Minor) Procurement-tab data path.** Recommend client-side filter of the cached `useProcurements()` list by `project_id` (no new DAL) per the documented "page filters cached list client-side" pattern; confirm acceptable vs. a dedicated `listProcurementsByProject`. Default: client-side filter.
6. **(Cleanup, non-blocking) `ProjectKanbanBoard.tsx`** is orphaned once Board view is dropped from the index. Leave in place this issue; flag for a later cleanup PR (don't touch unrelated surfaces here).
7. **(Carried, program-level) Categorical series colors → named tokens.** The icon-tile / avatar / (now-removed) chart hues are hard-coded HSLs; DESIGN.md only names `violet`. Carried from the program plan OQ-2 for promotion to `chart-*`/`avatar-*` tokens. Until then, the project icon tile uses `violet` (the one named categorical token).
8. **(Carried) Disabled / error field states** — DESIGN.md gap (program OQ-1). Relevant if the Edit-Project / New-Project forms land in this issue (currently stubs). Proposed: disabled = `opacity .5` + `not-allowed`; error border + helper = `destructive`. Needs sign-off before any form is wired.

---

## 9. Recommended impeccable references for implementation

`layout.md` (decomposition + stat-strip rhythm), `harden.md` (the deferred-tab placeholders + edge/error states), `clarify.md` (empty-state and "coming soon" copy), `adapt.md` (the table/cards/tabs responsive behavior). Foundation primitives are the source of truth for component internals — surfaces consume, never re-implement.
