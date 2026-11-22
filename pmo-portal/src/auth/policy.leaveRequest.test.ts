import { describe, it, expect } from 'vitest';
import { can } from './policy';

/** #2708 leave requests — the UX gates (ADR-0016). The database is the authority (leave_requests.test.sql). */
const roles = ['Admin', 'Executive', 'Finance', 'Project Manager', 'Engineer'] as const;

describe('leaveRequest policy', () => {
  it.each(roles)('%s may request, cancel and decide (the row flag from the database narrows decide)', (role) => {
    for (const action of ['request', 'cancel', 'decide'] as const) {
      expect(can(action, 'leaveRequest', { realRole: role })).toBe(true);
      expect(can(action, 'leaveRequest', { realRole: role, record: { viewOnly: true } })).toBe(false);
    }
  });

  it.each(roles)('%s: only an Admin manages the leave settings', (role) => {
    expect(can('manage', 'leaveRequest', { realRole: role })).toBe(role === 'Admin');
    expect(can('manage', 'leaveRequest', { realRole: role, record: { viewOnly: true } })).toBe(false);
  });

  it('deny by default without a role', () => {
    for (const action of ['request', 'cancel', 'decide', 'manage'] as const) {
      expect(can(action, 'leaveRequest', { realRole: null })).toBe(false);
    }
  });
});
