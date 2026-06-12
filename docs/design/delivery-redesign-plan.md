# Design-plan: delivery-milestones redesign

- **Date:** 2026-06-12 · **Author:** design-architect
- **Owner-approval artifact:** `docs/design-mockups/delivery-redesign.html` (approve THIS first).
- **Audit it resolves:** `docs/design/delivery-feature-audit.md` (4 Critical / 9 Important / 7 Minor).
- **Token authority:** `DESIGN.md`. No new token required (confirmed §Tokens). Identity preserved.
- **Consumers:** eng-planner (the committed-spend data delta + reorder decision are architectural; the per-phase `weight` is already on `project_milestones`), then ui-implementer (the component restyle). Build behind the standard per-UI loop: design-plan → implement (TDD) → `/design-review` before merge.
- **Constraint:** this is a FIX issue over merged, AC-passing code. **Do not regress any of the 22 ACs.** Every change below preserves the AC's behavioral oracle; where a test asserts a now-changed visual (e.g. AC-DEL-008 "two cells side by side", AC-DEL-013 "no chip"), the test's *intent* is preserved and the assertion is updated only for a deliberate UX change per the BDD authoring rule (CLAUDE.md). Flagged inline as `[AC-TOUCH]`.
- **2026-06-12 note — stepper even-bar + mobile-style labels:** owner direction supersedes the earlier width-as-weight treatment in the mockup only. Desktop/mocked steppers now use four equal bar segments (`flex:1 1 0` each) with completion shown by fill only; weight is carried in the label line (`N% of project`). Label stack is unified across desktop + mobile: row 1 name + emphasized completion %, row 2 muted weight, row 3 muted `Target DD Mon`; overdue keeps warning treatment and current keeps the micro-label.
- **2026-06-12 note — stepper label revert to vertical big-% layout 2026-06-12:** owner approved a calmer label block and asked the mockup to revert in place. For every stepper instance the label block is now left-aligned and vertically stacked as: bold phase name → large bold effective % on its own line → muted `Target DD Mon` (warning for overdue Construction) → muted `From tasks N%` / `From tasks —` → quiet `Edit progress` text link for PM/Admin only. The four even segments, completion fills, `Current` micro-label, `Overdue` chip, rollup, and read-only Engineer omission of the edit link remain unchanged.

---

## Owner-review refinements — locked 2026-06-11

Four directives from the owner's first mockup review. Decisions are made; do not re-open. Applied verbatim to the mockup (`delivery-redesign.html`) and reflected in the resolution text below (R3 supersedes the original "Manual badge" language).

| # | Directive | Surface(s) affected | Applied |
|---|---|---|---|
| OR-1 | Remove the "Manual" pill/badge entirely. Replace with a quiet two-line readout: effective % headline, then "From tasks N%" muted beneath (`text-[11px]` / `muted-foreground`). No pill, no badge. The juxtaposition of a differing "From tasks" number IS the divergence cue. When effective == calculated, still show "From tasks N%" for consistent rhythm. At most a `title` tooltip "Set by PM" if a non-pill marker is ever needed — default is no marker. | Stage Stepper nodes, mobile vstep view | Mockup updated; R3 text updated below; AC-DEL-008/009 oracle note updated. |
| OR-2 | Spell "Tgt" as "Target" everywhere. Overdue phase: red target date + "Overdue" chip, but label reads "Target 01 May" (not "Tgt"). | All date labels in stepper, tasks-tab group header | Mockup updated; all `step-date` text now "Target …". |
| OR-3 | At 375px narrow rendition, every pill/chip (At risk, Overdue, status pills, delivery/budget figures) must fully encapsulate its fill: `flex-shrink:0`, `white-space:nowrap`, adequate horizontal padding, flex parent with `min-width:0` so the pill is never squashed. Demonstrate in the mockup narrow column. This is a **binding implementation requirement**: ui-implementer must verify at 375px. See §Responsive — binding pill rule below. | All narrow/mobile renditions | Mockup `.pill` class updated; narrow `.pcard .top` updated with proof row. |
| OR-4 | Tasks-tab milestone group header shows ONLY: "Procurement · Target 30 Jun · 75%". No "Manual" label, no calculated number. Full calc-vs-input detail lives exclusively in the Stage Stepper. Apply the same rule to any compact/secondary surface showing milestone progress. | Tasks-tab group header, any compact surface | Mockup updated; group-head revised to plain name + date + effective % only. **NOTE: OR-4 is superseded by D3 below (2026-06-12 second review) — the group header now shows NO % at all.** |

---

## Second mockup-review refinements — locked 2026-06-12

Three further directives from the owner's second mockup review. D1 and D3 are made (execute verbatim); D2 was a design-judgment call resolved here with ui-ux-pro-max research. All applied to the mockup (`delivery-redesign.html`, this revision).

