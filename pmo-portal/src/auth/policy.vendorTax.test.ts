import { describe, expect, it } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const ROLES: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];

describe('AC-VWH-027 vendor tax defaults policy (mirrors set_vendor_tax_defaults, migration 0273)', () => {
  it('AC-VWH-027 vendor tax defaults are managed by Admin and Finance only', () => {
    expect(ROLES.filter((r) => can('manage', 'vendorTaxDefault', { realRole: r }))).toEqual(['Admin', 'Finance']);
  });
});
