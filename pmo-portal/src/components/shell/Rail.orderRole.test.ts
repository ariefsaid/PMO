import { describe, it, expect } from 'vitest';
import { UserRole } from '@/types';
import { visibleNavItems } from './Rail';

const base = {
  role: UserRole.Engineer, realRole: UserRole.Engineer, featureEnabled: () => true, canViewStatements: false,
  userViewsEnabled: false, hasEligibleTimesheets: false,
};

describe('AC-RTD-015 the Procurement entry for a person who orders by built-in role', () => {
  it('appears for requesters as well as people who may order', () => {
    expect(visibleNavItems(base).some((i) => i.to === '/procurement')).toBe(true);
    expect(visibleNavItems({ ...base, mayOrderPurchases: true }).some((i) => i.to === '/procurement')).toBe(true);
  });
  it('keeps the requester destination when viewing as Engineer and respects the module switch', () => {
    expect(visibleNavItems({ ...base, realRole: UserRole.Admin, mayOrderPurchases: true }).some((i) => i.to === '/procurement')).toBe(true);
    expect(visibleNavItems({ ...base, realRole: UserRole.Admin, mayOrderPurchases: true, featureEnabled: () => false }).some((i) => i.to === '/procurement')).toBe(false);
  });
});
