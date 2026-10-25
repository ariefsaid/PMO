import { describe, expect, it } from 'vitest';
import { sortSalesProjects } from './salesWorkingSet';

describe('Sales activity ordering', () => {
  const projects = [
    { id: 'missing-b', name: 'Maple', last_update: undefined },
    { id: 'late', name: 'Aster', last_update: '2026-04-10T12:00:00.000Z' },
    { id: 'early-z', name: 'Birch', last_update: '2026-04-01T12:00:00.000Z' },
    { id: 'invalid', name: 'Maple', last_update: 'not-a-date' },
    { id: 'early-a', name: 'Birch', last_update: '2026-04-01T12:00:00.000Z' },
  ];

  it('AC-SALES-C03: puts unavailable activity first, then oldest activity with stable name and ID ties', () => {
    expect(sortSalesProjects(projects, 'activity-oldest').map(({ id }) => id)).toEqual([
      'invalid',
      'missing-b',
      'early-a',
      'early-z',
      'late',
    ]);
  });

  it('AC-SALES-C03: keeps unavailable activity first when known activity is newest-first', () => {
    expect(sortSalesProjects(projects, 'activity-newest').map(({ id }) => id)).toEqual([
      'invalid',
      'missing-b',
      'late',
      'early-a',
      'early-z',
    ]);
    expect(projects.map(({ id }) => id)).toEqual([
      'missing-b',
      'late',
      'early-z',
      'invalid',
      'early-a',
    ]);
  });
});
