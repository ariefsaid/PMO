-- 1436_attendance_target_rate.sql — #2706: the organisation's attendance target rate, the one setting this ticket adds.
-- Spec: docs/specs/attendance-rate.spec.md (FR-ATR-001..003, NFR-ATR-004). Plan: docs/plans/2026-11-21-attendance-rate.md.
-- Reverse: supabase/migrations/rollback/1436_attendance_target_rate_down.sql.
--
-- NULL is the default and means "off": an organisation that never sets a target sees exactly what it saw before, and
-- no value is written into any existing organisation (FR-ATR-002). The column is a percentage the client owns — PMO
-- writes no default rate, because a default would be a productivity standard nobody chose (NFR-ATR-004).
--
-- Who may change it: organizations' only UPDATE policies are Admin-only (0207, 0231, kept that way by 0646), and the
-- column-scoped grant below is what lets a client write this column at all. RLS is the authority; the app's control
-- mirrors it (ADR-0016).

alter table public.organizations
  add column attendance_target_rate numeric(5,2)
    check (attendance_target_rate is null or attendance_target_rate between 0 and 100);

comment on column public.organizations.attendance_target_rate is
  'The organisation''s attendance target as a percentage (0-100). NULL = the attendance-rate report is off (#2706).';

grant update (attendance_target_rate) on public.organizations to authenticated;
