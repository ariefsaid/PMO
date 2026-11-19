import { describe, it, expect } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const roles: Role[] = ['Admin', 'Project Manager', 'Finance', 'Executive', 'Engineer'];

describe('AC-PPL-008 person policy mirrors the 0970 people RLS', () => {
  for (const action of ['create', 'edit', 'archive'] as const) {
    it(`${action}: Admin only`, () => {
      for (const r of roles) expect(can(action, 'person', { realRole: r })).toBe(r === 'Admin');
    });
    it(`${action}: refused while viewing as another role`, () => {
      expect(can(action, 'person', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
    });
  }
  it('view: the planner roles read the register, an Engineer does not', () => {
    for (const r of roles) expect(can('view', 'person', { realRole: r })).toBe(r !== 'Engineer');
  });
});
