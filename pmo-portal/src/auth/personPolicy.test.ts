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
});
