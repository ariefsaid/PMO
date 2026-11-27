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

  it('#2440: one comma is a decimal separator (an Indonesian phone keypad types 3,5)', () => {
    expect(parseHourCell('3,5')).toEqual({ value: 3.5, valid: true });
    expect(parseHourCell(' 7,25 ')).toEqual({ value: 7.25, valid: true });
    expect(parseHourCell('24,5').valid).toBe(false);
    expect(parseHourCell('1,2,3').valid).toBe(false);
    expect(parseHourCell('1.2,3').valid).toBe(false);
    expect(parseHourCell('-3,5').valid).toBe(false);
    expect(parseHourCell('8,5h').valid).toBe(false);
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

  it('AC-TSE-017: a note-only edit on a row with an existing entry emits an upsert that re-writes the note', () => {
    // Server: P/Mon=8 (id se1), note "old". Edited: hours UNCHANGED, note changed to "new".
    const rows: EditRow[] = [row('P', ['8'], 'new note')];
    const server = [
      { id: 'se1', project_id: 'P', entry_date: '2026-06-01', hours: 8, notes: 'old note' },
    ];
    const diff = diffEntries(rows, WEEK, server, 'ts1');
    // The Mon cell is re-upserted carrying the new note even though hours did not change.
    expect(diff.upserts).toEqual([
      { timesheet_id: 'ts1', project_id: 'P', entry_date: '2026-06-01', hours: 8, notes: 'new note' },
    ]);
    expect(diff.deletes).toHaveLength(0);
  });

  it('AC-TSE-017: an unchanged note on an unchanged row emits nothing (no spurious upsert)', () => {
    const rows: EditRow[] = [row('P', ['8'], 'same')];
    const server = [
      { id: 'se1', project_id: 'P', entry_date: '2026-06-01', hours: 8, notes: 'same' },
    ];
    const diff = diffEntries(rows, WEEK, server, 'ts1');
    expect(diff.upserts).toHaveLength(0);
    expect(diff.deletes).toHaveLength(0);
  });

  it('AC-TSE-017: a note on a row with no non-zero hours persists nothing (absence==zero; no fabricated entries)', () => {
    // Row has only blank/zero cells; a note alone must not create a 0-hour entry.
    const rows: EditRow[] = [row('P', ['', '', ''], 'orphan note')];
    const diff = diffEntries(rows, WEEK, [], 'ts1');
    expect(diff.upserts).toHaveLength(0);
    expect(diff.deletes).toHaveLength(0);
  });
});

describe('AC-WCA-016 diffEntries carries a row\'s work order and discipline (#2517)', () => {
  const attributed = (r: EditRow, workOrderId: string | null, disciplineId: string | null): EditRow => ({ ...r, attribution: { workOrderId, disciplineId } });

  it('keeps each existing line attribution when only hours change on a mixed row', () => {
    const server = [
      { id: 'a', project_id: 'P', entry_date: WEEK[0], hours: 8, work_order_id: 'wo1', discipline_id: null },
      { id: 'b', project_id: 'P', entry_date: WEEK[1], hours: 6, work_order_id: 'wo2', discipline_id: null },
    ];
    const r = { ...attributed(row('P', ['7', '6']), 'wo1', null), originalAttribution: { workOrderId: 'wo1', disciplineId: null } };
    expect(diffEntries([r], WEEK, server, 'ts1').upserts).toEqual([
      expect.objectContaining({ entry_date: WEEK[0], hours: 7 }),
    ]);
    expect(diffEntries([r], WEEK, server, 'ts1').upserts[0]).not.toHaveProperty('work_order_id');
  });

  it('AC-WCA-016 a new line of an attributed row is saved with its work order and discipline', () => {
    const diff = diffEntries([attributed(row('P', ['8']), 'wo1', 'd1')], WEEK, [], 'ts1');
    expect(diff.upserts).toEqual([
      { timesheet_id: 'ts1', project_id: 'P', entry_date: '2026-06-01', hours: 8, notes: null, work_order_id: 'wo1', discipline_id: 'd1' },
    ]);
  });

  it('AC-WCA-016 changing only the work order re-saves the row\'s existing lines (hours unchanged)', () => {
    const server = [{ id: 'se1', project_id: 'P', entry_date: '2026-06-01', hours: 8, work_order_id: 'wo1', discipline_id: null }];
    const diff = diffEntries([attributed(row('P', ['8']), 'wo2', null)], WEEK, server, 'ts1');
    expect(diff.upserts).toEqual([
      { timesheet_id: 'ts1', project_id: 'P', entry_date: '2026-06-01', hours: 8, notes: null, work_order_id: 'wo2', discipline_id: null },
    ]);
  });

  it('AC-WCA-016 an unchanged attribution produces no write, and a row without one sends no attribution keys', () => {
    const server = [{ id: 'se1', project_id: 'P', entry_date: '2026-06-01', hours: 8, work_order_id: 'wo1', discipline_id: 'd1' }];
    expect(diffEntries([attributed(row('P', ['8']), 'wo1', 'd1')], WEEK, server, 'ts1').upserts).toEqual([]);
    const plain = diffEntries([row('P', ['6'])], WEEK, server, 'ts1');
    expect(plain.upserts).toEqual([{ timesheet_id: 'ts1', project_id: 'P', entry_date: '2026-06-01', hours: 6, notes: null }]);
  });
});
