# QA portfolio — operational guide

> **Decision + rationale:** ADR-0030. This doc is the *how*: the layers, the defect→owner map, the
> `routes × oracles` denominator, the graduation mechanism, and the vendoring backlog. Binding on the
> Director + all review/build agents.

## ▸ REVIEW MODE (the reversibility switch) — current: **`portfolio`**

The Director's per-issue loop reads this line. Allowed values:
- **`portfolio`** (default, ADR-0030 trial) — Discover→Graduate→Cover (this doc).
- **`4-lens`** — the legacy battery: `design-workflow.md` §1a (mockup round) + §2.3 (rendered round), full
  A/B/C/D ×2. **Kept intact in-repo** — flip here to revert, no rebuild.
- **`3-lens`** — the same battery minus Lens D (intent).

To revert: change the word above to `4-lens` (or `3-lens`). Layer-1 gate-tests + any graduated tests
remain active in **every** mode (pure additions). Trial window + success/revert criteria: ADR-0030 §Reversibility.

## The spine: Discover → Graduate → Cover

```
Discover (open-ended, finds unknown-unknowns)
   └─► Graduate (capture each finding as: a test + a matrix cell + a DESIGN/decision note)
          └─► Cover (enumerated sweep + deterministic gate-tests — locks it forever)
```

A finding is not "done" when it's fixed — it's done when it's **graduated** (can never silently
recur and never needs re-explaining). The graduation step is the point of the whole system.

## Layers (cheap → expensive; each owns ONE defect class)

| Layer | Owns | Cadence | Mechanism | Gate |
|---|---|---|---|---|
| **0 — Vendor-to-shrink** | hand-rolled engine bugs | design-time, per widget | buy-the-engine/build-the-skin, headless-first (ADR-0030 §F) | spike→ADR |
| **1 — Deterministic gates** | math · money · dates/TZ · derived values · a11y · token+visual drift | every PR | property/golden tests · `axe-core` · Playwright visual-regression · (existing) typecheck/lint/coverage/pgTAP | **merge-block** |
| **2 — Enumerated sweep** | coverage tail · affordance/coherence gaps | per UI **issue** (affected routes); full-app at epic | `routes×oracles` matrix, narrow specialist agents via Workflow | advisory→fix |
| **3 — Vision acceptance** | "wrong with real data" · rendered truth | per UI **PR** | design-reviewer + browser MCP on **rich seed**, fixed per-screen question bank + screenshot | advisory→fix |
| **Code reviewers** | spec · quality · security | every PR | spec-reviewer · code-quality-reviewer · security-auditor (right-sized) | advisory→fix |
| **Discover (open-ended)** | **unknown-unknowns** | per UI PR (agent) + **owner at boundaries** | `taste`/`impeccable`/`design-review`, no checklist | feeds Graduate |
| **4 — Adversarial** | plausible-but-wrong on dangerous surfaces | **launch / version gate** + auth/RLS/money/migration changes | Workflow red-team→refute | block on risk |
| **Owner (you)** | taste · product-trust | issue/epic boundaries | agents pre-stage candidate-defects+screenshots; you adjudicate a checklist | sign-off |

**Demoted to fallback (NOT deleted — `review mode` switch above reverts in one edit):** narrative 4-lens ×2 battery; full-lens audit of the static mockup.
**Kept (right-sized):** 3 code reviewers; intake grill; mockup = 30-sec owner sketch-glance only.

## Defect class → single owner (no double-coverage)

| Defect class | Owner |
|---|---|
| math / money / dates-TZ / derived values / a11y / tokens / visual drift | **L1 tests** |
| missing affordance / dead-display / coverage tail | **L2 enumerated sweep** |
| wrong-with-real-data / rendered truth | **L3 vision** |
| spec drift / maintainability / security | **code reviewers** |
| unknown-unknowns (no rule names it) | **Discover** → graduate |
| plausible-but-wrong on dangerous surfaces | **L4 adversarial** (launch gate) |
| taste / "would I ship this" | **owner** (boundaries) |
| *a whole bug class we shouldn't own at all* | **L0 vendor** |

## `routes × oracles` denominator (Layer 2)

