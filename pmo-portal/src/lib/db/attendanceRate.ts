import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import { parseDecimal } from '@/src/lib/exactDecimal';
import { readOrgColumns } from './orgSettingsBatch';

/**
 * Attendance rate per crew against the organisation's target (#2706, migrations 1436/1437).
 *
 * The target is one organisation setting, a percentage the client owns: `NULL` means off, and an organisation that
 * never sets it sees no change. The rate itself is computed by `attendance_rate_by_crew` over the shipped crew, roster
 * and attendance records — no row is written here, and `org_id` is never sent (RLS and the column default keep the
 * seam, ADR-0017).
 */

export interface CrewAttendanceRateRow {
  crew_id: string;
  crew_code: string;
  crew_name: string;
  /** Distinct member-days the crew was rostered and had people placed. */
  expected_days: number;
  present_days: number;
  absent_days: number;
  leave_days: number;
  off_rotation_days: number;
  /** Expected member-days nobody recorded — the recording gap a reviewer must see. */
  no_record_days: number;
  /** Expected days less leave and off rotation: the rate's denominator. */
  countable_days: number;
  /** Percentage 0..100, two decimals; `null` when the period holds no countable day. */
  rate: number | null;
  target_rate: number | null;
  meets_target: boolean | null;
}

/** The one rule the field and the database share: a percentage, two decimals, 0 to 100. */
export function attendanceTargetIssue(value: number | null): 'range' | 'precision' | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100) return 'range';
  if (parseDecimal(String(value), 2) === null) return 'precision';
  return null;
}

/** A crew is below target only when a target is set and a rate exists (never a missing rate, never 0 % invented). */
export function isBelowTarget(row: Pick<CrewAttendanceRateRow, 'rate' | 'meets_target'>): boolean {
  return row.rate !== null && row.meets_target === false;
}

/** The organisation's target rate, or `null` when it is off. One row under RLS, `org_id` never sent. */
export async function getAttendanceTarget(): Promise<number | null> {
  const { data, error } = await readOrgColumns(['attendance_target_rate']);
  if (error) throw new AppError(error.message, error.code);
  const value = data?.attendance_target_rate;
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Set the target, or clear it with `null`. Admin-only: the shipped organizations update policies are Admin-only and
 * 0192 revoked the table-wide UPDATE, so the column grant of 1436 is the only path a client has. The id comes from an
 * RLS-scoped read, never from the client — and more than one visible organisation is refused out loud rather than
 * guessed (the same posture as the other organisation settings).
 */
export async function setAttendanceTarget(value: number | null): Promise<void> {
  const issue = attendanceTargetIssue(value);
  if (issue === 'range') throw new AppError('The attendance target runs from 0 to 100.', '22023');
  if (issue === 'precision') throw new AppError('Give the attendance target at most two decimals.', '22023');
  const { data, error } = await supabase.from('organizations').select('id').limit(2);
  if (error) throw new AppError(error.message, error.code);
  if ((data?.length ?? 0) > 1) {
    throw new AppError('More than one organization is readable; refusing to guess which one to change.', '22023');
  }
  const orgId = data?.[0]?.id;
  if (!orgId) throw new AppError('No organization is readable for the current user.', '42501');
  const { data: changed, error: updateError } = await supabase
    .from('organizations')
    .update({ attendance_target_rate: value })
    .eq('id', orgId)
    .select('id');
  if (updateError) throw new AppError(updateError.message, updateError.code);
  assertWriteLanded(changed, 'You do not have permission to change the attendance target.');
}

/** Per-crew rates for an inclusive period. The database owns the counting, the role gate and the 366-day bound. */
export async function listAttendanceRateByCrew(from: string, to: string): Promise<CrewAttendanceRateRow[]> {
  const { data, error } = await supabase.rpc('attendance_rate_by_crew', { p_from: from, p_to: to });
  if (error) throw new AppError(error.message, error.code);
  return ((data ?? []) as CrewAttendanceRateRow[]).map((row) => ({
    ...row,
    expected_days: Number(row.expected_days),
    present_days: Number(row.present_days),
    absent_days: Number(row.absent_days),
    leave_days: Number(row.leave_days),
    off_rotation_days: Number(row.off_rotation_days),
    no_record_days: Number(row.no_record_days),
    countable_days: Number(row.countable_days),
    rate: row.rate === null ? null : Number(row.rate),
    target_rate: row.target_rate === null ? null : Number(row.target_rate),
    meets_target: row.meets_target,
  }));
}
