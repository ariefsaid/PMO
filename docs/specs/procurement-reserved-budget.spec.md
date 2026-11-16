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

**FR-RB-010 — Left formula.** *(Amended by OD-APPROVAL-LEFT; was Available = budget − committed − reserved.)*
The panel shall compute `left = budget − spent − openOrders − reserved`, in exact cents, where `spent` is the
project header's recorded spending (paid pre-tax on PMO, ledger actual on ERP), `openOrders` is the order total
less the part `spent` already holds (PMO: the same reading's open commitment; ERP: `project_committed_spend`),
and `reserved` is the TOTAL Reserved. Each amount is counted once. When `spent` or `openOrders` is not known
the panel shall not draw `left` as a number (FR-RB-017).

**FR-RB-011 — Reserved tile.**
While the panel is visible, the system shall render a **"Reserved"** tile showing
`formatCurrency(otherReserved)` with sub-line **"approved, not yet ordered"** (see FR-RB-014 for
`otherReserved`). The label **"Reserved"** and sub-line shall never use the word "encumbered".

**FR-RB-012 — (removed) Available tile.** *(Amended by OD-APPROVAL-LEFT.)*
The purchasing-only "Not yet committed to purchases" / "Available" tile is removed; the single decision
figure is "Left after this purchase" (FR-RB-013). The panel's tiles are: Procurement total · Reserved ·
Budget used · Project budget · Left after this purchase.

**FR-RB-013 — Per-stage "Left after this purchase" math (double-count fix).** `[OWNER-DECISION-2]` (boundary) *(Amended by OD-APPROVAL-LEFT.)*
The system shall compute the "Left after this purchase" figure as:
```
counted      = status ∈ {Approved, Vendor Quoted, Quote Selected}   (already in reserved)
             or status ∈ {Ordered, Received, Vendor Invoiced, Paid}  (already an order: open part in openOrders, paid part in spent)
afterRequest = left − (counted ? 0 : thisRequest)
```
i.e. **subtract `thisRequest` only when the viewed case is NOT already counted** ({Draft, Requested}); the
Ordered..Paid branch is reached only by the record header line ("Left in budget X"), which uses the same
helper. The tile is labelled "Left after this purchase" with sub-line "After spending, orders and reserved"
and a tooltip stating the formula; the bar caption is "Spent or committed, with this one: N%" (N = the exact
complement of the figure).

**FR-RB-014 — Other-vs-this Reserved framing.** `[OWNER-DECISION-3]`
The Reserved tile (FR-RB-011) shall show **other** Reserved — Reserved excluding the current case:
```
otherReserved = reserved − (caseInReserved ? thisRequest : 0)
```
so an approver sees other concurrent demand distinct from "this request". *The Left math (left,
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
While any of the reads (budget, committed, reserved, the project's budget positions, purchasing ownership) is
pending and the panel is otherwise visible, the system shall render the existing skeleton loading card (no
tiles), so the decision figure never flashes "not known".

**FR-RB-031 — Error state.**
While any of the three reads is in error and the panel is otherwise visible, the system shall render the
existing "Budget unavailable" message card (no tiles).

**FR-RB-032 — No-budget (empty) state.**
When `budget === 0` and the panel is otherwise visible, the system shall render the existing "No active
budget set for this project" message card (no tiles, no Reserved/Available figures).

### Advisory

**FR-RB-040 — Over-budget advisory (one).** *(Amended by OD-APPROVAL-LEFT; merges the former over-available and already-reserved advisories.)*
When `afterRequest < 0` and Left is known, the system shall render ONE non-blocking advisory (role="status",
`ErrBanner`) titled "Over budget" stating `formatCurrency(−afterRequest)` over the budget after this purchase,
and that approval is still permitted (advisory only). Both former amounts were exactly `−afterRequest`.

**FR-RB-041 — Already-reserved: no false advisory.** `[OWNER-DECISION-3]`
When the case status ∈ {Approved, Vendor Quoted, Quote Selected} (already in Reserved), the advisory is based
on the same `afterRequest`, which does not subtract the request again; it shows only when `afterRequest < 0`.

**FR-RB-017 — Unknown is never drawn as a number.** *(OD-APPROVAL-LEFT.)*
When `spent` or `openOrders` is not known (failed read, no ledger reading for the project, a reading or open
orders in another currency, purchasing kept outside PMO, no committed position yet), the Left tile shall show
its reason (inside a figure scope it is counted in the page's hidden-figures line; outside one the tile reads "Not known" when
only spending is unknown), and the bar and the
advisory shall not be drawn. When **only `spent`** is unknown and open orders and Reserved are known in the
project currency, the panel shall also state the figure without spending under its own label — "Without spending:
{amount} left after orders, reserved and this purchase." — visible without a click, never
in the Left tile or on the bar, with no advisory. When open orders are also unknown, only the reason is shown.
A request in another currency shows no Left figure and no such line.

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

**AC-RB-004 — Left = Budget − Spending − Open orders − Reserved (unit).**
*Given* budget=1000, spending=0, open orders=300, reserved=200, *When* the panel computes Left, *Then* it shows
$500. *(Owns FR-RB-010, FR-RB-012.)*

**AC-RB-005 — Reserved tile shows other-reserved with sub-line, never "encumbered" (unit).**
*Given* a visible panel with total reserved=200 of which this case contributes 50 (case in Reserved),
*When* rendered, *Then* the Reserved tile shows $150 ("approved, not yet ordered"), and the rendered text
contains no "encumber"/"encumbered". *(Owns FR-RB-011, FR-RB-014.)*

**AC-RB-006 — At Requested, Left after = Left − thisRequest (unit).**
*Given* status=Requested, left=500, thisRequest=120, *When* the panel computes "Left after this purchase",
*Then* it shows $380. *(Owns FR-RB-013 [Draft/Requested branch].)*

**AC-RB-007 — At Approved, Left after = Left (no double-subtract) (unit).**
*Given* status=Approved, this case's 120 already inside reserved (left=500 already net of it),
thisRequest=120, *When* the panel computes "Left after this purchase", *Then* it shows $500 (NOT $380) — the
case is not subtracted twice. *(Owns FR-RB-013 [Approved branch].)*

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

**AC-RB-013 — Over-budget advisory at Requested (unit).**
*Given* status=Requested, left=100, thisRequest=250, *When* the panel renders, *Then* one non-blocking
role="status" advisory states $150 over the budget after this purchase and that approval is still permitted.
*(Owns FR-RB-040.)*

**AC-RB-014 — No false advisory when already reserved (unit).**
*Given* status=Approved with this case already in reserved and `left ≥ 0`, *When* the panel renders,
*Then* no advisory is shown; *and given* left < 0, *Then* the one advisory states the negative amount over the
budget. *(Owns FR-RB-041.)*

**AC-RB-015 — Left after this purchase counts the whole budget (unit + agreement).**
*Given* budget 1,000, spending 500, open orders 400, Reserved 50 and a new Requested purchase of 25, *When* the
panel computes the figure, *Then* it shows $25 left (the bar reads 97.5%, shown as 98%), and an over-budget
case (spending 1,040, open orders 300, Reserved 200, request 440) shows −$980 with one advisory. The same
fixture's project Overview reads "Left after open orders $100" (100 − 50 − 25 = 25) on PMO and on ERP. *(Owns
FR-RB-010, FR-RB-012, FR-RB-013, FR-RB-040.)*

**AC-RB-016 — An already-reserved request is not subtracted again (unit).**
*Given* the same project with the purchase Approved (Reserved 75 including it), *When* the panel computes the
figure, *Then* it shows $25 (not $0) and the Reserved tile shows the other 50. *(Owns FR-RB-013 [Approved
branch], FR-RB-014.)*

**AC-RB-017 — Unknown is never drawn as a number (unit).**
*Given* spending not known (reading null, no ledger reading, another currency, failed read) with open orders
400 and Reserved 50, *When* the panel renders, *Then* the Left tile shows its reason and no `$` figure, there is
no bar and no advisory, and the line "Without spending: $525 left after orders, reserved and
this purchase." is visible beside it. *Given* open orders not known (another currency, purchasing outside PMO,
no position), *Then* only the reason is shown, with no amount. *(Owns FR-RB-017.)*

**AC-RB-018 — The record header line counts an order once (unit).**
*Given* an Ordered purchase of 50 already inside open orders 100, budget 1,000, Reserved 200, spending 0,
*When* the record header line renders, *Then* it reads "Left in budget $700" (not $650). *(Owns FR-RB-013
[Ordered..Paid branch].)* *Given* spending not known, *Then* the line reads "Without spending: $700 left after
orders, reserved and this purchase." (the panel's wording), never "Left in budget".

---

## Traceability (per ADR-0010 — one owning layer per AC)

| AC | Behavior | Owning layer | Location |
|----|----------|--------------|----------|
| AC-RB-001 | Reserved sum over status set | **Unit** (Vitest, mocked supabase) | `src/lib/db/procurements.test.ts` |
| AC-RB-002 | Reserved org-scoping (RLS) | **pgTAP** (the only honest layer for RLS) | `supabase/tests/*_reserved_spend.test.sql` |
| AC-RB-003 | Committed unchanged & disjoint | **Unit** (set assertion) + reuse existing drift pgTAP | `src/lib/db/procurements.test.ts` |
| AC-RB-004 | Left formula | **Unit** (RTL render) | `pages/procurement/DecisionSupportPanel.test.tsx` |
| AC-RB-005 | Other-reserved tile, no "encumbered" | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-006 | Left after = Left − thisRequest (Requested) | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-007 | Left after = Left (Approved, no double-count) | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-008 | Panel visible Draft..Quote-Selected | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-009 | Panel hidden Ordered..terminal | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-010 | Loading state | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-011 | Error state | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-012 | No-budget state | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-013 | Over-budget advisory (Requested) | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-014 | No false advisory (Approved) | **Unit** (RTL) | `DecisionSupportPanel.test.tsx` |
| AC-RB-015 | Left over the whole budget; agrees with Overview | **Unit** | `computeBudgetSignal.test.ts` (owner); also referenced: `DecisionSupportPanel.test.tsx` (panel, and the shown figures add up to Left), `pages/__tests__/figures-budget.agreement.test.tsx` (agreement) |
| AC-RB-016 | Already reserved: not subtracted again | **Unit** | `computeBudgetSignal.test.ts` (owner); also referenced: `DecisionSupportPanel.test.tsx` |
| AC-RB-017 | Unknown never drawn; amount without spending under its own label | **Unit** | `DecisionSupportPanel.test.tsx` (owner); also referenced: `src/lib/budget/wholeBudgetInputs.test.ts` (inputs), `ProcurementListRow.budgetUsed.test.tsx` (mount) |
| AC-RB-018 | Header line counts an order once | **Unit** | `pages/procurement/detail/ProcurementDetailPanels.test.tsx` |

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