**Routes (≈16):** `/` · `/my-tasks` · `/sales` · `/sales/:id` · `/projects` · `/projects/:id/:tab` ·
`/procurement` · `/procurement/:id` · `/timesheets` · `/approvals` · `/companies` · `/companies/:id` ·
`/contacts` · `/contacts/:id` · `/administration` · (`/incidents` — feature-hidden).

**Oracles (one specialist each):** action-completeness ("then what?") · state-coverage
(loading/empty/error/permission) · data-correctness (numbers/dates/positions) · cross-screen
consistency · a11y (WCAG-AA) · mobile@390 · job-fit-per-role.

The sweep answers every (route × oracle) cell on the affected routes; full-app at epic boundaries.
**Maintenance gate (binding):** adding/renaming a route **requires** updating this route list in the
same PR — a new screen must not escape the denominator. (CI check TODO: Phase 3.)

## Graduation registry (what each Discover finding becomes)

When Discover/vision/owner surfaces a defect, record it here as it's graduated, then delete the row
once all three artifacts exist:

| Finding (date) | Test (the lock) | Matrix oracle/cell | DESIGN/decision note | Done |
|---|---|---|---|---|
| S-curve plots "today" at far-right (categorical axis) — 2026-06-15 | `sCurve.test.ts` AC-SC-AXIS-001/002/003/004 (ts field; position-oracle; monotonic domain; year-disambig formatter) | data-correctness × `/projects/:id` | DESIGN.md: time-series uses a time axis, points placed by value | ☑ (2026-06-16) |
| Gantt milestones rendered off-axis (header badge, not date diamond) — 2026-06-15 | `ganttLayout` marker-position test + render-at-`marker.left` test | data-correctness × `/projects/:id` | DESIGN.md: timeline markers placed on the axis by date | ☐ (Gantt-fix wave — vendors failed eval, fix custom) |

## Vendoring backlog (Layer 0)

Standing shortlist (ADR-0030 §F; verified 2026-06):

| Surface | Adopt | Status |
|---|---|---|
| Gantt | **BUILD & OWN (Gantt-v2) — reference MIT implementations, do NOT vendor** | Owner final (2026-06-16): don't take a DHTMLX runtime dependency; if building, stand on proven MIT source (**frappe-gantt** for dependency-arrow SVG routing; **dhtmlx-gantt**'s MIT source for scheduling/resource-histogram patterns) as *blueprints*, but write to our tokens/a11y/R19 and own it. Extends our 80%-there component. **Phase-a (M):** milestone diamonds on-axis + dependency connector lines + MS-Project table/timeline/zoom/gridlines. **Phase-b (L, later):** drag-scheduling (dependency-aware) + resource load/management. DHTMLX-vendor spike stopped (premise changed). |
| Tables / data-grid | **DEFER** (assessed 2026-06-16, `reviews/2026-06-16-vendor-tanstack-table-trial.md`) — our `DataTable` is a *controlled presentational* component with **no internal table-engine to replace** (sort/filter/pagination all parent-controlled or absent); a TanStack swap = pure churn + breaks the raw-`Row` contract for zero new capability. **RESCOPE only** on a real driver (server/client pagination, multi-select, column pinning/resizing, client multi-sort) → then TanStack *behind* the API on the desktop `<table>` branch. | DEFERRED |
| Primitives (dialog/popover/combobox/select) | **React Aria** or **Base UI** | backfill-on-touch (also closes a11y gap) |
| Date math | **date-fns** | high-ROI swap (kills TZ/off-by-one class) |
| Charts | **keep recharts** (fix usage + position tests) | Phase 1 |
| Long lists | **TanStack Virtual** | when needed |

Avoid: DHTMLX (GPL free tier), Bryntum (commercial) for the MVP. Supply-chain: pin exact versions,
lockfile integrity, Dependabot on.

## Rollout phases

- **Phase 1 (now):** S-curve time-axis fix + stand up the L1 floor (data-viz position / money / date
  property tests + `axe` on those components). Bug-fix *and* the deterministic floor in one wave.
- **Phase 2:** L3 vision rendered-acceptance (per-screen question bank) + visual-regression harness.
- **Phase 3:** L2 `routes×oracles` matrix + specialist oracle agents + the route-maintenance CI gate.
- **Phase 4:** L0 vendoring pilots (Gantt → SVAR per the spike; date-fns) + adversarial-at-launch.
