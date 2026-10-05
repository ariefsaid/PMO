# Feature: Approval routing by budget (#803)

> **Status:** Draft for Director sign-off (2026-10-06). Plan: `docs/plans/2026-10-06-approval-routing-by-budget.md`.
> ADR: `docs/adr/0075-spend-approval-routing.md`.
> **Grounds (read, not re-derived):** `docs/decisions.md` OD-PROC-1 (flat role matrix; SoD requester ≠ approver,
> approver ≠ payer; Admin break-glass), OD-PROC-6 (the config seam this fills: "later swappable for a config-driven
> version reading a per-org config table"), OD-PROC-8 (SoD outside the Admin skip), OD-BUDGET-1 (budget = Active
> version line items), OD-BUDGET-2 (Committed basis), ADR-0034 (Reserved basis), ADR-0016 (`can()` is UX only),
> ADR-0019 (server-enforced SoD), ADR-0070 (approval authority is rank, not an enumerated role list).
> **Current server authority:** `transition_procurement` as last defined in
> `supabase/migrations/0180_rpc_active_member_gate.sql` (active-member gate + SoD-a/SoD-b + role matrix).

## 1. Job story

When a purchase request is waiting for approval, I want it to reach the right person automatically — the
project's named approver if the spend is charged to a project and fits that project's budget line, otherwise a
small named set of senior approvers — so that over-budget and overhead spend always gets a senior signature and
routine project spend does not queue behind them.

## 2. The rule (owner, 2026-10-05)

| Spend | Approved by |
|---|---|
| Charged to a project **and** within that project's active budget line | the project's named approver |
| Overhead (no project) **or** would exceed the project's budget line | the org's overhead/over-budget approver set (two named people today) |

