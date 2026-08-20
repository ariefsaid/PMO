# Decisions Log — owner (`OD-`) and Director (`DD-`)

> **Two prefixes, one file (2026-08-18).** `OD-` = **owner-locked**; changing one needs the owner.
> `DD-` = **Director decision** — binding on agents exactly like an OD until revised, but **the owner
> may revisit any `DD-` at any time without ceremony.** Decision rights (which questions are the
> owner's at all) live in [`docs/factory-workflow.md`](factory-workflow.md) § Decision rights.
>
> **Historical note — Director calls filed under `OD-`.** The `DD-` prefix did not exist before
> 2026-08-18, so several Director-made rulings carry `OD-` ids. They are **not renamed** (specs cite
> those ids), but they are listed here so the owner can find what was decided *for* them:
> `OD-PROC-7` · `OD-TS-4` · `OD-PR` (all "Director-ratified, mode A", 2026-06-04) ·
> `OD-W5-C2-*` · `OD-W5-C3-*` · `OD-W4-*` (all "Director-adopted", 2026-06-10) ·
> `OD-ENA-ITEMS-INSERT` (Director ruling, 2026-07-13) · `OD-CR-4` (Director default, 2026-07-22 —
> **promoted to owner-settled 2026-08-18 by OD-CR-9**) · the ADR-0033 prefix extension
> (Director-ratified, 2026-06-19). Treat every one of these as revisitable on request.

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

### OD-SAR-GATES — PMO is the flexible layer; process gates are org-config, default permissive (owner ruling 2026-07-14)

**Binding product architecture:** the PMO caters to field reality; the ERP is strict. Chain/process
gating (require-SO-before-SI, require-BAST-before-SI, require-project-on-SI, procurement chain-entry
restrictions, …) is **org-level configuration** (`process_gates`), **default OFF/permissive**, flipped
ON only when an org's accounting demands it — and flipped back when an edge case becomes the norm.
Doctypes must be representable without their gate being mandatory. First shipped seam: P3a revenue
gates (inert, default-off). Fast-follow issue: SO + BAST (Indonesian services handover — DN-doctype vs
document+milestone-acceptance needs its own ruling). **P2 retrofit (backlog): flexible procurement
chain entry** (direct-to-PO, payment-first) under the same philosophy.

### OD-SAR-PMO-IS-THE-UI — the accountant's UI is PMO; ERPNext is the headless audit/ledger engine (owner ruling 2026-07-14)

Accountants work IN PMO (authoring, corrections — hence SI cancel/amend in-app); the ERPNext bench
exists for audit and as the ledger engine. **ERP-grade financial reporting belongs on the PMO
backlog** (a reporting track over the mirrored ledger/read-models), not in the Desk. Sharpens
ADR-0055 §product-frame and [[product-vision-operational-layer]]; every future money issue assumes
no user is ever required to open the ERPNext Desk.

### OD-SAR-DRAFT-SUBMIT — revenue SI create leaves a DRAFT; submit is the SoD-gated approver step (owner ruling 2026-07-15)

The signed-off SoD (approver≠author on SI submit, OD-SAR §14) is only real if create and submit are
SEPARATE actors. The initial build did **atomic create+submit** (spike "two-step insert→submit" →
docstatus 1 on create), which BYPASSED SoD at create (author submits their own invoice). **Binding
correction:** a revenue **Sales Invoice** create leaves an ERP **draft (docstatus 0)**; **submit** is
the separate, SoD-gated transition performed by a DIFFERENT approver (PM drafts → Finance approves +
submits). Procurement PI/PE stay atomic create+submit (no SoD there). Mirror status: 'Draft' after
create, 'Unpaid' after the approver submit. Surfaced by the post-Luna e2e re-run (sod-self-approval
403 on single-user create+submit). Implemented via a registry `submitOnCreate:false` for sales-invoice.
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

---

## OD-INT-13 — status map round 3: pmo-only outcomes with Blocked defaulting to pmo-only (2026-07-21, owner)

**Decision.** The strict pairwise-distinctness rule for PMO→ClickUp status mapping was reverted as
unshippable. ClickUp ships **three** statuses by default (`to do` / `in progress` / `complete`) — the
real probed workspace has exactly that — so the rule rejected it and would have forced customers to
restructure their ClickUp Space before linking, inverting ADR-0055 (the external system owns its
domain). Distinctness was not even sufficient: `Blocked → complete` passed while being semantically
wrong.

Every PMO status must still resolve to an explicit recorded outcome, but **"no ClickUp counterpart"**
is now a valid one:

```
{ kind: 'clickup', status } | { kind: 'pmo-only' }
```

- `pmo-only` statuses are never pushed outbound (the task's other fields still sync) and are never
  overwritten by an inbound sync.
- **`Blocked` defaults to `pmo-only`** when no distinct ClickUp status is available — it is a PMO
  management signal (escalation/dependency) with no equivalent in ClickUp's default vocabulary;
  collapsing it onto `In Progress` destroyed the state in both directions.
- A collapse is still permitted but only when **explicitly recorded**, never produced silently by
  auto-derivation. Where a collapse is recorded, inbound must not downgrade the more specific PMO
  status.
- Storage is `pmoOnlyStatuses?: string[]` on the existing binding `config` jsonb — optional, so
  bindings persisted before this change stay valid byte-for-byte. **No migration.**
- Validation keeps its teeth: a PMO status with no recorded resolution is still rejected at link time.
- Implemented on `fix/status-map-round3`. A named test asserts the real 3-status List links
  successfully with `Blocked` resolving `pmo-only`.

## OD-INT-14 — ClickUp sync targets SINGLE-ORG; per-org webhook secret is DEFERRED (2026-07-21, owner goal)

**Decision.** The ClickUp integration is completed for the app's **current single-tenant direction**
(CLAUDE.md: "single-tenant with a forward-compatible `org_id` seam"; ADR-0047: the multi-org RLS proof
is deferred "until two unrelated clients deliberately" exist).

**Consequences:**
- **Per-org webhook secret is NOT built.** `external_org_bindings.webhook_secret_ref` stays an unused
  column; `clickup-webhook` verifies with the global `CLICKUP_WEBHOOK_SECRET`. This is *correct* for
  single-org — a global secret is a real control when there is one org. It only becomes a gap at the
  multi-org boundary, which ADR-0047 defers. Building an org-in-URL callback + per-org secret now would
  be speculative work against a deferred direction. When the second client lands, this is the first
  thing the multi-org RLS-seam proof must close (recorded here so it is not forgotten).
- **The org-resolution paths added for the webhook worker (`team_id` → binding) already work per-org**,
  so nothing about single-org bakes in a rewrite — the seam stays forward-compatible.

**Remaining for this decision's scope:** the binding-map UI is read-only and does not yet expose or
allow override of per-status resolution (OD-INT-13). The integration-enablement spec also records the
remaining test-layer corrections for `AC-IEM-004` and `AC-IEM-007`, while per-org webhook secrets remain
deferred under this single-org decision.

---

## OD-CR-1..6 — RIS-parity + CRM-v2 candidate program (owner grill 2026-07-22)

Candidate program, **not scheduled**. Analysis: [`docs/reviews/2026-07-22-competitive-refresh-ris-cicle.md`](reviews/2026-07-22-competitive-refresh-ris-cicle.md).
Full decision text (batches A–D + the resulting sequence) lives in the **CANDIDATE PROGRAM** section of
[`docs/backlog.md`](backlog.md) — indexed here so `OD-CR-*` resolves by id:

- **OD-CR-1** — order = S-effort quick wins (D3 weighted forecast · D4 win/loss · A2 rejection comments ·
  A3 bulk procurement approve) → Batch D CRM v2 as the main track → A/B remainder + C.
- **OD-CR-2** — D1 M365 capture v1 = **manual log-to-CRM** (user picks an email/meeting to log against a
  contact/deal). No background auto-sync in v1; model it so auto-sync ships later as a per-org opt-in flag.
- **OD-CR-3** — localization = **full id-ID in this program** (i18n framework + Bahasa + IDR first-class).
  Sequencing: the i18n seam + locale/currency formatting land **early**, translation content lands last.
- **OD-CR-4** — locale model = **per-org default language + per-user override** (Director default,
  revisable at the spec grill).
- **OD-CR-5** — currency = **single currency per org in v1, architected for multi-currency** (owner-revised
  2026-07-22): `currency` column on every money table (trigger-defaulted like `org_id`), formatting keyed
  off the record's currency never a global constant, rollups group-or-convert by currency. **The ERPNext
  adapter carries the same seam in v1:** every money doc written through (SI/PE/PO/PI/quotes) sets
  `currency` explicitly from the PMO record — never the ERPNext company default — and read-backs preserve
  the source doc's currency. v1 still pins org currency == ERPNext company currency at connect.
- **OD-CR-6** — parked set confirmed parked: in-house chat/video (Cicle turf, stays Big-track), field
  photos/forms (KANNA turf), offline/native mobile.

---

## OD-FORM-A11Y — Entity-form focus + rejected-save evidence (graduated from the 2026-07-28 Discover pass)

The rendered Discover pass (ADR-0030 step 6) over `EntityFormModal` — the shared primitive behind every
entity form — found two **WCAG Level A** defects and one product-copy defect. All three are pre-existing;
they shipped because no rendered pass had ever been run over these forms. Recorded here because there is
no `crud-components` spec in `docs/specs/` to own the new AC ids (the design doc is
`docs/design/crud-components.md`, which is not an AC register).

### OD-FORM-A11Y-1 — blur-surfaced errors must NEVER drive focus; only submit-surfaced ones do
`useEntityForm` surfaces a field error on **blur**. `EntityFormModal` moved focus to the first invalid
field whenever an error summary was present. The two composed into a keyboard trap (WCAG 2.1.2): Tab →
blur → error surfaces → summary appears → focus yanked back to the field you just left. On Contacts it was
**unescapable** — the next required field (`company_id`) trapped identically, so a keyboard-only user could
never reach Cancel or Save. **The intent (focus the first invalid field on SUBMIT) is correct and is
retained**; the rule is that only a submit-surfaced summary may move focus. Implemented as a submit
generation counter inside the modal (`submitSeq`), so no consumer has to opt in and no future form can
forget to.
Owning tests: `src/components/ui/__tests__/EntityFormModal.focus.test.tsx` (`AC-A11Y-FORM-001`) +
`e2e/AC-A11Y-FORM-002-form-keyboard-path.spec.ts` (`AC-A11Y-FORM-002`, the Contacts pair).

### OD-FORM-A11Y-2 — the error summary is a POST-SUBMIT verdict
Corollary, decided at the rendered check: "Fix 2 fields before saving" appeared on the first Tab-out,
before any save attempt, restating the same messages already shown inline on the fields. A summary is a
"you cannot save yet" verdict; before a save is attempted there is no verdict. The summary now renders only
after a submit attempt. **Inline field errors still appear on blur** — the pre-submit feedback is unchanged
and stays adjacent to the field it is about.

### OD-FORM-A11Y-3 — a mutation failure inside a dialog gets a PERSISTENT in-dialog error region
On a rejected save the only feedback was a toast ~700px away that self-dismissed after ~4s, after which the
modal was indistinguishable from a pristine form with data in it — a user who glanced away could not tell
whether the write landed. Worse, `document.activeElement` was left on `BODY` and Tab then walked *behind*
the dialog. Now: a persistent `role="alert"` region inside the dialog (headline + human detail + "Nothing
was saved — your entries are still here"), focus returned to that region (not to the submit button — that
risks an accidental re-submit on the next Enter), and the modal clears it when the user submits again.
**The toast is kept**: it is the app-wide convention for mutation failures on non-modal surfaces
(archive/delete), and the dialog region is additive — the persistent authority, not a replacement. The
duplication while both are on screen is accepted for now; unifying it is an app-wide call for the
design-architect, not a two-form change.
Owning tests: `EntityFormModal.focus.test.tsx` (`AC-ERR-001`) +
`e2e/AC-A11Y-MODAL-001-focus-containment.spec.ts` (`AC-A11Y-MODAL-001`, driven with an intercepted 403).

### OD-FORM-A11Y-4 — the background goes `inert` while a modal dialog is open (chosen over Tab re-entry)
`aria-modal="true"` is **advisory**: it does not remove the background from the tab order, and the modal's
own trap only wraps at the first/last focusable — so focus that starts *outside* the dialog escapes
entirely. Two fixes were available; `inert` on the app-shell root (`[data-app-shell="root"]`, set by
`AppShell`) was chosen over a Tab re-entry handler because it is the platform-native modal semantic and
fixes the whole class in one attribute — tab order, the a11y tree **and** pointer events — whereas a
re-entry handler only patches the keyboard symptom and leaves the background readable by a screen reader
and clickable by mouse. It is refcounted (stacked dialogs) and scoped to the shell root, so the toast host
and other body-level portals stay announceable. `aria-hidden` is deliberately NOT also applied: `inert`
already removes the subtree from the a11y tree, and doubling up is a known AT-confusion source.

### OD-FORM-A11Y-5 — raw Postgres text is not product copy (`AC-ERR-002`)
`classifyMutationError`'s `detail` was the verbatim backend message, so users read
`new row violates row-level security policy for table "companies"` — internal table names and RLS
mechanics. The families **Postgres writes itself** (42501 / 23505 / 23503) are now mapped to human
sentences. The families **we** write (P0001 `RAISE EXCEPTION`, `REQUEST_TIMEOUT`, `AppError`, `overrides`)
pass through unchanged — they are already human copy and replacing them would destroy the only specific
information the user has. The verbatim text is always returned as `rawDetail` and logged to the console in
DEV: diagnostics, never UI. Owning test: `src/lib/classifyMutationError.test.ts` (`AC-ERR-002`).

| AC id | Owning layer | File |
|---|---|---|
| `AC-A11Y-FORM-001` | Unit (Vitest/RTL) | `src/components/ui/__tests__/EntityFormModal.focus.test.tsx` |
| `AC-A11Y-FORM-002` | E2E (Playwright) | `e2e/AC-A11Y-FORM-002-form-keyboard-path.spec.ts` |
| `AC-ERR-001` | Unit (Vitest/RTL) | `src/components/ui/__tests__/EntityFormModal.focus.test.tsx` |
| `AC-A11Y-MODAL-001` | E2E (Playwright) | `e2e/AC-A11Y-MODAL-001-focus-containment.spec.ts` |
| `AC-ERR-002` | Unit (Vitest) | `src/lib/classifyMutationError.test.ts` |
## OD-CON-3 — the `/privacy` consent surface is THREE-STATE, not boolean (Discover-pass fix, 2026-07-28)

**Decision.** `hasAnalyticsOptedOut()`/the opt-out checkbox is not enough to answer "is this browser's
usage actually being sent" — a rendered Discover pass found the control could show **unchecked**
("sending") on a browser with Do Not Track set, directly beneath the sentence "We honour your
browser's Do Not Track setting," while the SDK-init guard (`doInit`, `client.ts`) had in fact never
called `posthog.init` at all. The checkbox was answering a different, narrower question than the one
next to it.

**The surface now resolves one of four states** (`getConsentState`, `client.ts`, exported via
`src/lib/analytics/index.ts`), in the SAME priority order the SDK-init guard itself checks, so the UI
can never show a state the guard disagrees with:
1. `disabled` — this deployment has no valid PostHog key / analytics off entirely. Nothing sends
   regardless of DNT or the stored preference.
2. `dnt` — the browser's Do Not Track signal is on. This OVERRIDES a not-yet-opted-out stored
   preference — nothing the user does in this browser turns analytics back on while DNT is set.
3. `opted-out` — the user explicitly opted out (and neither of the above already suppressed it).
4. `active` — analytics is genuinely running: enabled, no DNT, not opted out.

`disabled` and `dnt` render the checkbox checked (accurately reflecting "not sending") but
non-interactive (`aria-disabled`, `tabIndex=-1`) with copy explaining WHY — toggling in either state
would be a no-op against what's actually happening, and pretending otherwise would repeat the same
false-affordance class of bug. Only `opted-out`/`active` are interactive.

**Consequences:** any future consent-adjacent UI (a settings page, an admin view of a user's
tracking status, etc.) must call `getConsentState`, not `hasAnalyticsOptedOut()` alone, or it will
reintroduce the same "the box says one thing, the SDK does another" defect.

**Also fixed in the same pass (Discover, IMPORTANT-4/5/7):** the visible label sentence is now the
control's accessible name (`Checkbox`'s new `labelledBy` prop) and its click target — see the
Checkbox `labelledBy` note in `DESIGN.md` §Inputs/Fields; Inter is now self-hosted
(`public/fonts/`, `index.css` `@font-face`) so `/privacy` makes zero requests to Google Fonts,
closing the last uncontrolled third-party contact on the consent page itself (`AC-CON-012`); and
dark `--input` was raised 30%→42% L to clear WCAG 1.4.11's 3:1 non-text floor as a standalone
control boundary (`AC-A11Y-CHECKBOX-001`) — see `DESIGN.md`'s Accessibility posture section.

## OD-WO-1..3 · OD-LS-1 · OD-CR-13 — the commitment/work-order model and the RIS day-1 cut (owner grill, 2026-08-19)

Resolved the owner frontier of the route map (#459) and the RIS delivery map (#450): the sub-projects
ticket (#470), the launch-scope ticket (#453), and a narrowing of the reseller task (#464).

**[OD-WO-1] A project IS the client's commitment; contract is 1:1 with project; there is NO separate
Contract record.** The project row already carries `contract_value`, `customer_contract_ref` and
`contract_date` — enrich it rather than building a second entity that shadows it. This supersedes the
open half of #471 ("is a contract 1:1 with a project, or does one contract carry several projects?"):
it is 1:1, without exception in this business. The SoD-gated setter on `contract_value` stays where it
is; no data migration is required, which is the point.

**[OD-WO-2] A Work Order is a REVENUE-side scope grant — the client's PO for a scoped activity within
the committed project value.** It is not procurement. The commitment is a ceiling and work orders draw
down against it; **maximising that drawdown is a core part of the PM's job**, so
`sum(work_orders) / project.contract_value` is a first-class number the app must show, not a report
someone assembles. Consequences: the existing procurement/cost surface is untouched; billing hangs off
the work order, not off the project directly; the "drawdown and utilisation" question in #471 resolves
to work-order totals rather than to an ERP read-back.

**[OD-WO-3] Sub-projects / multi-package project structure is PARKED, not killed — revisit trigger is
RIS being live.** Flat projects plus the commitment/work-order model above express what a package needs
without a hierarchy, and a project tree would cost us in every query, RLS policy and rollup permanently.
Recorded in the route map's *Not yet specified* with the trigger, so it stops resurfacing unresolved as
it has since June.

**[OD-LS-1] RIS day-1 cut = the locked sequence and nothing added silently.** The quick wins
(D3 weighted forecast · D4 win/loss · A2 rejection comments · A3 bulk procurement approve) run alongside
but are **not go-live gates** — they ship if they land before the Bahasa pass and go-live does not wait.
**No committed go-live date exists**; go-live is gated on the sequence completing, per the owner's
standing acceptance of a later date for a better product. Beyond meetings and Indonesian, the client
named nothing else as day-one.

**[OD-CR-13] The sequence is amended to carry Work Order before go-live**, positioned after the meeting
module:

> i18n + currency seam (#468) → first-class tasks (#462) → meeting module (#463) → **work orders (#471)**
> → Bahasa translation pass → RIS go-live

Rationale: the PM manages by the drawdown number, so shipping without work orders means RIS tracks their
core metric in Excel beside the app. Landing it before the translation pass also means it is translated
once rather than twice. This is the largest slip in the sequence to date and was taken as an explicit
owner call.

**Reseller arm (#464) narrowed, not resolved.** The partner conversation is scheduled without a date and
nothing waits on it. Of everything that ticket asks, **only "what do they need in order to demo" can
create product scope** (a self-driven sandbox org, Indonesian sample data); commission shape, who
invoices, collateral and what would make them decline are commercial and gate no build. Support already
sits with us. Pricing (#466) stays blocked on it.

## OD-SEED-1..3 · OD-ERP-1..2 — RIS seeding, and ERPNext as an immediate follow (owner grill, 2026-08-19)

Second half of the same grill. Resolved the RIS data ticket (#455) and surfaced an unclaimed delivery
dependency plus a gap in the integration architecture.

**[OD-SEED-1] Source is spreadsheets only.** Everything RIS runs on today is Excel. The earlier
ERPNext-based portal never went live and is not treated as an authoritative source.

**[OD-SEED-2] Path is the shipped import wizard (ADR-0027), self-service — not one-time scripts.** It is
generic over a per-entity `ImportDescriptor`: xlsx in, columns auto-mapped, every row validated
client-side with zero writes, one explicit confirm, rows created through the entity's real create
repository so RLS stamps `org_id` and the role gate holds. Companies, Contacts, Projects and Procurement
already ship live Import buttons; **budgets are the one day-1 dataset with no descriptor** (#473). Scripts
only where an entity has no create path. **One named owner at RIS** prepares every sheet — split
ownership across departments is how a migration stalls.

**[OD-SEED-3] Scope is from January 2025, and money history lands in ERPNext, not PMO.** RIS has been
active only since 2025 at low transaction volume, so January 2025 captures everything since they
digitized. Invoices, payments and purchases go into **ERPNext** (the system of record) via its **native
Data Import**, never through our adapter and never into PMO. PMO surfaces them through the adapter
read-models that already ship (AR aging, actuals). This reconciles the owner's full-history requirement
with the rule that nothing writes governed money records around PMO's SoD and outbox path: the history is
complete, and no record bypasses anything. All transaction types, not a subset — at this volume,
selecting which kinds to bring costs more deliberation than bringing everything.

**[OD-ERP-1] ERPNext is NOT a go-live gate. RIS goes live on PMO standalone; ERPNext follows
immediately, with a two-way historical sync.** ADR-0055 already provides that PMO runs fully standalone
with every domain PMO-owned, so this is a supported topology rather than a compromise. The day-1 sequence
was already carrying i18n, tasks, meetings, work orders and a translation pass; adding a second system's
provisioning and a historical load to it would put the go-live out of reach.

**[OD-ERP-2] We self-host ERPNext for RIS, alongside their PMO deployment.** Not the distribution partner
(despite ERPNext hosting being their business), not RIS. Today no hosted ERPNext exists anywhere — only
the local Docker dev bed (`docs/environments.md` §ERPNext v15 dev bed). Provisioning, company setup,
credentials and the historical load are charted in #474.

**⚑ Consequence — an architecture gap, not just plumbing (#475).** Between go-live and ERPNext landing,
PMO is the only system and writes real projects, budgets, invoices and payments. At connect, the domains
ERPNext natively owns flip from PMO-owned to externally-owned — but the PMO rows already there are the
*only* copy, so they cannot simply become a read-model. **ADR-0055 has no account of a client crossing
between standalone and connected while live**, which is precisely what RIS will do and what any standalone
client adopting an ERP later would do. The part that binds *before* go-live: if PMO records must
eventually push into ERPNext, they must already carry whatever ERPNext will require — customer
references, tax fields, account codes, naming series, currency. Discovering a missing required field
after months of live client data is expensive and possibly unrecoverable. **The transition is designed
before go-live and built after.**

## DD-I18N-1..6 — the locale and formatting seam, fully specified (Director, 2026-08-19)

Resolves the wayfinder ticket [Locale and formatting seam](https://github.com/ariefsaid/PMO/issues/468),
first in milestone 1's build sequence. These are **`DD-`**: library choice, schema shape, migration order
and test strategy are Director calls inside the owner-settled frame (`OD-CR-3`/`OD-CR-4`/`OD-CR-5` and the
2026-08-18 ruling that Bahasa is a market precondition). Revisable by the owner at any time.

Every ruling below is grounded in a count taken from the tree — and **two of the counts changed the
answer**, which is the reason to write them down: `parseMoneyInput` has **6 call sites in 5 files**, while
**~45 sites in ~28 files** format numbers or dates with a hardcoded locale outside `src/lib/format.ts`,
and **48 unit test files plus 11 e2e specs** assert `$`-prefixed en-US output today. The display side is
the big job, not the parser.

**[DD-I18N-1] react-i18next, for message strings ONLY. `Intl` keeps money, dates and numbers.**
No `i18next-icu`, no formatting plugins — `src/lib/format.ts` stays the single formatting source and **the
money path acquires no plugin dependency**. Pluralization via `Intl.PluralRules`, and it barely matters:
Bahasa has no grammatical plural, so the two English forms are the whole requirement.
*Rejected `Intl` + a hand-rolled catalogue* (~40 lines, and the right call at 100 strings): at ~800–1200
strings across 197 `.tsx` files handed to an outside translator, key extraction, a missing-key report and a
fallback policy are the actual work, and `i18next-parser` supplies them as a CI gate. *Rejected Lingui*
despite a smaller runtime and source-text-as-key macros — it needs a babel/swc macro inside the Vite build,
a version-coupling risk against Vite 8 / React 19 that buys nothing a convention cannot. **The bundle
argument does not survive the dependency list:** this PWA already ships recharts and posthog eagerly and
lazy-loads exceljs, so a ~15kB gz runtime is noise. Bundle was the wrong axis; tooling was the right one.

**[DD-I18N-2] Preferences are columns, and NULL means inherit.** `organizations`:
`default_locale text not null default 'en'` · `default_number_locale text` (NULL = derive from language) ·
`default_timezone text not null default 'Asia/Jakarta'`. `profiles`: `locale` · `number_locale` ·
`timezone`, **all nullable**. A preferences table buys a join, an RLS policy and a row-exists branch for
three fixed 1:1 values. The nullability answers "reset to org default" vs "happens to match it": reset
writes NULL, an explicit choice writes the value — so a user who picks English while the org is English
**stays** English when the org flips to `id`, which is the entire point of an override and which a
copy-the-default-down-at-insert design silently breaks. **Binding on the build:** resolution lives in one
`resolveLocale(profile, org)` helper, never as scattered `?? org.x` at call sites.

**[DD-I18N-3] The masked money input replaces every money field in ONE pass**, and `parseMoneyInput`
becomes locale-aware in the same commit. Six call sites (`ProjectFormModal`, `BudgetProjection`,
`ProjectBudget`, `VendorQuotesTab`, `LineItemsSection`) — the "large diff" premise was wrong, so the trade
never arises. **Guard-rail:** a masked field makes it tempting to let the component hold the number and
drop the parse. Do not. `parseMoneyInput` stays the single parse behind both validation and persistence
(the Wave 3 invariant documented in the helper); the component owns display grouping, the parse stays the
boundary. `pages/project-detail/ProjectDetailHeader.tsx:67` already hand-rolls grouping via
`toLocaleString('en-US')` — extract that, don't rewrite it.

**[DD-I18N-4] Exports need no change, and that is the ruling.** `src/lib/export/toWorkbookBuffer.ts`
already writes **typed cells** — real numbers with `numFmt '#,##0.##'`, real dates with `'yyyy-mm-dd'`.
Excel format codes are locale-independent in the file and rendered in the **reader's** locale, so one
identical file shows `1.234.567` to an Indonesian recipient and `1,234,567` to an American. No punctuation
is stored, so there is no punctuation decision to get wrong. **CSV is neutral always** (`.` decimal, no
grouping, ISO dates) — a locale-formatted CSV is exactly the thousandfold corruption this work exists to
prevent, since Indonesian `1.234` parsed as en-US is `1.234` with no error raised. API payloads, logs and
filenames stay ISO 8601 and raw numbers; screen and print are the only locale-formatted surfaces.
**Standing prohibition:** no export value passes through `formatCurrency`, `formatDate` or `t()`.

**[DD-I18N-5] Catalogues are JSON in the repo; a missing key renders English and fails CI.**
Feature-namespaced keys at `public/locales/{en,id}/<ns>.json`, generated by `i18next-parser`. **No TMS** —
Crowdin/Lokalise for two languages is a subscription and an integration in place of editing a JSON file;
revisit at language three. A missing key renders **the English source string** — never the raw key, never
a visible marker, because a client must not be shown `project.header.title`. And a missing key **fails
CI** via the parser's completeness check. Those two only work as a pair: the forgiving runtime is
affordable *because* the gate makes gaps unshippable. Who translates is resourcing, not product, and does
not gate the seam — it ships with `en` complete and `id` partial.

**[DD-I18N-6] The proof.** (1) Round-trip per locale over a value table, including the named live risk —
`'1.234'` is **1234** under `id-ID` and **1.234** under `en-US`: one string, two correct answers, a factor
of a thousand apart. (2) A **mutation check** on the money path (mandatory): break the separator handling
and the money tests must go red. (3) Catalogue completeness as a CI gate — missing *and* orphaned keys.
(4) One curated Playwright journey: switch language, assert money and a date in Indonesian convention.
(5) An export guard asserting a *number* reaches `cell.value`.
**⚑ The largest risk in the build:** the 48 unit files and 11 e2e specs asserting en-US output must each
pin an **explicit** locale, not inherit the runner's or the browser's. Left implicit they either go red for
the wrong reason or — worse — stay green while proving nothing, because the runner happens to default to
`en-US` here and in CI. That is a suite certifying a locale nobody chose. Not optional cleanup.

**Graduated build work:** the ~45 hardcoded-locale display sites are a separate, mechanical issue
([#477](https://github.com/ariefsaid/PMO/issues/477)) — folded into the seam's diff they make a change
that touches the money parser unreviewable. Shape 3 of that sweep (bare `toLocaleDateString()`) is already
a latent bug independent of i18n: two users in one org see different date formats today.

## DD-XING-1..6 — the standalone → connected crossing is Posture B, not a flip-and-backfill (Director, 2026-08-19)

Resolves the wayfinder ticket [Standalone → connected](https://github.com/ariefsaid/PMO/issues/475).
RIS goes live on PMO standalone with ERPNext as an immediate follow (`OD-ERP-1`/`OD-ERP-2`), so PMO is
the only system for a period, writing real projects, budgets, invoices and payments. **`DD-`** —
revisable by the owner at any time.

**Two premise corrections first.** ADR-0055 is *not* unaware of the crossing: its Consequences say
*"Flipping a domain to externally-owned for an existing client requires a backfill/promote runbook
(push existing Supabase rows into the external system, then flip ownership)"* and call the flip *"a
per-domain, reversible flip."* The gap is **named but undesigned** — and the named answer is *the more
expensive of the two now available*, because it was written before ADR-0059 existed, when Posture A was
the only posture. ADR-0059 §7 also already amended ADR-0055 §5's ownership map once (adding a posture
column), which is why the crossing rule belongs in that same table.

**[DD-XING-1] For a client crossing while live, the process domains do not flip — they take ADR-0059
Posture B (PMO-SoT + external side-mirror).** ADR-0059 §2's rule sorts them unchanged: Posture B iff PMO
owns a process whose outcome the external system must record. Procurement chain, sales invoices,
payments, timesheets and budgets are **B** (PMO ran the SoD, approvals and outbox). Party master
(Companies/Contacts) is **A with adopt** — ADR-0059 §5 explicitly exempts reference/master data, and the
party-adopt path ships. Accounting/GL is **A natively**; PMO never held it, so nothing crosses.
Three properties make this right rather than merely cheap: (a) Posture B leaves PMO tables *"unflipped,
user-writable, untouched"*, so the opening problem — records that cannot become a read-model because
they are the only copy — **stops existing** instead of being worked around; (b) invariant 7 makes the
crossing reversible by `drop table <side_mirror>` with zero PMO data loss, so a disconnecting client
keeps working; (c) **no new ownership state machine is needed** — `external_domain_ownership` (`0087`)
is stateless (presence = owned, no "crossing in progress"), and a Posture-B domain gets no row at all
(`0137`: *"POSTURE B — PMO IS SoT. There is deliberately NO RLS FLIP here."*). Under Posture A that
stateless switch would have needed an intermediate state to hold a half-finished backfill.
⚑ **Reversibility is a Posture-B property only.** A Posture-A reversal *"leaves PMO holding stale
ex-read-model rows"*, so ADR-0055's unqualified "reversible" overstates Posture A and gets corrected.

**[DD-XING-2] The epoch boundary — one date reconciles "never adopt" with showing pre-go-live history.**
Posture B invariant 5 forbids adopting an inbound external document with no `external_refs` mapping
(adoption *"would mint a PMO record that never passed PMO's process"*), yet RIS's January-2025 history
loads natively into ERPNext (`OD-SEED-3`) and must be visible in PMO. A domain therefore holds **two
record classes**, split by whether PMO's process ever ran: **before the org's PMO go-live**, history is a
Posture-A **read-only read-model** — surfaced through the shipped snapshot read-models, never adopted,
never editable in PMO; **from go-live onward**, records are PMO-SoT, Posture B, side-mirrored. Invariant
5 stands unweakened: nothing pre-epoch is *adopted*, it is *read*. One nullable
`organizations.pmo_epoch_at` carries it — the only genuinely new concept the crossing needs.

**[DD-XING-3] The catch-up is the ordinary Posture-B push run over records with no side-mirror row. No
backfill machinery, no second implementation of the money path.** It is safely re-runnable **by
construction**: an ADR-0059 §4 key is *derived, not minted* (`'<prefix>:' || <pmo_record_id> || ':' ||
<state_stamp>`), so a re-run derives the same key, the outbox single-use constraint (`0134`) rejects the
duplicate, and no invoice is written twice. `external_refs` needs nothing new —
`unique (org_id, domain, pmo_record_id)` already carries the linkage, and `0093` added the
reverse-direction constraint for adopt-mode dedupe.
⚑ **CORRECTION 2026-08-20 — the headline example below is STALE and was already fixed.**
`budget_versions.activated_at` **exists**: `0139_budget_version_activated_at.sql:55` adds it and
`:98` sets it on activation, owner-ratified 2026-07-20. So OQ-BUD-2's specific instance is closed;
what remains is the *general* audit of every Posture-B kind's stamp, which still stands. Both #479
and this record asserted the column was missing — found by an investigation agent asked to falsify
premises rather than implement them. The lesson is the same one that keeps recurring: **a claim about
the tree, written once, does not stay true.**

**⛔ Prerequisite, not optional: audit every Posture-B kind's state stamp before any crossing**
([#479](https://github.com/ariefsaid/PMO/issues/479)). `0137` documents a live failure of exactly this
(OQ-BUD-2): `budget_versions` has no `activated_at`, so re-activating a rolled-back version derives a key
**identical to the original push** ⇒ 23505 ⇒ *silently suppressed* ⇒ ERP enforces the wrong version. A
weak stamp inverts the guarantee — instead of preventing a duplicate it **suppresses a needed write with
no error anywhere** — and a catch-up over months of accumulated records is the workload that turns one
weak stamp into plural silent data loss.

**[DD-XING-4] What a record must carry is far less than feared — except two things, and both are missing
today.** Most of the ERPNext requirement list is **org-level config set at connect, not per-record
data**: account codes are a mapping table (`budget_category_account_map` already ships as an org-scoped
Admin-only bijection), naming series and tax templates are connect-time settings, company is a constant.
None needs to exist at go-live. Two are genuinely per-record and absent:
(1) **currency — ruled but not built.** `OD-CR-5` requires `currency` on every money table; the only
`currency` columns in the schema are on the two ERP snapshot read-models (`0101`, `0150`). It rides with
the i18n/currency seam (`DD-I18N-*`) — but a four-week-old ruling is still unimplemented, so the seam's
plan must be checked to actually land it.
(2) **⛔ tax — absent entirely, and this is the go-live blocker.** No tax column exists anywhere.
`sales_invoices` (`0123`) carries `amount numeric(14,2)` — no currency, no rate, no tax amount, no line
items — and its insert policy (`not domain_externally_owned(org,'revenue')`) means **a standalone org
authors invoices natively into it**, which is what RIS does from go-live until ERPNext lands. An
Indonesian invoice carries PPN and an ERPNext Sales Invoice requires a tax treatment; a single
undifferentiated `amount` **cannot be reconstructed** into one, because whether it is tax-inclusive or
tax-exclusive is recorded nowhere and no later inference recovers it. Cheap now, unrecoverable after the
first real invoice — the one item on the crossing with a deadline rather than an ordering
([#478](https://github.com/ariefsaid/PMO/issues/478)).

**[DD-XING-5] Prove the crossing against the ERPNext dev bed before go-live**
([#481](https://github.com/ariefsaid/PMO/issues/481)), driven from seed data, over a deliberate *gap*
(seed, skip the push, then catch up — a dry-run against already-pushed records proves nothing).
Assertions: every seeded record pushes to a valid ERPNext document; a re-run writes nothing; a pre-epoch
ERPNext document mints no PMO process record; `drop table` on the side mirror loses no PMO data.
⚑ **Director-dispatched, never factory** — a backfill that writes invoices is money-shaped.

**[DD-XING-6] An addendum to ADR-0055 §5, no new ADR**
([#480](https://github.com/ariefsaid/PMO/issues/480)). ADR-0059 holds the mechanism and ADR-0055 §5's map
is where a reader asks "what happens to domain X"; a third ADR restating both is ceremony. The addendum
adds the crossing column, the epoch rule, the catch-up rule with its state-stamp precondition, and the
reversibility correction.

## DD-FMT-1 — negative money renders `-$1,234.50`, not `$-1,234.50` (Director, 2026-08-19)

Surfaced by the #477 review (`docs/reviews/2026-08-19-477-locale-drift-sweep.md`). The swept money
formatters disagreed with each other: `formatCurrencyCents`/`formatCurrencyFine` used `Intl`
`style: 'currency'` and rendered `-$1,234.50`, while `formatCurrencyAuto` welded a `$` onto a plain
number and rendered `$-1,234.5`. `RevenueByProject` renders **both on one screen** — KPI tiles and
table cells — so a negative open AR (reachable on an overpayment or a credit note) showed the minus
in two different places.

**Ruling: all money uses `style: 'currency'`; the sign goes before the symbol.** The old welded form
put the sign inside the symbol, which is non-standard, and consistency between sibling formatters
matters more than preserving it. `formatCurrencyAuto` keeps `min 0 / max 3` fraction digits so every
**positive** stays byte-identical to the welded output — verified across the range — and only
negatives change.

⚑ The lesson generalises past this fix: **each formatter was correct read on its own, and the full
suite was green with the inconsistency in it.** It was only visible reading the siblings *against each
other*. When a change introduces a family of near-identical helpers, review the family, not the
members.

## DD-ORG-1..3 · DD-DEPLOY-1 · DD-RPT-1 — multi-org operations batch (Director, 2026-08-19)

Resolves five wayfinder tickets on the multi-org map (#439): #440, #441, #444, #460, #465. All `DD-`
— revisitable by the owner at any time.

**[DD-ORG-1] Org creation is a guarded security-definer RPC, Operator-only, invoked by script — no
UI** (#440 → build #484). The tenancy ruling decides it: unrelated paying clients get their own
Supabase project, so only RIS + Gordi + Demo share a deployment and org creation happens **~3 times
in a deployment's life** — less often than a schema migration. A UI for that is a surface to build,
secure, test and maintain for nothing. Revisit only if shared multi-tenancy arrives (gated on the
isolation proof, #461). The RPC mirrors the shipped `operator_set_domain_ownership`
(`0087`) — do not invent a new authz shape. It must create the org **and** its companions atomically:
the first Admin membership (an org nobody can administer is not created), the locale defaults
(`DD-I18N-2`), and `pmo_epoch_at` (`DD-XING-2` — free at creation, guesswork to reconstruct after an
ERP arrives). ⚑ That growing companion list is the actual reason to build it: every hand-written
`insert` is a chance to miss one. Interim operator SQL stays acceptable but must be written down in
`docs/environments.md` and set the same rows.

**[DD-ORG-2] A user in the wrong org is handled by offboard + reinvite. Reassignment is ruled out —
on tenancy-integrity grounds, not UX** (#441 → guard #485). The ticket frames it as a policy choice;
it is not. `profiles.org_id` is the tenancy anchor, so mutating it retroactively rewrites which org
every record that user ever authored belongs to. Three things break together: historical rows in org
A become authored by a profile in org B (a cross-tenancy reference no RLS policy anticipates); it
lands squarely on the **known-weak SoD surface** — the recorded root cause of the create-path class is
that SoD asks who set a value and never validates that person's *current* standing, and a cross-org
move is that defect with a new trigger, introduced deliberately into the money path; and it would
**silently carry org-scoped integration connections across the boundary**, since offboard
cascade-deletes them by design and a bare `update` has no such step. That last point inverts the
ticket's own question: the cascade is not something a move should *mirror*, it is a reason to prefer
offboard, which already does it right. Offboard + reinvite preserves authorship integrity (the old
profile stays in org A) and costs only identity continuity across orgs — which is correct, since the
user **was a different principal in each org**. This decision removes scope; the only build is making
`profiles.org_id` immutable so nobody later writes the obvious-looking `update`.
**Enforced by `supabase/migrations/0190_profiles_org_id_immutable.sql`** (trigger
`profiles_org_id_immutable`, proof `supabase/tests/profiles_org_id_immutable.test.sql`): an `UPDATE`
that changes `org_id` raises `23514` naming this decision and pointing at offboard + reinvite;
`INSERT` still sets it freely. ⛔ It binds **every** role including `service_role` and the table
owner — an integrity invariant, not an authorization rule, so there is deliberately no exemption
hook. It is `AFTER`, not `BEFORE`, so the RLS `org_id` pin underneath stays independently
observable.

**[DD-ORG-3] Org lifecycle marker `live`/`demo`/`test`, with a DEFAULT-DENY destructive guard, `live`
terminal, enforced at two layers** (#460 → build #489). ⛔ The polarity is the decision. Written the
obvious way ("refuse when state = `live`") it fails open on exactly the rows that matter most:
**every org that exists today has no marker**, so NULL-is-destroyable would leave the real client
unprotected on day one — the precise scenario the ticket was raised about — and any state added later
(`archived`, `suspended`) would silently become destroyable. So: refuse **unless** the state is
explicitly in a destroyable allowlist (`demo`, `test`); `NULL`, unrecognised, and `live` are all
protected. This repo has shipped inverted guards twice. **`live` → anything is refused outright** —
demoting a live org is not maintenance, it is removing protection from real client data, and it is the
move that would immediately precede a destructive command. Two layers (DB function = authority,
script check = fail-fast ergonomics) because defence in depth needs a test per layer. Scope is
org-**wholesale** operations; per-record deletes stay with RLS + soft-archive (ADR-0018).

**[DD-DEPLOY-1] Expand-then-contract is the rule; the observed failure gets a mechanical guard;
version handshake rejected** (#444 → build #486). The ticket offers deploy-order SOP, version
handshake, or coupled promote. **No fixed order is safe in both directions** — a function redirecting
to a new route needs the frontend first, a frontend calling a new function needs the function first —
which is why "deploy in the documented order" did not save us. So the rule is expand-then-contract:
every cross-boundary change ships with both sides tolerating old *and* new before a later promote
removes the old, which makes **order irrelevant** — the only property that survives a deploy done
wrong under pressure. A version handshake adds a permanent runtime coupling and a new failure mode to
solve a release-discipline problem: rejected. Discipline that lives only in a doc is what just failed,
so the observed case gets `scripts/check-redirect-targets.mjs` (edge-function redirect targets must
resolve to real frontend routes), running in CI on PR→`main` — the gate immediately before the owner
is asked to authorize a production promote. A coupled promote script adds **no safety** over this and
should never be mistaken for the safety mechanism.

**[DD-RPT-1] `/reports` leaves the navigation now; the fixed report set is not day-1** (#465 → build
#488, owner question parked at #487). A nav entry leading to a placeholder advertises an unfinished
product to exactly the audience a demo is meant to persuade, and it is a one-line fix. The report set
is deferred on **sequence**, not data: the locked go-live order (i18n → tasks → meetings → work orders
→ Bahasa → go-live) does not contain reports. ⚑ Worth recording because it cuts the other way — the
convenient argument that reports are blocked on ERPNext is **false**: in standalone mode PMO owns
`sales_invoices` and the procurement chain natively, so AR and AP aging are computable at go-live. A
report *builder* remains out of scope. Whether RIS needs a named report at day-1 is a client fact only
the owner holds and is parked, blocking nothing.

## DD-TEN-1 · DD-OPS-1 · DD-ORG-4 · DD-ENTRA-1 · DD-TASK-1..5 (Director, 2026-08-19, second batch)

Resolves #461, #442, #443, #452, #462. All `DD-`.

**[DD-TEN-1] The cross-org isolation proof must run against PRODUCTION-PARITY GRANTS, be adversarial,
enumerate its denominator, and become a standing gate** (#461 → build #490). ⛔ The grant requirement
is the decision: `0173`'s sweep was green in CI and false in prod because hosted Supabase grants
`EXECUTE` to `anon`/`authenticated` on every `public` function and local Docker does not (23 definer
writers unauthenticated-callable; closed by `0185`). This proof is that shape with the blast radius
multiplied — a grant difference would certify tenant isolation that does not hold, for every tenant at
once. Pass bar: no cross-org read/write **reachable** by any authenticated principal (not "policies
present"); **mutation-verified** — delete an `org_id = auth_org_id()` predicate and the tests go red;
**enumerated** — every org-scoped table, definer, edge function and storage bucket proven or explicitly
excepted. Surface order by risk, not by ease: **edge functions first** (run as `service_role`, bypass
RLS, invisible to pgTAP), then definers (must take org from the JWT, never a caller parameter), storage,
the agent surface (has a natural attacker in prompt injection), the view compiler, and tables **last** —
the instinct to start where the tests already are is backwards. Standing, not one-time: a guard that
fails the build when a new org-scoped surface has no proof. **Disqualifying outcome:** if that guard
cannot be written, shared multi-tenancy is ruled out — the failure mode is silent cross-tenant
disclosure and "we were careful" is not a control. Fallback ladder: schema-per-tenant (Director), then
minimum price / thinner margin (owner, parked *then*).

**[DD-OPS-1] No operator console. A boundary rule, a runbook, and a named revisit trigger** (#442 →
#491). The only routine operator power (feature toggles) **already has a UI**; everything else is rare,
and one of them was just ruled not to get a UI (`DD-ORG-1`) — building a console now would contradict
that within the same batch. "Scattered" is a **discoverability** problem: one runbook page solves it at
~1% of the cost. Boundary: **operator = cross-org, platform-level, rare → guarded RPC + runbook;
org-admin = within-org, routine → UI.** Revisit when orgs exceed a handful, i.e. when shared
multi-tenancy lands.

**[DD-ORG-4] Shared deployment: RIS `live`, Gordi `live`, Demo `demo`. No vendor org. The cleanup that
matters is PII** (#443 → #492, states ride with #489). ⚑ **Gordi is `live`** — the temptation is `test`
because it is ours and it is the isolation-proof subject, but it holds real data and a guard treating
it as disposable is wrong in the one direction that cannot be undone. Owner-controlled means a failure
costs us, not that the data is expendable. The demo org **keeps** staff membership: demo data is
hand-maintained and impersonation is view-only (ADR-0016), so "reach it only by impersonation" sounds
cleaner and does not work — bound the membership instead. The real exposure is not layout: the demo org
is **shown to prospects** and has accumulated whatever was convenient to type, so auditing it for real
names/emails/phones is the item with a real-world consequence. Also flagged: the shared project is
described as staging/demo in one place and as production for the first client in another; the lifecycle
backfill is where that ambiguity stops being harmless.

**[DD-ENTRA-1] RIS gets Option B — the Entra app registered in the client's own tenant** (#452 → #494).
ADR-0064 defaulted to Option C on the economics of doing publisher verification once; that premise is
gone (owner, 2026-08-16). Without verification, C and A both show the unverified-publisher warning and
some tenant policies block unverified apps outright — discovered with the client's admin mid-ceremony,
the worst possible moment. B needs no verification, shows no warning, cannot be consent-phished
cross-tenant (automatic tenant lock, matching the deployment's `tid` binding), and their admin is
already in the room. Cost accepted: registration lives in their tenant, so secret rotation is
coordinated with their IT. Revisit C **only** if publisher verification ever happens. ⚑ This had sat as
"owner ruling needed" since 2026-08-18; under the same day's decision-rights directive it is
architecture and therefore a Director call — converting it rather than letting it block. Whether their
IT will host the registration is a client-relationship fact, discovered in the ceremony, escalated then.

**[DD-TASK-1..5] First-class tasks** (#462; authorization detail stays private per the public-repo
rule). **[DD-TASK-1]** v1 references are **project and meeting only**, not mutually exclusive, with an
invariant that a task and its meeting cannot name different projects (mirror
`check_tasks_parent_same_project`, `0140`). Every extra nullable parent multiplies the policy-branch
matrix, which is the delicate part. **[DD-TASK-2]** ⚑ `meeting_id` does **not** land in the same migration:
nullable `project_id` is the dangerous change and ships **alone**, so it is reviewed on its own diff
with only pgTAP as its consumer. New oracles are written **first, red**, because their job is to fail
if the authorization surface is got wrong — written afterwards they get written to match whatever
shipped. The write surface is reconciled **atomically** (the bug is the disagreement *between* its
parts, so a partial change is the failure mode, not progress). The trigger failures share **one root
cause** — external-ownership resolved via the task's project rather than its own org — so fix the root,
not four symptoms. Mutation-test the **neighbours**, per the July lesson. **[DD-TASK-3]** `OD-2`
(`requiredFilter: 'project_id'`) is **repealed** and replaced by a **row cap + explicit ordering**, not
an alternative required filter: `OD-2`'s purpose was boundedness, and RLS already supplies the security
bound. **[DD-TASK-4]** v1 surfaces are **"My tasks"** (assignee-scoped, reaches project-less tasks free) plus a
stable `/tasks/:id` deep link; an org-wide task browser is out. **[DD-TASK-5]** `timesheet_entries.project_id`
**stays `not null`** — a project-less task cannot be timed. Time is costed and pushed to ERPNext where
project is the accounting dimension; relaxing it would drag this migration into the money path for a
rare case. Attach the task to a project first: a legible workflow, not a workaround.

## DD-IMP-1 — budget import descriptor (Director, 2026-08-19)

Resolves #473 → build #495. Effort S, and the last day-1 dataset without an importer.

**Fields.** Version header: project (ref), name, fiscal year. Line items: `category`, `description`,
`budgeted_amount`. `version` and `status` are derived, never supplied.

⛔ **`actual_amount` is NOT importable.** It sits on `budget_line_items` and an importer would
naturally include it. Actuals come from the ERP read-model; a spreadsheet writing them produces a
figure **PMO computed rather than read**, breaking the ledger-sourced display rule (ADR-0048/0055) —
silently, because the number looks correct.

**Shape.** One row = one line item, parent version resolved by reference and **matched-or-created** as
Draft on `(project, fiscal_year)`; requiring a manual pre-step per project defeats a bulk importer at
the one moment it runs at volume. A **fiscal-year column per row** is required, not optional: budget
identity is year-qualified (`0154`), so the year cannot be implicit — and a wizard-level
"one year at a time" mode could not express the multi-year plan a real budget sheet is.
Re-run safety uses the **shipped** import provenance (`0072`); a descriptor-local dedupe scheme is how
two mechanisms end up disagreeing.

**Draft-only is achieved by omission** — `budget_versions.status` defaults to `'Draft'`, so the
descriptor simply does not expose it. **Activation is reachable only via `activate_budget_version`,
never an import**; bulk-creating activated budgets routes around the approval path, the class this
repo has already paid for four times. Precedent one descriptor over: `projectDescriptor` constrains
status because "a won/on-hand status is reachable only via the transition RPC, never an import." Test
it and **mutation-check it** — adding `status` to the descriptor must turn a test red.

⚑ **AMENDED 2026-08-20 — the effort estimate was wrong, and so was one of its premises.** `DD-IMP-1`
said "the work is a descriptor plus wiring an `<ImportButton>`" and called it effort **S**, on the
assumption that the shipped import provenance (`0072`) was generic. **It is not.** `0072` adds
`import_batch_id`/`imported_at`/`import_key` **per table** and covers only the procurement chain
(`procurements`, `purchase_requests`, `rfqs`, `procurement_quotations`, `procurement_receipts`,
`procurement_invoices`, `purchase_orders`, `payments`) — **no budget coverage at all**. So #495 is
**migration + descriptor**, not descriptor alone: the budget tables need the same three columns and
the DB-enforced partial unique index. A dispatched builder found this by refusing a brief that told it
to use provenance that did not exist while also forbidding a local dedupe scheme — it could satisfy
neither, and escalating was correct. The general lesson: **"reuse the shipped X" is a claim about the
tree, and it needs checking before it goes into a brief.**

⚑ **Sequencing correction.** The ticket instructs the descriptor to set `currency` explicitly. **There
is no `currency` column to set** — the only ones in the schema are on the ERP snapshot read-models
(`0101`, `0150`); `OD-CR-5` is ruled and unbuilt (also under `DD-XING-4`). So #495 is **blocked on
#478**. Both are pre-go-live and seeding runs once, so building the importer first means building it
twice, the second pass touching a money-shaped path for no gain. This does not make the importer less
day-1 — it orders two day-1 items that were being treated as independent.

## DD-WO-1..6 — the Work Order record (Director, 2026-08-19)

Resolves #471 → build #498 (blocked on #478); owner ground-truth parked at #496. Every precedent cited
was verified against the tree.

**[DD-WO-1] One table, no children, `project_id NOT NULL`.** A work order with no commitment has no
ceiling to draw against — deliberately unlike tasks, where nullable was the point. No `client_id`
(derive from `projects.client_id`), no line items in v1, no `contracts` table (`OD-WO-1`). Mint
`wo_number` with the **existing** `next_procurement_doc_number(org, prefix)` at prefix `'WO'` —
already atomic per-(org, prefix, day) and already revoked from `authenticated`; the
procurement-flavoured name is cosmetic. Do not write a second minter.

**[DD-WO-2] Drawdown is a DERIVED sum (`security invoker`), and over-ceiling is allowed, warned and
ATTRIBUTED.** Copy `get_project_budget` (`0005:15`), which carries an explicit "do NOT add security
definer" comment. Not a stored balance: `projects.spent` was added in `0001:79` marked
`-- DEFERRED: stored vs derived`, is still unmaintained, and the UI derives instead — stored rollups
rot in this schema. **Not a hard cap**, and the reason is about people: `contract_value` is
Exec/Finance-gated once a project is won (`0014`), so a cap would stop a PM **recording a real client
PO** until someone a role away raised the ceiling — a control that blocks recording reality. Instead
the issue RPC computes the sum under the parent lock and, on exceed, requires an explicit
`p_over_commit_ack` it **refuses to default** (fail closed), stamping who acknowledged. Without it
there is no record anywhere of who chose to over-commit. Committed = `Issued + Closed`; **Draft
excluded** or the PM's headline number is polluted by drafts.

**[DD-WO-3] `Draft → Issued → Closed` + `Cancelled`; SoD on issue.** Deliberately NOT states: worked,
delivered, invoiced, paid — paid-ness already has an oracle on the invoice
(`sales_invoices.erp_outstanding_amount`), and a second copy would disagree. SoD copies the shipped
`projects` pattern: `set_work_order_value` as sole writer, witness ≠ caller, **fail closed on NULL
witness**, witness must be an **active** member (reuse `0180`/`0183` — witness=winner, offboarded and
demoted are the three recorded variants), origination guard on INSERT. ⚑ Two mechanical traps:
**revoke the table UPDATE grant and re-grant the column list minus `order_value`** (a column-level
REVOKE on top of a table grant is a **silent no-op**), and **add `work_orders` explicitly to
`0171_sod_class_completeness.test.sql`** — that test names its tables, so a new money table is not
automatically in the denominator.

**[DD-WO-4] `sales_invoices.work_order_id`, nullable in schema, required by the UI path.** Nullable is
**forced**: the table doubles as the machine-written mirror when revenue flips externally-owned, so an
adopted ERP-originated invoice has no PMO work order and `not null` would break adoption; pre-epoch
history has none either. Constrained by a same-project trigger (precedent
`check_tasks_parent_same_project`, `0140`). ⚑ **Mandatory paired edit:** add it to
`sales_invoices_native_mirror_guard` (`0123:117`), which enumerates every native field — omitting it
leaves the column user-writable while revenue is externally owned, the exact "closed one path, left
the other open" shape that produced SoD slices 2–6.

**[DD-WO-5] Posture B at the ERPNext crossing, and post-issue value edits are FORBIDDEN.** ADR-0059
§2's test answers B on all four counts, including "never adopt" — a natively-created ERPNext Sales
Order never passed the issue gate. ⚑ Two collisions needing an addendum line, not a redesign:
ADR-0055 §5 lists Sales Order as ERP-owned, so **a builder pattern-matching that row will build
Posture A** — §5A must state that PMO owns the client's *inbound* PO, for which ERPNext has no native
record, and the ERPNext Sales Order is its mirror; and **no `salesOrder.ts` body builder exists**
(verified against `src/lib/adapterSeam/erpnext/bodies/`) — new work, not reuse. **Forbidding
post-issue value edits** is the ruling that removes the weak-stamp class: otherwise `issued_at` stops
moving when pushable content moves, a re-push derives an identical key, and the write is **silently
suppressed** leaving ERPNext holding the wrong value (the OQ-BUD-2 failure, `0137`/#479). An amended
PO is Cancel + re-issue — which is also how ERPNext amends.

**[DD-WO-6] Out of v1:** the push itself · `tasks.work_order_id` (**must not ride along** — `tasks.
project_id` is still `not null`, so #462 hasn't landed) · change orders as a distinct record ·
retention/advances/milestone billing · its own Delivered/Invoiced/Paid status · any procurement link.
**Reusing `purchase_orders` would be wrong**: it is a child of a procurement case and an *outbound*
vendor order; authorization routes through the procurement parent, its ERP posture is the opposite
direction, and the drawdown sum would **silently mix our vendor commitments with the client's grants**
— the worst defect available here. The similarity is that both are called "PO".

## DD-OPS-2..5 — self-hosting ERPNext for RIS (Director, 2026-08-19)

Resolves #474 → build #499; commercial questions parked at #497.

**[DD-OPS-2] One VPS in Jakarta, `compose.yaml` (not `pwd.yml`), image pinned to `v15.94.3`.**
⛔ The dev bed **cannot be promoted** — it runs `pwd.yml` (`docs/environments.md:401`), which upstream
labels a disposable non-production demo. Floor: 4 vCPU / 8 GB / 80 GB for ≤25 users (9 long-running
containers). ~$55–70/mo all-in. Hetzner at ~$9 is the tempting option to refuse: 180–250 ms to Jakarta
plus cross-border transfer of a client's financial records to save ~$45. Frappe Cloud is ruled out by
`OD-ERP-2` and has no Indonesia region. **Pin to the tag the adapter contract was proven against** —
a minor bump invalidates the version-handshake proof. ⚑ **IP-allowlisting is unavailable**: the sweep
dials `site_url` outbound from Edge Functions (`erpnext-sweep/index.ts:605-636`), which have no stable
egress IP, so token + TLS + rate-limiting **are** the whole perimeter.

**[DD-OPS-3] We do everything mechanical; RIS owns accounting judgment.** Us: host, stack, TLS, DNS,
backups, monitoring, site, API user + token, Connect binding, naming series, account map,
`pmo_epoch_at`, and **execution** of the import. RIS (same single named owner as `OD-SEED-2`): chart of
accounts (**their codes win**; ERPNext's bundled Indonesian COA is community-contributed and rough — a
template at most), fiscal-year convention, **PPN templates**, real historical document numbers, the
sheets. ⚑ The PPN encoding is an accountant's call: 12% on an 11/12 DPP gives an effective 11%, and
**two ERPNext encodings of that print different invoices**. The partner has nothing on the critical
path. ⚑ **Connect waits for the currency seam** — `OD-CR-5` pins org currency to the ERPNext company
currency at connect and there is no PMO-side currency column to pin against yet.

**[DD-OPS-4] Rehearse the historical load on a clone, then run it ONCE.** After go-live, before
Connect, with `pmo_epoch_at` set **first** so the load reads as pre-epoch Posture-A history and is
never adopted (`DD-XING-2`). Prerequisites: company/IDR/abbr frozen · the **final** COA (renumbering
after GL entries orphans the ledger and the account-map bijection) · **Fiscal Years covering 2025 and
2026** · cost centers and a `Project` on every document · tax templates · naming series. ⚑ The
fiscal-year prerequisite fails **silently**: a GL row whose fiscal year ERPNext never stated is stored
but selectable under no year the UI can offer — money in the database, invisible in PMO, no error
anywhere. One shot matters because submitted ERPNext documents are **immutable** (reversal is
Cancel + Amend, leaving cancelled documents in the ledger permanently) and native Data Import is **not
idempotent** — the derived-key protection covers the *adapter* path only, so a re-run doubles the GL.

**[DD-OPS-5] Nightly logical dump offsite, rehearsed restore, RPO 24h stated not assumed.**
`bench backup --with-files` to a different provider/region, encrypted, key in 1Password, never on the
box; provider snapshots as the fast path but **not** a substitute. **Restore rehearsal before go-live,
then quarterly** — an untested backup is not a backup. Skip PITR at this volume. ⚑ **Do not use
Frappe's built-in S3 Backup Settings doctype** — present in v15, removed from its usual place in v16;
cron + `bench backup` + rclone survives the upgrade.

**What self-hosting signs us up for**, recorded because it was chosen over the partner hosting it:
~2–4 h/month steady state; **one major upgrade inside this client relationship** (v15 EOL end-2027)
which also invalidates the pinned version-handshake proof, so the adapter battery re-runs with it; and
the real cost — **someone answers when it is down**, on RIS's books, with ERPNext headless so **RIS
cannot even log in to look**, and no partner escalation path. That absence is what the ~$50/mo saving
buys. Commit to an explicit business-hours WIB window. ⚑ Breakeven against managed hosting is ~2–3
self-hosted instances — revisit `OD-ERP-2` the moment a second appears. ⛔ The demo org does not share
a MariaDB with a paying client's books.

## DD-MTG-1..5 — the meeting module (Director, 2026-08-19)

Resolves #463, the last decision ticket on the frontier. Depends on #462 shipping first.

**[DD-MTG-1] One typed block in v1: the action item.** Not Decision, not Risk, not Attendee mention.
Each typed block costs a schema, a renderer, a slash item, a backing table **and a sync contract** —
and the sync contract is the expensive part. Action item earns it because a task already exists as a
first-class entity with consumers outside the meeting; Decision and Risk have no backing table, no
outside consumer, and nobody has asked. **The durable test, so this is not re-argued per block: a
block earns being *typed* only when something OUTSIDE its meeting must query, assign or filter it —
otherwise it is formatting.** Attendee mention fails it twice: attendees are already a first-class
field, so a mention would be a second, drifting copy. Nothing is lost by waiting — notes are JSON, so
a block can become typed later without a migration penalty.

**[DD-MTG-2] The row is SoT; the block stores the task id and nothing else. There is no sync.**
The spike was explicit that it proved none of this, and this is the decision it was run to inform.
Block-authoritative breaks the point (a task edited in the task list would be silently overwritten by
the document); two-way sync is a distributed-systems problem with paste, undo and offline all
producing conflicts. Storing only the reference **removes** the problem rather than managing it, and
every awkward case answers itself: a task edited elsewhere is reflected immediately (it was never a
copy); **deleting the block removes the reference and never deletes the task** — deleting assigned
work must not be a side effect of tidying a note; a task deleted elsewhere renders a **tombstone**,
never a crash or a silent vanish; paste yields two references and **no write** (a paste that silently
creates a task is worse than one that doesn't); undo after `/action` leaves the task, which is legal
under `DD-TASK-1` and surfaces in "My tasks" — untidy, never lossy. ⚑ `tasks.meeting_id` is the second
nullable parent and needs its **own** migration after nullable `project_id` lands alone (`DD-TASK-2`).

**[DD-MTG-3] Attendees are staff, contacts, or a free-typed name** — a `meeting_attendees` join with
three mutually-exclusive nullable columns, exactly one set (explicit columns, not polymorphic — same
ruling as `DD-TASK-1`). ⚑ The free-text shape is not a shortcut: notes are taken **live, during a
meeting**, and forcing every attendee to be an existing row means stopping mid-meeting to create a CRM
contact for someone who attended once. The reliable outcome of that friction is that attendees stop
being recorded at all. Promote to a contact later, when someone cares.

**[DD-MTG-4] One optional `project_id`. NO separate contact field** — a deliberate deviation from the
charter's "project and contact both optional", flagged rather than slipped in. A meeting's contact
**is** an attendee, so a separate `contact_id` is a second copy of the same fact that drifts the first
time someone edits one and not the other. CRM filtering survives: "every meeting with Acme" resolves
through attendees → contacts → company, a join needed anyway. Revisit only if a real case appears
where the counterparty did not attend.

**[DD-MTG-5] Reverse-chronological list, project filter, and search over notes as the primary find
mechanism** — people look for "the meeting about X sometime last week". ⚑ Concrete consequence:
BlockNote notes are JSON and Postgres FTS cannot search that directly, so **maintain a plain-text
projection alongside the JSON** and index it. Cheap designed in now; a migration over live client
notes if bolted on later — and this client treats meetings as day-one, so the notes will exist.
Templates unchanged: a meeting flagged as a template, copied on create. No template engine.

**Carry into the plan** the two spike findings that enlarge the estimate: the scoped-CSS seam must
override **heading scale** (BlockNote's own scale is not ours), and the surface needs an explicit
mobile-overflow proof under `AC-MOBILE-OVERFLOW-001`.

## DD-RIS-1..4 · DD-OPS-6..8 — RIS provisioning and the go-live ops contract (Director, 2026-08-19)

Resolves #454 and #457. Both are shaped by #451: RIS runs on the **shared deployment**, so their
production *is* our shared project and every promote and outage is client-affecting by construction.

**[DD-RIS-1] ⛔ The destructive guard lands BEFORE the RIS org exists.** #451's own resolution says the
shared project stops being resettable the moment real data lands, and that the rule is "only
enforceable with a machine-checkable marker". Order: **#489 ships** → existing orgs backfilled (Demo
`demo`, Gordi `live`) → **then** the RIS org, stamped **`live` at creation**. Stamping at creation
matters because `DD-ORG-3` made the guard default-deny: an unmarked org is already protected, so
creating RIS unmarked is *safe* but leaves the real client's protection resting on a default instead of
a decision — and `live` is terminal, so creation is the only moment it is free.

**[DD-RIS-2] We create the org and exactly one Admin; RIS invites everyone else.** Operator creates the
org plus its non-optional companions (`DD-ORG-1`): first Admin = the org's own named data owner
(`OD-SEED-2`, the same person who prepares every import sheet — splitting those two roles is how a
migration stalls); locale defaults `id` / Indonesian number format / `Asia/Jakarta` (`DD-I18N-2`);
`pmo_epoch_at` = the go-live date (`DD-XING-2`). **Their Admin invites the rest** — we do not decide who
at the client gets which role, it is their org chart. It also makes their first interaction *using* the
product rather than watching us configure it, and exercises the invite path they will use forever on
day one while we are watching.

**[DD-RIS-3] RIS test accounts in the demo org are OFFBOARDED, not moved** (`DD-ORG-2`). Fresh profiles
in the RIS org; their demo-org history stays in the demo org, because it was demo activity, not real
work, and must not follow them into the client's data. ⚑ This is simultaneously a **#492** finding: a
real RIS person's name and email in a **prospect-facing** demo org is exactly the PII exposure that
issue exists to remove. Do both together.

**[DD-RIS-4] The runbook lives with the operator runbook (#491), not as a separate artifact** — an
operator following one procedure should not have to know a second document exists. End-to-end order:
guard → backfill → create RIS `live` with companions → invite the Admin → Admin invites the team →
offboard the demo duplicates → verify. ⚑ The verification people skip: **prove the destructive guard
refuses a wipe of the real RIS org, before the data goes in.** A guard never observed refusing is not a
guard. *Parked (owner):* who at RIS is the Admin and who else is invited — the runbook is written
against roles, names filled in at execution.

**[DD-OPS-6] Promote policy: no unannounced promotes once RIS is live.** `main`→`production` stays
separate, explicit and per-instance owner-gated — unchanged. What changes: promote in a **stated
window**, announced beforehand (not because deploys are risky, but because a client surprised by a
change stops trusting the product even when the change is good), and **never during their
close/billing crunch**, when approvals and invoicing cluster and a regression costs most. `dev`→`main`
is unchanged and stays the Director's within-scope call. ⚑ A promote now also hits the demo org and
Gordi — one deployment, three orgs — so **check the demo org after every promote**; it is the surface a
prospect sees.

**[DD-OPS-7] Monitoring: reuse the floor; treat ANY deployment alert as client-affecting.** BetterStack
+ Telegram + PostHog, not a per-client monitoring story for one client on a shared project.
⚑ **Deliberately do NOT split "demo down" from "client down"** — they share a deployment, so a per-org
alerting split is a fiction that delays response while someone works out whose problem it is. One
deployment, one alarm. The genuinely new item is a **quota alarm on the shared project**: shared limits
mean demo activity or a runaway job can degrade the client. (Constraint: scheduled workflows fire only
from the default branch, so it cannot run until the workflow reaches `main`.)

**[DD-OPS-8] Support loop: one named channel, triaged by us, filed WITHOUT their PII.** RIS cannot file
issues here — public repo, and they are a client. One inbound channel only (two means an issue lands on
the one nobody watches); we triage into GitHub issues with the existing labels. ⛔ **A client-reported
issue is filed without their data** — no personal names, emails, invoice or project numbers, no
screenshots of real records. Describe the *defect*, not the *record it happened to*. This is the
public-repo rule applied to the one input stream that arrives **pre-loaded with client PII**, which is
what makes it easy to get wrong. Acknowledge and resolve **into the channel** — a client should not
have to read a public tracker to learn whether their problem is fixed. The contractual
availability/support commitment stays pooled at #497.

## DD-CUR-1..5 — implementation rulings from the currency + tax build (Director, 2026-08-19)

Settled while building #478 (`a0f48957`). Recorded because a future agent would otherwise re-derive
them — or, worse, "fix" them.

**[DD-CUR-1] `currency` goes on money *document* tables only — 12 of them — not on everything with a
`numeric` column.** Enumerated from the live schema, not from the issue body. Deliberately excluded,
each with the reason in the migration header:

- **Child line tables** (`procurement_items`, `budget_line_items`) — currency belongs to the header,
  which is ERPNext's own model. A per-line column that nothing keeps equal to its parent *invents* a
  "USD line under an IDR document" ambiguity that does not exist today.
- **Platform AI billing** (`agent_usage.cost`, `credits.amount`, `credit_reservations.amount`) — USD,
  and never an ERP document. Stamping org currency would **re-denominate a USD credit grant as IDR**.
- **ERP read-models** (`erp_*_snapshot`, `erp_gl_entry_mirror`, `timesheet_erp_mirror`) — machine-written.
- Non-money numerics (`timesheet_entries.hours`, milestone weights, win probability).

**[DD-CUR-2] ⚑ The stamping trigger is named `<tbl>_zz_stamp_currency` because BEFORE triggers fire in
NAME ORDER.** It must run *after* `<tbl>_stamp_org_id`, or a non-seed-org insert resolves its currency
against the **seed** org. Anyone renaming these triggers alphabetically-tidier will reintroduce that
silently. The default is `'XXX'` — ISO-4217's own "no currency" — with the trigger overriding
null-or-`'XXX'` and a CHECK forbidding `'XXX'` from surviving, so an unstamped row cannot persist.

**[DD-CUR-3] `tax_treatment` is TEXT with a CHECK, not a boolean, and has NO DEFAULT.** A boolean lets
an omitted or falsy value silently become `'exclusive'` — which is exactly the silent-wrong-answer this
whole issue exists to prevent. Text with no default makes omission a hard `23502`/`23514`. A "plausible"
default was mutation-tested: adding `default 'exclusive'` turns four assertions red, by design.

**[DD-CUR-4] ⚑ Column-level INSERT grants invert the usual trap.** Several money tables carry
**column-level** INSERT grants, so a newly added column is **not insertable unless explicitly granted** —
the opposite of the familiar "a column REVOKE cannot subtract from a table grant" failure. `currency` is
granted INSERT (never UPDATE) on the five such tables. `DD-IMP-1`'s import descriptor must state it
explicitly or imports will fail on a column nobody remembers exists.
**One honest exception, documented in `0187` §4:** `budget_projections` holds *table-level* INSERT/UPDATE,
so its `currency` **is** client-updatable and a column REVOKE there would be a silent no-op. Fixing it
means revoking the table grant and re-granting the column list minus `currency` (the `DD-WO-3` mechanic).
Not done: it is a PMO-authored forward estimate that mints no ERP document. Flagged rather than hidden.

**[DD-CUR-5] Mirror guards are pinned, but NOT by re-creating triggers.** `0189` adds the new columns to
the **six** `*_native_mirror_guard` functions that enumerate their fields. `purchase_requests`/`rfqs` are
deliberately untouched — their guards are **blanket denials**, so enumerating fields there would *weaken*
them. ⚑ And no trigger is dropped-and-recreated: live trigger names are **not uniform**
(`procurement_quotations_zz_native_mirror_guard` vs `..._trg`), so `0125`'s drop-and-recreate habit would
leave a **duplicate trigger under a new name**.

**Still owed, both flagged not fixed:** `siToBody` does not yet send `currency` explicitly, which
`OD-CR-5` requires on the push side (its contract is spike-frozen and unverifiable without a live bench);
and `database.types.ts` is stale on `dev` by ~215 lines unrelated to this change, so only the
currency/tax hunks were applied to keep the diff reviewable.

**Vendor invoices need the same treatment** — `procurement_invoices.amount` (added in `0040`) carries the
identical ambiguity. Scoped out deliberately because it needs a definer-RPC signature change with
PostgREST overload risk and multiple callers. **#505**, same deadline class as #478.

## DD-VI-1..2 — vendor-invoice tax: the two questions #505 could not settle (Director, 2026-08-20)

Surfaced by the #505 investigation, which correctly refused to guess them.

**[DD-VI-1] A vendor invoice with NO amount carries NO tax marker — enforced by a PAIRED check, not
by making the marker unconditional.** `procurement_invoices.amount` is nullable (`0040:27`) and the
shipped importer explicitly allows amount-less VI rows
(`src/lib/import/procurementCycle/validate.ts:138-143`). A `NOT NULL tax_treatment` would therefore
demand a tax treatment for a figure that does not exist, and would break a shipped path. The honest
constraint is `(amount is null) = (tax_amount is null)`: **either you have a figure and its
treatment, or you have neither.** A marker without an amount is not conservative, it is noise — and
noise in a money column is how the next person mis-reads it.

**[DD-VI-2] An import row with no tax column is REJECTED, not defaulted.** `0188` forbids a DB
default; it does not forbid an importer-side ruling, and the investigation was right that this was
open. Ruling: reject. Applying an org-wide default at import is exactly the silent-wrong-value this
whole class exists to prevent — and it would be applied to *historical* rows, where nobody is
watching. The cost of rejecting is low by construction: the wizard validates **client-side with zero
writes** (`OD-SEED-2`), so a rejected sheet is a message, not a cleanup. RIS adds a tax column before
import, and the answer gets stated per invoice, which is the point.

⚑ Carried from the investigation: **do not copy `0188`'s last line.** It ends with
`grant insert (...) on public.sales_invoices to authenticated`; `procurement_invoices` does not have
the same grant shape, and importing that step unexamined would widen a surface nobody asked to widen.

## DD-BRIEF-1 — cite where a definition LIVES, not where it was introduced (Director, 2026-08-20)

Five briefs on 2026-08-19/20 asserted something about the tree that was false. One class dominates and
it is mechanical, so it is worth a rule rather than more care.

**The failure.** I briefed #498 to add `work_order_id` to `sales_invoices_native_mirror_guard`
"(~`0123:117`)". `0123` *introduced* that function. It has since been **replaced twice** — `0125`
added `author_user_id`, `0189` added `currency` and the four tax columns. With `create or replace`,
**the last redefinition is the live one**, and `0189`'s body enumerates 22 columns.

Had the agent copied `0123`'s body as instructed, it would have **silently unpinned six columns** —
leaving them user-writable while revenue is externally owned. That is the exact "closed the path in
hand, left the other one open" shape behind SoD slices 2–6. The agent checked instead, copied from
`0189`, and said so.

**The rule.** Before citing a `file:line` for a function, policy, trigger or grant in a brief:

```
grep -ln '<name>' supabase/migrations/*.sql     # every migration that touches it
```

and cite the **highest-numbered** one. A first-introduction reference is right about history and
wrong about the tree — and for anything created with `create or replace`, wrong in the direction that
silently drops whatever was added since.

⚑ The same rule caught the sibling errors: `budget_versions.activated_at` was reported missing when
`0139` had added it; `npm run verify` was documented as 8 gates when `package.json` chained 13; the
retained-definer count was cited as 50 against a list of 51 and as "23 writers" against a record of 18.
**A claim about the tree, written once, does not stay true — and a brief is exactly where a stale one
does the most damage**, because the agent has been told not to second-guess it.

## DD-EVID-1 — a task notification's "exit code" is the WRAPPER's, not the command's (Director, 2026-08-20)

Caught by the #498 build agent, and it invalidates a reading I had been relying on all session.

A background shell task reported **"completed (exit code 0)"** for a `verify` run that had actually
failed with two red tests. The zero was the **wrapper shell's** status, not `npm run verify`'s. Any
pipeline, any trailing `echo`, any `| tail` — and the wrapper exits 0 regardless of what happened
inside.

**The rule: never read a completion notification's exit code as the command's verdict.** Append an
explicit marker and read that:

```bash
npm run verify:locked > verify.log 2>&1; echo "VERIFY_EXIT=$?"
```

`VERIFY_EXIT=` is the only trustworthy reading. Same for `supabase test db` — grep `Result: PASS`,
not the task status.

⚑ **Compounding hazard, same incident.** That failing run's two failures (`AssistantPanel`,
`Administration.a11y`) were **contention, not regression** — 1994ms/17673ms in files that take
38–47s, while another worktree ran concurrently; both passed in isolation and the clean re-run was
6994/6994. So the two failure modes point opposite ways and must not be conflated:

| Signal | Means |
|---|---|
| Notification says exit 0 | says **nothing** — check the marker |
| Red test, duration ≈ the file's normal runtime | likely real |
| Red test, duration wildly short or long vs normal | likely **contention** — re-run in isolation before believing it |

The recorded rule stands and now has a second leg: **read the failure DURATION**, and read the
marker, never the wrapper.

## DD-WO-7..10 — implementation rulings from the work_orders build (Director, 2026-08-20)

Argued in `0193`'s header by the build agent; recorded here so they are durable and revisiting one is
a visible edit rather than a quiet drift.

**[DD-WO-7] Both null-witness shapes fail closed** — a deliberate deviation from `transition_project`,
which permits a non-NULL `_set_at` beside a NULL `_set_by` (server-side authority, pinned by
`0170 AC-PMS-019`). `projects` had un-backfillable legacy rows and a live importer; `work_orders` has
**neither**, so permitting the same shape would be a hole **created** rather than inherited. Pinned by
`AC-WO-041`, so reverting it turns a test red.

**[DD-WO-8] The post-issue freeze covers the WHOLE body, with no `actor_bypasses_rls()` exemption.**
Every frozen column is pushable content, so freezing only `order_value` would leave the state stamp
able to drift under it — the OQ-BUD-2 class. ⚑ And the exemption is refused on purpose: **a definer
RPC runs as the owner**, so exempting the owner would exempt precisely the writer the freeze exists to
stop. Pinned by `AC-WO-072/073/074/075`.

**[DD-WO-9] A work order's currency is pinned to its project's.** A drawdown that sums mixed
currencies against one ceiling is arithmetic nobody can defend, and the failure would be silent —
the number still renders. Pinned by `AC-WO-005`.

**[DD-WO-10] An over-commit acknowledgement is REFUSED when there is nothing to acknowledge.** Not
ignored — refused. A client that always sends `ack: true` is then **visibly broken** rather than
quietly sloppy, and the acknowledgement keeps meaning what `DD-WO-2` says it means: a person decided
to exceed the ceiling *on this occasion*. Pinned by `AC-WO-051/052/053`.

⚑ Also recorded, because it is the kind of thing a later reader would "tidy": `get_project_drawdown`
is deliberately **absent** from `0178`'s client-callable list. It is `security invoker`, and listing an
invoker function there blinds the sweep if someone later flips it to definer.

## DD-BIMP-1..3 — three false premises in the budget-import spec (Director, 2026-08-20)

`docs/specs/budget-import.spec.md` was written to close #495's planning gap and shipped three
confident claims that the schema on `dev` contradicts. Recorded individually because each would have
produced a different defect, and because all three are the same failure: **the spec cited the ticket
and the rulings, never the migration that defines the thing** (`DD-BRIEF-1`).

**[DD-BIMP-1] The match key is the project, not `(project, fiscal_year)`.** `budget_versions` has no
`fiscal_year` column — `0153` put `fiscal_year` on `budget_line_items`, nullable and deliberately
un-backfilled, because the value is *ERPNext's* calendar name and PMO may not invent one. Keying
match-or-create on a column that does not exist would have been caught at compile time; keying it on
the line-item column would have matched NULL against NULL on every legacy row, which would not.

**[DD-BIMP-2] The import supplies no `currency`.** `DD-IMP-1` §5 and `OD-CR-5` predate `0187`, which
shipped the currency seam as a BEFORE-INSERT trigger filling `currency` from
`organizations.default_currency`. `0187`'s own header names a client hand-carrying a currency as the
thing the trigger exists to prevent — the same argument as `org_id`. A per-row `Currency` column is a
real multi-currency feature for the day a cross-currency sheet exists, not this ticket.

**[DD-BIMP-3] The idempotency key excludes `import_batch_id`.** This is the one that mattered.
`0072`'s index and skip query are keyed on `(import_key, import_batch_id)`, and
`useProcurementCycleImport` mints `crypto.randomUUID()` per mount — so a re-import **in a new
session** misses the skip and inserts duplicates. The only cross-batch layer that exists today is
`findCrossBatchCollision`, which produces a dry-run *report*, not a skip. The spec asserted the
opposite ("the skip query… is what makes a re-run a no-op") and would have yielded an importer that
passes its own tests and duplicates every budget on the second run — a green suite that cannot fail.

`0195` is amended in place (on `dev` only, never `main`, never prod; `supabase db reset` is this
phase's rollback per ADR-0006) to key on `import_key` alone: `(org_id, import_key)` on
`budget_versions`, `(budget_version_id, import_key)` on `budget_line_items`. Still two layers, not
three — the DB is now the authority for the **re-run** as well as the race.

⚑ **Pinned, and mutation-checked**: `supabase/tests/0195_budget_import_provenance.test.sql` asserts a
duplicate `import_key` is rejected under a *different* batch id. Restoring `import_batch_id` to the
index turns exactly that assertion red — verified, not assumed. The old test asserted only
`has_index` on a name, which would have survived the wrong key silently.

⚑ **The procurement path keeps its batch-scoped key.** It is a shipped importer with live data;
re-keying it is its own decision with its own backfill question, not a drive-by. That asymmetry is
deliberate and is why `0195` carries the argument in its header rather than pointing at `0072`.

**[DD-BIMP-4] The budget `<ImportButton>` goes on the Projects list page, not a "budgets page".**
There is no budgets list route — budget lives at `/projects/:id/budget`, a tab (`appRouteConfig`).
The sheet is cross-project by construction (its first column is a project ref), so a per-project tab
is the wrong host, and building a list page to hold a button is building a page to hold a button.
`ImportButton` gains a `label` prop, because two buttons both reading "Import" is not a toolbar.

**[DD-BIMP-5] Budget versions carry provenance stamps but NO `import_key`.** A version's identity is
"this project's open `Draft`", not a row in a sheet. Key it and the second legitimate import for a
project — after the first was activated — is blocked forever by a row that is no longer `Draft`.
Idempotency lives on the line items, scoped to `budget_version_id`; that scoping is precisely what
lets a post-activation re-import land its lines in a fresh Draft rather than silently producing an
empty one. Pinned by `AC-BIMP-007` in the pgTAP file: restore `import_batch_id` to the child index
and both the re-run oracle and the per-parent oracle go red.

## DD-BIMP-6..8 — the three gaps the planner refused to invent (Director, 2026-08-20)

The #495 planner stopped before writing a plan and named three behaviours the brief left undefined.
All three were real, and one of them (`OQ-BIMP-2`) is a fact about the schema I asserted wrongly.
Recorded rather than answered in a brief, because a build agent should be able to read the rule
without reading the dispatch that produced it.

**[DD-BIMP-6] The descriptor has NO `Version name` field.** A created version is named `Imported`.
The optional-name shape generated four sub-questions — empty-cell fallback, whitespace-only,
conflicting names across rows of one project, and whether an incoming name overwrites an existing
Draft's — for a value whose only job is to be recognisable in a version dropdown, which `Imported`
does. One fewer column in the operator's sheet is worth more than a label they can edit afterwards.
⚑ If a sheet-supplied name is ever wanted, it arrives **required, first-row-wins** — optional is what
produced the four questions.

**[DD-BIMP-7] When a project has several Drafts, the import attaches to the HIGHEST `version` one —
because that is what the app already does.** The schema permits multiple Drafts (`0001` constrains
`unique (project_id, version)` and uniqueness only for `status = 'Active'`), which the brief missed.
`pages/ProjectBudget.tsx`'s selector already resolves `explicit pick → Active → highest Draft →
highest Archived → first`, so "the highest Draft" is *the version the operator is looking at* when
they click Import. Inventing a second rule — reject, or lowest — would make the importer disagree
with the screen it was launched from. Harm if it is ever wrong is bounded and visible: the projection
reads only the **Active** version (`0149`/`0153`), so a misfiled line changes no money figure until
somebody activates it, and it is on screen before then.

**[DD-BIMP-8] `ImportResult` gains `skipped`, and the wizard reports it.** The generic contract has
only `created`/`failed` (`src/lib/import/types.ts`), and `useImportWizard` counts every resolved
`create()` as created — so a re-run that correctly writes nothing would report "42 created". That is
the silent-false-signal class this repo has paid for repeatedly, and it defeats the one thing the
feature exists to demonstrate. A descriptor signals a no-op by resolving to the exported
`IMPORT_SKIPPED` sentinel; the wizard counts it separately and the result screen says so. Additive:
no existing descriptor returns it, so every current importer's counts are unchanged.
