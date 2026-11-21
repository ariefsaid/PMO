# Plan: Leave and sick requests (#2708)

Spec: `docs/specs/leave-requests.spec.md`. Reuses: `people` (+ `profile_id`), `profiles.manager_id`, `role_rank`/`auth_role()`, `work_order_roster` page `pages/crews/WorkOrderRoster.tsx`, approvals page `pages/Approvals.tsx` with its `approvals/*Section.tsx` pattern, repository seam. No change to `work_order_roster`, `attendance_record`, or any existing policy.

## Migrations (range 1240..1244; rollbacks in `supabase/migrations/rollback/`)
| File | Content |
|---|---|
| `1240_leave_requests.sql` | `organizations.leave_approver_role text null` (check against role names); `leave_types` and `leave_requests` tables (person_id, leave_type_id, start_date, end_date, reason, status Pending/Approved/Rejected/Cancelled, entered_by, decided_by, decided_at, decision_note, version, archived_at on types), `stamp_org_id` triggers, same-org ref guard, overlap exclusion constraint on (person_id, daterange) for live statuses, RLS (select: active member own org, own person row, or approver-capable; direct insert/update revoked except `leave_types` admin writes), grants |
| `1241_leave_rpcs.sql` | security-definer `leave_request_submit`, `leave_request_decide` (approve/reject; SoD and authority inside), `leave_request_cancel`, `leave_can_decide(request)`; `leave_on_date(p_date)` returns person ids on Approved leave (invoker, additive roster marker); revoke anon |
| `1242_leave_settings.sql` | `set_leave_settings(enabled, approver_role)`: Admin-only security-definer setter (no existing generic org-settings write route covers org columns with an Admin check) |
| `1243_leave_requestable_people.sql` | `leave_requestable_people()` for the form's person picker |
| `1244` | unused |

Isolation denominator manifest fragment updated for the new tables and definer functions (`node scripts/check-isolation-denominator.mjs`).

## Frontend (all under `pmo-portal/`)
- `src/lib/db/leave.ts`, `src/lib/repositories/leave.ts` (+ tests); `src/hooks/useLeave.ts`.
- `pages/leave/LeaveRequests.tsx` (my requests + form via `EntityFormModal`), route `/leave`; `pages/leave/LeaveTypes.tsx` in administration; `pages/approvals/LeaveApprovalSection.tsx` in `Approvals.tsx` scope `leave`; needs-you pointer through `useNeedsYou` only when the viewer can decide and count > 0.
- Roster marker: `WorkOrderRoster.tsx` calls `leave_on_date` and shows a chip; no call result, no change.
- `can('create'|'approve','leave_request')` in `src/auth/policy.ts`; en and id strings; terminology-neutral wording.
- Screenshots phone 390 and desktop 1440 for `/leave` and the approvals section under `docs/evidence/1215/2708/`.

## Tests per AC
| AC | File | Layer |
|---|---|---|
| 001..011 | `supabase/tests/leave_requests.test.sql` | pgTAP; AC-006 mutation check (force `allowed := true` in decide; test must go red; restore) |
| 012 | `pages/leave/LeaveRequests.test.tsx` (+ bahasa) | Unit |
| 013 | `pages/approvals/LeaveApprovalSection.test.tsx` | Unit |
| 014 | `pages/crews/WorkOrderRoster.leave.test.tsx` (existing roster tests untouched) | Unit |
| 015 | `e2e/AC-LV-015-leave-request-approval.spec.ts` | E2E |

Gates: pgTAP files plus `0178_*` and `0646_rls_initplan` under `flock /tmp/db.lock`, check:guards, typecheck, eslint, `vitest related`.

## Not built, stated
Blocking the attendance tick on approved leave (FR-LV-010) is left out; attendance stays as is. Allowances, half days, payroll: out of scope.
