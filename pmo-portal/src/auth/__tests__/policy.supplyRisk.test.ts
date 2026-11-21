import { describe, it, expect } from 'vitest';
import { can } from '../policy';
import type { Role } from '../AuthContext';

/** can(*, 'supplyRisk') — #2583 (FR-VSR-016, OD-VSR-3). The FE mirror of set_vendor_supply_status (Admin, Finance); UX only. */
describe("can(set, 'supplyRisk')", () => {
  it.each<[Role, boolean]>([
    ['Admin', true],
    ['Finance', true],
    ['Executive', false],
    ['Project Manager', false],
    ['Engineer', false],
  ])('%s -> %s', (role, expected) => {
    expect(can('set', 'supplyRisk', { realRole: role })).toBe(expected);
  });
  it('no role -> denied', () => {
    expect(can('set', 'supplyRisk', { realRole: null })).toBe(false);
  });
});

describe("can(view, 'supplyRisk')", () => {
  it('is offered to the Master-data roles', () => {
    for (const role of ['Admin', 'Executive', 'Project Manager', 'Finance'] as Role[]) {
      expect(can('view', 'supplyRisk', { realRole: role })).toBe(true);
    }
  });
  it('is not offered to an Engineer', () => {
    expect(can('view', 'supplyRisk', { realRole: 'Engineer' })).toBe(false);
  });
});
