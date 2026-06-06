# UI Design-Plan — Sales Pipeline → IA-3 (Issue 2)

**Date:** 2026-06-06
**Author:** design-architect
**Status:** Design+Plan (per-surface). Implements §4.1 of `docs/plans/2026-06-06-ui-realignment.md`.
**Authorities:** `DESIGN.md` (token/identity authority) · `docs/design-mockups/proposal-IA-3-hybrid.html` (layout/IA authority) · `docs/plans/2026-06-06-ui-realignment.md` §4.1 + §5 (master plan + cross-cutting acceptance) · `docs/product-expectations.md` Part C (charter).
**Method applied:** `impeccable shape` (UX/UI shaped before code) + `ui-ux-pro-max plan` (layout + 99-guideline checklist) + `taste` required-states / a11y / anti-slop folded into the acceptance list. Identity preserved — **no new aesthetic, palette, font, or token invented.** Reference/gap-analysis only.

> Scope note. This builds on §4.1 of the master plan; it does **not** re-derive the program. It is the implementer-ready, no-placeholder, token-named, TDD-task version of that section, scoped to the two source files being migrated and the Foundation primitives already merged on `main`.

---

## 0. What is already done (do NOT rebuild)

Foundation (Issue 1) is merged. The following are **present on `main` and reused verbatim** — the implementer imports them, never re-authors them:

- **Primitives** (`pmo-portal/src/components/ui/`): `Kanban` + `KanbanColumn` + `KanbanCard` (`Kanban.tsx`), `Funnel` (`Funnel.tsx`), `LifecycleStepper` inline+node (`LifecycleStepper.tsx`), `DataTable` + `Toolbar` + `SearchMini` + `TableFoot` (`DataTable.tsx`), `ViewToggle` (`ViewToggle.tsx`), `StatusPill` + `Badge` (`StatusPill.tsx`), `KPITile`, `Card`, `ListState` (`ListState.tsx`), `ProgressBar` (`ProgressBar.tsx`), `PageHeader` (`PageHeader.tsx`), `GateNotice` (`GateNotice.tsx`), `Button`, `Icon` + `IconName` (`icons.tsx`/`iconPaths.tsx`).
- **Shell** (`pmo-portal/src/components/shell/`): `WorkspaceTabsProvider` + `useWorkspaceTabs` (`openModule`, `openRecord`, `setDirty`), `BackBar` (`BackBar.tsx`), `Breadcrumb`, `MODULES` + `tabForPath` (`routeMatch.ts`).
- **Routing seam already wired:** `routeMatch.ts` MODULES already declares `sales.detail = { pattern: '/sales/:opportunityId', param: 'opportunityId' }` with `RECORD_ICON.sales = 'pipe'`. So URL→record-tab hydration (synthetic-label → human label) is **already supported by the shell**; this issue only has to (a) register the `<Route>` in `App.tsx` (currently a commented slot, App.tsx line 50) and (b) hydrate the human label on the detail page.
- **Data layer — PRESERVE EXACTLY:** `useSalesPipeline()` (`src/hooks/useDashboard.ts`) → `getSalesPipeline()` RPC; `useWinRate()` → `get_win_rate`; `transitionProject(id, to, opts)` (`src/lib/db/projectTransitions.ts`) → `transition_project` RPC with the `customerContractRef`/`contractDate` SoD capture. `isLegalProjectTransition`, `LEGAL_PROJECT_TRANSITIONS`, `PIPELINE_STATUSES`, `LOST_STATUSES`, `ON_HAND_STATUSES`, `projectStatusGroup` are the **single source** for stage logic — reuse them, do not re-encode transitions.

**Files this issue creates/replaces (presentation only):**
- `pmo-portal/pages/SalesPipeline.tsx` (rewrite — index: Funnel + Toolbar + Kanban/Table)
- `pmo-portal/pages/OpportunityDetail.tsx` (NEW — full-page detail at `/sales/:opportunityId`)
- `pmo-portal/components/SalesKanbanBoard.tsx` (rewrite to consume `KanbanColumn`/`KanbanCard`, OR delete and inline; see Task 4)
- `pmo-portal/App.tsx` (add one `<Route>`)
- co-located Vitest specs + the AC table below.

---

## 1. Feature summary

The Sales Pipeline is an **operator's deal-tracking surface**: a sales lead or executive scans open opportunities by stage, reads weighted forecast at a glance, and drills into one deal to advance it or mark it won/lost. IA-3 makes it **index-first with a Kanban (default) / Table view toggle**, and a row/card click **drills to a full-page opportunity detail** at `/sales/:opportunityId` that opens a workspace record tab. The win/loss action (with its SoD contract-ref capture) lives on the detail page.

