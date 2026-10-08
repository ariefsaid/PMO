import { describe, expect, it } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const roles: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];

describe('AC-BUPOT-015 withholding slip policy', () => {
  it('grants capture/correct/void only to Finance and Admin, with view-as read-only', () => {
    for (const action of ['create', 'edit', 'archive'] as const) {
      expect(roles.filter((realRole) => can(action, 'vendorWithholdingSlip', { realRole }))).toEqual(['Admin', 'Finance']);
      expect(can(action, 'vendorWithholdingSlip', { realRole: 'Finance', record: { viewOnly: true } })).toBe(false);
    }
    expect(roles.every((realRole) => can('view', 'vendorWithholdingSlip', { realRole }))).toBe(true);
  });
});
