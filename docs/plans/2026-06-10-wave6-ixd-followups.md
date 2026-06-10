# Design-plan — Wave-6 IxD follow-ups

- **Date:** 2026-06-10
- **Author:** design-architect (Opus 4.8)
- **Skills discipline:** `impeccable shape` (plan UX before code) + `ui-ux-pro-max plan` (layout + 99-guideline checklist) + `taste` required-states / a11y / anti-slop fold.
- **Authority:** `DESIGN.md` (repo root) is the single source of truth. **No new aesthetic.** Every visual decision below names a `DESIGN.md` token, never a literal. Where a literal is currently in code (e.g. `text-[13.5px]`) it is the existing system idiom and is preserved verbatim.
- **Scope:** read-only on prod code by the planner; this plan is what `ui-implementer` builds to and `design-reviewer` audits (3-lens RENDERED per `docs/design-workflow.md`).
- **Inputs:** confirmed rendered-review IxD triage + two locked owner decisions (baked in below, not re-litigated).
- **Test layering:** ADR-0010. Each `AC-###` is owned at the lowest sufficient layer; mostly Unit/RTL, with **render-position** assertions where layout/order matters (per the durable Wave-5-C3 lesson: assert DOM order vs landmarks, not component existence in isolation).

---

## 0. Verification of the file:line claims (done before planning)

| Claim | Verified? | Note |
|---|---|---|
| `DataTable` `RowMenu` renders `absolute right-0 z-50` (DataTable.tsx ~414-417) | ✅ | Confirmed at L417: `className="absolute right-0 z-50 mt-1 …"`. Trigger+menu live in a `relative` wrapper (L397). |
| nested inside `overflow-x-auto` (L158) within `overflow-hidden` wrapper (L155) | ✅ | Desktop branch `<div data-testid="dt-table-branch" className="overflow-x-auto">` (L158) inside `<div className="overflow-hidden rounded-b-lg …">` (L155). Both clip the abs-positioned menu. |
| `RowMenu` already has Esc-close + click-outside + `role=menu`/`menuitem` + `aria-haspopup`/`aria-expanded` | ✅ | L380-394 (Esc + mousedown-outside), L416 `role="menu"`, L430 `role="menuitem"`. **No arrow-key roving / no focus-into-menu / no focus-return today** — gap to close. |
| ProjectBudget renders `<h2>Project Budget</h2>` (ProjectBudget.tsx ~698) under the "Budget" tab | ✅ | L698 `<h2 className="text-[20px] font-bold …">Project Budget</h2>`; mounted via `BudgetTab` → `ProjectDetail` tablist (tab label "Budget"). The `<h2>` duplicates the tab label. "Active budget: $X" is the sub-line at L699-704; "+ New version" primary at L706-710. |
| TimesheetGrid note = always-on full-width bordered `h-8` input in sticky left col (TimesheetGrid.tsx) | ✅ | L172-181: `<input … placeholder="Add a note" className="touch-target mt-1 h-8 w-full rounded-md border border-border bg-card …">`. Same `border-border` weight as hour cells (L230). Editable mode only. |
| Incidents create-form Date `initialValues` empty (Incidents.tsx ~408) | ✅ | L408 `incident_date: incident?.incident_date ?? ''` → for **create** (`incident===null`) the date is `''`. Severity defaults `'Low'` (L410) — leave. |
| Tasks tab uses shared `DataTable`, `rowMenu` has Edit + Delete (TasksTab.tsx) | ✅ | L258-263 `<DataTable … rowMenu={canRowWrite ? rowMenu : undefined}>`; `rowMenu` L192-197 pushes `Edit` (opens `setFormTarget`) + `Delete` (danger). **`onActivate` / `rowLabel` are NOT currently passed** → today rows are not row-clickable. The edit modal already exists (`TaskFormModal`). |
| Exec dashboard: two `tone="violet"` tiles on one row (ExecutiveDashboard.tsx) | ✅ | L117 `kpi-pipeline-weighted-value` violet + L133 `kpi-active-projects` violet, same row. `KPITone = 'blue'\|'violet'\|'amber'\|'red'\|'green'` — **no `neutral` tone exists** (KPITile.tsx L8). Relevant to the optional task below. |
| ProgressBar supports `tone` override + threshold bands; at-risk band = destructive (H8) | ✅ | ProgressBar.tsx L36-40: `>=90 destructive`, `>=70 warning`, else `success`; `tone` prop overrides. Projects "Progress" passes no tone → threshold-colored on **contract-basis** value. |

All claims verified. No discrepancies. One additive finding folded in: the at-risk budget caption already exists on the Projects row (`{budgetPct}% of budget`, Projects.tsx L240-244) — the at-risk co-location work **refines** that, it does not create it from nothing.

