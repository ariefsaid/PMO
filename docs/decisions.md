# Owner Decisions Log

Durable record of resolved `[OWNER-DECISION]` (OD) items — the business-rule answers that unblock
write features. Each entry is locked by the owner in conversation, recorded here, then consumed by the
feature's spec at build time (one issue at a time). This file is the source of truth for "what did the
owner decide and why"; the per-feature specs cite it. THE WALL section of `docs/backlog.md` tracks
which OD items remain open.

---

## OD-PROC — Procurement lifecycle (LOCKED 2026-06-04)

Feature: procurement write/transition module (procure-to-pay). Status enum already exists:
`Draft → Requested → Approved | Rejected → Vendor Quoted → Quote Selected → Ordered → Received →
Vendor Invoiced → Paid`, plus `Cancelled`.

### OD-PROC-1 — Approval authorization matrix (flat, MVP)
Flat role-based (NO dollar thresholds for MVP). Separation-of-duties enforced on the two sensitive spots.
Admin = break-glass (may do anything). Matrix:

| Transition | Allowed roles |
|---|---|
| Draft → Requested (submit) | requester (any member, incl. Engineer) |
| Requested → Approved / Rejected | Project Manager, Finance, Executive — **NOT the requester** (SoD) |
| Rejected → Draft (rework) | requester |
| Approved → Vendor Quoted → Quote Selected (sourcing) | Project Manager, Finance |
| Quote Selected → Ordered (issue PO) | Project Manager, Finance |
| Ordered → Received (goods/service receipt) | requester or Project Manager |
| Received → Vendor Invoiced → Paid | **Finance only** (segregated from approval) |
| any non-terminal → Cancelled | requester (early) or PM / Finance / Executive (later) |

SoD rules: (a) requester ≠ approver of the same procurement; (b) approver ≠ payer.

### OD-PROC-2 — ERP document audit trail (in MVP scope)
Full PR → VQ → PO → GR → VI reference capture. Schema deltas from current (`procurements` + children
`procurement_items` / `procurement_quotations` / `procurement_documents`):
- `procurements`: add `pr_number`, `po_number`, plus `approval_notes` / `rejection_notes`.
- `procurement_quotations`: add `vq_number` (VQ per quote row; one is selected).
- **NEW `procurement_receipts`** (goods/service receipt): `gr_number`, date, status `Partial | Complete`.
- **NEW `procurement_invoices`** (vendor invoice): `vi_number`, date, status `Received | Scheduled | Paid`.
- GR/VI are **header records** (number + status) for MVP; per-line quantity matching (received 3 of 5)
  deferred post-MVP.

### OD-PROC-3 — Auto-generated reference numbers
Format `{PREFIX}-YYMMDD####` where `YYMMDD` = creation date, `####` = that doc type's count **for that
day**, zero-padded, **daily-reset**, **per-org**. Prefixes: `PR-`, `VQ-`, `PO-`, `GR-`, `VI-`.
Generated **server-side** in the transition RPC (gap-tolerant, collision-free). Example: first PO created
on 2026-06-04 → `PO-2606040001`.

### OD-PROC-4 — State machine: centralized, permissive, skippable
Transition rules defined as **data** (a transition map) in a single `transition_procurement()` RPC — NOT
scattered across UI/RLS. Optional stages are **skippable** (e.g. `Approved → Ordered` directly when there
is no formal sourcing step). One fixed superset flow for MVP; per-org pipeline customization deferred (see
OD-PROC-6).

### OD-PROC-5 — Petty cash / reimbursement = SEPARATE, deferred
Expense/reimbursement is its own flow (post-spend, employee-paid, manager-approved, no vendor/PO/GR) and
must NOT be modeled inside `procurements`. Future `expense_claims` module sharing only the approve →
Finance → paid tail. Out of MVP scope.

### OD-PROC-6 — Configurability engine = seamed, NOT built now
No per-org config tables, pipeline on/off toggles, role×stage matrix UI, dollar thresholds, or custom
roles for MVP (would violate "minimal for one client"). Cheap forward-compat seams instead:
1. All transition authorization centralized in the one RPC + transition map → later swappable for a
   config-driven version reading a per-org config table.
2. Role checks route through `auth_role()` → single choke point for custom roles later.
This bridge is crossed alongside the `org_id` → true multi-tenant push (second client with a different
process is the trigger), with its own ADR then.

