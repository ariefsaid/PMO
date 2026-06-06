# UI Realignment Program — PMO Portal → IA-3 Hybrid

**Date:** 2026-06-06
**Author:** design-architect
**Status:** Design+Plan (master sequencing plan). Drives the Director's issue-by-issue build.
**Authorities:** `DESIGN.md` (token/identity authority) · `docs/design-mockups/proposal-IA-3-hybrid.html` (layout/IA authority) · `docs/product-expectations.md` Part C (charter)
**Method applied:** `impeccable shape` (UX/UI shaped before code) + `ui-ux-pro-max` `plan` (layout + 99-guideline checklist) + `ui-ux-pro-max` `design-system` (primitive→semantic→component token layering) + `taste` required-states / a11y / AI-tells folded into each issue's acceptance list. Reference/gap-analysis only — no aesthetic was invented.

> **Identity-preservation note.** `taste`'s aesthetic directives (ban Inter, "Bento 2.0", Framer perpetual motion, `rounded-[2.5rem]`, diffusion shadows) are **explicitly overridden** by `DESIGN.md`, which is the identity authority: Inter is mandated, depth is borders-not-shadows / flat-by-default, the radius scale is 4/6/8/10/999, motion is 120ms CSS transitions. We fold in only `taste`'s **discipline** items: full state cycles (loading/empty/error), `state-clarity`, disabled/focus semantics, anti-slop (no emoji icons, no fake/Jane-Doe data, SVG-only icons, one accent). When `taste` and `DESIGN.md` conflict on look, `DESIGN.md` wins.

---

## 1. Program goal & non-goals

**Goal.** Realign the live React app's **presentation and information architecture** to the owner-approved IA-3 hybrid — persistent left rail + top context bar + ⌘K + a closable tabbed workspace; every record surface is **index-first with view toggles**; a row click **drills to a full-page detail route** — while mapping every visual decision to a `DESIGN.md` token (RIS "Token System A", light scheme).

**Non-goals (locked).**
- **Not a data rewrite.** All TanStack Query hooks, the `src/lib/db/*` RPC/RLS access layer, snake_case row consumption, and the transition-RPC security pattern are **preserved as-is**. This program changes how data is *presented*, not how it is *fetched or authorized*.
- **Not a behavior change.** Existing routes, role-gating (`Sidebar.getNavItems`), auth (`AuthProvider`/`RequireAuth`), and Admin view-only impersonation (`ImpersonationProvider`, ADR-0008 — never touches RLS/`auth.uid()`) are preserved.
- **No new tokens, brand, palette, or font.** Light scheme only; the `prefers-color-scheme` dark effect and the `primary-50..950` ramp are **removed** (dark deferred).

**One blocking dependency.** Everything depends on **Issue 1 (Foundation)** landing first: the token pipeline, the new shell (rail + context bar + ⌘K + tab workspace), and the shared primitive library. No surface issue can start until its required primitives exist. Detailed Foundation plan: `docs/plans/2026-06-06-ui-foundation.md`.

---

## 2. Issue sequence & dependency order

Build strictly in this order. Each surface issue is a self-contained PR (per CLAUDE.md: one PR per issue), gated by `/design-review` before merge.