**Primary user action:** scan the weighted pipeline, then open one opportunity to advance its stage.

**Identity:** "The Quiet Control Surface" (DESIGN.md §1). One blue does all interactive work; status is dot+tinted-pill; borders not shadows; Inter + tabular figures; SF Mono for codes only. The current surface's `bg-primary-600`/`bg-gray-*`/`dark:*`/`bg-green-500`/`text-[10px]` utilities are **legacy and must be migrated out** (token table §8).

---

## 2. Layout strategy (index)

Vertical flow inside the existing `AppShell` main region (rail+header+tabstrip are already chrome — this surface renders only the page body):

1. **Page head** — `page-title` "Sales Pipeline" + `body`/`muted-foreground` sub "Track opportunities, manage leads, and forecast revenue." + trailing actions (`Button` outline "Export", `Button` primary "New deal"). *(New-deal is a non-functional CTA target this issue — the form is out of scope and gated on the disabled/error-field sign-off, Open Q1. Wire the button to a disabled-with-tooltip or a toast "coming soon"; do not build the create form here.)*
2. **Weighted Funnel summary band** (`Funnel` primitive) — the 5 open stages, each: stage dot (categorical color), name, win-prob chip (`prob`), gross `value` (tabular), `weighted` sub-line, optional `barPct` = stage weighted ÷ max-stage-weighted. `aria-label="Pipeline summary"`. Won/Lost are **excluded** from the funnel band (they are terminal, not forecast) — matches the existing `totalWeightedValue` which already sums only `data.stages`. Funnel is **non-interactive** here (no `onSelect`) unless we wire stage-filter in a later pass.
3. **Standalone `Toolbar`** (`standalone` variant, fully rounded, `mb-3.5`): `ViewToggle` (Kanban | Table) · Owner filter `control` *(see Open Q3 — owner data is not in the RPC; ship the toggle + search first, defer the owner filter)* · spacer (`ml-auto`) · `SearchMini` (client-side filter on name/customer) · a gross/weighted readout (`tabular`).
4. **Body** — Kanban (default) or Table, driven by the persisted view state.

**Responsive (DESIGN.md §Mobile + mockup breakpoints):**
- Kanban uses the Foundation `Kanban`/`KanbanColumn` shell — columns are `minmax(258px,1fr)` tracks in a **horizontal-scroll** region (`.kanban-scroll`); on narrow viewports the row scrolls horizontally rather than stacking (intentional scroll region, the only one on the body). Funnel band: `≤1180px` reflows to fewer columns, `≤560px` to 2-col (the `Funnel` grid is `repeat(n,1fr)`; wrap it in a responsive container that switches to `grid-cols-2`/scroll under 560px).
- Table: `DataTable` already wraps its `<table>` in `overflow-x-auto`; on narrow screens it scrolls horizontally. No body-level horizontal scroll outside these two regions.
- `≤920px`: rail/tabstrip behavior is shell-owned (already built) — this surface does nothing extra.

---

## 3. Component breakdown

### 3.1 Index — Kanban view (default)
Six columns in fixed order (OD-SP-1 / FR-SPD-014), reusing `LEGAL_PROJECT_TRANSITIONS` ordering and `PIPELINE_STATUSES`:

| Col | Status enum | Win prob (from RPC `stage.win_probability`) | Dot color (categorical, sanctioned literal) |
|---|---|---|---|
| Leads | `Leads` | 10% | `hsl(var(--muted-foreground))` |
| Pre-Qual | `PQ Submitted` | 25% | `hsl(262 83% 58%)` (categorical `violet`) |
| Quotation | `Quotation Submitted` | 40% | `hsl(199 89% 48%)` (categorical cyan, mockup `STAGES`) |
| Tender | `Tender Submitted` | 50% | `hsl(43 96% 56%)` (`warning` hue, categorical use) |
| Negotiation | `Negotiation` | 75% | `hsl(25 95% 53%)` (categorical orange, mockup `STAGES`) |
| Won / Lost | `Won, Pending KoM` / `Loss Tender` | — | `hsl(var(--success))` / `hsl(var(--destructive))` |

