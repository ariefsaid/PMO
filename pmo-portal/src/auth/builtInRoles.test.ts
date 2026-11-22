import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_ROLES, ROLE_CAPABILITIES, baseLevelOf, builtInRoleName, roleHasCapability, roleMayApprove, roleMayPrepare,
  roleMayStandIn, roleSeesPrices,
} from './builtInRoles';

const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/1200_builtin_role_catalogue.sql'), 'utf8');
const priceRightSql = readFileSync(resolve(__dirname, '../../../supabase/migrations/1850_price_right_office_roles.sql'), 'utf8');
const sqlRoles = [...sql.matchAll(/^\('([a-z_]+)','([^']+)','(\w+)','(\w+)',(\d+),'([^']+)','([^']+)'\)[,;]$/gm)]
  .map((m) => ({ key: m[1], base: m[2], tier: m[3], functionKey: m[4], sortOrder: Number(m[5]), nameEn: m[6], nameId: m[7] }));
const capTuples = (text: string) => [...text.matchAll(/^\('([a-z_]+)','([a-z_]+)'\)[,;]$/gm)].map((m) => [m[1], m[2]]);
// 1200 seeds the catalogue; 1850 adds the price-right rows. The union, in migration order, is the frontend mirror.
const sqlCaps = [...capTuples(sql), ...capTuples(priceRightSql)];

describe('AC-003 built-in roles: frontend table equals the database seed (migrations 1200 and 1850)', () => {
  it('has the same 28 roles, base levels, tiers, functions and names', () => {
    expect(sqlRoles).toHaveLength(28);
    expect([...BUILT_IN_ROLES]).toEqual(sqlRoles);
  });
  it('has the same capabilities', () => {
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

describe('AC-007/008/010 capabilities, prices, tiers', () => {
  it('Storekeeper posts, Material Coordinator approves, nobody else does either', () => {
    expect(roleHasCapability('storekeeper', 'stock_post')).toBe(true);
    expect(roleHasCapability('storekeeper', 'stock_approve')).toBe(false);
    expect(roleHasCapability('material_coordinator', 'stock_approve')).toBe(true);
    expect(roleHasCapability(null, 'stock_post')).toBe(false);
  });
  it('medical documents exclude Executive', () => {
    expect(roleHasCapability('executive', 'medical_documents_view')).toBe(false);
    expect(roleHasCapability('hr_officer', 'medical_documents_view')).toBe(true);
  });
  it('prices: every role sees them except Foreman and Field user; no key sees them', () => {
    expect(roleSeesPrices(null)).toBe(true);
    expect(roleSeesPrices('buyer')).toBe(true);
    expect(roleSeesPrices('storekeeper')).toBe(true);
    expect(roleSeesPrices('foreman')).toBe(false);
    expect(roleSeesPrices('field_user')).toBe(false);
    expect(roleSeesPrices('nonsense')).toBe(false);
  });
  it('tiers and stand-in', () => {
    expect(roleMayApprove('project_manager')).toBe(true);
    expect(roleMayApprove('planner')).toBe(false);
    expect(roleMayPrepare('planner')).toBe(true);
    expect(roleMayStandIn('deputy_project_manager', 'project_manager')).toBe(true);
    expect(roleMayStandIn('project_manager', 'executive')).toBe(false);
    expect(roleMayStandIn('planner', 'project_manager')).toBe(false);
  });
  it('names follow the language, defaulting to English', () => {
    expect(builtInRoleName('storekeeper', 'en')).toBe('Storekeeper');
    expect(builtInRoleName('storekeeper', 'id')).toBe('Penjaga Gudang');
  });
});
