import { describe, expect, it } from 'vitest';
import { canSeePrices } from './priceVisibility';
import { BUILT_IN_ROLES } from './builtInRoles';

// AC-PVR-007 (#2699): mirrors the database truth table in supabase/tests/1850_price_visibility_roles.test.sql (independent literal list).
const HIDDEN_ROLES = ['foreman', 'field_user'];
const ALL_ROLES = [
  'executive', 'administrator', 'project_manager', 'deputy_project_manager', 'project_administrator', 'project_control_manager',
  'engineer', 'planner', 'quantity_surveyor', 'billing_officer', 'construction_manager', 'site_supervisor', 'foreman',
  'material_coordinator', 'storekeeper', 'procurement_manager', 'buyer', 'finance_manager', 'finance_officer', 'quality_manager',
  'quality_inspector', 'safety_manager', 'safety_officer', 'equipment_manager', 'equipment_officer', 'hr_manager', 'hr_officer',
  'field_user',
];

describe('AC-PVR-007 canSeePrices', () => {
  it('lists the same 28 roles as the catalogue', () => {
    expect(ALL_ROLES).toHaveLength(28);
    expect([...ALL_ROLES].sort()).toEqual(BUILT_IN_ROLES.map((r) => r.key).sort());
  });
  it.each(ALL_ROLES)('%s, setting on', (key) => {
    expect(canSeePrices({ settingOn: true, builtInRoleKey: key })).toBe(!HIDDEN_ROLES.includes(key));
  });
  it.each(ALL_ROLES)('%s, setting off: nobody loses anything', (key) => {
    expect(canSeePrices({ settingOn: false, builtInRoleKey: key })).toBe(true);
  });
  it('a person with no job role sees prices, setting on', () => {
    expect(canSeePrices({ settingOn: true, builtInRoleKey: null })).toBe(true);
  });
  it('an inactive member sees nothing while the setting is on', () => {
    expect(canSeePrices({ settingOn: true, builtInRoleKey: null, active: false })).toBe(false);
  });
  it('an unknown key fails closed', () => {
    expect(canSeePrices({ settingOn: true, builtInRoleKey: 'not_a_role' })).toBe(false);
  });
});