Applies to procurement requests now. Expense claims (#775) reuse the same rule (§7).

## 3. Decisions (Director proposals — `DD-` until the Director records them in `docs/decisions.md`)

- **DD-APR-1 — One signature from the set.** When a request routes to a set of named approvers, **any one** of
  them approving (or rejecting) decides it. No second signature, no sequence. (The open question in the go-live
  handoff, "one approver or both in sequence", is answered "either one" by Director ruling; the owner may revisit.)
- **DD-APR-2 — "Within budget" is evaluated at approve time, per category line.** Basis, reusing shipped
  definitions rather than inventing one:
  - *line budget* = Σ `budgeted_amount` of the project's **Active** budget version line items in the request's
    budget category, across all fiscal years (OD-BUDGET-1; project-lifetime grain, same as OD-BUDGET-2).
  - *line used* = Σ request amount of the **other** procurements on the same project + category whose status is
    Reserved (`Approved`, `Vendor Quoted`, `Quote Selected` — ADR-0034) or Committed (`Ordered`, `Received`,
    `Vendor Invoiced`, `Paid` — OD-BUDGET-2). The request being decided is `Requested`, so it is never in its own sum.
  - *request amount* = the greater of the header `total_value` and the sum of its line-item amounts. Header-only
    is unsafe: a request raised in the app carries its value on its line items while `total_value` stays 0 until a
    quote is selected, so header-only would route a large request as "within budget". Taking the greater can only
    route **up** to the senior set, never down.
  - *within* ⇔ `line used + request amount ≤ line budget`.
  - It **cannot** be within (routes to the senior set) when: the request has no budget category; the project has
    no Active budget version; the request's currency, or the currency of any spend already on the line, differs
    from the Active version's currency.
- **DD-APR-3 — Missing or unusable configuration.** Routing narrows OD-PROC-1; it never widens it.
  - Nobody configured for the route's set → the OD-PROC-1 flat matrix applies, exactly as today.
  - Project approver(s) configured but none **eligible** (the only one is the requester, is no longer active, or no
    longer holds approval rank) → escalate to the senior set.
  - Senior set configured but none eligible → the flat matrix applies.
  - *Eligible* = active member of the org (`profiles.status = 'active'`), holds approval rank (role rank ≥
    Project Manager, ADR-0070), and is not the requester.
- **DD-APR-4 — Reject follows the same route as Approve.** OD-PROC-1 pairs them; a person who may not approve a
  routed request may not reject it either.
- **DD-APR-5 — Admin break-glass is kept** (OD-PROC-1 is owner-locked: "Admin = break-glass"). An Admin may still
  decide a routed request from the request page; SoD-a still applies; the audit row records `break_glass = true`.
  A routed request does not appear in an Admin's "awaiting you" lists unless they are named.
- **DD-APR-6 — Routing inputs are fixed once submitted.** After a request leaves Draft (and until it is sent back to
  Draft from Rejected), a client may not change its project, budget category or header total. Server-side paths
  that set the total from a selected quote are unaffected and do **not** re-route (see owner question Q1).
- **DD-APR-7 — Configuration lives in one table, Admin-only.** `spend_approvers(org_id, project_id null|uuid,
  profile_id)`: a row with a project names an approver for that project; a row without a project names a member of
  the org's senior set. Any number of people per set; the client names one per project and two for the senior set.

## 4. Functional requirements (EARS)

### Configuration
- **FR-APR-001** The system shall store spend approvers as rows of `public.spend_approvers` (`org_id`,
  `project_id` nullable, `profile_id`), unique per (`org_id`, `project_id`, `profile_id`) with NULLs not distinct.
- **FR-APR-002** When a caller who is not an active Admin of the org inserts or deletes a `spend_approvers` row,
  the system shall refuse it. While a caller is an active member of the org, the system shall let them read the
  org's rows. No caller may update a row (remove and re-add instead).
- **FR-APR-003** When a `spend_approvers` row is inserted, the system shall require the named profile to belong to
  the caller's org, be active, and hold approval rank (≥ Project Manager), and the project (if any) to belong to the
  caller's org. `org_id` shall be stamped from the caller (never sent by the client); `created_by` shall default to
  the caller and shall not be client-writable.
- **FR-APR-004** When a `spend_approvers` row is inserted or deleted, the system shall write an `audit_events` row
  (`spend_approver.add` / `spend_approver.remove`) naming the actor, the project (or none) and the profile.
- **FR-APR-005** The system shall add a nullable `procurements.budget_category` (the existing `budget_category`
  enum) that a client may set on create and while the request is Draft or Rejected.

### Routing (server — `transition_procurement`)
- **FR-APR-010** When a procurement moves `Requested → Approved` or `Requested → Rejected`, the system shall
  classify it with exactly one reason: `no_project`, `no_category`, `no_active_budget`, `currency_mismatch`,
  `exceeds_line` or `within_budget`, per DD-APR-2.
- **FR-APR-011** The system shall compute line budget, line used and request amount exactly as DD-APR-2 states.
- **FR-APR-012** When the reason is `within_budget`, the system shall route to the project's eligible approvers;
  otherwise it shall route to the org's eligible senior set (eligibility per DD-APR-3).
- **FR-APR-013** While the project has no `spend_approvers` row and the reason is `within_budget`, the system shall
  apply the OD-PROC-1 flat matrix (route `flat`).
- **FR-APR-014** While the project has rows but no eligible approver and the reason is `within_budget`, the system
  shall route to the senior set (route `org`, reason still `within_budget`).
- **FR-APR-015** While the senior set has no eligible member when it is the target, the system shall apply the
  flat matrix (route `flat`).
- **FR-APR-016** When the route is `project` or `org` and the caller is not an Admin and not in the eligible set,
  the system shall refuse with SQLSTATE `42501` and the message `approval routing: <reason> requires a named
  approver`. SoD-a (requester ≠ approver), the active-member gate and the OD-PROC-1 role matrix shall still apply,
  unchanged and in their current order.
- **FR-APR-017** Where the caller is an Admin, the system shall allow the decision regardless of route (DD-APR-5).
- **FR-APR-018** When two approvals on the same project + category line run concurrently, the system shall
  serialize their classification (a transaction-scoped lock keyed on the line) so both cannot fit the same headroom.
- **FR-APR-019** When a `Requested → Approved|Rejected` transition succeeds, the system shall write an
  `audit_events` row `procurement.approval_route` with `to`, `route`, `reason`, `request_amount`, `line_budget`,
  `line_used`, `budget_category`, `break_glass`.
- **FR-APR-020** While a procurement's status is neither Draft nor Rejected, the system shall refuse a change to
  `project_id`, `budget_category` or `total_value` by any caller subject to RLS, with SQLSTATE `42501` and the
  message `procurements.<column> cannot change after the request is submitted: approval routing was decided on it`.
  Server-side (RLS-bypassing) writers such as quote selection are unaffected.
- **FR-APR-021** The system shall expose `get_procurement_approval_routes(p_ids uuid[])` (SECURITY INVOKER) that
  returns, for each listed procurement the caller can see that is `Requested`: route, reason, approvers (id +
  name), request amount, line budget, line used — computed by the same function `transition_procurement` uses.

### Front end (UX only — the server is the authority, ADR-0016)
- **FR-APR-030** The procurement detail page shall offer Approve/Reject only when the existing gates hold **and**
  the route is absent or `flat`, or the viewer is in its approvers, or the viewer's real role is Admin.
- **FR-APR-031** When a routed request's approvers do not include the viewer (and the viewer is not the
  requester), the detail page shall show one line naming the approvers and the reason.
