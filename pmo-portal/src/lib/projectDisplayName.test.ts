import { describe, expect, it } from 'vitest';
import { projectDisplayName, projectPickerLabel } from './projectDisplayName';

describe('project display identity (AC-002 #1325)', () => {
  it('prefers a trimmed alias without mutating its row', () => {
    const row = { id: 'same-id', name: 'Contractual Name', short_name: '  Site A  ' };
    expect(projectDisplayName(row)).toBe('Site A');
    expect(projectPickerLabel(row)).toBe('Site A — Contractual Name');
    expect(row).toEqual({ id: 'same-id', name: 'Contractual Name', short_name: '  Site A  ' });
  });
  it.each([null, undefined, '', '  \n'])('falls back for empty alias %s', (short_name) => {
    const row = { name: 'Contractual Name', short_name };
    expect(projectDisplayName(row)).toBe('Contractual Name');
    expect(projectPickerLabel(row)).toBe('Contractual Name');
  });
  it('does not duplicate a short name equal to the contractual title and keeps duplicate aliases distinct by id', () => {
    expect(projectPickerLabel({ name: 'Same', short_name: ' Same ' })).toBe('Same');
    const records = [{ id: 'p1', name: 'Legal 1', short_name: 'Shared' }, { id: 'p2', name: 'Legal 2', short_name: 'Shared' }];
    expect(records.map((row) => [row.id, projectDisplayName(row)])).toEqual([['p1', 'Shared'], ['p2', 'Shared']]);
  });
});