> Win-prob values: **read from the RPC** (`stage.win_probability`), do not hard-code the percents above into display — the table is the column→enum mapping only. The probabilities in the legacy `SalesKanbanBoard.tsx` (0.1/0.2/0.4/0.6/0.8/1.0) are presentation literals and are **superseded** by the RPC-returned `win_probability`; the percentages requested in the brief (10/25/40/50/75) are the design intent, but the displayed number is whatever the RPC returns (single source). Flag any mismatch (Open Q2).
> Dot colors are **non-interactive categorical literals** — sanctioned by master-plan §5 ("the only literal HSLs permitted are the categorical series colors already enumerated in the mockup data"). They are flagged for promotion to `chart-*`/`stage-*` tokens (Open Q4). They must NEVER read as an action color (One Blue Rule).

- **`KanbanColumn`** props: `title`, `dotColor`, `prob` (e.g. `"40%"`), `count`, `totals` = a two-figure node (gross `value` tabular + `weighted` muted tabular), `emptyMessage` = `"No deals in {stage}"`.
- **`KanbanCard`** content (DESIGN.md "Kanban Card" signature), built from `PipelineProject` rows filtered by status:
  - top row: 26px colored icon tile (customer-initial or `pipe` icon; color = the stage dot) + win-% chip (`Badge` quiet) on the right.
  - name (`13px/600`, `line-clamp-2`) + customer (`client_name`, `muted-foreground`); render `client_name ?? '—'` (em-dash, never blank — `taste` number/empty rigor).
  - value: `formatCurrency(contract_value)` at `15px/700 tabular`.
  - weighted chip: `formatCurrency(contract_value * win_probability)` (`muted`, tabular).
  - foot row (border-top `border/70`): `StatusPill` (open) + a customer/contract reference + decision date **IF the RPC exposes them** — **it currently does not** (see §7 Data gap). Until the RPC is widened, render the customer ref / decision date as `—` or omit the foot meta; do NOT fabricate values (`taste` no-fake-data). The mono `code`/ref slot uses `mono` type when present.
  - `onActivate` → `openOpportunity(project)` (§5).
- Won/Lost column: cards show solid `won`/`lost` `StatusPill`; excluded from funnel/weighted totals.

### 3.2 Index — Table view
`DataTable<PipelineProject>` columns (right-align + `tabular` on all money/%):

| Col | key | cell | align |
|---|---|---|---|
| Opportunity | `opp` | project cell: 28px stage-colored icon + 2-line `name` / mono `code` (or `id` slice if `code` null) | left |
| Customer | `customer` | `client_name ?? '—'` | left |
| Stage | `stage` | `StatusPill` variant by `projectStatusGroup(status)` → pipeline=`open`, onHand/won=`won`, lost=`lost` | left |
| Value | `value` | `formatCurrency(contract_value)` | num |
| Weighted | `weighted` | `formatCurrency(contract_value * win_probability)` (`muted-foreground sub`) | num |
| Win % | `win` | `ProgressBar value={win_probability*100} showValue aria-label="Win probability {n}%"` (threshold-colored: ≥70 success / ≥40 warning / else destructive — the primitive does this) | num |
| Decision | `decision` | decision date IF exposed by RPC else `—` (Data gap §7) | left |

- `onActivate={(row) => openOpportunity(row)}`. `rowKey={r => r.id}`. `selectedKey` = the currently-open opportunity id (so re-opening highlights the row).
- Sorting: optional this issue (Foundation supports `sort`/`onSort`); if added, sort client-side on value/weighted/win. Default order = pipeline-stage order then value desc. **Acceptance does not require sort** — keep it minimal unless cheap.

### 3.3 View toggle + persistence
`ViewToggle` options `[{value:'kanban', label:'Kanban', icon:'cards'}, {value:'table', label:'Table', icon:'table'}]`, `ariaLabel="Pipeline view"`. Default = `kanban`. Persist per-surface under `VIEW.pipeline` in `sessionStorage` (`VIEWS_STORAGE_KEY` exists in `workspaceTabs.ts` — read/write a small `{pipeline: 'kanban'|'table'}` map; do NOT couple it to the tab reducer). On read-failure default to kanban.

