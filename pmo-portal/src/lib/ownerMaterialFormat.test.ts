import { describe, expect, it } from 'vitest';
import { categoryLabel, locationLabel } from './ownerMaterialFormat';

describe('AC-008 material labels never print the same text twice', () => {
  it('a location whose code is its name (ignoring case and spaces) shows once; different ones show both', () => {
    expect(locationLabel('LOC_ALPHA', 'LOC_ALPHA')).toBe('LOC_ALPHA');
    expect(locationLabel('loc alpha', 'LOC ALPHA')).toBe('LOC ALPHA');
    expect(locationLabel('L2', 'South yard')).toBe('L2 · South yard');
    expect(locationLabel(null, 'South yard')).toBe('South yard');
  });
  it('a category shows its name, its code only without a name, and nothing without a code', () => {
    const cats = [{ code: 'PIPE', name: 'Piping' }, { code: 'X', name: ' ' }];
    expect(categoryLabel('PIPE', cats)).toBe('Piping');
    expect(categoryLabel('X', cats)).toBe('X');
    expect(categoryLabel('ZZ', cats)).toBe('ZZ');
    expect(categoryLabel(null, cats)).toBeNull();
  });
});
