# Design-plan — Wave 5, Cluster 2: Dashboard drill-through + finance-console

**Date:** 2026-06-10 · **Owner lens:** Frontend + Existing-repo · **Wave:** 5 (IxD/naturalness), Cluster 2
**Authority:** `DESIGN.md` (design-system source of truth) · This is a design-plan only; the eng-planner plan + implementer build follow.
**Scope:** desktop-first (mobile = Wave 4 — note breakpoints, do **not** optimize 375px). READ-ONLY analysis of app code; no source edited.
**Findings covered:** N13 / D16 (KPIs as doorways), N16 (invoice-ready segment), N17 (Finance variance ranking), N18 (PM risk-sort), D4 (Engineer "what do I do today" CTA), J4 (finance-console reframe).

> **North-star (from `DESIGN.md` §1):** "The Quiet Control Surface." Every visual decision below names a `DESIGN.md` token. No new brand, palette, or font. No fake/placeholder figures (honest-dashboard rule, OD-W2-5 / SP-7).

---

## 0. OWNER-DECISION FLAGS (take these to the owner before build)

These are called out, **not** unilaterally settled. Each has a recommendation.

| # | Decision | Options | **Recommendation** |
|---|---|---|---|
| **OD-A** | **"At-risk" / "risk" definition for N18 + the at-risk drill (N13).** | (a) reuse the existing `spent/budget > 0.9` rule already in the RPC (`projects_at_risk`), `BvACard`, and `PMDashboard` (`AT_RISK_THRESHOLD = 0.9`); (b) add schedule/aging or over-budget (`spent > budget`) as a second tier. | **(a) reuse `spent/budget ≥ 0.9` verbatim** for this cluster. It is already the single canonical rule in 3 places; adding schedule/aging needs new data (no `due_date`/baseline-schedule domain exists) and would diverge the FE from the RPC. Keep it one rule; revisit aging when a schedule domain lands (it is a separate feature, like the cashflow track). **Pin the threshold in one shared constant** so KPI, drill-filter, and sort all agree. |
| **OD-B** | **How far to push J4 finance-console density.** | (a) restrained reframe (tabular figures, a denser BvA + variance table, tighter section rhythm, right-aligned money columns) within existing primitives; (b) a bigger redesign (multi-column ledger layout, sticky metric rail, sparklines). | **(a) restrained reframe.** `DESIGN.md` is "calm, dense, data-first" and bans "shadow-heavy floating-card soup" + the "hero-metric template." A console *feel* comes from tabular-nums everywhere, variance framing, and hierarchy — not new chrome. (b) risks inventing affordances the system bans. Mock (a) first (see §7). |
| **OD-C** | **N16 invoice-ready: where does it live?** | (a) a Finance-dashboard table/section ("Ready to pay"); (b) a new Procurement-list segment (`Vendor Invoiced`); (c) both. | **(c) both, but cheaply.** Add a **`Vendor Invoiced` status segment to the Procurement list** (one entry in the existing `StatusFilter` union — near-zero cost, helps every approver, not just Finance) **and** a **"Ready to pay" table on the Finance dashboard** that drills *into that segment*. The dashboard table is the "what needs attention" doorway; the list segment is the destination. This reuses N13's drill pattern end-to-end. |
| **OD-D** | **Ambiguous KPI drill destinations** (see §3 table footnotes). The genuinely ambiguous ones: **"Pipeline (weighted)"** and **"Pipeline forecast margin"** (Exec) → both point at `/sales`, but `/sales` has no weighted/margin lens; **"On-hand margin"/"Revenue on hand"** → no single "on-hand" list view exists; **"Total contract value"** → ambiguous (all active? the portfolio?). | per-KPI: drill, or leave non-interactive. | **Drill only where a real filtered destination exists; leave the rest as plain tiles** (honest-doorway rule — a KPI that drills to an unfiltered or wrong list is worse than no drill, the same dead-end trap that delayed N15). Recommended per-KPI dispositions are in §3; the owner confirms the 4 flagged rows. |
| **OD-E** | **N17 ranking + the `top_projects` RPC limit.** The RPC returns only `LIMIT 5 ORDER BY contract_value DESC`, then the FE re-sorts. Ranking *those 5* by variance is **not** true "worst-variance portfolio-wide" — the biggest bleeder might be the 6th-largest contract. | (a) FE-only: re-sort the existing 5 by variance (cheap, but a known half-truth); (b) backend: a new `top_projects_by_variance` slice / widen the RPC. | **(a) FE re-sort for this cluster, labelled honestly** ("Top 5 contracts, ranked by budget variance"), **and file (b) as a tracked backend follow-up** (a `get_finance_budget_review()` RPC or a `p_rank` arg). Going backend now pulls a migration + pgTAP + security-audit into an FE-only cluster. The honest label avoids implying portfolio-wide truth. **Owner: accept the half-truth label, or fund the backend slice into this cluster?** |

