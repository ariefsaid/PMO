import { describe, expect, it } from 'vitest';
import { UserRole } from '@/types';
import { MODULES } from '../routeMatch';
import { ALL_ITEMS as RAIL_NAV_ITEMS } from '../Rail';
import { NAVIGATION_ORDER } from '../navigationOrder';

/**
 * Navigation-registry parity guard (single-source-of-truth drift gate).
 *
 * The rail's grouping registry and the ⌘K palette's MODULES registry are two views of one
 * navigation IA. When they drift, a destination becomes reachable in one surface but not the
 * other (a rail entry with no palette Navigate row, or a gate mismatch that hides a module the
 * role should reach). This guard pins every rail destination to a MODULES entry carrying the
 * SAME path (incl. query), roles and entitlement gates, so the next navigation change that
 * touches only one registry fails here instead of shipping the drift.
 */
const ALL_ROLES = Object.values(UserRole) as string[];

const CANONICAL_NAV_ORDER: readonly string[] = NAVIGATION_ORDER.filter((path) => path !== '/administration');

const roleSetOf = (roles: UserRole[] | undefined) => new Set(roles && roles.length ? roles : ALL_ROLES);

describe('navigation registry parity — every rail destination exists in MODULES with matching gates', () => {
  it('each rail item has a MODULES entry with the same path, roles and entitlement gates', () => {
    const mismatches: string[] = [];

    for (const item of RAIL_NAV_ITEMS) {
      const route = MODULES.find((m) => m.path === item.to);
      if (!route) {
        mismatches.push(`${item.to}: no MODULES entry for the rail destination`);
        continue;
      }
      const railRoles = roleSetOf(item.roles);
      const moduleRoles = roleSetOf(route.roles);
      const missingInModule = [...railRoles].filter((r) => !moduleRoles.has(r));
      const missingInRail = [...moduleRoles].filter((r) => !railRoles.has(r));
      if (missingInModule.length || missingInRail.length) {
        mismatches.push(
          `${item.to}: role gates differ — rail-only [${missingInModule}], module-only [${missingInRail}]`,
        );
      }
      if ((route.feature ?? null) !== (item.feature ?? null)) {
        mismatches.push(`${item.to}: feature gate differs — rail=${item.feature ?? 'none'}, module=${route.feature ?? 'none'}`);
      }
      if ((route.unlessFeature ?? null) !== (item.unlessFeature ?? null)) {
        mismatches.push(`${item.to}: unlessFeature gate differs — rail=${item.unlessFeature ?? 'none'}, module=${route.unlessFeature ?? 'none'}`);
      }
      if (route.icon !== item.icon) {
        mismatches.push(`${item.to}: icons differ — rail=${item.icon}, search=${route.icon}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('every rail item resolves through a MODULES path (no rail-only route strings)', () => {
    const modulePaths = new Set(MODULES.map((m) => m.path));
    const railOnly = RAIL_NAV_ITEMS.filter((item) => !modulePaths.has(item.to)).map((item) => item.to);
    expect(railOnly).toEqual([]);
  });

  it('the search destinations use the same canonical order as the rail registry', () => {
    expect(MODULES.map((module) => module.path)).toEqual(NAVIGATION_ORDER);
  });

  it.each([
    ['Executive', UserRole.Executive],
    ['Finance', UserRole.Finance],
    ['Project Manager', UserRole.ProjectManager],
    ['Engineer with eligible decisions', UserRole.Engineer],
    ['Admin', UserRole.Admin],
  ])('%s rail is a subsequence of the shared ordered registry', (_label, role) => {
    expect(RAIL_NAV_ITEMS.map((item) => item.to)).toEqual(CANONICAL_NAV_ORDER);
    const visible = RAIL_NAV_ITEMS.filter((item) =>
      item.roles.includes(role) || (role === UserRole.Engineer && item.to === '/approvals'),
    );
    let cursor = 0;
    for (const item of visible) {
      const next = CANONICAL_NAV_ORDER.indexOf(item.to, cursor);
      expect(next, `${item.to} must preserve the canonical order`).toBeGreaterThanOrEqual(cursor);
      cursor = next + 1;
    }
  });

  it('feature-off role lists only hide gated entries and keep their canonical positions', () => {
    const featureOff = RAIL_NAV_ITEMS.filter((item) =>
      item.roles.includes(UserRole.ProjectManager) && !item.feature && (!item.unlessFeature || item.unlessFeature === 'crm'),
    );
    expect(featureOff.map((item) => item.to)).toEqual(
      CANONICAL_NAV_ORDER.filter((path) => featureOff.some((item) => item.to === path)),
    );
    expect(featureOff.some((item) => item.to === '/projects')).toBe(true);
    expect(featureOff.some((item) => item.to === '/sales')).toBe(false);
    expect(featureOff.some((item) => item.to === '/companies?type=Vendor')).toBe(true);
  });
});
