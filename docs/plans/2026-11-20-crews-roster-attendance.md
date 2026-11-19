# Crews, Roster and Attendance Implementation Plan (#2528)

> Fresh Orca worker per slice; Slice 3 Director-dispatched (SoD, hours to cost). Spec: `docs/specs/crews-roster-attendance.spec.md`. Reuse #1516 employee/assignment tables and the timesheet approval RPC (`timesheets-approval.spec.md`); sign OQ-CRW-1..3 first (OQ-CRW-3 changes Slice 3).

## Migrations (numbers by the Director; rollback files; RLS + force RLS; `stamp_org_id`)
`crews`, `crew_standard_roles`, `crew_members` (crew, person ref employee|vendor worker, role, from, to; exclusion constraint on overlapping person ranges), `vendor_workers`, `work_order_crews` (work order, crew, from, to; exclusion constraint per crew), `attendance_days` (person ref, work_order, date, status, hours, overtime, source, needs_review, locked_at, recorded_by) with check 0..24 and a trigger enforcing the 24-hour daily ceiling, `attendance_photos` (link to attachments). RPCs: `attendance_record`, `attendance_generate_timesheet(person, week)` (idempotent; writes `timesheet_entries` with work order via #2517), and an extension of the existing timesheet approval RPC for SoD and lock.

## Slice 1 — crew master, membership, roster (Orca)
- [ ] pgTAP `supabase/tests/crews_roster.test.sql`: AC-CRW-001..004, 014 first. Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/crews_roster.test.sql'`.
- [ ] Migration; `pmo-portal/src/lib/db/crews.ts`, repository, `policy.ts` actions, role-matrix registration.
- [ ] `pages/Crews.tsx` (master + membership), `pages/WorkOrderRoster.tsx` (per-date view with shortfall, AC-CRW-004); form primitives; en + id.

## Slice 2 — attendance record + tick screen (Orca)
- [ ] pgTAP `supabase/tests/attendance_days.test.sql`: AC-CRW-006..008, 013.
- [ ] `src/lib/db/attendance.ts`, repository; `pages/AttendanceTick.tsx` (crew-wide default hours, per-person override, group photo; 320px).
- [ ] Vitest for tick logic (AC-CRW-005); E2E part of AC-CRW-005 deferred to the journey in Slice 4.

## Slice 3 — attendance to timesheet (Director, ships alone)
- [ ] pgTAP `supabase/tests/attendance_timesheet.test.sql`: AC-CRW-009..012. Mutation checks: allow recorder = approver, AC-CRW-010 must go red; drop the lock, AC-CRW-011 must go red; restore.
- [ ] RPCs, idempotent generation, lock on approval; correction path link.

## Slice 4 — acceptance
- [ ] `e2e/AC-CRW-015-crew-day-to-approved-hours.spec.ts` (read `docs/e2e-parallel-conventions.md`); `scripts/e2e-local.sh AC-CRW-015`; `scripts/ux-proof.sh` on touched routes.

## Final gate
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched vitest, pgTAP and e2e files.