### OD-PROC-8 — Admin = break-glass EXCEPT SoD (LOCKED 2026-06-09)
Admin may override role gates (break-glass) but may NOT self-approve or self-pay. Migration 0018
moves SoD-a (requester≠approver) and SoD-b (approver≠payer) OUTSIDE the `if not v_is_admin` block
in `transition_procurement` so both checks run for every actor including Admin. The role×transition
matrix skip (break-glass for role) remains inside the Admin block. This matches the timesheet rule
(OD-TS-4-D: SoD ordered before the role/manager check and cannot be defeated by break-glass). A
genuine Admin override requires reassigning the requester first so the approver is a different person.
GR-creation authority is simultaneously tightened to requester-OR-PM (matching Ordered→Received; Finance
and Executive removed). The Finance timesheet-entry RLS hole is closed (role gate added to
`timesheet_entries_write`, excluding Finance from server-side entry authoring). Proved by pgTAP 0055.

### OD-PROC-7 — Build-time resolutions (Director-ratified 2026-06-04, mode A)
Defaults resolved while speccing/planning issue #2 (within locked OD-PROC, not new business rules):
- **A** — add `approved_by_id` to `procurements` (stamped on →Approved) so SoD-b (approver ≠ payer) is
  checkable without a status-history table.
- **B** — Cancel cut: *early* = {Draft, Requested} (requester may cancel); *later* = any other non-terminal
  (PM/Finance/Exec). Admin = break-glass throughout.
- **C** — Reference-number minting = a single shared `next_procurement_doc_number(org, prefix)` security-
  definer helper backed by `procurement_doc_counters(org_id, prefix, doc_date, last_seq)` using
  `insert … on conflict do update set last_seq = last_seq+1 returning` (atomic, collision-free, daily reset
  via `doc_date` in PK, **gap-tolerant** — a rolled-back txn advances the seq; gapless audit numbering is a
  separate future design if Finance ever requires it). See ADR-0012.
- **D** — creating a GR/VI does NOT force the matching status transition (permissive; OD-PROC-4).

---

## OD-TS — Timesheet approval (LOCKED 2026-06-04)

Feature: timesheet submit/approve. Current model: weekly per user (`unique(user_id, week_start_date)`,
Monday-start), single `status` (Draft/Submitted/Approved/Rejected) + `submitted_at` / `approved_by` /
`approved_at`; entries are per-project-per-day under one weekly sheet.

### OD-TS-1 — Approver = line manager, whole-timesheet (Option A)
Timesheets are **payroll/utilization-flavored** for this client, not per-project billing. So:
- **Granularity: whole weekly timesheet** — one approval signs off the whole week (NOT per project/entry).
  Keeps the existing single-`status` / single-`approved_by` schema; no per-entry approval state.
- **Approver = the employee's line manager.** Add `manager_id uuid references profiles(id)` (nullable,
  self-referencing) to `profiles`.
- **Fallback / break-glass:** Admin may approve any submitted timesheet; if `manager_id` is null,
  Admin or Executive approves.
- **SoD:** an employee can **never** approve their own timesheet (even an Admin approving their own week
  is blocked — approver `user_id` ≠ timesheet `user_id`).

### OD-TS-2 — Flow & transitions
`Draft → Submitted → Approved | Rejected`. `Rejected → Draft` (employee edits + resubmits). Entries are
editable only while `Draft` (RLS already gates `update_own` on `status = 'Draft'`). Approve/reject sets
`approved_by` + `approved_at`; submit sets `submitted_at`.

### OD-TS-3 — Per-project PM approval = deferred
Per-project approval (each project's PM signs off hours booked to their project; ties hours → project
cost/billing) is **not** in MVP. It's the natural upgrade if/when timesheets must drive client billing or
project actuals — pairs with the budget-actuals work (see OD-BUDGET). Same config/multi-tenant bridge as
OD-PROC-6.

