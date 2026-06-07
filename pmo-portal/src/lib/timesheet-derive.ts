/**
 * Pure derivation helpers for timesheet data. All functions operate on
 * the types already returned by useTimesheets() — no new queries.
 * T1, T2 (plan §9 Phase 1).
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
export function entriesByProject(
  entries: TimesheetEntryWithProject[],
): ProjectHoursSummary[] {
  const map = new Map<string, ProjectHoursSummary>();
  for (const e of entries) {
    const existing = map.get(e.project_id);
    if (existing) {
      existing.hours += e.hours || 0;
    } else {
      map.set(e.project_id, {
        projectId: e.project_id,
        name: e.project?.name ?? 'Unknown',
        code: e.project?.code ?? null,
        hours: e.hours || 0,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.hours - a.hours);
}

export interface FlatEntry extends TimesheetEntryWithProject {
  /** Which timesheet sheet this entry belongs to (for context if needed). */
  sheetId: string;
}

/**
 * T1: Flattens all sheets' entries, sorts by entry_date descending (newest first),
 * and returns the top `limit` entries.
 */
export function recentEntries(
  sheets: TimesheetWithEntries[],
  limit: number,
): FlatEntry[] {
  const flat: FlatEntry[] = [];
  for (const sheet of sheets) {
    for (const e of sheet.entries) {
      flat.push({ ...e, sheetId: sheet.id });
    }
  }
  flat.sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  return flat.slice(0, limit);
}

export interface WeekTotal {
  weekStart: string;
  total: number;
}

/**
 * T2: Returns the last `n` weeks (sheets already newest-first) with their
 * summed total hours.
 */
export function weeksTotals(
  sheets: TimesheetWithEntries[],
  n: number,
): WeekTotal[] {
  return sheets.slice(0, n).map((sheet) => ({
    weekStart: sheet.week_start_date,
    total: sheet.entries.reduce((sum, e) => sum + (e.hours || 0), 0),
  }));
}
