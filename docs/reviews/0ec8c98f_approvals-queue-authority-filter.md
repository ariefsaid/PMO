# Approvals queue: filter "awaiting you" to the approve authority (Issue #591)

## What changed and why it matters

The Approvals "awaiting you" queue previously returned to React Query whatever the RLS-scoped
`listTimesheetsAwaitingApproval` query surfaced (all `Submitted` sheets, excluding the viewer's own).
That set is broader than what the viewer is actually allowed to approve: a manager could see assignees'
sheets but also sheets owned by other managers, and an Executive could be shown sheets that are routed
to a specific manager. The queue could therefore advertise an approve action that the server-side
`transition_timesheet` RPC would reject.

This change makes the client-side queue mirror the **approve arm** of `transition_timesheet`
(`supabase/migrations/0164_*.sql` §4): a submitted sheet is shown to a viewer only when the viewer is
**not** its owner **and** one of

1. the sheet owner's `manager_id` equals the viewer's id (regardless of role),
2. the viewer's real role is `Admin` (break-glass, any sheet), or
3. the viewer's real role is `Executive` **and** the owner's `manager_id` is `null`.

The separation-of-duties rule (never show your own sheet) is re-checked in the local predicate too.

This is **FE/DAL-only**. No migration, RLS/RPC, auth, `org_id`, route, or UI component changed. The
server stays the enforcement authority; this filter only stops a queue row from advertising an action
the RPC would refuse. A sheet whose owner join is missing is **excluded** (fails closed) rather than
being treated as an unassigned (null-manager) sheet.

## Files that carry it

- `pmo-portal/src/lib/db/timesheetTransition.ts` — the read path. `AWAITING_SELECT` now embeds the
  owner's `manager_id` (`owner:profiles!timesheets_user_id_fkey(full_name,manager_id)`). The new
  `TimesheetApprovalViewerRole` type is derived from `Tables<'profiles'>['role']`;
  `TimesheetAwaitingApproval.owner` is `{ full_name: string; manager_id: string | null } | null`.
  `listTimesheetsAwaitingApproval(selfId, viewerRole)` keeps the existing PostgREST
  `.eq('status','Submitted')`, `.neq('user_id', selfId)` (SoD), ordering and error propagation, then
  applies the authority predicate above to the returned rows before normalising entry hours. No
  client `org_id` is threaded (RLS scopes it).
- `pmo-portal/src/hooks/useTimesheetApproval.ts` — `useTimesheetsAwaitingApproval` now pulls `role`
  from the existing auth context (JWT claim) and forwards it to the DAL; the query key gains the role
  (`['timesheets-awaiting', orgId, userId, role]`) so results computed for one real role are not reused
  after the role changes. `invalidateBoth` still invalidates the awaiting queue via its leading key.
- `pmo-portal/src/lib/repositories/types.ts` + `pmo-portal/src/lib/repositories/index.ts` — the
  `TimesheetRepository.listAwaitingApproval` seam accepts and forwards the same typed role, keeping the
  repository contract consistent with the DAL (the hook currently calls the DAL directly).
- `pmo-portal/pages/Approvals.test.tsx` — fixture now supplies `manager_id` on the embedded owner.

## Tests (AC-903)

Unit coverage in `pmo-portal/src/lib/db/timesheetTransition.test.ts` (the sole owner layer for the
predicate) asserts all owner-locked cases:

- a Project Manager receives only the sheet whose owner's `manager_id` is that manager id;
- an Executive receives only the null-manager sheet, not sheets routed to either manager;
- an Admin receives every other user's submitted sheet (assigned and null-manager owners) but not a raw
  self row;
- a non-assignee Project Manager receives no sheets;
- a missing joined owner (`owner: null`) is excluded rather than treated as unassigned.

Plumbing is verified in `useTimesheetApproval.test.ts` (DAL called with `('u1','Project Manager')` and
the cache keyed by the role-inclusive array) and `repositories/index.test.ts` (the repository method
forwards both arguments; no `org_id` argument added).

## How to verify

Run the focused suites:

```bash
cd pmo-portal && npm test -- src/lib/db/timesheetTransition.test.ts src/hooks/useTimesheetApproval.test.ts src/lib/repositories/index.test.ts
```

and the full required gate:

```bash
cd pmo-portal && npm run verify
```