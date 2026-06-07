# Design-plan — Thin pages (C4): fill the dead space with REAL data

- **Date:** 2026-06-07
- **Workstream:** C4 (UI AI-slop audit `docs/reviews/2026-06-07-ui-slop-audit.md`)
- **Authority:** `DESIGN.md` (RIS "Quiet Control Surface"). Identity preserved — RIS tokens only, no new aesthetic, no new color/font/border. No AI slop.
- **Skills applied:** impeccable `shape` (product register) + ui-ux-pro-max `plan` (99-guideline checklist) + taste (states / a11y / anti-slop folded into the acceptance list).
- **Scope:** densify three thin surfaces — Engineer "My Dashboard" (~70% empty), the populated Timesheet weekly-grid view (~65% empty), Project-detail **Overview** tab (two cards then void). Fill **only** with data that already exists via current queries. **No fabrication. No dependency on deferred modules (Tasks, Documents, multi-currency, committed-cost).**
- **Constraint restated (audit C4):** where a slot would need a deferred module, leave it OUT and note it (see §7 Deferred slots).

---

## 0. Shape brief (impeccable `shape`, product register — discovery resolved by anchors)

Per `reference/shape.md`, the discovery interview is satisfied without a user round because `DESIGN.md` + `CLAUDE.md` + the audit pin every input (purpose, audience, content ranges, edge cases, direction, scope). No second round needed.

- **Feature summary.** Three authenticated operator surfaces read as wireframes. Densify each with real secondary data so the page feels complete and trustworthy without inventing content.
- **Primary user action.** Engineer: see *my* week at a glance (hours + status) and confirm the days are logged. Timesheet grid: read the week's hours per project/day and decide whether to submit. Overview: understand a project's money + procurement health in one screen before drilling into a tab.
- **Design direction.** Color strategy = **Restrained** (product floor; `DESIGN.md` The One Blue Rule). Scene sentence: *"A PM or engineer on a laptop in an office reviews their week or a project's health between meetings, focused, wanting numbers not decoration."* Forces **light scheme** (the only scheme in source). Anchors: Linear's project view, Stripe Dashboard's account overview, Notion's database row — all dense, calm, borders-not-shadows.
- **Scope.** Fidelity production-ready; breadth = three surfaces; interactivity = shipped components reusing existing primitives; time intent = polish-until-ships.
- **Layout strategy.** Replace single-card-then-void with a **two-column responsive composition** (`min-[920px]` two-up via the existing `DashGrid`, or a 2/3 + 1/3 `lg:grid-cols-3` split as Overview already uses). Emphasis: the user's own real numbers; secondary: recent activity / breakdowns that already exist in cache. Rhythm via `{spacing.4}` gaps, `{spacing.3}` inner. No new card nesting (taste Rule 4 / impeccable "cards are the lazy answer" — group with `divide-y divide-border/70`, not nested boxes).
- **Anti-goals.** NOT a marketing dashboard; NOT decorating-the-void with empty charts, fake KPIs, or placeholder rows; NOT a Tasks/Documents teaser; NOT a second accent color or emoji.
- **Recommended references during build:** `layout.md` (two-column rhythm), `product.md` (states), `clarify.md` (empty/edge copy).

---

## 1. Real-data inventory (the ONLY content these surfaces may use)

Confirmed by reading `src/lib/db/` + the hooks. Every cell below is data already fetched by an existing query/cache. Nothing else may appear.

| Source (existing) | Hook / call | Fields available now |
|---|---|---|
| `listTimesheets(userId)` → `TimesheetWithEntries[]` | `useTimesheets()` (`src/hooks/useTimesheets.ts`) | per sheet: `week_start_date`, `status`, `entries[]`; per entry: `hours`, `entry_date`, `project_id`, `notes`, `project.{name,code}` |
| `listProjects()` → `ProjectWithRefs[]` | `useProjects()` | `id, name, code, status, contract_value, budget, spent, start_date, end_date, client.{name}, pm.{full_name}, customer_contract_ref, project_manager_id` |
| `listProcurements()` → `ProcurementWithRefs[]` | `useProcurements()` | per row: `title, code, status, total_value, project_id, created_at, vendor.{name}, requested_by.{full_name}` |
| `listBudgetVersions(projectId)` → `BudgetVersionWithItems[]` | (called in Budget tab; reusable on Overview) | per version: `version, name, status, total`, `line_items[]` (`category, budgeted_amount, actual_amount`) |
| `LEGAL_TRANSITIONS` / status enums | `src/lib/db/procurementLifecycle.ts` | procurement status taxonomy for grouping |
| `formatCurrency` | `src/lib/format.ts` | USD, 0 fraction digits |

