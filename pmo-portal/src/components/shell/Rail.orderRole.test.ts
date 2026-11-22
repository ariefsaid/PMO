import { describe, it, expect } from 'vitest';
import { UserRole } from '@/types';
import { visibleNavItems } from './Rail';

const base = {
  role: UserRole.Engineer, realRole: UserRole.Engineer, featureEnabled: () => true, canViewStatements: false,
  userViewsEnabled: false, hasEligibleTimesheets: false,
};

describe('AC-RTD-015 the Procurement entry for a person who orders by built-in role', () => {
  it('appears only when the database gate says the person may order', () => {
    expect(visibleNavItems(base).some((i) => i.to === '/procurement')).toBe(false);
    expect(visibleNavItems({ ...base, mayOrderPurchases: true }).some((i) => i.to === '/procurement')).toBe(true);
  });
  it('never appears through viewing as another role', () => {
    expect(visibleNavItems({ ...base, realRole: UserRole.Admin, mayOrderPurchases: true }).some((i) => i.to === '/procurement')).toBe(false);
  });
});
