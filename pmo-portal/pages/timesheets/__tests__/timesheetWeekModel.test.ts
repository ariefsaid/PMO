import { describe, it, expect } from 'vitest';
import { planCopyLastWeekRows } from '../timesheetWeekModel';
import type { TimesheetEntryWithProject } from '@/src/lib/db/timesheets';
import type { EditRow } from '@/src/lib/timesheet-edit';

/**
 * "Copy last week" merge planner (pure model).
 *
 * The merge appends last week's per-project rows (hours + note, day-shifted onto the current
 * week) for projects NOT already in the current edit buffer. Projects already present are
 * skipped in full — no duplicate rows, no clobbered hours — and the plan never touches the
 * server: the caller still commits through the explicit Save (FR-TSE-011).
 */

const LAST_WEEK_DATES = [
  '2026-10-19', // Mon
  '2026-10-20',
  '2026-10-21',
  '2026-10-22',
  '2026-10-23',
  '2026-10-24',
  '2026-10-25', // Sun
];

function entry(overrides: Partial<TimesheetEntryWithProject>): TimesheetEntryWithProject {
  return {
    id: 'e-x',
    timesheet_id: 'ts-last',
    org_id: 'org-1',
    project_id: 'p-1',
    entry_date: LAST_WEEK_DATES[0],
    hours: 8,
    notes: null,
    project: { name: 'Alpha Project', code: 'A001' },
    ...overrides,
  };
}

function row(overrides: Partial<EditRow>): EditRow {
  return {
    project_id: 'p-1',
    project: 'Alpha Project',
    code: 'A001',
    hours: ['', '', '', '', '', '', ''],
    note: '',
    ...overrides,
  };
}

describe('planCopyLastWeekRows — appends missing rows with shifted hours', () => {
  it('adds a project absent from the current buffer, mapping last week Mon–Sun onto the current week day indexes', () => {
    const source = [
      entry({ id: 'e1', project_id: 'p-1', entry_date: LAST_WEEK_DATES[0], hours: 8, notes: 'Site visit' }),
      entry({ id: 'e2', project_id: 'p-1', entry_date: LAST_WEEK_DATES[4], hours: 6 }),
    ];
    const plan = planCopyLastWeekRows(source, LAST_WEEK_DATES, [], 'Unknown Project');
    expect(plan.addedCount).toBe(1);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({
      project_id: 'p-1',
      project: 'Alpha Project',
      code: 'A001',
      hours: ['8', '', '', '', '6', '', ''],
      note: 'Site visit',
    });
  });

  it('uses the short display name and carries the code', () => {
    const source = [entry({ project: { name: 'Meridian Solar Phase 1', short_name: 'Solar 1', code: 'SP-1' } })];
    const plan = planCopyLastWeekRows(source, LAST_WEEK_DATES, [], 'Unknown Project');
    expect(plan.rows[0].project).toBe('Solar 1');
    expect(plan.rows[0].code).toBe('SP-1');
  });

  it('falls back to the unknown-project label when the join is null', () => {
    const source = [entry({ project: null })];
    const plan = planCopyLastWeekRows(source, LAST_WEEK_DATES, [], 'Unknown Project');
    expect(plan.rows[0].project).toBe('Unknown Project');
  });
});

describe('planCopyLastWeekRows — the duplicate guard', () => {
  it('skips projects already in the buffer and leaves the existing row untouched', () => {
    const source = [
      entry({ id: 'e1', project_id: 'p-1', entry_date: LAST_WEEK_DATES[0], hours: 8 }),
      entry({ id: 'e2', project_id: 'p-2', entry_date: LAST_WEEK_DATES[0], hours: 4, project: { name: 'Beta Project', code: 'B002' } }),
    ];
    const existing = row({ project_id: 'p-1', hours: ['2', '', '', '', '', '', ''], note: 'My own hours' });
    const plan = planCopyLastWeekRows(source, LAST_WEEK_DATES, [existing], 'Unknown Project');
    expect(plan.addedCount).toBe(1);
    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0]).toBe(existing); // identity preserved — never clobbered
    expect(plan.rows[1]).toMatchObject({ project_id: 'p-2', project: 'Beta Project' });
  });

  it('reports nothing to add when every last-week project is already present', () => {
    const source = [entry({ project_id: 'p-1', hours: 8 })];
    const existing = row({ project_id: 'p-1', hours: ['3', '', '', '', '', '', ''] });
    const plan = planCopyLastWeekRows(source, LAST_WEEK_DATES, [existing], 'Unknown Project');
    expect(plan.addedCount).toBe(0);
    expect(plan.rows).toEqual([existing]);
  });

  it('reports nothing to add when last week is empty', () => {
    const plan = planCopyLastWeekRows([], LAST_WEEK_DATES, [], 'Unknown Project');
    expect(plan.addedCount).toBe(0);
    expect(plan.rows).toEqual([]);
  });
});

describe('planCopyLastWeekRows — cell hygiene', () => {
  it('sums defensively per day and leaves zero days blank', () => {
    const source = [
      entry({ id: 'e1', project_id: 'p-1', entry_date: LAST_WEEK_DATES[1], hours: 4 }),
      entry({ id: 'e2', project_id: 'p-1', entry_date: LAST_WEEK_DATES[1], hours: 1.25 }),
    ];
    const plan = planCopyLastWeekRows(source, LAST_WEEK_DATES, [], 'Unknown Project');
    expect(plan.rows[0].hours[1]).toBe('5.25');
    expect(plan.rows[0].hours.every((c, i) => (i === 1 ? true : c === ''))).toBe(true);
  });

  it('keeps the first non-empty note when several cells carry notes', () => {
    const source = [
      entry({ id: 'e1', entry_date: LAST_WEEK_DATES[0], notes: 'First note' }),
      entry({ id: 'e2', entry_date: LAST_WEEK_DATES[2], notes: 'Second note' }),
    ];
    const plan = planCopyLastWeekRows(source, LAST_WEEK_DATES, [], 'Unknown Project');
    expect(plan.rows[0].note).toBe('First note');
  });

  it('orders added rows by display name and keeps existing rows first', () => {
    const source = [
      entry({ project_id: 'p-z', project: { name: 'Zebra Works', code: 'Z' } }),
      entry({ project_id: 'p-a', project: { name: 'Alpha Project', code: 'A' } }),
    ];
    const existing = row({ project_id: 'p-m', project: 'Mid Project', code: 'M' });
    const plan = planCopyLastWeekRows(source, LAST_WEEK_DATES, [existing], 'Unknown Project');
    expect(plan.rows.map((r) => r.project_id)).toEqual(['p-m', 'p-a', 'p-z']);
  });
});
