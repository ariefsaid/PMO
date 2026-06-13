# Wave-0 S1 — Executive Dashboard, 390px mobile condensation (design-plan)

**Status:** taste-gated, awaiting owner sign-off. React build follows approval.
**Scope:** mobile-only condensation of the Executive role view of `pmo-portal/pages/ExecutiveDashboard.tsx`. Desktop unaffected. Design-plan + mockup only — no app code.
**Mockup:** `docs/design-mockups/wave0-exec-dashboard/index.html` (390px frame, above-the-fold + below-the-fold).

## Problem
On a 390px phone the exec view is 6 stacked KPI tiles → approvals → 4 charts. An exec scrolls a long way before answering **"what needs my attention?"**. Finding **B-MIN-3:** "Revenue on hand $26.65M" rendered above the smaller "Total contract value $23.05M" reads like an error to an exec (revenue > contract value looks self-contradictory).

## Real content inventory (from source — nothing invented)
- **6 KPI tiles:** Revenue on hand (`on_hand_value`, `X% realized`) · Pipeline weighted (`pipeline_weighted_value`, `of $X gross`) · Pipeline forecast margin (`weightedPct`) · Active projects (`active_projects`, `N at-risk`) · Total contract value (`total_contract_value`, active) · Total project spend (`Σ spent`).
- **Approvals band:** `AwaitingApprovalTile` (count → `/approvals`).
- **4 charts:** Budget vs Actual · Win rate · Procurement by status · Pipeline forecast-margin bars.

## Above-the-fold ordering (first viewport, ≤844px tall − 56px header ≈ 788px)
The exec's questions are: *(a) what's on fire? (b) what's waiting on me? (c) is the book healthy?* — in that order.

1. **Needs attention — Projects at risk** (new framing). The `projects_at_risk` figure becomes the lead block (warning tile), with two drill cells reusing the existing **Active projects** (`active_projects` → `/projects?filter=Ongoing`) and **Total project spend** drills. This surfaces delivery exposure first instead of burying `N at-risk` as KPI-4 subtext.
2. **Awaiting your approval** — the `AwaitingApprovalTile` count, promoted to a one-line action band with a primary **Review** CTA → `/approvals`. The only saturated-blue affordance above the fold (One Blue Rule).
3. **Contract book** (B-MIN-3 fix) — the two headline money figures, **Revenue on hand** + **Active contract value**, grouped under one overline, each sourced.

That is the full first viewport: one at-risk block, one approvals/action block, two decision-ready KPIs.

