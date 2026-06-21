# Feature: Procurement Reserved budget layer (DecisionSupportPanel)

> **Authority:** ADR-0034 (PROPOSED). Extends OD-BUDGET-2 (Committed basis — **unchanged**) and OD-W5-4
> (committed-basis budget impact). Consumes ADR-0017 (repository seam), ADR-0001 (org_id seam), ADR-0010
> (test pyramid), ADR-0033 (procurement case folder).
> Glossary: **Committed** (Σ `total_value` in {Ordered, Received, Vendor Invoiced, Paid}, OD-BUDGET-2 —
> unchanged), **Reserved** (Σ `total_value` in {Approved, Vendor Quoted, Quote Selected} — approved,
> not yet ordered), **Available** (Budget − Committed − Reserved), **This request** (the viewed case's
> own `total_value`).

## Overview

The procurement case Overview tab's "Budget impact" card (`pmo-portal/pages/procurement/DecisionSupportPanel.tsx`)
today shows four tiles (This request / Remaining vs. committed / Project budget / After this request) drawn
from two figures: **Budget** (`useProjectBudget`) and **Committed** (`useProjectCommittedSpend`, the
OD-BUDGET-2 basis). It has two defects: (1) it ignores **approved-but-not-yet-ordered** demand on the same
project, so an approver can over-commit the budget unwarned; (2) it always subtracts `thisRequest` from the
remaining figure even when the viewed case is itself already committed, double-counting.

This feature adds a **distinct Reserved layer** (status ∈ {Approved, Vendor Quoted, Quote Selected}) without
touching Committed, introduces the over-commitment-safe **Available = Budget − Committed − Reserved**, fixes
the double-count via per-stage tile math, and limits the panel to the request + approval phases (pre-Ordered).

**User value:** *When I'm approving a procurement, I want to see not just what's already spent but what's
already earmarked by other approved requests, so I don't over-commit the project budget.*

**Tags:** Every `[OWNER-DECISION-#]` below requires the owner's ruling before build.

---

## Functional Requirements (EARS)

### Reserved DAL read

**FR-RB-001 — Reserved-spend DAL function.**
The system shall provide `getProjectReservedSpend(projectId: string): Promise<number>` in
`pmo-portal/src/lib/db/procurements.ts` that returns the Σ of `total_value` over `procurements` rows where
`project_id = projectId` AND `status ∈ RESERVED_STATUSES`, returning `0` when no such rows exist.

**FR-RB-002 — Reserved status set.** `[OWNER-DECISION-1]`
The system shall define `RESERVED_STATUSES = ['Approved', 'Vendor Quoted', 'Quote Selected']`
(exactly these three `procurement_status` enum values — post-approval, pre-PO). It shall **exclude**
`Draft`, `Requested` (not yet approved), `Ordered`, `Received`, `Vendor Invoiced`, `Paid` (already
Committed), `Rejected`, `Cancelled` (terminal). *Default if ambiguous: Vendor Quoted and Quote Selected
ARE reserved (approved-and-progressing-pre-PO).*

**FR-RB-003 — Org scoping with no client org_id.**
When `getProjectReservedSpend` queries Supabase, the system shall **not** send `org_id`; row scoping shall
be enforced solely by RLS (`org_id = auth_org_id()` on `procurements`). No new RLS policy, RPC, or
migration is introduced.

**FR-RB-004 — Committed basis is unchanged.**
The system shall leave `COMMITTED_STATUSES`, `getProjectCommittedSpend`, and every Committed-basis consumer
(migration 0009, 0026 `get_projects_delivery.committed_spend`, `projects.spent`, the drift guard) **exactly
as-is**. RESERVED_STATUSES and COMMITTED_STATUSES shall be disjoint.

**FR-RB-005 — Reserved read hook.**
The system shall provide `useProjectReservedSpend(projectId: string | null | undefined)` in
`pmo-portal/src/hooks/useProcurements.ts` returning a React Query result with query key
`['project-reserved-spend', orgId, projectId]`, `queryFn: () => getProjectReservedSpend(projectId)`, and
`enabled: Boolean(orgId && projectId)` — mirroring `useProjectCommittedSpend`.

