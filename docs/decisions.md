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
> **⚑ REVISED by ADR-0033 (2026-06-19, owner-signed).** The column-based shape below (PR#/PO# as columns
> on `procurements`; GR/VI as header tables) was the *original* MVP cut. ADR-0033 promotes procurement to
> a **case folder over ERP-canonical record tables** — PR, RFQ, Quotation, PO, GR, Invoice, Payment each
> their own 1:N table with a **dual identity** (minted system number + external reference) + file upload.
> Read ADR-0033 as the current authority; the text below is retained for history.

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
> **Extended by ADR-0033 (Director-ratified 2026-06-19):** two new prefixes `RFQ-` and `PAY-` join the
> list (for the RFQ and Payment record types the owner approved). Same minter (`next_procurement_doc_number`),
> same format — a forward extension of the mechanism, not a new one. The `VQ-` prefix is retained for the
> record now UI-labelled "Quotation" (do NOT rename to `QT-` — would orphan existing `VQ-…` numbers).

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
- **AMENDMENT (2026-06-21, ADR-0034 — Reserved layer).** This Committed basis is **UNCHANGED** — `spent`
  and every dashboard/Finance surface still count only `Ordered..Paid`. ADR-0034 adds a **distinct,
  presentation-only `Reserved`** figure (Σ `total_value` of `Approved/Vendor Quoted/Quote Selected` — the
  approved-but-not-ordered demand) used **only** in the procurement decision-support panel, where
  `Available = Budget − Committed − Reserved`. Reserved never enters the committed basis (no dashboard
  ripple); it makes the approval decision honest about concurrent approved demand. UI term: "Reserved"
  (never "encumbered").

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

## Wave 5 — Cluster 3: Project/record detail legibility (OD-W5-C3-*, Director-adopted 2026-06-10; plan `docs/plans/2026-06-10-wave5-detail-legibility.md`)
Adopt the design-architect recommendations (within OD-W3-4 / OD-UX-1 / role-shaping):
### OD-W5-C3-A — D15 finance-chrome demotion = MOVE-BELOW (not hide), Engineer default tab = Tasks
For delivery-forward roles (Engineer) the header finance StatTiles + contract-value SoD row MOVE into an Overview "Financial summary" card (reachable + labelled, read-only lock — never DELETED, RLS-permitted data stays visible), the header leads with delivery meta, and the default tab is Tasks. Finance-forward roles (Admin·Exec·Finance·PM — PM owns the budget) keep the finance-forward header unchanged. FE-only on `realRole`; FE never shows less than RLS forbids, just reprioritizes.
### OD-W5-C3-B — N10 post-transition = INLINE affordance (not auto-navigate)
A persistent quiet "Back to Sales Pipeline" link in the Next-actions area + focus moved to the updated card (Advance/Lost) or the header h1 (Won → page becomes delivery layout); toast unchanged (OD-UX-1). Respects OD-W3-4 (the detail page stays the place to advance; a PM advancing wants to stay on the deal, not be yanked away).
### OD-W5-C3-C — D9 lifecycle = FULL-WORD labels + accessible name (not hover-only)
Stepper nodes show full words (Purchase Request / Vendor Quote / Purchase Order / Goods Receipt / Vendor Invoice / Paid); the mono acronym stays as the ref; `title`/`aria-label` per node. Pipeline "PQ" → "Pre-Qualification". Full word always visible (legible without hover).

## OD-W5-C6 — Cluster 6: D13 only; D11/D12 detail drawers DEFERRED (owner 2026-06-10)
Cluster 6 plan (`docs/plans/2026-06-10-wave5-detail-drawers.md`) needed a NET-NEW quick-view Drawer primitive for D11/D12 (company/document detail + inline status). Owner chose: **skip the drawers, ship only D13, go straight to Wave 4 (mobile — the bigger flagged item).** D11/D12 (company + document quick-view drawer + inline status; the design-plan + the Drawer-primitive sketch are ready to pick up) are **deferred** to a later polish pass. **D13 DONE:** removed the dead disabled "Attach file (coming soon)" button on the Documents register (honest-affordance rule OD-W2-5) — the Storage deferral is signposted by the register subtitle copy, not a fake control. (The exec-dashboard Board-pack "coming soon" is a DIFFERENT, legitimate honest-disabled signpost with a future Reports route — unchanged.)