**Derivations allowed (pure, from the above — no new query):**
- Engineer: hours-this-week (already), **this-week hours by project** (group `current.entries` by `project_id`), **recent entries** (flatten all sheets' entries, sort by `entry_date` desc, top N), **last N weeks total** (sum each sheet's entries).
- Overview: **procurement summary for this project** (filter `useProcurements()` by `project_id`, count by status bucket, sum `total_value`), **budget snapshot** (Active version `total` + spent via `project.spent`), **recent procurement activity** (top N by `created_at`).
- Timesheet grid surround: **week status + weekly total** (already), **per-project week subtotals** (already in `gridRows`), **recent entries with notes** for the current week.

---

## 2. Surface A — Engineer "My Dashboard" (`src/components/dashboard/EngineerDashboard.tsx`)

### 2.1 Current state
Two KPI tiles, one "Hours This Week" bar card, then a dead `DashGrid` with a single child (the second column is empty). ~70% void.

### 2.2 Target composition (denser, real-only)
Keep the two KPI tiles (`kpi-hours-week`, `kpi-timesheet-status`). Then a **two-up `DashGrid`** that is genuinely two-up:

- **Left card — "Hours This Week"** (existing day-bar breakdown, unchanged logic).
- **Right card — "This week by project"** (NEW, real): group `current.entries` by `project_id` → one row per project with name (mono `code` if present), a `bg-secondary` track + `bg-primary` fill bar proportioned to that project's share of `hoursThisWeek`, and a right-aligned `tabular` `Nh`. Mirrors the BvACard row pattern but for hours. Reuses `ProgressBar` is not ideal (it's percent-of-100 with threshold tones); instead reuse the **same inline bar markup already in EngineerDashboard's day rows** (track `bg-secondary`, fill `bg-primary`) for visual consistency — single-hue, One-Blue compliant.
- **Full-width below — "Recent entries"** card (NEW, real): flatten every sheet's `entries`, sort `entry_date` desc, take top 8. Each row: `entry_date` (left, `muted-foreground` `{typography.label}`), project name + mono code, `notes` (truncated, `muted-foreground`; render "No note" in `muted-foreground` when null — NOT an em-dash, per audit I3), `Nh` (`tabular`, right). This is the densifier that fills the void with the engineer's own logged history.

### 2.3 Tokens used (named)
- KPI tiles: existing `KPITile` (`{components.card}`, tones `blue`/`violet`).
- Card chrome: `Card` + `CardHead` → `{colors.card}`, `{colors.border}`, `{rounded.lg}`, `{components.card}` padding.
- Bars: track `secondary` (`{colors.secondary}`), fill `primary` (`{colors.primary}`) — **One-Blue**, no status hue.
- Row dividers: `border/70%` (`{colors.border}` at 70% — the table-divider value from `DESIGN.md` §5).
- Type: project name `{typography.body}` 13px/600; date + note `{typography.label}` / `muted-foreground` (`{colors.muted-foreground}`); hours `tabular` (Tabular-Numbers Rule).
- Code: mono `{typography.mono}` (Mono-For-Identifiers Rule).

### 2.4 States (all four, taste-required)
- **Loading:** `ListState variant="loading"` inside each card (existing pattern); KPI tiles use `loading` prop skeleton.
- **Empty (no current sheet / 0 hours):** existing "No hours logged this week" `ListState empty` with `icon="clock"` + `action` → `/timesheets`. "This week by project" and "Recent entries" each get their OWN empty: by-project shows nothing extra (it collapses with the hours card); recent-entries empty = `ListState empty icon="clock" title="No timesheet entries yet" sub="Hours you log will show up here."` (NO action when the hours card already carries the CTA — avoid two competing CTAs, impeccable `primary-action`).
- **Error:** existing `ListState variant="error"` with `onRetry={refetch}` (already wired).
- **Edge:** entry with `notes=null` → "No note" muted label (not em-dash); a single project week → by-project shows one full-width bar; >8 recent entries → cap at 8 (no pagination this issue); decimal hours (7.5) render verbatim (existing `fmt`).