### Available formula & tile math

**FR-RB-010 — Available formula.**
The panel shall compute `available = budget − committed − reserved` (the over-commitment-safe headroom),
where `budget`, `committed`, `reserved` are the resolved values of the three reads (each defaulting to `0`).

**FR-RB-011 — Reserved tile.**
While the panel is visible, the system shall render a **"Reserved"** tile showing
`formatCurrency(otherReserved)` with sub-line **"approved, not yet ordered"** (see FR-RB-014 for
`otherReserved`). The label **"Reserved"** and sub-line shall never use the word "encumbered".

**FR-RB-012 — Available tile.**
While the panel is visible, the system shall render an **"Available"** tile showing
`formatCurrency(available)` with tone `neg` when `available < 0`.

**FR-RB-013 — Per-stage "After this request" math (double-count fix).** `[OWNER-DECISION-2]` (boundary)
The system shall compute the "After this request" figure as:
```
caseInReserved = status ∈ {Approved, Vendor Quoted, Quote Selected}
afterRequest   = available − (caseInReserved ? 0 : thisRequest)
```
i.e. **subtract `thisRequest` only when the viewed case is NOT already inside Reserved** ({Draft,
Requested}); when the case is already in Reserved, its value is already in `reserved`, so `afterRequest =
available` (no second subtraction).

**FR-RB-014 — Other-vs-this Reserved framing.** `[OWNER-DECISION-3]`
The Reserved tile (FR-RB-011) shall show **other** Reserved — Reserved excluding the current case:
```
otherReserved = reserved − (caseInReserved ? thisRequest : 0)
```
so an approver sees other concurrent demand distinct from "this request". *The headroom math (Available,
afterRequest) uses TOTAL `reserved`, not `otherReserved`.* Default: show `otherReserved` on the tile.

### Panel visibility

**FR-RB-020 — Pre-Ordered visibility boundary.** `[OWNER-DECISION-2]`
The system shall render the panel **only** while the case status ∈ {Draft, Requested, Approved, Vendor
Quoted, Quote Selected}, and shall render **nothing** (return `null`) when status ∈ {Ordered, Received,
Vendor Invoiced, Paid, Rejected, Cancelled}. *Recommended boundary; hiding post-commit also makes the
double-count path structurally impossible.* The existing `projectId`-null suppression (panel returns `null`
when `projectId` is falsy) is retained and takes precedence.

**FR-RB-021 — Panel receives status.**
The system shall pass the case's current `status` (a `ProcurementStatus`) into `DecisionSupportPanel` as a
prop so it can apply FR-RB-013 / FR-RB-020. The caller (`ProcurementDetails` Overview tab) shall supply it
from the loaded detail.

### States

**FR-RB-030 — Loading state.**
While any of the three reads (budget, committed, reserved) is pending and the panel is otherwise visible,
the system shall render the existing skeleton loading card (no tiles).

**FR-RB-031 — Error state.**
While any of the three reads is in error and the panel is otherwise visible, the system shall render the
existing "Budget unavailable" message card (no tiles).

**FR-RB-032 — No-budget (empty) state.**
When `budget === 0` and the panel is otherwise visible, the system shall render the existing "No active
budget set for this project" message card (no tiles, no Reserved/Available figures).

### Advisory

**FR-RB-040 — Over-available advisory.**
When the case status ∈ {Draft, Requested} (not yet in Reserved) AND `thisRequest > available`, the system
shall render a non-blocking advisory (role="status", `ErrBanner`) stating the request exceeds available
budget by `formatCurrency(thisRequest − available)` and that approval is still permitted (advisory only).

**FR-RB-041 — Already-reserved info (no false advisory).** `[OWNER-DECISION-3]`
When the case status ∈ {Approved, Vendor Quoted, Quote Selected} (already in Reserved), the system shall
**not** show the over-available advisory based on `thisRequest` (it is already counted in `reserved`).
Instead, when `available < 0` (the project is over-committed across all reserved+committed demand), it shall
show a non-blocking advisory that the project is over budget by `formatCurrency(-available)`.

## Non-Functional Requirements

