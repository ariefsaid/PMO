import { describe, it, expect } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const roles: Role[] = ['Admin', 'Project Manager', 'Finance', 'Executive', 'Engineer'];
const ctx = (realRole: Role, kind: 'person' | 'equipment', viewOnly = false) => ({ realRole, record: { kind, viewOnly } });

describe('AC-DEE-005 expiryDocument policy mirrors RLS (FR-DEX-006)', () => {
  for (const action of ['create', 'edit', 'archive'] as const) {
    it(`${action}: Admin on both kinds, PM on equipment only, nobody else`, () => {
      for (const r of roles) {
        expect(can(action, 'expiryDocument', ctx(r, 'equipment'))).toBe(r === 'Admin' || r === 'Project Manager');
        expect(can(action, 'expiryDocument', ctx(r, 'person'))).toBe(r === 'Admin');
      }
    });
    it(`${action}: refused while viewing as another role`, () => {
      expect(can(action, 'expiryDocument', ctx('Admin', 'equipment', true))).toBe(false);
    });
    it(`${action}: refused without a subject kind`, () => {
      expect(can(action, 'expiryDocument', { realRole: 'Admin' })).toBe(false);
    });
  }
});

describe('AC-RCG-023 expiryDocument policy: the people-documents capability', () => {
  const holder = (kind: 'person' | 'equipment', over: { medical?: boolean; viewOnly?: boolean; key?: string | null; role?: Role } = {}) =>
    ({ realRole: over.role ?? ('Engineer' as Role), builtInRoleKey: over.key === undefined ? 'hr_officer' : over.key, record: { kind, medical: over.medical, viewOnly: over.viewOnly } });
  for (const action of ['create', 'edit', 'archive'] as const) {
    it(`${action}: an HR holder writes person documents at either base level, never equipment`, () => {
      for (const role of ['Engineer', 'Project Manager'] as Role[]) {
        expect(can(action, 'expiryDocument', holder('person', { role }))).toBe(true);
        expect(can(action, 'expiryDocument', holder('person', { role, medical: true }))).toBe(true);
      }
      expect(can(action, 'expiryDocument', holder('equipment'))).toBe(false);
    });
    it(`${action}: a plain Engineer, a person with no built-in role and a view-as session are refused`, () => {
      expect(can(action, 'expiryDocument', holder('person', { key: 'planner' }))).toBe(false);
      expect(can(action, 'expiryDocument', holder('person', { key: null }))).toBe(false);
      expect(can(action, 'expiryDocument', holder('person', { viewOnly: true }))).toBe(false);
    });
  }
});

describe('AC-HRM-001 medical person document writers', () => {
  for (const action of ['create', 'edit', 'archive'] as const) {
    it(`${action}: HR Officer and HR Manager only, besides Admin`, () => {
      for (const key of ['hr_officer', 'hr_manager', 'storekeeper', 'field_user', 'planner']) {
        const ctx = { realRole: 'Engineer' as Role, builtInRoleKey: key, record: { kind: 'person', medical: true } };
        expect(can(action, 'expiryDocument', ctx)).toBe(['hr_officer', 'hr_manager'].includes(key));
        expect(can(action, 'expiryDocument', { ...ctx, record: { ...ctx.record, viewOnly: true } })).toBe(false);
      }
    });
  }
});
