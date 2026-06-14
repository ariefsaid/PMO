# Coherence Wave — foundation plan (pattern-normalization, NOT features)

**Date:** 2026-06-14 · **Owner of this doc:** design-architect · **Authority:** this plan + the
DESIGN.md additions it ships are the **single source of truth** the whole wave builds against.

**Source of truth for the diagnosis:** `docs/reviews/2026-06-14-whole-app-coherence-audit.md` +
the six lens reports `review/whole-app-audit/{opus,gpt}-lens-{a,b,c}.md`. **Root cause (both
substrates agree):** PATTERN/MOLECULE drift, NOT token drift. The visual atoms (one blue, Inter,
32px controls, 8px radius, borders-first) are shared and disciplined. The five core interaction
verbs — **NAME · CREATE · OPEN · ADVANCE/APPROVE · GET-BACK a record** — were built per-feature
instead of once. This wave normalizes the molecules; it does **not** restyle the brand.

**Owner-locked decisions (binding — do not re-open):**
- Canonical noun = **"Project"** everywhere in UI copy (drop "deal"/"opportunity" from copy). One
  create-verb scheme: **"New &lt;Entity&gt;"**.
- **Single `projects` table retained** (ADR-0020 stands — NOT a separate Opportunity object). The
  record renders a **stage-aware lens**: a **pipeline lens** pre-win, a **delivery lens** post-win.
  Same entity, different view, never the wrong shell.
- Visual TOKENS are fine and shared — **do not restyle**. Normalize PATTERNS/MOLECULES, not atoms.

**Standing reality (good news):** the shared *primitives mostly already exist* —
`PageHeader` (record header), `KPITile`, `StatTiles` (metric strip), `LifecycleStepper`
(with `inline` + `node` variants), `ViewToggle`, `StatusPill`, `DataTable`, `ListState`,
`EntityFormModal`. The drift lives in **consumer code** (labels, per-module status maps, which
stepper variant, drawer-vs-page, action placement), not in missing components. So most of this wave
is **migrate consumers onto the existing primitive + delete the one-off**, plus three net-new
extractions (`RecordHeader` thin wrapper, `ListPage` shell, the status/severity registry).

---

## 1. Terminology map (kills P3 / Finding-1)

