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
