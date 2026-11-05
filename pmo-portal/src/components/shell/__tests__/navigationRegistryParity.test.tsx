import { describe, expect, it } from 'vitest';
import { UserRole } from '@/types';
import { MODULES } from '../routeMatch';
import { ALL_ITEMS as RAIL_NAV_ITEMS } from '../Rail';

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
    }

    expect(mismatches).toEqual([]);
  });

  it('every rail item resolves through a MODULES path (no rail-only route strings)', () => {
    const modulePaths = new Set(MODULES.map((m) => m.path));
    const railOnly = RAIL_NAV_ITEMS.filter((item) => !modulePaths.has(item.to)).map((item) => item.to);
    expect(railOnly).toEqual([]);
  });
});
