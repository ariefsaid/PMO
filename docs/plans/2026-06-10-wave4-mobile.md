# Wave 4 — Mobile Responsiveness (Theme C) — Design Plan

Date: 2026-06-10
Author: design-architect (Director-orchestrated)
Status: **DRAFT — awaiting owner sign-off on the OWNER-DECISION flags below**
Charter: `docs/product-expectations.md` Part C "Design/UI"; identity authority = `DESIGN.md` (preserved, never re-skinned).
Lenses carried: Frontend (scalable accessible component architecture) + Existing-repo (reverse-engineer + preserve current identity).
Scope rule: this plan changes **how the existing surfaces reflow**, never their visual identity. Every value names a `DESIGN.md` token or an existing Tailwind utility. No new brand, palette, or font.

---

## 0. OWNER-DECISION flags (take these to the owner BEFORE build)

These four are the only genuine forks. Each has a **recommendation**; the rest of the plan assumes the recommended option.

- **OD-W4-1 — Shell mobile-nav pattern: keep the DRAWER, do NOT add a bottom-nav.**
  - The shell ALREADY ships a working overlay drawer at ≤920px (`AppShell.tsx`: rail collapses via `--rail-w:0`, hamburger in `ContextBar`, scrim + slide-in panel). The rail has **role-shaped grouped nav** (Overview / Sales / Delivery / Workforce) with up to ~8 items per role — that exceeds the **5-item bottom-nav ceiling** (`bottom-nav-limit`), and bottom-nav is for flat top-level destinations, not a grouped hierarchy (`bottom-nav-top-level`). A drawer is the correct pattern for secondary/grouped nav on a data tool (`drawer-usage`, `adaptive-navigation`: large screens sidebar, small screens drawer).
  - **Recommend: keep the drawer; refine it (swipe-to-dismiss affordance, focus-trap + `Esc`, safe-area inset, a visible close control).** A bottom-nav would be a NEW navigation paradigm — out of scope for "preserve identity," and it would collide with the timesheet/procurement footer action bars that already pin to the bottom of `Card`.
  - *If the owner wants a bottom-nav anyway:* it becomes a separate IA decision (which ≤5 destinations, per role) and a DESIGN.md component addition — flag, do not assume.

