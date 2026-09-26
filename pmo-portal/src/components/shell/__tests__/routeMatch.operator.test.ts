import { describe, it, expect } from 'vitest';
import { modulesForRoleWithOperator } from '../routeMatch';
import { UserRole } from '../../../../types';

/**
 * AC-ADMIA-002 + AC-W3-N3 — the ⌘K Navigate group exposes Administration to a REAL platform
 * Operator regardless of their base role.
 *
 * An authenticated Engineer who is a server-confirmed Operator can open `/administration` by URL
 * but could not discover it in ⌘K. `modulesForRoleWithOperator` grants the extra Administration
 * item from the SETTLED `useIsOperator()` projection — never from an effective/preview role — so
 * a plain Engineer still never sees it, and a role already granted it is not duplicated.
 */
describe('modulesForRoleWithOperator (AC-ADMIA-002)', () => {
  it('a real Operator Engineer gains Administration in the Navigate group', () => {
    const modules = modulesForRoleWithOperator(UserRole.Engineer, true).map((m) => m.module);
    expect(modules).toContain('administration');
  });

  it('a plain (non-Operator) Engineer still never sees Administration', () => {
    const modules = modulesForRoleWithOperator(UserRole.Engineer, false).map((m) => m.module);
    expect(modules).not.toContain('administration');
  });

  it('an Operator adds Administration without removing the existing role-gated modules', () => {
    const modules = modulesForRoleWithOperator(UserRole.Engineer, true).map((m) => m.module);
    expect(modules).toContain('projects');
    expect(modules).toContain('timesheets');
    expect(modules).toContain('my-tasks');
  });

  it('a role already granted Administration is not duplicated when it is also an Operator', () => {
    const modulesAdmin = modulesForRoleWithOperator(UserRole.Admin, true).filter(
      (m) => m.module === 'administration',
    );
    expect(modulesAdmin).toHaveLength(1);
  });

  it('an Executive/Admin retains Administration even when not an Operator', () => {
    expect(
      modulesForRoleWithOperator(UserRole.Executive, false).map((m) => m.module),
    ).toContain('administration');
    expect(modulesForRoleWithOperator(UserRole.Admin, false).map((m) => m.module)).toContain(
      'administration',
    );
  });
});