## What's demoted (below the fold)
- **Pipeline (weighted)** — forward-looking, not "needs attention now" → first block below fold.
- **Pipeline forecast margin** + **Total project spend** → collapsed into a **"Show N more KPIs"** `<details>` disclosure (still reachable, off the critical path; spend also appears as an at-risk drill cell so it's not lost).
- **All 4 charts** — single-column, scroll. Detail/analysis, not glance.

## B-MIN-3 fix (copy)
Root cause: two unrelated bases (revenue vs contract value) stacked with no grouping, so the larger-revenue-over-smaller-contract-value reads as an error.

Fix = **group + relabel + micro-source-line**, no number changes:
- Section overline: **"Contract book"** (binds the two as one comparison set).
- Tile 1 label unchanged: **"Revenue on hand"** — `$26.65M` — source line: *"Booked across active + closed-out contracts · 22.4% margin realized."*
- Tile 2 relabel **"Total contract value" → "Active contract value"** — `$23.05M` — source line: *"Signed value of the 18 projects still in delivery."*

The two source-lines make the asymmetry self-explanatory: revenue includes **closed-out** work; contract value is **active-only**. They no longer read as a contradiction. (Matches the source's own honesty note that `total_contract_value` is Ongoing-only.)

> Open question for owner: confirm **"Active contract value"** as the term (vs "Contract value (active)" / "Active book value"). Glossary may need a one-line entry.

## Breakpoint behavior (desktop unaffected)
- Existing source uses arbitrary `min-[560/920/1180]` tiers; the 6-up KPI grid already reflows to 1-col below 560px. **This plan changes only the <560px (effectively phone) composition** — reorder + the at-risk/approvals/contract-book grouping + the disclosure.
- Recommended implementation seam: a single mobile breakpoint at **`< 640px`** (or reuse the table-reflow `useIsDesktop()` `(min-width: 768px)` pattern, single-render — DESIGN.md §5 DataTable reflow note) so exactly one composition is in the DOM (no flash, no double a11y tree).
- **At ≥ the chosen breakpoint:** render the existing desktop layout verbatim — 6-up KPI band, approvals row, 2×2 chart grid. No desktop regression.

## DESIGN.md tokens per piece (no raw values)
| Piece | Tokens |
|---|---|
| Page bg | `secondary`/35% main wash |
| Header (56px) | `background`, `border`, `muted-foreground` icons, `destructive` notif dot |
| Page title / sub | typography `page-title` (24/700/-0.02em) · `body`+`muted-foreground` |
| Section overlines | typography `overline` (11/600/0.06em uppercase) · `muted-foreground` |
| At-risk tile | `card` + `border`, `rounded.md`; icon tile `warning`/14% bg + `warning-foreground`; value `warning-foreground` 23/700 `tabular`; drill cells `border`+`rounded.sm`, arrow `primary` |
| Approvals band | `card`+`border`; icon `warning`/14% + `warning-foreground`; **Review CTA** = `button-primary` (`primary` bg, `primary-foreground`, `rounded.md`, 32px, brand shadow `0 1px 2px primary/0.25`) |
| KPI money pair | `card`+`border` `rounded.md`, pad `spacing.4`; icon tiles `success`/12%, `warning`/16% (won/violet/lost darkened-AA text tokens); value 23/700 `tabular`; source line `label`/`muted-foreground` |
| Pipeline tile | icon `violet`/12% + `--status-violet-text`; value 23/700 `tabular` |
| "More" disclosure | `card`+`border` `rounded.md`; chevron `muted-foreground`; mini-tiles same card recipe |
| Charts | `card`+`border` `rounded.md`; head `heading`-ish 13.5/700 + `border` underline; bars track `secondary`, fill `success`/`warning`/`destructive` by threshold |
| Focus (all) | global `:focus-visible` 2px `ring`, 2px offset |

All figures carry `tabular-nums` (Tabular-Numbers Rule). Flat-by-default: every card border-defined, no rest shadows except the brand button.

## States (build must cover all — owned by tests per ADR-0010)
- **Loading:** skeleton at-risk + approvals + 2 money tiles above fold (reuse `KPITile loading`); charts skeleton below.
- **Empty:** existing `dashboard-empty` ListState (no projects) — unchanged, full-width.
- **Error:** existing `dashboard-error` ListState with retry — unchanged.
- **Edge:** 0 at-risk → tile shows "0 / N · all on track" (success/neutral tone, not warning); 0 approvals → count `0`, "Nothing waiting", CTA → de-emphasized (still links). Long currency (e.g. `$226.65M`) must not wrap the headline — `tabular` + single-line.

## A11y (WCAG-AA)
- At-risk warning value uses `warning-foreground` (deep brown) — AA on white and on the 14% amber tint (DESIGN.md preserved darkened-text tokens).
- Each drill cell / approvals band is **one** link with a descriptive `aria-label` (no nested interactive — matches source's "whole tile is ONE link" rule).
- Section landmarks keep `aria-label` (Needs attention / Approvals / Contract book / Pipeline / Detail).
- Tab order = DOM = priority order (at-risk → approvals → money → pipeline → disclosure → charts). Disclosure is a native `<details>` (keyboard-operable, `Enter`/`Space`).
- Touch targets ≥44px on the drill cells, approvals band, and disclosure summary (`.touch-target` in build).
- Single-render at the breakpoint ⇒ each control appears once in the AT tree; **no `aria-hidden` dual-branch**.

## Regression invariant (test post-build)
At viewport **390 × 844**, role = Executive, on the rendered dashboard, **before any scroll**, all THREE must be present and fully within the first `844 − 56 = 788px`:
1. the **Projects at risk** block (`[data-testid="dashboard-at-risk"]` or equiv),
2. the **Awaiting approval** action band with its **Review** CTA (`[data-testid="kpi-awaiting-approval"]`),
3. **both** Contract-book money tiles — **Revenue on hand** and **Active contract value**.

And: **Active contract value must render in the same grouped section as Revenue on hand** (B-MIN-3 — they must never appear as two ungrouped, unsourced tiles where revenue > contract value reads as an error). Owning layer: Playwright (one curated mobile-viewport journey) per ADR-0010; the grouping/label assertions can additionally be RTL unit.

## Open questions for owner
1. Confirm **"Active contract value"** as the relabel (and whether a glossary entry is wanted).
2. The at-risk drill cells reuse `active_projects` + spend — OK to drop the standalone "Active projects" KPI from the mobile fold (it survives as a drill cell + in desktop), or keep it as a third money/count tile?
3. Mobile breakpoint seam: reuse the existing `useIsDesktop()` 768px single-render, or introduce a 640px one specific to the dashboard?
