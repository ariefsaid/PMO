/**
 * Walk G9: the menu never offers a door the role is then refused at. An entry whose page gates by policy is listed only
 * when that same `can()` admits the reader; without a `can()` the role lists alone decide, as before.
 */
import { describe, it, expect } from 'vitest';
import { UserRole } from '@/types';
import type { Action, Entity } from '@/src/auth/policy';
import { visibleNavItems } from '../Rail';

const base = {
  role: UserRole.Finance,
  realRole: UserRole.Finance,
  featureEnabled: () => true,
  canViewStatements: true,
  userViewsEnabled: false,
  hasEligibleTimesheets: false,
};
const paths = (may?: (a: Action, e: Entity) => boolean) => visibleNavItems({ ...base, may }).map((i) => i.to);

describe('menu entries follow the destination page gate', () => {
  it('lists the Finance pages for a reader the finance gate admits', () => {
    expect(paths(() => true)).toEqual(expect.arrayContaining(['/finance', '/finance/receivables', '/finance/payables', '/journals']));
  });

  it('drops every Finance page for a reader the finance gate refuses, and keeps the rest of the menu', () => {
    const refusedFinance = (_a: Action, e: Entity) => e !== 'finance';
    const listed = paths(refusedFinance);
    expect(listed.filter((p) => p.startsWith('/finance') && p !== '/finance/statements')).toEqual([]);
    expect(listed).toEqual(expect.arrayContaining(['/', '/projects', '/journals']));
  });

  it('drops Site cash for a reader the float gate refuses', () => {
    expect(visibleNavItems({ ...base, role: UserRole.ProjectManager, realRole: UserRole.ProjectManager, may: (_a, e) => e !== 'imprestFloat' }).map((i) => i.to))
      .not.toContain('/imprest');
  });
});
