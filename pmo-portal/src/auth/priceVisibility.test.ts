import { describe, expect, it } from 'vitest';
import { canSeePrices } from './priceVisibility';
import type { Role } from './AuthContext';

// AC-008 (#2699): mirrors the database truth table in supabase/tests/1215_hide_prices.test.sql (independent literal list).
const CASES: Array<[string, Role, string | null, boolean, boolean]> = [
  // label, base level, built-in key, setting on, expected
  ['legacy Engineer, setting on', 'Engineer', null, true, false],
  ['legacy Project Manager', 'Project Manager', null, true, true],
  ['legacy Finance', 'Finance', null, true, true],
  ['legacy Executive', 'Executive', null, true, true],
  ['legacy Admin', 'Admin', null, true, true],
  ['Buyer', 'Engineer', 'buyer', true, true],
  ['Finance Officer', 'Finance', 'finance_officer', true, true],
  ['Billing Officer', 'Finance', 'billing_officer', true, true],
  ['Project Manager role', 'Project Manager', 'project_manager', true, true],
  ['Storekeeper', 'Engineer', 'storekeeper', true, false],
  ['Foreman', 'Engineer', 'foreman', true, false],
  ['Site Supervisor', 'Engineer', 'site_supervisor', true, false],
  ['legacy Engineer, setting off', 'Engineer', null, false, true],
  ['Storekeeper, setting off', 'Engineer', 'storekeeper', false, true],
];

describe('AC-008 canSeePrices', () => {
  it.each(CASES)('%s', (_l, baseRole, builtInRoleKey, settingOn, expected) => {
    expect(canSeePrices({ settingOn, baseRole, builtInRoleKey })).toBe(expected);
  });
  it('an inactive member sees nothing while the setting is on', () => {
    expect(canSeePrices({ settingOn: true, baseRole: 'Admin', builtInRoleKey: null, active: false })).toBe(false);
  });
  it('an unknown key fails closed', () => {
    expect(canSeePrices({ settingOn: true, baseRole: 'Admin', builtInRoleKey: 'not_a_role' })).toBe(false);
  });
});