| # | Directive | Surface(s) | Applied |
|---|---|---|---|
| D1 | "Edit progress" affordance on **every** phase cell for PM/Admin, not just the current one (the spec lets a PM/Admin edit the input-% of *any* milestone). Engineer = read-only (no affordance). Keep it quiet — a small "Edit progress" link/pencil that recedes until hover/focus, but **always in the DOM** so it is keyboard-reachable on every phase. Match the per-cell rhythm; don't clutter. | Stage Stepper nodes (desktop), mobile vstep rows | Mockup: `.step .edit` link added to all four nodes; `opacity:0.55` at rest → `1` on `:hover`/`:focus-within`/`:focus-visible`; mobile `.vstep .vedit` 44px button per row. |
| D2 | Make each phase's **weight** (its share of the project) legible **without** confusing numbers. **Chosen pattern: weight encoded as stepper segment WIDTH** (+ a cumulative weighted-fill track + a quiet per-cell caption). See §D2 — weight-display decision for the full rationale and the ui-ux-pro-max source. | Stage Stepper (desktop band + cumulative track), mobile vstep (weight label fallback) | Mockup: `.stepper` grid columns now `15fr 35fr 40fr 10fr`; per-cell `.step-weight` "N% of project" caption; `.delivery-track` cumulative weighted band; mobile `.vweight` explicit label fallback. |
| D3 | Tasks-tab group header shows **NO progress %** at all — only phase name + target date ("Procurement · Target 30 Jun"). 75% IS the manual/effective value, so showing it alone is still "manual without context" (the owner's repeated objection). The progress story (completion, weight, from-tasks) lives **only** in the Stage Stepper. Apply the same "no % in compact secondary surfaces" rule everywhere it recurs. **Supersedes OR-4.** | Tasks-tab group header; any compact/secondary milestone surface | Mockup: group-head now `name + "Target DD Mon"` only; `.g-pct` element removed. R3 and the component-delta updated below. |

---

## D2 — weight-display decision (segment-width encoding) + research

**Decision: ADOPT the Director's hypothesis — encode weight SPATIALLY as stepper segment WIDTH, with three coordinated parts:**

1. **Segment width ∝ weight.** The horizontal stepper is a CSS grid whose column tracks are weight-proportional (`grid-template-columns: 15fr 35fr 40fr 10fr` for Eng 15 / Proc 35 / Const 40 / Commiss 10). Each segment fills by its own completion %. So "Engineering is 100% complete but only 15% of the project" reads **pre-attentively** — a narrow, fully-filled cell — with zero arithmetic. The project's 48% is the visual sum of weighted fills.
2. **A cumulative weighted "Project delivery" track** under the stepper: weight-proportional segments, each inner-filled by its phase's completion%. Read left→right the filled area literally *is* the 48% rollup (`15×100% + 35×75% + 40×20% + 10×0% ≈ 48%`). This is the earned-value rollup band made visible.
3. **A quiet per-cell weight caption** — muted `overline`/`muted-foreground` "15% of project". This is the exact number, parked as the least-prominent line, so the precise share is available without it competing with the effective-% headline. "From tasks N%" stays muted secondary, unchanged (OR-1).

**ui-ux-pro-max source drawn on:** Charts & Data §10 — **`direct-labeling`** ("for small datasets, label values directly on the chart to reduce eye travel" → 4 phases is small; label the weight in-cell, not in a tooltip) and **`visual-hierarchy`** (§6, "establish hierarchy via size, spacing, contrast — not color alone" → magnitude belongs to spatial size, i.e. width). This matches the conventional ERP/PM treatment (MS Project / Primavera / earned-value summary bars, where a WBS rollup bar's segments are weight-proportional and each fills by % complete). **impeccable critique on cognitive load:** showing weight as a raw number ("weight: 3") forces the user to mentally convert weight→share→contribution; encoding it as width offloads that to perception entirely. A single muted "15% of project" caption is the minimum precise anchor; anything more is the clutter the owner objected to.

**Rationale (2–3 sentences for the record):** Weight as segment width lets the user grasp "this phase is done but small" / "this phase is huge but barely started" at a glance, and makes the project rollup read as the visual sum of weighted fills rather than a number to trust on faith. The exact share lives in one quiet muted caption per cell, so precision is available without number-clutter. This is the standard earned-value / WBS-rollup convention (MS Project / Primavera) named in ui-ux-pro-max's `direct-labeling` + `visual-hierarchy` guidelines.

### D2 accessibility caveat at 375px + handling (binding)

A 10%-weight segment at 375px is ~30px wide — **below the readable-label and 44pt touch-target thresholds** (ui-ux-pro-max §1 `touch-target-size` 44pt; §10 `touch-target-chart`; §5 `horizontal-scroll`). So the proportional-width band is **desktop-only (≥768px)**. Below 768px the stepper falls back to the established thin vertical rows, and **each row carries an explicit "15% of project" muted text label** — weight legible by *label* on mobile, by *width* on desktop. Color is never the only cue (the cumulative track has an `aria-label` describing each phase's weight + completion, and the per-cell caption is text). The per-row mobile edit affordance is a 44px target.

---

## Chosen resolution per finding (with rationale + tokens + states)

### R1 — Projects list: delivery-% IS "Progress"; committed-spend is "Budget used"; retire the title chip
**Findings:** F-DEL-01a (Critical IA), F-DEL-01b (Critical data), F-DEL-02, F-DEL-03, F-DEL-04.
**Decision:** the Projects-list row carries **two distinct, correctly-labelled columns**:
- **"Progress"** = the **delivery-%** rollup (from `useProjectsDelivery`), rendered as a threshold-coloured `ProgressBar` + tabular value. No-milestone rows render "No phases yet" (muted), never a competing chip.
- **"Budget used"** = **committed-spend / budget** (or /contract — see OPEN-Q-A2), rendered as a `ProgressBar` + a `committed of budget` sub-line; over-threshold rows use the `warning-foreground` sub-line (preserve the existing at-risk co-location logic, just re-source it).
- The title-line `DeliveryPctChip` is **removed** from `Projects.tsx` (its value is now the Progress column).

**Rationale:** kills the one-canonical-view contradiction (two "progress" numbers). "Progress" means schedule/delivery to this audience; budget burn is a separate, explicitly-labelled cost metric. Execs scan both.

**Tokens:** `ProgressBar` (existing, 7px `secondary` track, `success`/`warning`/`destructive`-by-threshold fill); Progress value = `body`/700 + `tabular`; "Budget used" sub-line = `label`/`muted-foreground`, over = `warning-foreground`; column headers = `table-header-cell` (overline). Empty "No phases yet" = `body`/`muted-foreground`. **No blue pill.**

**Data delta (eng-planner, blocking):** the Projects-list query must additionally return **committed spend per project**, batched (no N+1, NFR-DEL-PERF-001). The committed basis is fixed: Σ `procurements.total_value` where `status ∈ {Ordered, Received, Vendor Invoiced, Paid}` — the exact `getProjectCommittedSpend` / `get_finance_budget_review` (0022) / `0009_dashboard_margin.sql` basis. **Never read `projects.spent`** (stored, DEFERRED, 0001:79). Mirror the `get_projects_delivery(p_ids uuid[])` RPC shape: add `get_projects_committed(p_ids uuid[]) returns table(project_id uuid, committed numeric)` (security-invoker, RLS-scoped) + a `useProjectsCommitted(ids)` hook, OR extend the existing delivery RPC to also return committed. eng-planner picks; both satisfy the NFR. See OPEN-Q-A3.

**States:** has-delivery / no-milestones (Progress = "No phases yet") / committed=0 (Budget 0%) / over-threshold (warning) / loading (skeleton bar) / table @≥768px + card reflow <768px (Progress bar + "Budget used %" become `<dl>` rows — see mockup narrow rendition).

`[AC-TOUCH]` **AC-DEL-013** (Unit, `components/__tests__/DeliveryPctChip.test.tsx` + Projects test): the chip is removed from the list, so "no chip when no milestones" becomes "Progress reads 'No phases yet' when no milestones". The intent (no delivery figure shown when none exists) is preserved; update the assertion to the new affordance. `DeliveryPctChip` survives only on the dashboard (OPEN-Q-A4) — keep its unit test there.

---

### R2 — Milestone strip → horizontal phase stepper (now weight-proportional, D2)
**Findings:** F-DEL-06 (Critical IA/visual), F-DEL-09, F-DEL-13.
**Decision:** restructure `MilestoneStrip` from `flex flex-col gap-3` of bordered cards into the DESIGN.md **Lifecycle / Stage Stepper** — a responsive row of phase nodes in `sort_order`, with **weight-proportional segment widths (D2)**:
- The node row is a CSS grid whose columns are weight-proportional (`grid-template-columns` built from each phase's `weight`, normalized). Each node: `jbar` (6px `secondary` track) filling by effective-% + phase name + effective-% headline + "From tasks N%" muted line + target date ("Target DD Mon", OR-2) + a muted "N% of project" weight caption (D2) + the per-phase "Edit progress" affordance (D1).
- **done** (effective=100) → `jbar` fill `success`, name `foreground`/600.
- **current** (first phase with effective<100) → `jbar` fill `primary`, name `foreground`/600, "Current" marker.
- **at-risk** (R5) → `jbar` fill `warning` + Overdue pill.
- A **cumulative weighted "Project delivery" track** (D2) renders once below the node row: weight-proportional segments each inner-filled by completion%, with the 48% rollup figure beside its caption. This *replaces* the ad-hoc per-node rollup derivation — the rollup is shown once, and the track shows it is the weighted sum.
- Section heading uses the named `subheading` token (fixes F-DEL-09's `text-[14px]` vs Tasks' `text-[16px]` mismatch — both become the shared heading).
- Per-phase delete moves into a per-node `⋯` popover (DESIGN.md `#rowmenu` overlay token), removing the 8-always-visible-icons density (F-DEL-13). Delete keeps its excellent `ConfirmDialog` copy verbatim. (Edit is now the quiet per-node "Edit progress" link, D1.)

**Rationale:** an EPC phase sequence is ordered and directional; the stepper communicates sequence + current phase + completion at a glance in ~1/3 the vertical space, and the weight-proportional widths add "how big is this phase" for free (D2). DESIGN.md already ships this primitive for budget-version + deal-stage journeys; delivery phases are its textbook use.

**Tokens:** Stage Stepper (`jbar` 6px / `secondary` track / `success` done / `primary` current / `warning` at-risk); **segment width = layout (grid `fr` from `weight`), NOT a color token** (D2 — zero palette invention); weight caption = `overline` (11px) / `muted-foreground`; cumulative track = same `jbar` colors on weight-proportional flex segments; rollup value = page-title/KPI 23px/700 `tabular`; node name = `body`/600; date = `label`/`muted-foreground` ("Target DD Mon"); overdue date = `warning-foreground`/600; per-node `⋯` menu = `#rowmenu` overlay; "Edit progress" link = `primary` text, `overline`/11px, quiet at rest.

**Responsive:** desktop (≥768px) = horizontal weight-proportional stepper + cumulative track; **<768px = thin vertical rows** (bar + name + effective-% + an explicit "N% of project" weight LABEL — the D2 mobile fallback, since narrow segments fail readability/tap at 375px), NOT chunky cards (see mockup narrow rendition). Single-render via `useIsDesktop()` (768px, the established DataTable-reflow breakpoint) so one branch is in the DOM (no `aria-hidden` doubling). Each mobile row's edit affordance is a 44px target (D1).

`[AC-TOUCH]` **AC-DEL-008 / AC-DEL-009** (Unit, `MilestoneStrip.display.test.tsx`): currently assert "From tasks" + "PM input" as two side-by-side cells reading "60%"/"75%" and "—"/"—". The redesign leads with effective-% as the headline and shows "From tasks N%" as a muted secondary line beneath (OR-1: no "Manual" badge in the DOM). Preserve the oracle (calculated value is surfaced; null renders "—"; effective % is visible) but update the DOM-shape assertion to the new readout: effective-% headline element + "From tasks N%" muted line. The goal (both values legible) is intact; the shape changes. Deliberate UX change, allowed per BDD rule.

---

### R3 — Effective-% leads; "From tasks" muted beneath; no pill; token-correct inline edit; one shared phase header; per-phase edit (D1)
**Findings:** F-DEL-07 (Important IxD), F-DEL-08 (Important a11y), F-DEL-18 (Important visual), F-DEL-19.
**Superseded by OR-1 (owner review 2026-06-11): the "Manual" badge is removed entirely. Extended by D1 + D3 (second review 2026-06-12).**

**Decision:**
- **Readout (OR-1 applied):** the phase's **effective %** is the primary figure (drives the bar), rendered as a headline number. Directly beneath, a muted `text-[11px]`/`muted-foreground` secondary line reads "From tasks N%". When `input_pct` is set and differs from `calc_pct`, the juxtaposition of the two numbers IS the divergence cue — no pill, no badge required. When effective == calculated (no override), "From tasks N%" is still shown for consistent rhythm (the numbers just match). A `title` tooltip "Set by PM" may be added to the effective-% element when `input_pct` is set, but this is the maximum marker; the default is no visible badge at all.
- **Per-phase edit (D1, second review):** the "Edit progress" affordance is present on **every** phase node for PM/Admin (the spec permits editing any milestone's `input_pct`), not only the current phase. It is a quiet `primary`-text link/pencil that recedes at rest (`opacity:~0.55`) and lifts to full opacity on `:hover` / `:focus-within` / `:focus-visible`, but is **always rendered in the DOM** so every phase is keyboard-reachable in focus order. Engineer role: the affordance is **omitted** entirely (read-only path, FR-DEL gating preserved). One link per cell on its own quiet line below the meta — no per-cell clutter.
- **Inline edit (F-DEL-08):** replace the raw `<input className="w-16 rounded ... focus:ring-1">` with the **`input` token** (32px height, `rounded-md` 8px, `input` border, global `:focus-visible` 2px/2px ring). Keep the good interaction: click-to-edit (opened by any phase's "Edit progress"), Enter commits, Esc cancels, blur commits, toast on success (OD-UX-1), `classifyMutationError` on failure, blank → `input_pct: null` (FR-DEL-009 clear).
- **Shared component (F-DEL-18):** extract one presentational `MilestonePhaseHeader` reused by (a) the stepper node (full variant — name + "Target DD Mon" + effective-% headline + "From tasks N%" muted + "N% of project" weight caption + Edit-progress), (b) the Tasks-tab group header (compact variant — **name + "Target DD Mon" only, NO % per D3**), (c) any modal context. This kills the triple-divergence and is the **Storybook entry** for the feature (charter Phase-3 component-library hook) with a state matrix: loading / empty / divergence / 0 / 100 / overdue / null-calc / weight-render.
- **Ungrouped (F-DEL-19):** "No milestone" label at adequate contrast, not 12px italic-muted.

**Tokens:** effective figure = `body`/700 `tabular`; "From tasks N%" line = `overline` (11px) / `muted-foreground`; weight caption = `overline` (11px) / `muted-foreground` (D2); "Edit progress" link = `primary` text / `overline` / quiet-at-rest (D1); inline field = `input` component token; tooltip (optional, max marker) = `#tip` overlay token. **No badge-status token used for divergence** (OR-1 removes it).

**States:** input-set (effective headline differs from "From tasks" secondary — divergence visible by contrast) / input-null (calc shown plain; if calc also null: "From tasks —") / editing / error / saving / PM-or-Admin (edit shown on every phase) / Engineer (no edit affordance, all phases).

`[AC-TOUCH]` **AC-DEL-012** (Unit, `MilestoneStrip.inlineEdit.test.tsx`): PM sees the editable field, Engineer sees static. Preserved exactly — and **strengthened**: the test should now assert the "Edit progress" affordance appears on **every** phase for PM/Admin (D1) and on **none** for Engineer, not just the current phase. Only the field's classes/markup change (now the `input` token); the role-gated visibility oracle is preserved and broadened to all phases.

---

### R4 — Purpose-built empty state
**Finding:** F-DEL-10. **Decision:** replace the generic `ListState inbox / "No milestones yet"` with a planning prompt: faded **weighted-width** stepper silhouette + "Plan this project's delivery phases" + sub-copy (mentions each phase carries a weight) + the PM/Admin-gated "Add the first phase" CTA. Non-PM sees a quiet "No delivery phases yet" line (FR-DEL-013 role gating — **preserved exactly**, it is correct in the shipped build).
**Tokens:** silhouette = `secondary` bars (weight-proportional widths); heading = `subheading`/700; sub = `body`/`muted-foreground`; CTA = `button-primary`.
`[AC-TOUCH]` **AC-DEL-014** (Unit, `MilestoneStrip.states.test.tsx`): loading/empty/error. The empty branch's testid (`milestone-strip-empty`) and the PM-gated "Add a milestone" CTA presence/absence are preserved; only the empty's internal markup changes. Keep the loading skeleton + error+retry untouched.

---

### R5 — At-risk milestone state (no gating)
**Finding:** F-DEL-12. **Decision:** define **at-risk milestone** = `target_date < today AND effective_pct < 100`. Render: `jbar` fill `warning` + an "Overdue" `warn` pill on the node + the target date in `warning-foreground`. **No progression gating** (OD-DEL-6 preserved — this is a visual risk cue only). Pure additive derived state (computed client-side from existing fields; no schema/RPC change). The "Overdue" pill is a risk cue (at-risk state), distinct from the divergence cue (OR-1 removes the latter entirely).
**Tokens:** `warning` / `warning-foreground` (existing). Date overdue = `warning-foreground`/600.
**States:** at-risk / on-track / no-target-date (never at-risk). New small unit test recommended (not an existing AC): "a phase past target with <100% renders the overdue treatment" — additive coverage, not an AC change.

---

### R6 — Milestone modal: drop raw `sort_order`, explain `weight`, tidy field order
**Findings:** F-DEL-14, F-DEL-15, F-DEL-16, F-DEL-17.
**Decision:**
- **`sort_order` (F-DEL-14):** remove the visible field; server-default to append (`max(sort_order)+1`) on create. Reordering is deferred (OPEN-Q-A1) or added later via stepper up/down. If owner wants it visible for v1, label "Display order" + helper + auto-suggest next.
- **`weight` (F-DEL-15):** add helper text "Heavier phases count more toward project delivery %. Equal weights = equal share." Show each phase's **live share %** in the helper — this is now doubly important because the stepper renders that share as segment width (D2), so the modal's live share preview lets the PM predict how wide the phase will be.
- Field order becomes: name / target_date / weight (+ input_pct on edit). `input_pct`-on-create stays out (F-DEL-16, defensible).
**Tokens:** `TextField` primitives unchanged (already token-correct); helper text = `label`/`muted-foreground`.
**Note:** dropping the `sort_order` field is FE-only IF the DAL defaults it; eng-planner confirms the create path appends. No AC asserts the `sort_order` field's presence — safe.

---

### R-date — Format target dates + overdue cue
**Finding:** F-DEL-11. Format `target_date` as "Target DD Mon" (OR-2: full word "Target", not "Tgt") everywhere it renders (stepper, tasks-group header, modal preview). Past-target + incomplete → `warning-foreground` (feeds R5). Pure formatting; uses the app's existing date formatter.

---

## Responsive — binding pill rule (OR-3)

**Binding implementation requirement for ui-implementer:** every pill and chip in the delivery feature must be verified at 375px viewport width. The rule:

- All `.pill` / status chip elements: `flex-shrink: 0; white-space: nowrap` — the fill background must fully encapsulate the text at all viewport widths.
- Their flex-row parent: `min-width: 0` on any sibling that can shrink (e.g. project name, phase name) so the pill is never the element that compresses.
- Adequate horizontal padding: `padding: 0 9px` minimum for standard pills.
- Rows that mix text + pills must use `flex-wrap: wrap` or `min-width: 0` sibling discipline so a pill is never squashed.

**Verification gate:** the ui-implementer must screenshot the delivery surfaces at 375px (Playwright viewport override or DevTools) and confirm no pill clips its background **and** that the D2 weight-width fallback (explicit "N% of project" labels, 44px edit targets) renders before the `/design-review` gate.

---

## Per-file component-delta (precise, for the implementer)

| File | Change | Findings | AC impact |
|---|---|---|---|
| `pmo-portal/pages/Projects.tsx` | `progress` column: value = delivery-% (`delivery?.[p.id]`) not `utilizationPct`; threshold-coloured bar; "No phases yet" when null. **New `budget` column "Budget used"** = committed/budget (from new committed hook), warning sub-line over threshold. **Remove** the title-line `<DeliveryPctChip>` (L240-242). Drop `utilizationPct` reading `p.spent`. | F-DEL-01a/01b/02/03/04 | `[AC-TOUCH]` AC-DEL-013 |
| `pmo-portal/src/lib/db/projects.ts` (or new RPC) | **(eng-planner)** Projects list must return committed-spend per project, batched (committed basis, never `projects.spent`). New `get_projects_committed(p_ids)` invoker RPC OR extend `get_projects_delivery`. | F-DEL-01b | — (new pgTAP for the committed oracle recommended) |
| `pmo-portal/src/hooks/useProjectsCommitted.ts` (new) OR extend `useProjectsDelivery` | One batched call for the page's project ids; `{ [id]: committed }` map; disabled when ids empty; staleTime mirrors delivery hook. | F-DEL-01b | — |
| `pmo-portal/pages/project-detail/MilestoneStrip.tsx` | Card stack → **Stage Stepper** with **weight-proportional segment widths (D2)**: grid `grid-template-columns` built from each phase's `weight` (normalized to `fr` units); per-node muted "N% of project" weight caption; a **cumulative weighted "Project delivery" track** below the nodes (weight-proportional segments inner-filled by completion%, with `aria-label`). Single rollup header; per-node `⋯` menu (delete); **"Edit progress" affordance on EVERY node for PM/Admin (D1)**, quiet (opacity at rest → full on hover/focus), always in DOM, omitted for Engineer; effective-% headline + "From tasks N%" muted line (no Manual badge — OR-1); dates as "Target DD Mon" (OR-2); token-correct inline `input`; named `subheading`; at-risk state; responsive thin-rows <768px with **explicit "N% of project" weight LABEL fallback (D2 mobile)** + 44px edit targets; pills `shrink-0`/`whitespace-nowrap` (OR-3). | F-DEL-06/07/08/09/12/13 + R4 empty + D1 + D2 | `[AC-TOUCH]` AC-DEL-008/009/012/014 |
| `pmo-portal/components/MilestonePhaseHeader.tsx` (new, shared) | Presentational: **full variant** (stepper) = name + "Target DD Mon" + effective-% headline + "From tasks N%" muted + "N% of project" weight caption + per-phase Edit-progress slot (D1/D2); **compact variant** (tasks-tab) = name + "Target DD Mon" only, **NO %** (D3). Storybook state-matrix entry (incl. weight render + per-phase edit visibility by role). | F-DEL-18 | new unit coverage |
| `pmo-portal/pages/project-detail/tabs/TasksTab.tsx` | Group header (L730-744) uses `MilestonePhaseHeader` compact variant: name + "Target DD Mon" **only — NO percentage at all (D3, supersedes OR-4)**. Remove the `bg-primary/10` %-pill entirely. "No milestone" label instead of italic-muted "Ungrouped". | F-DEL-18/19/20 | `[AC-TOUCH]` AC-DEL-010/015-FR-015 (heading now shows name+date only) |
| `pmo-portal/pages/project-detail/MilestoneFormModal.tsx` | Remove visible `sort_order` field (or relabel + helper); `weight` helper text + **live share %** (now feeds the stepper width, D2); field-order tidy. | F-DEL-14/15/16/17 | none assert these fields |
| `pmo-portal/components/DeliveryPctChip.tsx` | **Fate:** survives only on PM dashboard (S6). Restyle to neutral `badge-status` OR replace with a mini-bar (OPEN-Q-A4). Remove its `bg-primary/10 text-primary`. | F-DEL-04/21 | AC-DEL-013 moves to dashboard context |
| `pmo-portal/src/components/dashboard/PMDashboard.tsx` | Row delivery figure = restyled chip / mini-bar (neutral, not blue), de-densify the pill cluster. | F-DEL-21/04 | — |
| `pmo-portal/src/lib/format.ts` (consume) | Use the existing date formatter for `target_date` everywhere; output format "Target DD Mon". | F-DEL-11 | — |

---

## Data the FE needs for D2 (weight rendering) — no new backend work

The weight-as-width treatment needs **only the per-phase `weight` already stored on `project_milestones`** (OD-DEL-5; the rollup `Σ weight×eff / Σ weight` already uses it). No schema, RPC, or query change for D2:

- **Each milestone's `weight`** (already returned by the milestone list the strip consumes). The component normalizes the set to grid `fr` units (`weight_i / Σweight × 100` → either the `fr` track value directly, or the cumulative-track segment flex-basis %).
- **Each milestone's `effective_pct`** (already derived: `input_pct ?? calc_pct ?? 0`) — drives both the per-node fill and the cumulative-track segment fill.
- **The per-cell "N% of project" caption** = `weight_i / Σweight × 100`, rounded, computed client-side from the same data. No new field.

So D2 is a **pure ui-implementer change** (presentation of data already on hand). The only eng-planner-blocking data delta in this plan remains R1's committed-spend (OPEN-Q-A3), unchanged.

---

## Tokens — exact map (every visual decision names a DESIGN.md token; no literals)

| UI piece | DESIGN.md token |
|---|---|
| Projects "Progress" bar | `ProgressBar` (7px `secondary` track; fill `success`/`warning`/`destructive` by threshold; neutral `primary` otherwise) |
| Projects "Budget used" bar + sub | `ProgressBar`; sub-line `label` + `muted-foreground`; over = `warning-foreground` |
| "No phases yet" / empty copy | `body` + `muted-foreground` |
| Phase stepper bars | Stage-Stepper `jbar` (6px, `secondary` track; `success` done / `primary` current / `warning` at-risk) |
| **Phase segment WIDTH (weight, D2)** | **Layout only — grid `fr` tracks from each phase's `weight`. NOT a color/size token (zero palette invention); uses existing spacing/gap scale (`spacing.2`/`spacing.3`).** |
| **Cumulative weighted "Project delivery" track (D2)** | Same `jbar` color set (`success`/`primary`/`warning` per phase state) on weight-proportional flex segments; track height = existing 7–8px bar; `aria-label` describes weights + completion |
| **Per-cell weight caption "N% of project" (D2)** | `overline` (11px) / `muted-foreground` + `tabular`; muted, never blue |
| "Current" marker | `overline` + `primary` |
| Rollup delivery value | KPI headline 23px/700 + `tabular` |
| Phase name | `body` (14px) / 600 |
| Phase / task date | `label` (12px) / `muted-foreground` ("Target DD Mon"); overdue → `warning-foreground`/600 |
| Effective-% headline figure | `body` / 700 + `tabular` |
| "From tasks N%" secondary line | `overline` (11px) / `muted-foreground` + `tabular` |
| Divergence cue | Two-number juxtaposition only — no badge, no pill (OR-1) |
| **Per-phase "Edit progress" affordance (D1)** | `primary` text / `overline` (11px); quiet at rest (`opacity ~0.55`) → full on `:hover`/`:focus-within`/`:focus-visible`; always in DOM; PM/Admin only; mobile = 44px touch target |
| Optional PM-set tooltip | `#tip` overlay (dark surface / near-white text); `title` attribute fallback |
| Overdue pill (at-risk cue) | tinted-status `warn` (warning @16% + `warning-foreground` + 6px dot) + `flex-shrink:0`/`white-space:nowrap` (OR-3) |
| Inline edit field | `input` component (32px / `rounded-md` 8px / `input` border / global 2px focus ring) |
| Phase `⋯` menu | `#rowmenu` overlay (popover bg / border / 8px / overlay shadow) |
| **Tasks-group header (D3)** | name = `body`/700; date = `label`/`muted-foreground` "Target DD Mon"; `flex-shrink:0`/`white-space:nowrap` (OR-3). **NO percentage element at all** (D3 supersedes OR-4) |
| Section heading | `subheading` (18/600) |
| All %/figures | `tabular-nums` (mandatory) |
| All pills / chips | `flex-shrink:0; white-space:nowrap` on element + `min-width:0` on shrinkable sibling (OR-3) |

**New tokens required: NONE.** at-risk = `warning`; stepper states = `success`/`primary`/`warning`; **weight = layout (segment width) + a muted `overline` caption — no new color, size, or font** (impeccable identity-preservation rule + DESIGN.md "Don't introduce a second brand color/font/border"). Identity preserved; zero palette/font invention.

---

## WCAG-AA / a11y

- **Contrast (measure in render, F-DEL-A3):** effective-% and "From tasks N%" figures, the "N% of project" weight caption, the "Budget used" sub-line, and any muted number on `secondary`/tint must clear **4.5:1**. `muted-foreground` is L40% (DESIGN.md AA-tuned) — verify the small muted numbers on the `bg-secondary/30` group header and stepper, and the weight caption specifically. Warning/overdue text uses `warning-foreground` (deep brown, AA on amber tint — preserve, never the base hue).
- **Stepper semantics:** the stepper is an ordered list of phases — use `<ol>`/`<li>` (or `role="list"`) with each node's accessible name = "Phase: {name}, {effective}% complete, {weight}% of project, target {date}{, overdue}". Current phase carries `aria-current="step"`. The cumulative weighted track carries a single `aria-label` summarizing each phase's weight + completion (so weight is never width-only — color-not-only / `pattern-texture`, ui-ux-pro-max §1/§10).
- **Per-phase edit (D1):** every phase's "Edit progress" trigger is a real `button` with `aria-label="Edit progress for {name}"`, present in DOM (keyboard-reachable) even while visually quiet; PM/Admin only. The field is a labelled `input` (`aria-label`); the global focus ring applies; Enter/Esc/blur keyboard paths preserved.
- **Focus order:** rollup → each phase node (name → effective-% → "Edit progress" → `⋯`) in order → cumulative track (non-interactive, `img` role) → strip CTA. The `⋯` popover is keyboard-openable and Esc-closable.
- **Color is never the only cue:** at-risk carries the "Overdue" pill text + the date color (not just the amber bar); weight carries the segment width + the explicit "N% of project" text caption (not width alone); PM override divergence is cued by the two differing numbers in text.
- **Touch targets <768px:** the thin-row stepper edit affordance is a ≥44px target (`.touch-target` / 44px button); the weight is an explicit text label (the D2 mobile fallback for un-tappable narrow segments).

## Responsive breakpoints

| Breakpoint | Behavior |
|---|---|
| ≥768px | Projects = `<table>`; stepper = **weight-proportional horizontal nodes** + cumulative weighted track (D2); "Edit progress" link on every node (D1). |
| <768px | Projects = stacked `<dl>` cards (Progress bar + "Budget used %" as rows); stepper = thin vertical rows (bar + name + effective-% + **explicit "N% of project" weight label, D2 fallback**), NOT chunky cards; 44px per-row edit target (D1). Single-render via `useIsDesktop()` (768px). All pills `shrink-0` + `whitespace-nowrap` (OR-3). |
| 920px | Rail-collapse (unchanged, app-wide). |

---

## Acceptance additions (fold into the fix issue's AC list — taste required-states/a11y)

- All four states of the stepper render: loading skeleton, empty (PM CTA vs non-PM quiet line), error+retry, populated.
- Divergence is visible: a phase with `input_pct` set (e.g. 75%) and a differing `calc_pct` (e.g. 40%) shows the effective % as the headline and "From tasks 40%" muted beneath. No badge or pill accompanies the divergence.
- **Weight is legible (D2):** at ≥768px each phase segment's width is proportional to its weight and a muted "N% of project" caption shows the exact share; the cumulative weighted track's filled area equals the rollup. At <768px each row shows an explicit "N% of project" label. A 100%-complete-but-low-weight phase reads as narrow-and-filled; a high-weight-barely-started phase reads as wide-and-empty.
- **Edit-progress on every phase (D1):** for PM/Admin, every phase node exposes an "Edit progress" affordance that is keyboard-reachable; for Engineer, no phase exposes it. Editing any phase (not just current) opens the token-correct inline field.
- At-risk: a phase past target + <100% shows the overdue treatment; not past / =100% does not. No gating (a later phase can still advance).
- Projects list: Progress = delivery-%; no-milestone row shows "No phases yet" and NO delivery chip; "Budget used" sources committed spend, never `projects.spent`.
- **Tasks-tab group header reads "{name} · Target {DD Mon}" — NO percentage at all (D3).** No "Manual" label, no calculated number, no effective %.
- All date labels read "Target DD Mon" — no "Tgt" abbreviation anywhere.
- At 375px: every pill (At risk, Overdue, status pills) fully encapsulates its background fill; no pill clips or overflows its row; the D2 weight labels + 44px edit targets render. Verified by screenshot at 375px before `/design-review` merge gate.
- AA contrast measured on every muted figure on a tint (render check), including the weight caption.
- Keyboard: full stepper traversal + per-phase "Edit progress" (D1) + inline edit (Enter/Esc/blur) + `⋯` popover (open/Esc) reachable; focus visible throughout.
- No DESIGN.md token added; no raw hex/px in the diff (every value names a token; weight width is layout, not a color/size literal).
- `/design-review` (rendered screenshot audit) passes before merge — the gate that was skipped.

---

## PI-review fixes — applied 2026-06-12

Eight fixes from the PI mockup review (`docs/design/delivery-mockup-pi-review.md`). All applied to `docs/design-mockups/delivery-redesign.html`. No source-code changes (read-only constraint). Tag balance verified; all fixes confirmed against the file.

| # | Finding | Fix applied | Verified |
|---|---|---|---|
| PI-1 | **CRITICAL math:** rollup 48% was inconsistent with visible weights/completions (49.25%). Re-based on real SP-2401 demo data: Engineering 100%, Procurement 71%, Construction 25%, Commissioning 0%; weights 15/35/40/10. **Math:** (15×100 + 35×71 + 40×25 + 10×0) / 100 = (1500+2485+1000+0) / 100 = 4985/100 = 49.85 → **50%**. Headline, cumulative track, mobile rollup, aria-label, and comments all set to 50%. | ✓ |
| PI-2 | **Missing states:** loading skeleton stepper, error+retry, delete-confirm ConfirmDialog, and Engineer read-only stepper (no Edit progress affordances) were described but not rendered. All four now have explicit rendered sections. | ✓ |
| PI-3 | **Non-token literals:** `color:#fff` → `hsl(var(--primary-foreground))`; overdue pill inline `height:18px`/`padding:0 7px` → standard `.pill` token (22px / 0 9px); mobile header `font-size:15px`/`18px` → `subheading` (18px) + KPI rollup (23px); mobile `padding:12px 14px` → `12px 16px` (s3/s4); `height:28px` button overrides → 32px standard. | ✓ |
| PI-4 | **Ongoing pill green:** changed from `.pill.won` (green) to `.pill.open` (blue/neutral). Matches real `pillVariantForProjectStatus('Ongoing Project') === 'open'`. Green reserved for Done/Won/Close Out. | ✓ |
| PI-5 | **Budget basis ambiguous:** basis locked to **committed ÷ budget** (owner decision). Column label = "Budget used"; subline = "$X of $Y budget" (not "contract"). Mobile shows full "$X.XM of $Y.XM budget" subline — never a bare percentage. | ✓ |
| PI-6 | **One-Blue violation:** SP-2401 project icon tile changed from `hsl(var(--primary))` (blue) to `hsl(var(--violet))` (categorical violet). Blue reserved for interactive only (One-Blue Rule). | ✓ |
| PI-7 | **Mobile target dates dropped:** each mobile `vstep` row now includes a muted `.vdate` "Target DD Mon" line; overdue row shows target date in `warning-foreground` token. | ✓ |
| PI-8 | **Prior refinements preserved:** no Manual pill, Target spelled out, pill encapsulation at 375px (shrink-0/nowrap/min-width-0), tasks-tab header = name+target only (no %), Edit progress on every phase for PM/Admin, weight-as-segment-width + "N% of project" caption + cumulative track. All verified intact. | ✓ |

---

## Open questions for the owner (carried from the audit)

1. **OPEN-Q-A1 (reorder UI):** append-only for v1 (drop `sort_order` field) vs build stepper reorder now. Recommend append-only; reorder additive.
2. **OPEN-Q-A2 (budget basis):** "Budget used" = committed/**budget** or committed/**contract**? Recommend `/budget` (matches the at-risk threshold logic already in `isAtRisk`/`budgetUtilPct`).
3. **OPEN-Q-A3 (committed data path):** new `get_projects_committed` RPC vs extend `get_projects_delivery` vs extend `listProjects`. eng-planner decides; mirror the delivery RPC shape. **This blocks a pure ui-implementer fix — eng-planner is required.** (Note: D2 weight rendering does NOT add to this — weight is already on `project_milestones`.)
4. **OPEN-Q-A4 (DeliveryPctChip fate):** on the dashboard, keep a restyled neutral chip vs a mini-bar. Recommend mini-bar (magnitude legibility); retire the pill.
