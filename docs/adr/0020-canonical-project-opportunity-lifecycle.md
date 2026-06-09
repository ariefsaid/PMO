# ADR-0020 — Canonical project/opportunity lifecycle (Model B: one record, one route, stage-adaptive lens)

Status: Accepted (owner-approved Model B). **§1 (stage-adaptive lens that hid the delivery tabs
pre-win) is SUPERSEDED by [ADR-0021](0021-unified-project-detail-page.md)** — the detail page is now
UNIFIED (delivery tabs at every stage + a deal-progression banner pre-win), per owner directive after
seeing §1 rendered ("its not usable currently"). §2-5 (canonical route, `/sales` redirect, disjoint
list partitions, breadcrumb, single ⌘K index) stand unchanged.
Date: 2026-06-08
Audit basis: `review/ia-navigation.md` §2 (F1/F2/F3 blockers) + §3 (Model B recommendation, owner-approved).
Plan: `docs/plans/2026-06-08-ux-naturalness-wave1.md` (Area 1).
Companion: `docs/adr/0019-server-enforced-sod-and-delete-gating-for-crud.md` (the win-path SoD RPC, untouched here),
`src/lib/db/projectTransitions.ts` (`transition_project`, `LEGAL_PROJECT_TRANSITIONS`, `projectStatusGroup` — the single lifecycle authority, untouched).

## Context

One `projects` table is today exposed as **two lists feeding two detail pages**, which the IA audit
rates the single biggest structural break in the app:

- **Two lists, overlapping:** `Projects.tsx` calls `listProjects()` with **no status filter**, so it
  shows ALL non-archived projects — including the 5 pipeline statuses (`Leads`, `PQ Submitted`,
  `Quotation Submitted`, `Tender Submitted`, `Negotiation`). `SalesPipeline.tsx` calls
  `get_sales_pipeline()` — exactly those same 5 statuses. A `Tender Submitted` deal is therefore an
  **active row in both lists at once** (F2).
- **Two detail pages, entry-point-dependent:** the same `projects` row renders at `/projects/:id`
  (`ProjectDetail.tsx` — delivery lens: StatTiles, contract-value SoD editor, 5 tabs) AND at
  `/sales/:id` (`OpportunityDetail.tsx` — sales lens: Value/Win-probability/Weighted stats, deal
  stepper, Advance/Mark won/Mark lost). Open a pre-win `Leads` deal from the Projects list and you get
  the delivery lens (a contract-value SoD editor on a deal that has no contract yet); open it from the
  Pipeline and you get the sales lens. Same record, two completely different pages (F1).
- **Two back-targets / breadcrumbs** for one record (F3), and **⌘K double-indexes** every pipeline row
  (`useRecordSearch.ts`: once as a `Project` → `/projects/:id`, once as a `Sales Pipeline` row →
  `/sales/:id`).

This breaks Nielsen #4 (Consistency & Standards) and the IA first principle that an entity has ONE
canonical home / ONE URL. The state machine itself is already correct and unambiguous — the break is
entirely in routing + list scoping + which component renders, i.e. **presentation only**.

## Decision

**Adopt Model B: ONE canonical record at ONE route, rendering a stage-adaptive lens; the two lists
become disjoint stage partitions of the same table. FE-only. No schema or data migration.**

### 1. One canonical detail route with a stage-adaptive lens

`/projects/:projectId` is the single detail route for every project/opportunity at every stage.
`ProjectDetail.tsx` chooses the lens by `projectStatusGroup(project.status)` (the existing pure
function, untouched):

- `pipeline | lost` → render a **`<PipelineLens>`** panel — the current `OpportunityDetail.tsx` body
  (deal-journey stepper + Value / Win-probability / Weighted / Owner / Decision stats + Advance / Mark
  won / Mark lost, with its inline SoD won-capture panel). The delivery tabs (Budget / Procurement /
  Tasks) are **hidden** pre-win — a won-from-lead deal has not accrued budget/PRs/tasks yet, so hiding
  is the honest presentation, not an empty-tab tease.
- `onHand | internal` → the current **delivery lens** (`ProjectDetailHeader` StatTiles, the
  contract-value SoD editor, the 5 tabs Overview/Budget/Procurement/Tasks/Documents).
- The **shared header** (icon + name + StatusPill + meta) and the **breadcrumb** are identical across
  lenses, so a record's wayfinding is the same regardless of where you arrived from.

`OpportunityDetail.tsx`'s UI is extracted to `<PipelineLens>` and lives on inside `ProjectDetail`; it
is retired as a *route target* (see redirect below).

### 2. `/sales/:opportunityId` redirects to the canonical route

