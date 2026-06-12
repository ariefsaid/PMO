# Delivery-milestones (spine 3) — comprehensive 3-lens design audit

- **Date:** 2026-06-12
- **Auditor:** design-architect (Director-dispatched)
- **Scope:** the WHOLE delivery-milestones feature (spec `docs/specs/delivery-milestones.spec.md`, 21 FRs / 22 ACs; plan `docs/plans/2026-06-11-delivery-milestones.md`; decisions OD-DEL-1..8). Built + merged in PR #74 **without** the binding pre-build design gate (CLAUDE.md §1a / `docs/design-workflow.md` §1a) or the post-build `/design-review`. This audit is the retroactive 3-lens pass.
- **Authority:** `DESIGN.md` is the token / identity authority. No new brand, palette, or font is proposed. One token-naming question is flagged for owner sign-off (F-DEL-A12).
- **Lenses (per `docs/design-workflow.md` §2.3):** (1) Visual / DESIGN.md fidelity; (2) IxD / task-flow (Nielsen + cognitive-load); (3) IA / structure-navigation (one canonical view per entity, ADR-0021).

> **Render-verification status (read this first).** This session had **no browser/render access** (no `chromium-cli`, no loaded browser MCP, Bash tool not exposed). Every finding below is grounded in the **source as merged** — exact classNames, the data-flow, and the spec — which is sufficient to catch token/IA/IxD defects with high confidence (these are structural, not pixel-subjective). **Findings tagged `[RENDER-CONFIRM]` need a one-pass live screenshot check** by the design-reviewer (login `pm@acme.test` / `engineer@acme.test` at https://pmo-bfb.pages.dev, desktop 1440 + mobile 375) before they are closed. They are correctness-confident from code but their *severity* (e.g. exact whitespace, measured contrast) wants a render. The redesign mockup (`delivery-redesign.html`) is itself the visual target and can be diffed against the live app once rendered.

---

## Executive summary — themes

The feature is **functionally complete and passes its 22 ACs**, but it shipped without the design gate, and the audit surfaces **one Critical IA contradiction, two Critical data-correctness/UX defects, and a cluster of Important structure/token issues** that a pre-build mockup round would have caught. Four themes:

1. **Two contradictory "progress" numbers on the Projects list (Critical, IA + data).** The row shows a `spent/contract_value` **"Progress"** bar (reading the *stored, deferred, never-maintained* `projects.spent` column — `0%` for almost every project) AND a separate **delivery-% chip** buried on the project's code line. Two numbers labelled/implied as "progress", neither correct in isolation, visually competing. This is the canonical "one canonical view per entity" violation: the list contradicts itself. **Compounding data defect:** even the spend basis is wrong — `projects.spent` is the migration-0001 stored column explicitly marked `DEFERRED` (0001:79), disconnected from real procurement; the correct committed-spend basis already exists (`getProjectCommittedSpend`, `procurements` Σ where status ∈ Ordered/Received/Vendor-Invoiced/Paid — the same basis as `get_finance_budget_review` / migration 0022).

2. **The "milestone strip" is not a strip — it's a vertical stack of full-width bordered cards (Critical, IA + visual).** An EPC phase sequence (Engineering → Procurement → Construction → Commissioning) is an **ordered, directional** thing. The build renders it as `flex flex-col gap-3` of full-width `rounded-md border` cards, each ~7 rows tall (name row, progress bar, two-column %). For a 4-phase project that is a tall, whitespace-heavy column that buries the project below the fold and reads as "list of unrelated items", not "a sequence with a current phase". DESIGN.md already ships the right primitive: the **Lifecycle / Stage Stepper** (§5 "signature"), used for budget-version lifecycle and the deal-stage journey. Delivery phases are the textbook use for it and it was not used.

3. **Token-fidelity drift from hardcoded values where DESIGN.md names a token (Important, visual).** The feature hardcodes `text-[11.5px]`, `text-[13px]`, `text-[14px]`, `bg-primary/10` pills, ad-hoc `rounded` (not the scale), and a raw `<input type=number>` with bespoke focus rings, instead of the named type ramp (label/overline/body/mono), the `StatusPill`/`badge-status` component, and the shared field primitives. Individually minor; collectively this is exactly the "every visual decision should name a token" rule the design-plan exists to enforce. The inline-edit input in particular bypasses the `input` component spec (32px / 8px radius / `input` border / global focus ring) for a `w-16 ... rounded ... focus:ring-1` one-off.

4. **The two-column "From tasks / PM input" model is under-explained and the divergence is invisible (Important, IxD / cognitive-load).** Both columns are rendered as bare overline-label + number with no relationship cue. A PM seeing `From tasks 40%` next to `PM input 75%` gets no signal that **PM-input wins** (is authoritative) and overrides the calculated figure, nor why they differ. The progress bar silently reflects `effective_pct` (= input when set) with no indication which source drove it. This is the feature's core concept and it's the least legible part.

**Disposition recommendation:** this warrants a **follow-up UI-fix issue** (not a revert). The redesign mockup (`docs/design-mockups/delivery-redesign.html`) is the owner-approval artifact; the design-plan (`docs/design/delivery-redesign-plan.md`) is the build spec. The Critical data defect (F-DEL-01b, wrong spend basis) additionally needs a data-layer change (Projects-list query must return committed-spend per project), so eng-planner is in the loop, not just ui-implementer.

### Findings by severity

| Severity | Count |
|---|---|
| Critical | 4 |
| Important | 9 |
| Minor | 7 |
| **Total** | **20** |

One-line resolution per major (Critical/top-Important) finding is in the table at the very bottom and fully specified in the design-plan.

---

## Surface inventory (every UI surface + state the feature introduces)

Enumerated from spec §Scope-IN + verified against the merged code:

| # | Surface | File | States it must render |
|---|---|---|---|
| S1 | Projects list — delivery chip + "Progress" column | `pages/Projects.tsx` (cols `progress` L296-322, chip L240-242) | has-milestones / no-milestones (no chip) / at-risk / 0% / 100% / loading / error / empty; table @≥768px + card reflow <768px |
| S2 | Project detail — milestone "strip" | `pages/project-detail/MilestoneStrip.tsx`; mounted `ProjectDetail.tsx` L136-139 | loading / empty(PM vs non-PM) / error+retry / populated / inline-edit open / divergence (calc≠input) / 0% / 100% / null calc ("—") |
| S3 | Milestone create/edit modal | `pages/project-detail/MilestoneFormModal.tsx` | create / edit / validation errors (name/weight/input_pct) |
| S4 | Milestone delete confirm | `MilestoneStrip.tsx` L166-175 (`ConfirmDialog`) | open / loading |
| S5 | Tasks tab — milestone grouping | `pages/project-detail/tabs/TasksTab.tsx` L674-780 | grouped / ungrouped-trailing / empty-group / add-in-group / board view (ungrouped) |
| S6 | PM dashboard — delivery chip | `src/components/dashboard/PMDashboard.tsx` L136-137 | has/none per row, alongside at-risk + status + margin |
| S7 | `DeliveryPctChip` primitive | `components/DeliveryPctChip.tsx` | null→nothing / value→pill |
| S8 | Inline PM-input edit | `MilestoneStrip.tsx` L279-327 (`MilestoneRow`) | static(role-gated) / editing / error / save / blank-clears |

---

## S1 — Projects list (chip + "Progress" column)

### F-DEL-01a — TWO competing progress numbers on one row [Critical · IA]
`pages/Projects.tsx`: the `project` cell (L240-242) renders `<DeliveryPctChip>` on the code line; the `progress` column (L296-322) renders a `<ProgressBar value={utilizationPct(p)}>` where `utilizationPct = spent/contract_value*100` (L57-59). Two numbers, both reading as "how far along is this project", in different row regions, with no shared mental model. The chip says "delivery 100%" while the Progress bar says "0%" for the same project. This is a direct **one-canonical-view-per-entity** (ADR-0021) violation at the list level: the row contradicts itself.
**Resolution (see plan §R1):** make **delivery-%** the row's *progress* reading (it is what "progress" means to a PM/exec on a delivery list); move the **spend/budget** figure to a clearly-labelled financial column ("Committed" / "Budget used"), not "Progress"; retire the title-line chip (its value is folded into the now-meaningful Progress column). `[RENDER-CONFIRM]` the side-by-side competition at 1440px.

### F-DEL-01b — "Progress" bar is sourced from the wrong, stale, never-maintained column [Critical · data/visual]
`utilizationPct(p)` reads `p.spent` (the `projects.spent` stored column, migration `0001_init_schema.sql:79`, commented `-- DEFERRED: stored vs derived §14`). That column is **not linked to real procurement** and reads `0` for essentially every seeded project, so the bar renders an empty/green 0% that is simply false. The **correct** committed-spend basis already exists and is used by the dashboards: `getProjectCommittedSpend` (`src/lib/db/procurements.ts:29`) = Σ `procurements.total_value` where `status ∈ {Ordered, Received, Vendor Invoiced, Paid}` — the identical basis as `get_finance_budget_review` (migration 0022) and `0009_dashboard_margin.sql`'s `on_hand.spent`.
**Resolution (plan §R1 + §R7-data):** the Projects-list query must additionally return **committed spend per project** (sourced from the committed basis, batched — same N+1-avoidance shape as `useProjectsDelivery`); the financial column reads `committed / budget` (or `/ contract`), never the stored `spent`. This is a data-layer delta (eng-planner), not pure restyle. `[RENDER-CONFIRM]` not needed — provably wrong from source.

### F-DEL-02 — "Progress" header is ambiguous after the split [Important · IxD/copy]
Even before the fix, the column header literally reads **"Progress"** while showing a *spend* metric. "Progress" to a delivery audience means schedule/delivery progress, not budget burn. Naming collision with the delivery chip.
**Resolution:** rename the financial column to **"Budget used"** (or "Committed") and let **"Progress"** mean delivery; the at-risk budget sub-line (L314-318) moves under "Budget used".

### F-DEL-03 — Delivery chip is visually subordinate to the project code [Important · visual/IA]
The chip sits on the same line as the mono project code (`font-mono text-[11px] text-muted-foreground`) — i.e. the *least* prominent line of the cell. The single most strategic number on a delivery list (how done is this project) is placed in the metadata gutter.
**Resolution:** when delivery-% becomes the Progress column (R1), this resolves structurally — the figure gets a real column with a bar, not a gutter pill.

### F-DEL-04 — Chip pill uses `bg-primary/10 text-primary`, competing with The One Blue Rule [Important · visual]
`DeliveryPctChip` (L19) is a solid-ish blue-tinted pill. DESIGN.md's **One Blue Rule**: primary blue is reserved for *the one interactive action*; status/data uses the tinted-status pattern (dot + tinted pill with darkened text), and progress bars use the `success/warning/destructive`-by-threshold or neutral fill. A blue data pill on every project row spends the blue budget on non-interactive data and competes with real CTAs.
**Resolution:** delivery-% in the list becomes a `ProgressBar` (neutral/primary track per existing pattern) in the Progress column, not a blue pill. If a compact pill is still wanted on the dashboard (S6), use the neutral `badge-status` token, not `primary`.

### F-DEL-05 — Card-reflow (<768px) treatment of the chip/progress unspecified-by-design [Minor · responsive] `[RENDER-CONFIRM]`
DataTable single-renders to a stacked `<dl>` card list below 768px (DESIGN.md Nav/Mobile). The chip lives inside the `project` cell so it survives reflow, but the *Progress* column becomes a `label:value` row — a bar in a `<dl>` value needs a deliberate compact treatment. Verify the bar + new "Budget used" both read in the mobile card.

---

## S2 — Project detail "milestone strip"

### F-DEL-06 — Not a strip: vertical stack of chunky full-width cards (the lazy-card answer) [Critical · IA/visual]
`MilestoneStrip.tsx` renders `<div className="flex flex-col gap-3">` (L131) of `MilestoneRow`s, each a `rounded-md border border-border p-3` card with a header row, a full-width `ProgressBar`, and a two-column %-block (L226-330). For a 4-phase Solaris project this is a ~4×(3-row) vertical column consuming large header real estate, pushing the tabs far down, with heavy repeated whitespace. It does not communicate **sequence** or **current phase**. The spec itself calls it a "strip" (§FR-DEL-012) and OD-DEL-1 says "milestone **strip** in the header area"; the build is a card list. DESIGN.md ships the **Lifecycle / Stage Stepper** (§5, "horizontal journey tracker, equal-flex steps, 6px `jbar`, done=success / current=primary") expressly for this.
**Resolution (plan §R2):** restructure to a **compact horizontal stepper/strip** — phase nodes in `sort_order`, each with name + target date + a thin effective-% bar + the % figure, the "current" (first incomplete) phase marked per the stepper spec; the project delivery-% rollup shown once as the strip header. **Second review (D2):** the node segments are now **weight-proportional in width** (each phase's grid track ∝ its `weight`), with a quiet "N% of project" caption and a cumulative weighted track below — see the OR/D table and plan §D2. Per-phase edit/PM-input affordances are the quiet per-node "Edit progress" link (D1); delete moves into a popover. On mobile it becomes a condensed vertical list of *thin rows* (not chunky cards) with an explicit weight LABEL. `[RENDER-CONFIRM]` whitespace/height at 1440 + 375.

### F-DEL-07 — Two-column "From tasks / PM input" gives no authority/divergence cue [Important · IxD/cognitive-load]
`MilestoneRow` L258-328 renders two equal sibling columns, each `overline label + number`. Nothing tells the PM that **PM input overrides calculated** (effective = `input ?? calc ?? 0`, the feature's core rule), nor flags when they diverge. The bar reflects `effective_pct` with no badge for "manually set". `m-4` (L310-312) tints input `text-foreground` when set vs `muted` otherwise — a subtle cue, undocumented to the user.
**Resolution (plan §R3 — superseded by owner review 2026-06-11, OR-1; extended 2026-06-12, D1):** show the **effective %** as the headline number; directly beneath, a muted `text-[11px]`/`muted-foreground` "From tasks N%" line. When `input_pct` differs from `calc_pct`, the juxtaposition of the two numbers IS the divergence cue — no "Manual" pill or badge. A `title` tooltip "Set by PM" on the effective-% element is the maximum permitted marker. **D1 (second review):** the "Edit progress" affordance that opens the inline editor is now present on **every** phase for PM/Admin (the spec lets a PM edit any milestone's `input_pct`), not only the current phase — quiet (recedes until hover/focus), always in the DOM (keyboard-reachable), omitted for Engineer.

### F-DEL-08 — Inline-edit `<input>` bypasses the `input` component token spec [Important · visual/a11y]
`MilestoneRow` L283-297: a raw `<input type=number className="w-16 rounded border border-border bg-background px-1.5 py-0.5 text-[13px] ... focus:ring-1 focus:ring-primary">`. DESIGN.md `input` component = 32px height / 8px radius / `input` border / **global `:focus-visible` 2px ring at 2px offset** (single source of truth). This one-off uses `rounded` (4px, not the field's 8px), `focus:ring-1` (1px, not the 2px global ring), and a 24px-ish height (`py-0.5`) — three token violations on one element, plus a smaller-than-spec control.
**Resolution (plan §R3):** use the shared field primitive (or a `NumberField` matching the `input` token: 32px, `rounded-md`, `input` border, global focus ring). Keep the click-to-edit + Enter/Esc/blur interaction (that part is good, OD-UX-1 single-click + toast). `[RENDER-CONFIRM]` focus-ring parity.

### F-DEL-09 — Section heading is `text-[14px]` hardcoded, not the named ramp [Important · visual/type] `[RENDER-CONFIRM]`
L122: the "Milestones" heading is `text-[14px] font-bold tracking-[-0.01em]` (a hand-built approximation of DESIGN.md `subheading`/`heading`). The Tasks tab heading next to it (TasksTab L211) is `text-[16px] font-bold`. Two adjacent section headers on the same page at different hardcoded sizes — inconsistent hierarchy.
**Resolution:** use the named `heading`/`subheading` token (or a shared `SectionHeading`) so the milestone strip header and the Tasks header match.

### F-DEL-10 — Empty-state uses a generic `inbox`/"No milestones yet" list-empty, not a phase-planning prompt [Important · IxD]
L108-117: empty renders `ListState variant="empty" icon="inbox" title="No milestones yet" sub="Add a milestone to track delivery progress"`. For a *delivery backbone* the empty state is a real activation moment (the spec, FR-DEL-013, wants a contextual prompt). The generic inbox-empty undersells it and the icon (`inbox`) is semantically off (milestones aren't messages).
**Resolution (plan §R4):** a purpose-built empty: a faded (weight-proportional) stepper silhouette + "Plan this project's delivery phases" + the PM-gated CTA; non-PM sees a quiet "No delivery phases yet" line (FR-DEL-013 hides the CTA, which the build does correctly — keep that).

### F-DEL-11 — Target date rendered as a raw ISO string [Minor · visual/copy] `[RENDER-CONFIRM]`
L233 (`{m.target_date}`) and TasksTab L738 render `target_date` as the bare DB string (`2026-08-15`). Everywhere else dates are humanized. Inconsistent and slightly machine-looking; also no overdue cue (a past target date on an incomplete phase is a delivery risk — the "at-risk" state the prompt asked about).
**Resolution:** format the date as "Target DD Mon" (owner review OR-2: spelled "Target", not abbreviated "Tgt"); when target_date < today and effective_pct < 100, show an amber "overdue" treatment (warning token) — this is the **at-risk milestone state**.

### F-DEL-12 — No at-risk / overdue milestone state exists at all [Important · IxD/IA]
The spec is "no stage-gates" (OD-DEL-6), but a milestone with a **past target date and < 100%** is a real, surfaceable delivery risk and the audit brief explicitly lists "at-risk" as a required state. The build has no such state — the progress bar is `tone="primary"` always (MilestoneStrip L255), never reflecting schedule risk.
**Resolution (plan §R5):** define the **at-risk milestone** rule (target_date past + effective<100) and render it (amber stepper node + overdue date) without adding gating. Flagged as a small additive design state, not a behavior change.

### F-DEL-13 — Delete-confirm copy is good but the affordance is an unlabelled trash icon among many [Minor · IxD] `[RENDER-CONFIRM]`
Each card has edit (pencil) + delete (trash) icon-only buttons (L236-251). With 4 phases that's 8 icon buttons in the header region. `aria-label`s are present (good). But density of destructive affordances in a compact header is high; in the stepper redesign delete moves into a per-phase popover/overflow menu (one `⋯` per node), and edit becomes the quiet per-node "Edit progress" link (D1), reducing the always-visible destructive surface. Confirm copy ("Tasks become ungrouped; not deleted") is excellent — keep verbatim.

---

## S3 — Milestone create/edit modal

### F-DEL-14 — "Sort order" exposed as a raw integer field [Important · IxD/cognitive-load]
`MilestoneFormModal.tsx` L148-156: `sort_order` is a bare number `TextField`. Asking a PM to hand-type integer sort keys to order delivery phases is a poor mental model (what number do I pick? what's the next one?). Phases are inherently ordered; the UI should let the PM place/reorder them, not assign integers.
**Resolution (plan §R6):** drop the visible `sort_order` field; default it server-side to `max+1` (append) and let reordering happen via up/down (or drag) on the stepper later. If kept for MVP, label it "Display order" with helper text and auto-suggest the next value. Flag for owner: is reorder-UI in scope or is append-only acceptable for v1? (OPEN-Q-A1.)

### F-DEL-15 — "Weight" field has no explanation of its effect [Important · IxD]
L157-165: `weight` is a bare number defaulting to 1, with no hint that it controls the rollup share (`Σ weight×eff / Σ weight`, OD-DEL-5). A PM has no idea why they'd change it or what "3" means relative to "1".
**Resolution:** add helper text ("Heavier phases count more toward project delivery %. Equal weights = equal share.") and show each phase's resulting share (%) live. **This is doubly important after D2 (second review):** the stepper now renders each phase's share as its segment *width*, so the modal's live share preview lets the PM predict how wide the phase will appear in the strip.

### F-DEL-16 — "PM input %" field only appears on edit, not create [Minor · IxD] `[RENDER-CONFIRM]`
L166-177: the `input_pct` field renders only when `isEdit`. Defensible (a brand-new phase has no progress) but means the create→immediately-set-progress path needs two round-trips. Low priority; note for the plan.

### F-DEL-17 — Field grid order doesn't match reading priority [Minor · layout]
Order is name, target_date, sort_order, weight, input_pct. `sort_order` (a field we want to remove) sits in the second visual slot. After R6 the grid is name / target_date / weight (+ input on edit) — cleaner.

---

## S5 — Tasks tab milestone grouping

### F-DEL-18 — Group header is a `bg-secondary/30` bar with an inline `bg-primary/10` %-pill [Important · visual]
`TasksTab.tsx` L730-744: each milestone group header is a `rounded-md border bg-secondary/30` bar holding name + raw date + a `bg-primary/10 text-primary` % pill (L741) + an "Add task" ghost button. The blue %-pill repeats the One-Blue-Rule spend from F-DEL-04, and the header styling is a third distinct "milestone header" treatment (vs the strip card vs the modal) — no shared component, so the same entity reads three different ways across the page.
**Resolution (plan §R3 shared + owner review OR-4, superseded by D3 2026-06-12):** extract a single `MilestonePhaseHeader` with two variants: (a) **full variant** for the stepper (effective % headline + "From tasks N%" muted + "N% of project" weight caption + per-phase Edit-progress); (b) **compact variant** for the tasks-tab group header showing **only "name · Target DD Mon" — NO percentage at all**. The `bg-primary/10` %-pill is removed entirely. 75% IS the manual/effective value, so showing it alone is still "manual without context" (the owner's repeated objection); the full progress story lives **exclusively** in the Stage Stepper. The same "no % in compact secondary surfaces" rule applies wherever milestone progress recurs.

### F-DEL-19 — "Ungrouped" differentiation by italic-muted only [Minor · visual/a11y] `[RENDER-CONFIRM]`
L731-735: "Ungrouped" is `text-[12px] italic text-muted-foreground`, no % chip. Italics for semantic differentiation is weak (and italic at 12px muted is low-contrast). Prefer a clear label + a quiet "No milestone" treatment with adequate contrast.

### F-DEL-20 — Per-group empty ("No tasks in this group") is bare centered muted text [Minor · IxD]
L766: a thin centered line. Fine, but inconsistent with the app's `ListState` empty vocabulary used elsewhere. Low priority; align if cheap.

---

## S6 — PM dashboard chip

### F-DEL-21 — Chip competes in a dense per-row cluster [Important · visual/IA] `[RENDER-CONFIRM]`
`PMDashboard.tsx` L132-144: each project row is `name | [At risk pill] | [delivery chip blue] | [status pill] | margin%`. Three pills + a number in one flex row — high density, and the blue delivery chip (F-DEL-04) competes with the status pill and the at-risk warn pill for attention. The row has no clear primary read.
**Resolution:** apply the F-DEL-04 fix (neutral token for the delivery figure) and consider a thin inline mini-bar instead of a pill so delivery reads as a magnitude, not another status token. `[RENDER-CONFIRM]` the row cluster at 1440 + 375.

---

## Cross-cutting / token-fidelity (apply across S1–S6)

### F-DEL-A1 — Hardcoded type sizes instead of named ramp [Important · visual]
`text-[11px]`, `text-[11.5px]`, `text-[13px]`, `text-[14px]`, `text-[12px]` appear across MilestoneStrip / TasksTab / chips. DESIGN.md defines a named ramp (page-title 24 / heading 20 / subheading 18 / body 14 / label 12 / overline 11 / mono 13). Hardcoded near-values fragment the scale.
**Resolution:** map each to the nearest named token in the plan's component-delta table.

### F-DEL-A2 — `tabular` applied inconsistently to %s [Minor · visual] `[RENDER-CONFIRM]`
The Tabular-Numbers Rule is mandatory on all %/metrics. Most %s carry `tabular` (good), but verify the stepper figures, the new weight caption, and the dashboard mini-bar after redesign all do (figures jitter on update otherwise).

### F-DEL-A3 — Contrast: muted-foreground % on tinted fills [Important · a11y] `[RENDER-CONFIRM]`
"From tasks" value is `text-[13px] ... text-muted-foreground` (MilestoneStrip L268). DESIGN.md darkened `muted-foreground` to L40% for AA on `secondary` fills, but verify the calc-% number (muted), the new "N% of project" weight caption (muted), and the muted figures on the `bg-secondary/30` group header still clear 4.5:1 — small muted numbers on a tint are the single most common AA miss. Measure in the render.

### F-DEL-A4 — No shared `MilestonePhaseHeader` / `EffectivePctReadout` component [Important · architecture]
The same "milestone with its progress" renders in 3 places (strip, tasks-group, modal-context) with 3 hand-built treatments. Per the charter, the shared component library (Phase 3 / Storybook) should own this. Extract one presentational component with a state matrix (loading/empty/divergence/0/100/overdue/weight-render/per-phase-edit-by-role) — this is also the natural Storybook entry for the feature.

---

## Owner-review refinements applied 2026-06-11 (first review)

After the owner reviewed the redesign mockup, four directives were issued and locked. These supersede the corresponding resolution text above where noted. The design-plan (`delivery-redesign-plan.md`) is the authoritative build spec and carries the full OR table.

| Directive | Finding(s) affected | Change to resolution |
|---|---|---|
| OR-1 — Remove "Manual" pill entirely | F-DEL-07 | No badge, no pill for divergence. Effective % headline + "From tasks N%" muted line only. Juxtaposition IS the cue. `title` tooltip permitted as the maximum marker. |
| OR-2 — Spell "Target", not "Tgt" | F-DEL-11, all date labels | All date labels read "Target DD Mon". "Overdue" phase: red "Target 01 May" + Overdue chip — no abbreviation anywhere. |
| OR-3 — Pill encapsulation at 375px | F-DEL-05, F-DEL-21 | Binding implementation requirement: `flex-shrink:0; white-space:nowrap` on all pills/chips; `min-width:0` on shrinkable siblings. Verify by 375px screenshot before merge. |
| OR-4 — Tasks-tab group header: effective % only | F-DEL-18 | Compact header reads "Name · Target DD Mon · N%" — no "Manual" label, no calculated number. **Superseded by D3 (second review) — header now shows NO % at all.** |

## Owner-review refinements applied 2026-06-12 (second review)

After a second mockup review the owner issued three further directives. D1 and D3 are made; D2 was a design-judgment call resolved with ui-ux-pro-max research (plan §D2). These supersede/extend the resolution text above where noted.

| Directive | Finding(s) affected | Change to resolution |
|---|---|---|
| D1 — Edit-progress on EVERY phase | F-DEL-07, F-DEL-13, S8 | The "Edit progress" affordance is present on every phase node for PM/Admin (the spec permits editing any milestone's `input_pct`), not just the current phase. Quiet (recedes until hover/focus), always in DOM (keyboard-reachable), 44px target on mobile; omitted entirely for Engineer (read-only). |
| D2 — Weight legible without number-clutter | F-DEL-06, F-DEL-15, F-DEL-A12 | **Weight encoded SPATIALLY as stepper segment WIDTH** (grid tracks ∝ `weight`), each segment fills by completion%, plus a cumulative weighted "Project delivery" track and a quiet muted "N% of project" caption per cell. Mobile (<768px) falls back to thin rows with an explicit "N% of project" text LABEL (narrow segments fail readability/tap at 375px). Pattern source: ui-ux-pro-max §10 `direct-labeling` + §6 `visual-hierarchy` (earned-value / WBS-rollup convention). **No new color/font/size token — weight is layout + a muted caption.** |
| D3 — Tasks-tab group header: NO % | F-DEL-18 | The group header shows only "name · Target DD Mon" — **no percentage at all**. 75% alone is still "manual without context". Full progress story lives exclusively in the Stage Stepper. Same rule for any compact/secondary surface. Supersedes OR-4. |

---

## Resolution summary (one line per major finding)

| ID | Severity | Lens | One-line resolution |
|---|---|---|---|
| F-DEL-01a | Critical | IA | Make delivery-% the row "Progress"; demote spend to a labelled "Budget used" column; retire the title-line chip. |
| F-DEL-01b | Critical | data | Source spend from committed basis (Σ procurements Ordered..Paid), batched per-row; never the stored `projects.spent`. |
| F-DEL-06 | Critical | IA/visual | Replace the vertical card stack with the DESIGN.md horizontal Stage Stepper; weight-proportional segment widths (D2); rollup once as the strip header. |
| F-DEL-07 | Important | IxD | Lead with effective-% headline; "From tasks N%" muted beneath — juxtaposition is the divergence cue. No pill, no badge (OR-1). Edit-progress on every phase for PM/Admin (D1). |
| F-DEL-08 | Important | visual/a11y | Inline edit uses the `input` token (32px/8px/2px global ring), not the `w-16 rounded focus:ring-1` one-off. |
| F-DEL-02 | Important | copy | Rename the spend column "Budget used" (or "Committed"); "Progress" means delivery only. |
| F-DEL-04 | Important | visual | Delivery figure uses a neutral token / bar, not `bg-primary/10 text-primary` (One Blue Rule). |
| F-DEL-11 | Minor | visual/copy | Format dates as "Target DD Mon" — spelled "Target" not "Tgt" (OR-2). |
| F-DEL-12 | Important | IxD | Add the at-risk milestone state (past target + <100% → amber), no gating. |
| F-DEL-14 | Important | IxD | Drop raw `sort_order`; append server-side; reorder via stepper (or defer reorder, OPEN-Q-A1). |
| F-DEL-15 | Important | IxD | Explain `weight` (rollup share) with helper text + live share %; share now also renders as stepper segment width (D2). |
| F-DEL-18 | Important | visual | Extract one shared `MilestonePhaseHeader` (full + compact variants); compact = name + date only, NO % (D3, supersedes OR-4). |
| F-DEL-A1/A3/A4 | Important | visual/a11y/arch | Map hardcoded sizes to the named ramp; measure muted-on-tint AA (incl. weight caption); extract the shared phase component (Storybook). |
| F-DEL-03/05/09/10/13/16/17/19/20/21/A2 | Minor/Imp | mixed | Folded into the redesign; see plan component-delta. |

---

## Open design questions for the owner

- **OPEN-Q-A1 (reorder UI).** Is phase reordering (drag / up-down on the stepper) in scope for the fix, or is append-only ordering (drop the `sort_order` field, server-default to `max+1`) acceptable for v1? Recommend: append-only now, reorder additive later.
- **OPEN-Q-A2 (delivery vs budget on the list).** Confirm the Projects-list row should show **both** a delivery "Progress" bar AND a "Budget used" figure (two distinct columns), vs delivery-only with budget on the detail page. Recommend: both, clearly separated (delivery = schedule, budget = cost — execs scan both).
- **OPEN-Q-A3 (committed-spend data path).** The committed-spend-per-row enrichment is a real data-layer change (a batched RPC like `get_projects_committed` mirroring `get_projects_delivery`, OR extending `listProjects`). Owner/eng-planner to confirm the shape. This is the one item that blocks a pure ui-implementer fix. (D2 weight rendering adds nothing here — `weight` is already on `project_milestones`.)
- **OPEN-Q-A4 (DeliveryPctChip fate).** With delivery-% becoming a Progress *bar* on the list, `DeliveryPctChip` survives only on the dashboard (S6). Keep it (restyled neutral) or replace with a mini-bar there too? Recommend: replace with a mini-bar for magnitude legibility; retire the pill.
- **F-DEL-A12 (token).** The redesign needs no new color token. At-risk = existing `warning`; stepper done/current = existing `success`/`primary`; divergence cue = two-number juxtaposition; **weight (D2) = layout (segment width) + a muted `overline` "N% of project" caption — no new color/font/size token.** **No DESIGN.md addition is proposed.** Confirmed: identity preserved, zero palette invention.
