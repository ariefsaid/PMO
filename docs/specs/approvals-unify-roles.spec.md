# Approvals: one approver-role constant, one route-cascade helper, no orphans

Issue #1072 (map #791). Status: **Draft, 2026-11-15** — awaiting owner sign-off of the questions in the plan.
Executor on sign-off: Orca worker (`docs/orca-dispatch.md`). Frontend-only, no migration, no SoD or authority change.

**Job story.** When an approver role is added or a routing rule changes, I want one place to change in the
frontend, so that the approvals page, the spend-approver settings and the badge counts cannot disagree.

## 1. AS-IS (read at `origin/dev`)

1. **Review queue.** `pmo-portal/pages/Approvals.tsx` already lists procurement, timesheets, expense claims
   (`ExpenseClaimApprovalSection`), imprest top-ups, and customer invoices (`SalesInvoiceApprovalSection`) under
   `scope=all|procurement|timesheets|expense|invoice`. The ticket's first item (S-18 unified only two queues) is
   **stale for these kinds**. Supplier-side invoices have no approval step in the portal today (to verify in Task 1).
2. **Role list, hand-written.** The set Admin/Executive/Finance/Project Manager is spelled out in:
   `pages/Approvals.tsx:64`, `src/components/shell/ApprovalsNavCount.tsx:45`,
   `src/components/dashboard/restructure/useNeedsYou.ts:295`, `src/auth/policy.ts` (`EQUIPMENT_APPROVE`),
   `src/lib/procurement/approvalRoute.ts` (`APPROVER_RANK_ROLES`), `src/lib/expenses/expenseRules.ts` and
   `src/lib/imprest/imprestRules.ts` (`APPROVAL_RANK`), `pages/procurement/blocks/needsYou.ts:54`. The database
   side is `role_rank` (migration 0178, ADR-0070). `SpendApprovers.tsx` already derives its eligible list from
   `can('transition','procurement')`, not from a list of its own.
3. **Cascade twice.** `pages/admin/SpendApprovers.tsx` `renderRoute` re-implements the `spend_approval_route`
   fallback (project list → senior set → Admin → flat rules, DD-APR-4); `src/lib/procurement/approvalRoute.ts` is
   per-request.
4. **Orphans.** `ApprovalsQueue` (the page component) in `pages/timesheets/ApprovalsQueue.tsx` has no production
   importer (only `TimesheetApprovalPreview` is used by `Approvals.tsx`); seven `ApprovalsQueue.*.test.tsx` files
   under `pages/timesheets/__tests__/` cover it. `ProcurementApprovalSection` no longer exists; only a comment in a
   test names it.

   `src/auth/coarseRoles.ts` already exists (`ALL_ROLES`, `MASTER_DATA_ROLES`, `REVENUE_WRITE_ROLES` — the middle
   one already spells the same four roles); the new constant joins them there rather than in a new file.

## 2. Requirements (EARS)

- **FR-1** The system shall define the spend-approval-rank role set once, as an exported constant in
  `src/auth/coarseRoles.ts`, and every listed hand-written copy shall import it.
- **FR-2** When the constant differs from the database's `role_rank` ordering (rank at or above Project Manager),
  the pgTAP suite shall fail.
- **FR-3** The system shall provide one pure helper in `src/lib/procurement/approvalRoute.ts` that resolves the
  route kind (`project | org | admin | flat`) from the project list, the senior list and an "is eligible" predicate;
  `SpendApprovers.tsx` shall use it in place of its inline cascade.
- **FR-4** The spend-approver screen shall display exactly the notes it displays today for every combination of
  lists and eligibility (no visible change).
- **FR-5** The `ApprovalsQueue` page component, its seven test files and any now-unused exports shall be deleted;
  `TimesheetApprovalPreview` and its behaviour tests shall remain.
- **FR-6** Where a pending approval kind is missing from the unified queue (found in Task 1), the system shall add
  it as a scope with the same section pattern; if none is missing this requirement is satisfied by a recorded audit.

## 3. Acceptance criteria

- **AC-1** Given a role added to the constant, when the app builds, then the approvals page, nav count, needs-you
  block, expense and imprest rules all treat it as an approver (one-line change).
- **AC-2** Given each of the five roles, when the nav count and the approvals page compute `canApproveExpenses`,
  then both agree with `isApprovalRankRole(role)`.
- **AC-3** Given the migration set at head, when pgTAP compares `role_rank(r) >= role_rank('Project Manager')` over
  all roles with the TS list, then they are equal.
- **AC-4** Given empty project list, empty senior list: `flat`. Given project list with nobody eligible and senior
  list with an eligible member: `org`. Senior list set but nobody eligible: `admin`. Project list with an eligible
  member: no escalation note.
- **AC-5** Given the same inputs as AC-4, when `SpendApprovers` renders, then the shipped notes (`spend-route-org`,
  `spend-route-project`) are unchanged (existing `SpendApprovers*.test.tsx` stay green untouched).
- **AC-6** Given the repo after the change, when searching for `<ApprovalsQueue`/`ApprovalsQueue }` importers,
  then none exists and `npm run typecheck` passes.
- **AC-7** Given a viewer who can approve at least one unlisted kind, when opening `/approvals?scope=all`, then that
  kind's section is present (only if Task 1 finds one).

## 4. Out of scope

Authority changes, SoD rules, `role_rank` values, route resolution on the server, new roles.
