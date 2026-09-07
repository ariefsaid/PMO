# Plan — meeting.archive author-or-Admin FE gate (#589)

## Design

`meeting.archive` is a client-side UX projection of the existing `meetings_update` authority, not a new server capability. The pure policy will use one named author-or-Admin predicate for both `meeting.edit` and `meeting.archive`: an Admin succeeds regardless of record context; another valid meeting role succeeds only when both `currentUserId` and `record.created_by_id` exist and match. Missing identity or record context denies non-Admins. `meeting.delete` remains the separate Admin-only destructive-action gate.

The predicate only has its intended user-visible effect when every archive affordance supplies the record ownership context. `MeetingDetail` already supplies that context for edit but not archive; the Meetings-list row menu supplies none. Pass the authenticated user id and each meeting's `created_by_id` at both sites. This does not change the mutation, repository, API, RLS, schema, `org_id` handling, or query shape; migration `0205` already authorizes the same write. No ADR is needed because OD-MTG-3 is the settled product decision and this is a narrow alignment with it.

## Acceptance and test ownership

| AC | Owner | Proof |
|---|---|---|
| AC-MTG-029 | Unit (Vitest) | `pmo-portal/src/auth/__tests__/policy.meeting.test.ts` — canonical policy predicate proof; `pmo-portal/pages/MeetingDetail.test.tsx` and `pmo-portal/pages/Meetings.test.tsx` are supporting render regressions that prove both archive affordances pass the required ownership context. |

`AC-MTG-029` records the OD-MTG-3 delta: given a meeting author who is not Admin, when the archive gate evaluates matching `currentUserId` and `created_by_id`, then it permits archive; given a non-author non-Admin or no record context, it denies; given an Admin, it permits; hard delete remains Admin-only.

## Implementation tasks

### Task 1 — Record the missing acceptance criterion
**Files:** `docs/specs/meeting-module.spec.md`

1. Under **Tenancy and authorization**, add the exact Given/When/Then `AC-MTG-029` contract above, citing OD-MTG-3 and explicitly retaining Admin-only hard delete.
2. Add `AC-MTG-029` to the traceability table as a Unit (Vitest) AC owned by `pmo-portal/src/auth/__tests__/policy.meeting.test.ts`; list the two page tests as supporting affordance-context regressions, not separate owning layers.

**Verification:** `grep -n "AC-MTG-029" docs/specs/meeting-module.spec.md`

### Task 2 — Write the failing policy and affordance regressions first (TDD)
**AC:** AC-MTG-029  
**Files:** `pmo-portal/src/auth/__tests__/policy.meeting.test.ts`, `pmo-portal/pages/MeetingDetail.test.tsx`, `pmo-portal/pages/Meetings.test.tsx`

1. In `policy.meeting.test.ts`, replace the obsolete combined Admin-only archive/delete suite and its stale FE-stricter description. Add `AC-MTG-029`-tagged archive assertions for: an Engineer author (`u1`/`u1`) allowed; a Project Manager non-author (`u2`/`u1`) denied; an Admin non-author allowed; and absent record context allowing Admin only. Keep delete assertions in a separate Admin-only suite so no non-Admin gets delete.
2. In `MeetingDetail.test.tsx`, change the non-Admin author header test to require the existing author fixture to render `meeting-archive` and still omit `meeting-delete`; retain the Admin archive-and-delete assertion. Name the new/changed test with `AC-MTG-029`.
3. In `Meetings.test.tsx`, cover the row-menu contexts using the existing seed: Engineer/current user `u1` sees Archive but not Delete on own row `m1`, and sees neither Archive nor Delete on non-authored row `m2`. Name the test with `AC-MTG-029`.
4. Before changing production code, run the targeted tests. They must fail because the current policy is Admin-only and the two archive callers do not supply author context; do not weaken or skip an assertion.

**Failing-test command:** `cd pmo-portal && npm test -- src/auth/__tests__/policy.meeting.test.ts pages/MeetingDetail.test.tsx pages/Meetings.test.tsx`

### Task 3 — Share the policy predicate and supply record context at every archive affordance
**AC:** AC-MTG-029  
**Files:** `pmo-portal/src/auth/policy.ts`, `pmo-portal/pages/MeetingDetail.tsx`, `pmo-portal/pages/Meetings.tsx`

1. In `policy.ts`, define one typed `meetingAuthorOrAdmin` `Predicate` beside the other policy helpers. It must return true for `Admin`; otherwise require a role in `ALL`, a truthy `ctx.currentUserId`, and equality with `ctx.record?.created_by_id`.
2. Replace the meeting `edit` inline predicate with `meetingAuthorOrAdmin`, and set `archive` to that same predicate. Replace the stale archive comment with an OD-MTG-3 explanation that soft archive mirrors the author-or-Admin `meetings_update` authority. Leave `delete: allow(ADMIN)` unchanged.
3. In `MeetingDetail.tsx`, pass the same `{ currentUserId, record: { created_by_id: meeting?.created_by_id ?? null } }` ownership context used by edit to `may('archive', 'meeting', ...)`; leave the delete call context-free and Admin-only.
4. In `Meetings.tsx`, obtain the authenticated current user through the existing auth hook and pass `{ currentUserId: currentUser?.id, record: { created_by_id: m.created_by_id } }` to the per-row archive `may()` call. Do not pass this context to delete.
5. Run the targeted tests from Task 2 and make the production code, not the tests, satisfy every assertion.

**Verification:** `cd pmo-portal && npm test -- src/auth/__tests__/policy.meeting.test.ts pages/MeetingDetail.test.tsx pages/Meetings.test.tsx`

### Task 4 — Run the required whole-app gate
**AC:** AC-MTG-029  
**Files:** none

1. With all targeted tests green, run the repository's complete verify script from the app directory. Do not report completion if any gate fails.

**Verification:** `cd pmo-portal && npm run verify`

## Final scope checks

- No migration, RLS policy, RPC, repository, or database-type change: the server already permits this reversible author archive path.
- No delete widening: Admin-only `meeting.delete` and its regressions remain intact.
- No new component, network request, cache key, or query; the two call sites reuse their loaded meeting row and authenticated identity.
