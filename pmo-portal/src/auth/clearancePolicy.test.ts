import { describe, it, expect } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const roles: Role[] = ['Admin', 'Project Manager', 'Finance', 'Executive', 'Engineer'];

describe('AC-CLR-008 clearance policy (UX only; RLS decides)', () => {
  it('view: Admin, Project Manager, Finance and Executive read the checklist; an Engineer does not', () => {
    for (const r of roles) {
      expect(can('view', 'clearanceItem', { realRole: r })).toBe(r !== 'Engineer');
      expect(can('view', 'personClearance', { realRole: r })).toBe(r !== 'Engineer');
    }
  });
  it('manage items: Admin only', () => {
    for (const r of roles) expect(can('manage', 'clearanceItem', { realRole: r })).toBe(r === 'Admin');
  });
  it('record a person state: Admin and Project Manager', () => {
    for (const r of roles) expect(can('edit', 'personClearance', { realRole: r })).toBe(r === 'Admin' || r === 'Project Manager');
  });
  it('view-as is view-only', () => {
    expect(can('manage', 'clearanceItem', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
    expect(can('edit', 'personClearance', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
  });
});
