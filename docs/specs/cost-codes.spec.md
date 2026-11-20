# Spec — Budgets: org-defined cost codes (#1580)

- **Status:** Draft for owner sign-off (2026-11-15). Docs only; nothing is built until the owner signs off this
  spec and answers (or accepts the defaults of) §9.
- **Map:** EPC prospect build route (#1481). Also general SaaS: any contractor that estimates and controls cost
  below the portfolio category level.
- **Size:** M (schema + RLS + DAL/repository + budget and procurement form fields + roll-up read).
- **Executor tier:** touches the money path (committed spend, budget lines). Per `CLAUDE.md` the roll-up and any
  RPC change are **Director-dispatched per issue**; the lookup-table CRUD slice is a bounded Orca slice.
- **ID scheme:** `FR-CC-###`, `NFR-CC-###`, `AC-CC-###`, `OQ-CC-#`.
- **Source of the ask:** the competitor review of 2026-10-31, section 3b (kept outside the public repo); the
  public equivalent is gap #5 of `docs/roadmap-spines.md:120` ("Cost codes vs fixed categories").

---

## 0. Grounding (read, not re-derived)

| Artifact | What it decides |
|---|---|
| `docs/decisions.md:197-206` (OD-BUDGET-4) | Categories are a **fixed enum for MVP; seamed configurable later** via a "seeded org-scoped lookup table, like `pipeline_stage_config`", deferred to the config bridge (OD-PROC-6). This spec opens that seam **beside** the enum, not in place of it (§2). |
| `docs/decisions.md:173-182` (OD-BUDGET-2) | Committed basis = procurements in `Ordered, Received, Vendor Invoiced, Paid`; per-category roll-up "a later refinement". Unchanged here. |
| `docs/decisions.md:192-195` (OD-BUDGET-3) | Budget write roles: Admin / Executive / Project Manager / Finance. |
| `supabase/migrations/0001_init_schema.sql:165-173` | `budget_line_items`: `org_id`, `budget_version_id`, `category budget_category not null`, `budgeted_amount`, `actual_amount`. No cost-code column. |
| `supabase/migrations/0001_init_schema.sql:111-120` | `procurement_items`: `org_id`, `procurement_id`, `name`, `quantity`, `rate`, generated `amount`. No category or code — lines carry no budget classification today. |
| `supabase/migrations/0243_spend_approval_routing.sql:45-51,526` | Classification lives on the **header**: `procurements.budget_category`, client-writable only while Draft/Rejected, frozen after submit because approval routing was decided on it. |
| `pmo-portal/src/lib/supabase/database.types.ts:15279-15288` | The enum now has 10 values (OD-BUDGET-4's 7 + Special expenses, Travel & accommodation, Vehicle — #804, #1326). |
| `pmo-portal/src/lib/budget/budgetModel.ts:43,75-128` | Committed-by-category is computed client-side: header `budget_category` (null → Uncategorized), committed statuses at :43, summed per category. This is the roll-up the cost code must extend. |
| `supabase/migrations/0859_project_budget_positions.sql:1-90` | Server read of project budget/consumption; budget = Σ Active-version `budget_line_items.budgeted_amount`, category coverage a separate figure. Project totals must not move. |
| `supabase/migrations/0770_dashboard_pmo_positions.sql:16-60` | `project_pmo_positions` — project-level spent/committed. Unchanged. |
| `pmo-portal/src/lib/budget/categoryAccountMap.ts:1-30` | ERP push maps **category → account**, fail-closed on an unmapped non-zero category. The cost code does not enter the push in v1 (OQ-CC-3). |
| `supabase/migrations/0008_project_revenue.sql:1-30` | `pipeline_stage_config` — the sanctioned org-scoped config-table recipe to copy. |
| `pmo-portal/src/auth/policy.ts:60-90` | `can()` entities include `budgetLine`, `budgetVersion`, `procItem`; a new `costCode` entity is added. |
| `pmo-portal/pages/ProjectBudget.tsx:500-525` | Budget summary rows (per category: budget, committed, spent, left). |

## 1. Problem and job story

The 10 budget categories are portfolio-grain. A contractor estimates and controls at a finer grain (discipline,
work package, phase — e.g. `03-300 Cast-in-place concrete`). Today a PM cannot see "how much of the concrete
package is committed" because neither the budget line nor the procurement line carries anything finer than the
category, and the category sits on the procurement header only.

**Job story.** *When I set up a project budget and later raise purchases against it, I want to tag each budget
line and each procurement line with my organization's own cost code, so I can see budget vs committed per code
and catch an overrun on one work package before it hides inside a category total.*

Secondary: *When I administer the organization, I want to maintain one list of cost codes for everyone, so every
project uses the same vocabulary and reports compare across projects.*

## 2. Scope / non-scope

**In scope**
- An org-scoped **cost code list** (code, name, optional parent, optional default category, active/archived).
- An optional `cost_code_id` on **budget line items** and on **procurement line items**.
- A **budget vs committed per cost code** read for one project (Active version), shown on the project budget page.
- Admin maintenance of the list; picker fields on the budget-line and procurement-line forms.

**Out of scope (v1)**
- Replacing or making the `budget_category` enum editable (OD-BUDGET-4 stays locked; codes sit beside it).
- Changing the committed basis, project totals, dashboards or approval routing (header category still routes).
- Cost codes on timesheets, expense claims, work orders, BOQ items (later slices on the same column recipe).
- ERP mapping of cost codes in the budget push or actuals pull (OQ-CC-3).
- CSV import of the code list (OQ-CC-4), a cross-project cost-code report, per-code % complete/EAC.

## 3. Data model (in words)

- **`cost_codes`** (new): `id`, `org_id` (not null, stamped by the existing org-id trigger, ADR-0017 seam),
  `code` (short text, unique per org among non-archived rows, case-insensitive), `name`, `parent_id`
  (nullable self-reference, same org; depth limit per OQ-CC-1), `default_category` (nullable
  `budget_category` — a hint that pre-fills, never a constraint), `sort_order`, `archived_at` (ADR-0018
  soft-archive), `created_at/by`, `updated_at`. RLS forced; history via the record-change-history recipe.
- **`budget_line_items.cost_code_id`** — nullable FK → `cost_codes`, same-org enforced. Category stays required.
- **`procurement_items.cost_code_id`** — nullable FK → `cost_codes`, same-org enforced. Writable on the same
  status window as the line itself; frozen with the line once the procurement is committed.
- Referenced codes FK-block hard delete (23503 → "in use"); archive is the normal retirement path.
- **Roll-up**: per project, Active budget version, group by cost code: budget = Σ line `budgeted_amount`;
  committed = Σ `procurement_items.amount` of procurements in the OD-BUDGET-2 committed statuses; lines with no
  code form an **Uncoded** row so the per-code totals always sum to the project totals. A parent's figures
  include its descendants. Computed server-side as an invoker read (RLS of each source applies), decimal-string
  money like `project_budget_positions`.

## 4. Functional requirements (EARS)

- **FR-CC-001** The system shall store cost codes per organization, each with a code, a name, an optional
  parent, an optional default category and an archived state.
- **FR-CC-002** When an Admin creates or renames a cost code, the system shall reject a code that duplicates a
  non-archived code in the same organization, ignoring case.
- **FR-CC-003** When an Admin archives a cost code, the system shall keep it on existing budget and procurement
  lines and remove it from pickers for new selections.
- **FR-CC-004** If a delete targets a cost code referenced by any line, then the system shall refuse it with an
  "in use" message and offer archive.
- **FR-CC-005** Where a parent is set, the system shall reject a parent that is in another organization, is the
  code itself or a descendant, or exceeds the allowed depth.
- **FR-CC-006** When a budget editor adds or edits a Draft budget line, the system shall offer an optional cost
  code picker listing the organization's active codes.
- **FR-CC-007** When a cost code with a default category is chosen on a budget line whose category is empty,
  the system shall pre-fill that category; the user may change it.
- **FR-CC-008** While a budget version is Active or Archived, the system shall not allow its lines' cost codes to
  change (OD-BUDGET-5 A: revise via clone; the clone copies cost codes).
- **FR-CC-009** When a procurement editor adds or edits a line on a procurement that is still client-editable,
  the system shall offer an optional cost code picker.
- **FR-CC-010** While a procurement is in a committed status, the system shall not allow a line's cost code to
  change.
- **FR-CC-011** When a user with budget-read permission opens the project budget page and the organization has
  at least one cost code, the system shall show budget, committed and left per cost code for the Active version,
  plus an Uncoded row.
- **FR-CC-012** The per-cost-code totals shall sum exactly to the project's budget and committed totals shown
  elsewhere on the page.
- **FR-CC-013** Where a code has children, the system shall show its figures as the sum of itself and its
  descendants, with children expandable beneath it.
- **FR-CC-014** If an organization has no cost codes, then the system shall show the budget page exactly as
  today, with no empty cost-code section.

## 5. Non-functional requirements

- **NFR-CC-001 (tenancy)** `cost_codes` carries `org_id` stamped server-side; the client never sends it. RLS is
  enabled and forced; every read and write is scoped to the caller's active-member organization.
- **NFR-CC-002 (cross-org integrity)** A line may reference only a cost code of its own organization, enforced
  in the database (trigger or composite FK), not only in the UI.
- **NFR-CC-003 (write roles)** Cost-code list writes: Admin only (org-wide vocabulary; OQ-CC-5). Line tagging:
  the existing `budgetLine` and `procItem` write roles. Reads: every active member.
- **NFR-CC-004 (UX gating)** Every create/edit/archive affordance is gated with `can(action, 'costCode', ctx)`
  / `<CanWrite>` on the real JWT role; impersonation is view-only. RLS remains the enforcement authority.
- **NFR-CC-005 (money)** Roll-up money is decimal-string end-to-end; no float summation. Project totals from
  `project_budget_positions` and `project_pmo_positions` are unchanged by this feature.
- **NFR-CC-006 (reversible)** Each migration ships a rollback under `supabase/migrations/rollback/`.
- **NFR-CC-007 (performance)** The roll-up is one set-based query per project; indexes on
  `(org_id, code)`, `budget_line_items(cost_code_id)`, `procurement_items(cost_code_id)`.
- **NFR-CC-008 (i18n)** All labels in en and id; codes and names are user data, never translated.

## 6. Acceptance criteria (Given/When/Then, with owning layer)

| AC | Given / When / Then | Owning layer |
|---|---|---|
| **AC-CC-001** | Given org A and org B each with cost codes, When a member of A lists cost codes, Then only A's codes are returned, and an insert by A that sends B's `org_id` lands in A. | pgTAP |
| **AC-CC-002** | Given a Project Manager (non-Admin), When they insert, update or archive a cost code, Then RLS refuses it; an Admin succeeds. | pgTAP |
| **AC-CC-003** | Given a budget line in org A, When it is set to org B's cost code, Then the write is rejected; the same for a procurement line. | pgTAP |
| **AC-CC-004** | Given code `03-300` exists, When an Admin creates `03-300` again in any case, Then it is rejected; after archiving the first, the create succeeds. | pgTAP |
| **AC-CC-005** | Given a code referenced by a budget line, When an Admin deletes it, Then the delete is refused as "in use" and archive is offered. | Unit (classifyMutationError + UI) with pgTAP for the FK |
| **AC-CC-006** | Given a parent chain, When an Admin sets a code's parent to its own descendant or beyond the depth limit, Then it is rejected. | pgTAP |
| **AC-CC-007** | Given an Active budget version, When its line's cost code is updated, Then the write is refused; a cloned Draft keeps every line's cost code. | pgTAP |
| **AC-CC-008** | Given a procurement in Ordered, When its line's cost code is updated, Then the write is refused; in Draft it succeeds. | pgTAP |
| **AC-CC-009** | Given lines coded A (100.00), A.1 child (50.00) and uncoded (25.00), and a committed procurement line coded A.1 (40.00) plus a Draft one (999.00), When the roll-up runs, Then A shows budget 150.00 / committed 40.00, Uncoded 25.00 / 0.00, totals 175.00 / 40.00 equal the project totals, and the Draft line is excluded. | pgTAP (roll-up read) |
| **AC-CC-010** | Given the roll-up result, When the budget page renders, Then it shows one row per code with expandable children, an Uncoded row, and the left figure; with no codes in the org the section is absent. | Unit (RTL) |
| **AC-CC-011** | Given a code with default category Materials, When a user picks it on a new budget line with no category, Then category pre-fills to Materials and remains editable. | Unit (RTL) |
| **AC-CC-012** | Given an archived code, When a user opens the budget-line or procurement-line picker, Then the archived code is not offered, but a line already holding it still shows it. | Unit (RTL) |
| **AC-CC-013** | Given a Viewer or an impersonated session, When they open the cost-code admin screen or a line form, Then no create/edit/archive control is offered. | Unit (policy + RTL) |
| **AC-CC-014** | Given an Admin, When they create a cost code, tag a budget line and a procurement line with it, and the procurement reaches Ordered, Then the project budget page shows that code's committed amount. | E2E (one curated cross-stack journey, `e2e/AC-CC-014-cost-code-committed.spec.ts`) |

## 7. Traceability and risks

- OD-BUDGET-4 stays locked: codes are an additional dimension. A later decision may make codes the primary
  axis; the nullable FK keeps that open without a rewrite.
- Header `procurements.budget_category` still decides approval routing (0243); a line's code does not. A code's
  default category disagreeing with the header category is shown, not blocked (OQ-CC-6).
- `docs/glossary.md` gains "Cost code" and "Uncoded"; `docs/decisions.md` records the OD-BUDGET-4 seam opening
  at build time.

## 8. Rollout slices (for eng-planner)

1. `cost_codes` table + RLS + rollback + pgTAP (AC-001/002/004/006). 2. FKs on both line tables + freeze rules
(AC-003/007/008). 3. Admin list screen + `costCode` policy entity (AC-005/012/013). 4. Pickers on line forms
(AC-011). 5. Roll-up read + budget page section (AC-009/010) — money tier. 6. E2E journey (AC-014).

## 9. Owner questions (default taken if unanswered)

| # | Question | Default |
|---|---|---|
| **OQ-CC-1** | Hierarchy depth: flat, two levels, or unlimited? | Up to **3 levels** (division → section → item), enforced in the DB. |
| **OQ-CC-2** | Required or optional on lines? Should an org be able to switch "required" on? | **Optional** in v1; a per-org "required" switch is a later setting. |
| **OQ-CC-3** | ERP mapping: should a cost code map to an ERP account / analytic dimension in the budget push and actuals pull? | **No in v1.** The push stays category → account (`categoryAccountMap.ts`). Codes are PMO-side only until the ERP route asks for them. |
| **OQ-CC-4** | Import: bulk-load a code list (CSV / paste rows, like budget paste-rows)? | **Paste-rows import in a follow-up slice**; v1 is manual entry. |
| **OQ-CC-5** | Who maintains the list: Admin only, or also Finance/Executive? | **Admin only.** |
| **OQ-CC-6** | Should a code's default category constrain the line's category (or the procurement header's)? | **No** — a pre-fill hint only. |
| **OQ-CC-7** | Per-project subsets: may a project restrict which codes it uses? | **No in v1**; every active org code is offered. |
| **OQ-CC-8** | Should actuals (spent), not only committed, roll to the code? | **Committed only in v1** — PMO spent follows the same procurement lines, so it can follow in the same read once ERP-sourced actuals are decided (OQ-CC-3). |
