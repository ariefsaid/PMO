/** AC-TX-006 (#2712): a role's display name is the org's override per language, else the catalogue default. */
import { describe, it, expect } from 'vitest';
import { BUILT_IN_ROLES, builtInRoleName, baseLevelOf } from './builtInRoles';

describe('builtInRoleName', () => {
  it('defaults to the catalogue name in each language with no overrides (all 28 roles)', () => {
    for (const r of BUILT_IN_ROLES) {
      expect(builtInRoleName(r.key, 'en')).toBe(r.nameEn);
      expect(builtInRoleName(r.key, 'id-ID')).toBe(r.nameId);
      expect(builtInRoleName(r.key, 'en', {})).toBe(r.nameEn);
    }
  });
  it('an override wins in its own language only, and only for its role', () => {
    const o = { en: { storekeeper: 'Yard Lead' }, id: { storekeeper: 'Kepala Gudang' } };
    expect(builtInRoleName('storekeeper', 'en', o)).toBe('Yard Lead');
    expect(builtInRoleName('storekeeper', 'id', o)).toBe('Kepala Gudang');
    expect(builtInRoleName('buyer', 'en', o)).toBe('Buyer');
    expect(builtInRoleName('storekeeper', 'en', { id: o.id })).toBe('Storekeeper');
  });
  it('a blank override falls back; an unknown key resolves to itself', () => {
    expect(builtInRoleName('buyer', 'en', { en: { buyer: '   ' } })).toBe('Buyer');
    expect(builtInRoleName('nobody', 'en', { en: { nobody: 'X' } })).toBe('nobody');
  });
  it('renaming never changes the key or access level', () => {
    expect(baseLevelOf('storekeeper')).toBe('Engineer');
  });
});
