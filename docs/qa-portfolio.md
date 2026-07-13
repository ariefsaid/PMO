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

### e2e parallel-isolation contract

Every Playwright e2e spec declares an isolation class on line 1:
`// @e2e-isolation: read-only | self-isolated | dedicated-row | serial`.

**4 classes**
| Class | Lane | Writes? | Typical |
|---|---|---|---|
| read-only | `chromium` (workers:4) | No (mocks only) | Pure nav/assert, mocked agent, visual/a11y |
| self-isolated | `chromium` (workers:4) | Yes — unique names + cleanup | CRUD create+delete, view-builder save |
| dedicated-row | `chromium` (workers:4) | Yes — owns a dedicated seed row | Procurement on PROC-2026-006, S-curve on P011 |
| serial | `serial` (workers:1) | Yes — org-global state | ClickUp webhook, ENT toggle, admin users, budget activate |

**Enforcement:** `scripts/check-e2e-isolation.sh` runs in `npm run verify` and in **all 3 CI jobs** (verify, pgTAP, integration) — fails on missing tag, lane mismatch, `read-only` writes, or non-serial writes to shared seed IDs.

**Two-lane run** (from `pmo-portal/`):
```bash
npm run e2e
# => playwright test --project=chromium && playwright test --project=serial --workers=1
```
Locally with CI parity (DB lock + `.env.local`): `scripts/e2e-local.sh` from repo root.

**Design doc:** `docs/superpowers/specs/2026-07-11-e2e-parallel-isolation-design.md`
**Plan:** `docs/superpowers/plans/2026-07-11-e2e-parallel-isolation.md`
**README:** `pmo-portal/e2e/README.md` (pick-your-class table + guard + two-lane run)

**Note — community-standard alternative for full parallelism:** if the serial lane ever grows, the textbook option is **per-worker `workerIndex` data isolation** (each worker seeds/owns its own org/project/user slice via `testInfo.workerIndex`). This avoids a serial lane entirely but requires seed refactoring; today the 5-spec serial lane is small and stable, so the two-lane contract is the pragmatic choice.

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
| **Mobile content bleeds off-screen** (procurement row/toolbar clipped, overview cards, timesheet select) — owner, 2026-06-16 | **`e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts`** — every route × {390, 360} asserts **no element's right edge exceeds the viewport** (the shell `overflow-x-hidden` *clips* bleed, so a page-`scrollWidth` oracle is blind — element-right-edge is the correct oracle, excluding legit `overflow-x` scrollers) | **mobile@390** (now an L1 GATE, every PR) × all routes | DESIGN.md: mobile = no horizontal bleed; native `<select>`/toolbars/grid-items must `min-w-0`/cap width | ☑ (2026-06-16) |

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

## Live-verify runbooks (not-CI items — ADR-0030 MVP posture)

Manual runbooks for behavior that is real but deliberately not CI-gated (ADR-0030: no LLM-judge in CI
for MVP). Run before promoting a corpus / system-prompt change and periodically thereafter; record the
run date + result inline.

### Deputy-as-help-desk — role-grounded "how do I" answers (AC-DH-005)

**Scope:** the Assistant's product-help answers, grounded in the asking user's role, produced after
the `helpCorpus.ts` always-on injection (spec `docs/specs/deputy-help.spec.md`).

**Setup:** a live local stack (`supabase db reset` + seed), one signed-in session per role — `Admin`,
`Executive`, `Project Manager`, `Finance`, `Engineer` (the `ALL` set, `pmo-portal/src/auth/policy.ts:71`).

**For each role, ask the Assistant:**
1. A term-definition question, e.g. *"What's the difference between Committed and Actual spend?"* →
   the answer must match the glossary meaning (Committed = Σ procurement records in Ordered…Paid;
   Actual = the same number, labeled "Actual"; no separate actuals ledger today).
2. A role-appropriate "how do I" question, e.g. Engineer → *"How do I log my hours?"*, PM → *"How do I
   approve a timesheet?"*, Admin → *"How do I manage users and roles?"* → the answer must name the real
   screen/route and the real action.
3. An **out-of-role** question, e.g. Engineer → *"How do I approve this timesheet?"* → the answer must
   redirect ("that's a PM/Finance action"), **not** fabricate approval steps (FR-DH-009).

**Pass:** all three behaviors hold across all 5 roles. **On failure:** file a `helpCorpus.ts` follow-up
(FR-DH-011) and do not promote the change.

| Run date | Runner | Admin | Exec | PM | Finance | Engineer | Notes |
|---|---|---|---|---|---|---|---|
| _(run before merge)_ | | | | | | | |
