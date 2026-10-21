import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ImpersonationProvider, useEffectiveRole } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import { useDocumentLinkPermissions } from './DocumentLinkPermissions';

const ME = 'synthetic-user';
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: ME } }) }));

const ROLES: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];
const MASTER_DATA: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance'];

const withRole = (realRole: Role | null, demo = false) =>
  ({ children }: { children: ReactNode }) => (
    <ImpersonationProvider realRole={realRole} demoEligibility={demo ? 'eligible' : 'ineligible'}>{children}</ImpersonationProvider>
  );
const permissionsFor = (role: Role | null) =>
  renderHook(() => useDocumentLinkPermissions(), { wrapper: withRole(role) }).result.current;

describe('useDocumentLinkPermissions', () => {
  it.each(ROLES)('AC-M365DOC-060 %s: create and edit follow the existing document / procDoc / budgetLine / integration policy', (role) => {
    const p = permissionsFor(role);
    const writer = MASTER_DATA.includes(role);
    expect(p.projectCreate()).toBe(writer);
    expect(p.procurementCreate()).toBe(writer);
    expect(p.procurementEdit()).toBe(writer);
    expect(p.budgetEdit('Draft')).toBe(writer);
    expect(p.manageDefault()).toBe(role === 'Admin');
  });

  it.each(ROLES)('AC-M365DOC-060 %s: a project document is editable only while Draft and only by its author (Admin break-glass)', (role) => {
    const p = permissionsFor(role);
    const writer = MASTER_DATA.includes(role);
    expect(p.projectEdit(ME, 'Draft')).toBe(writer);
    expect(p.projectEdit('someone-else', 'Draft')).toBe(role === 'Admin');
    expect(p.projectEdit(null, 'Draft')).toBe(role === 'Admin');
    for (const status of ['Issued', 'Approved', 'Rejected', 'Closed', 'Superseded']) {
      expect(p.projectEdit(ME, status)).toBe(false);
    }
  });

  it.each(['Draft', 'Active', 'Archived', 'Superseded'])('AC-M365DOC-060 budget evidence is a write only on a Draft version (%s)', (status) => {
    expect(permissionsFor('Finance').budgetEdit(status)).toBe(status === 'Draft');
  });

  it('AC-M365DOC-060 procurement evidence has no purchase-stage or overhead predicate (header-edit limits are not transplanted)', () => {
    const p = permissionsFor('Project Manager');
    // Zero-argument methods: nothing about a stage/project can narrow them.
    expect(p.procurementCreate.length).toBe(0);
    expect(p.procurementEdit.length).toBe(0);
    expect(p.procurementCreate()).toBe(true);
    expect(p.procurementEdit()).toBe(true);
  });

  it('AC-M365DOC-060 no role, and no signed-out user, gets any mutation right while unresolved', () => {
    const p = permissionsFor(null);
    expect(p.projectCreate()).toBe(false);
    expect(p.projectEdit(ME, 'Draft')).toBe(false);
    expect(p.procurementCreate()).toBe(false);
    expect(p.procurementEdit()).toBe(false);
    expect(p.budgetEdit('Draft')).toBe(false);
    expect(p.manageDefault()).toBe(false);
  });

  it('AC-M365DOC-060 impersonation is view-only: an Admin viewing as another role gets no mutation, even where both roles could write', () => {
    const { result } = renderHook(
      () => ({ perms: useDocumentLinkPermissions(), eff: useEffectiveRole() }),
      { wrapper: withRole('Admin', true) },
    );
    expect(result.current.perms.projectCreate()).toBe(true);
    for (const viewAs of ['Engineer', 'Finance'] as Role[]) {
      act(() => result.current.eff.viewAs(viewAs));
      expect(result.current.eff.effectiveRole).toBe(viewAs);
      expect(result.current.perms.projectCreate()).toBe(false);
      expect(result.current.perms.projectEdit(ME, 'Draft')).toBe(false);
      expect(result.current.perms.procurementCreate()).toBe(false);
      expect(result.current.perms.procurementEdit()).toBe(false);
      expect(result.current.perms.budgetEdit('Draft')).toBe(false);
      expect(result.current.perms.manageDefault()).toBe(false);
    }
    act(() => result.current.eff.viewAs(null));
    expect(result.current.perms.manageDefault()).toBe(true);
  });
});