- **OD-W4-2 — Sales kanban on mobile: SCROLL-SNAP the existing columns, do NOT build a stage-picker.**
  - The kanban is already a horizontal-scroll grid (`.kanban-scroll` + `.kanban` `grid-auto-columns: minmax(258px,1fr)`). At 375px one column (258px) shows with the next peeking — that is the conventional, low-risk mobile kanban (`gesture-feedback`, horizontal scroll within a contained region). Adding **scroll-snap per column** + a sticky **stage-segment indicator** above (showing which of the 5 stages you're on) makes it legible without a rebuild.
  - A stage-picker (single-column + a dropdown to switch stage) is MORE work, hides cross-stage context the pipeline exists to show, and duplicates the existing Table view (which is already the better "one stage at a time" surface via the Open/Lost/Needs-attention scope filter).
  - **Recommend: scroll-snap the columns + add a sticky stage-progress indicator; point users at the Table view (already mobile-reflowed by PR-1) as the dense single-column alternative.**

- **OD-W4-3 — Timesheet weekly grid on mobile: HORIZONTAL-SCROLL the 7-day matrix within a contained region with a sticky project column (KEEP the matrix; do NOT switch to a per-day list).**
  - The grid already has the right bones: `overflow-x-auto`, a `sticky left-0` project column, `min-w-[44px]` touch-target cells, the delete control moved INTO the sticky cell (so it's reachable at 375px without scrolling). The 7-day matrix is the mental model engineers expect (a week at a glance) and it round-trips to the desktop layout cleanly.
  - A per-day accordion (pick a day → edit that day's projects) would be a different data model, lose the week-at-a-glance totals, and is a bigger rebuild for a surface the owner already flagged as a calibration anchor (Save+Submit co-located).
  - **Recommend: keep the horizontal-scroll matrix; harden it** — make the sticky project column narrower at mobile (it's `min-w-[220px]`, ~59% of a 375px viewport), add a scroll-affordance fade, ensure the Total column is reachable, and verify the day cells clear 44px. (See C1-Timesheet.)

- **OD-W4-4 — Adopt a `DataTable`→card reflow at a single breakpoint as a DESIGN.md standard.**
  - The shared `DataTable` is the ONE primitive every list uses (Companies, Procurement, Sales table, Incidents, project sub-tabs). Today it only does `overflow-x-auto` — a wide financial table at 375px becomes a horizontal-scroll strip where the right-edge columns (Value, Owner, actions) are off-screen and the user can't compare rows. The fix is to reflow each row to a **stacked record-card** (label:value pairs) below a breakpoint, done ONCE in the primitive so every list inherits it.
  - **Recommend: adopt the `md` breakpoint (768px) as the table→card boundary, codified in DESIGN.md as "the table-reflow breakpoint."** Below `md` = stacked cards; at `md`+ = the dense table (unchanged). This is the only genuinely-new DESIGN.md addition this wave (see §1 + §6).
  - *Sub-question for the owner:* the app's EXISTING structural breakpoint is **920px** (the rail-collapse). The table-reflow at **768px** is intentionally LOWER so a tablet in the 768–920px band keeps the dense table (a tablet has the width for it) while the rail is already a drawer. **Recommend two named breakpoints** (`reflow-rail: 920px`, `reflow-table: 768px = Tailwind md`) rather than forcing one — they serve different jobs. Confirm, or collapse both to 920px if the owner prefers a single line.

---

## 1. Reflow strategy (the foundation)

### 1.1 What already exists (do NOT rebuild — inventory)

The app is further along on mobile than "desktop-only" implies. Verified in code:

| Mechanism | Where | Status |
|---|---|---|
| Rail→drawer at ≤920px (single source of truth) | `index.css` media query + `AppShell.tsx` | Works; needs polish (OD-W4-1) |
| `min-w-0` grid + `overflow-x-hidden` main (anti-clip) | `AppShell.tsx` | Works (the 375px right-edge clip fix already landed) |
| `.touch-target` utility (≥44px hit area on coarse pointers, inert on mouse) | `index.css` | Works; needs an audit sweep (C6) |
| ⌘K shrinks to a 36px icon ≤920px; user name/role hide | `ContextBar.tsx` | Works |
| StatTiles → scroll-snap strip below `sm` with fade + min-w floor | `StatTiles.tsx` | Works |
| LifecycleStepper node → `overflow-x-auto`, `min-w-[96px]` steps | `LifecycleStepper.tsx` | Works |
| Funnel band → `overflow-x-auto` + `min-w-[640px]` | `SalesPipeline.tsx` | Works |
| Kanban → horizontal-scroll grid, `minmax(258px,1fr)` | `index.css` `.kanban` | Works; add scroll-snap (OD-W4-2) |
| TimesheetGrid → `overflow-x-auto`, sticky project col, delete in sticky cell, `min-w-[44px]` cells | `TimesheetGrid.tsx` | Works; harden (OD-W4-3) |
| `cmdk-row` coarse-pointer padding to clear 44px | `index.css` | Works |

**The one structural gap: the shared `DataTable` body does not reflow to cards.** Everything else is a hardening/audit pass, not a rebuild. This reframes Wave 4 from "make the app mobile" to "ship the DataTable card-reflow + sweep the touch-target/clip gaps the existing patterns missed."

### 1.2 The DataTable→card reflow (the highest-reach single change)

**Approach: mobile-first reflow done inside the `DataTable` primitive, gated at `md` (768px) — `<md` renders a stacked card list, `md:` renders the existing `<table>`.**

The `Column<Row>` API already carries everything the card needs: `header` (the label), `cell(row)` (the value), `align`, and `colClassName`. A card row is just **`header : cell(row)`** stacked as a definition list. Two implementation options for the primitive:

- **Option A (recommended): dual render in `DataTable`.** Keep the `<table>` exactly as-is but wrap it `hidden md:block`; add a sibling `md:hidden` card list that maps `rows`→a card, each card mapping `columns`→a `<dl>` of `<dt>{col.header}</dt><dd>{col.cell(row)}</dd>`. The first column (the identity cell — name/code) becomes the **card title** (full-width, bold, the `rowLabel` activation button), the rest become label:value rows. `rowMenu` renders as a `⋯` in the card's top-right (already `.touch-target`). Zero consumer churn — every existing `<DataTable>` call inherits it.
  - Semantics: the card list is a `<ul role="list">` of `<li>`; each card is the keyboard-activatable control (reuses the existing `rowLabel`→`<button aria-label>` pattern, so `getByRole` still finds an accessible activation affordance). Sort headers don't apply on cards (sorting is a desktop-density affordance); a future enhancement could add a sort control to the mobile toolbar, out of scope here.
  - Cost: one CSS-only fork inside one file; the table branch is byte-unchanged, so desktop cannot regress.
- **Option B (rejected): CSS-only `display:block` re-layout of the `<table>` with `::before` pseudo-labels.** The classic "responsive table" trick (`td::before { content: attr(data-label) }`). Rejected: `data-label` would have to be threaded through every `col.cell` (consumer churn), pseudo-content isn't selectable/translatable, and it fights the sticky-header + the in-cell composite cells (the project-icon cell, the win-% bar). Option A keeps real React nodes in the cards.

**Card anatomy (tokens):**
- Card container: `card` bg, 1px `border`, `rounded.md` (8px), `{spacing.4}` (16px) padding, stacked with `{spacing.2}` (8px) gap — the existing `Card` recipe. Flat-by-default (border, no shadow) per the Elevation rule; hover/selected get the same `accent`/`primary/7%` washes the table rows use.
- Title row: the identity cell, `subheading`/`body`-weight, full width, the activation `<button>`.
- Field rows: a `<dl>` grid, `<dt>` = `overline`/`label` token (11.5px/600 `muted-foreground`, the same voice as the table `th`), `<dd>` = `body` 13.5px `foreground`, `tabular` on numeric columns (carry `col.align==='num'` → `tabular text-right` or just `tabular`). Status pills, progress bars, money all render as their existing in-cell nodes.
- The `rowMenu` `⋯` pins top-right of the card, `.touch-target`.
- Empty / loading / error: the card list reuses the SAME `ListState` the table body delegates to (one `state` prop, one source of truth) — no divergence.

**Which columns show on a card?** All of them by default (a card has vertical room a row doesn't). Columns already marked `colClassName="hidden xl:table-cell"` (secondary columns hidden on the desktop table) should be SHOWN on the card (mobile has the vertical space and the user can't widen the viewport) — so the card maps the full `columns` array, ignoring `hidden`-prefixed `colClassName` (strip responsive-hide classes when projecting to the card, keep alignment classes). Flag if any consumer relies on a column being truly hidden everywhere; none found in the surfaces audited.

### 1.3 Touch-target approach (C6)

The `.touch-target` utility is the right primitive (transparent `::before` overlay extends the hit area to ≥44px on coarse pointers WITHOUT changing visual size — keeps the dense desktop untouched). Wave 4 = **audit + apply it where it's missing**, not invent anything:
- `Button` `size="icon"` (32px) and `size="sm"` (28px/h-7) — add `.touch-target` (or have the `Button` component apply it automatically for `icon`/`sm` sizes; recommend the latter so every consumer inherits it). 32px and 28px both fail the 44px floor on touch.
- `BackBar` button (h-[30px]) — `.touch-target`.
- Breadcrumb link buttons (text-only, ~20px tall) — `.touch-target` (or grow tap padding on coarse pointers like `.cmdk-row` does).
- The `RowMenu` items inside the popover (h-8 = 32px) — these are list rows; on coarse pointers grow to ≥44px (the `.cmdk-row` coarse-padding pattern), since `.touch-target`'s centered overlay would overlap adjacent menu items. Use vertical padding growth, not the overlay, for stacked list items.
- DataTable CARD activation: the card itself is tall (multi-row), so it clears 44px naturally; the `⋯` gets `.touch-target`.
- Verify the impersonation "View as role" menu items, the week-stepper prev/next icon buttons (`size="icon"`, 32px → `.touch-target`), the timesheet "Add project" `<select>` (already `.touch-target` + h-8).

**Rule for the plan:** any interactive element whose visual box is `< 44px` in EITHER dimension must carry `.touch-target` (overlay, for isolated controls) OR coarse-pointer padding growth (for stacked list rows). The audit table in §5 (PR-1/PR-2) enumerates each.

### 1.4 Mobile-first vs desktop-overrides

The app is authored desktop-first (dense defaults, `md:`/`sm:` are sparse). Re-authoring everything mobile-first is out of scope and high-regression-risk. **Strategy: keep the dense desktop as the base, add mobile behavior as `max-md`/`max-[920px]` overrides + the `.touch-target` coarse-pointer layer** — exactly the pattern already in the codebase (StatTiles uses `sm:` to RESTORE the grid above the mobile default; that IS mobile-first locally). For the DataTable card-reflow we author the card branch as the base and `md:` restores the table — locally mobile-first, globally non-disruptive. This is the lowest-risk path to "usable on a phone without regressing desktop."

---

## 2. Per-surface design

For each: the narrow-viewport (375px) layout, the states, and the tokens. "Already handled" surfaces get a hardening checklist, not a redesign.

### C1a — Shared DataTable (the core; every list)
- **375px layout:** stacked record-cards (§1.2). One card per row, full-bleed within the page gutter (`px-6` → consider `px-4` at `max-md` for more card width; see C3). Card = identity title + `<dl>` of label:value + `⋯`. The toolbar above (`Toolbar` / `SearchMini` / `ViewToggle` segmented) already `flex-wrap`s; verify the search field (`min-w-[190px]`) + segmented don't overflow at 375px — wrap to two rows is fine, horizontal clip is not.
- **States @375px:** loading → `ListState variant="loading"` (skeleton rows, same as table); empty → `ListState variant="empty"` (teaches, with the existing `emptyAction`); error → `ListState variant="error"` + retry. All inherited from the single `state` prop — no new state code.
- **Tokens:** `card`, `border`, `rounded.md`, `{spacing.4}` padding, `{spacing.2}` gap; `overline` for `<dt>`, `body` 13.5px for `<dd>`, `tabular` on numeric; `accent`/`primary/[0.07]` for hover/selected; status pills + progress bars unchanged.
- **Utilities:** `hidden md:block` (table), `md:hidden` (cards), `grid grid-cols-[auto_1fr]` for the `<dl>` rows.

### C1b — Timesheet weekly grid (special case — KEEP matrix, OD-W4-3)
- **375px layout:** horizontal-scroll matrix in its contained `Card`. Sticky project column reduced from `min-w-[220px]` → `min-w-[160px]` at `max-md` (frees ~60px for day cells; the project name truncates with `title=` already present). Day cells stay `min-w-[44px]` (touch + legible). Add a right-edge `mask-image` fade on the scroll container (the StatTiles fade pattern) signaling "scroll for more days + Total." Pin the **Total** column sticky-right at `max-md` so the week total is always visible (mirror the sticky-left project column).
- **Toolbar/footer:** the page head + Save/Submit footer already `flex-wrap`; verify Save + Submit + helper text stack cleanly at 375px (they will — `flex-wrap items-center justify-end gap-2`). The week prev/next icon buttons get `.touch-target`.
- **States @375px:** editable-empty ("No hours logged" + Add-project select), editable-grid, read-only (Submitted/Approved), returned-for-changes `ErrBanner` (already full-width), loading skeleton, error + retry, Access-denied (Finance) `AccessDenied` surface — all already implemented; the job is verifying each at 375px, no new states.
- **Tokens:** unchanged (`secondary/60` weekend, `border/70` dividers, `primary/[0.07]` filled cell, `destructive`/error-text on invalid, `success` totals). Add: `mask-image` fade (compositor-only), sticky-right Total.

### C2 — Project-detail header (the big unified surface)
- **375px layout, top to bottom:**
  - `PageHeader` (icon + name + StatusPill + meta + actions): the `flex items-start gap-3.5` with `actions` in `ml-auto` will crowd at 375px. Reflow: at `max-md`, wrap actions BELOW the title (`flex-wrap` + actions on `basis-full mt-2`), or move Edit/Archive/Delete into a single `⋯` overflow menu (the `overflow-menu` rule — recommend the `⋯` for ≥2 actions; reuses the RowMenu popover). Icon stays 44px (`size-11`) — already a good touch/visual size. Name (`text-[19px]`) wraps with `text-wrap: balance`.
  - **StatTiles strip** (Contract/Committed/Actual/Margin/Spend, finance-forward roles): ALREADY scroll-snaps below `sm` with fade. Verify 5 tiles at `min-w-[150px]` snap cleanly at 375px (they do). No change.
  - **contract_value SoD row** (`sodRow`): the `flex flex-wrap items-center gap-3` with the inline `NumberField` editor (`w-[180px]`) fits at 375px (180px < 375 − gutter); the read-only "Read-only" lock pill is small. Verify the edit form's Save/Cancel buttons clear 44px (`.touch-target` on `size="sm"`).
  - **PipelineLens deal banner** (pre-win/lost, above tabs): audit separately (it carries the stage stepper + Advance/Mark-won/Mark-lost). The stepper inside reuses `LifecycleStepper` (overflow-handled); the action buttons need `.touch-target`/wrap. The deal-figure tiles (Value/Win%/Weighted) should reuse `StatTiles` if they don't already (check `PipelineLens.tsx`) so they inherit the scroll-snap.
  - **Tab bar** (`Tabs` — Overview/Budget/Procurement/Tasks/Documents, 5 tabs): at 375px five tabs will clip. Reflow the `Tabs` primitive to a **horizontal scroll-snap tab strip** (`overflow-x-auto`, `snap-x`, the active tab `scroll-into-view` on change, a right-edge fade) — the same contained-scroll pattern as the kanban/funnel. Keep the `primary` underline indicator. Each tab ≥44px tall on touch.
- **States:** loading (`ListState`), not-found (error + Back), pre-win banner vs delivery tiles — all stage states already implemented; verify each at 375px.
- **Tokens:** `card`/`border`/`rounded.lg` header; `StatTiles` tokens; `primary` tab underline; `overline`/`body` meta. New: `Tabs` scroll-snap + fade; `PageHeader` actions-overflow `⋯`.

### C3 — Shell chrome (largely DONE — harden, OD-W4-1)
- **375px layout:**
  - Header (`ContextBar`, 56px): hamburger (`max-[921px]:grid`, `.touch-target`) + breadcrumb + spacer + ⌘K-icon (36px, `.touch-target`) + impersonation (label hidden ≤920px) + avatar (name/role hidden) + Sign out (compacts). This fits at 375px today. **Gap:** the breadcrumb (`max-w-[40ch]` current part) can still push the cluster wide on a long record name. Fix: at `max-md` cap the breadcrumb to **back-context only** — show just the current (truncated `max-w-[18ch]`) part, drop the parent links (the in-page `BackBar` already carries the parent escape on detail pages; the drawer carries top-level nav). Or truncate harder. **Recommend: at `max-md`, render only the last 1 part, `max-w-[20ch] truncate`.**
  - Rail drawer: add (a) a focus-trap + `Esc`-to-close + return-focus-to-hamburger (a11y — the overlay is currently non-focus-trapping, a known DESIGN.md build-gap), (b) a visible close (×) control at the drawer top (`modal-escape`), (c) swipe-to-dismiss is nice-to-have (defer), (d) `env(safe-area-inset-*)` padding so the drawer clears the notch/home-indicator (`safe-area-awareness`).
  - Main content gutter: `px-6` (24px) at 375px leaves 327px for content — fine, but the DataTable cards + dense tables benefit from `max-md:px-4` (16px) → 343px. **Recommend `max-md:px-4 max-md:pt-4`.**
  - `min-h-dvh`/`h-screen`: the shell uses `h-screen` (`100vh`). On mobile browsers `100vh` includes the collapsing URL bar → content under the bottom chrome. **Recommend `h-[100dvh]`** (`viewport-units`) for the shell grid. Low-risk, high-value.
- **States:** drawer open/closed, scrim; impersonation banner (full-bleed, already `banner` slot). No new states.
- **Tokens:** unchanged. New utilities: `h-[100dvh]`, `env(safe-area-inset-*)`, `max-md:px-4`, breadcrumb `max-md` truncation.

### C4 — Procurement stepper + summary (largely DONE — verify)
- **375px layout:** `PageHeader` (same reflow as C2 — actions overflow). `LifecycleStepper variant="node"`: already `overflow-x-auto` with `min-w-[96px]` steps + connector `::after` — at 375px ~3.5 of the (now full-word-labelled) steps show, the rest scroll. Add the right-edge `mask-image` fade so the scroll is discoverable. `StatTiles` summary: already scroll-snaps. The action buttons (Submit/Approve/Mark-Paid etc.) + `ConfirmDialog`s: buttons need `.touch-target`/wrap; ConfirmDialog is already a centered modal (verify it's `max-md:` full-width-ish, not clipped; the `confirm-anim` scale is fine).
- **States:** loading, no-access (`ListState` lock), error+retry, every lifecycle stage's stepper — all implemented; verify at 375px.
- **Tokens:** unchanged. New: stepper fade affordance.

### C5 — Sales kanban (SCROLL-SNAP, OD-W4-2)
- **375px layout:** `.kanban-scroll` keeps horizontal scroll; add `scroll-snap-type: x mandatory` to `.kanban-scroll` and `scroll-snap-align: start` to each `.kcol` so columns land cleanly one-at-a-time (with the next peeking). Add a **sticky stage-progress strip** above the board at `max-md` (5 dots/labels mirroring the funnel, the current column highlighted `primary`) so the user knows where they are in the 5-stage scroll — reuses funnel `dotColor`s. The column header is already `.kcol-head-sticky`. Kanban cards already clear touch size. The Table view (toggle already present) is the dense single-column alternative — now card-reflowed by PR-1, so "Kanban OR mobile-friendly Table" is a real choice.
- **States:** loading/empty/error already handled at the `SalesPipeline` level; the Lost column + terminal handling unchanged. Verify the funnel band (already `overflow-x-auto min-w-[640px]`) + the toolbar (`flex-wrap`) at 375px.
- **Tokens:** `kanban-card`, `secondary/50` column body, funnel `dotColor`s for the stage strip. New: scroll-snap, the stage-progress strip (new small component or inline).

### C6 — Touch targets (cross-cutting audit) — see §1.3 + §5 audit tables.

---

## 3. All states @375px + WCAG-AA

**States (every surface must hold at 375px):** default, loading (skeleton, not spinner — `progressive-loading`), empty (teaches — `empty-states`), error (+ retry / recovery path — `error-recovery`), access-denied (the shared `AccessDenied`), and each surface's edge states (returned-timesheet, pre-win banner, lost deal, no-quote procurement). Reflow must not drop a state — the DataTable card branch reuses the SAME `ListState`, so the three async states are structurally identical to the table.

**WCAG-AA, verified at 375px:**
- **Touch ≥44px** (`touch-target-size`): every interactive box <44px carries `.touch-target` or coarse-padding (audit §5). 8px min spacing between targets (`touch-spacing`) — the card `<dl>` rows + button gaps already exceed this.
- **No horizontal scroll of the PAGE** (`horizontal-scroll`): the shell already `overflow-x-hidden` + `min-w-0`. Contained scroll regions (kanban, timesheet matrix, stepper, funnel, StatTiles) are intentional and bounded — they scroll WITHIN a region, the page does not. The DataTable card-reflow REMOVES the last unbounded-width table.
- **Focus visible** (`focus-states`): the global `*:focus-visible` ring is inherited; the new card activation `<button>` and the scroll-snap tabs/columns keep it. The drawer adds a focus-trap (currently missing — fixed in C3).
- **Reflowed table keeps semantics**: cards are `role="list"`/`<li>`; each card's activation is a real `<button aria-label={rowLabel}>` (so screen readers + `getByRole` reach it); `<dl>/<dt>/<dd>` give each value a programmatic label. The `aria-sort` headers are a desktop-table affordance (cards don't sort) — acceptable, sorting stays a `md:` capability.
- **Color-not-only** (`color-not-only`): preserved — status pills carry a dot + label + darkened-AA text; aging is text + color; invalid cells are border + inline "0–24 only" + `aria-invalid`. Unchanged by reflow.
- **Safe-area** (`safe-area-awareness`): the drawer + any bottom-pinned action bar add `env(safe-area-inset-bottom/left)`. `h-[100dvh]` for the shell.
- **Reduced-motion**: the new scroll-snap + fades are CSS/compositor; the global `prefers-reduced-motion` rule already neutralizes animations. `scroll-behavior: smooth` on tab-into-view must be gated by the existing reduced-motion block (it already sets `scroll-behavior: auto`).
- **16px base** (`readable-font-size`): root is 16px (load-bearing, per `index.css` comment) — inputs won't trigger iOS auto-zoom. Preserved.

---

## 4. Tokens / Tailwind utilities per piece (flagged: new vs existing)

| Piece | Tokens (DESIGN.md) | Tailwind / CSS utilities | New? |
|---|---|---|---|
| DataTable card | `card`, `border`, `rounded.md`, `{spacing.4}`, `{spacing.2}`, `overline`, `body`, `accent`, `primary/[0.07]`, `tabular` | `hidden md:block` / `md:hidden`, `grid grid-cols-[auto_1fr]`, `role="list"` | reflow logic NEW (CSS-only); tokens existing |
| Table-reflow breakpoint | — | `md` (768px) as the named boundary | **NEW DESIGN.md standard (OD-W4-4)** |
| Touch targets | — | `.touch-target` (existing) + coarse-padding for list rows | utility exists; applied to more sites |
| Tabs scroll-strip | `primary` underline, `border` | `overflow-x-auto snap-x`, right `mask-image` fade | reflow NEW; tokens existing |
| Timesheet matrix | unchanged | `max-md:min-w-[160px]` project col, sticky-right Total, `mask-image` fade | hardening; tokens existing |
| Project header actions | `Button` variants | `flex-wrap` + actions-`⋯` overflow (reuse RowMenu) | layout NEW; tokens existing |
| Shell | unchanged | `h-[100dvh]`, `env(safe-area-inset-*)`, `max-md:px-4`, breadcrumb `max-md` truncate, drawer focus-trap/Esc/close | utilities NEW; tokens existing |
| Kanban | `kanban-card`, `secondary/50`, funnel `dotColor` | `scroll-snap-type/-align`, sticky stage strip | scroll-snap NEW; tokens existing |
| Stepper / Funnel / StatTiles | unchanged | `mask-image` fade (stepper) — others done | minor; tokens existing |

**Genuinely-new DESIGN.md additions (owner sign-off):**
1. **The table-reflow breakpoint = `md` (768px)** — add to DESIGN.md §Layout/Components as the named "DataTable card-reflow boundary," alongside the existing 920px rail-collapse. (OD-W4-4.) This is a documented breakpoint, not a new visual token.
2. **No new colors, type, radius, or spacing.** Everything reflows with existing tokens. (Identity preserved — impeccable's rule honored.)
3. *(Optional, flag only)* a `mask-image` scroll-fade is used in 3+ places (StatTiles already, + stepper + tabs + timesheet) — consider codifying a `.scroll-fade-x` utility in `index.css` so the gradient mask is defined once. Minor DX, not a token. Recommend yes.

---

## 5. PR breakdown (ordered by reach / risk)

Big surface; split into 3 PRs, each independently shippable, each getting a **375px rendered design-review** before merge (the 3-lens battery, `docs/design-workflow.md` §2.3).

### PR-1 — DataTable→card reflow + touch-target sweep (HIGHEST REACH)
- The `DataTable` dual-render (Option A): `<table>` `hidden md:block` + a `md:hidden` card list reusing `columns`/`rowKey`/`rowLabel`/`rowMenu`/`state`. (§1.2)
- `Button`: auto-apply `.touch-target` for `size="icon"`/`"sm"` (or sweep call-sites). `BackBar`, breadcrumb links, week-steppers, RowMenu items (coarse-padding) — the §1.3 audit.
- DESIGN.md: add the `md` table-reflow breakpoint standard + (optional) `.scroll-fade-x` utility note. (OD-W4-4)
- **Reach:** every list in the app (Companies, Procurement, Sales table, Incidents, project sub-tabs) reflows from one change. **Risk:** low — the table branch is byte-unchanged (desktop can't regress); the card branch is additive.
- **Verify:** unit (card renders the same `cell` nodes; activation `<button>` present + labelled; `state` delegates to `ListState`); the existing `getByRole('row')`/`rowLabel` e2e still pass at desktop width; rendered 375px review of Companies + Sales-table + Procurement.

### PR-2 — Shell chrome hardening (drawer a11y, breadcrumb, dvh, safe-area, gutter)
- Drawer: focus-trap + `Esc` + return-focus + visible close (×) + safe-area inset. (C3)
- `h-[100dvh]` shell; `max-md:px-4 max-md:pt-4` main gutter; breadcrumb `max-md` truncate-to-current.
- **Reach:** every page (the shell wraps all). **Risk:** medium — touches the shell + focus management; the drawer focus-trap is the trickiest bit (test keyboard path explicitly).
- **Verify:** keyboard-only drawer open→trap→Esc→return-focus; 375px render of a deep detail page (breadcrumb not pushing the cluster); dvh on a real mobile viewport (or devtools).

### PR-3 — Detail surfaces: project header + procurement + kanban + tabs
- `Tabs` scroll-snap strip (used by ProjectDetail). (C2)
- `PageHeader` actions-overflow `⋯` + `flex-wrap` (project + procurement). (C2/C4)
- PipelineLens banner: action buttons `.touch-target`/wrap; deal figures via `StatTiles` if not already.
- Kanban: `scroll-snap` + sticky stage-progress strip. (C5/OD-W4-2)
- Timesheet matrix hardening: `max-md:min-w-[160px]` project col, sticky-right Total, scroll fade. (C1b/OD-W4-3)
- Stepper scroll-fade.
- **Reach:** the heaviest individual surfaces. **Risk:** medium — most pieces are CSS-only on already-scrolling regions; the `Tabs` reflow + PipelineLens are the most involved.
- **Verify:** 375px render of `/projects/:id` (delivery AND pre-win/banner states), a procurement detail at 2–3 lifecycle stages, the kanban scroll-snap, a Submitted vs editable timesheet.

**Sequencing:** PR-1 → PR-2 → PR-3. PR-1 unblocks the most surfaces and is the lowest risk; PR-2 is the shell foundation the detail pages sit in; PR-3 is the long tail of detail surfaces. Each gated per the Wave-3 cadence (implementer → Director verify → code-quality-reviewer → run touched e2e LOCALLY → PR → CI → gate-merge on `conclusion=success`).

---

## 6. Mockup recommendation

Mobile reflow is high-risk-to-read-wrong (a stacked card can look right in spec and read as cluttered when rendered — the `/projects/:id` "is it usable?" lesson). Two surfaces warrant a **quick static mockup before build**; the rest are review-post-build (every PR gets a 375px rendered design-review regardless).

- **MOCKUP (before PR-1): the DataTable→card reflow.** This is the new visual pattern the whole app inherits — get the card anatomy (title vs label:value hierarchy, where the `⋯` sits, how a status pill + a money value + a progress bar look stacked) in front of the owner ONCE, on the densest consumer (Sales table: 7 columns incl. a progress bar, a pill, two money columns, an owner-avatar). A single 375px static mockup of that one table-as-cards de-risks the primitive. (impeccable `craft`/`shape` can produce it, or a throwaway HTML in `docs/design-mockups/`.)
- **MOCKUP (before PR-2/3): the mobile shell + the project-detail tab strip.** The drawer is built, but the breadcrumb-truncation + the scroll-snap tab strip + the header actions-overflow are layout decisions worth a quick render so the owner sees the wayfinding at 375px before three detail pages adopt it.
- **REVIEW-POST-BUILD (no mockup): timesheet matrix, kanban scroll-snap, procurement stepper, StatTiles.** These keep their existing visual structure (just hardened) — a pre-build mockup would mostly re-draw what's shipped. The per-PR 375px rendered review catches issues.

---

## 7. Open questions (beyond the OD flags)

- **Tablet band (768–920px):** with OD-W4-4's two breakpoints, a tablet keeps the dense table (≥768px) while the rail is a drawer (≤920px). Confirm that's the intended tablet experience (dense table + drawer nav). It's the right call for a data tool, but it's a deliberate in-between state worth naming.
- **Sort on mobile cards:** dropped (sorting is a `md:` table affordance). If a key mobile list NEEDS sort (e.g. timesheet-approvals by date), add a sort `<select>` to that toolbar in a follow-up — not Wave 4.
- **PipelineLens internals:** I did not deep-read `PipelineLens.tsx`'s exact button/figure layout (it's mid-edit on the current branch). PR-3 must read it fresh; if it doesn't already use `StatTiles`/`LifecycleStepper`, the reflow effort is slightly higher than estimated. Flagged, not assumed.
- **Landscape phone:** the plan targets 375px portrait. Landscape (`orientation-support`) should be spot-checked but is lower priority; the contained-scroll patterns degrade gracefully.

---

## Traceability

| Finding | Surface | Addressed in |
|---|---|---|
| C1 tables clip <768px | DataTable | PR-1 (card reflow) |
| C1 timesheet grid | TimesheetGrid | PR-3 (matrix hardening, OD-W4-3) |
| C2 project header reflow | ProjectDetailHeader + Tabs + PipelineLens | PR-3 |
| C3 shell chrome | AppShell / ContextBar / Breadcrumb / Rail | PR-2 (OD-W4-1: keep drawer) |
| C4 procurement stepper/summary | ProcurementDetails | PR-3 |
| C5 sales kanban overflow | SalesPipeline / SalesKanbanBoard | PR-3 (OD-W4-2: scroll-snap) |
| C6 touch targets ≥44px | Button / RowMenu / shell / all | PR-1 (sweep) + per-surface |