---

## PR breakdown

| PR | Items | Rationale |
|---|---|---|
| **PR-A** | **I7** DataTable `RowMenu` clip fix (app-wide primitive) | Single primitive touched by every list surface → its own rendered review + a dedicated full-suite e2e/unit pass. Isolated so a regression here is attributable. **No other item rides this PR.** |
| **PR-B** | **at-risk co-location** + **AC-W6-IXD-TASKROW** (row-click→edit) + **J1** budget double-header + **I1** timesheet note demote + **I2/I3** incident date default | The IxD surface bundle — page-level, low blast-radius, one rendered review covers the cluster. |

Optional / deferred (see §8): Exec two-violet-chips (cosmetic; needs a tone decision); Reports placeholder (deferred until Reports ships).

> Sequence PR-A first (primitive lands + is reviewed in isolation), then PR-B. PR-B's task-row change and I1 both sit on top of an unchanged `RowMenu` contract; if PR-A re-orders, rebase PR-B.

---

## PR-A — I7: DataTable row-menu must escape the overflow clip

**AC-W6-IXD-MENU** · `src/components/ui/DataTable.tsx` (`RowMenu`) · **blast radius: every `DataTable` in the app** (Projects, Tasks, Incidents, Companies, Documents, Procurement lists, /approvals timesheet queue, …).

### Problem (verified)
The open menu is `position: absolute` inside the `overflow-x-auto` table branch, itself inside the `overflow-hidden` rounded wrapper. Both ancestors establish a clipping context, so the popover is cut (≈66px clipped at 1440px; effectively off-screen at 375px on the mobile card branch where the card is narrow). Tests pass because jsdom has no layout/overflow — this is a render-only defect (the recurring "tests green, render wrong" class).

### Behavior contract (the testable spec; implementation left to ui-implementer)
The implementer picks ONE of two mechanisms; the **contract** below is what `design-reviewer` audits at 375 / 768 / 1440, and what tests assert:

- **(Preferred) Portal to `document.body` with trigger-anchored `fixed` positioning.** Render the open `role="menu"` via a React portal outside the clipping ancestors; position it `fixed` against the trigger's `getBoundingClientRect()`, right-aligned to the trigger; flip to open **upward** when the trigger is within ~`spacing.6` (24px) × (item-count) of the viewport bottom, and clamp horizontally so the menu never overflows the viewport's right/left edge (respect `max-[921px]:px-4` gutters).
- **(Fallback) In-flow flip-up + raise the clip.** If a portal is undesirable, the menu may stay in-flow but the implementer must remove the clipping on the ancestor for the open state (e.g. the table wrapper uses `overflow-visible` while a menu is open, or the menu renders into a non-clipped layer) AND flip-up near the container bottom. This is harder to get right across the sticky `<thead>`/`overflow-x-auto`; the portal is preferred.

**Either way, the menu must render fully visible regardless of row position or viewport.**

### a11y requirements (close the existing gaps — preserve what's there)
- **Preserve (already present):** `aria-haspopup="menu"`, `aria-expanded`, `role="menu"`, `role="menuitem"`, `role="separator"`, Esc-to-close, click-outside-close, danger items in `destructive`.
- **Add — focus management:** on open, move focus to the **first** `menuitem`; on close (Esc, click-outside, item-activate, or trigger toggle-off) **return focus to the trigger** `<button>`.
- **Add — keyboard nav:** `ArrowDown`/`ArrowUp` roving focus across `menuitem`s (wrap at ends); `Home`/`End` to first/last; `Enter`/`Space` activates the focused item; `Tab`/`Shift+Tab` closes the menu and returns focus to the natural tab flow (menus are not tab-stops internally).
- **Add — `aria-orientation="vertical"`** on the `role="menu"` container.
- **Focus ring:** menu items inherit the global `:focus-visible` ring (`2px {colors.ring}`, 2px offset) — DESIGN.md §Accessibility. No per-item focus invention.
- **`stopPropagation` preserved:** the wrapper's `onClick={(e) => e.stopPropagation()}` (L397) must survive any refactor so the menu never triggers the row's `onActivate` (load-bearing once PR-B makes rows clickable).

### Tokens (`DESIGN.md`)
The menu surface is unchanged — keep the existing overlay recipe verbatim: `bg-popover`, `border border-border`, `rounded-lg` (`{rounded.lg}` 10px — the shipped value; preserved), `p-[5px]`, **Overlay shadow** `shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]` (DESIGN.md §4 "Overlay" / popover row-menu — the single sanctioned popover shadow). Items: `h-8` (32px control standard), `rounded-md` (`{rounded.md}`), `text-[13.5px]`, hover `bg-accent`, danger `text-destructive`, separator `bg-border`. Trigger: `size-7`, `rounded-md`, `text-muted-foreground`, hover `bg-accent`/`text-foreground`, `.touch-target` (≥44px coarse-pointer) — all preserved.