**NFR-RB-PERF-001 — One extra read, cached.**
The Reserved read shall be a single org-scoped PostgREST select (no N+1), cached by React Query under its
org-scoped key, adding exactly one round-trip parallel to the existing two.

**NFR-RB-SEC-001 — Zero new tenancy surface.**
The feature shall add no RLS policy, RPC, migration, or client-side `org_id` threading; org isolation of the
Reserved sum shall rely on the unchanged `procurements` SELECT RLS policy.

**NFR-RB-A11Y-001 — Text-not-color-only.**
The Reserved and Available tiles shall convey meaning via text labels + tabular numerals (per DESIGN.md §4),
never color alone; negative tones add a text/`neg` cue, not a color-only signal.

---

## Acceptance Criteria (Given/When/Then)

**AC-RB-001 — Reserved sum over the reserved status set (unit/pgTAP).**
*Given* a project with procurements of mixed statuses, *When* `getProjectReservedSpend(projectId)` runs,
*Then* it returns the Σ `total_value` of rows in {Approved, Vendor Quoted, Quote Selected} and excludes all
other statuses. *(Owns FR-RB-001, FR-RB-002.)*

**AC-RB-002 — Reserved is org-scoped (pgTAP).**
*Given* two orgs each with reserved-status procurements on like-named projects, *When* a user of org A reads
Reserved for their project, *Then* only org A rows are summed (RLS), and no `org_id` is sent by the client.
*(Owns FR-RB-003.)*

**AC-RB-003 — Committed basis unchanged & disjoint (unit/pgTAP).**
*Given* the COMMITTED_STATUSES and RESERVED_STATUSES sets, *When* compared, *Then* they are disjoint, and
`getProjectCommittedSpend` still sums exactly {Ordered, Received, Vendor Invoiced, Paid}. *(Owns FR-RB-004.)*

**AC-RB-004 — Available = Budget − Committed − Reserved (unit).**
*Given* budget=1000, committed=300, reserved=200, *When* the panel computes Available, *Then* it shows
$500. *(Owns FR-RB-010, FR-RB-012.)*

**AC-RB-005 — Reserved tile shows other-reserved with sub-line, never "encumbered" (unit).**
*Given* a visible panel with total reserved=200 of which this case contributes 50 (case in Reserved),
*When* rendered, *Then* the Reserved tile shows $150 ("approved, not yet ordered"), and the rendered text
contains no "encumber"/"encumbered". *(Owns FR-RB-011, FR-RB-014.)*

**AC-RB-006 — At Requested, After = Available − thisRequest (unit).**
*Given* status=Requested, available=500, thisRequest=120, *When* the panel computes "After this request",
*Then* it shows $380. *(Owns FR-RB-013 [Draft/Requested branch].)*

**AC-RB-007 — At Approved, After = Available (no double-subtract) (unit).**
*Given* status=Approved, this case's 120 already inside reserved (available=500 already net of it),
thisRequest=120, *When* the panel computes "After this request", *Then* it shows $500 (NOT $380) — the case
is not subtracted twice. *(Owns FR-RB-013 [Approved branch].)*

**AC-RB-008 — Panel visible Draft..Quote-Selected (unit).**
*Given* status ∈ {Draft, Requested, Approved, Vendor Quoted, Quote Selected} and a non-zero budget, *When*
the panel renders, *Then* the Budget-impact card is shown. *(Owns FR-RB-020 [visible branch], FR-RB-021.)*

**AC-RB-009 — Panel hidden Ordered..Paid + terminal (unit).**
*Given* status ∈ {Ordered, Received, Vendor Invoiced, Paid, Rejected, Cancelled}, *When* the panel renders,
*Then* it renders nothing (no card, no tiles). *(Owns FR-RB-020 [hidden branch].)*

**AC-RB-010 — Loading state (unit).**
*Given* a visible-status case and a pending read, *When* the panel renders, *Then* the skeleton card is
shown (no tiles). *(Owns FR-RB-030.)*

**AC-RB-011 — Error state (unit).**
*Given* a visible-status case and a read in error, *When* the panel renders, *Then* the "Budget
unavailable" message card is shown (no tiles). *(Owns FR-RB-031.)*