Canonical noun is **Project**. "Pipeline" remains a valid **stage-group label** for the breadcrumb
and the Sales index page title only — it is a *stage*, not a second noun. **"Deal" and "opportunity"
are removed from all UI copy.** Create-verb scheme = **"New &lt;Entity&gt;"** for master/transactional
records; domain verbs are kept ONLY where the domain genuinely uses them (Procurement "Raise
request", Incident "File incident") — and then the **button / modal title / submit label must all
say the same phrase**.

| Surface (file:line) | Current string | Canonical replacement |
|---|---|---|
| `pages/Projects.tsx:402,574` | **New deal** (CTA) | **New project** |
| `components/ProjectFormModal.tsx:218` | **New deal** (modal title) | **New project** |
| `components/ProjectFormModal.tsx:222` | **Create deal** (submit) | **Create project** |
| ProjectFormModal field/section copy | "Opportunity name", section "Opportunity", subtitle "Create an opportunity in the sales pipeline" | "Project name", section "Project", subtitle "Create a project" |
| `pages/SalesPipeline.tsx:325` | **New opportunity** (CTA) | **New project** |
| `pages/SalesPipeline.tsx:389-390` | placeholder/aria **Search deals** | **Search projects** |
| `pages/SalesPipeline.tsx` page title | "Sales Pipeline" | **"Pipeline"** (stage-group page; the noun in copy is Project) |
| `pages/Procurement.tsx:248,315` | Raise request | **Raise request** (keep — domain verb) — ensure modal title + submit also read "Raise request" / "Raise request" (today modal says "Raise a purchase request", submit "Create request" — unify all three) |
| `pages/Incidents.tsx:275,330,482,488` | File incident | **File incident** (keep — domain verb; already consistent button/title/submit) |
| `pages/Companies.tsx:216,303,610` | New company | **New company** (keep) |
| `pages/Contacts.tsx:212,623` | New contact | **New contact** (keep) |
| `pages/AdminUsers.tsx:357-359` | Add user (disabled) | **New user** (and ENABLE — see Phase-1 bug sweep) |
| ⌘K record `sub` labels (`src/hooks/useRecordSearch.ts:64,77,95`) | "Project" / "Sales Pipeline" / "Procurement" | "Project" / "Project · Pipeline" / "Procurement" (one noun; stage as qualifier) |
| Nav rail / page-H1 for approvals (Lens-A M1) | rail "Approvals" vs H1 "Needs my approval" vs dashboard "Awaiting your approval" | rail + H1 = **"Approvals"**; "Awaiting you (N)" only as a count label |
| `pages/Procurement.tsx:262` view label | **By-stage Board** | **Board** (one board label app-wide — see §3 ListPage) |
| Projects view label `pages/Projects.tsx` | "Kanban" | **Board** (match) |

**Headline:** one noun (**Project**) and one create scheme (**New &lt;Entity&gt;**) replace the
4-name/4-verb churn; "By-stage Board" and "Kanban" both become **Board**.

**e2e fallout (must update in lockstep, not silently bent):** `AC-PRJ-001`, `AC-IXD-PROJ-001`,
`AC-W2-IXD-004`, `AC-AU-001` assert `/Create deal/`, `/New deal/`, `/Add user/`. Per the BDD rule,
these are **deliberate copy changes** → update the journey *strings* to the canonical nouns; keep
each goal-oracle intact.

---

## 2. Canonical status / severity → token map (kills P4)

**THE rule — the reserved action-blue (`primary`) is FREED. No status, severity, or category may
use it.** Action-blue is for the one interactive affordance only (DESIGN.md One-Blue Rule). The
DOM-measured collisions to fix: Incidents `Medium: 'open'` (`pages/Incidents.tsx:49`) and
`Open: 'open'` (`:59`) both render the action-blue pill; Companies `Client: 'open'`
(`pages/Companies.tsx:48`) renders company-type in action-blue; Contacts activity "Call" uses blue.

**Three independent families** (a pill is exactly one family; never reuse one family's tints for
another):

**A. Workflow status** (one source-of-truth map, ALL modules)

| Meaning | StatusPill variant | Token basis |
|---|---|---|
| Open / active / in-progress / pending | `progress` | `secondary` fill + `muted-foreground` dot+text (NOT blue) |
| Awaiting-action / needs-you | `warn` | `warning/18` + `warning-foreground` |
| Done / won / approved / closed-positive | `won` | `success/12` + `--status-won-text` |
| Lost / rejected / cancelled / failed | `lost` | `destructive/10` + `--status-lost-text` |
| Closed / terminal-neutral / superseded / draft | `neutral` / `draft` / `superseded` | `secondary` + `muted-foreground` |

**Freed-blue change:** the `open` variant (action-blue tint) is **retired from status use.** Any
state that means "open/active/in-flight" maps to `progress` (neutral) — the distinct **label**
carries identity, so it is never color-only. (Keep the `open` variant token defined in StatusPill
for now to avoid a churn, but **no module may assign it**; lint/test guard below.)

**B. Severity / risk** (its own ramp — never blue, never the workflow tints' meanings)

| Severity | Variant | Token |
|---|---|---|
| Low | `neutral` | `secondary` + `muted-foreground` |
| Medium | `warn` | `warning/18` |
| High | `warn` | `warning/18` (bolder weight, same hue) |
| Critical | `lost` | `destructive/10` |

(Fixes `pages/Incidents.tsx:47-52` — `Medium: 'open'` → `Medium: 'warn'`.)

**C. Categorical / type / activity-kind** (non-interactive classification — `violet` + neutrals,
never blue, never a workflow tint)

| Example | Variant |
|---|---|
| Company type Client / Vendor / Internal | `violet` for the highlighted type, `neutral` for the rest — **never `open`** (fixes `pages/Companies.tsx:47-50`) |
| Contact activity Call / Email / Meeting / Note | `violet` / `neutral` (fixes Lens-A M3) |

**StatusPill API:** unchanged (`<StatusPill variant>` — `src/components/ui/StatusPill.tsx`). The
**per-module maps live as a single registry** `src/lib/status/statusVariants.ts` exporting
`workflowVariant(status)`, `severityVariant(sev)`, `categoryVariant(kind)` — each module imports
from it instead of defining its own local `Record<…, StatusVariant>` (today: Incidents
SEVERITY_PILL/STATUS_PILL, Companies TYPE_PILL, etc.). **Guard:** a Vitest assertion that no
registry mapping returns `'open'`, plus a grep-style lint forbidding inline `StatusVariant` maps in
`pages/`.

**Summary:** one workflow map + one severity map + one category map, all blue-free; `open` variant
frozen out of status; per-module maps consolidated into `src/lib/status/statusVariants.ts`.

---

## 3. Shared "molecule" primitive specs (API + what each retires)

All already-existing primitives keep their tokens; we extract thin wrappers / consolidate consumers.

### 3.1 `RecordHeader` (extract — thin wrapper over existing `PageHeader`)
- **API:** `{ icon, iconColor, name, status, meta, stats?, actions }` — identical to `PageHeader`,
  **plus a fixed action contract:** `actions` ALWAYS carries Edit (+ Archive/Delete by permission),
  top-right; `status` is mandatory. Adds a standardized `<RecordActionZone>` slot (see §3.7).
- **Replaces:** the three divergent header layouts (Lens-A C3): Project header
  (`pages/project-detail/ProjectDetailHeader.tsx` — already correct, becomes the template),
  Procurement detail header (`pages/ProcurementDetails.tsx` — **currently NO Edit/Archive in header**),
  Company/Contact drawer footers (move actions to the new record-page header — see §4).
- **Rule:** icon + status presence + top-right action placement are **non-optional** on every record.

### 3.2 `KpiTile` / metric-strip (consolidate consumers — primitives already exist)
- **API:** `KPITile` (`src/components/ui/KPITile.tsx`) for dashboard tiles; `StatTiles`
  (`src/components/ui/StatTiles.tsx`) for the in-header metric strip. No API change.
- **Replaces:** the 3 KPI treatments across Exec/Admin vs PM vs Engineer dashboards (Lens-A I2) and
  the 2 metric-strip chromes (boxed Project header vs borderless Procurement header, Lens-A M2).
  **Rule:** per-role dashboards vary *which* tiles, never *how* a tile looks.

### 3.3 ONE stepper (retire the numbered-circle node stepper)
- **Decision:** the **even-flex BAR stepper** is canonical (DESIGN.md §5; shipped as the Delivery
  milestone stepper). **Retire `LifecycleStepper variant="node"`** (the numbered-circle stepper used
  at `pages/ProcurementDetails.tsx:573-574`). Render the PR→VQ→PO→GR→VI→Paid procurement lifecycle
  with the bar stepper (`done`/`current`/`upcoming`/`paid` states already exist).
- **API:** `LifecycleStepper` keeps `inline` (table-row pips) + the bar variant; the `node` branch
  is deleted after Procurement migrates. The macro funnel band (`Funnel.tsx`) stays as the
  list-level stage-summary (a different scale, not a stepper).

### 3.4 ONE kanban card + ONE project card (consolidate)
- **API:** one `ProjectCard` with size variants `kanban` (compact) | `grid` (full); one `KanbanBoard`
  engine (`src/components/ui/Kanban.tsx` already shared).
- **Replaces:** the 3 project-card vocabularies inside `/projects` (cards-view / kanban / dashboard
  row, Lens-A I3) + the divergent Sales-kanban card — they are ONE entity, so they share ONE card.

### 3.5 `ListPage` shell (extract)
- **API:** `<ListPage title count? primaryAction view? filters? search export? import?>` rendering a
  fixed grammar: **[title + count] … [primary "New &lt;Entity&gt;"]** then a toolbar in **fixed slot
  order: view-switcher · status filters · Search · Filter · Export · Import**. ONE named
  view-switcher (`ViewToggle`) with the **shared label set `Table / Board / Calendar / Cards`** and a
  per-entity default. Empty slots stay in order (no reflow).
- **Replaces:** the per-module toolbar grammars (Lens-A I4, Lens-C C-MIN-3, gpt-A #3). Kills
  "By-stage Board" vs "Kanban" (both → **Board**), and the arbitrary Export/Import placement.
  **Rule:** master-data lists (Companies/Contacts) get Export **and** Import; others get Export where
  applicable — but the *order* is identical everywhere.
- **Filter-vs-view trap (Lens-B Finding-6 / Lens-C C-MIN-1):** the view-switcher renders
  right-aligned (icon segmented); status **filters** render left as text chips — visually distinct so
  the two tab-strips are never confusable.

### 3.6 (covered by 3.5) — view-switcher label set is part of the ListPage contract.

### 3.7 Record-action contract (`RecordActionZone`)
- **API:** a sticky, consistently-placed advance/approve region that is **never below the fold**
  (sticky on desktop, fixed action bar on mobile). Holds the lifecycle-advance verbs (Advance / Mark
  won / Approve / Reject) above the green "Ready to advance" banner (the banner is good — keep it).
  Edit/Archive live in the **header** (§3.1), advance verbs live in the **RecordActionZone** — one
  rule for every record.
- **Replaces:** advance-action placement drift (Lens-B Finding-3): Procurement's Approve/Reject
  buried at page-bottom (`pages/ProcurementDetails.tsx`), Project advance mid-page, contact
  drawer-footer. After migration the advance verb is in the SAME place on every record.

---

## 4. Record-open paradigm (kills P1 / C-CRIT-1)

**Rule:** every primary entity is a routable `/x/:id` page with **breadcrumb + Back + ⌘K indexing**.
Drawers are demoted to optional *quick-peek previews* that carry a URL and an "Open full record"
link — never the only home.

**Drawer → page migrations (must change):**

| Entity | Today | Becomes |
|---|---|---|
| **Company** | drawer on `/companies` (`pages/Companies.tsx`) | `/companies/:id` page w/ `RecordHeader` + breadcrumb + Back + ⌘K |
| **Contact** | drawer on `/contacts` (`pages/Contacts.tsx`, ContactDrawer) — CRM activity timeline lives only in the drawer | `/contacts/:id` page; activity timeline becomes a section of the page |
| **Incident** | **inert rows — dead-end** (`pages/Incidents.tsx`, rows have no onActivate) | `/incidents/:id` page (**new detail view fixes the dead-end bug**) — File → track → investigate → close becomes a real journey |

**⌘K indexing:** add Companies, Contacts, Incidents to `src/hooks/useRecordSearch.ts` (today indexes
only projects / pipeline / procurements) once the routes exist — closes the "looks global, is
partial" gap (Lens-C C-CRIT-2).

**Stage-aware project lens (ADR-0020 single record):** the one `/projects/:id` record shows a
**pipeline lens pre-win** (Value / Win probability / Weighted; no S-curve, no delivery-phase
stepper) and a **delivery lens post-win** (Contract/Committed/Actual strip, S-curve, milestone
stepper, Budget/Procurement/Tasks/Documents tabs). The breadcrumb already computes the stage group
(`projectStatusGroup` / `recordStatusGroupForPath`); thread the SAME signal into body/tab
visibility so a pre-win prospect never shows the delivery shell (fixes Lens-C C-IMP-1; the
`PipelineLens` component already exists — `pages/project-detail/PipelineLens.tsx`).

---

## 5. Approvals — one inbox (kills P7 / C-IMP-4)

`/approvals` is the **single canonical inbox** for ALL approval types (timesheets + procurement +
future), with **per-module deep-link tabs** (filtered views INTO the one inbox), one approval row
pattern (`src/components/ui/ApprovalRow.tsx` — extend, don't fork), and one decision affordance
(inline Approve/Return + an "Open" link for both PR and timesheet rows). **Retire** the duplicate
surfaces: the Timesheets "Approvals queue" tab (`pages/timesheets/ApprovalsQueue.tsx`) and the
Procurement "Needs approval" filter become deep-links into `/approvals`, not parallel
implementations. Align rail label + page H1 to **"Approvals"** (§1).

---

## 6. Phased migration order (risk / coherence-per-effort)

> **Director note:** within a phase, items marked **[PARALLEL-SAFE]** touch disjoint files and may be
> dispatched concurrently; **[SEQUENTIAL]** items share files or must land on top of an earlier
> primitive. Phase 2's primitive extractions are **single-composing-hand** work (this is the work
> that *caused* the drift — do not re-fragment it).

### Phase 1 — cheap, parallel-safe (string + bug sweep; no shared-primitive dependency)
| Item | Files | Parallel? | Collision notes |
|---|---|---|---|
| Terminology map (§1) | `pages/Projects.tsx`, `components/ProjectFormModal.tsx`, `pages/SalesPipeline.tsx`, `pages/AdminUsers.tsx`, `src/hooks/useRecordSearch.ts`, the 4 e2e specs | **[PARALLEL-SAFE]** | each file distinct; e2e string updates ride with their page |
| Status/severity registry (§2) | NEW `src/lib/status/statusVariants.ts`; rewire `pages/Incidents.tsx`, `pages/Companies.tsx`, `pages/Contacts.tsx`, Timesheets | **[SEQUENTIAL within item]** (registry first, then consumers) but **[PARALLEL-SAFE]** vs terminology | registry is net-new; consumers edited after |
| NaN/$NaN + ISO-vs-human date sweep | `pages/Projects.tsx` budget cells, `src/lib/format.ts`, Incidents/Tasks date cells | **[PARALLEL-SAFE]** | display-only; `—`/"No budget linked" fallback |
| ⌘K index Companies/Contacts | `src/hooks/useRecordSearch.ts` | **[SEQUENTIAL]** — depends on §4 routes existing; if routes not yet built, index to the list w/ a filter param as interim | collides with terminology edit on same file — sequence them |
| Role-invariant `/projects/:id` default tab | project-detail routing (role no longer mutates default; engineer CTA → `/projects/:id/tasks`) | **[PARALLEL-SAFE]** | |
| Exec dashboard mobile↔desktop reconcile | `pages/ExecutiveDashboard.tsx`, `src/components/dashboard/MobileExecutiveDashboard.tsx` | **[PARALLEL-SAFE]** | make mobile a reflow of the desktop widgets/copy |
| Eager-validation consistency | `src/components/ui/EntityFormModal.tsx` + `useEntityForm` | **[PARALLEL-SAFE]** | validate on blur/submit; drop pre-emptive banner; one submit-state rule (shared shell → fixes all modals at once) |
| Admin "Add user" → enable + "New user" | `pages/AdminUsers.tsx` | **[PARALLEL-SAFE]** | also a terminology entry |

### Phase 2 — shared primitives (single composing hand; extract THEN migrate)
| Item | Files | Sequence |
|---|---|---|
| Extract `RecordHeader` (§3.1) | NEW wrapper over `PageHeader`; template = `ProjectDetailHeader.tsx` | **[SEQUENTIAL]** — extract first |
| Consolidate `KpiTile`/metric-strip consumers (§3.2) | role dashboards + Procurement header → `StatTiles` | [PARALLEL after RecordHeader] |
| Retire `node` stepper → bar stepper (§3.3) | `src/components/ui/LifecycleStepper.tsx` (delete node branch), `pages/ProcurementDetails.tsx:573` | **[SEQUENTIAL]** — migrate Procurement before deleting branch |
| One `ProjectCard` + `KanbanBoard` (§3.4) | `src/components/ui/Kanban.tsx`, projects cards/kanban + sales kanban | [PARALLEL after RecordHeader] |
| `RecordActionZone` (§3.7) | NEW; consumed by every record page | **[SEQUENTIAL]** — extract first, used in Phase 3 |

### Phase 3 — record-open paradigm + list shell + approvals (depends on Phase-2 primitives)
| Item | Files | Sequence |
|---|---|---|
| `ListPage` shell (§3.5) | NEW `src/components/ui/ListPage.tsx`; refit Companies/Contacts/Projects/Procurement/Incidents/Sales | **[SEQUENTIAL]** extract; then **[PARALLEL-SAFE]** per-page refit (disjoint files) |
| Drawer→page: Company `/companies/:id` (§4) | `pages/Companies.tsx` + new detail page + route | **[PARALLEL-SAFE]** vs Contact/Incident |
| Drawer→page: Contact `/contacts/:id` (§4) | `pages/Contacts.tsx` + new detail page + route | **[PARALLEL-SAFE]** vs Company/Incident |
| Incident detail `/incidents/:id` (§4, fixes dead-end) | `pages/Incidents.tsx` + new detail page + route | **[PARALLEL-SAFE]** vs Company/Contact |
| Stage-aware project lens (§4) | project-detail body/tab visibility off `projectStatusGroup` | **[SEQUENTIAL]** — uses RecordHeader/ActionZone |
| Record-action contract rollout (§3.7) | every record page adopts `RecordActionZone` | **[SEQUENTIAL]** — after the new detail pages exist |
| Approvals one-inbox (§5) | `pages/Approvals.tsx`, retire `pages/timesheets/ApprovalsQueue.tsx` tab + Procurement filter | **[SEQUENTIAL]** — uses RecordActionZone/ApprovalRow |

**Per-phase parallel-vs-sequential headline:** Phase 1 = mostly **parallel** (only ⌘K-index and the
status-registry-then-consumers are internally sequenced). Phase 2 = **sequential extraction** (single
hand), then parallel consumer migration. Phase 3 = **sequential** shells/contracts first, then the
three drawer→page pages parallelize (disjoint files).

---

## 7. DESIGN.md additions (done in this PR)
The canonical patterns are added to `DESIGN.md` as the enforced standard: §5 RecordHeader spec, the
ONE-stepper rule (node stepper retired), the **freed-blue** status/severity/category three-family
map + StatusPill registry pointer, the ListPage shell + view-label set, the KpiTile/metric-strip
single-treatment rule, the record-open rule (every primary entity routable; drawers are previews),
the RecordActionZone contract, and the terminology + create-verb scheme. See DESIGN.md §5
"Coherence-Wave canonical molecules" + the new "Named Rules" entries.

---

## Open questions / proposed additions for the owner

- **[OWNER-ESCALATION] Workflow "open/active" loses its blue tint.** Freeing the action-blue means
  the most common state ("Open"/"Active"/"In progress") becomes a **neutral grey** `progress` pill
  (label carries identity). That is correct per the One-Blue Rule but is a visible change to the most
  frequent pill in the app. Confirm: neutral-grey "Open" is acceptable, OR add ONE new categorical
  non-blue hue (e.g. indigo `~243°`, distinct from the `221°` action-blue) reserved for "in-flight
  workflow" — a **proposed new token**, owner sign-off required (would be the first palette addition
  since extraction; flagged because "never invent a new brand color" is the standing rule).
- **[OWNER-ESCALATION] Drawer fully retired, or kept as a peek-preview?** The audit's strict reading
  is "every primary record is a page." Recommended: Company/Contact/Incident get real pages
  (mandatory), and the drawer is retained ONLY as an optional fast-preview that links to the page.
  Confirm whether to keep any drawer at all, or delete it outright (simpler, one model).
- **[OWNER-ESCALATION] "Pipeline" as the Sales index page title** — copy says noun=Project
  everywhere; the Sales list is a stage-filtered view of Projects. Confirm the page title "Pipeline"
  (a stage label) is acceptable vs. e.g. "Projects · Pipeline".
- **Engineer `/projects/:id` entry** — making the URL role-invariant means engineers land on
  Overview, not Tasks. Confirm their CTAs should deep-link to `/projects/:id/tasks` (recommended)
  rather than mutating the default — a small UX behavior change.
