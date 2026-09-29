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

**Enforcement:** `scripts/check-e2e-isolation.sh` runs in `npm run verify` and in **all 3 CI jobs** (verify, pgTAP, integration) — fails on missing tag, lane mismatch, `read-only` writes, non-serial writes to shared seed IDs, **and any spec that gates on `process.env.CI`** (2026-07-25).

**Standing isolation-probe denominator (2026-09-16, #612 item 1):** `scripts/check-isolation-denominator.mjs` reads the local catalog (public tables, non-trigger public SECURITY DEFINER functions, storage buckets) and `supabase/functions/` and compares it against the checked-in `scripts/isolation-probe-denominator.json`. **Any PR that creates a public table, a non-trigger public SECURITY DEFINER function, an edge-function directory, or a storage bucket must add its catalog entry to that denominator in the SAME PR** — that is the line where the author reviews whether the hosted cross-org probe (`scripts/isolation-probe.sh`) covers it. Both a surface the manifest omits and a manifest entry that no longer exists fail the database CI lane (`pgtap`); the probe's `TABLES_JSON` now comes from the same file. Fix path: `node scripts/check-isolation-denominator.mjs --write`, review the diff, commit it with the surface.

**Why that last rule (the guard-polarity class):** a spec must gate on whether its DEPENDENCY is present, never on which environment it is in. We shipped it backwards twice — the ERPNext bench specs *threw* in CI assuming CI had a bench (#371/#372), and `AC-INV-001` *skipped* in CI while being permanently 503-red locally (#386). `[edge_runtime] enabled = false` and "no bench" are true in **both** places. Gate on the real signal (`SUPABASE_FUNCTIONS_URL`, exported by `scripts/serve-functions.sh`); skip when the lane is absent, **throw** when it is present but misconfigured. Full checklist + canonical form: [`docs/e2e-parallel-conventions.md`](e2e-parallel-conventions.md).

**Green-by-absence gate (2026-07-25):** `scripts/check-e2e-skips.mjs` runs in the integration job over **both** lane reports in one invocation. A skipped test proves nothing, and skips are invisible in a green tick — every skip needs a justified allowlist entry naming the absent dependency **and a `restore` path**; a **stale** entry (nothing skips for it any more) fails too, so the list cannot quietly grow to cover everything. Same self-cleaning shape as `scripts/audit-prod.mjs`'s waiver list. Both gates carry `--self-test`s, which run in CI's verify job — the gates are themselves gated.

**Two-lane run** (from `pmo-portal/`):
```bash
npm run e2e
# => playwright test --project=chromium && playwright test --project=serial --workers=1
```
For an inner-loop browser run with a reset DB and CI feature flags:
`scripts/e2e-local.sh` from repo root.

Before creating, pushing, or refreshing any PR targeting `main`, the authoritative
full local promotion gate is `scripts/verify-main-pr.sh` from repo root. It runs the
whole verify + Deno + pgTAP + every Playwright/visual case with `CI=true`, and keeps
the served-function smoke last so its teardown cannot poison ordinary e2e requests.

**Design doc:** `docs/superpowers/specs/2026-07-11-e2e-parallel-isolation-design.md`
**Plan:** `docs/superpowers/plans/2026-07-11-e2e-parallel-isolation.md`
**README:** `pmo-portal/e2e/README.md` (pick-your-class table + guard + two-lane run)
**Conventions checklist (binding, read before authoring a new spec):** `docs/e2e-parallel-conventions.md`

**Note — community-standard alternative for full parallelism:** if the serial lane's runtime becomes
material, the textbook option is **per-worker `workerIndex` data isolation** (each worker seeds/owns
its own org/project/user slice via `testInfo.workerIndex`). That cannot isolate process-global
dependencies such as Mailpit, so those journeys still need a dedicated serial resource or worker.

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

**Routes (38 non-catch-all route entries, from `pmo-portal/App.tsx` `appRouteConfig` — 2026-09-27):** `/` · `/projects` · `/projects/:id` · `/projects/:id/:tab` ·
`/sales` · `/sales/:id` · `/procurement` · `/procurement/:id` · `/procurement/:id/:tab` · `/timesheets` · `/approvals` ·
`/companies` · `/companies/:id` · `/contacts` · `/contacts/:id` · `/incidents` · `/incidents/:id` (feature-hidden) ·
`/my-tasks` · `/meetings` · `/meetings/:id` · `/reports` · `/administration` (entry alias) ·
`/administration/users` · `/administration/integrations` · `/administration/accounting` · `/administration/credits` ·
`/administration/usage` · `/administration/features` · `/administration/:section` (unknown-section fallback) ·
`/sales-invoices` · `/incoming-payments` · `/revenue-by-project` · `/integrations` (personal) · `/views` ·
`/views/new` · `/views/:id` · `/views/:id/edit` · `/settings/profile`.
⚑ A prior list under-counted by 14 routes for ~6 weeks (the whole meeting module included) despite the maintenance gate below — re-derive it from `appRouteConfig`, never edit it by memory.

**Administration IA cells:** The six canonical child routes and personal `/integrations` receive
action-completeness, state-coverage, cross-screen consistency, WCAG-AA, mobile@390, and
job-fit-per-role checks. The `/administration` alias and `/administration/:section` fallback receive
redirect, permission, and focus checks; they are compatibility behavior rather than new destinations.
The org Admin and platform Operator are distinct role oracles. Route selection, breadcrumb, heading,
and mounted panel must agree; a settled Operator panel remains stable during a background membership
refresh. The personal integration destination must keep its rail, breadcrumb, and page title aligned
while remaining distinct from the organization-owned section.

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
| Projects mobile toolbar loses the intended tap when switching disclosures, and an inert shell dialog blocks dismissal — 2026-09-26 | `e2e/AC-PRJUX-003-mobile-disclosure-switch.spec.ts` checks the switch, Escape, outside click, focus, and open-panel bounds at 360px | interaction + mobile@360 × `/projects` | DESIGN.md: switch on click; only active dialogs block dismissal; preserve the intended focus target | ☑ (2026-09-27) |
| Personal integration rail and breadcrumb label diverged from its page heading — 2026-09-27 | `Rail.test.tsx` + `breadcrumb-nav.test.ts` assert the same personal label; `Integrations.test.tsx` checks the H1 | cross-screen consistency × `/integrations` and `/administration/integrations` | DESIGN.md Navigation: route label and heading agree; personal and organization ownership are distinct | ☑ (2026-09-27) |
| Accounting fragment did not respond to a router hash change after the panel had mounted — 2026-09-27 | `BudgetAccountMap.test.tsx` navigates the router hash and checks target focus/scroll; `e2e/AC-ADMIA-001-administration-navigation.spec.ts` checks the compatibility URL | state-coverage + cross-screen consistency × `/administration/accounting` | DESIGN.md Navigation: async deep-link targets receive focus after route resolution | ☑ (2026-09-27) |
| Administration access checking needed stable pending and recoverable error states — 2026-09-27 | `useIsOperator.test.tsx` and `AdministrationShell.test.tsx` assert the state transitions and retry | state-coverage + job-fit-per-role × `/administration/usage` and `/administration/features` | DESIGN.md Navigation: pending access applies to unresolved membership; an unavailable check offers recovery | ☑ (2026-09-27) |
| Organization integration connection and cursor time were presented as proof of usable transfer — 2026-09-27 | `IntegrationsView.test.tsx` AC-IRUX-003/004 checks independent tier states and no last-sync claim; `e2e/AC-EAC-018-connect-link-sync.spec.ts` checks a transferred record and confirmed outbox | data-correctness + state-coverage × `/administration/integrations` | DESIGN.md Organization integration readiness: connection, activation, queue, and verified movement are distinct | ☑ (2026-09-27) |
| Kanban project titles were clamped beside the icon and status displaced the title — 2026-09-28 | `ProjectCardShell.test.tsx` AC-KTR-001/002/003 locks title order, grid preservation, and activation | mobile@390 + cross-screen consistency × `/sales` and `/projects` | DESIGN.md Kanban Card: title wraps at available width; status follows title before client/code | ☑ (2026-09-28; 16 rendered route × locale × theme × viewport cells) |
| Sales funnel: a fixed `10rem` track floor let a realistic (trillions-scale) IDR amount overflow into the neighbouring stage at 390px — 2026-09-28 | `e2e/AC-SFA-001-sales-funnel-amount-geometry.spec.ts` AC-SFA-001 (id-ID/IDR trillions-scale probe, browser geometry containment) | mobile@390 + data-correctness × `/sales` | DESIGN.md `Funnel`/Sales note: stage columns floor at the stage's own `max-content`, never a fixed length, so an unbreakable long amount grows its own track instead of overflowing | ☑ (2026-09-28) |
| Funnel scroll region (no `onSelect`, e.g. dashboard panels) had no focusable content — failed axe `scrollable-region-focusable` | `composites.test.tsx` "AC-A11Y-SCROLL: a non-interactive … Funnel scroll viewport is itself keyboard-focusable" | a11y (WCAG-AA) × `/` dashboard panels and any non-interactive Funnel host | DESIGN.md Accessibility posture: a horizontally scrolling region with no focusable children gets `role=group`, a label, and `tabIndex=0` | ☑ (2026-09-28) |
| Tab to a partly off-screen funnel stage did not scroll it into view at 390px — 2026-09-28 | `e2e/AC-SFA-001-sales-funnel-amount-geometry.spec.ts` AC-SFA-005 "keyboard focus scrolls a partly off-screen stage into the funnel viewport at 390px" | mobile@390 + a11y (WCAG-AA) × `/sales` | (no new DESIGN.md rule — an existing keyboard-operability expectation, not a new pattern) | ☑ (2026-09-28) |
| Funnel progress bars misaligned when weighted text wrapped, and (round 3) lost their 8px gap entirely once every stage's natural height was equal — 2026-09-28 | `e2e/AC-SFA-001-sales-funnel-amount-geometry.spec.ts` AC-SFA-006 "every stage progress bar keeps an 8px gap below its weighted line and all bar tops align"; `composites.test.tsx` "Discover fix round 3: the bar keeps an unconditional 8px floor gap…" | mobile@390 + cross-screen consistency × `/sales` | DESIGN.md `Funnel`: the bar's floor gap and its cross-row alignment are two separate properties — a fixed top margin loses alignment when a sibling wraps, and `margin-top:auto` alone loses the floor gap when no sibling wraps; both must be applied together (fixed padding on a transparent wrapper + `mt-auto` for alignment) | ☑ (2026-09-28) |
| Rendered review matrix (AC-SFA-003, Director, 2026-09-28): en/id × light/dark × 390/1440 plus 2 trillions-scale IDR cells, all PASS — 0 text overflow, page width = viewport in every cell, 8.0px bar gap; axe 0 color-contrast violations in both themes; Tab/Enter/Space/click selection OK. Rendered on Chromium 141 in the cloud container. | Director rendered-review matrix (no synthetic unit test per the plan; see `docs/plans/2026-09-28-sales-funnel-readability-e64b9e96.md` task 5) | mobile@390 + cross-screen consistency + WCAG-AA × `/sales` (en/id, light/dark, 390/1440, 2 IDR trillions-scale cells) | No new rule from this matrix pass itself — confirms the already-shipped `Funnel` layout/focus/bar rules under review | ☑ (2026-09-28) |
| Global 2px-outward `*:focus-visible` ring on a funnel stage button was clipped by the funnel's own `overflow-x-auto` scroll area (vertical overflow clips too — measured ring top 204.8 vs clip edge 208.8) — 2026-09-28 | `e2e/AC-SFA-001-sales-funnel-amount-geometry.spec.ts` AC-SFA-007 "a focused stage's visible focus ring lies inside the funnel viewport at 390px"; `composites.test.tsx` "AC-SFA-007: an interactive stage draws its focus ring inward…" | a11y (WCAG-AA) + mobile@390 × `/sales` | DESIGN.md Focus: an interactive stage inside a scrolling Funnel viewport draws its focus ring INWARD (`outline-offset-[-2px]`, same width/color token) instead of the global outward offset, so the ring never crosses into an ancestor's own overflow clip | ☑ (2026-09-28) |
| M365 disconnect-failure alert contrast — the recovery alert used `text-destructive` on a `destructive/10` tint (fails WCAG AA, 4.18:1 light / 4.33:1 dark on 14px text) and repeated its retry/cancel guidance across the headline and reason — 2026-09-28 | `M365ConnectionCard.test.tsx` AC-M365LOC-005 (split headline/body, `text-destructive-text`/`bg-destructive/[0.07]` classes, no `text-destructive` on the tint, guidance stated once, en+id) | a11y (WCAG-AA) + i18n × `/integrations`, all locales/viewports | DESIGN.md Modal dialog rule 3: "Text on a destructive tint always uses `destructive-text`, never `destructive`" | ☑ (2026-09-28) |
| Meeting edit prefilled "When" in the browser zone while the header displayed the profile zone; clearing/mistyping the field then silently kept the meeting's OLD time on save (create silently dropped it to the DB default) instead of blocking the save — #684, 2026-09-29 | `MeetingDetail.test.tsx` "clearing \"When\" blocks the save with a visible error, and never falls back to the old time"; `Meetings.test.tsx` "clearing \"When\" blocks the create with a visible error (a meeting time is required)"; `format.timezone.test.ts` "defaults to the resolved profile timezone, not the process/browser zone" (now discriminates from the process zone on every machine, not only a non-Jakarta one) | data-correctness + state-coverage × `/meetings` and `/meetings/:id` | (no new DESIGN.md pattern — the existing form-validation convention: a required field blocks submit with a visible per-field + summary error rather than silently defaulting) | ☑ (2026-09-29) |
| Returning to Companies, Contacts or Meetings reset the list to the top — the pages never told the return seam their rows were ready — 2026-09-29 | `Companies.test.tsx` / `Contacts.test.tsx` / `Meetings.test.tsx` "FR-LRC-005 … restores scroll once content is ready"; `e2e/AC-LRC-006/007/008-*` scroll within ±48px of the captured offset | e2e + unit × `/companies`, `/contacts`, `/meetings` | Adopting pages pass `contentReady` via `useListSearchWorkingSet`; a list never restores scroll before its rows render | ☑ (2026-09-29; 12 rendered cells) |
| Meetings showed "No meetings yet" for a moment after Clear filters while the unfiltered list reloaded — 2026-09-29 | `Meetings.test.tsx` "FR-LRC-007: after Clear filters, the kept-previous empty result reads as loading" | state × `/meetings` | Placeholder (kept-previous) empty data is loading, never an empty collection | ☑ (2026-09-29) |
| The phone Back bar read "Back to Perusahaan" in Bahasa — 2026-09-29 | `Breadcrumb.test.tsx` shipped-catalogue case; `e2e/serial/AC-LRC-013-locale-phone-return.spec.ts` exact Bahasa names | i18n × every record route with a Back bar | Back bar label is one translated sentence, not an English prefix around a translated noun | ☑ (2026-09-29) |
| Sales Lost/Needs-attention scope showed "No lost projects" when a search excluded existing rows — 2026-09-29 | `pages/__tests__/listWorkingSet.emptyStates.test.tsx` AC-LRC-012 | state × `/sales` | Zero-match inside a non-empty scope uses zero-match copy + Clear filters; scope-empty copy only when the scope has no rows | ☑ (2026-09-29) |

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