**AC-RB-012 — No-budget state (unit).**
*Given* a visible-status case with budget=0, *When* the panel renders, *Then* the "No active budget set"
message card is shown (no Reserved/Available figures). *(Owns FR-RB-032.)*

**AC-RB-013 — Over-available advisory at Requested (unit).**
*Given* status=Requested, available=100, thisRequest=250, *When* the panel renders, *Then* a non-blocking
role="status" advisory states the request exceeds available budget by $150 and approval is still permitted.
*(Owns FR-RB-040.)*

**AC-RB-014 — No false advisory when already reserved; over-budget info instead (unit).**
*Given* status=Approved with this case already in reserved and `available ≥ 0`, *When* the panel renders,
*Then* no over-available advisory based on thisRequest is shown; *and given* available < 0, *Then* an
over-budget advisory states the project is over budget by `|available|`. *(Owns FR-RB-041.)*

---

## Traceability (per ADR-0010 — one owning layer per AC)

| AC | Behavior | Owning layer | Location |
|----|----------|--------------|----------|
| AC-RB-001 | Reserved sum over status set | **Unit** (Vitest, mocked supabase) | `src/lib/db/procurements.test.ts` |
| AC-RB-002 | Reserved org-scoping (RLS) | **pgTAP** (the only honest layer for RLS) | `supabase/tests/*_reserved_spend.test.sql` |
| AC-RB-003 | Committed unchanged & disjoint | **Unit** (set assertion) + reuse existing drift pgTAP | `src/lib/db/procurements.test.ts` |
| AC-RB-004 | Available formula | **Unit** (RTL render) | `pages/procurement/DecisionSupportPanel.test.tsx` |
| AC-RB-005 | Other-reserved tile, no "encumbered" | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-006 | After = Available − thisRequest (Requested) | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-007 | After = Available (Approved, no double-count) | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-008 | Panel visible Draft..Quote-Selected | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-009 | Panel hidden Ordered..terminal | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-010 | Loading state | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-011 | Error state | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-012 | No-budget state | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-013 | Over-available advisory (Requested) | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-014 | No false advisory / over-budget info (Approved) | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |

**No new E2E.** No new real cross-stack journey is introduced — the panel is a read-only derivation over
existing data; its math and states are fully owned at the unit layer, and the single tenancy contract is
owned by pgTAP. The existing procurement e2e journeys remain the cross-stack coverage. *(ADR-0010: never
push an AC up a layer to satisfy a convention — RLS stays pgTAP, math/states stay unit.)*

---

## Out of scope (this issue)

- **Project budget page** (`pages/ProjectBudget.tsx`) surfacing Reserved — **[OWNER-DECISION-4]**,
  recommended **follow-up** (panel-only this issue) for consistency once the panel pattern is validated.
- Per-category Reserved roll-up onto `budget_line_items` (OD-BUDGET-2 deferred portion).
- Any change to Committed basis, dashboards, RPCs, RLS, or migrations.
- A PO-commitment approval gate / cashflow (OD-W5-5 — deferred to its own track).

---

## Open questions for the owner (`[OWNER-DECISION]` summary)

1. **[OWNER-DECISION-1] Reserved status set.** Confirm `{Approved, Vendor Quoted, Quote Selected}`
   (recommended). In particular: do Vendor Quoted / Quote Selected count as Reserved? (Default: yes.)
2. **[OWNER-DECISION-2] Visibility boundary.** Confirm panel visible for {Draft, Requested, Approved,
   Vendor Quoted, Quote Selected} and hidden Ordered+ (recommended — also eliminates the double-count).
3. **[OWNER-DECISION-3] Total vs. other Reserved on the tile.** Confirm the Reserved **tile** shows
   *other* Reserved (excluding this case), while headroom math uses *total* Reserved (recommended). This
   also drives the FR-RB-041 "no false advisory when already reserved" behavior.
4. **[OWNER-DECISION-4] Project budget page.** Confirm Reserved is **panel-only this issue**, with the
   ProjectBudget page as a follow-up (recommended).
