import { describe, it, expect } from 'vitest';
import { routeWrite, EMPTY_OWNERSHIP_MAP, type OwnershipMap } from './router.ts';

describe('AC-EAS-001 empty ownership map ⇒ write takes the direct-DAL path (byte-for-byte)', () => {
  it('AC-EAS-001 routeWrite returns pmo for an empty map (short-circuit FIRST)', () => {
    expect(routeWrite('reference', EMPTY_OWNERSHIP_MAP)).toBe('pmo');
    expect(routeWrite('anything', {} as OwnershipMap)).toBe('pmo');
  });
});

describe('AC-EAS-014 the ownership-decision routes by own-org ownership only', () => {
  const orgAMap: OwnershipMap = { reference: 'reference' };
  it('AC-EAS-014 an assigned domain routes to dispatch', () => {
    expect(routeWrite('reference', orgAMap)).toBe('external');
  });
  it('AC-EAS-014 an unassigned domain routes to the direct DAL', () => {
    expect(routeWrite('tasks', orgAMap)).toBe('pmo');
  });
  it('AC-EAS-014 org B rows never affect org A branch (router only sees the passed map)', () => {
    expect(routeWrite('reference', orgAMap)).toBe('external');
    expect(routeWrite('accounting', orgAMap)).toBe('pmo');
  });
});
