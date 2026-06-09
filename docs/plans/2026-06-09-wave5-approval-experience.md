# Design-plan — Wave 5, Cluster 1: The Approval Experience

Status: DRAFT for owner sign-off (design-plan only; no code written).
Author: design-architect (`impeccable shape` + `design-consultation` format + `ui-ux-pro-max` plan conventions).
Scope of authority: this plan touches FE/IxD only. No RPC, RLS, or procurement/timesheet state-machine changes (OD-UX-1, OD-PROC-8, OD-W2-2). `can()` is UX-only; RLS is the enforcement authority (ADR-0016).
Source of truth for all tokens: `/Users/ariefsaid/Coding/PMO/DESIGN.md`.

North star: an approver makes a **correct, confident** decision without hunting — evidence before
decision, decision-support data on screen, SoD declared up front, one primary action per stage.
Desktop-first; mobile is Wave 4-class work and is only noted (no 375px optimization here).

---

## 0. OWNER-DECISION FLAGS — ✅ RESOLVED 2026-06-09 (OD-W5-1..5 in `docs/decisions.md`)

**Build to these resolutions; they OVERRIDE any stale per-flag wording below.**
- **OD-W5-1 (A):** Approvals inbox = **promote the existing `/approvals`** (role-aware: PRs + timesheet queue, gated by `may('transition',entity)`). Dashboard "Awaiting your approval" KPI-as-link routes here.
- **OD-W5-2 (B):** Approved stage keeps **BOTH** paths (`→ Vendor Quoted` and `→ Ordered`), skip-able. ONE visual `primary` (default: Request Vendor Quotes), the other `outline` — no stage emits two primaries. Do not force one path.
- **OD-W5-3 (C):** Bulk-approve = **BOTH timesheets AND procurement**, evidence-based (reviewer can see per-record evidence before bulk; SoD skips non-approvable rows; one batch confirm + aggregate toast). Supersedes "timesheets only in v1" below.
- **OD-W5-4 (D):** Budget-impact figure = **committed basis** (OD-BUDGET-2: Σ PO `total_value` in `Ordered..Paid`, already in SQL `0009`); label as commitment-vs-budget; over-budget = non-blocking advisory.
- **OD-W5-5:** A **server-enforced PO-commitment approval gate + cashflow/cash-position data** are NEW features (new state + RPC + ADR; no cash data exists) → **DEFERRED to the "commitment governance" track** (backlog). This IxD wave must NOT change the procurement state machine / RPCs; it makes the PO decision evidence-rich with EXISTING budget data only.

(Original flags retained below for context.)

- **OD-FLAG-A — Approvals inbox: new route vs. tab.** There is ALREADY a `/approvals` route
  (`pages/Approvals.tsx`) that today renders only the timesheet `ApprovalsQueue`. **Recommendation:
  promote `/approvals` into the unified, role-aware "Needs my approval" inbox** (timesheets +
  procurement PRs the role can act on), rather than inventing a new URL or burying it as a tab. It
  is already a valid deep-link and is referenced by nav. Owner's call: (a) promote `/approvals`
  [recommended], (b) new `/inbox`, or (c) keep it timesheet-only and add a procurement-only tab.
- **OD-FLAG-B — D7 single primary at the Approved stage.** At `Approved`, two forward paths are
  legal: `Request Vendor Quotes` (sourcing) and `Generate Purchase Order` (skip-to-order). Both
  render as blue primary today (the D7 two-blue defect). **Recommendation: `Request Vendor Quotes`
  is THE primary (blue); `Generate Purchase Order` becomes a secondary `outline`** — quoting first
  is the conventional, lower-risk path; skip-to-PO is the exception. Owner confirms which action is
  canonical-primary for the org's process.
- **OD-FLAG-C — N12 bulk-approve scope + confirm cadence.** Two sub-decisions:
  (1) **Is bulk-approve in v1 of this cluster, or deferred?** Recommendation: **timesheet
  bulk-approve ships in v1** (high-frequency, low-consequence, routine); **procurement bulk-approve
  is DEFERRED** (each PR is a financial decision that wants its own evidence + budget context — bulk
  would defeat the entire evidence-before-decision goal of this wave). (2) **Confirm cadence:** under
  OD-UX-1 a single approve is consequential and confirms once. Recommendation for the batch: **one
  confirm for the whole batch** ("Approve N timesheets?"), listing the N names/weeks in the dialog
  body, since approving each individually already confirms once. Owner confirms both.
