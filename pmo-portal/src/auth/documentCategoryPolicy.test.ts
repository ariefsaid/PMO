import { describe, it, expect } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const roles: Role[] = ['Admin', 'Project Manager', 'Finance', 'Executive', 'Engineer'];

describe('AC-DCV-019 documentCategory policy mirrors the management functions (FR-DCV-020)', () => {
  it('manage: Admin passes and every other role is denied', () => {
    for (const r of roles) expect(can('manage', 'documentCategory', { realRole: r })).toBe(r === 'Admin');
  });
  it('deny by default: no role, and an action the entity does not define', () => {
    expect(can('manage', 'documentCategory', { realRole: null })).toBe(false);
    expect(can('delete', 'documentCategory', { realRole: 'Admin' })).toBe(false);
  });
});
