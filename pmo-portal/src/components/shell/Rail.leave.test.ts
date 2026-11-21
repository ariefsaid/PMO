import { describe, it, expect } from 'vitest';
import { UserRole } from '@/types';
import { visibleNavItems } from './Rail';

const base = {
  role: UserRole.Engineer, realRole: UserRole.Engineer, featureEnabled: () => true, canViewStatements: false,
  userViewsEnabled: false, hasEligibleTimesheets: false,
};

describe('leave navigation entry (#2708)', () => {
  it('OFF: no leave entry unless the organisation switched leave requests on', () => {
    expect(visibleNavItems(base).some((i) => i.to === '/leave')).toBe(false);
    expect(visibleNavItems({ ...base, leaveEnabled: false }).some((i) => i.to === '/leave')).toBe(false);
  });
  it('ON: the entry appears', () => {
    expect(visibleNavItems({ ...base, leaveEnabled: true }).some((i) => i.to === '/leave')).toBe(true);
  });
});