## Wave 4 — Mobile responsiveness (OD-W4-*, Director-adopted 2026-06-10; plan `docs/plans/2026-06-10-wave4-mobile.md`)
The app was MORE mobile-ready than "desktop-only" implied (rail→drawer ≤920px, `.touch-target` ≥44px utility, StatTiles scroll-snap, LifecycleStepper/Funnel/kanban overflow-x, TimesheetGrid sticky-col all already shipped). The ONE structural gap = the shared `DataTable` has no stacked-card reflow. Adopt the design-architect recommendations (standard mobile patterns, low-risk):
### OD-W4-1 — Shell mobile nav = KEEP the DRAWER (not bottom-nav)
The grouped role-nav exceeds the 5-item bottom-nav ceiling; the rail→drawer at ≤920px already works. Harden it (focus-trap/Esc/close, safe-area) rather than replace.
### OD-W4-2 — Kanban mobile = scroll-snap + a sticky stage-progress indicator (not a stage-picker)
The Table view (now card-reflowed) is the dense single-column alternative.
### OD-W4-3 — Timesheet mobile = KEEP the 7-day matrix (horizontal-scroll + sticky project/Total columns), not a per-day list
Preserves the editable grid mental model; the sticky cols + scroll-fade make it usable at 375px.
### OD-W4-4 — Adopt `md` (768px) as the table→card reflow breakpoint, a DESIGN.md standard; keep TWO breakpoints (920px rail-collapse / 768px table-reflow)
The shared `DataTable` dual-renders: `<table hidden md:block>` + a `md:hidden` stacked-card list reusing the existing `Column.header/cell/rowLabel/rowMenu/state` API — zero consumer churn, desktop byte-unchanged (can't regress), every list inherits it. The only DESIGN.md addition is documenting the 768px reflow breakpoint (no new color/type/spacing token). Build + 375px rendered design-review per PR (not mockup-first — the owner steered straight to mobile; the rendered review catches reads-wrong). PR order: PR-1 DataTable→card + touch-target sweep (highest reach, lowest risk) → PR-2 shell hardening → PR-3 detail surfaces (tabs strip, header, kanban scroll-snap, timesheet/stepper hardening).

## OD-DEL — Delivery backbone: milestones + task grouping (LOCKED 2026-06-11)

Feature: spine 3 — delivery execution state on the canonical `/projects/:id` detail page
(ADR-0021). No new nav module.

### OD-DEL-1 — Location: canonical project detail, no new nav module
Delivery state lives entirely on the existing `/projects/:id` page (ADR-0021): a milestone
strip in the header area, milestone grouping on the Tasks tab, and delivery-% rollup chips on
the Projects list and dashboards. No standalone `/delivery` route or separate delivery module.
Every lifecycle stage can display milestones (a pre-win deal can be planned) — consistent with
ADR-0021's "tabs at every stage" rule.

### OD-DEL-2 — Milestones are free-form per project (no org-level taxonomy in MVP)
Milestones are created freely by the PM per project — there is no org-level template or
taxonomy. Forward seam: an org template (following the `pipeline_stage_config` pattern) may
later pre-fill per-project rows; because the per-project shape is identical either way, nothing
would need to be unwound. Owner chose simplicity over portfolio phase-comparability; overall
project-% stays comparable across projects regardless.

### OD-DEL-3 — Two-level hierarchy only: milestone → tasks (nullable milestone_id)
Milestones group tasks via a nullable `milestone_id` on `tasks`. Tasks without a `milestone_id`
are ungrouped. No sub-milestones, sub-tasks, or WBS nesting beyond this two-level structure.
Deeper nesting is deferred until a real customer need justifies it; it is additive (a
`parent_id` on tasks) with no rework required.

### OD-DEL-4 — Two-column progress: calculated + input (no override machinery)
Milestone progress is two columns, both always visible:
- **Calculated %** — read-only, derived from the milestone's tasks: `Done tasks / total tasks`
  (expressed as a %). Empty (null) when the milestone has no tasks.
- **Input %** — nullable, typed by the PM.
- **Effective %** = `input_pct` when non-null; else `calculated_pct`; else `0`.

Both columns render side by side so any divergence between the PM's figure and task-derived
progress is self-evident. Blanking the input field returns authority to the calculated value.
(Owner refined this from earlier "manual + hint" and "override-flag" variants discussed in the
same session.)

### OD-DEL-5 — Project delivery % = weight-weighted average of milestones' effective %
`delivery_pct = Σ(milestone.weight × milestone.effective_pct) / Σ(milestone.weight)`.
PM assigns weights; default = equal weights (each milestone's share = 1/N). Null milestones
with no effective % contribute 0. A project with no milestones has no delivery %. Budget-
value-weighted variant (weight = milestone budget allocation) is deferred to the cost-code
track.

**Worked example.** 3 milestones, weights 20/30/50, effective % 100/40/0:
`(20×100 + 30×40 + 50×0) / (20+30+50) = (2000+1200+0)/100 = 3200/100 = 32%`.

### OD-DEL-6 — No stage-gates in MVP
Milestones are ordered and dated but nothing blocks progression between them. No gate
enforcement: a later milestone may be marked in progress even if an earlier one is incomplete.
Revisit gate enforcement with the progress-billing track — payment milestones naturally demand
gated sign-off before a payment application can be raised.

### OD-DEL-7 — Write authorization: PM + Admin (milestone CRUD, input-%, weights)
Milestone create/edit/delete, input-% updates, and weight edits are gated to Project Manager
and Admin roles (`can()` UX + RLS authority per ADR-0016/0019 patterns). Engineers influence
the calculated % only through their own task statuses, governed by the existing
migration-0016 task-status RLS (no change). Finance and Executive are read-only on milestones
(no write affordance).

### OD-DEL-8 — O&M = spine 9, distinct from Delivery
Delivery is finite: it ends at handover/commissioning. O&M is a recurring post-handover
contract (maintenance schedules, SLAs, asset care). Conflating them would force the milestone
model to represent both a one-time project lifecycle and an ongoing maintenance cycle — two
incompatible time shapes. The handover gate is the explicit birth event of an O&M contract and
its installed-asset record. Spine 9 therefore has a hard dependency on spine 4 (recurring
billing) and spine 8 (asset registry) and is sequenced after them. Defined in
`docs/roadmap-spines.md` and `docs/glossary.md`.

---

## OD-ARCH-1 — REST-first reads; RPCs reserved for SoD + aggregation + atomic minting (owner-affirmed 2026-06-10)
(Re-recorded — an earlier commit of this was lost.) Owner asked "why not REST?" during Wave-5 C5 (after migration 0020 extended the `get_sales_pipeline` RPC). Confirmed principle (the app already follows it): data reads/writes go through **PostgREST `.from().select()`** via the repository/DAL seam (ADR-0017) — 17 DAL files, embedded joins, the portable/BE-swappable path. **`.rpc()` is reserved** for what REST can't/shouldn't do: (a) server-enforced **SoD / state machines** (`transition_*`, `set_project_contract_value`, `select_procurement_quote` — the authority must be a security function), (b) server-side **aggregation** (`get_executive_dashboard`, `get_sales_pipeline`, `get_win_rate`, `get_project_budget` — grouped rollups REST can't express in one call), (c) **atomic number-minting creates** (`create_procurement_receipt/invoice/quotation`). RPCs add Postgres coupling, justified only for these. **Owner chose to EXTEND the existing RPC** (Wave-5 C5 / migration 0020 added `last_update`+owner to `get_sales_pipeline`) for one-call/one-source cohesion rather than a second REST round-trip — accepting the modest coupling. Going forward: lean REST for simple per-row reads; extend/author an RPC only when the funnel/SoD already lives there.

---

## OD-DOC — Document file storage (grill-with-docs session, owner-locked 2026-06-12)

First issue of the KANNA gap-closing series (`review/kanna-gap-analysis.md`). Grilled per the
new playbook §2 step-1b gate.

### OD-DOC-1 — Issue scope: infra + Documents tab only; procurement next; photos out
Issue #1 = Storage re-enable (local config + prod buckets) + private org-scoped bucket +
storage RLS + upload/preview/download on `project_documents` end-to-end. **Issue #2 =
procurement attachments** (quotation files + GR/VI) reusing the shared upload component —
sequenced immediately after #1 and **before S-curve/Gantt** (daily approver pain beats
visualization). **Site photos are explicitly OUT** — field capture/gallery is a different
domain concept (future field-reporting track), not a register entry.

### OD-DOC-2 — One file per document; Draft-only replacement
A document row carries at most one file. The file may be uploaded/replaced only while the
document is **Draft**. Once it leaves Draft (Issued+) the file is immutable — content changes
require a new revision (OD-DOC-3). Free file replacement on approved documents would gut the
approval workflow's meaning.

### OD-DOC-3 — Revisions via explicit "New revision" action; auto-Superseded through the link
Rev B is created *from* Rev A by an explicit **"New revision"** action (visible primary
affordance on Issued/Approved documents — NOT buried in an overflow menu; owner-specified to
reduce bypass risk). It copies code/title/category, bumps the revision mark, and stores an
explicit parent link. When the newer revision is Approved, the parent flips to a new terminal
status **`Superseded`** automatically — through the link only, never by code/title matching
(heuristic misfires corrupt the register; manual-bypass merely degrades to today's behavior).
Old revisions stay readable forever.

### OD-DOC-4 — File read access = register row access; category-gating deferred to Admin settings
Whoever can read the document row can download its file (org-scoped, all roles) — consistent
with the real security model (`can()` is UX; RLS is authority; finance-hiding for ICs is UX
chrome). **Deferred seam (owner-directed):** per-category access control lands with the
Admin-settings / RBAC-config-engine track (OD-PROC-6) — document categories become managed
entities there, each carrying a who-can-access rule. Until then: don't upload what the whole
org may not read (same rule as today's metadata).

### OD-DOC-5 — File constraints: 5 MB cap (bumpable), strict type allowlist
Cap is **5 MB for now** (testing) — implemented as a single bumpable knob (bucket limit + one
shared constant), not scattered literals. Allowlist: pdf · png/jpg/webp · docx/xlsx/pptx ·
dwg/dxf · csv/txt. **No zip, no executables** until a real user asks — every allowlist
exception is forever.

## OD-DATE — Date math via date-fns (graduation note, ADR-0030 Discover→Graduate→Cover; 2026-06-16)
date-fns vendored for date parsing/arithmetic (pinned exact, MIT) so no one hand-rolls
timezone-stable date parsing again.

### ENG-A2-1 — AssistantPanel dual-mode contract requires both-mode coverage (2026-06-30)

The AssistantPanel has two fundamentally different a11y modes (D-A2-1):
- **Desktop (≥1024px):** `role="complementary"`, NON-modal, no focus-trap, no scrim, background NOT inert.
- **Mobile (<1024px):** `role="dialog" aria-modal`, full focus-trap, scrim, background inert.

**Rule:** Both modes MUST have automated test coverage. jsdom's `matchMedia` default returns `true` for
all `min-width` queries, so standard tests only exercise the desktop branch. Any test file exercising
the mobile branch MUST stub `matchMedia` to return `false` (via `vi.stubGlobal`). Failing to cover
both modes means a regression in the focus-trap or background-inert logic would ship green.

**Canonical coverage file:** `src/components/panel/AssistantPanel.mobile.test.tsx` stubs mobile
viewport and asserts role/aria-modal, scrim click-close, #main inert on open, scroll-lock, axe.

**Graduated from:** design-review Discover finding, Blocker 10 (2026-06-30 A2 review).

---

### ENG-A2-2 — agent runtime getJwt must read session via ref, never a memo-captured value (2026-06-30)

Supabase silently refreshes access tokens every ~55 minutes via `onAuthStateChange`. If `getJwt` is
constructed inside a `useMemo([])` closure capturing the `session` React state value, it will return the
stale token from the first render for the entire session lifetime — every agent-chat POST after the first
token refresh gets a 401.

**Fix pattern (binding):** keep a `useRef` updated on every render:
```tsx
const sessionRef = useRef(session);
sessionRef.current = session; // runs every render, no dep-array lint issue
// inside useMemo:
getJwt: () => sessionRef.current?.access_token ?? ''
```

This is the standard React pattern for stable callbacks that need the latest state — same as
`runIdRef.current` in `useAssistantPanel.ts`. The `eslint-disable-next-line react-hooks/exhaustive-deps`
comment is not needed when using this pattern (the ref is stable).

**Canonical test:** `AgentRuntimeProvider.test.tsx` — the "stale JWT closure" test re-renders with a
new session object and asserts `getJwt()` returns the updated token.

**Graduated from:** design-review Discover finding, Blockers 3/7/8 (2026-06-30 A2 review).

---

### OD-DATE-1 — Date math uses date-fns (UTC-stable); never hand-roll T00:00:00Z parsing
All date parsing/arithmetic uses **date-fns** (`parseISO`), pinned exact (MIT). Two conventions,
both preserved: **UTC-midnight** — `parseISO('${iso}T00:00:00Z')` — for time-axis coordinates /
day-diffs (sCurve, ganttLayout); and **LOCAL-tz** — `parseISO('YYYY-MM-DD')` = local midnight —
for the calendar grid + xlsx cells (monthMatrix, `toWorkbookBuffer`). Do NOT hand-roll
`new Date(\`${iso}T00:00:00Z\`)` / manual `getUTC*` / `getFullYear` string-building. Two
intentional native exceptions stay (would need `date-fns-tz`, not worth a 2nd dep):
`formatDocNumber` (UTC parts) and `formatSCurveAxisDate` (Intl UTC formatter).

---

## OD-A3 — Agent write-actions (A3) design decisions (graduated from Discover pass, 2026-06-30)

### OD-A3-CHIP — Approval chip state MUST be keyed by `pendingId`, not a single global atom

**Decision (structural correctness):** `ChipStateMap = Record<string, ApprovalChipState>` replaces the former single `approvalChipState` atom in `useAssistantPanel`. Each chip looks up its own state by `pendingId`.

**Why:** A single global resets to `pending` when the second proposal arrives, which re-enables Approve/Deny on any earlier resolved chip — allowing the user to double-approve a write action or approve an action the agent has moved past. This is a UX correctness failure, not cosmetic. The per-`pendingId` map isolates each chip's lifecycle: once `approved` or `denied`, it stays resolved even as new proposals arrive.

**Enforced by:** `AssistantPanel.test.tsx` — "two sequential needs-approval events: first chip shows Approved after approval even when second chip is pending."

**Canonical implementation:** `src/hooks/useAssistantPanel.ts` exports `ChipStateMap`; threaded via `Transcript` → `TranscriptItem` → `ApprovalChip`. The active `pendingId` is tracked with a `useRef` so `approve()` / `deny()` update only the current chip.

**See also:** DESIGN.md §5 ApprovalChip — "Per-chip state keyed by pendingId" note.

---

## OD-A4 — Agent compose-view (A4) design decisions (graduated from Discover pass, 2026-06-30)

### OD-A4-SAVED-TOKEN — Blocker-6 success-text token rule extends to ArtifactSlot "Saved" label

**Decision:** Any future success-green text in the AssistantPanel or its child components MUST use
`text-[hsl(var(--success-text))]` (the AA-darkened `--success-text: 142 64% 28%` token), NEVER a raw
Tailwind literal such as `text-green-600`. This rule, already enforced on `ApprovalChip`'s "Approved ✓"
label (DESIGN.md §5 Blocker-6), extends to every success-state label in the panel — including
`ArtifactSlot`'s "Saved" label.

**Why:** `text-green-600` bypasses the token pipeline (different L value), fails AA contrast on tinted
fills, and breaks dark-mode. The `--success-text` token is explicitly designed for AA compliance.

**Enforced by:** `ArtifactSlot.test.tsx` — "Blocker-1 Saved label does NOT use raw text-green-600 class."

### OD-A4-CONTROL-HEIGHT — Blocker-9 control height rule applies to ArtifactSlot Save + Open-view controls

**Decision:** `ArtifactSlot`'s Save button and Open-view link chip MUST be `h-8` (32px), matching the
app-wide control height rule (DESIGN.md §5 Buttons "32px tall"). Using `py-1.5` or `py-1` alone yields
~28-30px and violates the rule. The `h-8` height class is authoritative; `py-0` prevents override.

**Why:** Parity with every other panel control (ApprovalChip Approve/Deny are `h-8`). Consistent target
size across the panel interaction surface.

**Enforced by:** `ArtifactSlot.test.tsx` — "Blocker-2 Save button has h-8 class" and "Blocker-2 Open-view
link chip has h-8 class."

### OD-A4-RETRY — Per-panel onRetry parity with I3 UserViewRenderer (FR-VR-038)

**Decision:** `ArtifactSlot` per-panel error states carry `onRetry` parity with the I3 `UserViewRenderer`
(FR-VR-038). A transient `executeCompiledQuery` failure (RLS hiccup, network blip) in a composed-view
panel MUST show a Retry button — composed-view panels are never a dead doorway. The per-panel retry
re-fires `executeCompiledQuery` for only that panel index and updates `panelStates[idx]`.

**Why:** The agent-assistant compose job (jtbd §81) and the view-render honest-states job (§82, "no dead
doorway") both demand recoverable error states. The artifact slot is the one place a freshly-composed live
view is most likely to be re-checked; it must not leave the user needing to burn another model call to
recover from a transient error.

**Enforced by:** `ArtifactSlot.test.tsx` — "Blocker-3 per-panel error state shows a Retry button that
re-fires the query."

### OD-A4-RENAME — CV-OD-002 "rename on Save" is a real affordance, not just rationale

**Decision:** `ArtifactSlot` exposes an editable name `<input>` pre-filled with `payload.title`
(the CV-OD-002-derived prompt-truncation title) before Save. The user MUST be able to edit the name
before committing. `save(name)` receives the edited string — never `payload.title` directly. Default
scope is `'private'` (CV-OD-005).

**Why:** CV-OD-002 rationale explicitly says "the user can rename on Save" as the honest fallback for
choosing prompt-truncation over a model-supplied title. Without an editable name field, a user composing
"Show me active projects by status" commits a view literally named that fragment, with no chance to
rename it before it lands in My Views. The inline input (option a from the Discover recommendation)
keeps the stay-in-panel mental model consistent with the I4 builder's name-before-save flow.

**Enforced by:** `ArtifactSlot.test.tsx` — "Blocker-4 ArtifactSlot renders an editable name input
pre-filled with payload.title" and "Blocker-4 Save calls create.mutateAsync with the EDITED name."

**Spec note:** FR-CV-018 ("save(name)") is fulfilled; this decision closes the CV-OD-002 honest-fallback
gap.

## OD-ATC-PENDING — Transcript pending-interaction UI (review-remediation round, 2026-07-04)

### OD-ATC-PENDING-BLUE — Pending-family blue rule: blue commits writes, question submit is neutral

**Decision (locked this round):** `--primary`/`bg-primary` in the pending-interaction family is reserved
for the write-COMMITTING action (`ApprovalChip`'s Approve). The free-text `QuestionChips` Submit button
does not commit a write — it uses the neutral/outline confirm idiom (same classes as Deny/option chips),
never `bg-primary`.

### OD-ATC-PENDING-DEFERRED — Noted for later: dual-input mental model + feedback-control affordance polish

**Noted, not built this round (F6/F7 deferred):** (a) the free-text question input and the main Composer
present two separate text-entry surfaces at once, a dual-input mental model worth revisiting; (b) the
FeedbackControl (thumbs) affordance could use a polish pass. Both are tracked here for a future round, not
in scope of the review-remediation items actually shipped (items 1-7).

## OD-ONB — Client onboarding tooling (GTM item 6, spec review 2026-07-04)

### OD-ONB-1 — Historical import carries a dual reference (`reference_number` + `import_key`), not a fictional `external_ref`

**Decision (locked this round):** the historical-import CSV contract's legacy/external identifier lands
in the record tables' **real** `reference_number` column (migrations 0035/0040/0041) — there is no
`external_ref` column anywhere in the schema, and none is added. The legacy number serves **two**
independent purposes, kept conceptually distinct: (1) it is stamped into `reference_number` so a human
or a future ERPNext adapter (ADR-0048) can reconcile the record against the source system it came from;
(2) when present, it is *also* the source material for that record's stable `import_key` (the
re-run-idempotency fingerprint from Deliverable 2). A case header has no `reference_number` column at
all (`procurements` carries only the system-minted `code`) — the case's `import_key` is derived from the
CSV's `case_ref` grouping column instead, never persisted as a reference number.

**Why:** the spec's first draft invented `external_ref` and mis-cited OD-PROC-3 ("Auto-generated
reference numbers" — the system-minted `PR-YYMMDD####` format) as its authority, which is the *opposite*
concept (system-assigned, not external/legacy). The real reconciliation need — letting a future ERPNext
adapter match a PMO record back to the legacy/source document it was imported from — is exactly the
seam ADR-0048 names for the ERPNext integration leg. Naming the real column and the real ADR keeps the
CSV contract implementable and keeps the idempotency key derivation (which also needs a stable source
field) honest about reusing the same input rather than inventing a second identity for it.

**Enforced by:** the `procurement_cases.csv` contract (record rows use `reference_number`, not
`external_ref`); FR-HIST-015 (ERPNext seam) cites ADR-0048, not OD-PROC-3; FR-IDEM-002's `import_key`
fallback chain documents `reference_number` as its preferred stable source.

## OD-SECTION-HEADER — Section-header molecule (ops-admin Discover round, 2026-07-06)

**Decision:** `/administration`'s Users/Credits/Usage/Features sections previously had inconsistent
header markup (Usage/Features had a parent-rendered bare `<h2>`; Credits rolled its own internal
`<h2>` + Grant-button row). Hoisted to one shared molecule, `SectionHeader`
(`pmo-portal/src/components/ui/SectionHeader.tsx`): an `<h2>` title + an optional trailing action
slot. Credits passes its "Grant credits" button into the action slot; Usage/Features pass none.

## OD-EAS-LABELS — External tier/domain display labels deferred to P1 (Discover finding M4, 2026-07-10)

**Noted, not built this round:** `IntegrationsView` renders the raw `externalTier`/`domain` slugs
(e.g. `reference`) verbatim — acceptable in P0 because the only populated data is the synthetic
`reference` domain from the reference adapter (ADR-0055 P0 scope). **P1 must add a display-label
mapping (title-cased human-readable names) for external tier + domain slugs at the view boundary**
before any real adapter (ClickUp/ERPNext/Odoo, ADR-0048) ships slugs like `erpnext`/`accounting` to
end users.

## OD-CUA — ClickUp adapter review fix-round (graduation notes, 2026-07-11)

Three durable rules graduated from the 4-reviewer battery on the ClickUp adapter P1 (branch
`feat/clickup-adapter-p1`). These are binding on future adapter/surface work, not one-off fixes.

### OD-CUA-PUSH-BREADTH — Pending-push state surfaces on EVERY write-origin view (FR-CUA-070)

**Decision (binding):** the per-task pending-push badge (`TaskPushBadge`, ADR-0056) MUST render on
every view whose control can ORIGINATE an externally-routed write — not only the Board. Today that is
the List status cell (a status `<select>`/pill that fires `updateStatus`) and the edit modal (whose
save fires `update`); both carry pending-push wiring in `useTaskMutations`. The Timeline view does NOT
originate a write (its `onActivateTask` opens the edit modal — already covered), so it carries no badge.

**Why:** a user who triggers a push from the List (or the edit modal) and then looks back at that row
must see the same `pushing → pushed | push-failed` feedback a Board user sees. Limiting the badge to
the Board left the most common surface (the List) without feedback — a real regression in the job
("tell me my write reached the external system"). `idle` renders nothing, so PMO-owned orgs and
non-pushing rows stay byte-for-byte (AC-CUA-061).

**Enforced by:** `TasksTab.pendingPush.listBreadth.test.tsx` (List row shows the badge when
`pendingPushByTask` carries a non-idle state; no badge when idle). The edit-modal surface + the
`update` mutation's pending-push wiring are covered by the existing `TasksTab.pendingPush.test.tsx`
shape. Every future write-origin control added to a task surface MUST thread `pendingPushByTask` +
render `TaskPushBadge`, or it regresses this rule.

### OD-CUA-VOCAB — Two-classifier vocabulary: one headline per event; network → external-unreachable

**Decision (binding):** there are exactly TWO error classifiers for task writes, selected by route:
- **PMO-owned writes** → `classifyMutationError` (Postgres/PostgREST codes: P0001/42501/23505/23503).
- **Externally-routed writes** → `classifyExternalError` (adapter codes: `external-unreachable` /
  `commit-rejected`; generic `Push failed`).

The toast and the push badge for an externally-routed write MUST classify through `classifyExternalError`
(the SAME vocabulary) so the two never disagree on one event ("one headline for one event"). And a
network failure — a `FunctionsFetchError` (DNS / connection refused; NO HTTP `Response` on
`.context`) — is classified `external-unreachable` with a GENERIC message, NEVER the raw fetch string
("name resolution failed", "Failed to send a request…").

**Why:** the raw fetch string is unreadable and alarming; surfacing it as the toast headline / badge
detail betrays that the system is leaking transport noise to the user. And a divergent toast vs badge
("Update failed" vs "external system unreachable — try again") for the SAME failed write is dishonest.
The shared vocabulary keeps one event → one human headline. The classification lives in
`dispatchClient.ts` (`classifyDispatchError`, pure + tested: known-code > network > http-no-code) and
`pendingPush.ts` (`classifyExternalError`, the friendly-copy map).

**Enforced by:** `dispatchClient.test.ts` (no-code network path → `external-unreachable` + generic msg;
raw fetch strings never surfaced; pure `classifyDispatchError` precedence) + `pendingPush.clickup.test.ts`
(shared vocabulary: structured + network `external-unreachable` render the same headline; raw strings
never headline).

### OD-CUA-AA — Tinted-status micro-text MUST use the AA-darkened label tokens (systemic)

**Decision (binding, systemic):** any status/badge TEXT that sits on a tinted fill (`bg-*-/10`-style)
at small sizes (≤ ~13px, or bold ≤ ~14px) MUST use the AA-darkened tinted-status LABEL tokens —
`hsl(var(--status-won-text))` for success, `hsl(var(--status-lost-text))` for destructive,
`hsl(var(--status-open-text))`/`--status-violet-text)` for their hues, `text-warning-foreground` for
amber, `text-muted-foreground` for grey — applied via inline `style={{ color: … }}` exactly as
`StatusPill` does (the canonical idiom). NEVER the raw `text-success` / `text-destructive` / `--success`
/ `--destructive` tokens at those sizes: those fail WCAG AA on tinted fills (e.g. the push-failed badge
was 4.17:1 — under the 4.5:1 bar for small bold text).

**Why:** the raw `--success`/`--destructive` tokens are tuned for DOT/icon saturation, not text-on-tint
legibility; their lightness fails AA once they become small text on a 10%-opacity fill of themselves.
The `--status-*-text` tokens are explicitly the AA-darkened variants (e.g. `--status-lost-text: 0 72%
44%`, `--status-won-text: 142 64% 27%`, ≥6:1 on the canvas in both themes). This is systemic because
EVERY tinted-status molecule (StatusPill, TaskPushBadge, future ones) shares the trap; the fix is "use
the same AA token idiom StatusPill established", not a one-off darken.

**Enforced by:** `StatusPill.test.tsx` (lost → `--status-lost-text`, won → `--status-won-text`, inline
style) + `TaskPushBadge.test.tsx` (push-failed → `--status-lost-text`, pushed → `--status-won-text`,
no raw `text-destructive`/`text-success`). The Layer-1 a11y/visual gate assertion was extended to cover
the badge. Any new tinted-status text MUST follow the same token or it regresses AA.

## OD-ENA — ERPNext adapter P2 final consolidated fix round (2026-07-13)

Four durable notes graduated from the final quality/spec/Discover fix round on the ERPNext adapter P2
(branch `feat/erpnext-adapter-p2`).

### OD-ENA-E2E-CLEANUP — The erpnext e2e cleanup deletes `external_domain_ownership`/`external_org_bindings`
rows for `tier='erpnext'` (ops note)

**Note (operational, not a code change):** the erpnext served-fn e2e suite's cleanup hook deletes its
own `external_domain_ownership` + `external_org_bindings` rows scoped to `external_tier = 'erpnext'`
after each run, on the SHARED local Docker DB (`docs/environments.md`'s parallel-agent hygiene). This
is correct for the suite's own fixtures, but it means a MANUAL flip fixture an engineer seeds by hand
(e.g. `setDomainOwnership`/a direct row insert for local exploratory testing) on `tier='erpnext'` gets
silently un-flipped the next time the e2e suite runs on the same DB. **Operational implication:** don't
rely on a hand-seeded erpnext flip surviving an e2e run on the shared stack — reseed it after, or use a
dedicated org id the e2e suite doesn't touch.

### OD-ENA-ITEMS-INSERT — `procurement_items` INSERT stays open on a flipped org BY DESIGN (Director ruling, 2026-07-13)

**Decision (binding):** while `procurement` is externally-owned, user-JWT `INSERT` on
`procurement_items` (the PR line-item table) is **NOT** RLS-denied, unlike the seven record tables'
native/mirrored fields (FR-ENA-170). This is intentional, not a gap: line items are **drafted PMO-side
before a PR is pushed** (the requester builds the item list authoring a Purchase Request in the PMO
UI — `item_code`/`qty`/`rate`/`schedule_date`), and only that drafted set is read at dispatch time to
build the ERP command body (FR-ENA-110's `{items:[...]}`). The **pushed** state is what the flip
protects: once a PR/RFQ/PO/etc. is dispatched, the money doctypes' own native/mirrored fields (§7) are
machine-written-only — `procurement_items` rows already used in a pushed command are not retroactively
locked, but the record tables that carry the ERP truth are. A blanket `procurement_items` INSERT deny
would break authoring entirely (no org could ever draft a new PR once flipped), so this is a deliberate
scope boundary, not an oversight.

**Why:** treating "flipped" as "every table under the `procurement` domain is machine-only" conflates
the draft-authoring surface with the ERP-truth surface. The spec's own model is: PMO owns
case-aggregate + draft state, ERP owns the seven money doctypes once submitted (FR-ENA-101).

### OD-ENA-CONTACTS-DEFERRED — Contacts inbound-adopt is NOT wired; companies-domain inbound mints companies only

**Noted, deferred:** the `companies` domain's inbound change-feed (webhook + sweep) mints/updates PMO
`companies` rows from ERPNext `Supplier`/`Customer` documents, but there is **no `contact` kind in the
feed registry** — an ERPNext `Contact` document arriving inbound is never adopted into PMO `contacts`.
This was the reason `_shared/erpnextMirrorDeps.ts` (a contacts-table-writer fork with zero production
consumers) existed and has now been removed (dead code, task FIX-4) rather than wired in. **Deferred
to a future issue:** contacts inbound-adopt needs its own doctype-registry entry + ambiguous-match
resolution (mirroring the companies pull-adopt path) — out of scope for this consolidated round.

### OD-ENA-CREDS-REDACT — M-4 RESOLVED

Credential-resolution failures now return a generic client-safe message and log only the specific configuration names server-side.

### OD-ENA-VAULT-SEAM — secret_ref resolution stays confined to credentials.ts (owner heads-up 2026-07-14)

**Binding coordination note:** the `secret_ref`/`webhook_secret_ref` backend will move from
function-secret env vars to **Vault** later (admin self-serve). All ref→secret derivation MUST stay
confined to `erpnext/credentials.ts` (`resolveErpCredentials(secretRef, getEnv)` — the getter is
injected at every call site) so the swap is a one-function change. Do not derive env names from a
ref anywhere else; the webhook's `webhook_secret_ref` lookup follows the same single-injected-getter
rule.

### OD-ENA-SHARED-BINDINGS — external_org_bindings is the shared per-org connection table (owner heads-up 2026-07-14)

`external_org_bindings` (migration 0096, `unique (org_id, external_tier)`, tier-generic columns:
site_url/secret_ref/webhook_secret_ref/version_major/config/activated_at) is the ONE per-org
external-connection table for ALL tiers. **ClickUp will adopt it** (post-#315: add a
`tier='clickup'` row; today P1 ClickUp uses env-based global creds + `external_project_bindings`
for containers only). New tiers add rows, never new tables.

---

## OD-INT — External-system admin-connect layer (LOCKED 2026-07-14)

The self-serve UI for connecting an external system (ClickUp P1, ERPNext P2/#315) to an org. The sync
engines already exist (`adapter-dispatch`/`clickup-webhook`/`clickup-sweep`; `erpnext-onboard`/`erpnext-
sweep`); this is the operator/admin **connection** layer on top. Full scope + phases + #315 alignment:
`docs/plans/2026-07-13-clickup-admin-integration-flow.md`. Backlog: the "EXTERNAL-SYSTEM ADMIN-CONNECT"
section. Depends on ADR-0055 (external adapters), ADR-0016/0019 (can()+RLS/RPC authority), ADR-0057
(`verifyCallerJwt`). Sequenced **after #315 merges**.

### OD-INT-1 — Admin self-serve
Org **Admin** connects the integration from the app (not operator-only). Platform Operator retains the
existing service-role CLI path (`clickup-onboard`/`erpnext-onboard`) as the fallback/bulk path.

### OD-INT-2 — Personal token / API-key, v1
Credential entry is a **paste-a-token** flow: ClickUp **personal API token** (from a Workspace
owner/admin — user-scoped, sees the whole workspace) · ERPNext **`apiKey:apiSecret`** (Frappe token,
from a System Manager). ClickUp **OAuth** app is a later UX upgrade, explicitly out of v1.

### OD-INT-3 — Vault-backed `secret_ref` (the enabler for self-serve)
The secret backend for BOTH tiers is **Supabase Vault**, not function secrets. Admin enters the
credential once → a role-gated server endpoint calls `vault.create_secret(value, name)` → the DB stores
only a `secret_ref` (the Vault name) on the binding row; the value is **write-only, never returned**.
Rationale: function secrets (`supabase secrets set`) can only be set by an operator via CLI/dashboard —
Vault can be written from a role-gated app endpoint, which is what makes admin self-serve possible.
Precedent: mig `0082` (automation dispatch), `0094` (ClickUp sweep). Edge fns resolve the per-org
credential from Vault via `secret_ref` at request time (locked-down security-definer reader).

### OD-INT-4 — One tier-generic layer, not per-tier forks
Shared across tiers: **`external_org_bindings`** (#315's table: `org_id, external_tier, site URL,
secret_ref, webhook_secret_ref`) + Vault `secret_ref` + one Connect endpoint + one admin UI card.
Tier-specific (thin): credential shape, the validation call, and link granularity (ClickUp → **List**
per project · ERPNext → **Company/module** per org). **Alignment work:** (a) #315 swaps its credential
resolution from `Deno.env` → a Vault reader (contained — already behind the `credentials.ts` seam);
(b) ClickUp adopts `external_org_bindings` for the org connection (today it uses
`external_domain_ownership` + `external_project_bindings` + a single global `CLICKUP_API_TOKEN`).

**Forward-note (2026-07-16, architect + adversarial review — OD-INT-4 STANDS AS WRITTEN).** An
architecture pass proposed amending the granularity to add an *optional ERPNext **Project** per PMO
project*. The ADR basis is **accurate** — `docs/adr/0055-*.md:138-140` ownership map literally reads
`| Projects (header) | PMO, reference pushed down | ERP needs Project as accounting dimension |`, so a
per-project ERP reference **is** the ADR-endorsed direction. It is **deferred, not rejected** — it is
**premature**, because the prerequisites do not exist:
1. **The read-model cannot express it.** `erp_gl_entry_mirror` carries only ERP `project` (text);
   `erp_payment_ledger_mirror` has none; neither has a PMO `project_id`. `actualsSnapshot.ts` filters
   only `org_id`/`fiscalYear` → **project-scoped ERP actuals are structurally impossible today**, so the
   link would deliver nothing it exists for.
2. **No rename reconciliation.** ERPNext `Project.name` is a *renameable* Frappe PK; storing it as
   `external_container_id` rots the binding on rename, and no reconciliation exists anywhere.
3. **Nothing shipped needs it** — procurement stamps `company` (`bodies/materialRequest.ts`), not
   project; snapshots/aging are org-scoped. Charter is "minimal for 1 client".
**Phase-2 prerequisites before revisiting:** mirror tables gain a PMO `project_id` (or a join key) ·
snapshot refresh supports project scope · an ERP Project rename/archive reconciliation design.
`external_project_bindings` is already tier-generic, so adding it later costs no migration pain.

### OD-INT-5 — Sequenced after #315 merges
Build on the **merged** `external_org_bindings` foundation, not the unmerged/conflicting `#315` branch.
The in-flight #315 implementer agent is NOT handed this layer — it finishes ERPNext P2 sync hardening
and lands #315 as-is (operator-provisioned/function-secret is fine for that scope). It receives only
two coordination notes: keep the `credentials.ts` resolver seam clean (Vault swap comes later); confirm
`external_org_bindings` is the shared per-org connection table. The Director orchestrates this layer as
its own spec → eng-planner plan → PRs afterward (security-auditor mandatory on the token path).

### OD-INT-6 — ERPNext Company is selected at the ORG level, not per project (owner-approved 2026-07-16)
**Supersedes plan tasks 3.3 + 3.5's ERPNext-in-the-project-modal.** ERPNext **Company** is a legal
entity — org-scoped by nature (OD-INT-4), and the shipped ERP code depends on it: `binding.ts`
activation resolves Company defaults from `external_org_bindings.config.company`,
`bodies/materialRequest.ts` sends `company: ctx.config.company`, and `ledgerFetch.ts` scopes every
ledger read by `company`. Therefore Company selection lives in the **org Integrations card** (the P2
connect surface), NOT the per-project card — the per-project ERPNext UI built in P3 was broken (empty
combobox, read the wrong table) *and* contradicted OD-INT-4, and was removed.
**Consequence — an explicit `connected-but-not-activated` state:** credential validated + stored, but
no Company yet ⇒ the binding is connected and **not activated**; ERP sync must not run. This is a
**runtime** gate (activation fails without Company), NOT a schema constraint — deliberately, so the
"connected, pick your Company" UX state remains representable. ⚑ Related hardening: if `config.company`
is ever absent at sweep time, `ledgerFetch` filters `['company','=',null]` and returns **zero rows
silently** — it must fail loud instead.

### OD-INT-8 — The cloud ClickUp workspace + local DB are TEST fixtures; do not spam the API (owner 2026-07-20)
Both the **cloud ClickUp workspace** (token: 1Password `clickup-api` / vault `AS` / field `credential`)
and the **local Supabase DB** are testing environments — shared, disposable-but-not-abusable.
- **Mocks are the default.** The fetch-mocked suites test behaviour; the live API is used ONLY to verify
  a *wire shape* or an end-to-end journey mocks cannot prove (the shapes are `PROVISIONAL` in-source —
  see `docs/spikes/2026-07-17-clickup-live-smoke.md`).
- **No polling / no spam.** Call ClickUp only for a verification whose result you are about to read. No
  polling loops, no warm-up calls, no repeat runs to watch output. Limit is **100 req/min per token**,
  shared with anything else on that token; `x-ratelimit-remaining` is in every response — respect it.
- **Always clean up in the same session.** Tasks, lists, and webhook registrations created for a test
  MUST be deleted afterwards; leave the workspace as found. If a run dies mid-way, the next session's
  first job is removing the orphans.
- **Never print the token.** Pipe it straight from `op-get.sh` into the consumer — never echo, never to
  a file, never in argv (visible in `ps`) or a URL. Reduce responses to key names/counts before printing
  so workspace content (task titles, emails) never reaches a transcript.
  `scripts/clickup-live-smoke.sh` is the worked example.
- **Local DB:** wrap every DB-touching command in `scripts/with-db-lock.sh` (one shared Docker Postgres;
  concurrent `db reset`/`test db`/e2e corrupt each other).

### OD-INT-7 — Project↔List linking is PROJECT-SCOPED to the owning PM (owner-approved 2026-07-16)
Applies to **ClickUp only** (ERPNext has no per-project link — OD-INT-4/OD-INT-6).
- **Org connect/disconnect** (the credential = the trust boundary): **Admin ∨ Operator** only. Unchanged.
- **Project↔List link/unlink**: **Admin ∨ platform Operator ∨ that project's `projects.project_manager_id`
  — and that PM's `profiles.status` must be `active`**. Routine project configuration belongs to the PM
  who owns the project; requiring an Admin per link makes Admin a bottleneck.
- **Project-scoped, NOT role-scoped.** "Any user with the Project Manager role" would let the PM of
  project A link project B — a cross-project hole. The server loads the project, requires
  `project.org_id = caller.org_id`, then applies the rule above. `project_manager_id` is **nullable**
  (`0001_init_schema.sql:76`) ⇒ when NULL, only Admin/Operator may link.
- ⚑ **`policy.ts` has NO project-scoped integration primitive.** `can('edit','project')` is an
  **org-wide** hint (DELIVERY roles), so the FE gate is necessarily looser than the server: a PM of a
  *different* project sees the control and is rejected **server-side** with 403. This is consistent with
  ADR-0016 (`can()` is UX-only; the server is the authority). Adding a project-scoped primitive is a
  possible later refinement, not a correctness requirement.

## OD-INT-9 — PMO task model gains description, priority, subtasks and archive (2026-07-20, owner)

**Decision.** Extend `public.tasks` with four nullable additions, in ONE migration:
`description text`, `priority` (new nullable enum `task_priority` = `Urgent|High|Normal|Low`),
`parent_task_id uuid null references tasks(id)` (a real subtask model, owner's call over
flatten-or-ignore), and `archived_at timestamptz null`.

**Why priority is a PMO enum, not ClickUp's raw 1–4.** ADR-0055 keeps PMO vendor-neutral and the
codebase already confines vendor vocabulary to `clickup/**` (FR-CUA-012); ERPNext needs the same
column. The PMO↔ClickUp priority map is a **fixed 4-value constant** in `clickup/mapping.ts`, not
per-List config — so it cannot rot the way the per-List status map did (see OD-INT-10).

**Subtask rollup rule (binding).** Only tasks with `parent_task_id is null` participate in milestone
counts, `delivery_pct`, the S-curve and Gantt bars. Subtasks render nested under their parent and do
not independently move any percentage. Without this rule a parent and its children double-count and
delivery reporting silently inflates.

**Archive is distinct from tombstone.** `archived_at` mirrors ClickUp archive (a reversible hide);
`tombstoned_at` stays for upstream deletes. This also lights up the `task.archive` permission that
`policy.ts:154-159` already declares but nothing implements.

**Applies to:** `description`/`priority`/`archived_at` sync bidirectionally; `parent_task_id` maps to
ClickUp `parent`. All four are optional in ClickUp (only `name` is required on create).

## OD-INT-10 — one shared status/member map builder; a binding must cover every PMO status (2026-07-20)

**Decision.** `external-link` and `clickup-onboard` MUST build binding config through a single shared
function. A binding whose `pmoToClickUp` does not cover **all four** PMO `task_status` values is
rejected at link time, not discovered at first push.

**Why.** The two link paths drifted: `external-link` shipped `statusMap: {}` while `toClickUpStatus`
throws on unmapped — every outbound write would have failed, and every inbound task would have landed
as `To Do`, corrupting `delivery_pct` / milestone % / S-curve. The map builder must key on ClickUp
status **`type`** (`open|custom|closed|done`), not name, and must map all four PMO statuses.
Evidence: `docs/spikes/2026-07-20-clickup-tasks-divergence.md` §2.1.

## OD-INT-11 — webhook ingress: verify → 200 → enqueue → re-GET (2026-07-20, verified live)

**Decision.** The ClickUp webhook payload is a **delta, not a task**. Ingress MUST: verify `X-Signature`
(HMAC-SHA256 over the **raw** body) → respond 200 immediately → enqueue `{event, task_id, team_id}` →
a worker re-`GET`s the task and applies it. Resolve the org/project binding from the **re-GET'd
`task.list.id`**, never from the payload (there is no `list_id` in it — the current adopt tier is
unreachable). Subscribe to `taskCreated`/`taskUpdated`/`taskDeleted` only; `taskStatusUpdated` is a
duplicate delivery of the same change.

**Why 200-first is mandatory:** ClickUp marks a webhook *Failing* if the endpoint errors **or takes
>7s**, retries 5× then **drops the event permanently**, and *Suspends* at 100 failures with **no
notification**. Verified envelope + fixtures:
`supabase/functions/_shared/testing/fixtures/clickup-webhook/`.

## OD-INT-12 — the agent's task-status action routes through adapter-dispatch (2026-07-20, owner)

**Decision.** `agent-chat`'s `update_task_status` must go through `adapter-dispatch` like every other
task write, rather than writing `tasks.status` directly under the caller's JWT.

**Why.** Under external ownership the column-pin trigger (`0093:97-139`) pins all roles to enhancement
columns, so the direct write raises a raw `42501` — the assistant would break exactly on the projects
with the most tasks. Routing keeps the capability and keeps ClickUp authoritative.
