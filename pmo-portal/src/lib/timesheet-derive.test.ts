// T1, T2 — pure derivation helpers for timesheet data
import { describe, it, expect } from 'vitest';
import { entriesByProject, recentEntries, weeksTotals } from './timesheet-derive';
import type { TimesheetWithEntries } from '@/src/lib/db/timesheets';

// Minimal fixture shapes matching TimesheetEntryWithProject
const makeEntry = (
  id: string,
  hours: number,
  entry_date: string,
  project_id: string,
  name: string,
  code: string | null = null,
  notes: string | null = null,
) => ({
  id,
  timesheet_id: 'ts1',
  org_id: 'o1',
  hours,
  entry_date,
  project_id,
  notes,
  project: { name, code },
});

const sheets: TimesheetWithEntries[] = [
  {
    id: 'ts1',
    status: 'Draft',
    week_start_date: '2026-06-01',
    user_id: 'u1',
    org_id: 'o1',
    submitted_at: null,
    approved_at: null,
    approved_by: null,
    entries: [
      makeEntry('e1', 8, '2026-06-01', 'p1', 'Alpha', 'A001'),
      makeEntry('e2', 4, '2026-06-02', 'p1', 'Alpha', 'A001', 'status call'),
      makeEntry('e3', 3, '2026-06-01', 'p2', 'Beta', null),
    ],
  },
  {
    id: 'ts0',
    status: 'Approved',
    week_start_date: '2026-05-25',
    user_id: 'u1',
    org_id: 'o1',
    submitted_at: null,
    approved_at: null,
    approved_by: null,
    entries: [
      makeEntry('e0', 40, '2026-05-25', 'p1', 'Alpha', 'A001'),
    ],
  },
] as unknown as TimesheetWithEntries[];

describe('T1 — entriesByProject', () => {
  it('groups entries by project_id and sums hours (T1)', () => {
    const result = entriesByProject(sheets[0].entries);
    // p1: 8+4=12, p2: 3
    const alpha = result.find((r) => r.projectId === 'p1');
    const beta = result.find((r) => r.projectId === 'p2');
    expect(alpha?.hours).toBe(12);
    expect(beta?.hours).toBe(3);
  });

  it('sorts by hours descending so the biggest project is first (T1)', () => {
    const result = entriesByProject(sheets[0].entries);
    expect(result[0].projectId).toBe('p1'); // 12h > 3h
  });

  it('carries project name and code (T1)', () => {
    const result = entriesByProject(sheets[0].entries);
    const alpha = result.find((r) => r.projectId === 'p1')!;
    expect(alpha.name).toBe('Alpha');
    expect(alpha.code).toBe('A001');
  });

  it('returns empty array for empty entries (T1 edge)', () => {
    expect(entriesByProject([])).toHaveLength(0);
  });
});

describe('T1 — recentEntries', () => {
  it('flattens all sheets and returns top N sorted newest-first (T1)', () => {
    const result = recentEntries(sheets, 3);
    expect(result).toHaveLength(3);
    // newest first: 2026-06-02 first, then 2026-06-01, then 2026-05-25
    expect(result[0].entry_date).toBe('2026-06-02');
  });

  it('caps at the requested limit (T1 cap)', () => {
    const result = recentEntries(sheets, 2);
    expect(result).toHaveLength(2);
  });

  it('returns all entries when fewer than limit exist (T1 edge)', () => {
    const result = recentEntries(sheets, 100);
    expect(result).toHaveLength(4); // 3 in ts1 + 1 in ts0
  });
});

describe('T2 — weeksTotals', () => {
  it('returns last n weeks with correct sums (T2)', () => {
    const result = weeksTotals(sheets, 2);
    expect(result).toHaveLength(2);
    // ts1 is first (newest-first), ts0 is second
    const [w1, w2] = result;
    expect(w1.weekStart).toBe('2026-06-01');
    expect(w1.total).toBe(15); // 8+4+3
    expect(w2.weekStart).toBe('2026-05-25');
    expect(w2.total).toBe(40);
  });

  it('returns fewer items than n when not enough sheets (T2 edge)', () => {
    const result = weeksTotals(sheets, 10);
    expect(result).toHaveLength(2);
  });

  it('returns empty array for empty sheets (T2 edge)', () => {
    expect(weeksTotals([], 5)).toHaveLength(0);
  });
});
