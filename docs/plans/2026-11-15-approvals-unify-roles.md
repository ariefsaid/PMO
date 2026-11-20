# Approvals unify and role de-duplication — plan

**Spec:** `docs/specs/approvals-unify-roles.spec.md` (issue #1072). Frontend + one pgTAP file. No migration
(if one proves needed: `NNNN` — number on request). Run from `pmo-portal/`.

**Global constraints:** no change to who can approve; `can()` stays UX-only; SoD untouched. Local gate: `npm run
check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched vitest files only.

## Tasks

1. **Audit (2 min).** `grep -rn "'Admin', 'Executive'" src pages`; list supplier-side invoice approval surfaces
   (`grep -rni "invoice" pages/Approvals.tsx src/hooks | head`). Record findings in the PR body; decides FR-6/AC-7.
2. **Constant (3 min).** Add to `src/auth/coarseRoles.ts`:
   `export const APPROVAL_RANK_ROLES = ['Admin','Executive','Finance','Project Manager'] as const;` and
   `export const isApprovalRankRole = (r?: string|null) => (APPROVAL_RANK_ROLES as readonly string[]).includes(r ?? '');`
   Test `src/auth/coarseRoles.test.ts` (AC-1, AC-2): list contents and predicate for all five roles + null.
3. **Swap copies (5 min each, 4 commits).** Replace the literals in `Approvals.tsx`, `ApprovalsNavCount.tsx`,
   `useNeedsYou.ts`, `procurement/blocks/needsYou.ts`, then `approvalRoute.ts`, `expenseRules.ts`, `imprestRules.ts`,
   `policy.ts` `EQUIPMENT_APPROVE` (`[...APPROVAL_RANK_ROLES]`). Existing tests of each file are the proof (green
   unchanged). Verify: `npx vitest run <each touched .test file>`.
4. **pgTAP parity (4 min).** `supabase/tests/approver_roles_parity.test.sql` asserting the set of `user_role`
   values with `role_rank(r) >= role_rank('Project Manager')` equals the TS list literal (AC-3). Verify:
   `scripts/with-db-lock.sh supabase test db supabase/tests/approver_roles_parity.test.sql`.
5. **Cascade helper (5 min).** In `approvalRoute.ts` add
   `resolveConfiguredRoute({projectRows, orgRows, isEligible}): 'project'|'org'|'admin'|'flat'` (pure). Unit tests
   for the four AC-4 cases in `approvalRoute.test.ts` first (red), then implement.
6. **Use it (5 min).** Replace the inline `senior` computation and branch ladder in `SpendApprovers.tsx`
   `renderRoute` with the helper; keep the JSX. Verify: `npx vitest run pages/admin/SpendApprovers.test.tsx
   pages/admin/SpendApprovers.floor.test.tsx` unchanged and green (AC-5).
7. **Delete orphans (4 min).** Remove `ApprovalsQueue` from `pages/timesheets/ApprovalsQueue.tsx` (keep
   `TimesheetApprovalPreview` and what it needs) and the tests `ApprovalsQueue.{classify,decisions,disclosure,
   expand-bulk,loading,projectLink,rbac}.test.tsx` after moving any behaviour test that exercises the Preview into
   a `TimesheetApprovalPreview.*.test.tsx`; update the stale comment in `Timesheets.test.tsx` if needed. Verify:
   `npm run typecheck && npx eslint --max-warnings=0 pages/timesheets` (AC-6).
8. **Missing queue (only if Task 1 finds one).** Add the section following `ExpenseClaimApprovalSection`; unit test
   plus a curated e2e extension of `e2e/serial/AC-IXD-PROC-W5-3-approvals-inbox.spec.ts` (AC-7).

## Traceability (ADR-0010)

| AC | Owning layer | Test |
|---|---|---|
| AC-1, AC-2 | Unit | `src/auth/coarseRoles.test.ts` |
| AC-3 | pgTAP | `approver_roles_parity.test.sql` |
| AC-4 | Unit | `approvalRoute.test.ts` |
| AC-5 | Unit | existing `SpendApprovers*.test.tsx` |
| AC-6 | Typecheck/lint | `npm run typecheck` |
| AC-7 | E2E (conditional) | `AC-IXD-PROC-W5-3` extension |

## Owner questions

1. Ticket item 1 looks already shipped (expense, imprest, customer invoices are in `/approvals`); close it unless Task 1 finds a supplier-invoice gap? Recommend: yes.
2. Put the constant in `coarseRoles.ts` (beside `MASTER_DATA_ROLES`) rather than `policy.ts`? Recommend: yes.
3. Delete the seven `ApprovalsQueue.*` tests, keeping only Preview behaviour coverage? Recommend: yes.