- **FR-APR-032** The "awaiting you" lists (Approvals inbox, procurement approval section, dashboard counts) shall
  include a `Requested` request only if it is routed `flat` (or has no route) or names the viewer.
- **FR-APR-033** The new-request form and the Draft header edit shall offer an optional **Budget category** select
  (the `budget_category` values plus "No category").
- **FR-APR-034** Administration › Accounting shall show **Spend approvers**: the senior set and the project
  approvers, with add/remove for Admins and a read-only view for everyone else.
- **FR-APR-035** While a request's route cannot be read (not loaded, or the read failed), the UI shall fall back to
  the existing role-matrix gate. Rationale: the server enforces either way; hiding every action on a transient read
  failure would block legitimate approvers for nothing.

### Seams
- **FR-APR-040 (#788 notification seam)** The recipients of "a purchase request awaits approval" shall be the
  `approver_ids` returned by `public.spend_approval_route` (or, for route `flat`, the OD-PROC-1 role population).
  This issue writes no notification code; #788 calls that function rather than re-deriving the rule.
- **FR-APR-041 (#775 reuse seam)** `public.spend_approval_route(org, project, category, amount, currency,
  requester)` takes no procurement-specific argument. #775 calls it for an expense claim with the claim's own
  values, and extends **only that function's** "line used" sum to include claims in their approved/paid states.

## 5. Non-functional requirements
- **NFR-APR-001 (tenancy)** No client sends `org_id`. `spend_approvers` has FORCE RLS, the seed-org column default
  plus `stamp_org_id` trigger (0074 idiom), and every policy gates `is_active_member()` (0203 composition rule).
- **NFR-APR-002 (reversible)** One migration, with a written statement-by-statement reverse in its header.
- **NFR-APR-003 (performance)** List and detail reads resolve routes for all `Requested` rows on the page in one
  extra RPC round trip (no N+1). Classification cost is bounded by the procurements on one (project, category)
  line, reached through the existing `procurements_project_idx`.
- **NFR-APR-004 (no new definer surface)** The new functions are SECURITY INVOKER; no new SECURITY DEFINER RPC is
  client-callable (the 0178 allow-list is unchanged). Only trigger functions are definer, with EXECUTE revoked.
- **NFR-APR-005 (a11y)** The routing note is text, not colour; it sits in the same decision strip as the SoD hint.

## 6. Acceptance criteria (Given/When/Then) — each owned by one test

pgTAP files live in `supabase/tests/`; unit tests in `pmo-portal/`.

**Configuration — `spend_approvers_config.test.sql`**
- **AC-APR-016** *Given* org A with an Admin, a PM, a Finance user and an Engineer, *when* the Admin adds the
  Finance user to the senior set and the PM as a project approver, *then* both succeed and the rows' `org_id` is
  org A; *when* the PM tries to add, or the Admin names the Engineer, a profile from org B, a project from org B,
  or sets `created_by`, *then* each is refused (42501); *when* the PM reads, *then* they see the rows; *when* the
  PM deletes, *then* nothing is deleted. (FR-APR-001/002/003)
- **AC-APR-017** *Given* an Admin adds then removes an approver, *then* `audit_events` holds
  `spend_approver.add` and `spend_approver.remove` with the Admin as actor and the profile in `detail`. (FR-APR-004)
- **AC-APR-020** *Given* org B's Admin, *when* they read `spend_approvers`, *then* org A's rows are invisible.
  (NFR-APR-001)

**Classification — `spend_approval_classify.test.sql`** (via `get_procurement_approval_routes`, as a PM)
- **AC-APR-006** *Given* a Labor line of 300 with one `Approved` (100) and one `Paid` (100) procurement on it,
  *when* a 150 Labor request is classified, *then* reason `exceeds_line`, route `org`, line used 200. (DD-APR-2)
- **AC-APR-007** *Given* an Equipment line of 1000 and a request whose header total is 100 but whose line items sum
  to 1200, *then* request amount 1200 and reason `exceeds_line`. (DD-APR-2)
- **AC-APR-011** *Given* a project request with no budget category and a configured senior set, *then* reason
  `no_category`, route `org`. (FR-APR-010)
- **AC-APR-012** *Given* an Active version in the org currency and a request in another currency, *then* reason
  `currency_mismatch`. (FR-APR-010)
- **AC-APR-019** *Given* Materials lines of 1000 (FY A) and 500 (FY B) and a 600 Materials request on a project
  with a named approver, *then* route `project`, reason `within_budget`, line budget 1500, approvers = that person;
  an overhead request routes `org` with both senior-set names; an `Approved` id returns no row; an org-B caller
  passing org-A ids gets no rows. (FR-APR-011/012/021)

**Enforcement — `spend_approval_enforce.test.sql`** (via `transition_procurement`)
- **AC-APR-001** *Given* a within-budget request on a project whose named approver is PM-A, *when* PM-A approves,
  *then* it succeeds and `approved_by_id` = PM-A. (FR-APR-012)
- **AC-APR-002** *Given* the same kind of request, *when* PM-B (approver rank, not named) approves, *then* 42501
  `approval routing: within_budget requires a named approver`. (FR-APR-016) — *mutation-worthy*
- **AC-APR-003** *Given* a request that would exceed the line, *when* the project approver approves, *then* 42501
  `approval routing: exceeds_line requires a named approver`; *when* a senior-set member approves, *then* it
  succeeds. (FR-APR-012/016)
- **AC-APR-004** *Given* an overhead request, *when* a Finance user outside the senior set approves, *then* 42501
  `approval routing: no_project requires a named approver`. (FR-APR-016)
- **AC-APR-005** *Given* a two-person senior set, *when* the second member alone approves an overhead request,
  *then* it is `Approved` after that one signature. (DD-APR-1)
- **AC-APR-008** *Given* an org with no `spend_approvers` rows, *when* any PM approves a project request, *then* it
  succeeds (flat matrix); *when* an Engineer tries, *then* 42501 `not authorized for transition Requested ->
  Approved` (matrix unchanged). (FR-APR-013)
- **AC-APR-009** *Given* a project whose only named approver raised the request, *when* a Finance user outside the
  senior set approves, *then* 42501 `approval routing: within_budget requires a named approver`; *when* a senior-set
  member approves, *then* it succeeds. (FR-APR-014)
- **AC-APR-010** *Given* a senior set whose only member is disabled, *when* a PM approves an overhead request,
  *then* it succeeds (flat fallback). (FR-APR-015)
- **AC-APR-013** *Given* a routed within-budget request, *when* a non-named PM rejects, *then* 42501; *when* the
  named approver rejects, *then* status `Rejected`. (DD-APR-4)
- **AC-APR-014** *Given* a routed request, *when* an Admin (not named) approves, *then* it succeeds and the audit
  row has `break_glass = true`. (FR-APR-017/019)
- **AC-APR-015** *Given* the approval in AC-APR-001, *then* an `audit_events` row `procurement.approval_route`
  records route `project`, reason `within_budget`, request amount 400, line budget 1000, line used 0. (FR-APR-019)

**Inputs frozen — `spend_approval_inputs_frozen.test.sql`**
- **AC-APR-018** *Given* a `Requested` request, *when* a PM changes its project, budget category or header total,
  *then* each is refused 42501 with the column-named message; *when* the PM changes its title, *then* it succeeds;
  *when* a PM changes the project of a `Draft` request, *then* it succeeds; *when* a quote is selected through
  `select_procurement_quote` on a `Vendor Quoted` request, *then* `total_value` takes the quote amount. (FR-APR-020)

**Concurrency — `spend_approval_line_lock.test.sql`**
- **AC-APR-021** *Given* a second session holding the line's lock, *when* the named approver approves a request on
  that line under a 200 ms `lock_timeout`, *then* it fails 55P03; *when* the other session ends, *then* the same
  approval succeeds. (FR-APR-018) — *mutation-worthy*

**Front end (Vitest)**
- **AC-APR-030** `src/lib/procurement/approvalRoute.test.ts` — *given* each route shape, *then*
  `mayDecideRoutedApproval` returns: no route → true; `flat` → true; named viewer → true; un-named viewer → false;
  un-named Admin → true; and `approvalRouteNote` names the approvers joined by "or" with the reason sentence.
- **AC-APR-031** `pages/__tests__/ProcurementDetails.approvalRoute.test.tsx` — *given* a `Requested` request routed
  to someone else, *when* a Finance user opens it, *then* no Approve/Reject buttons and the note names the approver;
  *given* it is routed to the viewer, *then* Approve is shown; *given* no route, *then* Approve is shown; *given* an
  un-named Admin, *then* Approve is shown.
- **AC-APR-032** `src/lib/selectors/approvals.test.ts` — *given* requests routed to the viewer, to someone else,
  `flat`, and unrouted, *then* "awaiting you" keeps all but the one routed to someone else.
- **AC-APR-033** `src/lib/db/procurementCrud.budgetCategory.test.ts` — *when* a request is created or its header
  saved with a budget category, *then* `budget_category` is sent and `org_id` is not.
- **AC-APR-034** `pages/admin/SpendApprovers.test.tsx` — *given* an Admin, *then* both sets list and the Admin can
  add a senior-set approver (only approval-rank active people offered) and remove one through a confirm; *given* a
  non-Admin, *then* names show with no add/remove controls.
- **AC-APR-035** `src/lib/db/approvalRoutes.test.ts` — *then* the RPC is called once with the `Requested` ids only,
  rows map to `ApprovalRoute`, no ids means no call, and a failed call leaves rows unrouted (FR-APR-035).
- **AC-APR-036** `src/lib/db/spendApprovers.test.ts` — list maps rows; add sends `profile_id`/`project_id` and
  never `org_id`; remove deletes by id; a write that lands nothing throws 42501.
- **AC-APR-037** `pages/procurement/__tests__/budgetCategoryForms.test.tsx` — *when* a user picks "Materials" and
  creates, *then* `onCreate` receives `budgetCategory: 'Materials'`; "No category" omits the field (so the existing
  exact-payload assertions in `NewProcurementModal.test.tsx` and `ProcurementHeaderEdit.test.tsx` stay green);
  *when* the Draft header edit clears a set category, *then* `onSave` receives `budgetCategory: null`.

**Cross-stack (Playwright)**
- **AC-APR-040** `e2e/AC-APR-040-routed-procurement-approval.spec.ts` — *given* a project with a Materials budget,
  a named project approver (the Finance seed user) and an Engineer's within-budget request, *when* the PM seed
  user opens it, *then* they see the note naming the approver and no Approve button; *when* the Finance user opens
  it and approves, *then* the status becomes Approved.

## 7. Reuse contract for #775 (expense claims) and #788 (notifications)
- #775: call `public.spend_approval_route(org_id, project_id, budget_category, amount, currency, requester_id)`
  from the claim's transition RPC with the same refusal + audit block; add claims to the "line used" sum inside
  that one function. Do not copy the rule.
- #788: recipients for "awaits approval" = that function's `approver_ids`, else the flat-matrix population.

## 8. Out of scope
- Re-routing after approval when a selected quote changes the total (owner question Q1).
- Fiscal-year-phased lines (the line is project-lifetime, as OD-BUDGET-2 is).
- Notification delivery (#788). Expense claims (#775).

## 9. Traceability

| AC | Owning layer | Test file |
|---|---|---|
| AC-APR-016, 017, 020 | pgTAP | `supabase/tests/spend_approvers_config.test.sql` |
| AC-APR-006, 007, 011, 012, 019 | pgTAP | `supabase/tests/spend_approval_classify.test.sql` |
| AC-APR-001–005, 008–010, 013–015 | pgTAP | `supabase/tests/spend_approval_enforce.test.sql` |
| AC-APR-018 | pgTAP | `supabase/tests/spend_approval_inputs_frozen.test.sql` |
| AC-APR-021 | pgTAP | `supabase/tests/spend_approval_line_lock.test.sql` |
| AC-APR-030 | Unit | `pmo-portal/src/lib/procurement/approvalRoute.test.ts` |
| AC-APR-031 | Unit (RTL) | `pmo-portal/pages/__tests__/ProcurementDetails.approvalRoute.test.tsx` |
| AC-APR-032 | Unit | `pmo-portal/src/lib/selectors/approvals.test.ts` |
| AC-APR-033 | Unit | `pmo-portal/src/lib/db/procurementCrud.budgetCategory.test.ts` |
| AC-APR-034 | Unit (RTL) | `pmo-portal/pages/admin/SpendApprovers.test.tsx` |
| AC-APR-035 | Unit | `pmo-portal/src/lib/db/approvalRoutes.test.ts` |
| AC-APR-036 | Unit | `pmo-portal/src/lib/db/spendApprovers.test.ts` |
| AC-APR-037 | Unit (RTL) | `pmo-portal/pages/procurement/__tests__/budgetCategoryForms.test.tsx` |
| AC-APR-040 | E2E | `pmo-portal/e2e/AC-APR-040-routed-procurement-approval.spec.ts` |

## 10. Open questions for the owner
- **Q1.** After a request is approved, a selected vendor quote can raise its total. If that pushes the project's
  budget line over, should the request go back for a senior-set signature? *Default built: no — the approval
  stands and the Budget-impact panel shows the overrun.*
- **Q2.** Should an Admin keep the ability to approve a routed request themselves (OD-PROC-1 break-glass), or should
  only the named people be able to? *Default built: Admin keeps it, and every such approval is marked in the audit
  trail.*
