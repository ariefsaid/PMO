import { describe, expect, it } from 'vitest';
import { compareProjectOptions, projectCodedPickerLabel, projectDisplayName, projectOptionSub, sortProjectOptions } from './projectDisplayName';

describe('project display identity (AC-002 #1325)', () => {
  it('prefers a trimmed alias without mutating its row', () => {
    const row = { id: 'same-id', name: 'Contractual Name', short_name: '  Site A  ' };
    expect(projectDisplayName(row)).toBe('Site A');
    expect(row).toEqual({ id: 'same-id', name: 'Contractual Name', short_name: '  Site A  ' });
  });
  it.each([null, undefined, '', '  \n'])('falls back for empty alias %s', (short_name) => {
    expect(projectDisplayName({ name: 'Contractual Name', short_name })).toBe('Contractual Name');
  });
  it('keeps duplicate aliases distinct by id', () => {
    const records = [{ id: 'p1', name: 'Legal 1', short_name: 'Shared' }, { id: 'p2', name: 'Legal 2', short_name: 'Shared' }];
    expect(records.map((row) => [row.id, projectDisplayName(row)])).toEqual([['p1', 'Shared'], ['p2', 'Shared']]);
  });
});

describe('sortProjectOptions (C18 scan order)', () => {
  it('sorts by the label a person reads, case- and accent-insensitive, numbers by value, id last, without mutating', () => {
    const rows = [
      { id: 'b', name: 'phase 10 upgrade' },
      { id: 'a', name: 'Phase 9 upgrade' },
      { id: 'd', name: 'Contractual Name', short_name: 'Arun' },
      { id: 'c', name: 'Legal B', short_name: 'Shared' },
      { id: 'a2', name: 'Legal A', short_name: 'Shared' },
    ];
    expect(sortProjectOptions(rows).map((row) => row.id)).toEqual(['d', 'a', 'b', 'a2', 'c']);
    expect(rows.map((row) => row.id)).toEqual(['b', 'a', 'd', 'c', 'a2']);
    expect(compareProjectOptions({ id: 'x', name: 'Same' }, { id: 'x', name: 'Same' })).toBe(0);
  });
});

describe('projectOptionSub (AC-002 #1325)', () => {
  it('puts the contractual title before the code only when an alias replaces it', () => {
    expect(projectOptionSub({ name: 'Legal', short_name: 'Alias', code: 'C-1' })).toBe('Legal · C-1');
    expect(projectOptionSub({ name: 'Legal', short_name: null, code: 'C-1' })).toBe('C-1');
    expect(projectOptionSub({ name: 'Same', short_name: ' Same ', code: null })).toBeUndefined();
  });
});

describe('projectCodedPickerLabel (AC-002 #1325, RF-061)', () => {
  const long = 'Regional Distribution Centre Phase Two Structural Retrofit and Commissioning Programme';
  it('shows code and the short name alone when an alias is set, never the long legal title', () => {
    expect(projectCodedPickerLabel({ name: long, short_name: 'Regional DC', code: 'P-777' }, 36)).toBe('P-777 · Regional DC');
  });
  it('truncates only an unaliased contractual title, and only when asked', () => {
    const cut = projectCodedPickerLabel({ name: long, code: 'P-777' }, 36);
    expect(cut).toMatch(/^P-777 · .+…$/);
    expect(cut.length).toBeLessThan(long.length);
    expect(projectCodedPickerLabel({ name: long, code: 'P-777' })).toBe(`P-777 · ${long}`);
    expect(projectCodedPickerLabel({ name: 'Short', code: null }, 36)).toBe('Short');
  });
});
