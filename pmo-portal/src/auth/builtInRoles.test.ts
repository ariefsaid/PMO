import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_ROLES, ROLE_CAPABILITIES, baseLevelOf, builtInRoleName, roleHasCapability, roleSeesPrices,
} from './builtInRoles';

const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/1200_builtin_role_catalogue.sql'), 'utf8');
const sqlRoles = [...sql.matchAll(/^\('([a-z_]+)','([^']+)','(\w+)','(\w+)',(\d+),'([^']+)','([^']+)'\)[,;]$/gm)]
  .map((m) => ({ key: m[1], base: m[2], tier: m[3], functionKey: m[4], sortOrder: Number(m[5]), nameEn: m[6], nameId: m[7] }));
// The capability rows are the 1200 seed less the rows migration 1539 deletes.
const prune = readFileSync(resolve(__dirname, '../../../supabase/migrations/1539_role_capabilities_prune.sql'), 'utf8');
const pruned = [...(/delete from public\.built_in_role_capabilities\s+where capability in \(([^)]*)\)/.exec(prune)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const seedCaps = [...sql.matchAll(/^\('([a-z_]+)','([a-z_]+)'\)[,;]$/gm)].map((m) => [m[1], m[2]]).filter(([, cap]) => !pruned.includes(cap));
// Migration 1771 adds the two billing-step rights after the seed.
const billing = readFileSync(resolve(__dirname, '../../../supabase/migrations/1771_billing_steps_capabilities.sql'), 'utf8');
const billingCaps = [...billing.matchAll(/^\('([a-z_]+)','(billing_steps_[a-z]+)'\)[,;]$/gm)].map((m) => [m[1], m[2]]);
const sqlCaps = [...seedCaps, ...billingCaps];

describe('AC-003 built-in roles: frontend table equals the database seed (migration 1200)', () => {
  it('has the same 28 roles, base levels, tiers, functions and names', () => {
    expect(sqlRoles).toHaveLength(28);
    expect([...BUILT_IN_ROLES]).toEqual(sqlRoles);
  });
  it('has the same capabilities', () => {
    expect(pruned).toHaveLength(5);
    expect(sqlCaps.length).toBeGreaterThan(0);
    expect(ROLE_CAPABILITIES.map(([k, c]) => [k, c])).toEqual(sqlCaps);
  });
});

describe('AC-001/AC-002 mapping', () => {
  it('maps every key to exactly one of the five access levels', () => {
    for (const role of BUILT_IN_ROLES) {
      expect(['Executive', 'Project Manager', 'Finance', 'Engineer', 'Admin']).toContain(baseLevelOf(role.key));
    }
    expect(new Set(BUILT_IN_ROLES.map((r) => r.key)).size).toBe(28);
  });
  it('spot values and fail-closed unknowns', () => {
    expect(baseLevelOf('billing_officer')).toBe('Finance');
    expect(baseLevelOf('project_administrator')).toBe('Engineer');
    expect(baseLevelOf('administrator')).toBe('Admin');
    expect(baseLevelOf(null)).toBeNull();
    expect(baseLevelOf('nonsense')).toBeNull();
  });
  it('splits 12 managers, 14 officers, 2 field', () => {
    const count = (tier: string) => BUILT_IN_ROLES.filter((r) => r.tier === tier).length;
    expect([count('manager'), count('officer'), count('field')]).toEqual([12, 14, 2]);
  });
});

describe('AC-007/008 capabilities and prices', () => {
  it('medical documents exclude Executive', () => {
    expect(roleHasCapability('executive', 'medical_documents_view')).toBe(false);
    expect(roleHasCapability('hr_officer', 'medical_documents_view')).toBe(true);
    expect(roleHasCapability(null, 'medical_documents_view')).toBe(false);
  });
  it('people documents: HR roles and Administrator only', () => {
    for (const key of ['hr_manager', 'hr_officer', 'administrator']) expect(roleHasCapability(key, 'people_documents_view')).toBe(true);
    for (const key of ['project_manager', 'planner', 'executive']) expect(roleHasCapability(key, 'people_documents_view')).toBe(false);
  });
  it('billing steps: the survey role sees and runs them, field roles hold neither (migration 1771)', () => {
    expect(roleHasCapability('quantity_surveyor', 'billing_steps_view')).toBe(true);
    expect(roleHasCapability('quantity_surveyor', 'billing_steps_run')).toBe(true);
    expect(roleHasCapability('quality_inspector', 'billing_steps_view')).toBe(false);
    for (const key of ['foreman', 'field_user']) {
      expect(roleHasCapability(key, 'billing_steps_view')).toBe(false);
      expect(roleHasCapability(key, 'billing_steps_run')).toBe(false);
    }
    expect(roleHasCapability(null, 'billing_steps_view')).toBe(false);
  });
  it('prices: legacy (no key) sees them, field and non-purchasing officers do not', () => {
    expect(roleSeesPrices(null)).toBe(true);
    expect(roleSeesPrices('buyer')).toBe(true);
    expect(roleSeesPrices('storekeeper')).toBe(false);
    expect(roleSeesPrices('nonsense')).toBe(false);
  });
  it('names follow the language, defaulting to English', () => {
    expect(builtInRoleName('storekeeper', 'en')).toBe('Storekeeper');
    expect(builtInRoleName('storekeeper', 'id')).toBe('Penjaga Gudang');
  });
});
