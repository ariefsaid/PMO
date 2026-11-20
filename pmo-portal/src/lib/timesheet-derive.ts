/**
 * Pure derivation helpers for timesheet data. All functions operate on
 * the types already returned by useTimesheets() — no new queries.
 * T1 (plan §9 Phase 1).
 */
import type { TimesheetWithEntries, TimesheetEntryWithProject } from '@/src/lib/db/timesheets';

export interface ProjectHoursSummary {
  projectId: string;
  name: string;
  code: string | null;
  hours: number;
}

/**
 * T1: Groups a single week's entries by project_id, sums hours,
 * and returns descending by hours.
 */

/**
 * T1: Flattens all sheets' entries, sorts by entry_date descending (newest first),
 * and returns the top `limit` entries.
 */
export function recentEntries(
  sheets: TimesheetWithEntries[],
  limit: number,
): TimesheetEntryWithProject[] {
  const flat = sheets.flatMap((sheet) => sheet.entries);
  flat.sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  return flat.slice(0, limit);
}
