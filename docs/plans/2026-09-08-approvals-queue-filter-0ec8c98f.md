# Issue #591 — Approval queue authority filter

## Design

`supabase/migrations/0164_timesheet_post_submit_unknown_witness.sql` §4 is the authority for the unchanged `transition_timesheet` approve/reject arm.  For a submitted sheet, the viewer is eligible exactly when the viewer is not its owner and one of these is true:

1. the embedded owner's `manager_id` equals the viewer id (regardless of role);
2. the viewer's real role is `Admin` (break-glass); or
3. the viewer's real role is `Executive` and the embedded owner's `manager_id` is `null`.

The DAL will retain the server-side `status = Submitted` and `user_id != selfId` constraints, then apply the same predicate to the returned, RLS-scoped rows before returning them to React Query. It will also recheck `sheet.user_id !== selfId` in the local predicate, so the client-side result preserves SoD even in a mocked or anomalous response. A row without its joined owner is excluded rather than treating an unknown manager as `null`.

`AWAITING_SELECT` will request `owner:profiles!timesheets_user_id_fkey(full_name,manager_id)`. The hook will obtain the real `role` from the existing auth context and pass it with the signed-in id. Because the filtered data varies by role, the awaiting-query key will include that role as well as org and user identity. The repository seam will receive the matching typed signature even though the hook currently calls the DAL directly.

This remains FE/DAL filtering only: no migration, RLS/RPC, auth, `org_id`, route, or UI component changes. RLS and the RPC remain the enforcement authority; the filter prevents a queue row from advertising an action the RPC will reject. Manager reads remain naturally bounded by existing RLS. Admin/Executive RLS can return the org's submitted set before this client predicate; this issue deliberately does not alter the server query surface.

No ADR is required: this is a local read-model correction that directly implements the owner-locked OD-TS-5 rule and does not create an architectural or irreversible decision.

## Acceptance traceability

| AC | Owner | Proof |
| --- | --- | --- |
| AC-903 | Unit | `pmo-portal/src/lib/db/timesheetTransition.test.ts` owns the refined queue selection, embedded manager field, authority predicate, and SoD result; `pmo-portal/src/hooks/useTimesheetApproval.test.ts` and `pmo-portal/src/lib/repositories/index.test.ts` verify parameter/key/delegation plumbing. |

## Implementation tasks

### 1. Add the failing DAL authority-filter tests (AC-903)

**Files:** `pmo-portal/src/lib/db/timesheetTransition.test.ts`

1. Extend the `listTimesheetsAwaitingApproval` test fixtures so each returned row has `user_id`, an owner `{ full_name, manager_id }`, and entries with numeric-string hours.
2. Before changing production code, add independently named AC-903 tests which call `listTimesheetsAwaitingApproval(selfId, viewerRole)` and assert returned ids for all owner-locked cases:
   - a Project Manager receives only the row whose owner's `manager_id` is that manager id;
   - an Executive receives only the null-manager row, not rows assigned to either manager;
   - an Admin receives every other user's submitted row across assigned and null-manager owners, but not a raw self row supplied by the mock;
   - a non-assignee Project Manager receives no rows.
3. Update the existing shape/query assertion to require `owner:profiles!timesheets_user_id_fkey(full_name,manager_id)`, preserve assertions for `status = Submitted`, `.neq('user_id', selfId)`, ordering, numeric-hour normalisation, and no `org_id`.
4. Add the fail-closed joined-owner edge assertion: an otherwise null-manager-looking row with `owner: null` is not returned to an Executive.
5. Run the focused test and confirm it is red because the current select omits `manager_id`, the current function has no role-aware filter, and it does not locally defend SoD:

```bash
cd pmo-portal && npm test -- src/lib/db/timesheetTransition.test.ts
```

### 2. Add the failing hook and repository plumbing tests (AC-903)

**Files:** `pmo-portal/src/hooks/useTimesheetApproval.test.ts`, `pmo-portal/src/lib/repositories/index.test.ts`

1. In the existing awaiting-hook test, retain the real auth-context role in the mock and change the expected DAL invocation to `listTimesheetsAwaitingApproval('u1', 'Project Manager')`.
2. Assert the query cache has the exact role-scoped key `['timesheets-awaiting', 'org-1', 'u1', 'Project Manager']`, preventing results calculated for one real role from being reused after an auth-context role change.
3. In the repository delegation test, call `repositories.timesheet.listAwaitingApproval('u1', 'Project Manager')` and expect the DAL to receive both arguments. Do not add an `org_id` argument.
4. Run these focused tests and confirm they are red before implementation because the hook/repository currently forward only the viewer id and the key omits role:

```bash
cd pmo-portal && npm test -- src/hooks/useTimesheetApproval.test.ts src/lib/repositories/index.test.ts
```

### 3. Implement the typed authority-aligned read path and make the focused tests green (AC-903)

**Files:** `pmo-portal/src/lib/db/timesheetTransition.ts`, `pmo-portal/src/hooks/useTimesheetApproval.ts`, `pmo-portal/src/lib/repositories/types.ts`, `pmo-portal/src/lib/repositories/index.ts`

1. In `timesheetTransition.ts`, derive and export a viewer-role type from `Tables<'profiles'>['role']`; extend `TimesheetAwaitingApproval.owner` to `{ full_name: string; manager_id: string | null } | null`; and update `AWAITING_SELECT` to select both owner fields.
2. Change `listTimesheetsAwaitingApproval` to accept `(selfId: string, viewerRole: TimesheetApprovalViewerRole | null)`. After the existing RLS-scoped query succeeds, filter rows with this exact boolean expression before normalising entry hours:

```ts
sheet.user_id !== selfId && sheet.owner !== null && (
  sheet.owner.manager_id === selfId ||
  viewerRole === 'Admin' ||
  (viewerRole === 'Executive' && sheet.owner.manager_id === null)
)
```

   Retain the existing PostgREST `.eq('status', 'Submitted')`, `.neq('user_id', selfId)`, ordering, error propagation, and no-client-`org_id` posture.
3. In `useTimesheetApproval.ts`, destructure `role` alongside `currentUser`, append `role` to `awaitingApprovalKey`, and call the DAL with `userId!` and `role`. Keep the existing enabled condition based on org and user; a manager match is still valid if the role is temporarily null, while the Admin/Executive branches are not.
4. Update `TimesheetRepository.listAwaitingApproval` in `repositories/types.ts` and its implementation in `repositories/index.ts` to accept and forward the same typed role, keeping the repository contract consistent with the DAL.
5. Re-run both focused suites and require zero failures:

```bash
cd pmo-portal && npm test -- src/lib/db/timesheetTransition.test.ts src/hooks/useTimesheetApproval.test.ts src/lib/repositories/index.test.ts
```

### 4. Run the required full verification gate

**Files:** none

1. Inspect the working diff to confirm it is limited to the four production files and three unit-test files above; specifically confirm no migration, server/RPC, generated database type, `.env*`, or `org_id` change was introduced.
2. Run the whole required gate from the app directory and proceed only on exit status 0:

```bash
cd pmo-portal && npm run verify
```

3. If any gate is red, stop and fix the implementation or report the blocker; do not weaken, skip, or delete tests.

## Final verification checklist

```bash
cd pmo-portal && npm test -- src/lib/db/timesheetTransition.test.ts src/hooks/useTimesheetApproval.test.ts src/lib/repositories/index.test.ts
cd pmo-portal && npm run verify
```
