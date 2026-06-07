# Design-Plan: Batch-A UI-Slop Cleanup

- **Date:** 2026-06-07
- **Workstream:** Batch-A cleanup (audit CRITICAL + IMPORTANT slop fixes, EXCEPT I4 which the confirmation workstream owns)
- **Authority:** `docs/reviews/2026-06-07-ui-slop-audit.md` (finding list) · `DESIGN.md` (token / identity authority)
- **Owner agent:** design-architect (this plan) → ui-implementer (build to tokens + this plan) → /design-review (before merge)
- **Identity rule:** RIS "Quiet Control Surface" is PRESERVED. Inter stays. No new brand, palette, font, radius, or shadow. Every visual decision below names a `DESIGN.md` token; the only literals permitted are the already-sanctioned darkened-AA status-text values and the categorical stage dots being remapped/removed here. The taste skill's own baseline dials (variance 8, motion 6, "no Inter", Geist/Satoshi) are explicitly OVERRIDDEN by identity-preservation — we fold only its universal anti-slop rules (no emoji, required states, no em-dash, color-not-only, tactile feedback, contrast).

## Scope

Fidelity: production-ready. Breadth: 10 findings across charts, list pages, placeholder pages, status pills/dots, table cells, touch targets, project cards, detail-page chrome. Interactivity: shipped-quality components. This is a fix-then-ship pass, NOT a rework — the audit's "Strengths to PRESERVE" (procurement density bar, ⌘K palette, project-not-found error state, rail grouping + active nav, token plumbing + focus ring) are untouched.

Findings covered: **C1, C2, C3, C5, I1, I2, I3, I5, I6, I7.**
Explicitly EXCLUDED: **I4** (inverted action hierarchy on OpportunityDetail "Next actions"). See Cross-Workstream Dependencies.

---

## Token vocabulary used (all from `DESIGN.md`)

| Concept | Token(s) | Source |
|---|---|---|
| One interactive blue | `primary`, `primary-foreground`, `ring`; tints `primary/10`, `primary/15`, `primary/[0.06]` | DESIGN.md Colors §2 + chartTheme.series.primary |
| Status hues (data-state only) | `success` / `success-foreground`, `warning` / `warning-foreground`, `destructive` / `destructive-foreground` | DESIGN.md §2 + chartTheme.series.{success,warning,destructive} |
| Categorical (non-interactive) | `violet` (`chartTheme.series.violet`) | DESIGN.md §2 "Categorical accent" |
| Neutrals / structure | `background`, `card`, `foreground`, `border`, `input`, `secondary`, `muted-foreground`, `accent` | DESIGN.md §2 |
| Darkened-AA pill text (sanctioned literals) | open `hsl(221 75% 38%)`, won `hsl(142 64% 30%)`, lost `hsl(0 72% 45%)`, `warning-foreground` | DESIGN.md "Accessibility posture" + StatusPill.tsx STYLES |
| Radius | `rounded.sm`/`md`/`lg`/`full` (6/8/10/999) | DESIGN.md §rounded |
| Typography | `label` (12/600), `overline` (11/600 UPPER), `body`, `mono`; `tabular` utility | DESIGN.md §3 |
| Empty-state shell | the existing `ListState variant="empty"` (52px secondary icon tile + foreground title + muted sub) | ListState.tsx |
| Focus | global `:focus-visible` `2px solid hsl(var(--ring))` offset 2px | DESIGN.md §6 / index.css |

**Named DESIGN.md rules in force:** The One Blue Rule (blue ≤10% of any screen; only the main action is blue) · The Tinted-Status Rule (6px dot + ~10–18% tint + darkened text; solid fill only on the destructive button) · The Flat-By-Default Rule · color-not-only (dot **and** text/axis, never color alone).

---

## Acceptance list (states + a11y + anti-slop, folded from taste + ui-ux-pro-max §1–§10)

These apply to EVERY task below; per-task ACs reference them by ID.

