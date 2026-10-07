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

**Green-by-absence gate (2026-07-25):** `scripts/check-e2e-skips.mjs` runs in the integration job over **both** lane reports in one invocation. A skipped test proves nothing, and skips are invisible in a green tick — every skip needs a justified allowlist entry naming the absent dependency **and a `restore` path**; a **stale** entry (nothing skips for it any more) fails too, so the list cannot quietly grow to cover everything. Each entry also carries a `verified: YYYY-MM-DD` stamp — the day someone re-read the skipped spec and confirmed the reason is still true (a confident wrong reason closed off #560 for a month); a missing/malformed/future stamp fails, one older than 90 days is *reported* (not failed, so a date passing never teaches bumping dates). Same self-cleaning shape as `scripts/audit-prod.mjs`'s waiver list. Both gates carry `--self-test`s, which run in CI's verify job — the gates are themselves gated.

**Two-lane run** (from `pmo-portal/`):
```bash
npm run e2e
# => playwright test --project=chromium && playwright test --project=serial --workers=1
```
For an inner-loop browser run with a reset DB and CI feature flags:
`scripts/e2e-local.sh` from repo root.

The PR→`main` gate is CI's `verify` + `integration` run on that PR. To reproduce it
locally (diagnosis only), `scripts/verify-main-pr.sh` from repo root runs the whole
verify + Deno + pgTAP + every Playwright/visual case with `CI=true`, and keeps the
served-function smoke last so its teardown cannot poison ordinary e2e requests.

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

**RIS Admin setup-to-first-project cells (#688):** the route × oracle matrix for `/administration/users`,
`/administration/integrations`, `/administration/accounting`, `/administration/credits`, `/integrations`,
`/projects`, `/sales` and `/projects/:id` — with the deciding test per cell and the code-proof vs
live-RIS-proof split — lives in `docs/specs/ris-admin-route-matrix.spec.md`. Re-derive a cell from its
cited test, never from this pointer.

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
| RIS Admin route matrix, AC-RAM-004 (#688): 7 rendered axe WCAG-AA violations across 9 RIS Admin surfaces — a dark-mode solid `destructive` button (white text on `0 80% 62%` measured 3.58:1); raw `text-success`/`text-primary` used as small TEXT instead of their `-text` AA variants (StatTiles positive-tone value, the milestone-phase "Current" badge and its `opacity-60`-dimmed Edit-progress link, the active in-page Tabs label — all `#project-detail-tab-overview` on the delivery lens); and the bar `LifecycleStepper`'s own scroll viewport failing `scrollable-region-focusable` (no focusable child) — 2026-09-29 | `e2e/AC-RAM-004-ris-admin-axe.spec.ts` (22 cases: 9 surfaces × 2 themes @1280 + the 2 project-lens surfaces re-scanned × 2 themes @390, axe wcag2a+wcag2aa, `toEqual([])`; the dark-`destructive` detail below was corrected same day — see the regression row below) | a11y (WCAG-AA) × `/administration/integrations`, `/projects`, `/projects/:id` (pipeline lens), `/projects/:id/overview` (delivery lens) | DESIGN.md accessibility posture §"Unverified solids": dark `--destructive` moved from the raw `62%` L hue to the `destructive-solid` `46%` L target it already named as the pending fix (white text now ~5.38:1); DESIGN.md's existing "raw `text-primary`/`text-success` as TEXT is sub-AA on dark canvas, use the `-text` token" rule applied at the 3 new callsites; the `LifecycleStepper` bar scroll viewport gets the same `role=group`+`tabIndex=0` treatment as the Funnel scroll viewport (2026-09-28 row above) — kept on a NEW wrapper (not the existing `role=list` step track) so `aria-required-parent` and existing `getByRole('list', {name})` callers both still resolve | ☑ (2026-09-29) |
| RIS Admin route matrix, AC-RAM-003 (#688): the pipeline-lens record (`/projects/:id`) panned to ~618px at 390/360px viewports — `PipelineLens`'s `grid gap-4 lg:grid-cols-2` gave each grid item the CSS default `min-width:auto`, so the Journey card's un-wrapped `LifecycleStepper` step row (flex, no wrap, summed children) set the shared single-column track's floor past the viewport — 2026-09-29 | `e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts` "project-pipeline-lens (AC-RAM-003)" @390/@360 (page-scrollWidth oracle) | mobile@390 + mobile@360 × `/projects/:id` (pipeline lens) | DESIGN.md-consistent grid-overflow pattern (already used by `Funnel`'s own scroll wrapper): a grid ITEM sharing a track with an intrinsically-wide descendant needs its own explicit `min-w-0` — a nested `overflow-hidden` several levels down does not, by itself, zero the grid item's `min-width:auto` content-based-minimum computation | ☑ (2026-09-29) |
| Meeting edit prefilled "When" in the browser zone while the header displayed the profile zone; clearing/mistyping the field then silently kept the meeting's OLD time on save (create silently dropped it to the DB default) instead of blocking the save — #684, 2026-09-29 | `MeetingDetail.test.tsx` "clearing \"When\" blocks the save with a visible error, and never falls back to the old time"; `Meetings.test.tsx` "clearing \"When\" blocks the create with a visible error (a meeting time is required)"; `format.timezone.test.ts` "defaults to the resolved profile timezone, not the process/browser zone" (now discriminates from the process zone on every machine, not only a non-Jakarta one) | data-correctness + state-coverage × `/meetings` and `/meetings/:id` | (no new DESIGN.md pattern — the existing form-validation convention: a required field blocks submit with a visible per-field + summary error rather than silently defaulting) | ☑ (2026-09-29) |
| Returning to Companies, Contacts or Meetings reset the list to the top — the pages never told the return seam their rows were ready — 2026-09-29 | `Companies.test.tsx` / `Contacts.test.tsx` / `Meetings.test.tsx` "FR-LRC-005 … restores scroll once content is ready"; `e2e/AC-LRC-006/007/008-*` scroll within ±48px of the captured offset | e2e + unit × `/companies`, `/contacts`, `/meetings` | Adopting pages pass `contentReady` via `useListSearchWorkingSet`; a list never restores scroll before its rows render | ☑ (2026-09-29; 12 rendered cells) |
| Meetings showed "No meetings yet" for a moment after Clear filters while the unfiltered list reloaded — 2026-09-29 | `Meetings.test.tsx` "FR-LRC-007: after Clear filters, the kept-previous empty result reads as loading" | state × `/meetings` | Placeholder (kept-previous) empty data is loading, never an empty collection | ☑ (2026-09-29) |
| The phone Back bar read "Back to Perusahaan" in Bahasa — 2026-09-29 | `Breadcrumb.test.tsx` shipped-catalogue case; `e2e/serial/AC-LRC-013-locale-phone-return.spec.ts` exact Bahasa names | i18n × every record route with a Back bar | Back bar label is one translated sentence, not an English prefix around a translated noun | ☑ (2026-09-29) |
| Sales Lost/Needs-attention scope showed "No lost projects" when a search excluded existing rows — 2026-09-29 | `pages/__tests__/listWorkingSet.emptyStates.test.tsx` AC-LRC-012 | state × `/sales` | Zero-match inside a non-empty scope uses zero-match copy + Clear filters; scope-empty copy only when the scope has no rows | ☑ (2026-09-29) |
| RIS Admin route matrix, AC-RAM-004 (#688) regression: the first fix for the dark solid-destructive-button contrast gap darkened `--destructive` itself, which doubles as the raw hue behind `text-destructive` (~30 callsites) and the status dot/bar — dark error text fell to ~3.5:1, sub-AA — 2026-09-29 | `src/components/ui/__tests__/destructiveSolidToken.test.ts` (token-split + Button-wiring regression gate); `e2e/AC-RAM-004-ris-admin-axe.spec.ts` (rendered axe, both themes) | a11y (WCAG-AA) × every `text-destructive`/status dot-bar surface | DESIGN.md §"Unverified solids", "Dark `--destructive` — CLOSED … REGRESSED-THEN-FIXED": a token that doubles as TEXT and as a solid-BUTTON fill needs its own `-solid` split (the same move already made for `--primary`) — darkening the shared token to satisfy one use breaks the other | ☑ (2026-09-29) |
| RIS Admin route matrix, AC-RAM-004 (#688) Discover follow-up: the `LifecycleStepper` bar scroll viewport's own `:focus-visible` ring drew outward and was clipped by its `overflow-hidden` parent wrapper, invisible on Tab (WCAG 2.4.7) — 2026-09-29 | `e2e/AC-RAM-004-ris-admin-geometry.spec.ts` "the stage-journey stepper's focus ring is not clipped by its overflow-hidden wrapper" @390/@1440 | a11y (WCAG-AA) × `/projects/:id` (pipeline lens, "Project stage journey") | DESIGN.md "Focus ring inside a scrolling ancestor": a focusable element whose nearest scrolling ancestor is the clip boundary draws its ring INWARD (`outline-offset-[-2px]`), never the global outward offset | ☑ (2026-09-29) |
| RIS Admin route matrix, AC-RAM-004 (#688) Discover follow-up: the milestone card grid's mobile row rendered its "Current" badge in raw `text-primary` (~3.5:1 in dark, sub-AA) — the desktop stepper variant had already been fixed, but the separate mobile-row badge was missed — 2026-09-29 | `e2e/AC-RAM-004-ris-admin-axe.spec.ts` (rendered axe, both themes, `/projects/:id/overview`) | a11y (WCAG-AA) × `/projects/:id/overview` (delivery lens, mobile milestone row) | DESIGN.md's existing "raw `text-primary`/`text-success` as TEXT is sub-AA on dark canvas, use the `-text` token" rule, applied at the mobile-row callsite it missed | ☑ (2026-09-29) |
| RIS Admin route matrix, AC-RAM-004 (#688) Discover follow-up: a long, unbroken milestone name (seeded "Commissioning & Grid Connection") could render under the percentage column once the milestone card grid narrowed to 4 columns at 1280/1440px — 2026-09-29 | `e2e/AC-RAM-004-ris-admin-geometry.spec.ts` "the milestone card percentage stays clear of a long phase name" @1280/@1440 | cross-screen consistency × `/projects/:id/overview` (delivery lens) | (no prior DESIGN.md rule named this case) — `MilestonePhaseHeader`'s name column takes `break-words`+`min-w-0` and the percentage column reserves `min-w-[44px]`, so an unbreakable long name wraps within its own column instead of sliding under the sibling | ☑ (2026-09-29) |
| RIS Admin route matrix, AC-RAM-004 (#688) Discover round 3: round 2's `break-words` fix stopped the name/% overlap but the milestone card grid still sized its columns off the VIEWPORT (`xl:grid-cols-4`) rather than its own narrower rendered width inside `ProjectDetail`'s two-column record layout — a forced 4th column at 1280/1440px squeezed the name to ~7-47px, so `break-words` cut words mid-letter ("Enginee/ring", "Procure/ment") instead of only at spaces — 2026-09-29 | `e2e/AC-RAM-004-ris-admin-geometry.spec.ts` "every milestone card phase name renders each word on a single line" @1280/@1440 (per-word `Range.getClientRects()` line-count check — a broken word spans >1 line `top`) | cross-screen consistency × `/projects/:id/overview` (delivery lens) | DESIGN.md "Milestone card, narrow-card readability": size a metric-card grid's columns off its OWN rendered width (`auto-fit`/`minmax`) not a viewport breakpoint — a narrow card should drop a column before its title runs out of room | ☑ (2026-09-29) |
| Sales Board ignored `scope` while the URL kept it — Table → Lost → Board still showed the full open pipeline with a stale `?scope=Lost` in the URL, and a direct/copied board URL with a scope token silently misrepresented the pipeline — #682, 2026-09-29 | `src/lib/listWorkingSet.test.ts` "#682 Director ruling (2026-09-29): scope is meaningful only for the Sales table view — the board carries no scope"; `pages/SalesPipeline.test.tsx` "SalesPipeline Board has no scope (#682 Director ruling)" (view-switch reset + direct-URL parse) | state × `/sales` | docs/specs/list-working-set-return.spec.md Sales Pipeline row: `scope` is meaningful only for the table view; the board is always the open pipeline by stage and never carries or writes an inert `scope` — the rule lives once in the codec's sales schema (parse + serialize), never re-derived on the page | ☑ (2026-09-29) |
| Sales Board zero-match (a search matching no card) showed only per-column "No projects in X" with no overall message or Clear filters, unlike the Table and every other adopting list — 2026-09-29 | `pages/__tests__/listWorkingSet.emptyStates.test.tsx` "AC-LRC-012: on the Board (default view), a search that matches no card shows the same zero-match copy + Clear filters, which restores the cards" | state × `/sales` | (no new DESIGN.md rule — the existing AC-LRC-012 zero-match-vs-genuine-empty convention, applied to the one adopting-list body that had not received it) | ☑ (2026-09-29) |
| Load-error headline (`ListState` error) hard-coded `hsl(0 72% 42%)` — unreadable on the dark canvas; every page's load error affected — 2026-09-30 | `ListState.test.tsx` asserts `text-destructive-text` and no inline colour (#741) | a11y (WCAG-AA) × every list/admin load-error state, dark | DESIGN.md: error text uses `destructive-text`, never a literal colour | ☑ (2026-09-30) |
| Sales mobile stage indicator: selected label `text-primary` measured 3.18:1 in dark (the only axe violation in a 72-cell en/id × light/dark × 390/1440 sweep) — 2026-09-30 | `mobile.pr3.test.tsx` asserts `text-primary-text` on the selected tab (#741) | a11y (WCAG-AA) × `/sales` mobile, dark | DESIGN.md: primary-coloured TEXT uses the `-text` AA token | ☑ (2026-09-30) |
| `/projects` table at 1440px scrolled the whole page ~347px: the `sr-only` Actions header escaped the unpositioned `overflow-x-auto` scroller — 2026-09-30 | `e2e/AC-TBL-OVERFLOW-001-projects-table-no-page-scroll.spec.ts` (`scrollWidth <= clientWidth` at 1440) (#741) | layout × `/projects` table, 1440 | DESIGN.md DataTable: the scroll wrapper is `relative` so absolutely positioned descendants stay clipped | ☑ (2026-09-30) |
| Bahasa gaps after #693: Procurement board column titles and the Sales funnel band names stayed English while neighbouring controls were translated — 2026-09-30 | `ProcurementBoard.bahasa.test.tsx`, `SalesPipeline.bahasa.test.tsx` (#741) | i18n × `/procurement` board, `/sales` funnel | stage display labels come from label hooks (`useSalesStageLabel`, `useProcurementStageLabel`), enum values unchanged | ☑ (2026-09-30) |
| A filter picked just before a debounced search write was silently dropped: the router commits location as a transition that typing can pre-empt, and `setWorkingSet` built on the last *committed* URL (CI, #725: `/meetings?q=coordination`, project gone) — 2026-09-29 | `useListWorkingSet.test.tsx` FR-LRC-001 "a second write builds on the first even before the router re-renders" (red on the old hook with CI's exact URL), plus "a nav link followed while a write is pending wins" and "after Back, the next write builds on the URL the user is at" (removing the sync turns both red) | state-coverage × `/projects` `/sales` `/procurement` `/companies` `/contacts` `/meetings` | `docs/decisions.md`-level rule for the list seam: every URL write builds on the latest write the hook made; any commit that is not one of its own writes is an outside navigation and wins | ☑ (2026-09-29) |
| List-return journeys read the scroll baseline BEFORE Playwright's click scrolled an off-screen target row into view, so the oracle depended on the row count (one extra matching row from another spec → 211px "miss"; the app had restored the true position) — 2026-09-29 | `e2e/AC-LRC-003…009` read the offset after `scrollIntoViewIfNeeded()` on the row they open; AC-LRC-006 mutation (restore forced to 0) → red | oracle correctness × every list-return journey | e2e authoring: capture a UI position at the moment of the user action, after any auto-scroll the action implies — never before it | ☑ (2026-09-29) |
| Budget editor at375px: absolute hidden amount label escaped an unpositioned scroller — 2026-10-05 (#804) | `ProjectBudget.test.tsx` AC-CAT-007 retains positioned scroll containment | mobile@375 × project budget editor, both themes | Existing DESIGN.md DataTable rule: position the clipping scroll ancestor with `relative` | ☑ (2026-10-05) |
| Projects search toolbar's Clear all text fell below WCAG AA on the dark canvas, and project identifiers were truncated on narrow cards — Discover #771, 2026-10-05 | `Projects.projectNumber.test.tsx` retains the `primary-text` token and mobile wrapping; private styled render asserts both full identifier text ranges fit their visible boxes | WCAG-AA × `/projects` dark; mobile@375 × `/projects` light/dark | Existing DESIGN.md rules: primary text uses the AA `-text` token; narrow content wraps within its available width | ☑ (2026-10-05) |
| Finance status filters exceeded375px — Discover #763/#789,2026-10-05 | `pages/__tests__/SalesInvoices.createForm.test.tsx` keeps filters in a labelled keyboard-accessible capped scroll region; actual styled geometry probes at375/1440 | mobile@375 + keyboard × `/sales-invoices`, both themes | DESIGN.md Finance filters: labelled, focused, width-capped scroller | ☑ (2026-10-05) |
| Budget line-item scrolling region could not receive keyboard focus — Discover #789,2026-10-05 | `ProjectBudget.test.tsx` keeps the budget line-item region keyboard accessible | keyboard × project budget, both themes | Existing shared focus-ring token and positioned clipping ancestor | ☑ (2026-10-05) |
| Budget Clone action text fell below AA on dark primary colour — Discover #789,2026-10-05 | `ProjectBudget.test.tsx` asserts the existing `primary-text` token on Clone; styled axe probe | WCAG-AA × project budget, dark | Existing AA text-token rule | ☑ (2026-10-05) |
| Budget status and total touched when the version-card header wrapped — Discover #789,2026-10-05 | `ProjectBudget.test.tsx` retains wrap gaps and reserved total width; styled geometry probe | mobile@375 × project budget | DESIGN.md Finance cards: visible wrap gaps, total reserves width | ☑ (2026-10-05) |
| Invoice tax-basis note narrowed to one word per line on mobile — Discover #789,2026-10-05 | `pages/__tests__/SalesInvoices.createForm.test.tsx` groups amount/basis for narrow cards; styled text geometry probe | mobile@375 + data-correctness × `/sales-invoices` | DESIGN.md Finance cards: tax-basis note has a full-width line | ☑ (2026-10-05) |
| Project classification filter clearing at phone width — 2026-10-05 (#770) | `pages/__tests__/Projects.mobileToolbar.test.tsx` AC-PRJUX-002 retains the `primary-text` token on Clear all | a11y × `/projects` mobile, both themes | DESIGN.md: filter-clearing text uses the AA text token | ☑ (2026-10-05) |
| Engineer classification filters at phone width — 2026-10-05 (#770) | `pages/__tests__/Projects.mobileToolbar.test.tsx` AC-TAG-002 selects a service line, asserts the matching result, and clears to My Projects | role × state × `/projects` mobile | DESIGN.md: classify independently of manager-only filters, preserve the role default when clearing | ☑ (2026-10-05) |
| Read-only classification setup definition-list semantics — 2026-10-05 (#770) | `pages/admin/OrgProjectClassificationOptions.a11y.test.tsx` runs the owning axe definition-list oracle on the real read-only component | a11y × `/administration/projects`, non-Admin | DESIGN.md: explanatory text sits outside the term/definition list | ☑ (2026-10-05) |
| Wide Sales Invoices row actions scrolled out of reach — #925, 2026-10-08 | `e2e/AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts` checks trigger/scroller geometry, the clean seam column (no ink past the ⋯), and the rendered divider at 1280/1440 light+dark on stubbed AND real DB rows; `DataTable.test.tsx` retains the generated sticky class + seam-strip contract | data-correctness / action-completeness × `/sales-invoices` @1280/1440 | DESIGN.md Data Table: the desktop generated `rowMenu` column sticks right on horizontal scroll with card surface, inset-hairline divider and foreground-token gradient; mobile cards retain top-right actions | ☑ (2026-10-08) |

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
