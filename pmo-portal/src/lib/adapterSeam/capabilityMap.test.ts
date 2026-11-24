import { describe, it, expect } from 'vitest';
import { canAssignDomainToTier, assertDomainInCapabilityMap, CapabilityMapError, stockMatchingCapabilities, accountingSetupCapabilities } from './capabilityMap.ts';

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
  it('AC-OSP-001 stockMatchingCapabilities reads each tier declaration', () => {
    expect(stockMatchingCapabilities('odoo').stockMatching).toBe(true);
    expect(stockMatchingCapabilities('erpnext').stockMatching).toBe(false);
    expect(stockMatchingCapabilities('unknown').stockMatching).toBe(false);
    expect(stockMatchingCapabilities(undefined).stockMatching).toBe(false);
  });
  it('AC-NATIVE-EQU-003 accounting setup follows tier capabilities, including unknown and non-accounting tiers', () => {
    expect(accountingSetupCapabilities('erpnext').accounting).toBe(true);
    expect(accountingSetupCapabilities('odoo').accounting).toBe(true);
    expect(accountingSetupCapabilities('clickup').accounting).toBe(false);
    expect(accountingSetupCapabilities('unknown').accounting).toBe(false);
    expect(accountingSetupCapabilities(undefined).accounting).toBe(false);
  });
});
