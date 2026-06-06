import { describe, it, expect, beforeEach } from 'vitest';
import { readTimesheetsView, writeTimesheetsView } from './useTimesheetsView';
import { VIEWS_STORAGE_KEY } from '@/src/components/shell/workspaceTabs';

describe('useTimesheetsView — persisted Grid/Approvals toggle (Issue 6)', () => {
  beforeEach(() => sessionStorage.clear());

  it('defaults to grid when nothing is stored', () => {
    expect(readTimesheetsView()).toBe('grid');
  });

  it('round-trips a stored view', () => {
    writeTimesheetsView('approvals');
    expect(readTimesheetsView()).toBe('approvals');
  });

  it('ignores an out-of-range stored value', () => {
    sessionStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify({ timesheets: 'queue' }));
    expect(readTimesheetsView()).toBe('grid');
  });

  it('preserves sibling-surface view keys when writing', () => {
    sessionStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify({ pipeline: 'table' }));
    writeTimesheetsView('approvals');
    const map = JSON.parse(sessionStorage.getItem(VIEWS_STORAGE_KEY)!);
    expect(map).toEqual({ pipeline: 'table', timesheets: 'approvals' });
  });
});