- **AS-1 (no emoji):** zero emoji in any rendered markup, copy, or alt text (taste ANTI-EMOJI; ui-ux §4 `no-emoji-icons`). Icons come from the existing `Icon`/`ICON_PATHS` set only.
- **AS-2 (required states):** any surface touched still renders its loading / empty / error / populated states correctly; no state is dropped or broken by a cleanup edit (taste Rule 5; ui-ux §8 `empty-states`).
- **AS-3 (no em-dash placeholder):** no bare `—`/`--` as a value-placeholder in a data cell or copy; use "Not set" / "Pending …" (muted) or omit the column (taste no-em-dash; audit I3). The true-minus glyph `−` (U+2212) on negative currency in ProjectDetailHeader is NOT an em-dash and is preserved.
- **AS-4 (color-not-only):** status / stage is conveyed by dot **+** text label (or axis label), never hue alone; verified for color-blind safety (ui-ux §1 `color-not-only`, §10 `pattern-texture`).
- **AS-5 (contrast AA):** every text/icon over its background clears 4.5:1 (3:1 for ≥18px/large); pill text uses the sanctioned darkened-AA variants; chart bars vs background ≥3:1, axis/legend text ≥4.5:1 (ui-ux §1 `color-contrast`, §10 `contrast-data`).
- **AS-6 (focus visible):** every interactive element keeps the global `:focus-visible` ring; no focus removed; tab order = DOM order (ui-ux §1 `focus-states`, `keyboard-nav`).
- **AS-7 (touch target ≥44px):** interactive controls expand to ≥44×44px hit-area on coarse-pointer / mobile via padding or hit-slop, NOT by enlarging the visual glyph (ui-ux §2 `touch-target-size`; WCAG 2.5.5).
- **AS-8 (no new tokens):** no raw hex/px introduced beyond the sanctioned status-text/stage-dot literals named above; no second blue, no new font/radius/shadow (DESIGN.md Don'ts; taste THE LILA BAN is already satisfied by the one-blue system).
- **AS-9 (tactile feedback):** interactive controls keep `active:translate-y-px` / equivalent press feedback already present in Button/BackBar (taste Rule 5 tactile; ui-ux §7 `scale-feedback`). No layout-shifting transforms (ui-ux Stable Interaction States).
- **AS-10 (reduced-motion):** chart entrance animation stays gated behind `usePrefersReducedMotion()`; no new always-on motion (ui-ux §7 `reduced-motion`).
- **AS-11 (typecheck/lint/coverage gate):** `npm run typecheck` zero errors, ESLint zero warnings, ≥80% lines on changed code (CLAUDE.md gates). The `procurementStatusTone` `never`-exhaustiveness guard must still compile.

---

## Responsive breakpoints (project standard — confirmed in source)

The app uses the `max-[921px]` / `xl:` (1280px) Tailwind breakpoints and a `--rail-w:0` collapse at ≤920px (AppShell + ContextBar). Coarse-pointer touch sizing keys off `@media (pointer: coarse)` (new, AS-7). No new breakpoint system is introduced.

| Width | Behavior relevant to this batch |
|---|---|
| ≤920px (mobile, rail collapsed) | AS-7 touch targets engage; funnel band already horizontal-scrolls (`min-w-[640px]`, SalesPipeline.tsx:181); chart x-axis labels already angled −30°. |
| 921–1279px | xl-hidden columns (Projects "Customer") hide; charts reflow via `ResponsiveContainer`. |
| ≥1280px | full table columns; KPI/chart grids at full density. |

---

## Tasks (TDD, 2–5 min each, conflict-safe order)

Order is grouped so files are touched by exactly one task group; a later group never reopens an earlier group's file. Each task: write/extend the failing test first (red), then the minimal change (green), then verify. Test command per task is exact. Unit tests are Vitest/RTL from `pmo-portal/` (`npm test -- <path>`); typecheck is `npm run typecheck`.

> Convention: visual-token assertions test the *token reference* (class name / `chartTheme.series.*` identity / `hsl(var(--token))` string), not a resolved RGB — resolved color is verified at /design-review render time.

### Group A — Charts de-rainbow (C1)
*Files: `src/components/ui/chartTheme.ts`, `src/components/dashboard/procurementStatusTone.ts`, `src/components/dashboard/ProjectedMarginBars.tsx`, plus their tests. Conflict-safe: this group owns chartTheme.ts; Group B also edits chartTheme is FALSE — only this group touches chartTheme.ts.*

- **A1 — Remove the off-palette cyan from `chartTheme.categorical`.** In `chartTheme.ts`, delete the `'hsl(199 89% 48%)' // cyan` entry from the `categorical` array (line 33) so the frozen set is blue/violet/green/amber/red only (no cyan, no orange — orange was never in this array). Update the JSDoc note to record the de-rainbow decision. (C1/C2 overlap: cyan lives in both chartTheme and salesPipeline; chartTheme copy is removed here, salesPipeline copy in Group B.)
  - Test: extend `src/components/ui/__tests__/chartTheme.test.ts` — assert `chartTheme.categorical` does not include `'hsl(199 89% 48%)'` and every entry is one of the 5 sanctioned hues. AC: AS-8.
  - Verify: `npm test -- chartTheme.test`

- **A2 — Make `procurementStatusTone` single-hue-dominant with tinted status only.** The dashboard "Procurement by Status" bars currently map Draft→violet, in-flight→primary, awaiting→warning, terminal-good→success, dead→destructive (procurementStatusTone.ts) — five saturated fills = the rainbow. Per C1, collapse to: **primary (blue) is the default/in-flight hue**; status hues ONLY where the bar's meaning *is* that status: `success` for Received/Paid (terminal-good), `destructive` for Rejected/Cancelled (dead), `warning` for the awaiting/caution set; move **Draft from `violet` to `primary`** (Draft is "not-yet-started", not a category — violet is reserved for non-status categorical use per DESIGN.md, and a 5th hue on a status chart is the rainbow). Net: at most 4 hues, all carrying real status meaning, all tinted-not-invented (they are the `chartTheme.series` tokens).
  - Test: update `procurementStatusTone.test.ts` — assert Draft → `chartTheme.series.primary` (was violet); keep the existing success/warning/destructive/primary mappings; keep the `never`-exhaustiveness guard (AS-11). AC: AS-4, AS-5, AS-8.
  - Verify: `npm test -- procurementStatusTone.test`

- **A3 — De-rainbow `ProjectedMarginBars` to single-hue blue.** The exec "Pipeline – Projected Margin" bars colour each open stage by its categorical stage dot via `colorFor` (ProjectedMarginBars.tsx:12–14) → the violet PQ bar the audit flagged. Per C1 (the bar's meaning is NOT a status — it's weighted value), replace `colorFor` with a single fill `chartTheme.series.primary` for all bars; delete the `STAGE_META`/`colorFor`/`chartTheme.categorical` import-and-fallback. The stage name label (line 53) already provides per-bar identity (AS-4), so color need not vary.
  - Test: update `ProjectedMarginBars.test.tsx` — assert every bar fill resolves to `hsl(var(--primary))`; assert no `chartTheme.categorical` / violet usage remains; per-stage `<span>` label + `aria-label` still present (AS-4). AC: AS-4, AS-5, AS-8.
  - Verify: `npm test -- ProjectedMarginBars.test`

- **A4 — Confirm `StatusBarChart` needs no change (regression guard only).** `StatusBarChart` is generic and colours via the injected `toneFor`; the dashboard passes `procurementStatusTone`, so A2 already fixes its rainbow. The legend is dot **+ text + count** (color-not-only, AS-4) and the `figure role="img"` aria summary is present — both PRESERVED.
  - Test: add an assertion to `StatusBarChart.test.tsx` that the figcaption renders each status as text alongside its dot (AS-4 regression). AC: AS-4.
  - Verify: `npm test -- StatusBarChart.test`

### Group B — Funnel / sales-stage colour remap (C2, I2-sales-half)
*Files: `components/salesPipeline.ts`, `components/SalesKanbanBoard.tsx`, `src/components/ui/Funnel.tsx`, plus tests. Conflict-safe: salesPipeline.ts is owned ONLY by this group. ProjectedMarginBars imports `SALES_COLUMNS` from salesPipeline but only `.terminal`/`.statuses`/`.dotColor`; Group A removed its dependence on `dotColor` in A3, so this group's dotColor change cannot break A3 — sequence A before B.*

- **B1 — Remap `SALES_COLUMNS.dotColor` to the documented palette; delete cyan + orange.** In `salesPipeline.ts` the six stage dots are: Leads `muted-foreground`, Pre-Qual `violet (262)`, Quotation **cyan `199 89% 48%`**, Tender **`warning 43`**, Negotiation **orange `25 95% 53%`**, Won/Lost `success`. C2: cyan and orange exist in NO token. Per the audit's prescription (neutral upstream, `primary` active, `success`/`destructive` won/lost), and One-Blue (blue carries the *active* meaning, not every stage), remap to a calm neutral-progression with status hues only at the terminal:
    - Leads → `hsl(var(--muted-foreground))` (keep)
    - Pre-Qual → `hsl(var(--muted-foreground))` (was violet — upstream stages are neutral; categorical violet is not a stage-progression device)
    - Quotation → `hsl(var(--muted-foreground))` (DELETE cyan)
    - Tender → `hsl(var(--muted-foreground))` (was warning hue used categorically — drop the false "caution" reading)
    - Negotiation → `hsl(var(--primary))` (the active, closest-to-close open stage = the one blue accent on this band)
    - Won/Lost → `hsl(var(--success))` (keep)
  - Rationale: upstream is quiet neutral, the single blue marks the live stage, terminal is the success hue. Zero invented colours, ≤1 blue on the band (One Blue Rule), every dot is a token. Update the `dotColor` JSDoc to remove the "sanctioned categorical literal" framing for cyan/orange (now gone) and note Open-Q4 stage-token promotion is moot for these.
  - Test: update `salesPipeline.test.ts` — assert no `SALES_COLUMNS` entry's `dotColor` contains `199 89% 48%` or `25 95% 53%`; assert every `dotColor` is an `hsl(var(--…))` token string; assert exactly one open column uses `--primary`. AC: AS-4, AS-8.
  - Verify: `npm test -- salesPipeline.test`

- **B2 — Verify Funnel + SalesKanbanBoard inherit the remap (no literal left behind).** `Funnel.tsx` and `SalesKanbanBoard.tsx` both read `col.dotColor` (Funnel via `funnelStages[].dotColor` in SalesPipeline.tsx:73, board via `col.dotColor` line 87/96) — so B1 propagates with no edit to their colour logic. Confirm no inline cyan/orange literal exists in either file.
  - Test: `salesPipeline.test.ts` / `SalesKanbanBoard.test.ts` — assert the rendered stage dot `style.background` strings are token-form (`hsl(var(`), not raw `hsl(199`/`hsl(25`. AC: AS-4, AS-8.
  - Verify: `npm test -- SalesKanbanBoard.test`

### Group C — Status pill differentiation (I1)
*Files: `src/components/ui/StatusPill.tsx`, `components/procurement.ts`, plus tests. Conflict-safe: StatusPill.tsx and procurement.ts are owned ONLY by this group.*

- **C-prep — Add an "active/in-flight" pill variant.** I1: Procurement "Vendor Quote" / "Purchase Request" / "Purchase Order" all map to the `open` variant → identical `primary/10` blue. Root cause is in `procurement.ts:pillVariantForStatus`, which collapses every in-flight status to `open`. Fix WITHOUT a second blue: introduce a neutral-progression variant so the *stage label* (already distinct: "Purchase Request" vs "Vendor Quote" vs "Purchase Order") carries the difference, and reserve the blue `open` tint for the one currently-active stage only. Add a `progress` variant to `StatusPill` STYLES = `bg-secondary` fill + `secondary-foreground` text + `muted-foreground` dot (the quiet neutral pill). Keep `open` (blue) for the single active/current procurement stage; map terminal Paid→`won`, Rejected/Cancelled→`lost`, Draft→`draft`, and the non-current in-flight stages→`progress`.
  - Note: differentiation is primarily by **label text** (already correct via `stageLabelForStatus`) reinforced by neutral-vs-blue tinting; this satisfies AS-4 (not color-only) and the Tinted-Status Rule. Do NOT invent distinct hues per stage (that recreates the rainbow on pills).
  - Test (StatusPill): extend `StatusPill.test.tsx` — assert `variant="progress"` renders `bg-secondary` + `text-secondary-foreground` + the dot; assert `open` still renders `primary/10` + the darkened-AA `hsl(221 75% 38%)` text. AC: AS-4, AS-5, AS-8.
  - Verify: `npm test -- StatusPill.test`

- **C2-proc — Update `procurement.ts:pillVariantForStatus` to emit `progress` for non-active in-flight stages.** The three look-alike statuses (Requested→"Purchase Request", Vendor Quoted→"Vendor Quote", Quote Selected/Ordered→"Purchase Order") become `progress` (neutral); they are now visually distinct from each other by label and distinct from the blue `open`/active reading. Keep Paid→won, Rejected/Cancelled→lost, Draft→draft. (Decision point flagged in Open Questions: whether "active stage = blue" is per-record or global — default below.)
  - Default decision: since the list pill shows each record's *own* stage (not a board column), there is no single "active" stage; map ALL in-flight to `progress` (neutral) and let the distinct **label** + the lifecycle pip stepper (already in the row) carry stage identity. The blue `open` variant is retained for surfaces that genuinely have one active item (e.g. sales `open`). This keeps procurement pills differentiated by label, removes the 3-identical-blue tell, and stays one-blue.
  - Test: update `procurement.test` (in `components/procurement` test or add `procurement.ts` coverage) — assert `pillVariantForStatus('Requested') === 'progress'`, `'Vendor Quoted' === 'progress'`, `'Ordered' === 'progress'`, `'Paid' === 'won'`, `'Rejected' === 'lost'`, `'Draft' === 'draft'`. AC: AS-4, AS-8.
  - Verify: `npm test -- procurement`

### Group D — One status-dot convention (I2)
*Files: `components/ProcurementBoard.tsx` (proc-half), plus test. Sales-half already done in Group B. Conflict-safe: ProcurementBoard.tsx owned only here; it imports from procurement.ts (Group C) but only `PR_STAGES`/`stageIndexForStatus`, not pill variants — no conflict.*

- **D1 — Make the procurement board column dots follow ONE convention matching the sales board.** Today the proc board (ProcurementBoard.tsx:77) uses `paid→success`, everything-else→`primary` (all-blue columns = the I2 "all 6 same blue" tell), while the sales board (after B1) uses neutral-upstream / primary-active / success-terminal. Adopt the same convention on the proc board: upstream stages (pr, vq, po, gr, vi) → `hsl(var(--muted-foreground))`, and the terminal `paid` → `hsl(var(--success))`. This makes both boards read identically: quiet neutral columns, status hue only at the terminal. (No "active" blue column on the proc board because the board groups ALL records by stage — there is no single current stage, mirroring the C2-proc reasoning.)
  - Test: extend a `ProcurementBoard` test — assert the non-paid `KanbanColumn dotColor` is `hsl(var(--muted-foreground))` and `paid` is `hsl(var(--success))`; assert no `--primary` column dot remains. AC: AS-4, AS-8.
  - Verify: `npm test -- ProcurementBoard` (add test file if absent: `components/ProcurementBoard.test.tsx`)
  - a11y note: KanbanColumn already pairs the dot with a text title (AS-4); the dot is `aria-hidden`.

### Group E — List-page disabled CTAs removed (C3)
*Files: `pages/Projects.tsx`, `pages/SalesPipeline.tsx`, `pages/Procurement.tsx`, `pages/project-detail/ProjectDetailHeader.tsx`, `pages/ProcurementDetails.tsx`, `src/components/ui/ListState.tsx`, plus tests. Conflict-safe: these 5 page files + ListState are owned only by Group E. Projects.tsx/SalesPipeline.tsx/Procurement.tsx are NOT touched by any other group (their funnel/pill imports come from Group A/B/C files, not the pages themselves).*

- **E1 — Remove the disabled "New Project" CTA from the Projects page header.** In `Projects.tsx` the `Header` (lines 359–373) anchors the page with a `<Button variant="primary" disabled title="Project creation is coming soon">`. C3: delete the disabled primary CTA entirely (do not anchor a page with a dead CTA). Keep the title + descriptive sub. Also remove the disabled `action` prop from the page-level empty `ListState` (line 253) — an empty state should teach, not present a dead button; replace with no action (the sub copy "Projects you create or win will appear here." already teaches). Keep the "Clear filters" empty action (that one is live).
  - Test: update `Projects.test.tsx` — assert no element with text "New Project" and `disabled` renders in the header; assert the page-empty `ListState` has no disabled action; "Clear filters" still appears when filters active. AC: AS-2 (empty state preserved + improved), AS-8.
  - Verify: `npm test -- Projects.test`

- **E2 — Remove the disabled "New deal" CTA from the Sales Pipeline page.** In `SalesPipeline.tsx` (lines 164–167) delete the disabled `New deal` primary button; KEEP the live `Export` outline button (lines 160–163 — it is not disabled, not a dead CTA). Remove the disabled `action` from the empty `ListState` (line 235). The header collapses to just `Export` on the right.
  - Test: update `SalesPipeline` test — assert no disabled "New deal" button; `Export` still present; empty state has no disabled action. AC: AS-2, AS-8.
  - Verify: `npm test -- SalesPipeline` (add/extend page test)

- **E3 — Remove the disabled "New request" CTA from the Procurement page.** In `Procurement.tsx` (lines 159–162) delete the disabled `New request` primary button; remove the disabled `action` from the empty `ListState` (line 215). Header collapses to title + sub.
  - Test: update a `Procurement` page test — assert no disabled "New request"; empty state has no disabled action. AC: AS-2, AS-8.
  - Verify: `npm test -- Procurement`

- **E4 — Decide + apply the detail-page disabled secondary actions.** `ProjectDetailHeader.tsx:71` ("Edit Project", disabled) and `ProcurementDetails.tsx:287` ("Audit trail", disabled) are disabled OUTLINE (secondary) buttons, not anchor primary CTAs. The audit's C3 targets the *anchor blue primary* CTAs on list pages; it says "if any disabled control remains add `aria-disabled`." Default decision: **remove** both (a disabled secondary in the header is still template-feel and adds nothing). If the owner prefers to keep them as a roadmap signpost, add `aria-disabled="true"` + keep the `title`. (See Open Questions.)
  - Test: update `ProjectDetailHeader.test.tsx` + a `ProcurementDetails` test — assert the disabled action button is absent (default) OR carries `aria-disabled` (if owner keeps). AC: AS-6 (a disabled control must not be a focus/AT trap), AS-8.
  - Verify: `npm test -- ProjectDetailHeader.test` and `npm test -- ProcurementDetails`

- **E5 — Simplify the `ListState` action contract (consequential cleanup).** With E1–E4 removing all `disabled`/`disabledTitle` action usages, the `ActionSpec.disabled`/`disabledTitle` fields and their Button wiring (ListState.tsx:8–12, 104–115) are now dead. Remove them so the component cannot render a disabled empty-state CTA again (prevents regression of the anti-pattern). Keep the live-action path (`label`+`onClick`) for "Clear filters".
  - Test: update `ListState.test.tsx` — assert the empty action renders a live (non-disabled) button; assert the `disabled` prop is no longer part of the type (compile-level — covered by AS-11 typecheck). AC: AS-2, AS-8, AS-11.
  - Verify: `npm test -- ListState.test`

### Group F — Placeholder pages → calm on-brand empty state + breadcrumb (C5)
*Files: `pages/PlaceholderPage.tsx`, `App.tsx`, plus test. Conflict-safe: PlaceholderPage.tsx owned only here. App.tsx is also lightly touched in Group H (I7) — see note; sequence F's App.tsx edit (breadcrumb fallback) and H's App.tsx edit (none — H does not touch App.tsx) so there is NO App.tsx overlap. App.tsx is owned by Group F only.*

- **F1 — Rebuild `PlaceholderPage` on the design-system empty state, no emoji.** Replace the entire body of `pages/PlaceholderPage.tsx`. Current file uses the legacy `../components/Card` (NOT the DS Card), raw `text-gray-800/500/300`, `dark:` variants (the app has no dark scheme — DESIGN.md Open Q is light-only), and the 🏗️ emoji. New version renders the existing `ListState variant="empty"` (52px `secondary` icon tile + `foreground` title + `muted-foreground` sub) left-aligned, with a neutral icon from the existing set and calm copy. Map each route title to a real icon: Tasks→`check`/`clock`, Companies→`folder`/building icon, Work Orders→`cart`/`doc`, Reports→`grid`/`doc`, Administration→`settings`. Copy per page is brief and concrete (no buzzwords, no aphorism, no em-dash — AS-3): e.g. Tasks → title "Tasks", sub "Task tracking arrives in a later release." (left-aligned, not the ListState default center — pass a className or use a left-aligned wrapper). NO action button (nothing to do yet).
  - Icon choice: pick from `ICON_PATHS` (the existing set) — confirm each name resolves at build (AS-1, AS-8). If a needed icon is absent, fall back to the generic `inbox` (ListState default) rather than inventing one.
  - Test: rewrite/extend a `PlaceholderPage` test — assert NO emoji character in output (AS-1); assert it renders the `liststate`-style empty (icon tile + heading + sub); assert no `text-gray-`/`dark:` classes; assert no action button. AC: AS-1, AS-2, AS-3, AS-5, AS-8.
  - Verify: `npm test -- PlaceholderPage`

- **F2 — Fix the breadcrumb for placeholder routes.** App.tsx:86–97 derives the breadcrumb from the active workspace tab; placeholder routes (`/tasks`, `/companies`, `/work-orders`, `/reports`, `/administration`) are NOT in `MODULES` (routeMatch.ts), so `tabForPath` returns null and the breadcrumb falls back to `[{ label: 'Dashboard' }]` — the C5 "wrongly reads Dashboard" bug. Fix: when no active module tab matches AND the location is a known placeholder route, set the breadcrumb to the page's own label. Cleanest: derive a fallback crumb from `useLocation().pathname` via a small `PLACEHOLDER_TITLES` map (or read the route element's title prop). Pass the resulting `[{ label: <PageTitle> }]` so the top bar reads e.g. "Reports", not "Dashboard".
  - Decision: add a `PLACEHOLDER_TITLES: Record<string,string>` next to the routes in App.tsx (single source with the `<Route>` titles, lines 50–54) and have the breadcrumb `useMemo` consult `location.pathname` when `ws` yields no tab. This avoids registering placeholder routes as real modules (they are not modules — keeps the rail/⌘K clean).
  - Test: add an App-level breadcrumb test (or extend the shell crumb test) — at `/reports` the breadcrumb renders "Reports", not "Dashboard". AC: AS-2 (correct wayfinding state).
  - Verify: `npm test -- App` or the breadcrumb test that covers App's derivation
  - Cross-check: this does NOT conflict with the owner directive to remove the tabbed workspace (separate workstream) — it fixes the crumb in the current tab-derived model; if/when tabs are removed, the same pathname→title fallback survives.

