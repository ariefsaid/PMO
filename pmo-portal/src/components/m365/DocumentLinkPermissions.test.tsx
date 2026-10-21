import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDocumentLinkPermissions } from './DocumentLinkPermissions';
const state = vi.hoisted(() => ({ realRole: 'Admin' as string | null, effectiveRole: 'Admin' as string | null, currentUser: { id: 'synthetic-user' } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: state.currentUser }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string, entity: string) => entity === 'document' || entity === 'procDoc' || entity === 'budgetLine' || entity === 'integration' }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: state.realRole, effectiveRole: state.effectiveRole }) }));
describe('DocumentLinkPermissions AC-M365DOC-060', () => {
  it('allows only Draft project/budget writes and blocks impersonation', () => {
    const { result, rerender } = renderHook(() => useDocumentLinkPermissions());
    expect(result.current.projectCreate()).toBe(true);
    expect(result.current.projectEdit('synthetic-user', 'Draft')).toBe(true);
    expect(result.current.projectEdit('synthetic-user', 'Issued')).toBe(false);
    expect(result.current.budgetEdit('Draft')).toBe(true);
    expect(result.current.budgetEdit('Active')).toBe(false);
    state.effectiveRole = 'Engineer'; rerender();
    expect(result.current.procurementCreate()).toBe(false);
    state.effectiveRole = 'Admin';
  });
});
