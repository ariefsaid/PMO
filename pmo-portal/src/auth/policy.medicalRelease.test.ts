import { describe, it, expect } from 'vitest';
import { can } from './policy';

describe('medical release withdraw and reassign (1934, UX only)', () => {
  const pending = { status: 'Pending', own: false, decider_active: true };
  it('withdraw: an Admin or the people team, on a release that is not approved and not their own', () => {
    expect(can('withdraw', 'medicalRelease', { realRole: 'Admin', record: pending })).toBe(true);
    expect(can('withdraw', 'medicalRelease', { realRole: 'Engineer', builtInRoleKey: 'hr_officer', record: { ...pending, status: 'Deferred' } })).toBe(true);
    expect(can('withdraw', 'medicalRelease', { realRole: 'Project Manager', builtInRoleKey: 'project_manager', record: pending })).toBe(false);
    expect(can('withdraw', 'medicalRelease', { realRole: 'Admin', record: { ...pending, status: 'Approved' } })).toBe(false);
    expect(can('withdraw', 'medicalRelease', { realRole: 'Engineer', builtInRoleKey: 'hr_officer', record: { ...pending, own: true } })).toBe(false);
    expect(can('withdraw', 'medicalRelease', { realRole: 'Admin', record: { ...pending, viewOnly: true } })).toBe(false);
  });
  it('reassign: an Admin only, once the fixed decider is no longer active', () => {
    const left = { ...pending, decider_active: false };
    expect(can('reassign', 'medicalRelease', { realRole: 'Admin', record: left })).toBe(true);
    expect(can('reassign', 'medicalRelease', { realRole: 'Admin', record: pending })).toBe(false);
    expect(can('reassign', 'medicalRelease', { realRole: 'Engineer', builtInRoleKey: 'hr_officer', record: left })).toBe(false);
    expect(can('reassign', 'medicalRelease', { realRole: 'Admin', record: { ...left, status: 'Approved' } })).toBe(false);
  });
});