### OD-TS-4 — Build-time resolutions (Director-ratified 2026-06-04, mode A)
Defaults resolved while speccing/planning issue #3 (within locked OD-TS, not new business rules):
- **A** — on Rejected→Draft rework, do NOT clear `submitted_at`/`approved_by`/`approved_at` stamps (audit trail of the last cycle); they're overwritten on the next submit/approve.
- **B** — entry-edit lock reuses the existing `timesheets_update_own` Draft gate (no new mechanism).
- **C** — an approver's queue = `Submitted` timesheets where `user_id <> self`, RLS-scoped.
- **D** — a non-null `manager_id` is exclusive (that manager approves); Admin/Exec fallback applies ONLY when `manager_id` is null; Admin is break-glass throughout EXCEPT cannot self-approve (SoD wins over break-glass — the `actor = owner` check runs before the role/manager check).
- **RLS read-widening (FR-TS-008):** `timesheets_select` gains `or exists(select 1 from profiles p where p.id = timesheets.user_id and p.manager_id = auth.uid())` so an Engineer-role line-manager can see their reports' submitted sheets. The issue's only RLS change. Approval authz follows the ADR-0012 security-definer transition pattern (no new ADR).

---

## OD-BUDGET — Budget authority & spend derivation (LOCKED 2026-06-04)

Feature: budget editing + accurate dashboard spend/margin. Schema has BOTH header scalars on `projects`
(`contract_value`, `budget`, `spent`) AND versioned detail (`budget_versions` Draft/Active/Archived →
`budget_line_items` category/`budgeted_amount`/`actual_amount`).

### OD-BUDGET-1 — Budget authority = Active budget version line-items (Option B)
`budget` is authoritative as **Σ `budgeted_amount` of the project's Active `budget_version`**. Header
`projects.budget` becomes a **cache/derived**, no longer the source of truth.
- **Consequence (accepted):** the budget-versioning module becomes **MVP-load-bearing** — MVP must let a
  user create a version, add line-items, and mark exactly one **Active** per project.
- **No Active version ⇒ budget = 0.** Dashboard already guards `budget > 0`, so a project with no Active
  version is silently excluded from margin/at-risk. Therefore **seed data and project creation must
  produce an Active budget version**, else the project drops off the KPIs. Spec must enforce this.

### OD-BUDGET-2 — Spent = derived from procurement actuals, Committed basis
`spent` is **NOT stored/hand-maintained** — it is derived in SQL. Definition:
`spent = Σ procurements.total_value WHERE project_id = <project> AND status IN
('Ordered','Received','Vendor Invoiced','Paid')` — i.e. **Committed basis** (counts from PO issuance
onward). Explicitly **excludes** `Draft/Requested/Approved/Vendor Quoted/Quote Selected` (not yet
committed), `Rejected`, and `Cancelled`.
- **Labor excluded** (consistent with OD-TS — timesheets are payroll/utilization, not project cost).
- **Project-level total** for MVP. Per-category roll-up into `budget_line_items.actual_amount` (mapping
  procurement spend → budget category) is a later refinement, not MVP.
- Before the procurement-write module ships, `spent` reads 0/seed for a project with no committed
  procurements.

### OD-BUDGET-3 — Who may edit budget
Coarse write-gate for MVP: Admin / Executive / Project Manager / Finance may create/edit budget versions
and line-items (same role set as other procurement/project writes). Fine-grained (e.g. only Finance may
mark Active) deferred to the config bridge (OD-PROC-6).

### OD-BUDGET-4 — Budget categories (LOCKED 2026-06-04)
Keep the existing 7-value `budget_category` enum **as-is**: `Labor, Materials, Subcontractors, Equipment,
Permits & Fees, Overheads, Contingency`. (Mapping: "manpower" = Labor; "procurement spend" splits across
Materials/Subcontractors/Equipment.) **No generic `Other`** for MVP — misc *indirect* spend goes to
`Overheads`; **`Contingency` is reserved for the risk/unforeseen buffer only** (NOT a catch-all — keeping
it clean preserves the reserve figure for margin/at-risk reporting).
- **Fixed enum for MVP; seamed configurable later.** Making categories admin-editable (enum → seeded
  org-scoped lookup table, like `pipeline_stage_config` in OD-SP-2) is deferred to the admin-settings /
  config bridge (OD-PROC-6). The future procurement→budget per-category spend roll-up (OD-BUDGET-2
  deferred portion) will map procurement spend onto these categories.