### States
- **default (closed):** trigger only (always visible — B-4 contract, do not regress to hover-only).
- **open:** menu in viewport, fully visible at any row position / viewport.
- **empty items:** `RowMenu` is only rendered when `items.length > 0` (callers gate; mobile branch guards at L332). Contract: if items is empty, render nothing (no empty popover).
- **loading / error:** N/A — `RowMenu` is per-row chrome; the table's async states replace the body (`state` prop) so no menu exists.
- **edge — last row / bottom of viewport:** flip-up. **edge — narrow viewport (375px mobile card):** clamp within gutters, right-aligned to trigger, never off-screen.

### Responsive
- **1440 / 768 (table branch):** anchored to the `⋯` cell, right-aligned, flips up near the page bottom.
- **375 (card branch):** trigger is top-right of the card (L331-336); menu anchors to it, right-aligned, clamped to the `max-[921px]:px-4` gutter; flip-up if the card is low in the viewport.

### TDD task list (PR-A)
Each task is one red→green increment. Owning layer in brackets.

1. **[Unit/RTL]** `AC-W6-IXD-MENU` — *"row menu renders fully visible (not inside a clipping ancestor)"*: render a `DataTable` with `rowMenu`, open the menu, assert the `role="menu"` node is **not a descendant of the `overflow-hidden`/`overflow-x-auto` wrapper** (portal case: assert it is a child of `document.body` / outside `dt-table-branch`; flip-case: assert the wrapper carries `overflow-visible` while open). Owning test: `DataTable.rowmenu-clip.test.tsx`, `it('AC-W6-IXD-MENU: …')`. *(2-4 min)*
2. **[Unit/RTL]** focus-to-first-item on open; focus-returns-to-trigger on Esc and on item-activate. *(3-5 min)*
3. **[Unit/RTL]** ArrowDown/ArrowUp roving (wraps), Home/End, Enter/Space activates focused item, `aria-orientation="vertical"` present. *(3-5 min)*
4. **[Unit/RTL]** regression: opening the menu and clicking an item does **not** fire the row's `onActivate` (stopPropagation preserved) — guards PR-B. *(2 min)*
5. **[Unit/RTL]** existing `RowMenu` behavior unchanged: `aria-haspopup`/`aria-expanded` toggle, danger separator placement (`needsSep` logic), click-outside-close. (Re-run the existing DataTable suite — must stay green.) *(2 min)*
6. **[Render — design-reviewer, not a unit test]** RENDERED at 1440 / 768 / 375: menu fully on-screen for the **last** row and for a row near the viewport bottom; menu flips up; mobile card menu within gutters. CDP AX-tree check: menu items present + focus order correct. *(reviewer task — note in the plan, not an `it()`)*

**Blast-radius gate:** the full existing unit suite + the ~6-8 curated e2e journeys touching list surfaces (Projects, Tasks, Incidents, /approvals) must stay green against the FULL serial suite (db-reset + broad run — the P011 lesson), not just in isolation. No AC pushed up a layer.

---

## PR-B — IxD surface bundle

### B-1 · At-risk Progress / budget co-location (AC-W6-IXD-ATRISK)

**Owner decision (baked in):** CO-LOCATE the budget-util basis with the delivery-progress bar — **do NOT recolor the bar.** Keep the delivery-progress (spend-of-contract) bar; place the budget-util reading immediately adjacent. Must read as TWO clear metrics, kill the green-bar/at-risk-pill glance-contradiction, and preserve the Wave-5 I3 two-metric split.

**Chosen treatment: (b) inline "x% of budget" basis text immediately adjacent to the bar — NOT a second sub-bar.** Justification against `DESIGN.md`:
- **Text-not-color / Tinted-Status Rule:** the system communicates state with text + tint, and explicitly reserves bars for a single metric. A second sub-bar under the delivery bar would put **two bars of different bases stacked** — the exact glance-ambiguity we are removing (which bar is "progress"?). A short tabular caption is unambiguous and matches the existing I3 pattern already shipped on the Projects row (`{budgetPct}% of budget`, L240-244).
- **Tabular-Numbers Rule:** the budget figure is a metric → `tabular` (mandatory).
- **One-bar honesty:** the `ProgressBar`'s own `aria-label` already says *"% of contract"* — keeping it single-metric keeps that label honest. The budget basis is a sibling label, not a competing fill.
- **The bar stays threshold-colored on its contract-basis value** (no tone override) — owner: do not recolor.

