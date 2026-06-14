import { describe, it, expect } from 'vitest';
import { modulesForRole } from '../routeMatch';
import { UserRole } from '../../../../types';

/**
 * Fix #7 — Finance approvals-nav: ⌘K Navigate must include Approvals for Finance,
 * Admin, Exec, PM (procurement approvers) but NOT Engineer.
 */
describe('modulesForRole — Approvals in ⌘K Navigate (fix #7)', () => {
  it('AC-FIX7-CMDK-01: Finance sees Approvals in ⌘K Navigate', () => {
    const modules = modulesForRole(UserRole.Finance).map((m) => m.module);
    expect(modules).toContain('approvals');
  });

  it('AC-FIX7-CMDK-02: Executive sees Approvals in ⌘K Navigate', () => {
    const modules = modulesForRole(UserRole.Executive).map((m) => m.module);
    expect(modules).toContain('approvals');
  });

  it('AC-FIX7-CMDK-03: Admin sees Approvals in ⌘K Navigate', () => {
    const modules = modulesForRole(UserRole.Admin).map((m) => m.module);
    expect(modules).toContain('approvals');
  });

  it('AC-FIX7-CMDK-04: PM sees Approvals in ⌘K Navigate', () => {
    const modules = modulesForRole(UserRole.ProjectManager).map((m) => m.module);
    expect(modules).toContain('approvals');
  });

  it('AC-FIX7-CMDK-05: Engineer does NOT see Approvals in ⌘K Navigate', () => {
    const modules = modulesForRole(UserRole.Engineer).map((m) => m.module);
    expect(modules).not.toContain('approvals');
  });
});