---

## 3. Surface B — Timesheet weekly-grid surround (`pages/Timesheets.tsx`)

### 3.1 Current state
Page head + toolbar + ONE `Card` holding the status pill, weekly total, and the `TimesheetGrid`. Below the grid: void. ~65% empty on a populated week. The audit targets the *populated* grid's surrounding dead space, **not** the grid component itself (which is fine).

### 3.2 Target composition (densify the surround — grid component unchanged)
After the grid `Card`, add a **two-up row** (reuse `DashGrid` or `grid gap-4 min-[920px]:grid-cols-2`):

- **Left — "By project this week"** (NEW, real): derive from existing `gridRows` (already one row per project with 7 daily hours + a row subtotal). Render a compact list: project name + mono code, week subtotal `Nh` (`tabular`), and a single-hue `primary` bar = subtotal / `weeklyTotal`. Pure re-presentation of `gridRows` — zero new query.
- **Right — "Recent entries this week"** (NEW, real): the current week's `currentWeekEntries`, sorted `entry_date` desc, with `notes`. Same row shape as Engineer "Recent entries" (date · project · note · hours). Surfaces the per-entry detail the grid flattens away (the grid sums per day; this shows the individual notes).

This keeps the grid as the hero and adds two real-data panels that explain *what* the hours are, filling the void with content that already exists in the page's memo state.

### 3.3 Tokens used
Same set as §2.3 (Card/CardHead, `secondary` track / `primary` fill, `border/70` dividers, `tabular` numbers, mono codes, `muted-foreground` for notes/dates). The returned-for-changes `ErrBanner` and status pill stay as-is.

