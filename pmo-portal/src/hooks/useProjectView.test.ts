import { describe, it, expect, beforeEach } from 'vitest';
import { readProjectView, writeProjectView } from './useProjectView';
import { VIEWS_STORAGE_KEY } from './viewStorage';

describe('useProjectView persistence (VIEW.project)', () => {
  beforeEach(() => sessionStorage.clear());

  it('defaults to table when nothing is stored', () => {
    expect(readProjectView()).toBe('table');
  });

  it('round-trips a stored view', () => {
    writeProjectView('cards');
    expect(readProjectView()).toBe('cards');
  });

  it('persists under the project key without clobbering sibling surface keys', () => {
    sessionStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify({ procurement: 'board' }));
    writeProjectView('cards');
    const map = JSON.parse(sessionStorage.getItem(VIEWS_STORAGE_KEY)!);
    expect(map.project).toBe('cards');
    expect(map.procurement).toBe('board');
  });

  it('falls back to table for an out-of-range stored value', () => {
    sessionStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify({ project: 'kanban' }));
    expect(readProjectView()).toBe('table');
  });

  it('falls back to table for a corrupt map', () => {
    sessionStorage.setItem(VIEWS_STORAGE_KEY, '{not json');
    expect(readProjectView()).toBe('table');
  });
});