#### Projects list row (compact) — `pages/Projects.tsx`
Today the "Progress" column renders only the `<ProgressBar … aria-label="Spend: N% of contract">` (L296-303), and the budget basis is shown over in the **Project** cell as `{budgetPct}% of budget` only when at-risk (L240-244). Refinement: **co-locate the budget basis WITH the bar** so the two metrics sit together and the contradiction is killed at the bar, not two columns away.
- Restructure the `progress` column cell to a 2-line stack: line 1 = the existing `<ProgressBar value={contractPct} showValue compact aria-label="Spend: N% of contract">`; line 2 (only when `isAtRisk(p)`) = a caption `{budgetUtilPct(p)}% of budget`.
- Caption tokens: `text-[11px] font-semibold tabular text-warning-foreground` — **reuse the exact existing idiom** from the Project cell (L241) so there is one budget-basis voice. `warning-foreground` is the AA-clearing deep-brown (DESIGN.md §2 Warning Amber) — text-not-color, clears AA on white.
- **Remove the now-duplicated `{budgetPct}% of budget` line from the Project cell** (L237-244) so the basis appears **once**, beside the bar. The "At risk" pill stays in the Project cell next to the name (L226-227) — pill = the *flag*, caption = the *why/where* (next to the metric it explains). This preserves the I3 two-metric split while removing the cross-column scatter.
- Non-at-risk rows: bar only (caption absent) — no caption noise on healthy rows.

#### Project Overview tab (full) — `pages/project-detail/tabs/OverviewTab.tsx`
Today the "Budget utilization" card (L136-150) shows "$spent of $contract contract spent" + a full `<ProgressBar value={spendPct} showValue aria-label="Spend: N% of contract">`. It currently shows **only** the contract basis — so an at-risk project reads as a calm mid bar with no budget signal.
- Add, immediately **below** the bar (inside the same `CardPad` flex-col), a budget-basis line shown when at-risk: a small dot+text row — `{budgetUtilPct}% of budget` caption in `text-[12px] font-semibold tabular text-warning-foreground`, prefixed by the **"At risk" `StatusPill variant="warn"`** so the Overview carries the same flag the Projects row does. (DESIGN.md: status = dot+tinted pill; caption = tabular text-not-color.)
- Keep the existing contract-basis line + bar unchanged (the I3 split: contract bar above, budget basis below).
- Use shared `isAtRisk(project)` / `budgetUtilPct(project)` from `@/src/lib/dashboardConstants` (already imported pattern; `budget>0`-guarded) — no new threshold, no recomputation.

**States** (both surfaces): default (healthy) = bar only; **at-risk** = bar + budget caption (+ pill on Overview). loading/empty/error are owned by the parent list/card states (unchanged). **edge:** `budget===0` → `isAtRisk` is false (guarded) → no caption, no divide-by-zero.

**Responsive:** caption is a single short tabular line — wraps under the bar at 375 (Projects card branch renders the `progress` column as a `<dd>`; the stacked caption rides with it). 768/1440 unchanged structurally.

**a11y:** caption is plain text (announced after the `progressbar` in DOM order). The `progressbar` keeps `aria-valuenow`/min/max + its contract-basis `aria-label`. The "At risk" pill text is real text (not color-only). No focus change. Contrast: `warning-foreground` on white ≥4.5:1 (DESIGN.md posture).

**TDD tasks (B-1):**
1. **[Unit/RTL render-position]** `AC-W6-IXD-ATRISK` (Projects) — for an at-risk row, the `progressbar` and the `% of budget` caption are **siblings in the same Progress cell** (assert the caption is within the same `<td>`/`<dd>` as the progressbar, and is **absent** from the Project/name cell). For a healthy row, no caption anywhere. *(3-5 min)* — owning layer Unit.
2. **[Unit/RTL]** `AC-W6-IXD-ATRISK` (Overview) — at-risk project renders the bar + a `% of budget` caption + an "At risk" pill below the contract line; healthy project renders bar only. *(3-4 min)*
3. **[Unit/RTL]** edge: `budget===0` → no caption, no NaN. *(2 min)*
4. **[Render]** reviewer confirms at 1440/375 the two metrics read distinctly and the green-bar/red-pill contradiction is resolved (caption sits with the bar).

---

### B-2 · Task row click opens the Edit modal (AC-W6-IXD-TASKROW)

