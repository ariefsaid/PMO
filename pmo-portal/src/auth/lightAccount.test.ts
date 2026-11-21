/** AC-LA-009 (#2710) — the frontend seat-type mirror equals the database rule over all 28 keys. */
import { describe, expect, it } from 'vitest';
import { BUILT_IN_ROLES } from './builtInRoles';
import { isLightAccount, LIGHT_ROLE_KEYS, seatTypeOf } from './lightAccount';

describe('AC-LA-009 seat type', () => {
  it('is light for exactly foreman and field_user, full for the other 26', () => {
    const light = BUILT_IN_ROLES.filter((r) => seatTypeOf(r.key) === 'light').map((r) => r.key).sort();
    expect(light).toEqual(['field_user', 'foreman']);
    expect(BUILT_IN_ROLES.filter((r) => seatTypeOf(r.key) === 'full')).toHaveLength(26);
  });
  it('the light roles are exactly the field tier', () => {
    expect(BUILT_IN_ROLES.filter((r) => r.tier === 'field').map((r) => r.key).sort()).toEqual([...LIGHT_ROLE_KEYS].sort());
  });
  it('a person with no key, or an unknown key, is full', () => {
    expect(seatTypeOf(null)).toBe('full');
    expect(seatTypeOf(undefined)).toBe('full');
    expect(seatTypeOf('nonsense')).toBe('full');
  });
  it('isLightAccount reads the profile key and is false for legacy people', () => {
    expect(isLightAccount({ built_in_role: 'foreman' })).toBe(true);
    expect(isLightAccount({ built_in_role: 'engineer' })).toBe(false);
    expect(isLightAccount({ built_in_role: null })).toBe(false);
    expect(isLightAccount(null)).toBe(false);
  });
});
