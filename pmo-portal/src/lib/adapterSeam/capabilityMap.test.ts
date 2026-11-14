import { describe, it, expect } from 'vitest';
import { canAssignDomainToTier, assertDomainInCapabilityMap, CapabilityMapError, tierHasCapability } from './capabilityMap.ts';

const cap = new Set(['reference', 'tasks']);

describe('AC-EAS-013 a domain assignment is bounded by the employed tier static capability map', () => {
  it('AC-EAS-013 a domain in the map is assignable', () => {
    expect(canAssignDomainToTier(cap, 'reference')).toBe(true);
    expect(canAssignDomainToTier(cap, 'tasks')).toBe(true);
  });
  it('AC-EAS-013 a domain NOT in the map is not assignable', () => {
    expect(canAssignDomainToTier(cap, 'accounting')).toBe(false);
  });
  it('AC-EAS-013 assertDomainInCapabilityMap throws for a domain outside the tier map', () => {
    expect(() => assertDomainInCapabilityMap(cap, 'clickup', 'accounting')).toThrow(CapabilityMapError);
  });
  it('AC-EAS-013 assertDomainInCapabilityMap passes for a domain inside the tier map', () => {
    expect(() => assertDomainInCapabilityMap(cap, 'clickup', 'reference')).not.toThrow();
  });
  it('tierHasCapability reports declared tier capabilities without tier branching', () => {
    expect(tierHasCapability('odoo', 'stock')).toBe(true);
    expect(tierHasCapability('erpnext', 'stock')).toBe(false);
    expect(tierHasCapability('unknown', 'stock')).toBe(false);
  });
});
