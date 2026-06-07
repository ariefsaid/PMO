import { describe, it, expect, beforeEach } from 'vitest';
import { readProcurementView, writeProcurementView } from './useProcurementView';
import { VIEWS_STORAGE_KEY } from './viewStorage';

describe('useProcurementView — persisted Table/Board toggle (Issue 3)', () => {
  beforeEach(() => sessionStorage.clear());

  it('defaults to table when nothing is stored', () => {
    expect(readProcurementView()).toBe('table');
  });

  it('round-trips a stored view', () => {
    writeProcurementView('board');
    expect(readProcurementView()).toBe('board');
  });

  it('ignores an out-of-range stored value', () => {
    sessionStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify({ procurement: 'kanban' }));
    expect(readProcurementView()).toBe('table');
  });

  it('preserves sibling-surface view keys when writing', () => {
    sessionStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify({ pipeline: 'table' }));
    writeProcurementView('board');
    const map = JSON.parse(sessionStorage.getItem(VIEWS_STORAGE_KEY)!);
    expect(map).toEqual({ pipeline: 'table', procurement: 'board' });
  });
});