### 3.4 States
- **Loading:** existing `timesheets-loading` `ListState` covers the whole grid view; the two new panels only render after data resolves (they share the page's loaded `sheets`), so no separate skeleton needed — but each panel guards `gridRows.length === 0`.
- **Empty (no hours this week):** existing `timesheets-empty` `ListState` replaces the grid; the two panels render nothing (guarded on `gridRows.length`) so an empty week shows ONE empty state, not three (impeccable `empty-states`, taste no-decorate-the-void).
- **Error:** existing page-level `ListState error` with `onRetry`.
- **Edge:** week with one project → both panels show a single row; an entry with `null` note → "No note"; future/past weeks via the existing week-stepper recompute both panels (they read the same `currentWeekEntries`/`gridRows` memos).

---

## 4. Surface C — Project-detail Overview (`pages/project-detail/tabs/OverviewTab.tsx`)

### 4.1 Current state
Two cards: "Project information" (2/3) + "Budget utilization" (1/3). Below: void. The page already loads the full `ProjectWithRefs` row.

### 4.2 Target composition (denser 3-col, real-only)
Keep row 1 (info + budget) unchanged. Add a **second row** that fills the void with the project's REAL money + procurement summary:

- **NEW card — "Procurement summary"** (real, project-scoped): reuse the documented pattern from `ProcurementTab` — filter `useProcurements()` by `project_id` (client-side, RLS already scopes). Render a compact summary, NOT the full table:
  - A **count-by-bucket strip**: group statuses into 3 plain buckets — **Open** (anything not Paid/Cancelled/Rejected), **Completed** (Paid), **Closed** (Cancelled/Rejected). Show each as a count `Badge` + label (NOT 6 same-blue dots — avoids audit I2). Use `StatusPill` variants already in the system: `open`, `won` (completed), `neutral` (closed).
  - **Total committed value** for this project = Σ `total_value` of non-cancelled/rejected rows (`formatCurrency`, `tabular`). Labeled "Committed across N requests".
  - **Top 3 recent requests** (by `created_at`): title + mono code + `StatusPill` (reuse `stageLabelForStatus`/`pillVariantForStatus` from `components/procurement`) + `formatCurrency(total_value)`. Row click → `/procurement/:id` (reuse `openPR`). Footer link "View all procurement" → switch to the Procurement tab.
- **NEW card — "Budget snapshot"** (real): call `listBudgetVersions(project.id)` (the Budget tab already uses this) → find the Active version, show its `total` (Active budget), `project.spent` (actual), variance (`total - spent`, `tabular`, `destructive` color when negative per `DESIGN.md` KPI rule), and a line-item **category breakdown** (group Active version `line_items` by `category`, sum `budgeted_amount`) as a few labeled bars (`primary` single-hue). Footer link "Open Budget tab".

Layout: `grid gap-4 lg:grid-cols-2` for row 2 (procurement + budget snapshot side by side ≥1024px, stacked below). This roughly doubles the Overview's filled area with zero fabricated data.

### 4.3 Tokens used
- Cards: `Card`/`CardHead`/`CardPad` → `{colors.card}`, `{colors.border}`, `{rounded.lg}`.
- Count strip: `Badge` (`{components.badge-status}` family) + `StatusPill` variants `open`/`won`/`neutral`.
- Money: `formatCurrency`, `{typography.body}` 600 + `tabular`; negative variance → `{colors.destructive}` text (KPI negative rule).
- Category bars: track `secondary`, fill `primary` (One-Blue).
- Recent-request rows: name `{typography.body}`/600, code `{typography.mono}`, divider `border/70`.
- Links: ghost-button or text link in `primary` (links-in-context per `DESIGN.md` Primary).

### 4.4 States
- **Loading:** procurement card guards `useProcurements()` `isPending` → `ListState loading rows={3}`; budget snapshot has its own `useQuery(listBudgetVersions)` → `ListState loading`. Two independent loaders (each its own query).
- **Empty:** no procurement for this project → `ListState empty icon="inbox" title="No purchase requests for this project yet" sub="Requests raised against this project will appear here."` (reuse ProcurementTab copy). No Active budget version → "No active budget" calm empty with copy pointing to the Budget tab (NO fabricated zero-bars).
- **Error:** each card has `onRetry` from its own query.
- **Edge:** project with procurement but no Active budget (or vice-versa) → each card resolves independently; variance when `spent > total` shows `destructive`; a request with `total_value=0` renders `$0` (real), not hidden.

---

## 5. Responsive breakpoints (ui-ux-pro-max §5 Layout & Responsive)

Reuse the system's existing breakpoints — do NOT invent new ones (audit C1 test asserts monotonic arbitrary `min-[]` variants only on the KPI band):
- **< 560px:** single column everywhere; KPI tiles stack (`grid-cols-1`); new panels stack full-width.
- **≥ 560px:** KPI band → `min-[560px]:grid-cols-2` (matches existing EngineerDashboard test C1).
- **≥ 920px:** `DashGrid` two-up (existing `min-[920px]:grid-cols-2`) for the dashboard/timesheet panel rows.
- **≥ 1024px (`lg:`):** Overview row 1 stays `lg:grid-cols-3`; row 2 `lg:grid-cols-2`.
- No horizontal scroll on mobile (the `TimesheetGrid` keeps its own `overflow-x-auto`; new panels are flex/stacked). `min-w-0` + `truncate` on every name cell to prevent overflow (audit M1).

---

## 6. Accessibility (WCAG-AA — folded from taste + ui-ux-pro-max §1 + `DESIGN.md` posture)

- **Contrast:** all body text `foreground` on `card` (AAA); notes/dates `muted-foreground` (L 40%, clears AA per `DESIGN.md`). Bars are decorative-supplemented: every bar carries a `tabular` numeric label adjacent (color-not-only). Status conveyed by `StatusPill` (dot + text), never color alone.
- **Labels:** each bar group is `role="group"` with `aria-label` (e.g. `"Hours this week by project"`); each bar is `role="progressbar"` with `aria-valuenow/min/max` + `aria-label="{project}: {n} hours"` (mirrors existing EngineerDashboard day bars). Recent-entries list = `<ul>`/`<li>` semantic; procurement-summary count strip uses real text labels, not icon-only.
- **Focus order:** DOM order = visual order (rail → header → main → cards top-to-bottom, left-to-right). New interactive elements (recent-request rows, footer links) are real `<button>`/`<a>` reachable by Tab with the global `:focus-visible` ring (`{colors.ring}`, 2px offset) — no custom focus styles.
- **Keyboard paths:** procurement-summary recent rows activate on Enter/Space (reuse `DataTable onActivate` or a `<button>` row); footer "Open Budget tab" / "View all procurement" are buttons that call the parent `setTab`. No hover-only affordance (ui-ux `hover-vs-tap`).
- **Touch targets:** any new interactive row/link is ≥44px tall on coarse pointer (audit I5 is a separate workstream, but new controls must comply from birth — pad to `h-11`/44px on `(pointer:coarse)`).
- **Screen-reader data:** bar groups provide a text summary; recent-entry hours are `tabular` and labeled. No chart needs a `<table>` alternative here (these are lists/bars with inline numbers).
- **Reduced motion:** these surfaces add no entrance animation (product `no-page-load-sequence`); any hover state-lift respects existing `transition-shadow` only.

---

## 7. Deferred slots — left OUT, noted (audit C4 directive)

Do NOT build these; they need modules/data that do not exist:
- **Engineer "assigned tasks" / "active vs completed tasks"** → needs the deferred **Tasks** module (no query, no RLS). Leave out. (EngineerDashboard already removed its tasks placeholder per its test — keep it removed.)
- **Project Overview "team members" list** → no project-membership query exists; only `pm.full_name`. Show PM only (already in info card). No fabricated team.
- **Project Overview "documents" / "recent files"** → deferred **Documents** module. Leave out.
- **Committed-cost bar (committed vs actual)** → `top_projects`/`projects` expose `spent`, not `committed`; portfolio-committed is a deferred backend slice (per `BvACard` Open Q1). Use Actual/Contract only.
- **Timesheet "team capacity / utilization across people"** → `useTimesheets()` is own-user only (RLS). No cross-user data on this surface. Leave out.

---

## 8. Anti-slop acceptance gates (taste §7 + impeccable bans — must all hold)

- [ ] **No emoji** anywhere (taste ANTI-EMOJI / audit C5). Icons from the existing `Icon` set only.
- [ ] **No fabricated data** — every value traces to a row from §1. No "Jane Doe", no fake percentages, no placeholder rows.
- [ ] **No decorating-the-void** — empty slots show ONE calm `ListState` empty (or collapse), never a stub chart/fake KPI/dummy list.
- [ ] **One Blue** — all new bars/active affordances use `primary` only; status uses the tinted `StatusPill`. No rainbow, no second accent (audit C1/C2).
- [ ] **No em-dash placeholder cells** — null notes/dates render "No note" / "Not set" muted, or the column is omitted (audit I3, impeccable no-em-dash).
- [ ] **No nested cards** — group with `divide-y divide-border/70` and spacing, not card-in-card (taste Rule 4 / impeccable cards-are-lazy).
- [ ] **No drop shadow on static cards** — `Card` flat-by-default (`DESIGN.md` Flat-By-Default).
- [ ] **One primary action per surface** — don't add a second competing CTA next to the existing one.
- [ ] **Consistent component vocabulary** — reuse `Card`, `CardHead`, `StatusPill`, `Badge`, `KPITile`, `ListState`, `formatCurrency`; do not hand-roll new variants.
- [ ] **tabular-nums** on every figure (hours, money, counts, variance).
- [ ] **No new tokens, colors, fonts, radii, or border values** introduced.

---

## 9. TDD task list (red → green → refactor; each 2–5 min; conflict-safe order)

> Test framework: Vitest + RTL (`npm test`). Tag each owning test with its behavior in the `it(...)` title. Run `npm run typecheck` + `npm test` per task. No prod code without a failing test first. Pure derivations (grouping/sorting) get **unit tests on a tiny exported helper** before the component renders them.

### Phase 1 — Pure derivation helpers (no UI; isolatable; do first to de-risk the math)

- **T1.** `src/lib/timesheet-derive.ts` (NEW) — export `entriesByProject(entries)` (group → `{projectId, name, code, hours}[]` sorted by hours desc) and `recentEntries(sheets, limit)` (flatten, sort `entry_date` desc, slice). RED: `src/lib/timesheet-derive.test.ts` asserts grouping sums and sort order (use the EngineerDashboard test fixture shape). GREEN: implement pure fns. (~4 min)
- **T2.** Same file — export `weeksTotals(sheets, n)` (last n weeks, sum each sheet's entries). RED test for 2-sheet fixture. GREEN. (~3 min)
- **T3.** `src/lib/procurement-summary.ts` (NEW) — export `summarizeProcurement(rows)` → `{open, completed, closed, committedTotal, count}` bucketing by `LEGAL_TRANSITIONS` terminal sets; export `recentRequests(rows, limit)`. RED: unit test on a 4-row fixture covering each bucket + $0 row. GREEN. (~5 min)
- **T4.** `src/lib/budget-snapshot.ts` (NEW) — export `activeSnapshot(versions, spent)` → `{activeTotal, spent, variance, byCategory:[{category,amount}]}`; null-safe when no Active version (returns null). RED: unit test (Active present / absent / negative variance). GREEN. (~5 min)

### Phase 2 — Shared row presentation (one reusable, tested component to avoid divergence between A & B)

- **T5.** `src/components/ui/HoursBar.tsx` (NEW) — single-hue hours bar row (label + mono code + `secondary` track / `primary` fill + `tabular` `Nh`), `role="progressbar"` + aria-label. RED: `HoursBar.test.tsx` asserts aria-label, tabular class, single `bg-primary` fill (no status hue). GREEN. Export from `src/components/ui/index.ts`. (~5 min)
- **T6.** `src/components/ui/EntryList.tsx` (NEW) — recent-entries list (`<ul>` date · project · note("No note" when null) · `Nh`). RED: `EntryList.test.tsx` asserts "No note" rendered for null notes (NOT em-dash) + `<li>` count + tabular hours. GREEN. Export from index. (~5 min)

### Phase 3 — Engineer dashboard (Surface A) — touches `EngineerDashboard.tsx` ONLY

- **T7.** RED in `EngineerDashboard.test.tsx`: add `it('renders this-week-by-project bars (real, grouped)')` asserting a `role="group" name="This week by project"` with one HoursBar per project from the fixture. (~3 min)
- **T8.** GREEN: add the "This week by project" right-column card using `entriesByProject` + `HoursBar`. Refactor the dead `DashGrid` to actually hold two children. (~4 min)
- **T9.** RED: `it('renders recent entries list (top 8, newest first)')`. GREEN: add full-width "Recent entries" card using `recentEntries` + `EntryList`. (~4 min)
- **T10.** RED: `it('shows only one CTA — the hours-card Log hours, none on recent-entries empty')`. GREEN: ensure recent-entries empty has no action. Verify existing C1 breakpoint test still green. (~3 min)

### Phase 4 — Timesheet grid surround (Surface B) — touches `pages/Timesheets.tsx` ONLY

- **T11.** RED in `pages/Timesheets.test.tsx`: `it('renders By-project-this-week panel from gridRows')` asserting one HoursBar per project + that an empty week shows exactly one empty state (not three). (~4 min)
- **T12.** GREEN: add the two-up row after the grid `Card` — "By project this week" (`gridRows` → `HoursBar`, share of `weeklyTotal`) guarded on `gridRows.length`. (~4 min)
- **T13.** RED: `it('renders recent-entries-this-week with notes')`. GREEN: add "Recent entries this week" panel using `currentWeekEntries` + `EntryList`. (~4 min)

### Phase 5 — Overview tab (Surface C) — touches `OverviewTab.tsx` ONLY (+ may add a small `useProjectProcurementSummary` hook)

- **T14.** RED in `pages/project-detail/__tests__/` (new `OverviewTab.test.tsx`): `it('renders procurement summary buckets + committed total for the project')` with a mocked `useProcurements`. (~5 min)
- **T15.** GREEN: add "Procurement summary" card — filter `useProcurements()` by `project_id`, `summarizeProcurement`, count strip (`Badge`+`StatusPill`), committed total, top-3 recent (`recentRequests` + row → `/procurement/:id`). States: loading/empty/error. (~5 min)
- **T16.** RED: `it('renders budget snapshot from the Active version (variance, category bars)')` with mocked `listBudgetVersions`. (~5 min)
- **T17.** GREEN: add "Budget snapshot" card — `useQuery(listBudgetVersions)`, `activeSnapshot`, variance (`destructive` when negative), category bars (`HoursBar`-style single-hue). Empty when no Active version. (~5 min)
- **T18.** RED+GREEN: `it('row 2 is lg:grid-cols-2 and stacks below lg')` layout assertion + footer links call `setTab`/navigate. (~4 min)

### Phase 6 — Polish & verify

- **T19.** Run the anti-slop gate (§8) by inspection + assert no `—` placeholder, no emoji, single `bg-primary` on new bars. (~3 min)
- **T20.** `npm run typecheck` (zero) + `npm test` (all green, ≥80% on changed files) + manual `npm run dev` smoke of all three surfaces at 375 / 920 / 1280px. (~5 min)

---

## 10. Cross-workstream file overlaps (FLAG for build sequencing)

These files are also touched by sibling cleanup workstreams. Sequence to avoid merge collisions:

1. **`src/components/dashboard/EngineerDashboard.tsx`** (this plan §3) **and the chart-cleanup workstream (C1)** both edit dashboard components. C1 touches `StatusBarChart.tsx`, `ProjectedMarginBars.tsx`, `chartTheme.ts`, `BvACard.tsx`, `PMDashboard.tsx` — **EngineerDashboard is NOT in C1's list**, so no direct file collision, BUT both share `chartTheme.ts`/`BvACard` patterns and the `DashGrid` layout convention. **Sequence: land C1 (de-rainbow) first**, then this plan reuses the settled single-hue bar convention. New `HoursBar` must match whatever single-hue rule C1 finalizes.
2. **`pages/project-detail/tabs/OverviewTab.tsx`** (this plan §4) overlaps the **cleanup breadcrumb workstream (I7, triple-nav)** and the **budget-version-dropdown workstream** (owner directive — both touch `pages/project-detail/`). The breadcrumb fix edits `ProjectDetail.tsx` (parent), not `OverviewTab.tsx` directly — low collision, but both change the project-detail visual rhythm. The budget-dropdown work edits `BudgetTab.tsx` and `src/lib/db/budgets.ts`; this plan's "Budget snapshot" **reads** `listBudgetVersions` (same DAL) — **coordinate so the snapshot consumes the same Active-version selection the dropdown work establishes** (don't duplicate version-selection logic). **Sequence: land budget-dropdown first**, then Overview snapshot reuses its Active-version accessor.
3. **`pages/Timesheets.tsx`** (this plan §3) overlaps the **disabled-CTA removal workstream (C3)** which also edits `Timesheets.tsx` (removes the dead "New" CTA). **Sequence: land C3 first** (small, surgical), then this plan adds the surround panels on the cleaned-up page to avoid touching the same header block twice.
4. **`src/components/ui/index.ts`** — new `HoursBar`/`EntryList` exports. Any sibling adding UI primitives touches this barrel; trivially mergeable but note it.

**Recommended global order:** C3 (CTA removal) → C1 (de-rainbow charts) → budget-dropdown → **this plan (C4 thin pages)**. This plan is intentionally last among its overlaps so it builds on settled conventions.

---

## 11. Open questions for owner

1. **Recent-entries cap.** Top 8 (Engineer) / current-week-only (Timesheet) chosen to avoid pagination this issue. Confirm 8 is enough, or want "show more"? (Recommend: ship 8, defer pagination.)
2. **Overview "Budget snapshot" extra query.** It adds a `listBudgetVersions(project.id)` fetch on the Overview tab (the Budget tab already does this; data is cacheable by React Query key). Acceptable, or prefer Overview stay query-free and show only `project.spent`/`contract_value` (no category breakdown)? (Recommend: allow the cached query — it's the only way to show real budget categories without fabrication.)
3. **Procurement bucket labels.** "Open / Completed / Closed" chosen as plain operator language over the raw 11-status enum. Confirm these labels, or prefer the granular stage labels from `stageLabelForStatus`? (Recommend: 3 buckets on the summary, granular labels only in the top-3 recent rows.)