`/sales/:opportunityId` becomes a client `<Navigate replace>` to `/projects/:opportunityId`, keeping
old deep links and any cached ⌘K rows alive during transition. (`:opportunityId` IS the `projects.id` —
no id translation.) `OpportunityDetail` is no longer mounted by a route.

### 3. `listProjects` is scoped to the on-hand ∪ internal partition

`listProjects()` defaults to `status in (ON_HAND_STATUSES ∪ INTERNAL_STATUSES)` (the two arrays already
exported from `projectTransitions.ts`). A `Tender Submitted` deal no longer appears in the active
Projects list — it lives in the Pipeline until won. The Pipeline (`get_sales_pipeline`, the 5 pre-win
statuses) and the Projects list (on-hand ∪ internal) become **disjoint stage partitions** of one table:
a record is in exactly one *active* list at a time. `Loss Tender` (terminal) **stays in the Pipeline**
(the sales module): visible as a terminal **"Lost" column in the kanban** and behind a **"Lost" filter**
in the pipeline table (standard CRM win/loss history) — but **excluded from the active Projects
(delivery) list**, since a lost deal was never delivered work. (Fixing the kanban's existing Won/Lost
column clipping — an IxD finding — is what makes the Lost column actually reachable.)
The Projects "Leads" SegFilter tab is removed (the pre-win partition is the Pipeline's; the surviving
filters are All / My Projects / Ongoing / Completed).

> The win transition is unchanged: a deal stays in the Pipeline through `transition_project(... 'Won,
> Pending KoM')`, after which it satisfies `ON_HAND_STATUSES` and so appears in the Projects list on the
> next `listProjects` refetch. No conversion step, no row copy — the same row simply changes which
> partition it satisfies.

### 4. Breadcrumb ancestry follows the stage; ⌘K indexes once

The breadcrumb resolves ancestry by `projectStatusGroup`: `pipeline | lost` →
`Sales Pipeline > <name>`; `onHand | internal` → `Projects > <name>`. One page, stage-correct crumb.
⌘K (`useRecordSearch`) indexes a pipeline-status record **once** (a single canonical drill to
`/projects/:id`). After the `listProjects` scope change the projects cache no longer holds pre-win rows,
so the pipeline cache becomes the sole source of pre-win ⌘K rows — the dedupe is largely automatic; the
sales row's `run()` is repointed from `/sales/:id` to `/projects/:id`.

### 5. The state machine, RLS, and SoD are untouched

`transition_project`, `LEGAL_PROJECT_TRANSITIONS`, `projectStatusGroup`, `set_project_contract_value`
(ADR-0019), and every RLS policy are unchanged. This ADR moves zero data and adds zero migrations — it
is routing (one redirect), components (one lens extraction + a stage switch), one list-query scope, one
breadcrumb stage-rule, and one ⌘K repoint.

## Alternatives considered

**Model A — separate `opportunities` table + explicit Convert-at-Won.** The cleaner long-term domain
model: sales opportunities get their own table + RLS + a conversion RPC that creates a `projects` row on
win (CRM "Convert Lead"); the two lists never share a row because they read different tables. Rejected
**now** because it is a multi-migration, server-heavy program: a new table + RLS policies, a conversion
RPC, a data migration to split existing rows by status, and a rewrite of everything that treats the
lifecycle as one continuum (`transition_project`, `LEGAL_PROJECT_TRANSITIONS`, `projectStatusGroup`, the
dashboard RPCs, win-rate). It touches the SoD RPCs and the pgTAP suite. Model B removes the entire
blocker class (F1/F2/F3) with FE-only changes and zero schema risk.

**Kept on the roadmap as the deferred end-state.** When the sales process grows pipeline-only structure
that a shared `projects` row would strain (multi-contact deals, quote versioning, forecast categories),
the Convert-at-Won boundary pays for itself. Model B is a clean stepping-stone: `<PipelineLens>` becomes
the future `opportunities` detail page largely intact.

## Consequences

- **Positive:** one record, one URL, one breadcrumb, one ⌘K row; the lists stop overlapping; a new Lead
  lives in the Pipeline, not the active Projects list; the delivery lens (and its SoD editor) never
  appears on an unwon deal; zero migration risk; the existing identity, state machine, and RLS authority
  are preserved.
- **Negative / watch:** `<PipelineLens>` and the delivery tabs now co-exist in one component file —
  keep them cleanly separated so the future Model-A extraction is a lift, not a rewrite. The redirect
  route is transitional; once external links are confirmed migrated it can be dropped. A user who wants
  to see lost deals must use a filter/record route rather than the active Projects list (acceptable —
  lost deals are terminal, not active work).
- **Tabs-as-URL (F5) is explicitly out of scope here** (deferred to Wave 2/IA): this ADR does not
  promote project tabs to a URL param; the `/projects/:id/budget` deep-link is left as-is. Model B does
  not require it.