### Group G — Em-dash placeholder cells → "Not set" / "Pending" / omit (I3)
*Files: `pages/SalesPipeline.tsx` (Decision column), `pages/OpportunityDetail.tsx` (stats), `src/components/dashboard/PMDashboard.tsx` (margin), `src/components/dashboard/EngineerDashboard.tsx` (current timesheet), `pages/ProcurementDetails.tsx` (stat tiles), plus tests.*
*Conflict note: SalesPipeline.tsx, OpportunityDetail.tsx, ProcurementDetails.tsx are ALSO touched by other groups (E2 SalesPipeline CTA; H2 OpportunityDetail/ProcurementDetails BackBar). To stay conflict-safe, sequence within each file: do the Group E/H edit on a file, THEN the Group G edit on the same file, in one combined pass per file (see "Execution sequencing" below). The task list keeps them separate for clarity but they batch by file.*

- **G1 — SalesPipeline "Decision" column.** `SalesPipeline.tsx:138` renders `{ key:'decision', header:'Decision', cell: () => '—' }` — a hardcoded em-dash for every row (no data wired). Per I3: this column carries no data at all → **omit the column** (don't render a column of placeholders). Remove the `decision` column object from `tableColumns`.
  - Test: update `SalesPipeline` test — assert no "Decision" header in the table. AC: AS-3.
  - Verify: `npm test -- SalesPipeline`

- **G2 — OpportunityDetail stat placeholders.** `OpportunityDetail.tsx:178,181` set Owner → `'—'` and Decision → `'—'` when absent. Replace with muted "Not set" (Owner) and "Pending" (Decision) text via the `PageStat.value` (string is fine). Keep real values when present.
  - Test: update an `OpportunityDetail` test — when `opp.pm` is null, the Owner stat shows "Not set"; when `decided_at` is null, Decision shows "Pending". AC: AS-3, AS-5 (muted-foreground still AA).
  - Verify: `npm test -- OpportunityDetail` (add/extend)

- **G3 — PMDashboard margin cell.** `PMDashboard.tsx:114` shows `'—'` for non-active/zero-spend rows (intentional per its comment, but reads as a placeholder em-dash). Replace the bare `'—'` with a muted "Not set" label (or "n/a" — pick "Not set" for consistency). Update the inline comment.
  - Test: update `PMDashboard.test.tsx` — the existing test asserts non-active rows contain `'—'`; change it to assert "Not set" (AS-3). AC: AS-3.
  - Verify: `npm test -- PMDashboard.test`

- **G4 — EngineerDashboard current-timesheet stat.** `EngineerDashboard.tsx:58` falls back to `'—'` when there is no current timesheet. Replace with muted "None this period" (concrete, not a dash).
  - Test: extend `EngineerDashboard.test.tsx` — with no current timesheet, the stat shows the words, not `'—'`. AC: AS-3.
  - Verify: `npm test -- EngineerDashboard.test`

- **G5 — ProcurementDetails stat tiles.** `ProcurementDetails.tsx:250,255,260` use `'—'` for Selected quote / PO committed / Goods received when absent — but each already has a `sub` line ("no PO yet", "awaiting delivery", "N received"). Replace the `'—'` *value* with "Pending" (Selected quote, PO committed) and "None yet" (Goods received), keeping the existing subs. KEEP the `signedCurrency` `−` minus glyph elsewhere untouched (AS-3 exception).
  - Test: extend a `ProcurementDetails` test — when `selectedQuote` is undefined the "Selected quote" tile value reads "Pending", not "—". AC: AS-3.
  - Verify: `npm test -- ProcurementDetails`

### Group H — Project-card progress bars (I6) + redundant detail-page nav (I7)
*Files: `components/ProjectCard.tsx` (I6), `pages/project-detail/ProjectDetail.tsx` + `pages/OpportunityDetail.tsx` + `pages/ProcurementDetails.tsx` (I7), plus tests. Conflict note: OpportunityDetail/ProcurementDetails also in Group G — batch by file. ProjectCard.tsx owned only here.*

- **H1 — Label the two stacked project-card progress bars (I6).** `ProjectCard.tsx:83–95` renders two `ProgressBar`s (committed `tone="warning"`, actual default-tone) with NO visible legend — the audit's "94%/42%, no legend committed-vs-actual." The money `<dl>` above (lines 67–80) already labels Committed/Actual, but the bars are visually orphaned. Per I6, **label the bars**: add a tiny `label`-token (12px/600 `muted-foreground`, or 11px `overline`) leading each bar — "Committed" and "Actual" — inline-left of each `ProgressBar`, so each bar's meaning is explicit. (Chose label-each over merge-into-one-with-marker: the card already separates committed vs actual in the `<dl>`, and two thin labeled bars stay denser and clearer than a single overlaid bar with a marker. Merge is the fallback if the owner prefers a single bar — see Open Questions.) The bars keep their existing `aria-label`s (already descriptive — AS-4/AS-6). Use a 2-col mini-grid (`label | bar`) so the bars align.
  - Token use: label = `text-[12px] font-semibold text-muted-foreground` (the `label` type token); bars unchanged (warning + threshold tones are DESIGN.md status hues on data — legitimate per the Tinted-Status / progress-bar pattern). AS-8.
  - Test: extend `ProjectCard.test.tsx` — assert visible "Committed" and "Actual" labels are adjacent to the two progress bars; assert both `ProgressBar`s keep their `aria-label`. AC: AS-4, AS-5, AS-6, AS-8.
  - Verify: `npm test -- ProjectCard.test`

- **H2 — Drop the redundant in-page breadcrumb + BackBar on detail pages (I7).** Three detail pages stack redundant navigation on top of the top-bar breadcrumb (ContextBar, which for record tabs already renders `[Parent > Record]`, App.tsx:89–94):
    - `ProjectDetail.tsx`: has BOTH `<BackBar label="Projects">` (line 88) AND `<Breadcrumb>` (lines 89–92) — triple nav. Remove BOTH the in-page `BackBar` and the in-page `Breadcrumb` from the success render (keep them OFF). The top-bar breadcrumb provides the parent link.
    - `OpportunityDetail.tsx`: has `<BackBar label="Sales Pipeline">` (line 187). Remove it from the success render.
    - `ProcurementDetails.tsx`: has `<BackBar label="Procurement">` (line 273). Remove it from the success render.
  - IMPORTANT — keep BackBar in the **error / not-found** renders. On those branches the top-bar breadcrumb shows the *record id* (tab not yet hydrated to a human label) and there is no in-page header to orient from, so the explicit "Back to X" is the only clear escape route (ui-ux §1 `escape-routes`, §9 `back-behavior`). So: ProjectDetail keeps `BackBar` at lines 75 (error); OpportunityDetail keeps it at 104/112 (loading/not-found); ProcurementDetails keeps it at 174/186/201 (loading/error/not-found). Only the **success-render** BackBar/Breadcrumb are removed.
  - This also reclaims vertical space on the sparse Overview pages (audit C4 dovetail — handled by a different workstream; this just stops fighting it).
  - Test: update `ProjectDetail.test`, `OpportunityDetail` test, `ProcurementDetails` test — assert NO in-page Breadcrumb/BackBar in the success render; assert BackBar STILL present in the not-found/error render. AC: AS-2 (error state escape route preserved), AS-6.
  - Verify: `npm test -- ProjectDetail` , `npm test -- OpportunityDetail` , `npm test -- ProcurementDetails`
  - Cleanup check: if after H2 nothing imports `BackBar` from a given file, leave the shared `BackBar` component (still used by error branches) — do NOT delete the component.

### Group I — Mobile touch targets ≥44px (I5)
*Files: `src/components/ui/Button.tsx`, `src/components/shell/ContextBar.tsx`, `src/components/ui/ViewToggle.tsx` (segmented), plus tests + a global CSS coarse-pointer rule in `index.css`. Conflict note: ContextBar.tsx is NOT touched by any other group (it's the top bar). Button.tsx owned only here. Sequence Group I LAST so the touch-area change lands on the final markup of all the buttons the earlier groups left in place.*

- **I1t — Add a coarse-pointer hit-area expansion to `Button` icon size + small controls.** Audit I5: at 375px the bell is 18px, icon buttons / Export / New-deal 28px, segmented 25px — all < 44px. Per AS-7, GROW the hit-area, not the visual glyph. Two-part fix:
    - In `Button.tsx`, the `icon` size is `h-8 w-8` (32px) and `sm` is `h-7` (28px). Add a coarse-pointer min hit-area: append a class that on `@media (pointer: coarse)` enforces `min-h-[44px] min-w-[44px]` on `icon`/`sm` (and any interactive Button) via a relative `::after` hit-slop overlay OR a `@media (pointer:coarse)` min-size rule, keeping the painted button visually unchanged (transparent padding / pseudo-element). Implement as a single utility class `.touch-target` defined once in `index.css` (`@media (pointer: coarse){ .touch-target{ position:relative } .touch-target::after{ content:''; position:absolute; inset:50% auto auto 50%; translate:-50% -50%; min-width:44px; min-height:44px } }`) and apply it from `Button` base. This is a structural responsive change (ui-ux §5 `responsive structural`), not a token change (AS-8 safe).
  - Test: extend `Button.test` (or add) — assert the base class list includes the `touch-target` hook; (visual ≥44px is verified at /design-review on a 375px coarse-pointer render, AS-7). AC: AS-7, AS-9 (press feedback preserved), AS-8.
  - Verify: `npm test -- Button`

- **I2t — Apply the hit-area to the ContextBar icon buttons + cmdk + bell.** The bell button (ContextBar.tsx:89–105, `size-8` = 32px) and the mobile menu toggle (line 62–69, `size-8`) and the cmdk trigger collapsed state (line 75–87, `max-[921px]:w-9` = 36px) are under 44px on coarse pointers. Add the `.touch-target` hook (or equivalent `@media (pointer:coarse)` min-size) to these three so they reach ≥44px hit-area on mobile, glyph unchanged.
  - Test: extend `ContextBar.test.tsx` — assert the bell / menu / cmdk buttons carry the touch-target hook class. AC: AS-7, AS-6 (aria-labels already present).
  - Verify: `npm test -- ContextBar.test`

- **I3t — Apply the hit-area to the segmented `ViewToggle` buttons.** The segmented filter buttons (28px-ish `seg`) need the same coarse-pointer ≥44px hit-area. Add the hook to `ViewToggle`'s button class.
  - Test: extend `ViewToggle.test.tsx` — assert the segmented buttons carry the touch-target hook on coarse pointer. AC: AS-7.
  - Verify: `npm test -- ViewToggle`

---

## Execution sequencing (conflict-safe build order)

Groups touch overlapping files only at the page level (SalesPipeline, OpportunityDetail, ProcurementDetails). Build in this order; within a shared file, apply ALL edits for that file in one pass:

1. **Group A** (chartTheme.ts, procurementStatusTone.ts, ProjectedMarginBars.tsx) — must precede B (B changes `SALES_COLUMNS.dotColor` that A3 stops depending on).
2. **Group B** (salesPipeline.ts, Funnel.tsx, SalesKanbanBoard.tsx).
3. **Group C** (StatusPill.tsx, procurement.ts) — must precede D (D imports from procurement.ts).
4. **Group D** (ProcurementBoard.tsx).
5. **Group F** (PlaceholderPage.tsx, App.tsx) — isolated; can run anytime, placed here.
6. **Group E + G(SalesPipeline) one pass on SalesPipeline.tsx:** E2 (remove New deal) + G1 (remove Decision column) together. E1/E5 (Projects.tsx, ListState.tsx), E3 (Procurement.tsx), E4 (ProjectDetailHeader.tsx).
7. **Group H + G + E(detail) combined per file:**
   - `OpportunityDetail.tsx`: H2 (remove success BackBar) + G2 (Owner/Decision copy) in one pass.
   - `ProcurementDetails.tsx`: E4 (Audit-trail button) + H2 (remove success BackBar) + G5 (stat copy) in one pass.
   - `ProjectDetail.tsx`: H2 (remove success BackBar + Breadcrumb).
   - `ProjectCard.tsx`: H1. `PMDashboard.tsx`: G3. `EngineerDashboard.tsx`: G4.
8. **Group I LAST** (Button.tsx, ContextBar.tsx, ViewToggle.tsx, index.css) — touch-area lands on final button markup.

After all groups: `npm run typecheck` (zero), `npm run lint` (zero warnings), `npm test` (all green, ≥80% changed-line coverage), then **/design-review** on a 375px + 1440px render before merge.

---

## Cross-Workstream Dependencies (crossDeps)

- **I4 (EXCLUDED) — owned by the confirmation workstream.** OpportunityDetail "Next actions" inverted hierarchy ("Advance" = ghost while "Mark won" = solid blue + "Mark lost" = solid red). Batch-A edits OpportunityDetail.tsx (H2 BackBar removal, G2 stat copy) — the confirmation workstream will edit the SAME `Next actions` block (lines 222–243) to fix button variants AND add the confirm-before-mutate step. **File overlap on `pages/OpportunityDetail.tsx`** — sequence Batch-A's OpportunityDetail pass BEFORE the confirmation workstream's, or rebase. Batch-A does NOT touch lines 222–243.
- **C4 (different workstream) — thin pages.** H2 reclaims vertical space on detail Overview pages; the density-fill workstream edits the same Overview/Engineer/Timesheet bodies. **File overlap on `pages/project-detail/tabs/*`, EngineerDashboard.tsx** (Batch-A only touches EngineerDashboard.tsx:58 for G4 — coordinate).
- **Owner directive: remove tabbed workspace** — F2's breadcrumb fix lives in App.tsx's tab-derived `breadcrumb` useMemo (same file the tab-removal workstream rewrites). **File overlap on `App.tsx` + `WorkspaceTabsProvider`.** F2's pathname→title fallback is forward-compatible (survives tab removal) but the workstreams must reconcile the App.tsx `breadcrumb` block.
- **Owner directive: ⌘K search records / confirm-before-mutate / budget-version dropdown** — separate workstreams; no Batch-A file overlap except the OpportunityDetail/App.tsx ones above.
- **`procurement.ts` shared by Group C (pill variant) + ProcurementBoard/ProcurementDetails/Procurement page** — Group C changes only `pillVariantForStatus`'s return mapping; D/E/G consumers read the result. No signature change, so no break.
- **Storybook (Phase 3):** when the shared component library is extracted, StatusPill (new `progress` variant), ProgressBar (labeled usage), ListState (simplified action contract), and Button (touch-target) gain state-matrix + a11y stories. Out of scope here; noted for the extraction workstream.

---

## Open Questions (owner sign-off)

1. **Procurement pill "active" semantics (C2-proc / I1):** default maps ALL in-flight procurement statuses to the neutral `progress` variant (differentiated by label + the row's lifecycle pip stepper), reserving blue `open` for surfaces with a genuine single active item. Confirm, or do you want the *current* stage of each record to read blue while others are neutral? (Default is cleaner one-blue; the pip stepper already shows "where in the lifecycle.")
2. **Detail-page disabled secondary buttons (E4):** default REMOVES "Edit Project" and "Audit trail" disabled outline buttons. Keep them as roadmap signposts with `aria-disabled` instead? (Default removes template-feel; keeping is defensible if you want users to see what's coming.)
3. **Project-card bars (H1):** default LABELS the two bars ("Committed" / "Actual"). Prefer instead MERGING into one bar with a committed-marker over an actual-fill? (Default is clearer and denser; merge is the audit's alternative phrasing.)
4. **Placeholder copy + icons (F1):** proposed per-page icon/copy (Tasks→clock "Task tracking arrives in a later release.", etc.). Confirm the copy tone, or supply preferred wording. Also confirm left-aligned vs the ListState default centered empty (audit says left-aligned).
5. **Stage-dot token promotion (Open Q4 from DESIGN.md):** after B1/D1 every stage dot is a `--muted-foreground`/`--primary`/`--success` token (no more cyan/violet/orange literals on stages). This effectively RESOLVES the long-standing "promote stage-* to tokens" open question by collapsing to existing tokens — confirm you're happy not to have distinct per-stage stage-token hues (the rainbow is the thing we're removing).
