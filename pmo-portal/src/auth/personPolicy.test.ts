import { describe, it, expect } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const roles: Role[] = ['Admin', 'Project Manager', 'Finance', 'Executive', 'Engineer'];

describe('AC-PPL-008 person policy', () => {
  for (const action of ['create', 'edit', 'archive'] as const) {
    it(`${action}: follows the role rule`, () => {
      for (const r of roles) expect(can(action, 'person', { realRole: r })).toBe(r === 'Admin' || (r === 'Project Manager' && action !== 'archive'));
    });
    it(`${action}: refused while viewing as another role`, () => {
      expect(can(action, 'person', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
    });
  }
  it('view: every active role may read basic people', () => {
    for (const r of roles) expect(can('view', 'person', { realRole: r })).toBe(true);
  });
  it('setManager: only an Admin or the people team (HR) sets the direct manager (1930)', () => {
    expect(can('setManager', 'person', { realRole: 'Admin' })).toBe(true);
    expect(can('setManager', 'person', { realRole: 'Project Manager', builtInRoleKey: 'hr_manager' })).toBe(true);
    expect(can('setManager', 'person', { realRole: 'Engineer', builtInRoleKey: 'hr_officer' })).toBe(true);
    expect(can('setManager', 'person', { realRole: 'Project Manager', builtInRoleKey: 'project_manager' })).toBe(false);
    expect(can('setManager', 'person', { realRole: 'Project Manager' })).toBe(false);
    expect(can('setManager', 'person', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
  });
  it('setSelfAsManager: only an Admin names themselves (1930)', () => {
    expect(can('setSelfAsManager', 'person', { realRole: 'Admin' })).toBe(true);
    expect(can('setSelfAsManager', 'person', { realRole: 'Project Manager', builtInRoleKey: 'hr_manager' })).toBe(false);
  });
});
