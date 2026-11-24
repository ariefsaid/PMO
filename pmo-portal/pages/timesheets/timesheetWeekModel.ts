import { startOfWeek } from 'date-fns/startOfWeek';
import type { TimesheetDay, TimesheetGridRow } from '@/src/components/ui';
import type { TimesheetEntryWithProject } from '@/src/lib/db/timesheets';
import type { EditRow } from '@/src/lib/timesheet-edit';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { formatWeekday } from '@/src/lib/format';

/** The local calendar day as `YYYY-MM-DD` (a storage key, never shown to a person). */
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function weekStart(date: Date) {
  const start = startOfWeek(date, { weekStartsOn: 1 });
  return { date: start, key: dayKey(start) };
}

export function datesInWeek(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    return date;
  });
}

export function entriesToGridRows(
  entries: TimesheetEntryWithProject[],
  weekDates: Date[],
  unknownProject: string,
  options?: { groupByWorkOrder?: boolean },
): TimesheetGridRow[] {
  const byWorkOrder = options?.groupByWorkOrder === true;
  const map = new Map<string, TimesheetGridRow>();
  const dateStrings = weekDates.map((date) => dayKey(date));
  for (const e of entries) {
    const key = byWorkOrder ? `${e.project_id}:${e.work_order_id ?? ''}` : `${e.project_id}`;
    let row = map.get(key);
    if (!row) {
      const workOrderLabel = byWorkOrder && e.work_order
        ? [e.work_order.wo_number, e.work_order.title].filter(Boolean).join(' · ') || null
        : null;
      row = {
        id: key,
        projectId: `${e.project_id}`,
        project: e.project ? projectDisplayName(e.project) : unknownProject,
        projectLegalName: e.project?.name,
        code: e.project?.code ?? null,
        ...(workOrderLabel ? { workOrderLabel } : {}),
        hours: [0, 0, 0, 0, 0, 0, 0],
      };
      map.set(key, row);
    }
    const dayIdx = dateStrings.indexOf(e.entry_date);
    if (dayIdx >= 0) row.hours[dayIdx] += e.hours;
  }
  return Array.from(map.values()).sort(
    (a, b) => a.project.localeCompare(b.project) || (a.workOrderLabel ?? '').localeCompare(b.workOrderLabel ?? ''),
  );
}

export function gridDaysForWeek(weekDates: Date[]): TimesheetDay[] {
  return weekDates.map((d) => {
    const dow = d.getDay();
    return { label: formatWeekday(d), dateNum: String(d.getDate()), weekend: dow === 0 || dow === 6 };
  });
}

export interface CopyLastWeekPlan {
  /** The current buffer with last week's missing rows appended (added rows in display-name order). */
  rows: EditRow[];
  /** How many project rows the copy would add — 0 means there is nothing new to copy. */
  addedCount: number;
}

/**
 * "Copy last week" merge planner (pure — renders nothing, writes nothing). Groups last week's
 * entries per project and appends the projects NOT already in the current edit buffer, shifting
 * each cell +7 days onto the current week's Monday-first day indexes. Hours AND the row note are
 * copied — the data model stores hours + notes per (project, entry_date), so last week's shape is
 * fully representable this week. Projects already present are skipped WHOLE (the duplicate guard:
 * no duplicate rows, and the user's existing/unsaved hours are never clobbered); the DB's own
 * (timesheet_id, project_id, entry_date) upsert key stays the second line of defence. The result
 * seeds the edit buffer only — the user reviews it and commits through the explicit Save
 * (FR-TSE-011), which routes through the atomic save_timesheet_week RPC exactly like a typed edit.
 */
export function planCopyLastWeekRows(
  sourceEntries: TimesheetEntryWithProject[],
  sourceDates: string[],
  currentRows: EditRow[],
  unknownProject: string,
): CopyLastWeekPlan {
  const groups = new Map<
    string,
    { project: string; code: string | null; hours: number[]; note: string }
  >();
  for (const e of sourceEntries) {
    let g = groups.get(e.project_id);
    if (!g) {
      g = {
        project: e.project ? projectDisplayName(e.project) : unknownProject,
        code: e.project?.code ?? null,
        hours: [0, 0, 0, 0, 0, 0, 0],
        note: '',
      };
      groups.set(e.project_id, g);
    }
    // Defensive per-day sum (mirrors entriesToGridRows — well-formed sheets hold one entry per
    // (project, date) cell, but the merge never assumes it).
    const dayIdx = sourceDates.indexOf(e.entry_date);
    if (dayIdx >= 0) g.hours[dayIdx] += e.hours;
    // Row note = first non-empty cell note (the seedRows convention: one note per project row).
    if (g.note === '' && (e.notes ?? '') !== '') g.note = e.notes as string;
  }
  const present = new Set(currentRows.map((r) => r.project_id));
  const additions: EditRow[] = [...groups.entries()]
    .filter(([id]) => !present.has(id))
    .sort(([, a], [, b]) => a.project.localeCompare(b.project))
    .map(([id, g]) => ({
      project_id: id,
      project: g.project,
      code: g.code,
      // Zero days stay blank; non-zero values render as clean input text (2dp rounds away any
      // defensive-sum float dust like 8.100000000000001).
      hours: g.hours.map((v) => (v === 0 ? '' : String(Math.round(v * 100) / 100))),
      note: g.note,
    }));
  return { rows: [...currentRows, ...additions], addedCount: additions.length };
}

export type WeekSaveState = 'reconciling' | 'saving' | 'invalid' | 'failed' | 'unsaved' | 'saved' | 'idle';

/**
 * The ONE status the week shows (#2559). `failed`/`saved` mean "this very edit buffer" failed or
 * just saved (the caller compares buffer identity), so a later edit or another week falls back to
 * the derived states. `saved` outranks `unsaved` only for a just-saved buffer, which stays dirty
 * against the server until the week refetch lands.
 */
export function weekSaveState(s: {
  reconciling: boolean; saving: boolean; invalid: boolean; failed: boolean;
  saved: boolean; dirty: boolean; hasEntries: boolean;
}): WeekSaveState {
  if (s.reconciling) return 'reconciling';
  if (s.saving) return 'saving';
  if (s.invalid) return 'invalid';
  if (s.failed) return 'failed';
  if (s.saved) return 'saved';
  if (s.dirty) return 'unsaved';
  return s.hasEntries ? 'saved' : 'idle';
}