- **OD-FLAG-D — N8 budget decision-support figure semantics.** The plan surfaces "this PR is
  `<PR value>` against `<remaining>` of `<budget>` on project Z." **Remaining is computed FE-side as
  `budget − spent`** from the project row already on the procurement detail's `project` join + the
  `useProjectBudget(projectId)` derived budget (Σ active-version line items). **Open sub-question for
  owner/eng-planner:** does "spent" already include open-but-unpaid POs (committed), or only paid
  actuals? If only actuals, the figure is "remaining vs. actuals" and should be LABELLED as such (we
  must not imply committed-spend headroom we haven't subtracted). Recommendation: ship with the
  honest label "remaining (vs. actual spend)" and a help tooltip; a committed-spend variant is a
  deferred follow-up (mirrors the Exec dashboard's existing "committed-spend aggregate is deferred"
  note). No new RPC.

---

## 1. Findings → surface map (what this cluster addresses)

| ID | Finding | Surface |
|---|---|---|
| N7 | Decision buttons render ABOVE the evidence | Procurement approval screen (reorder) |
| N8 | No budget-remaining / variance at the decision point | Procurement approval screen (new decision-support panel) |
| D6 | SoD block is a surprise-on-click, not up front | Procurement approval screen + Timesheet approval (placement) |
| D7 | Two competing blue primaries at Approved | Procurement approval screen (One-Blue hierarchy) |
| D8 | Cancel sits ABOVE the primary CTA | Procurement approval screen (action hierarchy) |
| N6 | No unified "Needs my approval" inbox (only a list filter) | Approvals inbox (`/approvals` promotion) |
| N15 | Exec/Finance dashboards lack a pending-approval KPI/shortcut; PM dash omits procurement | Dashboard shortcut (KPI tiles) |
| N11 | Timesheet approval rows too shallow to verify before approving | Timesheet approval (expand-in-place breakdown) |
| N12 | No bulk-approve | Approvals inbox / timesheet queue (bulk affordance) |

---

## 2. Per-surface design

### 2.1 Surface A — Procurement approval screen (`pages/ProcurementDetails.tsx`)

This is the highest-leverage, highest-risk change: it reorders the existing screen so the decision
sits at the FOOT of the evidence, and adds a decision-support strip. **It is a re-layout, not a
rewrite** — every block already exists; we change DOM order, the action-bar's vertical position, the
button variants, and add one budget panel.

#### Current order (the N7/D8 defect)
`PageHeader → LifecycleStepper → [HeaderEdit] → GateNotice → StatTiles → ACTION BAR (Approve/Reject/Cancel) → GR/VI panels → LineItems → Quotations+DocTrail → Documents → notes`

The action bar (the decision) renders at the top, before the line items and the selected quote that
justify the decision. Cancel is in the same bar, laid out by `flex-wrap` order, so it can sit
visually above/before the primary.

#### Target order (evidence → decision)

```
┌─ PageHeader  (title · code · project · requested-by · StatusPill) ──────────────┐
├─ LifecycleStepper (PR→VQ→PO→GR→VI→Paid)  [unchanged] ───────────────────────────┤
├─ [ProcurementHeaderEdit]  (only Draft/Rejected; unchanged) ─────────────────────┤
│                                                                                  │
│  ░░ EVIDENCE (read first) ░░                                                      │
├─ StatTiles  (PR value · Selected quote · PO committed · Goods received) ────────┤
├─ DecisionSupportPanel  ← NEW (N8): budget-remaining + variance for the project ─┤
├─ LineItemsSection  (what is being bought) ──────────────────────────────────────┤
├─ Quotations + Document trail  (the selected quote evidence) ────────────────────┤
│                                                                                  │
│  ░░ DECISION (act last) ░░                                                        │
├─ DecisionCard  ← the relocated action bar, anchored BELOW the evidence ─────────┤
│    • SoD GateNotice (D6) — inside/atop this card, only when blocked              │
│    • "Ready to advance" GateNotice — when actions exist                          │
│    • Notes textarea (approve/reject only)  [unchanged]                            │
│    • Action row: ONE primary + subordinate secondaries (D7), destructive LAST (D8)│
│    • inline mutationError (role=alert)  [unchanged]                               │
├─ GR / VI capture panels  (when their stage is active; unchanged behavior) ──────┤
├─ ProcurementDocumentsSection  (register; unchanged) ────────────────────────────┤
└─ Approval / Rejection notes  (when present; unchanged) ─────────────────────────┘
```

Note the GR/VI capture panels stay near the decision (they ARE the action at their stages — OD-W3-3
co-location). For the **approval** stage specifically (`Requested → Approved/Rejected`) the relevant
evidence is line items + budget; for later stages the StatTiles + doc trail carry it. The reorder
serves the approval decision without breaking the later-stage capture flows.

#### N8 — DecisionSupportPanel (new, read-only)

A single card placed in the evidence zone, directly under StatTiles. Renders ONLY when the PR has a
`project_id` (PRs can be project-less). Composition reuses primitives — no new visual vocabulary:

```
┌─ Card (CardPad) ───────────────────────────────────────────────────────────────┐
│  Budget impact · <project name>                                  [help ?]        │
│                                                                                  │
│  This request   Remaining (vs. spend)   Project budget    After this request     │
│  $48,000        $213,400                 $1,200,000        $165,400 (13.8%)       │
│  ▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░  ProgressBar: spent ── this PR (overlay)        │
│                                                                                  │
│  ⚠ This request exceeds remaining budget by $X.    ← only when over (text + icon) │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- Data source (no new RPC): `p.project` (already joined: name; needs `budget`+`spent` — see note),
  plus `useProjectBudget(p.project_id)` for the derived active-budget figure. The procurement detail
  `project:projects(name,code)` join must be widened to also select `budget, spent` (a SELECT-list
  change in `DETAIL_SELECT`, not a schema/RLS change). Eng-planner to confirm those columns are
  RLS-readable to approver roles (they are read on dashboards already).
- Four figures laid out as a compact StatTiles-style row (reuse `StatTiles`/`StatTile[]`), each
  `tabular`: **This request** (`p.total_value`), **Remaining** (`budget − spent`), **Project budget**
  (`budget`), **After this request** (`remaining − total_value`, with the resulting % of budget).
- A `ProgressBar` (existing primitive, used on FinanceDashboard) shows spent vs. budget, with the
  PR's value as a trailing overlay segment so the approver SEES the request pushing toward/over the
  cap. Color is threshold-toned (success/warning/destructive) BUT the figures are always text-labelled
  (a11y: text-not-color-only).
- Over-budget case: a `GateNotice variant="blocked"`-style inline warning (or a destructive-toned
  text line with an `alert` icon) reading "This request exceeds remaining budget by `$X`." This is
  **advisory, not blocking** — approval is still permitted (the org may knowingly over-spend); it
  informs the decision, it does not gate it. (If the owner wants it to gate, that is a separate
  server-rule decision, out of scope.)

#### D6 — SoD up front

The `sodGateMessage(...)` already produces the correct copy; today its `GateNotice` renders near the
top (good) but the decision is also at the top (bad). After the reorder, the SoD notice moves to sit
**inside/atop the DecisionCard** so the explanation and the (absent) buttons are co-located:

- **Blocked (cannot act):** the DecisionCard shows the `GateNotice variant="blocked"` with the SoD
  copy and **no action buttons** — the user learns up front, in the decision zone, why there is
  nothing to click. (No more "click Approve → surprise rejection toast".) For the requester-on-their-
  own-`Requested`-PR case, the copy already names who must review.
- We ALSO keep a lightweight SoD hint in the evidence zone is unnecessary; one authoritative gate in
  the DecisionCard is correct (avoids duplicate banners — One-Notice).

#### D7 — One primary per stage (One-Blue Rule)

The action set per stage gets exactly one blue `primary`; everything else is `outline` (or, for
destructive, `outline` at rest with destructive tone only inside the confirm dialog — the existing
pattern). Concretely:

| Stage | Primary (blue) | Secondary (outline) | Destructive (outline at rest) |
|---|---|---|---|
| Draft | Submit Request | — | Cancel request |
| Requested (approver) | **Approve** | — | Reject · Cancel request |
| Rejected (requester) | Rework (Back to Draft) | — | — |
| **Approved** | **Request Vendor Quotes** (OD-FLAG-B) | Generate Purchase Order | Cancel request |
| Vendor Quoted | Select Quote | — | Cancel request |
| Quote Selected | Generate Purchase Order | — | Cancel request |
| Ordered | Confirm Receipt | — | Cancel request |
| Received | Mark Vendor Invoiced | — | Cancel request |
| Vendor Invoiced (not approver) | Mark as Paid | — | Cancel request |

Implementation: `allowedActions()` already assigns variants; the change is to **demote the second
blue at Approved to `outline`** (OD-FLAG-B) and ensure no stage emits two `primary`. The existing
"destructive renders as outline at rest, solid only in the confirm" rule is preserved.

#### D8 — Action hierarchy (destructive below/after the primary, never above)

The action row inside the DecisionCard renders in a **fixed, deliberate order** rather than relying
on `allowedActions()` push order + `flex-wrap`:

```
[ PRIMARY ]   [ secondary outline ]            …spacer…            [ Cancel request ]
```

- Primary first (leftmost), secondaries next, **destructive (`Cancel request` / `Reject`) pushed to
  the trailing/right end** with a spacer, visually separated. On wrap (narrow desktop), the
  destructive action wraps to its own line BELOW the primary — never above. Sort the `actions[]` by a
  weight (`primary` < `outline` < `destructive`) before render so DOM/tab order and visual order both
  put the primary first and destructive last.

---

### 2.2 Surface B — Timesheet approval (`pages/timesheets/ApprovalsQueue.tsx`)

#### N11 — Per-project / per-day breakdown before approving (expand-in-place)

Today each `ApprovalRow` shows only owner · week · total-hours · status — too shallow to verify. Add
**expand-in-place** disclosure (progressive-disclosure): the row gets a disclosure toggle; expanding
reveals the same per-project / per-day matrix the engineer entered (reuse the read-only
`TimesheetGrid` in non-editable mode, or a compact per-project hours list — the grid is richer and
already token-correct).

```
┌─ ApprovalRow ───────────────────────────────────────────────────────────────────┐
│ (A) Anita Rao   Week of Jun 2 · 38.0 h   [Submitted]   ▸  [Approve] [Return]      │  ← collapsed
└───────────────────────────────────────────────────────────────────────────────────┘
   ▼ expanded:
   ┌─ read-only TimesheetGrid (project rows × Mon–Sun + Total) ─────────────────────┐
   │  Project Apollo   PRJ-014   8  8  8  6  8  -  -   38.0                          │
   │  Internal/Admin   —         -  -  -  2  -  -  -    2.0   (etc.)                  │
   └────────────────────────────────────────────────────────────────────────────────┘
   [Approve]  [Return]                                  ← actions repeat in expanded foot
```

- The breakdown data already exists: `useTimesheetsAwaitingApproval()` returns each sheet's
  `entries[]` (project, date, hours). We group exactly as `Timesheets.tsx` does (per-project rows ×
  7 day columns) and feed a **read-only `TimesheetGrid`** (its non-editable branch already exists).
- One row may be expanded at a time (accordion) OR multiple — recommend **multiple allowed**
  (independent `Set<expandedId>`), so an approver can compare two reports. Low cost.
- The disclosure control is a real `<button aria-expanded aria-controls>` with a chevron icon
  (`chev`), placed at the row's leading edge; the actions stay at the trailing edge.
- Keep the existing approve/return ConfirmDialog flow untouched (T2 default-tone, T3 destructive).

#### N12 — Bulk approve (timesheets only in v1; OD-FLAG-C)

Add a selection mode to the queue, mirroring the DataTable's documented selection-bulk pattern
("Selection mode swaps the default controls for a bulk-action cluster on a `primary/6%` wash with a
count `pill`" — DESIGN.md §Toolbar):

```
┌─ Team approvals queue ───────────────────────────────  [☑ Select]  ──────────────┐
│  (selection on) →  ┌ primary/6% wash ─────────────────────────────────────────┐  │
│                    │ 3 selected     [Approve 3]   [Clear]                      │  │
│                    └──────────────────────────────────────────────────────────┘  │
│  [☑] (A) Anita Rao    Week of Jun 2 · 38.0 h   [Submitted]                        │
│  [☑] (D) Dev Shah     Week of Jun 2 · 41.0 h   [Submitted]                        │
│  [ ] (M) Mae Lin      Week of Jun 9 · 36.0 h   [Submitted]   ← SoD-excluded? hidden checkbox │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- A per-row checkbox (the DESIGN.md custom checkbox: 16px, `role="checkbox"`, `aria-checked`,
  `tabindex`) appears in selection mode. **SoD implication (must-build):** the queue's DAL already
  excludes the caller's own sheets, and `timesheetActions(...).approve` is false for rows the viewer
  can't approve — **bulk-select must only offer/include rows where `actions.approve` is true.** Rows
  that can be read but not approved render WITHOUT a checkbox (or a disabled one with a tooltip
  "You can't approve this week"). "Select all" selects only approvable rows.
- **Bulk confirm (OD-FLAG-C):** one `ConfirmDialog` for the batch — title "Approve N timesheets?",
  body lists the N owner names + weeks + total hours, confirmLabel "Approve N". On confirm, fire the
  N `approve.mutate({id})` calls (the existing per-sheet RPC; no new bulk RPC). Aggregate the result
  into ONE toast: "N approved" or, on partial failure, "X approved, Y failed — Z couldn't be approved
  (separation of duties)". Bulk must be resilient: a single SoD/stale failure does not abort the rest.
- **Return is NOT bulkable** — returning needs a reason and is per-person; keep it per-row only.

---

### 2.3 Surface C — Approvals inbox (`/approvals`, promoted — OD-FLAG-A)

A unified, role-aware "Needs my approval" home. Today `/approvals` renders only the timesheet queue.
Promote it to a two-section inbox: **procurement PRs awaiting my approval** + **timesheets awaiting
my approval**, each section shown only if the role can act on that type and there is at least one
actionable item type for the role.

```
┌─ Approvals ───────────────────────────────────────────────────────────────────────┐
│  Needs my approval                                                                   │
│  Everything waiting on your decision, across procurement and timesheets.             │
│                                                                                      │
│  ┌─ Purchase requests awaiting you  (N) ──────────────────────────────────────────┐ │
│  │  DataTable: Request · Project · Requested by · Value · [Budget remaining] · age │ │  ← rows route to /procurement/:id
│  │  (each row → the reordered approval screen where the real decision happens)     │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  ┌─ Timesheets awaiting you  (M) ─────────────────────────────────────────────────┐ │
│  │  the shared ApprovalsQueue (expand-in-place + bulk approve from §2.2)           │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **Procurement section** lists PRs in `Requested` status that the role can approve and the viewer is
  NOT the requester of (the SoD-a exclusion — computed FE-side from `requested_by_id !== self`,
  matching the screen's `!isRequester` gate). Data: reuse `useProcurements()` (already cached),
  filter to `status === 'Requested'` AND `can('transition','procurement', realRole)` AND not-self.
  Columns reuse the Procurement list columns + a compact **Budget remaining** cell (same figure as
  N8, so the approver gets a first-glance read before opening). **Rows do NOT approve inline** — they
  route to `/procurement/:id` (the reordered screen) because a PR approval needs full evidence
  (this is deliberate per OD-FLAG-C: no procurement bulk/inline approve in v1).
- **Timesheet section** embeds the existing `ApprovalsQueue` (with §2.2 enhancements). This is where
  bulk-approve lives, because timesheets are the routine, evidence-light case.
- **Role-awareness (UX-only; RLS is authority):** a section renders only when
  `may('transition', <entity>)` is true for the role. Engineer (OD-W2-2: approval OFF) sees neither →
  the inbox shows the empty/no-access state. PM/Exec/Admin see both (PM/Exec/Admin can approve PRs and
  timesheets). Finance can approve PRs but NOT timesheets (OD-W2 Workforce gating) → Finance sees only
  the procurement section.
- **Nav + entry:** the existing rail "Approvals" item (already role-gated, hidden from Engineer) now
  points here; this is the destination the dashboard KPI shortcuts (§2.4) route to.

---

### 2.4 Surface D — Dashboard pending-approval KPI / shortcut (N15)

A KPI tile on each approver role's dashboard that (a) shows the count waiting on them, and (b) is a
shortcut that routes to `/approvals`. Reuse the existing `KPITile` primitive (it already supports an
icon-tile, value, `vs` sub, and help). To make it a shortcut, wrap the tile in a router `<Link>` /
make it activatable (a tile-level affordance — see a11y notes).

| Dashboard | Today | Add (N15) |
|---|---|---|
| **PM** (`PMDashboard`) | has "Timesheets awaiting" only; procurement approvals are a fake placeholder | Replace the placeholder with a real combined **"Awaiting your approval"** tile = (PRs you can approve) + (timesheets awaiting), routing to `/approvals`. PM CAN approve PRs, so include them honestly now. |
| **Finance** (`FinanceDashboard`) | no approval tile | Add **"PRs awaiting you"** tile (count of `Requested` PRs Finance can approve, not-self) → `/approvals`. Finance has no timesheet approval. |
| **Exec** (`ExecutiveDashboard` exec view) | no approval tile | Add **"Awaiting your approval"** tile (PRs + timesheets Exec can approve) → `/approvals`. |
| **Engineer** | n/a | none (Engineer cannot approve; OD-W2-2). |

- The count is honest and role-scoped: procurement count = `useProcurements()` filtered to
  `Requested` + can-approve + not-self; timesheet count = `useTimesheetsAwaitingApproval().length`
  (already excludes own). **Never sum a real count with a placeholder** (the existing PM-dash honesty
  rule — we are removing the placeholder, so the sum becomes real).
- Tile tone: `amber` (it's a "needs attention" queue, consistent with the existing "At risk" /
  "Outstanding invoices" amber tiles), icon `check` or `inbox`. Zero state shows `0` with `vs`
  "nothing waiting" (not hidden — an empty queue is information).

---

## 3. All states per surface

### Procurement approval screen
- **Loading:** existing `ListState variant="loading"` (BackBar + skeleton) — unchanged.
- **No access / not found:** existing `ListState variant="empty" icon="lock"` — unchanged.
- **Error (transient):** existing `ListState variant="error"` + Retry — unchanged.
- **DecisionSupportPanel loading:** while `useProjectBudget` is pending, the panel shows a KPI-style
  skeleton (`skel` rows) in place of the figures; the rest of the screen is interactive.
- **DecisionSupportPanel error / no-budget:** if the budget query errors or the project has no active
  budget (budget = 0), the panel shows a calm muted line "No active budget set for this project —
  budget impact can't be shown" (NOT an error blocker; the approver can still decide). No project →
  panel not rendered at all.
- **SoD-blocked state:** DecisionCard shows the blocked `GateNotice`, no action buttons (D6).
- **Over-budget state:** advisory destructive-toned line inside the DecisionSupportPanel; actions
  still enabled.
- **Post-approve success:** existing classified success toast ("Request updated — Moved to
  Approved") — unchanged; the screen refetches and re-renders at the next stage (the DecisionCard
  now offers the Approved-stage actions). The lifecycle stepper advances.
- **Submit-blocked (Draft, no line items):** existing `line-items-gate` copy — unchanged.

### Timesheet approval (queue + expanded)
- **Loading:** existing `approvals-loading` skeleton.
- **Empty (nothing awaiting):** existing `approvals-empty` ListState ("Nothing awaiting you").
- **Error:** existing error ListState + Retry.
- **Expanded-row loading:** entries are already in the queue payload, so expansion is instant (no
  per-row fetch); no separate loading state needed.
- **SoD read-only rows:** non-approvable rows render without action buttons / checkbox (existing
  `isApprover` gate + per-row `actions.approve`).
- **Bulk in-flight:** the "Approve N" button shows `loading`; rows disabled during the batch.
- **Bulk partial-failure:** one aggregate warning toast naming how many failed and why (SoD/stale).
- **Post-approve success:** per-row → existing success toast; bulk → aggregate "N approved" toast;
  approved rows leave the queue on refetch.

### Approvals inbox (`/approvals`)
- **Loading:** each section shows its own `ListState variant="loading"` (procurement table skeleton;
  timesheet queue skeleton).
- **Empty (role can approve, nothing waiting):** each section shows its empty ListState; if BOTH are
  empty, a single page-level empty "You're all caught up — nothing is waiting on your approval."
- **No-access (role cannot approve anything, e.g. Engineer reaches `/approvals` by URL):** the
  shared `AccessDenied` surface (already used by Timesheets for Finance) with a Back action.
- **Error:** per-section error ListState + Retry (procurement and timesheet queries fail
  independently; one erroring does not blank the other).

### Dashboard KPI shortcut
- **Loading:** `KPITile loading` skeleton (existing).
- **Zero:** value `0`, `vs` "nothing waiting" — tile still routes to `/approvals` (shows the
  caught-up empty state there).
- **Error:** if the underlying count query errors, the tile shows a muted "—" with the help tooltip
  explaining; it does not crash the dashboard (dashboards already isolate per-card errors).

---

## 4. WCAG-AA accessibility

- **Evidence-before-decision in DOM + tab order (N7):** because the DecisionCard is moved AFTER the
  line-items/quotation sections in the DOM, both **reading order and Tab order** reach the evidence
  before the Approve/Reject buttons. This is the core a11y win of the reorder, not just a visual one.
- **SoD message association (D6):** the blocked `GateNotice` lives inside the DecisionCard region;
  give the DecisionCard `aria-labelledby` a heading ("Decision") so screen-reader users land in a
  named region that explains the gate before (the absence of) actions.
- **Budget figures text-not-color-only (N8):** every budget figure is a labelled number
  (`tabular`); the over-budget warning is conveyed by icon + text ("exceeds remaining budget by $X"),
  never by bar color alone. The ProgressBar is decorative-supplementary with an `aria-label`
  ("`<project>` budget utilization: NN%"); the numeric truth is in the adjacent text.
- **Inbox as proper list/table semantics (N6):** procurement section = the existing `DataTable`
  (preserves `role=row`, sortable `aria-sort`, the per-row focusable activation `<button>` with
  `rowLabel` "Open `<title>`"). Timesheet section keeps its list structure; the queue heading is a
  real `<h2>`. Each inbox section is a landmark region with an accessible name.
- **Bulk-select keyboard semantics (N12):** per-row checkbox is the DESIGN.md custom checkbox —
  `role="checkbox"`, `aria-checked`, `tabindex="0"`, Space toggles. "Select all" is a labelled
  checkbox with `aria-checked="mixed"` for the indeterminate state. The bulk-action cluster is a
  labelled region; "Approve N" is a verb+object button. Focus returns to the queue after the batch
  resolves.
- **Expand-in-place (N11):** disclosure is `<button aria-expanded aria-controls={panelId}>`; the
  revealed grid has a matching `id`. Chevron is `aria-hidden` (the button text/label carries meaning,
  e.g. `aria-label="Show hours for <name>"`).
- **Dashboard tile-as-link:** the shortcut tile must be a single focusable control. Recommend
  wrapping the tile body in a router `<Link>` with an accessible name "Open approvals — N awaiting"
  rather than making the whole `div` clickable; the inner help `?` stays a separate focusable button
  (don't nest interactives — give the `?` `stopPropagation` and keep it OUT of the link, e.g. link
  wraps the value+label, `?` sits beside it). Eng-planner: confirm the tile composition supports this
  without nesting a button inside a link.
- **Focus ring:** global `:focus-visible` (2px `ring`, 2px offset) applies to all new controls — no
  per-component focus styles (DESIGN.md §Accessibility).
- **One ConfirmDialog focus trap:** the bulk-approve dialog reuses `ConfirmDialog` (already manages
  focus, Esc, scrim, loading-blocks-close).

---

## 5. Exact DESIGN.md tokens per piece

No raw hex/px. All names below are DESIGN.md tokens / documented component classes.

**Procurement DecisionCard + DecisionSupportPanel**
- Container: `card` component (white `card` bg on `secondary/35%` main, 1px `border`, `rounded.md`,
  16px `spacing.4` pad) — via existing `Card`/`CardPad`/`CardHead`.
- Budget figure row: `StatTiles`/`StatTile[]` (signature KPI tile vocabulary); values in `tabular`
  (Tabular-Numbers Rule); labels in `label` (12px/600) / `muted-foreground`.
- ProgressBar: existing `ProgressBar` primitive; track `secondary`, fill threshold-toned
  `success`/`warning`/`destructive` (Tinted-Status Rule); never the only signal.
- Over-budget warning line: `destructive` text + `alert` icon, or `GateNotice variant="blocked"`
  (`warning/12` bg, `warning-foreground` text, `warning/40` border — AA darkened text).
- SoD gate: `GateNotice variant="blocked"`; ready gate: `GateNotice variant="ready"`
  (`success/10` bg, `hsl(142 64% 28%)` text — the AA darkened success text already in the component).
- Primary action: `button-primary` (`primary` bg, `primary-foreground`, `rounded.md`, 32px,
  faint brand shadow). The One-Blue Rule governs (exactly one per stage).
- Secondary action: `button-outline` (`background` fill, `input` border, `foreground`; `accent`
  hover wash).
- Destructive at rest: `button-outline` (solid `destructive` fill reserved for the confirm dialog
  only — the system's single solid status fill).
- Notes textarea: `input` field tokens (`background`, `input` border, `rounded.md`, 32px-derived,
  `muted-foreground` placeholder).
- StatusPill: `badge-status` / `StatusPill` variants (`open`/`won`/`lost`/`neutral`, 6px dot + tint).
- LifecycleStepper: existing `node` variant (signature Lifecycle/Stage Stepper; `done`→`success` bar,
  `current`→`primary` bar).
- Confirm: `ConfirmDialog` (overlay shadow, focus-trap, destructive tone uses the solid fill).
- Toast: `useToast` (popover bg, 3px left accent stripe `primary`/`success`).

**Timesheet queue + expand + bulk**
- Rows: existing `ApprovalRow` (avatar `secondary`/`muted-foreground`, dashed `border` rule).
- Expanded grid: read-only `TimesheetGrid` (existing data-table cell vocabulary; `tabular` hours).
- Disclosure: `button-ghost` + `chev` icon; `accent` hover.
- Selection wash + count: bulk cluster on `primary/6%` wash with a `secondary`+`muted-foreground`
  count `pill` (DESIGN.md Toolbar selection-mode pattern).
- Checkbox: the documented 16px custom checkbox (1.5px `input` border, `rounded.xs` 4px, checked →
  `primary` fill + white check).
- Count badge on the queue header: `StatusPill variant="overdue"` (existing "N awaiting you").
- Empty/loading/error: `ListState` (loading/empty/error variants).

**Approvals inbox**
- Page head: `page-title` (24px/700/-0.02em) + `body`/`muted-foreground` sub.
- Section cards: `Card` + `CardHead`; procurement table = `DataTable` (signature) seamed via `seam`.
- Budget-remaining cell: `tabular`, threshold-toned text but always labelled.
- No-access: `AccessDenied` (existing shared surface).

**Dashboard KPI shortcut**
- `KPITile` (signature tile): tone `amber` (`warning/18` icon tile, `warning-foreground`), icon
  `check`/`inbox`, value `tabular`, `vs` sub in `muted-foreground`, help `?` (focusable Tooltip).
- Link wrapper: inherits `:focus-visible` ring; hover uses the tile's existing `state lift`
  (`0 2px 10px hsl(240 6% 10% / 0.06)`).

---

## 6. Proposed PR breakdown (gated, in order)

Recommend **three** gated PRs (not one). Each is independently shippable, reviewable, and testable;
the riskiest reorder is isolated so a design-reviewer rendered audit can scrutinize it alone.

**PR-1 — Procurement approval screen: evidence→decision reorder + D6/D7/D8 hierarchy (FE-only).**
- Reorder `ProcurementDetails.tsx` (evidence above, DecisionCard below); move SoD `GateNotice` into
  the DecisionCard; sort actions (primary → outline → destructive-last); demote the 2nd Approved-stage
  blue to outline (OD-FLAG-B). No new data.
- Tests: component test asserting **DOM/tab order** (line items + quotation sections precede the
  Approve button), one-primary-per-stage, destructive-after-primary, SoD-blocked shows no actions.
  Update the procurement e2e journey STEPS only if the reorder changes where Approve is found
  (goal-oracle "PR advances to Approved" preserved — BDD rule §3a).
- Why first: highest leverage, no data dependency, unblocks the design-reviewer rendered gate.

**PR-2 — N8 DecisionSupportPanel + dashboard KPI shortcuts (N15) (FE-only; widen one SELECT list).**
- Add the `DecisionSupportPanel` to the reordered screen; widen `DETAIL_SELECT`'s `project` join to
  include `budget,spent` (no schema/RLS change — confirm RLS-readable). Add the role-aware
  "Awaiting your approval" KPI tiles to PM/Finance/Exec dashboards routing to `/approvals`; remove the
  PM-dash fake placeholder.
- Tests: budget figures render + over-budget advisory; tile counts are honest + role-scoped; tile
  routes to `/approvals`; zero/empty/error tile states.
- Why second: depends on PR-1's layout; data-light; resolves OD-FLAG-D label.

**PR-3 — Approvals inbox promotion (N6) + timesheet expand-in-place (N11) + bulk approve (N12).**
- Promote `/approvals` to the two-section role-aware inbox (OD-FLAG-A); add expand-in-place to
  `ApprovalsQueue`; add timesheet bulk-approve with SoD-safe selection + batch confirm (OD-FLAG-C).
- Tests: inbox role-gating (Engineer→no-access, Finance→procurement-only, PM/Exec→both); inbox
  empty/caught-up; expand shows the per-project/day grid; bulk excludes non-approvable rows; bulk
  partial-failure aggregate toast; bulk keyboard select. e2e: a curated "approver clears their inbox"
  journey (one PR routed-and-approved + one timesheet bulk-approved) — encodes the natural journey
  (§3a), asserts the items leave the queue.
- Why last: largest surface, depends on OD-FLAG-A/C sign-off, and benefits from PR-2's budget cell
  in the inbox procurement table.

---

## 7. What warrants an HTML mockup before build (owner render-gate)

The owner render-gates UI before treating it as settled (the durable lesson: a design can read sound
in spec and be wrong once rendered).

- **Approvals inbox (Surface C) — YES, mockup first.** It is a NET-NEW screen with a new layout
  (two stacked sections, role-variant composition, a procurement table with a budget cell). It is the
  highest mental-model risk. Produce a static HTML mockup (PM variant = both sections; Finance variant
  = procurement-only) for owner sign-off BEFORE PR-3 builds.
- **DecisionSupportPanel (Surface A / N8) — YES, lightweight mockup.** The budget-impact panel is new
  visual vocabulary (4 figures + overlay progress + over-budget advisory); a small HTML mockup
  de-risks the "is the over-budget treatment alarming-but-not-blocking" judgment. Can be a fragment
  in the same mockup file as the reordered screen.
- **Procurement reorder (Surface A / N7/D6/D7/D8) — NO mockup; review post-build.** This is a
  re-layout of existing, already-approved blocks; the incremental change is best judged on the real
  rendered screen via the design-reviewer 3-lens rendered audit (§2.3 of design-workflow) rather than
  a throwaway mockup.
- **Timesheet expand + bulk (Surface B / N11/N12) — NO mockup; review post-build.** Both reuse
  documented patterns (read-only grid; DataTable selection-bulk wash); the rendered audit suffices.
- **Dashboard KPI tile (Surface D / N15) — NO mockup.** It's the existing `KPITile` with a new count
  + a link wrapper; trivial, review post-build.

---

## 8. Open questions / proposed additions for the owner (beyond §0 flags)

- **Budget "spent" semantics (folds into OD-FLAG-D):** confirm actual-vs-committed; ship honest label
  meanwhile.
- **Over-budget = advisory, not blocking** — confirm the org wants approval still permitted over
  budget (recommended; blocking is a server-rule, out of scope).
- **No new DESIGN.md token required.** Every piece maps to existing tokens/primitives. The only
  "addition" is a usage pattern (KPITile-as-link); if eng-planner finds the tile can't host a link
  without nesting interactives, that's a small primitive tweak, not a new token — flag at build.