### 3.4 Detail — `OpportunityDetail.tsx` at `/sales/:opportunityId`
- Read `:opportunityId` from `useParams`; resolve the row from `useSalesPipeline()` cache (`data.projects.find(p => p.id === id)`). No new RPC — reuse the cached list (the deal was just listed). If the cache is cold (deep-link/refresh), the hook re-fetches; show `ListState` loading then resolve. If the id is not found after load → `ListState` error "Opportunity not found" + BackBar.
- **`BackBar`** ("Back to Sales Pipeline" → `openModule('sales')` / navigate `/sales`) at top; Breadcrumb is shell-owned (Sales Pipeline › {opportunity}).
- **`PageHeader`**: `icon` = stage-colored 44px tile (initial or `pipe`), `name` = opportunity name, `status` = `StatusPill` by group, `meta` = `customer · mono id/code · customer ref · decision` (each `—` if absent), `stats` = 5-stat strip: Value / Win prob / Weighted / Owner / Decision (Owner & Decision = `—` until RPC widened), `actions` = `Button` outline "Advance stage" + `Button` (primary "Mark won") + `Button` (destructive "Mark lost").
- **grid-2 below header:**
  - **Left — "Opportunity journey"** `Card`: `LifecycleStepper variant="inline"` (or `node` for the detail emphasis) over the 5 pipeline stages + terminal, computed from the deal's current `status` via `PIPELINE_STATUSES` index: stages before current = `done`, current = `current`, after = `upcoming`; if `LOST_STATUSES` → mark terminal `skipped`/lost; if won → `paid`/done. `aria-label="Deal stage journey"`.
  - **Right — "Next actions"** `Card`: `GateNotice variant="ready"` ("Ready to advance") OR `blocked` (if role/identity cannot transition — derive from existing role data, never bypass RLS). Then the transition controls.