| # | Issue | Depends on | Net-new primitives it forces into Foundation |
|---|---|---|---|
| **1** | **Foundation** — token pipeline + app shell + shared primitives | — | (defines the whole library) |
| **2** | **Sales Pipeline** — index (Kanban+Table) + opportunity detail route | 1 | Kanban Column/Card, Funnel band, LifecycleStepper (inline pip variant), ViewToggle, DataTable, win%-bar cell |
| **3** | **Procurement** — index (Table+by-stage Board) + PR lifecycle detail route | 1, (reuses 2's Kanban + stepper) | LifecycleStepper (node variant), SoD gate notice, stat-row tiles, inline lifecycle pips cell |
| **4** | **Projects + ProjectDetails decomposition** — index (Table+Cards) + project detail route w/ in-page tabs (incl. versioned Budget) | 1, (reuses 2/3 primitives) | ProjectCard, PageHeader (phead), in-page Tabs (`ptabs`), version pills, budget DataTable + footer totals |
| **5** | **Dashboard + per-role sub-dashboards** — single pane, no toggle | 1, (reuses KPITile, charts, win-rate seg) | KPITile (dual-lens variant), recharts theming, donut/bvac chart wrappers, seg control |
| **6** | **Timesheets / Approvals** — Grid + Approvals-queue toggle | 1, (reuses ViewToggle, DataTable, gate, ListState) | Timesheet grid, hour-cell, approvals row, returned-week error banner |

**Why this order.** Pipeline (2) is the richest exercise of the table + kanban + drill-down + tab pattern, so building it second hardens the most-reused primitives early (Kanban, DataTable, ViewToggle, detail-route + tab integration). Procurement (3) and Projects (4) then largely *reuse* those primitives, only adding the stepper-node and in-page-tab variants. Dashboard (5) is mostly chart work on already-built KPI/seg primitives. Timesheets (6) is the most self-contained grid, last. Approvals is folded into Timesheets issue 6 (it is the Timesheets "Approvals queue" view toggle in IA-3, not a separate rail item — see §4.6).

**Routing/legacy preservation.** The existing routes in `App.tsx` (`/`, `/projects`, `/projects/:projectId`, `/projects/:projectId/budget`, `/sales`, `/procurement`, `/procurement/:procurementId`, `/timesheets`, `/approvals`, placeholders) are **kept as the canonical URL surface** — the tab workspace is an enhancement layer that syncs to these URLs (see Foundation §App shell). Detail pages remain standalone, deep-linkable full pages; tabs are not a prerequisite for drill-down (matches the mockup comment block).

---

## 3. Shared-primitive inventory (the component library)

Built in Issue 1 (Foundation). Each is token-mapped, full-state, a11y-complete, and test-first. Surfaces consume these; they never re-implement them. Full per-primitive spec + task breakdown is in the Foundation plan.

**Layer A — Shell (built once, in Foundation):**
`AppShell` (grid: rail / header / tabstrip / main) · `Rail` (224px, grouped nav, role-gated) · `ContextBar` (56px: breadcrumb · ⌘K trigger · notifications · user chip w/ impersonation) · `WorkspaceTabsProvider` + `TabStrip` · `CommandPalette` (⌘K) · `Breadcrumb` · `BackBar` (drill-return).

**Layer B — Primitives (built once, in Foundation):**
`Button` (primary / outline / ghost / destructive / success; sizes default 32px + sm 28px + icon) · `Badge`/`StatusPill` (dot + tinted: open/won/lost/overdue/neutral/draft) · `Card` (+ `CardHead`, `CardPad`, clip variant) · `KPITile` (+ dual-lens toggle variant) · `DataTable` (+ `Toolbar`, `SegFilter`, `SearchMini`, sortable `<th>`, `TableFoot` totals, row-hover `⋯` menu) · `ViewToggle` (segmented control) · `ProgressBar` (win%/utilization, threshold-colored) · `ListState` (loading skeleton / empty / error — the backlog's shared `<ListState>`) · `Tooltip` · `Toast`.

**Layer C — Composite primitives (built once in Foundation, *variants* added by the surface that first needs them):**
`KanbanColumn` + `KanbanCard` (Pipeline 2) · `LifecycleStepper` — inline-pip variant (Pipeline 2) + node-stepper variant (Procurement 3) · `Funnel` summary band (Pipeline 2) · `GateNotice` (blocked/ready SoD — Procurement 3, reused Timesheets 6) · `PageHeader` (phead) + in-page `Tabs` (ptabs) (Projects 4) · `ProjectCard` (Projects 4) · `StatTiles` row (Procurement 3) · `TimesheetGrid` + `HourCell` (Timesheets 6).

> Composite primitives live in the shared `ui/` library but their **first** consuming issue authors them. Foundation establishes the empty slots + the base `Kanban`/`Stepper`/`DataTable` shells; the surface issue fills the variant. This keeps Foundation buildable without front-loading all six surfaces.

---

## 4. Per-surface design specs

Each section gives: index-first IA, view toggles, full-page detail route, tab-workspace integration, key states, and the `DESIGN.md` tokens/components consumed. Tokens are always **named**, never literals.

### 4.1 Issue 2 — Sales Pipeline (`/sales`)

**Index-first IA.** Page head (title + sub + Export/New-Deal actions) → weighted **Funnel summary band** (5 open stages + Won/Lost) → standalone `Toolbar` (ViewToggle · Owner filter `control` · spacer · `SearchMini` · gross/weighted readout) → body. Clicking a deal **drills to the opportunity detail route** (see below).

**View toggles (`ViewToggle` segmented control).** **Kanban (default)** + **Table**. Persisted per-surface (`VIEW.pipeline`) in the tab's view-state (sessionStorage).
- *Kanban:* 6 columns (`minmax(258px,1fr)`, horizontal scroll), each a `KanbanColumn` (sticky blurred head: stage dot + title + win-prob chip + count + gross/weighted) holding `KanbanCard`s (customer-initial icon, name/customer, value, weighted chip, status pill, owner avatar + ref + decision date). Empty column → inline "No deals in {stage}".
- *Table:* `DataTable` columns Opportunity (proj cell: icon + name + mono code·ref) · Customer · Stage (StatusPill) · Owner (avatar + name) · Value (`num money`) · Weighted (`num money sub`) · Win% (ProgressBar, threshold-colored: ≥70 success / ≥40 warning / else destructive) · Decision.

**Full-page detail route.** `/sales/:opportunityId` (NEW route — pairs with existing `/sales`). `PageHeader` (customer-initial icon + name + status pill + meta: customer · mono id · customer ref · decision) → 5-stat strip (value / win-prob / weighted / owner / decision) → grid-2: "Opportunity journey" (inline lifecycle pip list) + "Next actions" (`GateNotice` ready + Advance/Add-note buttons). Returns via `Breadcrumb` + `BackBar` ("Back to Sales Pipeline").

**Tab-workspace integration.** Opening `/sales` focuses/creates the **Sales Pipeline module tab**. Drilling a deal navigates to `/sales/:id`, which **opens/refocuses a record tab** (`kind:"record"`, code = OPP-id, icon = pipe). Re-opening the same deal refocuses its existing tab. The module tab and record tabs coexist; the rail "Sales Pipeline" item shows active for either.

**Key states.** *Loading:* funnel + table/kanban skeleton via `ListState` loading (shimmer rows / skeleton cards). *Empty:* no deals → `ListState` empty ("No opportunities yet" + New Deal CTA); empty single column → inline message. *Error:* query error → `ListState` error banner (destructive-tinted, retry). *Edge:* Won/Lost deals show solid won/lost pills and are excluded from funnel/weighted totals; long deal names ellipsis at 40ch; filter-no-match → empty within current view.

**Tokens/components consumed.** `Funnel`, `KanbanColumn`+`KanbanCard`, `DataTable`+`Toolbar`+`SegFilter`+`SearchMini`, `ViewToggle`, `StatusPill`(open/won/lost), `ProgressBar`, `PageHeader`, `LifecycleStepper`(inline pip), `GateNotice`(ready), `Button`(outline/primary/sm), `BackBar`, `Breadcrumb`, `ListState`. Colors: `primary` (active/links), `success`/`warning`/`destructive` (win-% thresholds + status), `violet` (categorical avatar/stage dot only), `secondary` (tracks), `muted-foreground` (sub-values), `border` (dividers). Type: `page-title`, `heading`, `label`, `mono` (codes), `tnum` (all money/%). Radius `md`/`full`. **One Blue Rule** + **Tinted-Status Rule** enforced.

**Foundation dependencies.** Requires Kanban, DataTable, ViewToggle, StatusPill, ProgressBar, PageHeader, Funnel, inline-stepper, GateNotice, BackBar, Breadcrumb, ListState, tab/detail-route integration.

---

### 4.2 Issue 3 — Procurement (`/procurement`)

**Index-first IA.** Page head (title + sub + New-Request action) → standalone `Toolbar` (ViewToggle · Status filter `control` · spacer · `SearchMini`) → body. Row/card click drills to the PR lifecycle detail route.

**View toggles.** **Table (default)** + **by-stage Board**. Persisted (`VIEW.procurement`).
- *Table:* `DataTable` columns Request (proj cell: title + mono PR-id) · Project · Requested-by (avatar+name) · Value (`num money`) · **Lifecycle** (inline `LifecycleStepper` pips: PR→VQ→PO→GR→VI→Paid, done/current/paid pip variants + connecting links) · Status (StatusPill).
- *Board:* `KanbanColumn`s grouped by the 6 PR lifecycle stages (reuses Pipeline's Kanban), each holding compact PR cards (title + mono id + value + requester avatar + project). Empty stage → "No requests at {stage}".

**Full-page detail route.** `/procurement/:procurementId` (existing route). `PageHeader` (title + status pill + meta: mono PR-id · project · requested-by; Audit-trail action) → full **`LifecycleStepper` node variant** (6 nodes: done=check/success, current=primary ring, upcoming=muted, skipped=dashed; each with auto doc-ref PREFIX-YYMMDD####) → **`GateNotice` blocked** (SoD: requester cannot self-approve) → `StatTiles` row (PR value / selected quote / PO committed / received) → grid-2: Line items `DataTable` + Linked quotations list (selected pip + StatusPill) → `GateNotice` ready (advance). Returns via Breadcrumb + BackBar.

**Tab-workspace integration.** `/procurement` → Procurement module tab. Drill → `/procurement/:id` opens/refocuses a record tab (`kind:"pr"`, code = PR-id, icon = cart). A PR detail tab MAY carry the **dirty indicator** (`wt-dirty` amber dot) when it has an in-progress action — wired to existing transition state, not invented.

**Key states.** *Loading:* table shows the IA-3 skeleton rows pattern (`ListState` loading); board shows skeleton cards. *Empty:* `ListState` empty ("No purchase requests yet" + New Request). *Error:* `ListState` error + retry. *Edge:* SoD gate is **state-driven** — `blocked` when the effective role/identity cannot advance, `ready` otherwise (consumes existing RLS/role data; never bypasses it). Paid PRs show won-style pill; skipped lifecycle step renders dashed.

**Tokens/components consumed.** `DataTable`+`Toolbar`+`SearchMini`, `ViewToggle`, `KanbanColumn`/`KanbanCard`, `LifecycleStepper`(inline pip + node), `GateNotice`(blocked `warning`-tinted / ready `success`-tinted), `StatTiles`, `StatusPill`, `PageHeader`, `BackBar`, `Breadcrumb`, `ListState`, `Button`(outline/sm). Colors: `primary` (current step/links), `success` (done/paid/ready), `warning`+`warning-foreground` (blocked gate — note the deep-brown fg for AA), `destructive` (negative), `muted-foreground`, `border`. Type: `page-title`, `mono` (PR-id + doc-refs), `tnum`. **SoD gate copy must clear AA** on its tinted background (use `warning-foreground` / darkened success text per DESIGN.md a11y posture).

**Foundation dependencies.** Reuses Pipeline's Kanban/DataTable/ViewToggle/Stepper; adds node-stepper, GateNotice, StatTiles.

---

### 4.3 Issue 4 — Projects + ProjectDetails decomposition (`/projects`)

> This issue also **decomposes the ~1388-line `ProjectDetails`/mockData survivor** into the shared `PageHeader` + in-page `Tabs` + token-mapped budget `DataTable`, consuming real data via the existing `src/lib/db/budgets.ts` + `projects.ts` hooks. The decomposition is presentation-only — query contracts unchanged.

**Index-first IA.** Page head (title + sub + New-Project action) → standalone `Toolbar` (ViewToggle · spacer · `SearchMini`) → body. Row/card click drills to project detail route.

**View toggles.** **Table (default)** + **Cards**. Persisted (`VIEW.project`).
- *Table:* `DataTable` columns Project (proj cell: icon + name + mono PRJ-id·PO) · Customer · PM (avatar+name) · Status (StatusPill: Ongoing=open / At-risk=warn) · Contract · Committed (`sub`) · Actual · Progress (ProgressBar = actual/contract).
- *Cards:* `ProjectCard` grid (`auto-fill minmax(320px,1fr)`): icon + name + customer/mono-id + status pill, then contract/committed/actual rows, dual committed/actual progress bars, PM avatar + role.

**Full-page detail route.** `/projects/:projectId` (existing) with in-page `Tabs` (`ptabs`): **Overview · Budget (default) · Procurement · Team · Documents**. `PageHeader` (phead: 44px icon + name + status + meta: customer · mono id · customer PO + date) + 5-stat strip (contract / proposed / committed / actual / on-hand-margin in `success`).
- *Budget tab (the versioned-budget survivor, re-skinned):* version `Toolbar` (active `vpill` + version `control` + draft/archived vpills + Compare/Edit-draft) → `GateNotice` ready ("only one Active version is authoritative") → budget `DataTable` (7 cost categories: cat-dot + name · Budgeted · Committed `sub` · Actual · Variance colored success/destructive · Utilization ProgressBar threshold-colored) → `TableFoot` totals + dual-lens margin readout. Existing budget RPC/version data wired in unchanged.
- *Procurement tab:* filtered PR `DataTable` (reuses Procurement's row + pips) or `ListState` empty.
- *Team tab:* assigned-team list (avatar + name/role + utilization `tnum`).
- *Documents tab:* `ListState` empty ("No documents yet" + Upload CTA).
- *`/projects/:projectId/budget`* existing route preserved (deep-link to the Budget tab).

**Tab-workspace integration.** `/projects` → Projects module tab. Drill → `/projects/:id` opens/refocuses a record tab (`kind:"record"`, code = PRJ-id, icon = folder). In-page `ptabs` are **local UI state** within the detail page, distinct from the global workspace `TabStrip` — they do not create workspace tabs.

**Key states.** *Loading:* index skeleton; budget tab skeleton table. *Empty:* `ListState` empty (no projects / no PRs / no docs). *Error:* `ListState` error + retry. *Edge:* utilization >100% → ProgressBar fill turns `destructive`; negative variance → `destructive` text with a true minus glyph (−, not hyphen — per `taste` number rigor); At-risk status → `warn` pill; missing optional fields render an em-dash, never empty.

**Tokens/components consumed.** `DataTable`+`Toolbar`+`SearchMini`+`TableFoot`, `ViewToggle`, `ProjectCard`, `PageHeader`, in-page `Tabs`, version pills (`vpill` active/draft/archived → `success`/`warning`/`secondary` tints), `GateNotice`(ready), `ProgressBar`, `StatusPill`, `ListState`, `Button`(primary/outline/sm), `BackBar`, `Breadcrumb`. Colors: `primary`, `success` (margin/active/positive), `warning` (committed bars at `/.55`, at-risk, draft), `destructive` (overrun/negative), categorical `violet`/series colors for cat-dots (non-interactive only), `secondary`, `border`. Type: `page-title`, `subheading`, `label`, `mono`, `tnum`.

**Foundation dependencies.** Reuses DataTable/ViewToggle/ProgressBar/StatusPill/ListState; adds ProjectCard, PageHeader, in-page Tabs, version pills, TableFoot totals.

---

### 4.4 Issue 5 — Dashboard + per-role sub-dashboards (`/`)

**Index-first IA.** Single pane, **no view toggle**. Page head (title + sub + Win-rate-window `control` + Board-pack export) → 6-up `KPITile` band → grid-2 (Budget-vs-Actual by project + Win-rate card) → grid-2 (Committed-spend donut + Pipeline projected-margin bars).

**Per-role sub-dashboards.** The dashboard composition is **gated by `effectiveRole`** (the existing impersonation-aware role), reusing `Sidebar`'s role model — NOT a new permission system:
- *Executive/Admin:* full 6-KPI portfolio pane (above).
- *Project Manager:* KPIs scoped to delivery (active projects, budget-vs-actual, committed spend, at-risk) + the BvA-by-project card; pipeline/win-rate cards demoted or hidden.
- *Finance:* margin + committed-spend + budget-utilization emphasis.
- *Engineer:* timesheet/assignment-centric tiles (lightest dashboard).
Each sub-dashboard is the **same primitives, different selection** — KPITile, charts, seg controls. No bespoke per-role components. (Director to confirm exact per-role KPI selection against the data layer during the issue — see Open Questions.)

**Charts (recharts, themed from tokens per DESIGN.md §"How to use … Charts").** BvA bars/dual-bars, win-rate bar, committed-spend donut, projected-margin stage bars. Axis/grid → `border`/`muted-foreground`; primary series → `primary`; status series → `success`/`warning`/`destructive`; categorical → `violet` + the derived series hues already in the mockup's `BUDGET_CATS`/`STAGES`. No new chart colors invented.

**Key states.** *Loading:* KPI tiles → skeleton; chart cards → `ListState` loading (skeleton, never an empty axis frame — `loading-chart` guideline). *Empty:* per-card empty ("No data yet" + guidance — `empty-data-state`), never a blank chart. *Error:* per-card `ListState` error + retry. *Edge:* negative margin/delta values → `destructive` text + down-delta chip; dual-lens KPI toggles on-hand vs weighted; win-rate basis (count/value) + time-frame (90d/12mo/all) seg toggles preserve selection.

**A11y for charts (`ui-ux-pro-max` §10).** Each chart carries an `aria-label` summary of its key insight; donut/legend pairs name + value (not color-only); the BvA card is the table-alternative for screen readers; interactive seg toggles are `role="tablist"`/`aria-selected` and keyboard-reachable; tooltips keyboard-reachable, not hover-only.

**Tokens/components consumed.** `KPITile`(+ dual-lens), `Card`/`CardPad`, `SegFilter`, `ProgressBar`, recharts wrappers, `Button`(outline), `control`. Colors: `primary`, `success`/`warning`/`destructive` (deltas/series), `violet` + categorical series (non-interactive), `secondary` (tracks/lost), `muted-foreground`. Type: KPI value reuses `page-title`-class (~23px/700), `label`, `overline`, `tnum` mandatory on every figure.

**Foundation dependencies.** Reuses KPITile, Card, SegFilter, ProgressBar, ListState; adds dual-lens KPI variant + recharts theming + role-selection logic (presentation-side).

---

### 4.5 Issue 6 — Timesheets / Approvals (`/timesheets`)

**Index-first IA.** Page head (title + week range sub + Submit-week action) → standalone `Toolbar` (ViewToggle · spacer · week-nav `control`) → body. (No drill-to-detail route; this surface is grid-editing + queue, not records.)

**View toggles.** **Weekly grid (default)** + **Approvals queue** (the toggle count badge shows pending approvals). Persisted (`VIEW.timesheets`).
- *Weekly grid:* optional returned-week **error banner** (`err-banner`, destructive-tinted, Review action) → `Card` with status pill ("Draft — not submitted") + Add-project control → `TimesheetGrid` (project rows × 7 day `HourCell`s, weekend tinting, per-day + per-row totals, footer daily totals). HourCell empty/filled states; filled → `primary/.07` fill.
- *Approvals queue:* `GateNotice` blocked (SoD: cannot approve own/their-own week) → list of submitted timesheets (avatar + name + week·hours + status pill + Approve `success` / Return `outline` buttons).

> **Approvals is the toggle, not a separate rail item.** In IA-3, the legacy `/approvals` route's content surfaces as the Timesheets "Approvals queue" view. The existing `/approvals` route is **preserved** (deep-link) but the rail no longer lists Approvals as a top-level item once Timesheets owns the queue. (Confirm with owner — see Open Questions; until confirmed, keep both the rail item and the toggle.)

**Tab-workspace integration.** `/timesheets` → Timesheets module tab. The week grid is a module surface (no record tabs). Submitting/approving are existing transition RPCs — presentation only routes them; the dirty-tab indicator MAY reflect unsaved grid edits.

**Key states.** *Loading:* grid skeleton rows; queue skeleton. *Empty:* no projects on the timesheet → `ListState` empty ("Add a project to log hours"); empty approvals queue → "Nothing awaiting you". *Error:* `ListState` error + retry; returned-week banner is a **distinct, expected** error-style state (not a failure). *Edge:* daily-hours-exceeds-max validation surfaces inline (per the returned-week banner copy) — `error-clarity` (state cause + fix); weekend cells visually distinct; SoD prevents self-approval (state-driven from real role/identity).

**A11y.** HourCells are `role="textbox"` (or `<input type="number">` when wired to write — confirm) with per-cell `aria-label` "{project}, {day} hours"; the returned-week banner is `role="status"`; Approve/Return are full-label buttons; the queue's "4 awaiting you" is announced.

**Tokens/components consumed.** `ViewToggle`, `TimesheetGrid`+`HourCell`, `GateNotice`(blocked), `StatusPill`(neutral/open/overdue), `Button`(primary/success/outline/sm), `err-banner`(destructive-tinted), `Card`, `ListState`, `Breadcrumb`, badge-count. Colors: `primary` (filled cells/focus), `success` (approve), `warning`+`warning-foreground` (gate, returned), `destructive` (error banner), `secondary` (weekend/tracks), `muted-foreground`. Type: `page-title`, `label`, `tnum` (hours).

**Foundation dependencies.** Reuses ViewToggle, GateNotice, StatusPill, Button, Card, ListState; adds TimesheetGrid + HourCell + approvals row + returned-week banner.

---

## 5. Cross-cutting acceptance (every surface issue inherits)

Folded from `ui-ux-pro-max` 99-guideline checklist + `taste` discipline. Each surface PR's acceptance list MUST include:

- **States (taste Rule 5):** loading (skeleton matching layout, not a spinner), empty (composed, with the populating action), error (inline + retry) — all via the shared `ListState`.
- **A11y / WCAG-AA (ui-ux-pro-max §1):** AA contrast (status pills use DESIGN.md's **darkened text variants**, never base hue); global `:focus-visible` ring present on every focusable; tab order = DOM = rail → header → tabstrip → main; `aria-current="page"` on active rail item; `role="tablist"`/`aria-selected` on ViewToggle/seg/in-page tabs; `aria-label` on every icon-only button; `aria-checked` on custom checkboxes; charts have text/aria summaries; `color-not-only` (status = dot + text, never color alone).
- **Responsive (DESIGN.md + mockup breakpoints):** `≤1180px` KPI/grids collapse to fewer columns, funnel reflows; `≤920px` **rail hides** (`--rail-w:0`) + hamburger appears + ⌘K → icon + user/role text hide + tab strip remains scrollable; `≤560px` KPIs/funnel single/2-col. No horizontal scroll on body (only intentional kanban/table scroll regions).
- **Anti-slop (taste §7):** SVG icons only (no emoji) from one family/stroke-2; no fake/"Jane Doe" data (the real RLS data is the content); `tnum` on every figure; one `primary` blue (One Blue Rule, ≤10% of screen); borders-not-shadows (Flat-By-Default); no purple/neon/glass; minus sign `−` not hyphen for negatives; `prefers-reduced-motion` honored (skeleton shimmer + transitions disabled).
- **Tokens-only:** zero raw hex/px in the surface — every value names a `DESIGN.md` token (or a Tailwind utility mapped to one). The only literal HSLs permitted are the **categorical series colors** already enumerated in the mockup data (`STAGES`, `BUDGET_CATS`, `PEOPLE`), which are non-interactive chart/avatar accents derived from the palette — flagged in Open Questions for promotion to named `chart-*`/`avatar-*` tokens.
- **Behavior preserved:** the surface's existing TanStack Query hooks, role-gating, and transition RPCs are unchanged; this is a presentation swap.

---

## 6. Open questions (for owner / taste gate)

Carried from the Foundation plan + surface analysis; the build pauses on these:

1. **Disabled / error field states (DESIGN.md gap).** Source defined no disabled-control or error-field styling. Proposed (from DESIGN.md Open Questions): disabled = `opacity .5` + `not-allowed` + `pointer-events:none`; error field border + helper = `destructive`. Needs sign-off before forms land (Pipeline New-Deal, Timesheet entry, Procurement New-Request).
2. **Categorical series colors → named tokens?** The mockup hard-codes per-stage / per-category / per-person HSLs (e.g. `hsl(199 89% 48%)` cyan, `hsl(38 92% 50%)` amber-dot). DESIGN.md only names `violet` as categorical. Propose promoting the recurring set to named `chart-1..n` / `avatar-*` tokens so surfaces stay token-only. Owner to confirm the palette is frozen as-is (identity-preserving) vs. formalized.
3. **Approvals as a rail item vs. Timesheets toggle (IA-3 §4.6).** IA-3 folds Approvals into the Timesheets "Approvals queue" view; the live app has a standalone `/approvals` route + rail item. Keep both, or retire the rail item and route the queue through Timesheets? Default until decided: keep both.
4. **Per-role sub-dashboard KPI selection (Issue 5).** IA-3 shows one Executive pane; the live app gates nav by role. Confirm the exact KPI/card set per role (PM/Finance/Engineer) against what the dashboard data layer (`src/lib/db/dashboard.ts`) can return, so we don't promise a metric the RPC doesn't expose.
5. **Tab persistence scope.** Workspace tabs persist in `sessionStorage` (per-tab/session) per the Foundation plan. Confirm this is desired vs. `localStorage` (survives browser restart). Default: `sessionStorage`.
6. **Mobile tab workspace.** At `≤920px` the rail hides; should the tab strip also collapse to a single active-tab pill + overflow, or stay a horizontal scroll strip? Default: horizontal scroll strip (matches mockup), revisit if it crowds the 360px viewport.

---

## 7. Definition of done (program level)

- Each surface issue: its own PR, `/design-review` passed, `npm run typecheck` + ESLint clean, ≥80% line coverage on changed code, all `AC-###` owned at the lowest sufficient layer (ADR-0010).
- No `DESIGN.md` token invented; every surface decision traces to a named token.
- Storybook adopted at this program's component-library extraction (Phase 3 / Foundation) — per-component state matrix + a11y addon (charter Part C).
- Foundation merged before any surface issue starts. Surfaces merged in dependency order (§2).