**Owner decision (baked in):** row click opens the **existing** Edit modal (`TaskFormModal`) — **no new task-detail route.** The `⋯` menu keeps Delete; clicking `⋯` must NOT also open the row (stopPropagation). Row must be keyboard-activatable + have a `role`/`cursor` affordance + `aria` for "opens editor"; reachable + operable by keyboard, not just mouse.

`pages/project-detail/tabs/TasksTab.tsx`. The shared `DataTable` already supports exactly this via `onActivate` + `rowLabel` (DataTable.tsx L38-48, L230-254): when both are supplied, the first column's content is wrapped in a real focusable `<button aria-label={rowLabel}>` (keyboard + SR reachable) and the whole `<tr>` gets `cursor-pointer hover:bg-accent/60` + `onClick`. The `RowMenu` wrapper already `stopPropagation`s (L397, hardened in PR-A). So this is **wiring the existing primitive, not new mechanics.**

- Pass `onActivate={(t) => setFormTarget({ task: t })}` to the `<DataTable>` (L258-263) — opens the existing edit modal.
- Pass `rowLabel={(t) => \`Edit ${t.name}\`}` — the activation `<button>`'s accessible name explicitly says it opens the editor (DESIGN.md a11y posture: name says what it does). This satisfies the "aria for opens editor" requirement.
- **Gate by permission:** only wire `onActivate`/`rowLabel` when `canEdit` is true (`may('edit','task')`). For a viewer who cannot edit (e.g. Engineer on others' tasks), the row is **not** activatable (no false affordance — DESIGN.md honest-affordance; matches the existing `rowMenu={canRowWrite ? … : undefined}` gating). Use `canEdit ? onActivate : undefined` / `canEdit ? rowLabel : undefined`.
- **First-column collision check:** the Task `name` cell (L155-159) currently renders a plain `<span>` — NOT its own focusable control — so wrapping it in the activation `<button>` does **not** nest interactive elements (the `rowLabel` contract's stated guard, L43-46). ✅ Safe.
- The `⋯` menu keeps **Edit + Delete** (L192-197). Note: with row-click→edit now present, the menu's "Edit" item is redundant-but-harmless (a second path to the same modal). **Recommend keeping both** (the explicit menu Edit is the discoverable/keyboard-via-menu path; row-click is the fast path) — do not remove it; removing it would surprise existing-test/e2e expectations. (Reviewer's call if they want it dropped — flag, don't force.)

**States:** default = row hover wash (`accent/60`) + `cursor-pointer`; focus = activation button shows the global focus ring; loading/empty/error owned by `DataTable` `state` (TasksTab passes `state` via the `view==='list'` branch — unchanged). **edge — board view:** unchanged (cards already open status `<select>`; this change is list-view only).

**Responsive:** at 375 the card branch already wraps the first column in the same activation button (DataTable.tsx L318-326) — wiring `onActivate`/`rowLabel` lights up mobile tap-to-edit for free, with `RowMenu` (Delete) top-right. 768/1440 = full-width row click.

**a11y:** the `<tr>` keeps its implicit `role="row"` (DataTable explicitly does NOT set `role="link"` — preserves `getByRole('row')` + table semantics, L213-218). The keyboard/SR affordance is the real `<button>` in cell 0 (Enter/Space natively activate a `<button>`); whole-row `onClick` is a pointer convenience only. `stopPropagation` on `⋯` (L397/PR-A) prevents double-fire. No new ARIA invented.

**TDD tasks (B-2):**
1. **[Unit/RTL]** `AC-W6-IXD-TASKROW` — with `canEdit=true`, clicking a task row (and pressing Enter on its activation button) opens the edit modal (`getByRole('dialog', {name:/Edit task/i})`), pre-filled with that task. *(3-5 min)*
2. **[Unit/RTL]** the activation button's accessible name is `Edit <task name>` (the "opens editor" aria). *(2 min)*
3. **[Unit/RTL]** clicking the `⋯` → Delete does **not** open the edit modal (stopPropagation). *(2 min)*
4. **[Unit/RTL]** with `canEdit=false` (e.g. Engineer), the row is NOT activatable (no activation button / no `cursor-pointer` row onClick) — no false affordance. *(3 min)*

---

### B-3 · Budget tab double-header (AC-W6-IXD-BUDHEAD)

`pages/ProjectBudget.tsx` `head` (L695-712). The `<h2>Project Budget</h2>` (L698) duplicates the "Budget" tab label that already names the section.

- **Drop the redundant `<h2>`.** Promote the useful "Active budget: $X" line as the section lead.
- New header structure: a `<div>` lead containing the **"Active budget: $X"** line (keep `data-testid="derived-budget"` + `font-semibold tabular text-foreground` on the figure — Tabular-Numbers Rule), with a quiet `text-muted-foreground` label "Active budget:". Keep "+ New version" primary `<Button variant="primary">` on the right (L706-710, unchanged).
- **Heading-level a11y:** the tab (`role="tab"` "Budget" in `ProjectDetail`'s tablist) is the section label; the tabpanel is its named region. Removing the `<h2>` removes a redundant heading — it does **not** orphan hierarchy (the page `<h1>` is the project name in the detail header; the tab provides the section name). To keep the lead readable by AT as a label without re-introducing a competing heading, render "Active budget: $X" as a plain labelled line (no heading role). If a reviewer wants an explicit accessible name on the tabpanel content, the existing tablist `aria` already covers it — do not add an `<h2>` back.
- **Empty state** (L714-738) and **normal state** (L744+) both render the same `head` const — the fix applies to both automatically. Loading/error are owned by `ProjectBudget`'s internal states (unchanged).

**Milder analogs (note, do NOT force):** `TasksTab` renders `<h2>Tasks</h2>` under the "Tasks" tab (TasksTab.tsx L203) and the Documents tab likely mirrors it. These are **softer** duplications because they carry a sub-line description ("Plan, assign, and track…") that adds info the tab label doesn't. **Leave them this PR** — flag for a future consistency sweep; only Budget's `<h2>` is a pure no-info duplicate of the tab + the adjacent "Active budget" line.

**Responsive:** `flex flex-wrap items-start justify-between` (L696) already wraps the "+ New version" button under the lead at 375 — unchanged. **a11y:** one fewer heading, no orphan. **Tokens:** lead label `text-sm text-muted-foreground` (Body/muted), figure `font-semibold tabular text-foreground`; button `button-primary` (DESIGN.md component). No new token.

**TDD tasks (B-3):**
1. **[Unit/RTL]** `AC-W6-IXD-BUDHEAD` — `ProjectBudget` does **not** render a heading with text "Project Budget" (assert `queryByText('Project Budget')` is null / no `<h2>` with that text), while "Active budget:" + the formatted figure (`derived-budget` testid) **and** the "+ New version" button (when `canWrite`) are present. *(3-4 min)*
2. **[Unit/RTL]** the existing test `ProjectDetail.test.tsx:160` (`expect(screen.getByText('Project Budget'))`) must be **updated**, not the app bent to it — the deliberate UX change removes that heading, so the test's oracle changes to assert the tab is selected + the "Active budget" lead is present (BDD authoring rule: deliberate UX change → update the journey, keep the goal honest). *(2 min)*

---

### B-4 · Timesheet note — demote (AC-W6-IXD-NOTE)

`src/components/ui/TimesheetGrid.tsx` editable branch (L172-181). Today: an always-on full-width `h-8` input with `border border-border` (same weight as hour cells), in the sticky left column, eating a row's height on mobile.

**Owner-direction = demote.** **Primary treatment: collapse-on-demand.**
- **Collapsed state (default, no note content):** a quiet, real `<button>` "+ Note" affordance under the project name/code — `type="button"`, `text-[11px] font-semibold text-muted-foreground`, a small `plus`/note icon, `hover:text-foreground`, `.touch-target` for ≥44px coarse-pointer hit-area, global focus ring. Accessible name: `Add note to <project>`. On click → expands to the input + focuses it.
- **Expanded state (note has content OR user clicked "+ Note"):** the existing `<input aria-label="<project> note" placeholder="Add a note">` — but **demoted visually**: drop the full box border to a lighter treatment so it no longer competes with hour cells. Use `border-0 border-b border-border bg-transparent` (a single bottom hairline, the DESIGN.md Single-Border value) instead of the full `border border-border` box, `rounded-none`, keep `h-8` + `text-[13px]` + `placeholder:text-muted-foreground`. This is the "lighter visual treatment" fallback applied as part of the expanded state so even expanded it reads quieter than the hour cells.
- **Always-editable invariant:** if a note already has content (`notes?.[r.id]` non-empty), the grid renders **expanded** (input visible) on mount — existing note content is never hidden behind the collapse. The collapse only hides the *empty* affordance.

**Tokens:** `+ Note` button = `text-[11px] font-semibold text-muted-foreground` (Overline/label voice), hover `text-foreground`, `.touch-target`. Expanded input = `border-b border-border` (Single-Border Rule — no second border color), `bg-transparent`, `text-[13px] text-foreground`, `placeholder:text-muted-foreground`, focus ring global. No new token.

**States:** collapsed (empty, default) = "+ Note" button only; expanded (has content OR clicked) = hairline input; read-only grid branch = no note affordance at all (unchanged, L193-205). loading/empty/error owned by the parent timesheet page.

**Responsive:** collapsing reclaims the per-row height at 375 (the owner's "eating a row on mobile" complaint) — the note is one quiet line until invoked. 768/1440: same, less visual weight from the lighter border. The sticky-left-column layout (L156) is unchanged.

**a11y:** the affordance is a **real labelled `<button>`** (keyboard-operable, Enter/Space) — not a div. On expand, focus moves to the input. The input keeps its `aria-label="<project> note"`. Existing note content is always visible/editable (invariant above). Delete-row button (L183-191) unaffected.

**Fallback (if collapse-on-demand is judged too heavy for the dense grid):** skip the collapse; apply only the lighter visual treatment to the always-on input — `border-0 border-b border-border bg-transparent rounded-none` (the hairline), keeping it always visible but visually demoted below the hour cells. This is strictly the expanded-state styling minus the toggle. Reviewer decides primary-vs-fallback at render time.

**TDD tasks (B-4):**
1. **[Unit/RTL]** `AC-W6-IXD-NOTE` — editable grid with an **empty** note renders a `Add note to <project>` button and NOT the input; clicking it reveals the input and moves focus to it. *(3-5 min)*
2. **[Unit/RTL]** editable grid with **existing** note content renders the input expanded (content visible/editable) without needing a click. *(2-3 min)*
3. **[Unit/RTL]** read-only branch renders no note affordance (unchanged). *(2 min)*
4. **[Unit/RTL]** typing in the expanded input still fires `onNoteChange`. *(2 min)*
   *(If the fallback is chosen, task 1 collapses to "input present with the demoted hairline class"; goal-oracle = note still editable.)*

---

### B-5 · Incident create-form date default (AC-W6-IXD-INCDATE)

`pages/Incidents.tsx` `initialValues` (L407-413). For **create** (`incident===null`) the date is `''`; the dominant case is filing a same-day incident.

- Default `incident_date` to **today** in `YYYY-MM-DD` (the `<input type="date">` value format). For **edit**, keep `incident?.incident_date` (unchanged). So: `incident_date: incident?.incident_date ?? <todayISO>`.
- Compute today as a local-date ISO string (avoid the UTC-midnight off-by-one): a small local helper (`new Date()` → `toISOString().slice(0,10)` is acceptable if the app's existing date handling uses UTC dates; otherwise build `YYYY-MM-DD` from local `getFullYear/getMonth/getDate`). **Verify** which convention `incident_date` columns use before picking — match the existing project date convention (the DB stores `date`, not `timestamptz`, so local-date string is correct). Implementer: use the local-date construction to be safe.
- Severity already defaults `'Low'` (L410) — **leave.** The `requiredFields: ['incident_date','type']` gate (L417) now starts satisfied for date, so submit stays blocked only on `type` — desirable (date pre-filled, type still a deliberate choice).

**Tokens:** none (value-only change). **States:** create form opens with today pre-filled; user can change it. edit unchanged. **a11y:** none changed (field already labelled, required). **Responsive:** none.

**TDD tasks (B-5):**
1. **[Unit/RTL]** `AC-W6-IXD-INCDATE` — opening the **create** incident form pre-fills the Date field with today's local `YYYY-MM-DD`; the **edit** form still shows the incident's stored date. *(2-3 min)*

---

## PR-B render gate
One rendered design-review (3-lens) covers the bundle at 375 / 768 / 1440: at-risk two-metric legibility (B-1), task-row hover/focus/keyboard-edit (B-2), Budget header has no double title (B-3), timesheet note demoted/collapsed (B-4). Full unit suite + curated e2e green against the FULL serial suite.

---

## Traceability

| AC | Item | Surface | Owning test layer | Owning test (file → title) |
|---|---|---|---|---|
| `AC-W6-IXD-MENU` | I7 row-menu clip + a11y | `DataTable` (app-wide) | Unit/RTL (+ render gate) | `DataTable.rowmenu-clip.test.tsx` → `it('AC-W6-IXD-MENU: …')` |
| `AC-W6-IXD-ATRISK` | At-risk co-location | Projects list + Overview | Unit/RTL render-position | `Projects.atrisk.test.tsx` / `OverviewTab.test.tsx` → `it('AC-W6-IXD-ATRISK: …')` |
| `AC-W6-IXD-TASKROW` | Row-click → edit modal | TasksTab | Unit/RTL | `TasksTab.test.tsx` → `it('AC-W6-IXD-TASKROW: …')` |
| `AC-W6-IXD-BUDHEAD` | Drop double header | ProjectBudget | Unit/RTL | `ProjectBudget.test.tsx` (+ update `ProjectDetail.test.tsx:160`) → `it('AC-W6-IXD-BUDHEAD: …')` |
| `AC-W6-IXD-NOTE` | Demote timesheet note | TimesheetGrid | Unit/RTL | `TimesheetGrid.test.tsx` → `it('AC-W6-IXD-NOTE: …')` |
| `AC-W6-IXD-INCDATE` | Incident date default | Incidents | Unit/RTL | `Incidents.test.tsx` → `it('AC-W6-IXD-INCDATE: …')` |

All ACs owned at Unit/RTL (lowest sufficient layer per ADR-0010); I7 + the surface bundle additionally carry a mandatory RENDERED design-review gate (render-only defects + a11y AX-tree are invisible to jsdom). No AC pushed up a layer. AC-id is the leading token of each owning `it(...)` title (`grep -r AC-W6-IXD-…` finds the canonical proof).

---

## §8 — Optional / deferred (lower priority)

- **Exec two-violet KPI chips (`pages/ExecutiveDashboard.tsx` L117 + L133).** Both `kpi-pipeline-weighted-value` and `kpi-active-projects` are `tone="violet"` on one row. The reviewer suggests "Active projects" (a count, not a pipeline category) take a neutral tone. **Blocker:** `KPITone` has **no `neutral` variant** (KPITile.tsx L8 — only blue/violet/amber/red/green). Two honest options, **both need owner sign-off because they touch the categorical-color vocabulary:** (a) reuse an existing on-palette tone — but `blue` is the action color (One-Blue Rule violation for a static count tile), so the only safe reuse is leaving it violet or making it `green`/`amber` which both carry status meaning here → none is clean; (b) **add a `neutral` KPITone** = `bg-secondary text-muted-foreground` (the existing delta-neutral chip recipe already in KPITile.tsx L63 `neutral: 'text-muted-foreground bg-secondary'`) — this is a small, on-palette, non-aesthetic addition (reuses the muted/secondary tokens already in DESIGN.md, no new color). **Recommendation: DEFER to a Wave-6 polish item with owner sign-off; if pursued, option (b) is the only DESIGN.md-clean path** (a `neutral` tinted icon tile reusing `secondary`/`muted-foreground` — no new token, no new hue). Not folded into PR-B to avoid bundling a token-vocabulary change with bug fixes.
- **Reports placeholder (`Reports.tsx`)** — top-left content in a vast empty page. **DEFER** until the Reports module ships; the route is URL-only (not in nav), so it is not a user-reachable defect today. Note for the Reports feature track.

---

## New DESIGN.md token?
**None added.** Every decision names an existing token (`warning-foreground`, `border`, `secondary`, `muted-foreground`, `popover`, `rounded.md`/`lg`, the Overlay shadow, Tabular-Numbers, the global focus ring). The **only** place a token-level addition was even considered is the optional Exec `neutral` KPITone — and that would **reuse** the already-defined `secondary` + `muted-foreground` tokens (the existing delta-neutral recipe), not introduce a new color. It is flagged for owner sign-off, **not** added here. Identity preserved.

---

## Summary (6 lines)
1. Two PRs: **PR-A** = I7 `DataTable` row-menu clip fix (app-wide primitive, isolated for its own rendered review + a11y AX gate); **PR-B** = the IxD surface bundle (at-risk co-location, task-row→edit, budget double-header, timesheet-note demote, incident date default).
2. **Owner decisions baked in:** at-risk → **co-locate budget basis as inline tabular text beside the bar** (not a sub-bar, not a recolor — justified against Text-not-color + One-bar-honesty); task-row → **opens the existing Edit modal** via the `DataTable` `onActivate`/`rowLabel` primitive already built (gated by `canEdit`, `⋯` stopPropagation preserved).
3. **I7 contract** is testable: menu must render fully visible at any row/viewport (portal-to-body preferred, flip-up fallback) + adds focus-into/return + arrow-key roving to the existing Esc/click-outside/`role=menu` base.
4. All ACs owned at **Unit/RTL** (ADR-0010), with **render-position** assertions for the at-risk co-location and a mandatory **RENDERED** design-review for I7 + the bundle (jsdom can't see overflow-clip or AX order).
5. **No new DESIGN.md token** — all decisions use existing tokens; the only candidate addition (optional Exec `neutral` KPITone) reuses `secondary`/`muted-foreground` and is **deferred for owner sign-off**, not added.
6. **Couldn't fully verify:** nothing was unverifiable — all 8 file:line claims checked and confirmed; the one open implementation choice (I7 portal vs flip-up) is intentionally left to `ui-implementer` behind a testable contract, and the incident "today" date convention should be confirmed against the `date` column (local-date string, not UTC) at build time.