### OD-BUDGET-5 — Spec defaults ratified + sign-off (LOCKED 2026-06-04)
`docs/specs/budget-versioning.spec.md` **signed off** by owner. The four assumed defaults flagged in the
spec are **ratified as-is**:
- **A** — Active version is read-only; revise via clone → edit Draft → re-activate.
- **B** — archiving the Active with no successor is allowed but **warns** (project → budget 0).
- **C** — Draft versions are hard-deletable; Archived versions are never deleted (version history preserved).
- **D** — line-item delete is a hard delete (no per-line audit in MVP).
Version-level history IS kept (Archived chain); per-line-item change history is the deferred bigger feature.

---

## OD-MARGIN — Dual-lens value & margin (LOCKED 2026-06-04)

Supersedes the mislabeled dashboard metric: today's `avg_gross_margin = avg((budget-spent)/budget)` is
**budget-burn headroom, NOT gross margin** (budget is cost, not revenue). Replaced by two lenses, both
**value-weighted** (not unweighted average-of-ratios).

### OD-MARGIN-1 — Two lenses by project stage
Margin means different things pre-win vs post-win, so the dashboard carries BOTH:

| Lens | Project statuses | Value basis | Margin formula |
|---|---|---|---|
| **Pipeline** (pre-win) | Leads, PQ Submitted, Quotation Submitted, Tender Submitted, Negotiation | weighted = Σ(`contract_value` × stage win-prob) | *projected*: Σ(value − Active-version budget) / Σ(value) |
| **On hand** (won/active) | Won Pending KoM, Ongoing Project, On Hold, Close Out | actual `contract_value` | *actual, weighted*: Σ(`contract_value` − `spent`) / Σ(`contract_value`) |
| **Excluded** | Loss Tender (→ win-rate denom), Internal Project (non-revenue) | — | — |

- `spent` per OD-BUDGET-2 (committed procurement). Budget per OD-BUDGET-1 (Active version) — **same budget
  mechanism applies in pipeline AND on-hand**; pipeline projects may hold multiple budget versions, latest
  Active carries through to the won project.
- **Exec Dashboard requirement:** show on-hand actual weighted margin **and** pipeline weighted value +
  projected margin (two tiles / a toggle). The SalesPipeline screen drills into the pipeline lens.