- **Win/loss action (PRESERVE the RPC contract):**
  - "Mark won" → calls `transitionProject(id, 'Won, Pending KoM', { customerContractRef, contractDate })`. The RPC **requires** `customerContractRef` + `contractDate` when targeting Won from a pipeline stage (P0001). So "Mark won" must capture those two fields first. Because the disabled/error-field styling is unsigned (Open Q1) and "modal-as-first-thought" is a product ban, render an **inline progressive panel** (two fields appear in the Next-actions card on click), not a modal. The two inputs use the Foundation `input` token shell; validation surfaces inline (required → `destructive` helper text, pending Open Q1 sign-off on error-field tokens).
  - "Mark lost" → `transitionProject(id, 'Loss Tender')` (destructive button — the one sanctioned solid status fill).
  - "Advance stage" → `transitionProject(id, <next legal stage>)` using `LEGAL_PROJECT_TRANSITIONS[status]` for the legal-target list.
  - On success: invalidate `['sales-pipeline', orgId]` (the hook's queryKey) so the index + detail re-read; `Toast` success; the StatusPill/stepper reflect the new stage. On error: surface the RPC error message inline (it carries the P0001 SoD/contract-ref message verbatim) + `Toast`. **Do not catch-and-rewrite the RPC error** — the SoD message is the product's authoritative copy.

---

## 4. Tab-workspace integration

The shell already maps `/sales` → `sales` module tab and `/sales/:opportunityId` → a `record` tab (`id: 'sales:<id>'`, icon `pipe`, `code: <id>`, label initially the raw id, hydrated to human label). Two integration points:

1. **Opening a deal** (`openOpportunity(project)` helper on the index): call `ws.openRecord({ id: 'sales:'+project.id, kind:'record', path:'/sales/'+project.id, icon:'pipe', label: project.name, code: project.code ?? project.id, module:'sales' })`. Passing the **human label** (`project.name`) on the explicit open means the reducer stores it; a later synthetic URL re-open (Back/Forward) will NOT overwrite it (the reducer's `keepExistingLabel` path). Re-opening the same deal **refocuses** the existing tab (reducer `existing` branch).
2. **Detail-page label hydration on deep-link/refresh:** when the detail page mounts from a cold deep-link, the shell's `tabForPath` opened a synthetic record tab labelled with the raw id. Once `useSalesPipeline()` resolves and the row is found, the detail page calls `ws.openRecord({...with label: project.name})` (idempotent refocus) to hydrate the synthetic label to the human name. This is the "synthetic-label → human label" hydration the Foundation tab model expects.
3. **Dirty dot (optional):** while a Mark-won inline panel is open with unsaved field input, `ws.setDirty('sales:'+id, true)`; clear on submit/cancel. Drives the existing amber `wt-dirty` dot — real in-progress state, not invented. Optional for this issue; include only if cheap.

The module tab and record tabs coexist; the rail "Sales Pipeline" item shows active for either (shell-owned `aria-current`).

---

## 5. Key states (every one shipped — `taste` Rule 5)

All async states route through `ListState` / `DataTable.state` — never a hand-rolled spinner or ad-hoc empty `<div>` (the current `pipeline-loading`/`pipeline-error`/`pipeline-empty` bespoke blocks are **removed**).

| State | Index | Detail |
|---|---|---|
| **Loading** | Funnel band → skeleton bars; Kanban → skeleton cards (`ListState variant="loading"` inside a column-shaped wrapper) / Table → `DataTable state="loading"` (skeleton rows). Skeleton matches layout, not a spinner. | `ListState loading` in the header/cards region. |
| **Empty** | No deals at all → `DataTable state="empty"` / a board-level empty: `ListState variant="empty"` title "No opportunities yet" sub "Add a lead to start tracking the pipeline." action "New deal". Empty single column → `KanbanColumn emptyMessage` "No deals in {stage}". | n/a (a detail only exists if a deal does). |
| **Error** | Query error → `DataTable state="error"` / board-level `ListState variant="error"` title "Couldn't load the sales pipeline" + Retry → `refetch()`. | RPC/transition error → inline `ListState error` (transition) or "Opportunity not found" + BackBar. |
| **Edge** | (a) Won/Lost deals: solid won/lost pill, excluded from funnel + weighted totals. (b) all-won / no-open: funnel renders zero-value stages (not blank); board shows populated Won/Lost column + empty open columns. (c) filter-no-match: empty within current view ("No deals match your search"). (d) long names: `line-clamp-2` (cards) / ellipsis ~40ch (table). (e) absent customer ref / decision / owner → em-dash `—`. (f) `win_probability` 0 → ProgressBar destructive, "0%". | (g) terminal deal (won/lost): Advance/Mark-won disabled with reason; stepper shows terminal node. (h) illegal transition target: button absent (driven by `LEGAL_PROJECT_TRANSITIONS`). |

---

## 6. Accessibility (WCAG-AA — `ui-ux-pro-max` §1 + DESIGN.md posture)

- **Contrast:** all status text uses `StatusPill`'s **darkened AA text variants** (already baked into the primitive — `won` `hsl(142 64% 30%)`, `lost` `hsl(0 72% 45%)`, `open` `hsl(221 70% 45%)`); never the base hue as text. Funnel/card sub-values use `muted-foreground` (clears AA on white). **White-on-white risk:** the legacy `text-gray-400`/`text-[10px]` on tinted backgrounds in `SalesKanbanBoard.tsx` is below AA — migrate to `muted-foreground` at ≥11px (`overline`/`label` tokens). Categorical dot colors are decoration (`aria-hidden`), never the only signal.
- **Keyboard:** Kanban cards are `role="button" tabIndex=0` Enter/Space-activatable (Foundation `KanbanCard`); table rows are `tabIndex=0` Enter/Space (Foundation `DataTable`). **No native drag** in this issue (board is read+drill, not drag-to-reorder) — so no keyboard-drag alternative is needed; if drag-to-advance is added later, the keyboard alternative is the detail-page "Advance stage" action (already the canonical path). State this explicitly so review doesn't flag a missing drag-keyboard path.
- **ARIA:** `ViewToggle` is `role="tablist"`/`aria-selected` (Foundation). Funnel band `aria-label="Pipeline summary"`. `ProgressBar` carries `role="progressbar"` + `aria-valuenow` + `aria-label` "Win probability {n}%". Icon-only buttons (Export, row menu) carry `aria-label`. `LifecycleStepper` is `role="list"` with per-step `aria-label="{label}: {state}"`. The Mark-won inline fields get `<label>`s ("Customer contract reference", "Contract date") + `aria-describedby` to error/help text.
- **Focus order:** DOM order = page-head actions → funnel → toolbar (view toggle → search) → body (cards/rows in stage order). Global `:focus-visible` ring (shell-owned) on every focusable. `color-not-only`: every status = dot + text.
- **Live regions:** transition success/error → `Toast` (polite) + the error `ListState` is `role="alert"` (Foundation). Loading `ListState` is `aria-busy`/`aria-live="polite"`.

---

## 7. Data gap (BLOCKING — owner/Director sign-off needed before the card/detail "ref + decision date" ships)

**The brief asks cards + detail to show "customer/contract reference + decision date".** The `projects` table HAS these columns (`customer_contract_ref`, `contract_date`, `decided_at`, `code`), **but the `get_sales_pipeline` RPC does not project them** — `PipelineProject` (`src/lib/db/dashboard.ts`) returns only `id, name, client_name, status, contract_value, win_probability`. There is also **no owner/PM field** in the pipeline payload.

This program is **"not a data rewrite"** (master-plan §1 non-goal). So two options, owner/Director to pick:

- **(A) Presentation-only (default this issue):** render only what the RPC exposes; show customer ref / decision date / owner as `—`. Ships now, no data-layer touch. The brief's "cards show … reference + decision date" is partially deferred.
- **(B) Widen the RPC (separate slice):** a `spec-miner`/`implementer` data-layer issue extends `get_sales_pipeline` to project `code, customer_contract_ref, decided_at, contract_date` and (if desired) the PM/owner via `project_manager_id` join, with the matching `PipelineProject` type + pgTAP. This is a backend change — out of this presentation PR's scope and must not be smuggled in.

**Recommendation:** ship **(A)** now (presentation swap, no data risk), and file **(B)** as a fast follow so the card meta becomes fully populated. The card/detail markup should be written to **conditionally render** the ref/decision/owner slots, so (B) lights them up with no further UI change.

---

## 8. Token migration (legacy utilities → DESIGN.md tokens)

Both source files use the **legacy `primary-600`/`gray-*`/`dark:*`/`green-500` ramp that the realignment removes** (master-plan §1: the `primary-50..950` ramp + `prefers-color-scheme` dark are deleted). Migrate every utility; **zero raw hex/px, zero `dark:` variants** in the rewritten files. Mapping (from the Foundation plan's migration table, applied to these files):

| Legacy utility (current source) | DESIGN.md token utility | Notes |
|---|---|---|
| `text-primary-600 dark:text-primary-400` | `text-primary` | links/active; drop the dark variant |
| `bg-primary-600` / `bg-primary-100` / `bg-primary-900` | `bg-primary` / `bg-primary/10` | One-Blue + tinted-status |
| `text-primary-700 dark:text-primary-300` | `text-primary` | |
| `bg-gray-50 / bg-gray-100 / bg-gray-200` | `bg-secondary` / `bg-muted` / `bg-accent` | quiet fills / tracks per intent |
| `bg-gray-800 / dark:bg-gray-700` etc. | (removed) | dark scheme deferred — delete |
| `text-gray-800 dark:text-white` / `text-gray-900` | `text-foreground` | primary text |
| `text-gray-500 / text-gray-400 dark:text-gray-400` | `text-muted-foreground` | sub-values, captions |
| `border-gray-200 dark:border-gray-700` | `border-border` | single-border rule |
| `border-gray-100` (card foot divider) | `border-border/70` | table/card row divider softening |
| `text-green-600 dark:text-green-400 font-bold` (win %) | `StatusPill`/`ProgressBar` threshold tones | green→`success` only on data state |
| `bg-green-500` (Won col top-border) | `dotColor = hsl(var(--success))` | status, not decoration |
| `border-indigo-400 / border-blue-400 / border-yellow-500 / border-orange-500` (col top-borders) | categorical `dotColor` literals (§3.1 table) | non-interactive stage dots; flag Open Q4 |
| `rounded-xl` / `rounded-lg` / `rounded` | `rounded-lg` (10) / `rounded-md` (8) per primitive | stay on the 4/6/8/10/999 scale |
| `text-[10px]` / `text-[10px] font-mono` | `text-[11px]`+`overline`/`label`; `font-mono` = `mono` token | ≥11px floor for AA; mono only for ids |
| `shadow-sm` / `hover:shadow-md` (static cards) | borders + Foundation card hover-lift | Flat-By-Default; no static drop shadow |
| `formatCurrency` inline `Intl` in `SalesKanbanBoard` | import `formatCurrency` from `@/src/lib/format` | one formatter; tabular |

**Contrast risks to fix while migrating:**
- `text-gray-400` mono id chips on `bg-gray-50` (current kanban card, line 92) → `text-muted-foreground` + `mono` token; verify ≥4.5:1 (the `46.1%`-L `muted-foreground` on white clears AA; on `secondary/35%` it still clears).
- `text-[10px] text-green-600 font-bold` win-% (line 93) → replace with `Badge`/`ProgressBar` tone; the 10px green-on-white is small + borderline — moving to the threshold ProgressBar fixes both size and semantics.
- Won column `border-green-500` solid bar → success dot; never a solid status fill behind content (Tinted-Status Rule).

---

## 9. Implementer task list (TDD, 2–5 min each, red→green)

Run inside `pmo-portal/`. Each task: write the failing test first, then the minimum to pass. AC ids tagged in test titles (ADR-0010 traceability). Coverage ≥80% on changed lines.

**T1 — View-state persistence helper (unit).**
Test: `usePipelineView` (or a `readPipelineView`/`writePipelineView` pair) defaults to `'kanban'`, round-trips through `sessionStorage` under `VIEWS_STORAGE_KEY`, and falls back to `'kanban'` on parse failure. *(AC-SP-201)*
Impl: small hook/util in `pages/SalesPipeline.tsx` or `src/hooks/usePipelineView.ts`.

**T2 — Index header + Funnel band (unit/RTL).**
Test: renders `page-title` "Sales Pipeline", the action buttons, and a Funnel with 5 open stages whose values/weighted come from `data.stages` (mock `useSalesPipeline`); Won/Lost not in the funnel; `aria-label="Pipeline summary"` present. *(AC-SP-202)*
Impl: page head + `<Funnel>` mapping from `data.stages`.

**T3 — Index states via ListState/DataTable (unit/RTL).**
Test: loading → skeleton (no spinner, `aria-busy`); error → `role="alert"` + Retry calls `refetch`; empty (`projects.length===0`) → "No opportunities yet" + New-deal action. Assert the legacy `data-testid="pipeline-loading|error|empty"` blocks are gone OR retained as needed by e2e (see T9 note). *(AC-SP-203)*

**T4 — Kanban view (unit/RTL).**
Test: 6 columns in fixed order; a `Quotation Submitted` deal renders a `KanbanCard` with name, customer (or `—`), `formatCurrency(contract_value)`, weighted chip, win-% from RPC, `StatusPill`; clicking a card calls `openOpportunity` with the row; empty column shows "No deals in {stage}". *(AC-SP-204)*
Impl: rewrite `components/SalesKanbanBoard.tsx` to consume `Kanban`/`KanbanColumn`/`KanbanCard`; map `data.projects` by status; `dotColor`/`prob` from §3.1; **all tokens, no `dark:`/`gray-*`/`green-*`**.

**T5 — Table view (unit/RTL).**
Test: `DataTable` renders the 7 columns; money/% cells are `tabular` + right-aligned; Win% uses `ProgressBar` with threshold tone + `aria-label`; row click calls `openOpportunity`; absent customer/decision render `—`. *(AC-SP-205)*

**T6 — View toggle wiring (unit/RTL).**
Test: `ViewToggle` switches body kanban↔table, persists the choice (T1), `role="tablist"`/`aria-selected` correct, arrow-key roving works. *(AC-SP-206)*

**T7 — Route + tab integration (unit/RTL + the shell test patterns).**
Test: (a) `App.tsx` registers `/sales/:opportunityId` → `OpportunityDetail`. (b) `openOpportunity` calls `ws.openRecord` with `id:'sales:<id>'`, human `label`, `code`, `module:'sales'`. (c) detail page resolves the row from the `useSalesPipeline` cache; on deep-link it re-opens the record with the human label (hydration). (d) re-opening refocuses (no dup tab). *(AC-SP-207)*
Impl: add the `<Route>` (replace the comment at App.tsx:50); add `pages/OpportunityDetail.tsx`.

**T8 — Detail page + states + journey (unit/RTL).**
Test: PageHeader (name, status pill by group, 5-stat strip), BackBar "Back to Sales Pipeline", `LifecycleStepper` marks stages done/current/upcoming from `status` via `PIPELINE_STATUSES`; not-found id → error + BackBar; loading → ListState. *(AC-SP-208)*

**T9 — Win/loss transition preserved (unit/RTL — mock `transitionProject`).**
Test: "Mark won" reveals the inline customer-ref + contract-date fields; submitting calls `transitionProject(id,'Won, Pending KoM',{customerContractRef,contractDate})`; missing required field blocks submit with inline `destructive` helper; "Mark lost" calls `transitionProject(id,'Loss Tender')`; on success the query invalidates + Toast; on RPC error the **verbatim** error (incl. P0001 SoD message) shows inline. Assert `transition_project` arg shape is byte-for-byte the existing contract. *(AC-SP-209)*

**T10 — e2e regression (Playwright — AC-1117 must stay green).**
The existing `e2e/AC-1117-dashboard-pipeline.spec.ts` navigates via `getByRole('link', { name: /Sales Pipeline/i })`, waits for `**/sales`, then asserts `getByTestId('pipeline-weighted-total')` is visible+`$` and `getByTestId('stage-Tender Submitted')` is visible+`$`.
**Two preservation requirements for the rewrite:**
  1. **Keep the rail link** labelled "Sales Pipeline" (it's the shell `Rail`/`NavLink` — already present; just don't rename). The e2e clicks a NavLink, not a tab.
  2. **Keep the two test ids** the e2e depends on: put `data-testid="pipeline-weighted-total"` on the Funnel/readout total, and `data-testid="stage-Tender Submitted"` on the Tender column (Kanban) so the column contains the weighted `$` value. If the default view is Kanban, the Tender column carries it; ensure the weighted figure is rendered in the Tender `KanbanColumn` `totals`/card. Do NOT change the e2e to chase the UI — preserve the ids. *(AC-1117 unchanged)*

**T11 — Token-migration lint gate (mechanical/grep, part of review).**
Verify the two rewritten files contain **no** `dark:`, no `-(50|100|200|300|400|500|600|700|800|900|950)\b` color-ramp utilities, no raw `#hex`, no `text-\[10px\]`, no static `shadow-sm` on a non-hover card. (A `grep`-able acceptance, run in `/design-review`.) *(AC-SP-210)*

---

## 10. Acceptance list (folds `ui-ux-pro-max` 99-guideline + `taste` discipline + master-plan §5)

A PR is done when:
- [ ] **States:** loading=skeleton (no spinner), empty=composed+New-deal action, error=inline+Retry — all via `ListState`/`DataTable.state`. (AC-SP-203)
- [ ] **Kanban + Table** both render real RPC data; ViewToggle persists (AC-SP-201/204/205/206).
- [ ] **Detail route** `/sales/:opportunityId` wired; opens/refocuses a record tab with the human label; deep-link hydrates the synthetic label (AC-SP-207/208).
- [ ] **Win/loss `transition_project` contract byte-for-byte preserved**, incl. the SoD customer-ref + contract-date capture and verbatim P0001 error (AC-SP-209).
- [ ] **A11y/AA:** status = darkened-text pills (never base hue); ProgressBar/Funnel/stepper aria; ViewToggle tablist; icon-only buttons labelled; `:focus-visible` everywhere; color-not-only. (§6)
- [ ] **Responsive:** kanban horizontal-scroll region; funnel reflows ≤1180/≤560; table x-scrolls; no body-level horizontal scroll elsewhere.
- [ ] **Anti-slop (`taste` §7):** SVG icons only (one family, stroke-2 — the Foundation `Icon`); **no fake data** (real RLS rows; absent fields = `—`, never invented); `tabular` on every figure; one `primary` blue (≤10% of screen); borders-not-shadows; minus glyph `−` for any negative; `prefers-reduced-motion` honored (Foundation transitions already gate). No modal for Mark-won (inline progressive panel).
- [ ] **Tokens-only:** zero raw hex/px/`dark:`/color-ramp in the two rewritten files; every value names a DESIGN.md token (AC-SP-210). Categorical stage-dot literals are the only sanctioned literals (flagged Open Q4).
- [ ] **Behavior preserved:** `useSalesPipeline`/`useWinRate`/`transitionProject` and role-gating unchanged; presentation swap only.
- [ ] **AC-1117 e2e green** with rail NavLink + the two test ids preserved (AC-1117).
- [ ] `npm run typecheck` + ESLint (`--max-warnings=0`) clean; ≥80% line coverage on changed code; `/design-review` passed.

---

## 11. Open questions (build pauses on these)

1. **Disabled / error-field tokens (DESIGN.md gap, carried from master-plan Open Q1).** Needed for the Mark-won inline fields' required-field error styling. Proposed: error border+helper = `destructive`; disabled = `opacity .5` + `not-allowed`. **Sign-off needed before T9 renders the validation styling.** Default until signed: minimal `destructive` helper text, no new disabled token.
2. **Stage probabilities — RPC vs. brief.** The brief specifies 10/25/40/50/75%; the legacy board hard-codes 10/20/40/60/80%; the live display source is the RPC `stage.win_probability`. Confirm the **RPC/`pipeline_stage_config` values are the intended ones** (single source) and the brief's percentages are illustrative. If the org config differs from the brief, that's a data-config decision, not a UI change. Default: display the RPC values.
3. **Owner filter + owner column.** The brief's Toolbar shows an Owner filter and cards/detail show an owner; **the pipeline RPC returns no owner/PM field.** Default: ship the view toggle + search this issue; defer the owner filter/column to the §7-(B) RPC-widening slice. Confirm acceptable.
4. **Categorical stage-dot colors → named tokens?** §3.1 uses sanctioned literal HSLs for stage dots (cyan/violet/amber/orange). Promote to named `stage-*`/`chart-*` tokens (identity-preserving) or keep as flagged literals? Default: keep literals, flag for the Foundation token follow-up (master-plan Open Q2).
5. **§7 data gap (A) vs (B).** Ship presentation-only now (ref/decision/owner = `—`), file RPC-widening as fast-follow? Default: **(A) now, (B) follow.** Owner/Director to confirm the partial card meta is acceptable for the interim.
6. **Won/Lost as one column vs two.** The brief says "Won/Lost" as the 6th column; won + lost are distinct terminal statuses. Default: **one terminal column** holding both (won pill / lost pill), since both are excluded from the funnel and the board is a forecast view. Confirm, or split into two columns.
