import { describe, it, expect } from 'vitest';
import {
  parseHourCell,
  gridIsValid,
  computeTotals,
  diffEntries,
  type EditRow,
} from './timesheet-edit';

/** Helper: a 7-cell row with the given Mon..Sun raw strings, padded with blanks. */
function row(project_id: string, hours: string[], note = ''): EditRow {
  const filled = [...hours];
  while (filled.length < 7) filled.push('');
  return { project_id, project: project_id.toUpperCase(), code: null, hours: filled, note };
}

// ---------------------------------------------------------------------------
// parseHourCell — Task 8 (AC-TSE-009/010/011, FR-TSE-014)
// ---------------------------------------------------------------------------

describe('parseHourCell', () => {
  it('AC-TSE-009: parseHourCell rejects > 24', () => {
    expect(parseHourCell('25')).toEqual({ value: 25, valid: false });
    expect(parseHourCell('24.5')).toEqual({ value: 24.5, valid: false });
  });

  it('AC-TSE-010: parseHourCell rejects negative and non-numeric', () => {
    expect(parseHourCell('-3').valid).toBe(false);
    expect(parseHourCell('8h').valid).toBe(false);
    expect(parseHourCell('abc').valid).toBe(false);
  });

  it('AC-TSE-011: blank=0 and boundaries 0 and 24 are valid', () => {
    expect(parseHourCell('')).toEqual({ value: 0, valid: true });
    expect(parseHourCell('   ')).toEqual({ value: 0, valid: true });
    expect(parseHourCell('0')).toEqual({ value: 0, valid: true });
    expect(parseHourCell('24')).toEqual({ value: 24, valid: true });
    expect(parseHourCell('7.5')).toEqual({ value: 7.5, valid: true });
  });
});

// ---------------------------------------------------------------------------
// gridIsValid — Task 8 (AC-TSE-011, FR-TSE-014)
// ---------------------------------------------------------------------------

describe('gridIsValid', () => {
  it('AC-TSE-011: gridIsValid true when every cell parses valid (blank/0/24)', () => {
    expect(gridIsValid([row('p1', ['', '0', '24', '8'])])).toBe(true);
  });

  it('AC-TSE-009/010: gridIsValid false when any cell is > 24, negative or non-numeric', () => {
    expect(gridIsValid([row('p1', ['8', '25'])])).toBe(false);
    expect(gridIsValid([row('p1', ['8']), row('p2', ['-1'])])).toBe(false);
    expect(gridIsValid([row('p1', ['8h'])])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeTotals — Task 8 (AC-TSE-012, FR-TSE-013)
// ---------------------------------------------------------------------------

describe('computeTotals', () => {
  it('AC-TSE-012: computeTotals sums per-row/per-day/weekly from edited blank=0 state', () => {
    const totals = computeTotals([row('p1', ['6', '4'])]);
    expect(totals.perRow[0]).toBe(10);
    expect(totals.perDay[0]).toBe(6);
    expect(totals.perDay[1]).toBe(4);
    expect(totals.perDay[2]).toBe(0);
    expect(totals.weekly).toBe(10);
  });

  it('AC-TSE-012: computeTotals aggregates per-day across multiple rows', () => {
    const totals = computeTotals([row('p1', ['6', '4']), row('p2', ['2', '3'])]);
    expect(totals.perRow).toEqual([10, 5]);
    expect(totals.perDay[0]).toBe(8);
    expect(totals.perDay[1]).toBe(7);
    expect(totals.weekly).toBe(15);
  });

  it('AC-TSE-012: invalid cells contribute 0 to totals (treated as unparseable)', () => {
    const totals = computeTotals([row('p1', ['6', '8h'])]);
    expect(totals.perRow[0]).toBe(6);
    expect(totals.weekly).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// diffEntries — Task 9 (AC-TSE-017, FR-TSE-012)
// ---------------------------------------------------------------------------

const WEEK = [
  '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04',
  '2026-06-05', '2026-06-06', '2026-06-07',
];

describe('diffEntries', () => {
  it('AC-TSE-017: diffEntries emits upserts for changed/new cells, deletes for zeroed cells, omits unchanged', () => {
    // Server: P/Mon=8 (id se1), P/Wed=2 (id se3). Edited: Mon=6 (changed), Tue=4 (new), Wed='' (zeroed).
    const rows: EditRow[] = [row('P', ['6', '4', ''], 'fieldwork')];
    const server = [
      { id: 'se1', project_id: 'P', entry_date: '2026-06-01', hours: 8 },
      { id: 'se3', project_id: 'P', entry_date: '2026-06-03', hours: 2 },
    ];
    const diff = diffEntries(rows, WEEK, server, 'ts1');

    // Upserts: Mon=6 and Tue=4, both with timesheet_id and the row note, NO org_id.
    expect(diff.upserts).toEqual(
      expect.arrayContaining([
        { timesheet_id: 'ts1', project_id: 'P', entry_date: '2026-06-01', hours: 6, notes: 'fieldwork' },
        { timesheet_id: 'ts1', project_id: 'P', entry_date: '2026-06-02', hours: 4, notes: 'fieldwork' },
      ]),
    );
    expect(diff.upserts).toHaveLength(2);
    expect(JSON.stringify(diff.upserts)).not.toContain('org_id');
    // Delete: the zeroed Wed server entry.
    expect(diff.deletes).toEqual(['se3']);
  });

  it('AC-TSE-017: unchanged cells produce no upsert; a still-zero blank with no server entry is omitted', () => {
    const rows: EditRow[] = [row('P', ['8', ''])];
    const server = [{ id: 'se1', project_id: 'P', entry_date: '2026-06-01', hours: 8 }];
    const diff = diffEntries(rows, WEEK, server, 'ts1');
    expect(diff.upserts).toHaveLength(0); // Mon unchanged at 8; Tue blank with no server entry
    expect(diff.deletes).toHaveLength(0);
  });

  it('AC-TSE-017: a new row with hours produces upserts and no deletes; empty note → null', () => {
    const rows: EditRow[] = [row('Q', ['', '5'])];
    const diff = diffEntries(rows, WEEK, [], 'ts1');
    expect(diff.upserts).toEqual([
      { timesheet_id: 'ts1', project_id: 'Q', entry_date: '2026-06-02', hours: 5, notes: null },
    ]);
    expect(diff.deletes).toHaveLength(0);
  });
});
