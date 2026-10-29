import { format, startOfWeek } from 'date-fns';
import type { TimesheetDay, TimesheetGridRow } from '@/src/components/ui';
import type { TimesheetEntryWithProject } from '@/src/lib/db/timesheets';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { formatWeekday } from '@/src/lib/format';

export function weekStart(date: Date) {
  const start = startOfWeek(date, { weekStartsOn: 1 });
  return { date: start, key: format(start, 'yyyy-MM-dd') };
}

export function datesInWeek(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    return date;
  });
}

export function entriesToGridRows(entries: TimesheetEntryWithProject[], weekDates: Date[], unknownProject: string): TimesheetGridRow[] {
  const map = new Map<string, TimesheetGridRow>();
  const dateStrings = weekDates.map((date) => format(date, 'yyyy-MM-dd'));
  for (const e of entries) {
    const key = `${e.project_id}`;
    let row = map.get(key);
    if (!row) {
      row = { id: key, projectId: `${e.project_id}`, project: e.project ? projectDisplayName(e.project) : unknownProject,
        projectLegalName: e.project?.name, code: e.project?.code ?? null, hours: [0, 0, 0, 0, 0, 0, 0] };
      map.set(key, row);
    }
    const dayIdx = dateStrings.indexOf(e.entry_date);
    if (dayIdx >= 0) row.hours[dayIdx] += e.hours;
  }
  return Array.from(map.values()).sort((a, b) => a.project.localeCompare(b.project));
}

export function gridDaysForWeek(weekDates: Date[]): TimesheetDay[] {
  return weekDates.map((d) => {
    const dow = d.getDay();
    return { label: formatWeekday(d), dateNum: String(d.getDate()), weekend: dow === 0 || dow === 6 };
  });
}
