import { describe, expect, it } from 'vitest';
import { sortProjectRows, type ProjectSort } from './projectSorting';

type Row = { id: string; name: string; end_date: string | null; risk: boolean };

const sort = (rows: Row[], mode: ProjectSort = 'attention') =>
  sortProjectRows(rows, mode, (project) => project.risk);

describe('project collection sort order', () => {
  it('keeps confirmed budget risk first, then dates, with undated projects last', () => {
    const rows: Row[] = [
      { id: 'z', name: 'Zephyr', end_date: '2026-10-01', risk: false },
      { id: 'b', name: 'Beacon', end_date: null, risk: true },
      { id: 'a', name: 'Atlas', end_date: '2026-12-01', risk: true },
      { id: 'c', name: 'Cedar', end_date: '2026-12-01', risk: true },
      { id: 'u', name: 'Undated', end_date: null, risk: false },
      { id: 'x', name: 'Alder', end_date: '2026-10-01', risk: false },
    ];

    expect(sort(rows).map(({ id }) => id)).toEqual(['a', 'c', 'b', 'x', 'z', 'u']);
  });

  it('sorts by expected end without applying the risk grouping', () => {
    const rows: Row[] = [
      { id: 'late', name: 'Late', end_date: '2027-01-01', risk: true },
      { id: 'early', name: 'Early', end_date: '2026-01-01', risk: false },
      { id: 'undated', name: 'Undated', end_date: null, risk: true },
    ];

    expect(sort(rows, 'expected-end').map(({ id }) => id)).toEqual(['early', 'late', 'undated']);
  });

  it('sorts by project name with the record id as the final tie breaker', () => {
    const rows: Row[] = [
      { id: 'b', name: 'Atlas', end_date: null, risk: true },
      { id: 'c', name: 'beacon', end_date: null, risk: false },
      { id: 'a', name: 'ATLAS', end_date: null, risk: false },
    ];

    expect(sort(rows, 'name').map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });
});
