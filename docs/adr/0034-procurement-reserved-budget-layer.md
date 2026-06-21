---
status: proposed
---

# ADR-0034 — Procurement Reserved budget layer (distinct from Committed; Available = Budget − Committed − Reserved)

- **Status:** Proposed (awaiting owner spec sign-off)
- **Date:** 2026-06-21
- **Feature:** Procurement budget-model extension — a third budget layer ("Reserved") surfaced on the
  DecisionSupportPanel of the procurement case Overview tab.
- **Relates to / extends:** OD-BUDGET-2 (Committed spend basis), OD-W5-4 (committed-basis budget impact),
  ADR-0009 / migration 0009 (dashboard margin), ADR-0033 (procurement case folder), ADR-0017 (repository
  seam), ADR-0001 (org_id seam), ADR-0010 (test pyramid).
- **Does NOT supersede:** OD-BUDGET-2's `spent`/Committed definition stays **byte-for-byte unchanged**.

## Context

The procurement case Overview tab shows a "Budget impact" card
(`pmo-portal/pages/procurement/DecisionSupportPanel.tsx`) with four tiles: *This request*,
*Remaining vs. committed*, *Project budget*, *After this request*. It draws two figures:

- **Budget** = `useProjectBudget(projectId)` — Σ active budget-version line items
  (`src/hooks/useBudget.ts` → `deriveProjectBudget`).
- **Committed** = `useProjectCommittedSpend(projectId)` — Σ `total_value` where procurement status ∈
  {Ordered, Received, Vendor Invoiced, Paid} (`src/lib/db/procurements.ts` `COMMITTED_STATUSES`). This is
  the **OD-BUDGET-2 "Committed basis"**, shared verbatim with the Finance dashboard (migration
  `0009_dashboard_margin.sql`), `projects.spent`, and `get_projects_delivery.committed_spend` (0026). A
  pgTAP drift guard (`0069_dashboard_at_risk_boundary.test.sql`) asserts these three implementations agree.

Two real problems with the current panel:

1. **No headroom for approved-but-not-yet-ordered demand.** An approver looking at a Requested case sees
   *Remaining = Budget − Committed*. But other procurements on the same project may already be **approved**
   (status Approved / Vendor Quoted / Quote Selected) and therefore **about to consume budget** — they
   simply have not issued a PO yet, so they are invisible to the Committed basis. The approver can
   over-commit the project budget without warning. The accounting concept for "approved, earmarked, not yet
   actualized" is an **encumbrance**; we surface it as a distinct layer.

2. **A double-count bug.** The panel always computes `afterRequest = Budget − Committed − thisRequest`,
   **regardless of the viewed case's own status**. Once the case itself is Ordered+ it is *already* inside
   Committed, so subtracting `thisRequest` again double-counts it. The panel is shown at every status today,
   so this is live for any committed case.

The owner has decided (this session) to introduce a **distinct Reserved layer** rather than redefine
Committed — because Committed is load-bearing for dashboard honesty and is shared by four call sites with a
drift guard. Redefining it to include approved-pre-PO rows would ripple "spent" across every dashboard and
break the meaning the owner relies on.

## Decision

### 1. Introduce a distinct "Reserved" budget layer; do NOT touch Committed.

`COMMITTED_STATUSES` and every consumer of the Committed basis (0009, 0026, `projects.spent`, the drift
guard) stay **exactly as-is**. "Spent" keeps meaning PO-issued-and-onward. No ripple to any dashboard.

### 2. Reserved = Σ `total_value` of procurements that are **approved but not yet ordered**.

Reserved status set (**[OWNER-DECISION-1]** — confirmed against the live enum):

```
RESERVED_STATUSES = { 'Approved', 'Vendor Quoted', 'Quote Selected' }
```

Rationale: these are the post-approval, pre-PO statuses in the lifecycle
(`src/lib/db/procurementLifecycle.ts` `LEGAL_TRANSITIONS`): Draft → Requested → **Approved → Vendor
Quoted → Quote Selected** → Ordered → … The case has cleared the approval SoD gate and is progressing
toward a PO; the money is earmarked. `Vendor Quoted` and `Quote Selected` are included because they are
*approved and progressing pre-PO* (default = yes). `Draft` and `Requested` are **excluded** — not yet
approved, no commitment of intent. `Rejected` and `Cancelled` are **excluded** — terminal/dead. This set
is the exact complement of OD-BUDGET-2's "explicitly excludes" list, partitioned: Committed takes
Ordered+, Reserved takes Approved..Quote-Selected, and Draft/Requested/Rejected/Cancelled are in neither.

### 3. Available = Budget − Committed − Reserved.

This is the over-commitment-safe headroom: budget minus money already spent (Committed) minus money
already earmarked by approved-pre-PO demand (Reserved). It is **always ≤ Remaining** (= Budget −
Committed), and is the honest number an approver should weigh a new request against.

### 4. UI term = "Reserved" with sub-line "approved, not yet ordered".

Tile label is **"Reserved"**; explainer sub-line **"approved, not yet ordered"**. The word **"encumbered"
is NEVER surfaced in the UI**. Internal/code/spec identifier is `reserved` (`getProjectReservedSpend`,
`useProjectReservedSpend`, `RESERVED_STATUSES`). "Encumbrance" appears only here, as the accounting
concept this layer models.

