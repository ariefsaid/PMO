# Foundation Design-Plan — Token Pipeline + App Shell + Shared Primitives

**Date:** 2026-06-06
**Author:** design-architect
**Status:** Design+Plan — Issue 1 of the UI Realignment program (`docs/plans/2026-06-06-ui-realignment.md`). The first buildable issue; everything else depends on it.
**Authorities:** `DESIGN.md` (tokens/identity) · `docs/design-mockups/proposal-IA-3-hybrid.html` (layout/IA) · `docs/product-expectations.md` Part C.
**Method:** `impeccable shape` + `ui-ux-pro-max` `plan` + `design-system` (primitive→semantic→component token layering) + `taste` states/a11y/anti-slop folded into acceptance. Reference/gap-analysis only.

> **Implementer contract.** No placeholders. Every task names exact file paths and `DESIGN.md` tokens (never raw hex/px). TDD: write the failing test first, then the component. Tasks are sized 2–5 min. The data layer (`src/lib/db/*`, TanStack Query), auth, role-gating, and impersonation are **preserved** — Foundation does not touch them except to consume `useEffectiveRole`/`getNavItems` semantics in the new shell.

---

## Part 0 — Conventions & file layout

New shared code lives under `pmo-portal/src/components/`:
```
pmo-portal/src/components/
  shell/      AppShell, Rail, ContextBar, TabStrip, CommandPalette, Breadcrumb, BackBar
  ui/         Button, Badge, StatusPill, Card, KPITile, DataTable, ViewToggle,
              ProgressBar, ListState, Tooltip, Toast, Kanban, LifecycleStepper,
              Funnel, GateNotice, PageHeader, Tabs, StatTiles  (+ index.ts barrel)
  ui/__tests__/   Vitest/RTL specs (co-located *.test.tsx also acceptable)
```
- The legacy `pmo-portal/components/Sidebar.tsx` + `Header.tsx` are **replaced** by `shell/Rail.tsx` + `shell/ContextBar.tsx`; `App.tsx` `Shell` is refactored to mount `AppShell`.
- Styling: Tailwind v4 (`@tailwindcss/vite`) utilities mapped to tokens (Part 1). A small amount of component CSS for the signature surfaces (kanban scroll, stepper connectors, skeleton shimmer) lives in `index.css` under clearly-commented blocks; everything else is utilities.
- Icons: a single stroke-2 SVG set in `src/components/ui/icons.tsx` (port the mockup's `ICONS` map — SVG only, no emoji). One family, one stroke width.
- Tests assert behavior (states render, a11y attributes present, keyboard works), not snapshots.

---

## Part 1 — Token pipeline (`pmo-portal/index.css` + Tailwind theme)

**Goal.** Replace the prototype `primary-50..950` ramp with the DESIGN.md RIS token system as `:root` HSL triplets, map Tailwind v4 `@theme` to `hsl(var(--token) / <alpha>)`, add the `tabular` utility + global focus ring + recharts theming, and remove dark mode.

### Task 1.1 — Define `:root` HSL triplets (no test; structural)
In `pmo-portal/index.css`, **replace** the `@theme { --color-primary-50…950 }` block and the `@custom-variant dark` line with a `:root` block of **bare `H S% L%`** triplets (canonical runtime form so `/ <alpha>` works), copied from DESIGN.md / the IA-3 `:root` (they are identical "Token System A"):

```css
:root {
  --background: 0 0% 100%;            --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;                  --card-foreground: 240 10% 3.9%;
  --popover: 0 0% 100%;              --popover-foreground: 240 10% 3.9%;
  --primary: 221.2 83.2% 53.3%;      --primary-foreground: 0 0% 98%;
  --secondary: 240 4.8% 95.9%;       --secondary-foreground: 240 5.9% 10%;
  --muted: 240 4.8% 95.9%;           --muted-foreground: 240 3.8% 46.1%;
  --accent: 240 4.8% 95.9%;          --accent-foreground: 240 5.9% 10%;
  --destructive: 0 84.2% 60.2%;      --destructive-foreground: 0 0% 98%;
  --warning: 43 96% 56%;             --warning-foreground: 22 78% 26%;
  --success: 142 71% 45%;            --success-foreground: 0 0% 98%;
  --border: 240 5.9% 90%;            --input: 240 5.9% 90%;
  --ring: 221.2 83.2% 53.3%;         --violet: 262 83% 58%;
  --radius: 0.5rem;
  --rail-w: 224px;                   --header-h: 56px;   --tabstrip-h: 40px;
}
```
**Acceptance:** the 50..950 ramp and `@custom-variant dark` are gone; all DESIGN.md color tokens + `--radius`/`--rail-w`/`--header-h`/`--tabstrip-h` present as bare triplets.

### Task 1.2 — Map Tailwind v4 `@theme` to the vars
In `index.css`, add a Tailwind v4 `@theme inline` block mapping color utilities to `hsl(var(--token) / <alpha-value>)` and radii (shadcn's standard mapping, plus the RIS additions `warning`/`success`/`violet`):
```css
@theme inline {
  --color-background: hsl(var(--background) / <alpha-value>);
  --color-foreground: hsl(var(--foreground) / <alpha-value>);
  --color-card: hsl(var(--card) / <alpha-value>);
  --color-card-foreground: hsl(var(--card-foreground) / <alpha-value>);
  --color-popover: hsl(var(--popover) / <alpha-value>);
  --color-popover-foreground: hsl(var(--popover-foreground) / <alpha-value>);
  --color-primary: hsl(var(--primary) / <alpha-value>);
  --color-primary-foreground: hsl(var(--primary-foreground) / <alpha-value>);
  --color-secondary: hsl(var(--secondary) / <alpha-value>);
  --color-secondary-foreground: hsl(var(--secondary-foreground) / <alpha-value>);
  --color-muted: hsl(var(--muted) / <alpha-value>);
  --color-muted-foreground: hsl(var(--muted-foreground) / <alpha-value>);
  --color-accent: hsl(var(--accent) / <alpha-value>);
  --color-accent-foreground: hsl(var(--accent-foreground) / <alpha-value>);
  --color-destructive: hsl(var(--destructive) / <alpha-value>);
  --color-destructive-foreground: hsl(var(--destructive-foreground) / <alpha-value>);
  --color-warning: hsl(var(--warning) / <alpha-value>);
  --color-warning-foreground: hsl(var(--warning-foreground) / <alpha-value>);
  --color-success: hsl(var(--success) / <alpha-value>);
  --color-success-foreground: hsl(var(--success-foreground) / <alpha-value>);
  --color-border: hsl(var(--border) / <alpha-value>);
  --color-input: hsl(var(--input) / <alpha-value>);
  --color-ring: hsl(var(--ring) / <alpha-value>);
  --color-violet: hsl(var(--violet) / <alpha-value>);
  --radius-lg: var(--radius);                 /* 8px */
  --radius-md: calc(var(--radius) - 2px);     /* 6px */
  --radius-sm: calc(var(--radius) - 4px);     /* 4px */
}
```
This yields utilities `bg-primary`, `text-muted-foreground`, `bg-primary/10`, `border-border`, `rounded-lg/md/sm`, `bg-success/12`, etc. — the slash-alpha tints are load-bearing (Tinted-Status + hover-wash) and work because the var is a bare triplet.
**Acceptance:** `bg-primary/10` and `text-warning-foreground` compile and render the DESIGN.md hues.

### Task 1.3 — Base layer: body, `tabular`, focus ring, font
In `index.css` `@layer base`:
```css
html, body { background: hsl(var(--background)); color: hsl(var(--foreground));
  font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 14px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
.tabular, .tnum { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
*:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; border-radius: 4px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}
```
Add the Inter + JetBrains Mono font links (or `@fontsource`) — Inter for everything, mono **only** for IDs/⌘K (Mono-For-Identifiers Rule). **Note:** `taste`'s "ban Inter" directive is overridden — DESIGN.md mandates Inter.
**Acceptance:** `.tnum` applies tabular figures; every focusable shows the 2px primary ring; reduced-motion disables transitions.

### Task 1.4 — Skeleton + signature component CSS blocks
Port from the mockup, under commented blocks in `index.css` (token-referenced, no raw hex except the desaturated near-black shadow alphas DESIGN.md explicitly sanctions): `.skel`/`@keyframes shimmer`, kanban scroll/column, stepper connectors, tooltip dark surface (`hsl(240 10% 8%)` per DESIGN.md), toast slide-in, the `secondary/.35` main wash. Shadows use the DESIGN.md vocabulary (state-lift `0 2px 10px hsl(240 6% 10% / .06)`, etc.) — never `rgba(0,0,0,…)`.
**Acceptance:** shimmer animates and stops under reduced-motion; tooltip/toast surfaces match DESIGN.md elevation.

### Task 1.5 — Recharts token theming helper
Create `pmo-portal/src/components/ui/chartTheme.ts` exporting token-derived constants: `axis`/`grid` = `hsl(var(--border))` / `hsl(var(--muted-foreground))`; series `primary`/`success`/`warning`/`destructive`/`violet` resolved from the vars; a `categorical[]` array from the mockup's frozen series hues (see Open Question 2 — these are the only sanctioned literals, pending promotion to `chart-*` tokens).
**Test (`chartTheme.test.ts`):** asserts the helper returns the DESIGN.md token strings (e.g. `axis === 'hsl(var(--border))'`) and the categorical array length matches the frozen palette. **Acceptance:** no chart color is invented; all derive from tokens or the frozen categorical set.

### Task 1.6 — Remove dark mode from `App.tsx`
Delete the `React.useEffect` that adds `document.documentElement.classList.add('dark')` on `prefers-color-scheme: dark` (App.tsx lines ~78–83) and the `dark:` Tailwind variant usage in the shell. (Per-surface `dark:` class removal is each surface issue's job — Foundation only removes shell-level dark classes it rewrites.)
**Acceptance:** no `.dark` class is ever applied; `color-scheme: light` only.

### Migration note (do NOT execute here — per-surface)
The shell/pages use prototype utilities that must migrate to tokens. **Inventory + proposed mapping** (each per-surface issue applies its own; Foundation only migrates the shell files it rewrites):

| Legacy utility (current) | Token utility (target) |
|---|---|
| `bg-gray-50` / `bg-gray-100` / `bg-gray-900/800` (Shell, main) | `bg-background` / `bg-secondary/35` (main wash) |
| `bg-white dark:bg-gray-800` (rail/header) | `bg-card` |
| `bg-primary-500 text-white` (active nav) | `bg-primary/10 text-primary font-semibold` (nav-item-active) |
| `text-primary-600` / `text-primary-400` (brand) | `text-primary` |
| `text-gray-600/300` (nav inactive) | `text-foreground` + `hover:bg-accent` |
| `border-gray-200 dark:border-gray-700` | `border-border` |
| `bg-primary-50 text-primary-700` (impersonation active item) | `bg-primary/10 text-primary` |
| `hover:bg-gray-100/200/700` | `hover:bg-accent` |

**Approach for surfaces:** mechanical find-and-replace per file against this table, then `/design-review` to catch tint/contrast regressions. The `dark:` variants are dropped entirely. This is recorded so each surface PR has a deterministic migration recipe, not a freehand re-skin.

---

## Part 2 — App shell

Replaces `components/Sidebar.tsx` + `Header.tsx`; refactors `App.tsx` `Shell`. Preserves: role-gating (`getNavItems` logic), auth, `ImpersonationProvider` (view-only, ADR-0008), all existing routes.

### Tab-workspace architecture (the locked-in decision — specified concretely)

**Provider:** `pmo-portal/src/components/shell/WorkspaceTabsProvider.tsx` — a React context above `<Routes>` inside the authed shell, below `BrowserRouter` (so it can use `useNavigate`/`useLocation`).

**Tab model:**
```ts
type TabKind = 'module' | 'record';
interface WorkspaceTab {
  id: string;          // module: the route key e.g. 'sales'; record: `${kind}:${routeId}` e.g. 'project:PRJ-0142'
  kind: TabKind;
  path: string;        // canonical URL this tab maps to (e.g. '/sales' or '/projects/PRJ-0142')
  icon: IconName;      // from icons.tsx
  label: string;       // tab text (record label truncates at maxWidth 240px / ellipsis)
  code?: string;       // mono id badge for record tabs (OPP-/PR-/PRJ-)
  dirty?: boolean;     // amber wt-dirty dot — set from real unsaved/in-progress state, never invented
  module: string;      // owning rail group key for rail-sync (record tabs map to their parent module)
}
interface WorkspaceState { tabs: WorkspaceTab[]; activeId: string; }
```
Default state: a single non-closable `dashboard` module tab (matches mockup boot).

**Context API:** `openModule(moduleKey)`, `openRecord(tab)`, `closeTab(id)`, `selectTab(id)`, `setDirty(id, bool)`, plus `tabs`, `activeId`.
- `openModule` / `openRecord`: if a tab with the same `id` exists → **refocus** (set active, `navigate(path)`); else push + activate. (open/refocus semantics from the mockup `openModule`/`openRecord`.)
- `closeTab`: remove; if it was active, activate the previous tab (`tabs[max(0, idx-1)]`) and navigate there. The `dashboard` module tab is **not closable** (no close affordance rendered).

**URL / route synchronization (react-router 7):**
- **Source of truth is the URL.** A `useTabRouteSync()` hook (in the provider) subscribes to `useLocation()`: on navigation it derives the matching tab (`matchPath` against `/`, `/sales`, `/sales/:id`, `/procurement`, `/procurement/:id`, `/projects`, `/projects/:id`, `/timesheets`) and `openModule`/`openRecord`s it if absent, then sets it active. This means a deep-link or browser Back/Forward stays in sync with the strip without the strip being a second router. (`deep-linking`, `back-behavior`, `state-preservation` guidelines.)
- Clicking a tab → `navigate(tab.path)`. Clicking a rail item → `openModule` → navigate. Drilling a row → `navigate('/sales/:id')` → sync hook opens the record tab.
- Record tab labels/codes are resolved from the loaded record (TanStack Query cache) — the tab opens immediately with the id, label hydrates when the query resolves.

**Persistence (`sessionStorage`):** the provider persists `{tabs, activeId}` to `sessionStorage` key `pmo.workspace.tabs` on change (debounced), and `VIEW` toggle state per surface to `pmo.workspace.views`. On mount, rehydrate; if the rehydrated `activeId` mismatches the current URL, the URL wins (URL is source of truth). (Open Question 5: session vs local — default session.)

**Keyboard:**
- `⌘K` / `Ctrl-K` → open command palette (global `keydown`, `e.preventDefault()`).
- Tab strip: each `ws-tab` `role="tab"` `tabindex=0`; `Enter`/`Space` selects; `ArrowLeft`/`ArrowRight` move focus between tabs (roving tabindex); `Esc` in palette closes; tab `wt-close` button is focusable with its own `aria-label="Close {label}"`.
- Palette: `ArrowUp`/`ArrowDown` move selection, `Enter` runs, `Esc` closes, focus trapped in dialog, returns focus to trigger on close (a11y gap the mockup left open — we close it here).

**Open/close/refocus + dirty + responsive** are all in the provider; the `TabStrip` is a pure render of `tabs`/`activeId`.

### Task 2.1 — WorkspaceTabsProvider + reducer (TDD)
**Test (`WorkspaceTabsProvider.test.tsx`):** render provider; assert default dashboard tab; `openModule('sales')` adds+activates; calling again refocuses (no dup); `openRecord({id:'project:PRJ-1'…})` adds; re-open refocuses; `closeTab` of active activates previous; dashboard tab is not closable; `setDirty` flips the flag; state persists to a mocked `sessionStorage`. **Then** implement the reducer + provider.

### Task 2.2 — useTabRouteSync (TDD)
**Test:** with `MemoryRouter` at `/projects/PRJ-0142`, mounting the provider opens a matching record tab and marks it active; navigating to `/sales` opens/activates the sales module tab; Back to a closed tab re-opens it. **Then** implement the `matchPath`-based sync hook.

### Task 2.3 — TabStrip (TDD)
**Test (`TabStrip.test.tsx`):** renders one `[role=tab]` per tab with `aria-selected` on active + the `+` (open-palette) button; module tabs render no close button, record tabs do; clicking close calls `closeTab`; clicking a tab calls `selectTab`; ArrowRight moves roving focus; dirty tab shows the `wt-dirty` dot. **Then** implement `TabStrip.tsx` — tokens: `bg-secondary/50` strip, `border-border`, active tab `bg-background` + top `border-primary` 2px + `font-semibold`, `wt-code` mono `text-muted-foreground`, height `--tabstrip-h`.

### Task 2.4 — Rail (TDD; preserve role-gating)
**Test (`Rail.test.tsx`):** mock `useEffectiveRole`; assert the rail renders exactly the items returned by the **preserved `getNavItems` role logic** (Executive sees Dashboard/Projects/Sales/Procurement/Timesheets/Approvals/Companies/Reports; Engineer sees the Engineer subset; Admin sees Administration foot item); active item has `aria-current="page"`; grouped under Overline group labels (Overview / Sales / Delivery / Workforce); stub items are `aria-disabled`. **Then** implement `Rail.tsx`:
- Port `getNavItems` (and the Admin/Exec Administration foot item) verbatim from `Sidebar.tsx` — same `UserRole` enum, same `ROLE_MAP`, same `roles:[…]` arrays. Group items into Overview/Sales/Delivery/Workforce per the mockup rail structure.
- Tokens: width `--rail-w`, `bg-card`, right `border-border`, brand block 56px (`--header-h`) with 28px `bg-primary` logo square + `primary-foreground` glyph; group labels Overline type (`text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground`); nav-item 36px, `rounded-md`(=calc 6px per shadcn), `hover:bg-accent`, active `bg-primary/10 text-primary font-semibold`; count badge `bg-secondary text-muted-foreground rounded-full`, active flips `bg-primary/15 text-primary`. Settings in `rail-foot` (top border).
- Each item navigates via `openModule` (rail click) — wired to the provider.

### Task 2.5 — ContextBar (TDD; preserve impersonation)
**Test (`ContextBar.test.tsx`):** renders breadcrumb (from active tab), ⌘K trigger with `aria-keyshortcuts`, notifications icon-btn (with `aria-label` describing count + destructive dot), user chip; **when `canImpersonate`** (mock Admin) renders the "View as role" control wired to `viewAs` (view-only, does not alter session); when not, it is absent; sign-out calls `signOut`. **Then** implement `ContextBar.tsx`:
- Height `--header-h`, `bg-background`, bottom `border-border`. Breadcrumb: `text-muted-foreground` links → `text-foreground` hover, chevron `sep`, `font-semibold text-foreground` current (ellipsis 40ch). ⌘K trigger = the `cmdk` field shell (`border-input`, `rounded-lg`, hover `border-primary/50` + faint ring) with mono `⌘K` kbd. Notifications `icon-btn` ghost + `destructive` dot. **Impersonation:** preserve the existing dropdown (role list, `viewAs`, `role="menu"`/`menuitem`, active item `bg-primary/10 text-primary`) — re-skinned to tokens, behavior unchanged (Admin-only, view-only). User chip: avatar gradient blue→violet (`linear-gradient(135deg, hsl(var(--primary)), hsl(var(--violet)))`), name/role hidden ≤920px.

### Task 2.6 — CommandPalette (TDD)
**Test (`CommandPalette.test.tsx`):** `⌘K` opens (dialog `role="dialog"` `aria-modal`); typing filters groups (Navigate / Open record / Actions); ArrowDown/Up move `aria-selected`; Enter runs the selected action (calls `openModule`/`openRecord`/navigate); Esc closes and returns focus to the trigger; clicking backdrop closes; no-match shows empty state. **Then** implement `CommandPalette.tsx`:
- Overlay `bg-[hsl(240_10%_4%/0.4)]` + backdrop blur (scrim ≥40% per `scrim` guideline); panel `bg-popover border-border rounded-[12px]` + overlay shadow; input row + Esc chip; grouped `cmdk-row`s (`role="option"`), selected `bg-accent`; mono `cr-code` for record ids. Focus trap + restore (closes the mockup's a11y gap). Data: navigate to each module + a small "open record" set sourced from cached lists (not hard-coded fake records — uses real query data; until lists load, show only Navigate + Actions groups).

### Task 2.7 — Breadcrumb + BackBar (TDD)
**Test:** Breadcrumb renders parts, last is `current` (not a link), others navigate on click/Enter; BackBar renders a "Back to {label}" button that navigates to the parent module path; both keyboard-operable. **Then** implement `Breadcrumb.tsx` + `BackBar.tsx` (tokens above; BackBar = 30px outline-style button with back icon).

### Task 2.8 — AppShell + App.tsx refactor (TDD)
**Test (`AppShell.test.tsx`):** renders the CSS grid areas (rail / header / tabstrip / main); main has `id="main"` `tabindex=-1` + a skip-link target; on route change focus moves to main (`focus-on-route-change` guideline); at a mocked `≤920px` width the rail is hidden and a hamburger appears. **Then:**
- Implement `AppShell.tsx`: the grid (`grid-template-columns: var(--rail-w) 1fr; grid-template-rows: var(--header-h) var(--tabstrip-h) 1fr`; areas rail/header/tabstrip/main), `main` = `overflow-y-auto bg-secondary/35`, `main-inner` `max-w-[1600px] mx-auto p-[20px_24px_64px]`. Include the skip-to-main link (`sr-only` → visible on focus).
- Refactor `pmo-portal/App.tsx` `Shell`: wrap `<WorkspaceTabsProvider>` (inside `BrowserRouter`, inside `ImpersonationProvider`), mount `<AppShell>` with `<Rail/>`, `<ContextBar/>`, `<TabStrip/>`, and the existing `<Suspense><Routes>…</Routes></Suspense>` in the `main` area. **Keep every existing `<Route>`** (incl. the two NEW detail routes `/sales/:opportunityId` added in Issue 2 — note the slot, don't add the page here). Remove the dark-mode `useEffect`.
- Responsive: `≤920px` → `--rail-w:0`, rail `display:none`, hamburger in ContextBar opens the rail as an overlay drawer (reuse the legacy `isSidebarOpen` pattern, re-skinned); ⌘K shrinks to icon; user name/role hide. `≤1180px` handled per-surface.

---

## Part 3 — Shared primitive library

Each primitive: token refs, all states, a11y, test list. Composite primitives (Kanban/Stepper/Funnel/PageHeader/Tabs/StatTiles/TimesheetGrid) get their **base shell** here; their surface-specific variants are filled by the first consuming issue (per master plan §3).

### 3.1 `Button.tsx` (TDD)
- **Variants:** primary (`bg-primary text-primary-foreground` + brand shadow `0 1px 2px hsl(var(--primary)/0.25)`, hover `bg-primary/90`) · outline (`bg-background border-input`, hover `bg-accent`) · ghost (transparent, hover `bg-accent`) · destructive (`bg-destructive text-destructive-foreground`, hover `/90`) · success (`bg-success text-success-foreground`, hover `/90`). **Sizes:** default 32px / `0 12px` / `rounded-lg`(8px); sm 28px / `0 9px` / 13px; icon 32px square.
- **States:** rest / hover / `:active` (`translate-y-[1px]`) / `:focus-visible` (global ring) / **disabled** (`opacity .45 cursor-not-allowed pointer-events-none` — DESIGN.md gap proposal, Open Q1) / loading (spinner + `disabled` + `aria-busy`, per `loading-buttons`).
- **a11y:** icon-only requires `aria-label`; loading sets `aria-busy`.
- **Tests:** each variant/size class; disabled is non-interactive + has the attribute; loading shows spinner + `aria-busy`; icon-only without `aria-label` fails a console-warn assertion.

### 3.2 `Badge.tsx` / `StatusPill.tsx` (TDD)
- **StatusPill:** 22px, `rounded-full`, 12px/600, leading 6px dot. Variants → bg = status hue ~10–18%, text = **darkened variant** (preserve DESIGN.md AA values, do NOT use base hue): `open` (`bg-primary/10` text `hsl(221 70% 45%)` dot `primary`) · `won` (`bg-success/12` text `hsl(142 64% 30%)`) · `lost` (`bg-destructive/10` text `hsl(0 72% 45%)`) · `overdue`/`warn` (`bg-warning/18` text `warning-foreground`) · `neutral`/`draft` (`bg-secondary text-muted-foreground`).
- **Badge (count):** `bg-secondary text-muted-foreground rounded-full`; active context flips `bg-primary/15 text-primary`.
- **a11y:** `color-not-only` — dot + text always; pill text contrast AA verified.
- **Tests:** each variant maps to the named token classes; dot present; the darkened text values are used (assert the class/inline value), not the base hue.

### 3.3 `Card.tsx` (+ CardHead, CardPad, clip) (TDD)
- `bg-card border border-border rounded-lg`; **no rest shadow** (Flat-By-Default); interactive variant gets `hover:shadow-[0_2px_10px_hsl(240_6%_10%/0.06)]`. CardHead: 13px/16px padding + bottom border + 14px/600 title. CardPad: 16px. clip: `overflow-hidden`. Seam variant: top corners rounded, bottom squared when above a table.
- **Tests:** static card has border + no shadow class; interactive card has the hover-lift class.

### 3.4 `KPITile.tsx` (+ dual-lens variant) (TDD)
- White card 16px pad, hover state-lift. Top row: 30px tinted icon tile (variants `blue`/`violet`/`amber`/`red`/`green`/`cyan` mapped to `primary/.12`, `violet/.12`, `warning/.18`+`warning-foreground`, `destructive/.12`, `success/.13`, the cyan literal — Open Q2) + label (`text-muted-foreground` 12.5px) + help `?` (tooltip-bound, `tabindex=0`, `aria-label`). Value 23px/700 `tnum` (negative → `text-destructive`). Foot: tinted delta chip (up `success/.12` / down `destructive/.10` / neutral `secondary`) + `muted` vs-comparison. Dual-lens variant: replaces foot with a 2-button segmented toggle (on-hand/weighted).
- **States:** value, loading (skeleton tile), the help tooltip.
- **Tests:** negative value gets `text-destructive`; delta direction maps to the right chip class; `tnum` applied; help is keyboard-focusable with `aria-label`; dual toggle switches value + `aria-selected`.

### 3.5 `DataTable.tsx` (+ Toolbar, SegFilter, SearchMini, sortable th, TableFoot, row-menu) (TDD)
- **Generic, typed** (`DataTable<Row>` with column defs: `header`, `cell(row)`, `align?: 'num'|'center'`, `sortKey?`). Header cells sticky `bg-card` 38px Overline type bottom-border; sortable → `foreground` on hover + sort glyph + `aria-sort`. Body rows 54px (note: mockup uses 56px+8px pad — use the DESIGN.md 54px spec), `border-border/70` dividers, hover `bg-accent/60`, selected `bg-primary/7`, focusable `tabindex=0` + inset focus ring, `onActivate(row)` on click/Enter (drives drill-down). Row-hover `⋯` menu button hidden until hover, opens a `Popover` menu (`bg-popover border-border rounded-lg` overlay shadow, `accent` hover, danger items `destructive`).
- **Toolbar:** `bg-card` seamed to table top (`rounded-t-lg`), holds children; `standalone` variant fully rounded. **SegFilter/ViewToggle:** see 3.6. **SearchMini:** `border-input rounded-lg` field shell, borderless inner input, `muted-foreground` placeholder, search icon. **TableFoot:** totals row `bg-secondary/40` 1.5px top border `tnum` values.
- **States:** the table itself is presentational; loading/empty/error are rendered by the **consumer via `ListState`** in place of `<tbody>`/the table (DataTable exposes a `state?: 'loading'|'empty'|'error'` prop that renders `ListState` spanning all columns).
- **a11y:** `aria-sort` on sorted column; rows keyboard-activatable; row-menu trigger has `aria-label`; `sortable-table` guideline.
- **Tests:** renders columns; numeric columns right-align; sortable header toggles `aria-sort` + calls sort handler; row Enter/click calls `onActivate`; `state='empty'` renders ListState empty; row-menu opens on trigger + Esc closes.

### 3.6 `ViewToggle.tsx` / `SegFilter` (segmented control) (TDD)
- 32px track `bg-secondary rounded-lg p-[2px]`, buttons 28px; "on" → `bg-background text-foreground font-semibold` + lift `0 1px 2px hsl(240 6% 10%/0.1)`. `role="tablist"`, each button `role="tab"` `aria-selected`, ArrowLeft/Right move selection. Optional leading icon + trailing count badge (e.g. Approvals queue "4").
- **Tests:** active button has `aria-selected=true` + the on-classes; arrow keys change selection; onChange called with the value; reduced-motion strips the transition.

### 3.7 `ProgressBar.tsx` (win% / utilization) (TDD)
- Track `bg-secondary rounded-full`, fill threshold-colored: pass a `tone` or compute (≥70 `success` / ≥40 `warning` / else `destructive`) or a fixed series color; `>100%` clamps width + fills `destructive`. Optional trailing `tnum` value. `role="progressbar"` + `aria-valuenow/min/max`.
- **Tests:** width = percent; threshold maps to the right token class; >100 clamps + destructive; aria values set.

### 3.8 `ListState.tsx` (loading / empty / error) — the shared backlog primitive (TDD)
- One component, `variant: 'loading'|'empty'|'error'`. **loading:** skeleton rows/cards (`.skel` shimmer) sized to layout, `aria-busy`, respects reduced-motion. **empty:** 52px `bg-secondary` rounded icon tile + 15px/600 title + `muted` sub (≤44ch) + optional action button (`empty-states` guideline — composed, with the populating action). **error:** destructive-tinted banner (`bg-destructive/7 border-destructive/30`) + alert icon + title (`hsl(0 72% 42%)`) + sub + Retry button (`error-recovery` — cause + fix + retry); `role="alert"`/`aria-live`.
- **a11y:** loading `aria-busy`; error `role="alert"`; never color-only.
- **Tests:** each variant renders its structure; error shows retry + has `role="alert"`; empty renders the action; loading sets `aria-busy` + no shimmer under reduced-motion.

### 3.9 `Tooltip.tsx` + `Toast.tsx` (TDD)
- **Tooltip:** dark surface `bg-[hsl(240_10%_8%)] text-[hsl(0_0%_98%)] rounded-[7px]` overlay shadow, max 280px; opens on hover **and focus** (keyboard-reachable, `tooltip-keyboard`); `role="tooltip"`. **Toast:** `bg-popover border-border` + 3px left accent stripe (`primary`/`success`/`warning`), bottom-right, slide-in, auto-dismiss 3–5s (`toast-dismiss`), `aria-live="polite"` (does not steal focus, `toast-accessibility`).
- **Tests:** tooltip shows on focus (not hover-only); toast auto-dismisses + has `aria-live`; accent stripe maps to kind.

### 3.10 Composite shells (base only; variants per consuming issue) (TDD-light)
Author the **base shells + types + a smoke test each** so surface issues fill variants without restructuring:
- `Kanban.tsx` — `KanbanColumn` (sticky head: dot + title + optional prob chip + count + totals) + `KanbanCard` (focusable `role="button"`, hover-lift `0 4px 14px`, selected `border-primary` + ring). Horizontal scroll grid `minmax(258px,1fr)`. Test: renders columns + empty-column message + card Enter activates.
- `LifecycleStepper.tsx` — two variants behind one API: `inline` (9px pips done/current/paid + connecting links) and `node` (32px nodes done=check/`success`, current=`primary` ring, upcoming=`muted`, skipped=dashed; auto doc-ref slot). Test: current/done/upcoming classes; node check on done.
- `Funnel.tsx` — connected `card` stage segments + prob + value + weighted + bar. Test: renders N stages, selected gets `bg-primary/6` + inset rule.
- `GateNotice.tsx` — `blocked` (`bg-warning/12 border-warning/40 text-warning-foreground`) / `ready` (`bg-success/10 border-success/35` text darkened-success) with lock/check icon. Test: variant → token classes; AA text variant used.
- `PageHeader.tsx` (phead) — icon + name + status pill + meta + optional N-stat strip + actions slot. Test: renders stats + actions.
- `Tabs.tsx` (in-page `ptabs`) — `role="tablist"`, active `text-primary` + 2px `primary` underline, `aria-selected`, arrow-key nav. Test: selection + aria.
- `StatTiles.tsx` — 4-up `bg-border` gap-1px grid of `bg-card` tiles, label + `tnum` value (pos `success`/neg `destructive`). Test: pos/neg coloring.
- (`TimesheetGrid`/`HourCell` authored in Issue 6, not Foundation — listed for completeness.)

### 3.11 Barrel + Storybook seed
- `pmo-portal/src/components/ui/index.ts` re-exports all primitives.
- Seed Storybook (charter Part C — adopted at library extraction): a story per primitive with its **state matrix** (rest/hover/active/disabled/loading/empty/error as applicable) + the a11y addon. (If Storybook infra isn't yet installed, that setup is its own small task in this issue; stories are the per-component state-matrix proof.)
**Acceptance:** every primitive has a story showing all its states; a11y addon runs clean.

---

## Part 4 — Foundation acceptance checklist (folds taste + ui-ux-pro-max)

- [ ] Token pipeline: 50..950 ramp removed; all DESIGN.md tokens as `:root` triplets; Tailwind `@theme` mapped; `tabular` utility; global focus ring; recharts theme helper; dark mode removed.
- [ ] Shell: Rail preserves `getNavItems` role-gating exactly (test per role) + grouped + `aria-current`; ContextBar preserves Admin view-only impersonation (test) + sign-out; ⌘K palette with focus-trap + restore (closes mockup a11y gap); breadcrumb + back-bar.
- [ ] Tab workspace: provider + reducer + URL-sync + sessionStorage persistence + open/refocus/close/dirty + keyboard (⌘K/arrows/Enter/Esc/close) + `≤920px` responsive collapse — all tested.
- [ ] Primitives: each has all required states (loading/empty/error where applicable), disabled + focus semantics, `aria-*`, and a Vitest/RTL test; ListState is the single source for the three async states.
- [ ] A11y: AA contrast (status pills use darkened text variants); focus order rail→header→tabstrip→main; skip-link; focus-to-main on route change; charts (helper) ready for aria summaries; no color-only meaning.
- [ ] Anti-slop: SVG icons only (one family/stroke-2), Inter (DESIGN.md override of taste's ban), `tnum` everywhere, One Blue Rule, borders-not-shadows, minus glyph for negatives, reduced-motion honored.
- [ ] Tokens-only: zero raw hex/px in primitives except the DESIGN.md-sanctioned shadow alphas, the tooltip dark surface, status-pill darkened-text AA values, and the frozen categorical series set (Open Q2).
- [ ] Behavior preserved: routes intact, auth/RLS untouched, impersonation view-only, data layer unchanged.
- [ ] Gates: `npm run typecheck` + ESLint clean; ≥80% line coverage on changed code; `/design-review` before merge; Storybook state-matrix + a11y addon green.

---

## Part 5 — Open questions (owner / taste gate)

Same set as the master plan §6 — the build pauses on these; do not silently decide:
1. **Disabled/error field states** (DESIGN.md gap) — confirm the proposed `opacity .45`/`not-allowed` disabled + `destructive` error-field styling before any form lands.
2. **Categorical series hues → named `chart-*`/`avatar-*` tokens?** Promote the mockup's frozen series HSLs to tokens, or keep them as the sanctioned non-interactive literal set (identity-preserving)?
3. **Approvals: rail item vs Timesheets toggle** — default keep both.
4. **Per-role sub-dashboard KPI selection** — confirm against `src/lib/db/dashboard.ts` capabilities.
5. **Tab persistence: `sessionStorage` (default) vs `localStorage`.**
6. **Mobile (`≤920px`) tab strip: horizontal scroll (default) vs collapsed active-pill + overflow.**