---

## 1. Feature summary & primary user action

Four role dashboards (`/` resolves by `effectiveRole`: Exec / Finance / PM / Engineer). Today every KPI is a **dead number** and the Finance/Exec views read like a generic card grid. This cluster makes **each KPI a doorway** to the filtered view it represents, reframes Finance/Exec as a **financial console** (variance-first, tabular), surfaces an **invoice-ready** queue for Finance, **risk-sorts** PM project lists, and gives the Engineer a **"what do I do today"** primary action.

**Primary user action per role:**
- **Exec:** "Where's my exposure?" → click *Active projects · N at-risk* → the at-risk project list.
- **Finance:** "What needs paying / what's bleeding?" → *Ready to pay* table → PR to Mark-as-Paid; *Budget review (by variance)* → worst project first.
- **PM:** "Which of my projects need attention?" → at-risk projects pinned to the top of my list.
- **Engineer:** "Log my hours" → one primary CTA above the fold.

---

## 2. What already shipped (Cluster 1 — do NOT re-skin)

Reference-only; this cluster *wires* and *reframes* these, it does not redesign them:
- `KPITile` **link variant** (`to` + `linkLabel`) — already a11y-correct (single `<Link>`, decorative help glyph). **This is the drill-through mechanism for N13/D16.**
- `AwaitingApprovalTile` (the N15 approvals doorway, already drills to `/approvals`).
- `BvACard` (text+bars BvA, screen-reader-friendly, already flags "At risk" pill at ≥0.9).
- `DataTable` (supports `sortKey` per column + `sort`/`onSort` + `aria-sort` — used for N17 sort semantics), `ProgressBar` (utilization), `StatusPill`, `StatusBarChart`, `ListState` (loading/empty/error), `DashGrid`/`DashPageHead` layout.

---

## 3. Per-dashboard design + the KPI → destination table

### 3.1 Drill-through mechanism (shared, all dashboards) — N13 / D16

Convert eligible `KPITile`s to the **link variant** (`to` + `linkLabel`). The destination must be a **real filtered view**. Two destination conventions:

1. **Existing routes that already filter** (`/approvals`, `/procurement`). The Procurement list filters by a `StatusFilter` segment held in local state — to make it deep-linkable we add a **URL search-param convention** (`/procurement?status=Vendor+Invoiced`) read on mount into the existing `filter` state. (Projects list likewise: `?filter=…`.) This is the one piece of new wiring; it is additive and backward-compatible (no param = today's default).
2. **A new at-risk projects view** = the existing `/projects` list with a new `at-risk` status-filter value (see §3.5). `/projects?filter=at-risk`.

> **a11y for every drill tile:** `linkLabel` is a full sentence ("4 projects at budget risk — open list"), the tile is a single focusable `<Link>` with the global focus ring, the help glyph stays decorative (already handled by the primitive). The value stays `tabular`.

### 3.2 Executive dashboard (`pages/ExecutiveDashboard.tsx`)

KPI band (6 tiles, reflow 6→3→2→1 at `min-[1180px]`/`min-[920px]`/`min-[560px]` — **unchanged breakpoints**). Drill dispositions:

| KPI tile | Today | Drill destination | Disposition |
|---|---|---|---|
| Revenue on hand (`kpi-on-hand-margin`) | dead | — | **Plain tile** (no single "on-hand" list view exists — OD-D). |
| Pipeline (weighted) (`kpi-pipeline-weighted-value`) | dead | `/sales` | **Drill → `/sales`** (the pipeline IS the weighted-value view; honest doorway). `linkLabel`: "Open the sales pipeline". |
| Pipeline forecast margin (`kpi-pipeline-projected-margin`) | dead | `/sales` | **Plain tile** — `/sales` shows no margin lens, so drilling there misrepresents (OD-D). Leave until a pipeline-margin view exists. |
| Active projects · *N at-risk* (`kpi-active-projects`) | dead | `/projects?filter=Ongoing` (value) **+** the "*N at-risk*" `vs` text becomes its own affordance | **Drill → `/projects?filter=Ongoing`.** See §3.6 for the at-risk sub-link. |
| Total contract value (`kpi-total-contract-value`) | dead | `/projects?filter=Ongoing` | **Drill → `/projects?filter=Ongoing`** ("active + closed-out" — confirm scope, OD-D). |
| Total project spend (`kpi-total-spend`) | dead | the Finance "Budget review" view (Exec can see it) → `/projects?filter=Ongoing` | **Drill → `/projects?filter=Ongoing`** (spend lives per-project; the BvA card below already breaks it down). |

Exec keeps its charts (BvA, WinRate, Procurement-by-status, Pipeline forecast margin) — no change. Exec gets the **J4 console reframe** typography/rhythm pass (§4) but keeps its 6-up KPI band.

### 3.3 Finance dashboard (`src/components/dashboard/FinanceDashboard.tsx`)

KPI band (5 tiles). Drill dispositions + the **console reframe is heaviest here**:

| KPI tile | Today | Drill destination | Disposition |
|---|---|---|---|
| Contracted revenue (`kpi-revenue`) | dead | `/projects?filter=Ongoing` | **Drill → `/projects?filter=Ongoing`**. |
| Total project spend (`kpi-spend`) | dead | the Budget-review table below | **Drill → `/projects?filter=Ongoing`** (or anchor-scroll to the on-page Budget-review table — recommend the route for consistency). |
| On-hand margin (`kpi-margin`) | dead | — | **Plain tile** (OD-D, same as Exec). |
| Outstanding invoices (`kpi-outstanding`) | dead | **`/procurement?status=Vendor+Invoiced`** | **Drill → invoice-ready segment (N16).** `linkLabel`: "Open vendor-invoiced requests awaiting payment". |
| PRs awaiting you (`AwaitingApprovalTile`) | already drills `/approvals` | — | unchanged. |

**New Finance tables (replace/augment the single "Top Projects by Spend" card):**

- **"Ready to pay" (N16)** — a `DataTable` of `Vendor Invoiced` PRs (from `useProcurements()`, filtered to `status === 'Vendor Invoiced'`). Columns: Request (title + mono code) · Project · Value (`align:num`, tabular) · Vendor-invoiced age. `onActivate` → `/procurement/:id` (Mark-as-Paid lives there). Empty state: honest "Nothing awaiting payment" (`ListState` empty, `icon="cart"`). This is the dashboard doorway; the list segment (§3.1) is the full destination.
- **"Budget review — by variance" (N17)** — re-rank the existing Top-Projects table. Replace the `sort((a,b)=>b.spent-a.spent)` with **variance-desc**: `variance = spent − budget` (committed basis, OD-BUDGET-2; `spent` is already the committed Σ from the RPC). Add a **Variance column** (`align:num`, tabular): show `+$X over` in `text-destructive` when `spent > budget`, else `$Y left` in `text-muted-foreground`. Keep Budget / Spent / Utilization columns. Worst (most-over) first. **Honest label** per OD-E: card head "Budget review — top 5 contracts by variance". Columns get `sortKey` so the user can re-sort (Budget/Spent/Variance/Utilization) with `aria-sort` (DataTable already supports this).

Finance keeps "Procurement by Status" chart. The KPI band reflows 5→3→2→1 (unchanged `min-[1180px]`/`min-[920px]`/`min-[560px]`).

### 3.4 PM dashboard (`src/components/dashboard/PMDashboard.tsx`)

| KPI tile | Today | Drill destination | Disposition |
|---|---|---|---|
| My projects (`kpi-my-projects`) | dead | `/projects?filter=My+Projects` | **Drill** — `linkLabel`: "Open my projects". |
| My contract value (`kpi-my-contract-value`) | dead | `/projects?filter=My+Projects` | **Drill**. |
| At risk (`kpi-at-risk`) | dead | **`/projects?filter=at-risk`** (new at-risk filter, §3.5) | **Drill → at-risk list (N13).** `linkLabel`: "Open my at-risk projects". |
| Awaiting approval (`AwaitingApprovalTile`) | drills `/approvals` | — | unchanged. |

**N18 — risk-sort the PM "Project Status" list.** The right-hand `Project Status` `<ul>` currently renders `mine` in arbitrary order. **Sort: at-risk first** (`spent/budget ≥ 0.9` among active projects), then the rest. Pin an **"At risk" `StatusPill variant="warn"`** on the flagged rows (the same signal `BvACard` already uses) — a text+icon signal, **not color-only**. Also risk-sort the **Projects *list page*** itself (§3.5) so the same ordering holds when the PM drills in.

### 3.5 Projects list page (`pages/Projects.tsx`) — N18 + the at-risk filter (shared destination)

Two additive changes (FE-only):
1. **`at-risk` status-filter value** — extend the `StatusFilter` union with `'at-risk'`: keep active projects where `spent/budget ≥ 0.9` (shared constant, OD-A). It is the drill destination for the Exec/PM/Finance at-risk KPIs. Read it from the URL param (`?filter=at-risk`) on mount.
2. **Risk-sort default ordering (N18).** Within the active partition, sort at-risk rows to the top regardless of the active segment, and pin the **"At risk" `StatusPill`** in the project cell. Default sort otherwise unchanged. (Keep it a stable secondary sort so existing column behavior holds.)

> **N19 (captured, adjacent):** the Projects page leads with manager filters even in Engineer scope — out of this cluster's explicit scope, but if the same file is touched, demote the PM/Client filters for the Engineer branch (Wave-6 candidate). Flag, do not bundle.

### 3.6 Engineer dashboard (`src/components/dashboard/EngineerDashboard.tsx`) — D4

The Engineer landing already shows Hours-this-week / Timesheet-status KPIs + hours cards. It **lacks a clear primary CTA**. Add a **"what do I do today" lead** above the KPI band:

- A single **primary `Button` (`variant="primary"`, the One Blue)** in the `DashPageHead` `actions` slot: **"Log this week's hours"** → `/timesheets`. Verb+object label (`DESIGN.md` copy rule). Exactly one primary action (ui-ux-pro-max `primary-action`).
- Make the **Hours-this-week** and **Timesheet-status** KPIs **drill** to `/timesheets` (link variant) — the IC's two numbers become doorways to the one place they act.
- Keep the existing empty-state "Log hours" action in the Hours card (it already routes to `/timesheets`).
- **No finance chrome** for the Engineer (consistent with D15 intent) — the Engineer view stays hours-only; this cluster does not add finance tables to it.

---

## 4. J4 — the finance-console reframe (Exec + Finance), restrained (OD-B)

Make Finance/Exec read like a financial console **using only `DESIGN.md` tokens** — no new chrome:

- **Tabular everywhere (`DESIGN.md` Tabular-Numbers Rule).** Every money / % / count / variance / age uses the `tabular` utility. KPI values already do (the primitive applies `tabular`); ensure the new Variance + age columns do too. This is the single biggest "console" signal.
- **Right-align all money/number table columns** (`align:'num'` — DataTable convention; `DESIGN.md` Data Table §5 "Numeric columns right-align").
- **Variance framing > raw spend.** The Budget-review table leads with *over/under budget*, not just the biggest number — that is what reads as "finance," not "generic cards."
- **Section rhythm.** Use the existing `DashPageHead` + `DashGrid` (`space-y-4`, `gap-3`) — vary spacing per `DESIGN.md` Layout, no new spacing values (Wave-6 H2 forbids arbitrary px). Group the two Finance tables as a coherent "ledger" block.
- **Status as tint + darkened-text pill** (Tinted-Status Rule) for over-budget — never a solid fill, never color-only (an "over" / "left" word rides alongside).
- **Card structure unchanged:** white `card` on `secondary/35%`, 1px `border`, no rest shadow (Flat-By-Default Rule). The console feel is typographic + data-hierarchy, not elevation.
- **Bans honored:** no hero-metric template, no identical-card-grid filler, no gradient/neon/glass, no second brand color. Recharts wrappers (`StatusBarChart`, `BvACard`, `ProjectedMarginBars`) reuse `chartTheme` (already token-derived) — no new chart colors.

---

## 5. All states (every data source, honest figures)

For each surface, the three `ListState` variants are already the system pattern; this cluster must preserve them on the **new** tables and never show a fabricated figure.

| Surface | Loading | Empty (honest) | Error |
|---|---|---|---|
| KPI drill tiles (all) | `KPITile loading` skeleton (already) | tile shows the real `0`/figure — never hidden | upstream hook error surfaces in the section's `ListState` (band-level), not per tile |
| Finance "Ready to pay" (N16) | `ListState variant="loading"` rows | `ListState empty` "Nothing awaiting payment" `icon="cart"` | `ListState error` + `onRetry={refetchProc}` (own `useProcurements` error, already wired) |
| Finance "Budget review by variance" (N17) | `DataTable state="loading"` | `DataTable state="empty"` "No project spend yet" | inherits dashboard `useDashboard` error (existing top-level error block) |
| PM "Project Status" risk-sorted (N18) | existing `ListState loading` | existing empty "No projects assigned" | existing `ListState error` + retry |
| Projects list `?filter=at-risk` | existing | **empty = honest win:** "Nothing at risk — every active project is under 90% budget" (`ListState empty`, `icon="folder"`) — a *good* empty state, not "nothing here" | existing |
| Engineer CTA / hours tiles | KPI skeletons (already) | existing "No hours logged this week" + Log-hours action | existing retry |

> **Honest-dashboard rule (OD-W2-5 / SP-7):** no `*0.4` fabrications, no placeholder figures. "Outstanding invoices" stays the real Σ of `Vendor Invoiced` value (already correct). An at-risk count of 0 shows `0` and a celebratory empty list — never hidden.

---

## 6. WCAG-AA accessibility

- **KPI-as-link = single interactive element** with an accessible name. The `KPITile` link variant already enforces this (one `<Link>`, decorative help glyph `aria-hidden`, global focus ring). Provide a descriptive `linkLabel` (full sentence, ui-ux-pro-max `link-standalone` / `aria-labels`) on **every** drill tile — never rely on the bare number.
- **Tables (N16/N17):** keep `DataTable` roles; sortable columns expose `aria-sort` (primitive supports `sort`/`onSort`). The "Ready to pay" rows are activatable → `rowLabel` per row ("Open PR {title}").
- **Figures text-labelled, not color-only** (`color-not-only`): the over-budget signal is the **word "over"/"left" + `tabular` sign** in the Variance cell, with `text-destructive` as reinforcement only. The at-risk signal is the **"At risk" `StatusPill`** (text + dot), not a red row.
- **Contrast:** over-budget text uses `text-destructive` on white = AA (`DESIGN.md` posture); muted "left/under" uses `muted-foreground` (darkened to L40, clears AA). Status pills use darkened-text variants (preserve, do not substitute the base hue) per `DESIGN.md` a11y.
- **Focus order:** KPI band → tables in DOM order (already top-to-bottom). New CTA (Engineer) sits in the page head, first in tab order on that view.
- **Charts:** unchanged; each already has a table-alternative (`BvACard`) or `aria-label` per `DESIGN.md` chart guidance.
- **Keyboard:** every drill tile is `Tab`-reachable and `Enter`-activatable (native `<Link>`). The at-risk sub-link (if added on the Exec "Active projects" tile `vs`) must not nest a second interactive inside the link — **recommend: the whole tile drills to `/projects?filter=Ongoing` and a separate dedicated at-risk path is reached via the PM at-risk tile / the Finance budget table**, avoiding a nested-interactive a11y violation (the same constraint the primitive was built around).

---

## 7. DESIGN.md tokens per piece (named, no literals)

| Piece | Tokens |
|---|---|
| Drill KPI tiles | `KPITile` primitive as-is: `card` bg, `border`, `rounded.lg`, icon-tile tones (`primary/violet/amber/destructive/success`), value `text-[23px]/700 tabular`, focus `ring`. No literals. |
| "Ready to pay" table | `DataTable` (`table-header-cell` overline `muted-foreground` 38px, `table-body-cell` 54px `foreground`), money cells `tabular` + `align:num`, mono code (`mono` type), `ListState` states. |
| "Budget review by variance" | `DataTable` + `ProgressBar` (utilization: track `secondary`, fill threshold `success`/`warning`/`destructive`). Variance cell: over = `destructive` text; under = `muted-foreground`; both `tabular`. |
| At-risk signal | `StatusPill variant="warn"` (amber tint + `warning-foreground` darkened text, 6px dot). |
| Engineer CTA | `Button variant="primary"` (`primary` bg, `primary-foreground`, `rounded.md`, 32px, faint brand shadow) — the One Blue. |
| Console reframe | existing `card`/`border`/`secondary-35%` surfaces, `DashGrid` `gap-3`, `space-y-4` rhythm, `tabular` numerics. No new tokens. |
| Layout/breakpoints | existing `min-[560px]`/`min-[920px]`/`min-[1180px]` arbitrary tiers (monotonic ascending, per the existing comment). |

**New-token need:** **none.** Every piece maps to an existing token. The one off-palette literal already in the tree (`KPITone='cyan'`, the sanctioned `hsl(199…)` literal) is **not extended** by this cluster (Wave-6 H1 will reconcile it). **No `DESIGN.md` edit required.**

---

## 8. PR breakdown (3 gated PRs, same Wave-5 cadence)

Cohesion: separate the **wiring** (drill-through, low-risk, broad) from the **finance data work** (ranking + new table + segment) from the **PM/Engineer** changes. Each PR: implementer → Director verify → code-quality-reviewer → **run touched e2e LOCALLY before push** → PR → CI → gate-merge.

- **PR-A — Drill-through wiring across all dashboards (N13 / D16).**
  Convert eligible KPIs to the link variant per §3 dispositions; add the `?status=` (Procurement) and `?filter=` (Projects) URL-param read-on-mount convention (additive, backward-compatible); add the `at-risk` Projects filter value (§3.5 item 1, the shared destination). Engineer hours/status tiles → drill `/timesheets`. **No data-shape changes.** Lowest risk, highest reach. e2e: a drill journey (KPI → filtered list) per role + the at-risk empty-state.
- **PR-B — Finance console (N16 + N17 + J4 reframe).**
  Add "Ready to pay" table (Vendor-Invoiced) + the Procurement `Vendor Invoiced` list segment (OD-C); re-rank Top-Projects → "Budget review by variance" with the Variance column + sortable headers (N17, OD-E honest label); apply the J4 tabular/right-align/rhythm reframe to Finance (and the lighter Exec pass). e2e: Finance "Ready to pay" → PR detail; variance ordering assertion (worst-over first).
- **PR-C — PM risk-sort + Engineer CTA (N18 + D4).**
  Risk-sort the PM "Project Status" list + pin the at-risk pill; risk-sort the Projects list page default (§3.5 item 2); add the Engineer "Log this week's hours" primary CTA. e2e: PM at-risk pinned-to-top assertion; Engineer CTA → `/timesheets` journey.

> **Sequencing:** PR-A first (it ships the at-risk filter + param convention that PR-B's "Ready to pay" drill and PR-C's PM at-risk tile both depend on). PR-B and PR-C are then independent.

---

## 9. Which surfaces warrant a mockup before build (vs review-post-build)

- **Mockup-first: the Finance console reframe (J4 + the two new tables, PR-B).** This is a *visual judgment* call (density, variance-column treatment, table grouping, "does it read as a console?") — exactly the kind of decision the MEMORY lesson says can "read as sound in the spec and still be wrong once rendered." A quick static mockup (design-mockups HTML, tokened) for the owner taste-gate **before** build de-risks it. Recommend mocking the Finance dashboard at desktop width only.
- **Review-post-build: PR-A (drill wiring) and PR-C (risk-sort + CTA).** These are mechanical/behavioral, not new visual surfaces — the rendered 3-lens design-review (visual + IxD task-flow + IA) after build is sufficient. PR-A especially is "the number now navigates," which is best judged live by clicking.

---

## 10. Open questions (beyond the OD flags)

- **OD-E backend slice:** if the owner funds `get_finance_budget_review()` into this cluster, PR-B grows a migration + pgTAP + security-audit (it stays security-invoker, no org_id arg — same pattern as `get_executive_dashboard`). Default assumption: **FE-only with honest label**, backend tracked.
- **Exec "Total contract value" scope** (active vs active+closed-out) — the tile copy says "active + closed-out" but `total_contract_value` in the RPC is `Ongoing Project` only; the drill `/projects?filter=Ongoing` matches the *data*, not the *copy*. Recommend: drill to `Ongoing` and fix the tile `vs` copy to "active" in PR-A (a 1-word honesty fix). Flag for owner.