### 5. Per-stage tile math resolves the double-count (the subtle correctness point).

Because the panel is visible through the Approved stage, a viewed case can **already be inside Reserved**.
The "After this request" tile must not subtract `thisRequest` when the case's own value is already
reflected in a layer. The math is keyed on whether the viewed case is itself in Reserved:

- **Case status ∈ {Draft, Requested}** (NOT in Reserved, NOT in Committed): the case's value is in no
  layer. "After this request" projects *approving* it →
  `afterRequest = Available − thisRequest` (= Budget − Committed − Reserved − thisRequest).
- **Case status ∈ {Approved, Vendor Quoted, Quote Selected}** (the case IS already in Reserved): its value
  is already inside Reserved. Subtracting it again would double-count →
  `afterRequest = Available` (do **not** subtract thisRequest).

So `afterRequest = Available − (caseInReserved ? 0 : thisRequest)`.

### 6. Panel visibility: pre-Ordered statuses only.

The panel is shown **only** while status ∈ {Draft, Requested, Approved, Vendor Quoted, Quote Selected}
(**[OWNER-DECISION-2]**, recommended). It is **hidden** at Ordered, Received, Vendor Invoiced, Paid,
Rejected, Cancelled. Hiding post-commit (a) makes the panel a *decision-support* tool for the request +
approval phases only — its actual purpose — and (b) **eliminates the current double-count bug** for
committed cases (the panel never renders while the case is inside Committed, so the "subtract thisRequest
from a basis that already contains it" path is structurally impossible).

### 7. "Other reserved" framing for the approver insight.

The headroom math (Available, afterRequest) uses **total** Reserved (the true project encumbrance). The
panel **additionally** surfaces an approver-facing "other concurrent demand" figure =
**Reserved excluding the current case** (**[OWNER-DECISION-3]**, recommended), so an approver at Approved
sees "other reserved $Y" distinct from "this request $Z" and is not confused by their own case appearing
in the Reserved total. `otherReserved = totalReserved − (caseInReserved ? thisRequest : 0)`.

### 8. The Reserved read is a focused org-scoped DAL function — no new RPC.

Mirror the existing `getProjectCommittedSpend` exactly: a single PostgREST select filtered by
`project_id` + `.in('status', RESERVED_STATUSES)`, summed client-side; consumed by a
`useProjectReservedSpend` hook with an org-scoped query key. **`org_id` is never sent** — RLS
(`org_id = auth_org_id()` on `procurements`) scopes rows. No migration, no new RLS, no new RPC.

## Considered options

- **Redefine Committed to include Approved..Quote-Selected.** Rejected — ripples "spent" across 0009 /
  0026 / `projects.spent` / Finance dashboard / drift guard; breaks OD-BUDGET-2's owner-relied meaning of
  "spent = PO-issued+". Dashboard honesty over panel convenience.
- **One blended number ("committed + reserved").** Rejected — collapses two distinct decisions (money
  spent vs money earmarked) the approver needs to see separately; loses the encumbrance signal.
- **New SQL RPC / view for Reserved.** Rejected for this issue — `getProjectCommittedSpend` proves a
  focused client-side select is sufficient and consistent; an RPC adds surface for no gain. (A future
  per-category roll-up, OD-BUDGET-2 deferred portion, may warrant SQL — out of scope here.)
- **Show the panel at all statuses and special-case the math.** Rejected — keeping it visible post-commit
  re-introduces the double-count surface and shows a decision tool after the decision is irreversible.
  Pre-Ordered-only is simpler and bug-eliminating.

## Consequences

- **Extends OD-BUDGET-2** with a Reserved layer and the Available formula; OD-BUDGET-2's Committed
  definition is **untouched**. An OD-BUDGET-2 amendment note (or a new OD-BUDGET-6) should be recorded in
  `docs/decisions.md` — flagged for the Director to add on sign-off:
  > *Reserved = Σ procurement `total_value` WHERE status ∈ {Approved, Vendor Quoted, Quote Selected}
  > (approved-pre-PO encumbrance), a layer **distinct** from Committed. Available = Budget − Committed −
  > Reserved. Committed (`spent`) is unchanged.*
- **Net-new code surface only** — one DAL function (`getProjectReservedSpend`), one hook
  (`useProjectReservedSpend`), and changes confined to `DecisionSupportPanel.tsx` (a fifth tile +
  per-stage math + visibility guard). No schema, no RLS, no RPC, no dashboard change.
- **Eliminates the live double-count bug** as a side effect of the visibility boundary (§6).
- **One extra org-scoped read** per panel render (parallel to the existing two via React Query); same
  RLS surface as `useProjectCommittedSpend`; negligible cost (single aggregate-style select on an indexed
  `project_id`). Scales identically to the Committed read it mirrors.
- **Tenancy:** zero new RLS surface — the Reserved read is governed by the same `procurements` SELECT
  policy as the Committed read; `org_id` is never threaded from the client. pgTAP proves org-isolation of
  the Reserved sum.
- **Project budget page** (`pages/ProjectBudget.tsx`) surfacing Reserved for consistency is a
  **follow-up** (**[OWNER-DECISION-4]**, recommended: panel-only this issue).
