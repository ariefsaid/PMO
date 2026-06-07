# UI AI-Slop + Craft Audit — 2026-06-07

Holistic `taste` + `impeccable` + `ui-ux-pro-max` audit of the completed IA-3 app (`main`), all surfaces × all roles, rendered + computed-style probed. **Verdict: fix-then-ship — NOT a rework.** Tokens/design-system are sound; the "slop" is ~5 concrete behaviors. Screenshots: `/tmp/pmo-audit/shots/`. Audit authority: `DESIGN.md` (RIS "Quiet Control Surface").

## CRITICAL (these read as "AI slop")

- **C1 — Rainbow charts break One-Blue.** Dashboard "Procurement by Status" bars render 5 saturated fills (violet/amber/amber/blue/green); Exec "Pipeline–Projected Margin" has a violet bar. Fix: single-hue chart system (primary blue main series); status hues ONLY where the bar's meaning *is* that status, and then **tinted, not saturated**. Files: `src/components/dashboard/StatusBarChart.tsx`, `procurementStatusTone.ts`, `ProjectedMarginBars.tsx`, `chartTheme.ts`.
- **C2 — Off-palette invented colors.** Sales funnel band dots use cyan `rgb(13,162,231)` + orange `rgb(249,116,21)` — **neither exists in DESIGN.md**. Fix: remap stage dots to the documented palette (neutral upstream, `primary` active, `success`/`destructive` won/lost); delete cyan+orange. Files: `Funnel.tsx`, `components/salesPipeline.ts`, `components/SalesKanbanBoard.tsx`.
- **C3 — Disabled blue primary CTAs anchor every list page.** "New deal" / "New Project" / "New request" are `disabled` `opacity .45` blue buttons, top-right — the most prominent element on each page → "unfinished template." Fix: REMOVE them (don't anchor a page with a dead CTA); if any disabled control remains add `aria-disabled`. Files: `pages/Projects.tsx`, `SalesPipeline.tsx`, `Procurement.tsx`, `Timesheets.tsx`.
- **C4 — Thin pages = wireframe feel.** Engineer "My Dashboard" (~70% empty), populated Timesheet grid (~65% empty), Project-detail Overview (two cards then void). Fix: denser composition filled with **real secondary data** (recent entries, this-week-by-project, etc.); don't decorate the void. NOTE: some slots (e.g. Engineer "assigned tasks") need the deferred Tasks module — fill what existing data supports, leave deferred slots out.
- **C5 — Emoji "under construction" placeholders.** `/companies` `/tasks` `/work-orders` `/reports` `/administration` show a centered card + 🏗️ emoji — `taste` BANS emoji; the most recognizable AI tell. Breadcrumb also wrongly reads "Dashboard" on these. Fix: calm on-brand empty state (neutral icon from the existing set, left-aligned, brief copy, NO emoji) + correct the breadcrumb. File: `pages/PlaceholderPage.tsx`.

## IMPORTANT

- **I1 — Status pills overload blue.** Procurement "Vendor Quote"/"Purchase Request"/"Purchase Order" all render identical `rgb(24,70,170)` on `primary/10%` — 3 statuses look the same. Fix: differentiate (neutral progression + accent at active stage, or distinct tinted hues). Files: `StatusPill.tsx`, `components/procurement.ts`.
- **I2 — Inconsistent status-dot language.** Procurement board: all 6 column dots same blue; Sales funnel dots multi-color. Fix: one status-dot convention across boards.
- **I3 — Em-dash placeholder cells.** "Decision —", "Goods received —", "Owner/Decision —" across Sales table, opportunity detail, PM dashboard, procurement detail. Fix: muted "Not set"/"Pending …" labels, or omit the column when empty.
- **I4 — Inverted action hierarchy.** OpportunityDetail "Next actions": "Advance" (the primary path) is plain ghost text while "Mark won" is solid blue + "Mark lost" solid red (two solid fills compete; primary action weakest). Fix: Advance = primary blue; Mark won/lost = quiet outline + status dot (destructive solid only on the irreversible confirm). **Dovetails with the confirmation workstream.**
- **I5 — Mobile touch targets < 44px.** At 375px: notification bell 18px, icon buttons/Export/New-deal 28px, segmented 25px. Fix: bump interactive hit-areas to ≥44px on coarse-pointer/mobile breakpoints (grow padding, not visual size). WCAG 2.5.5.
- **I6 — Project cards: two unlabeled stacked progress bars** (94%/42%, no legend committed-vs-actual). Fix: label them or merge into one bar with a marker.
- **I7 — Redundant triple navigation on detail pages.** Top-bar breadcrumb + in-page breadcrumb + "← Back to X", stacked. Fix: keep only the top-bar breadcrumb; drop the in-page duplicate (also reclaims vertical space on sparse pages).

## MINOR / POLISH
- M1 truncated PM names ("Alice Mana…") in Projects table — widen/wrap.
- M2 Sales funnel band overflows horizontally on mobile (hard-cut, no scroll affordance).
- M3 UUID leak in error-page title + stale tab (the raw `00000000-…-999` id) — friendly label. (Tab removal resolves the stale-tab part.)
- M4 stale tooltip/⌘K/hover artifacts — verify cleanup.
- M5 Projects "STATUS" column pill floats mid-cell with dead gaps — left-align.
- M6 empty-state icons in grey circles — borderline `taste` §7; keep restrained.

## Top 5 highest-impact (start here)
1. Kill the disabled blue primary CTAs (C3).
2. De-rainbow the charts (C1).
3. Replace the emoji "under construction" placeholders (C5).
4. Fill the thin pages with real data (C4).
5. Fix off-palette funnel colors + blue-overloaded status pills (C2 + I1).

## Owner directives (this round, beyond the audit)
- **Remove the tabbed workspace** (audit agrees — also kills the UUID/stale-tab leaks M3/M4); nav via rail/breadcrumb/⌘K.
- **Make ⌘K search records** (open a specific project/PR/opportunity by name/code), not just modules.
- **Confirmation step before EVERY DB-mutating action** (rule of thumb: nothing writes to the DB on a single click — add a confirm/approve step). Investigate the reported "procurement state change clicked but status doesn't change" (possible silent no-op/illegal-transition without feedback).
- **Budget-version dropdown** — restore the select-a-version-to-view UX in the Project Budget tab (vs all versions stacked). It was lost when the Budget module was rebuilt on real data.

## Strengths to PRESERVE
Procurement detail (the density bar), ⌘K palette, the project-not-found error state, shell rail grouping + active nav, token plumbing + global focus ring. This is not a rework — keep the identity.