### OD-MARGIN-2 — contract_value single field + future variance seam
MVP: one `contract_value` field = best estimate at the current stage (proposal value pre-win, firms to
actual on win). **Deferred (wanted, seam-don't-build):** a value-change history/audit + a separate
`proposed_value` so proposed-vs-final (post-negotiation) variance analysis is possible later. No extra
columns/tables for MVP beyond what's needed.

---

## OD-SP — Sales pipeline (resolves held PR #12 blockers OD-SP-1/2; OD-SP-3 still open)

### OD-SP-1 — Pipeline membership (LOCKED 2026-06-04)
**Pipeline** = `Leads, PQ Submitted, Quotation Submitted, Tender Submitted, Negotiation`.
**On hand** = `Won Pending KoM, Ongoing Project, On Hold, Close Out`.
**Excluded from both** = `Loss Tender` (lost — feeds win-rate denominator) and `Internal Project`
(non-revenue / special).

### OD-SP-2 — Stage win-probabilities (LOCKED 2026-06-04, admin-configurable seam)
Defaults (owner anchored Tender = 50%, delegated the ramp; monotonic increasing):

| Stage | Win prob |
|---|---|
| Leads | 0.10 |
| PQ Submitted | 0.25 |
| Quotation Submitted | 0.40 |
| Tender Submitted | 0.50 |
| Negotiation | 0.75 |

**Storage = a seeded, org-scoped config lookup table** (e.g. `pipeline_stage_config(org_id, status,
win_probability)`), NOT hard-coded constants — so the future admin-settings UI edits rows with no
migration/code change. This is a justified cheap config table (a status→number map), distinct from the
deferred workflow-config engine (OD-PROC-6). Weighted pipeline value reads these.

### OD-SP-3 — Win-rate definition (LOCKED 2026-06-04)
Base: `wins / (wins + losses)`, **in-pipeline deals excluded** (only *decided* deals count).
Wins = {Won Pending KoM, Ongoing Project, On Hold, Close Out}; Losses = {Loss Tender}.
- **Both weightings, UI-toggleable:** count-weighted (`#won / #(won+lost)`) AND value-weighted
  (`Σ won contract_value / Σ (won+lost) contract_value`). Compute both; user toggles.
- **Time-frame filter (user-selectable period)** over the decision date — so win-rate is scoped to a
  chosen range (e.g. YTD / last quarter / trailing 12mo / all-time / custom). Query/RPC takes a date range.
- **Decision date = the Customer Contract / PO date.** New first-class fields on `projects`:
  `customer_contract_ref` (the CLIENT's contract/PO number issued **to us** — **manually entered**, it's
  theirs, not auto-generated) + `contract_date`. This inbound revenue-side award document is the mirror of
  our outbound vendor PO (OD-PROC-3, cost-side); capturing the customer PO **is** the win.
- **`decided_at timestamptz` on `projects`** (the field win-rate's time filter queries):
  - **Won** → `decided_at = contract_date` (customer PO/contract date).
  - **Lost** (Loss Tender) → no customer PO, so stamped at the loss transition (or a manual loss date).
  - Nullable; null = still in pipeline / undecided. Doubles as the seed of the deferred status-history
    (OD-MARGIN-2).

### PR #12 (SalesPipeline) — re-evaluation note
PR #12 was built BEFORE OD-MARGIN/OD-SP and computes margin the old (mislabeled) way with no win-prob
config table, no `decided_at`, no dual win-rate, no time filter, and no projected-margin/pipeline-value
on the Exec Dashboard. It is therefore **superseded, not merely polish-away from merge**. Recommended:
treat the pipeline + dashboard-margin work as a fresh issue built on the budget + procurement foundations
(see build-order note in backlog), and close/redo PR #12 rather than force-fit it.

### OD-PR — Projects revenue/transitions build-time resolutions (Director-ratified 2026-06-04, mode A, issue #4)
- **A** — `pipeline_stage_config` write gate = coarse 4-role (Admin/Exec/PM/Finance), consistent with
  `projects_write`/`budget_versions_write`; Admin-only tightening deferred to the OD-PROC-6 config bridge.
- **B** — permissive `transition_project` legal map: win reachable from late pipeline (Quotation/Tender/
  Negotiation); free on-hand interconversion (Ongoing/On Hold/Close Out); `Loss Tender→Negotiation` and
  `Close Out→Ongoing` re-open allowed; `Internal Project` reachable only from Leads.
- **C** — win-capture (require `customer_contract_ref`+`contract_date`, stamp `decided_at=contract_date`)
  fires only on FIRST reach of `Won, Pending KoM` from a pipeline stage; on-hand re-entry doesn't re-stamp.
- **D** — `decided_at = contract_date::timestamptz` (midnight) on win; `= now()` on `Loss Tender`.
- Transition = `transition_project` security-definer RPC (ADR-0012 pattern; no new ADR). UI mounts on the
  live-backed `pages/Projects.tsx` (the mock `ProjectDetails` prototype stays out — separate decomposition issue).

## OD-UX — UX-naturalness program (LOCKED 2026-06-08, owner-decided)
From the IxD + IA audits (`review/ixd-master.md`, `review/ia-navigation.md`) → Wave-1 plan (`docs/plans/2026-06-08-ux-naturalness-wave1.md`) + ADR-0020.
### OD-UX-1 — Write-confirm policy SUPERSEDES "confirm before every write"
The UI-polish-round directive "confirm before every DB write" is **superseded**: confirm only **consequential/destructive** actions (Approve, Reject, Cancel, Mark-Paid, Mark-Lost, every delete/archive); **routine reversible** forward steps (procurement Advance, pipeline stage-advance) become **single-click + a toast**. (IxD SP-1; better serves the original intent — clear feedback — without a modal on every click.)
### OD-UX-2 — Lifecycle = ONE canonical record (Model B, ADR-0020)
One `projects` record; one `/projects/:id` detail page with a stage-adaptive lens (pipeline lens pre-win, delivery tabs once won); `/sales/:id` redirects. Pipeline and Projects = disjoint stage partitions. **Lost deals stay in the Pipeline** (kanban terminal "Lost" column + "Lost" filter), excluded only from the active Projects (delivery) list. Model A (separate `opportunities` table + convert-at-Won) deferred as the cleaner end-state.
### OD-UX-3 — Board pack = disabled "coming soon"
The no-op Board-pack CTA becomes a visibly-disabled "coming soon" affordance (no fake success); a real export lands with the Reports module.

## OD-W2 — UX-naturalness Wave 2 (RBAC view-gating + IxD) (LOCKED 2026-06-09, owner-decided)
Plan: `docs/plans/2026-06-09-ux-naturalness-wave2.md`. Enforces ADR-0016 (`can()` FE gating; RLS stays the authority).
### OD-W2-1 — Engineer procurement = own-scoped
Engineer sees `/procurement` scoped to their OWN requests and may "Raise request"; no approve/edit/manage on others' PRs (rbac-visibility §A/§E + the existing RLS scoping).
### OD-W2-2 — Engineer approval = OFF at the FE for now; configurable role-access DEFERRED to a future admin-settings / config engine (the OD-PROC-6 bridge)
`policy.ts` keeps denying Engineers any approve/return affordance (incl. manager-Engineers); ApprovalsQueue gating excludes Engineer. **The `transition_timesheet` RPC stays UNCHANGED** — it authorizes timesheet approve by `manager_id` (role-agnostic) + SoD (≠ own) + a null-manager Admin/Exec fallback, so a manager-Engineer's server capability is **dormant/unreachable via the UI**, NOT a hole (`manager_id` is admin-set only, SoD-gated, scoped to the actual report). This is the sanctioned ADR-0016 "FE stricter than RLS" pattern; **no RLS/RPC migration**. Re-enabling later = a one-line FE-policy/config change when the admin config engine ships. Owner intent: that engine will let an admin add/define roles + access; until then Engineer-approval is hard-off at the FE.
### OD-W2-3 — Finance pre-win `contract_value` = as-is (ratified)
Pre-win editing stays Admin/Exec/PM; Finance only at the won-SoD boundary. Flag-only, no build task.
### OD-W2-4 — Executive Tasks = via the project Tasks tab; no top-level `/tasks` console (ratified).
### OD-W2-5 — Dead/no-op affordances = honest-disabled / removed (OD-UX-3 precedent)
`/reports` = honest "coming soon" stub; the notification **bell is REMOVED** (no destination); the Sales **"Export" → disabled "arrives with Reports"**.

## OD-W3 — UX-naturalness Wave 3 task-flow decisions (LOCKED 2026-06-09, owner-decided; from the new IxD task-flow audits)
### OD-W3-1 — Timesheet **Submit auto-saves first** = BUILD (Wave 3)
Keep both Save + Submit buttons (per the owner's original Wave-1 ask), but **Submit no longer requires a prior Save click**: it saves any valid dirty rows, then submits, then the final confirm. Submit-readiness must read the edit buffer, not only persisted entries. The owner's originally-flagged timesheet flow; pairs with F5.
### OD-W3-2 — Procurement create = KEEP the two-step (no change)
"Raise request" stays modal (title/project/vendor) → Draft → detail page for line items. A Draft PR is a legitimate, editable, cancellable state; the cohesive-composer rework is not worth it.
### OD-W3-3 — Vendor-Invoice capture = CO-LOCATE with the transition = BUILD (Wave 3)
Entering the invoice details becomes part of the **Mark-Vendor-Invoiced** action (one step), mirroring the Mark-won inline contract-ref/date capture — evidence-with-state, no "invoiced before the invoice". Touches `ProcurementDetails.tsx`; pairs with N1.
### OD-W3-4 — Inline pipeline stage-change = KEEP / DEFER (no change)
No drag-and-drop / row-dropdown stage change on the board; the detail page (PipelineLens) stays the single place to advance a deal. DnD kanban is a sizeable build — revisit only if pipeline grooming becomes a real pain.

## Wave 5 — Approval Experience (OD-W5-*, locked 2026-06-09; plan `docs/plans/2026-06-09-wave5-approval-experience.md`)
### OD-W5-1 — Approvals inbox = PROMOTE the existing `/approvals` route
One canonical role-aware inbox (NOT a new `/inbox`): lists everything awaiting the viewer's decision — procurement PRs (link to the decision screen) + timesheet weeks (embedded queue) — gated by `may('transition', entity)` (Engineer → no access; Finance → procurement; PM/Exec → both). UX-only; RLS is authority. Dashboard "Awaiting your approval" KPI-as-link routes here (N15).
### OD-W5-2 — Approved stage = BOTH forward paths stay, skip-able (one VISUAL primary, both reachable)
The state machine already allows `Approved → Vendor Quoted` (quote-first) OR `Approved → Ordered` (skip-to-PO). Do NOT force one. Keep both actions; give ONE a visual `primary` and the other `outline` so no stage emits two blue primaries (resolves D7), but the user can choose either path as the situation needs (sole-source → straight to PO; competitive → quotes first). Supersedes the plan's "Request Vendor Quotes is THE primary" — it's the default emphasis, not the only path.
### OD-W5-3 — Bulk approve = BOTH timesheets AND procurement, but EVIDENCE-BASED
Bulk-approve for both queues, with one `ConfirmDialog` per batch + aggregate toast; SoD always skips rows the viewer can't approve. "Evidence-based" = a reviewer must be able to see the per-record evidence (timesheet per-project/day breakdown N11; PR line-items/quote/budget-impact) before bulk-approving — bulk is a convenience over reviewed rows, never blind. Supersedes the plan's "timesheets only in v1".
### OD-W5-4 — Budget-impact figure = COMMITTED basis (include open POs)
The decision-support panel's "spent/remaining" uses the existing **OD-BUDGET-2 committed basis** (`spent` = Σ procurement `total_value` in `Ordered..Paid`), already derived in SQL (`0009`). Label honestly as commitment-vs-budget. Over-budget = non-blocking advisory.
### OD-W5-5 — PO-commitment approval gate + cashflow = DEFERRED to their own feature track (NOT this IxD wave)
Owner insight: the **PO/commitment** approval is the business-critical gate (actual order commitment vs budget AND cashflow), more so than the request approval. But (a) a *server-enforced PO-commitment approval gate* (a distinct authority signs off the PO before it's placed) is a new state-machine state + RPC + ADR, and (b) **no cashflow / cash-position data exists** in the system at all. BOTH are new features, NOT IxD. Decision: ship Cluster-1 IxD now (make the PO decision evidence-rich with the budget/committed data we already have), and spin the PO-commitment-approval gate + a cash-position data domain into a **separate spec/ADR feature track** (see backlog "Deferred feature track"). Cluster-1 IxD must NOT change the procurement state machine / RPCs.

## Wave 5 — Cluster 2: Dashboard drill-through + finance-console (OD-W5-C2-*, Director-adopted 2026-06-10; plan `docs/plans/2026-06-10-wave5-dashboard-console.md`)
Owner mandate "proceed until wave 5 & wave 4 completion" → Director adopts the design-architect's recommendations (all within the signed Wave-5 direction + the locked honest-dashboard rule):
### OD-W5-C2-A — "at-risk" = the existing `spent/budget ≥ 0.9` (one shared constant)
Reuse the canonical threshold already in `get_executive_dashboard`/BvACard/PMDashboard. No schedule/aging signal (would need a data domain that doesn't exist). Pin it as one shared constant consumed by the at-risk filter + PM risk-sort.
### OD-W5-C2-B — J4 finance-console = RESTRAINED reframe
Tabular-nums, right-aligned money, variance-first framing, existing tokens only — NOT a redesign (a bigger one risks DESIGN.md-banned chrome). No new DESIGN.md token.
### OD-W5-C2-C — N16 invoice-ready in BOTH places
A `Vendor Invoiced` segment/filter on the Procurement list (the destination) + a Finance "Ready to pay" dashboard table (the doorway → routes to the PR's Mark-as-Paid).
### OD-W5-C2-D — 4 KPI tiles stay PLAIN (honest-doorway rule)
Revenue-on-hand, Pipeline-forecast-margin, and the on-hand/contract-value tiles do NOT drill (no honest filtered destination exists — `/sales` has no margin lens). Only drill where a real filtered view exists. Fix the Exec "Total contract value" `vs` copy ("active+closed-out" → Ongoing-only).
### OD-W5-C2-E — N17 variance ranking = HONEST-LABELLED FE-resort NOW + backend RPC tracked
The `top_projects` RPC is `LIMIT 5 by contract_value`, so an FE variance re-sort only re-orders those 5 — the worst bleeder could be the 6th-largest and never fetched. Per the honest-dashboard rule we do NOT present it as "the most over-budget projects". Ship now: FE-resort the available set with an **honest label** ("Top contracts by variance" / scoped wording) so it's not misrepresented; track a backend `get_finance_budget_review()` (rank ALL projects by variance) as a follow-up feature. **Owner may override to fund the backend slice into this cluster** (flagged in the report + backlog).
