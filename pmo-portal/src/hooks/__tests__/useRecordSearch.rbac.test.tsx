import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

/**
 * AC-W2-RBAC-015 (A-8 ⌘K view-gate guard — the single canonical ⌘K-leak proof, referenced by
 * A-3 AC-W2-RBAC-007 and A-4 AC-W2-RBAC-009):
 *   `useRecordSearch` indexes a module's records ONLY when the viewer's REAL role may view that
 *   module's index. An Engineer (no Procurement / Sales nav per rbac-visibility §A/§C/§E) must
 *   never surface procurement or pipeline rows via ⌘K, even if those caches hold rows; projects
 *   stay indexed for everyone.
 *
 * The gating-invariant is two-sided: the authorized role (PM) sees the module's rows; the denied
 * role (Engineer) does not see the reject-bound rows. RLS stays the authority — this closes the
 * client-cache cross-scope leak for clarity.
 */
const { state } = vi.hoisted(() => ({
  state: {
    projects: { data: undefined as unknown, isPending: false, isError: false },
    procurements: { data: undefined as unknown, isPending: false, isError: false },
    pipeline: { data: undefined as unknown, isPending: false, isError: false },
  },
}));

vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => state.projects }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => state.procurements }));
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => state.pipeline }));

import { useRecordSearch } from '../useRecordSearch';

const navigate = vi.fn();

const wrap =
  (realRole: Role | null) =>
  ({ children }: { children: React.ReactNode }) => (
    <ImpersonationProvider realRole={realRole}>{children}</ImpersonationProvider>
  );

beforeEach(() => {
  navigate.mockClear();
  state.projects = {
    data: [{ id: 'p1', name: 'Harbour Expansion', code: 'PRJ-0142' }],
    isPending: false,
    isError: false,
  };
  state.procurements = {
    data: [{ id: 'pr1', title: 'Crane hire', code: 'PROC-2026-002' }],
    isPending: false,
    isError: false,
  };
  state.pipeline = {
    data: { stages: [], projects: [{ id: 'o1', name: 'Acme Tender' }] },
    isPending: false,
    isError: false,
  };
});

describe('useRecordSearch — ⌘K module view-gate (AC-W2-RBAC-015)', () => {
  it('AC-W2-RBAC-015 (PM, authorized): indexes projects + procurement + pipeline rows', () => {
    const { result } = renderHook(() => useRecordSearch(navigate), {
      wrapper: wrap('Project Manager'),
    });
    const subs = result.current.records.map((r) => r.sub);
    expect(subs).toContain('Project');
    expect(subs).toContain('Procurement');
    expect(subs).toContain('Project · Pipeline');
  });

  it('AC-W2-RBAC-015 (Engineer, denied): excludes procurement + pipeline rows, keeps projects', () => {
    const { result } = renderHook(() => useRecordSearch(navigate), {
      wrapper: wrap('Engineer'),
    });
    const subs = result.current.records.map((r) => r.sub);
    // Projects are visible to every role → still indexed.
    expect(subs).toContain('Project');
    // Procurement + Sales Pipeline have no Engineer nav → never surfaced via ⌘K.
    expect(subs).not.toContain('Procurement');
    expect(subs).not.toContain('Project · Pipeline');
  });

  it('AC-W2-RBAC-015: a null role indexes nothing reject-bound (deny-by-default)', () => {
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrap(null) });
    const subs = result.current.records.map((r) => r.sub);
    // With no role, procurement + pipeline (view-gated) are excluded; projects (view=all) stay.
    expect(subs).not.toContain('Procurement');
    expect(subs).not.toContain('Project · Pipeline');
  });
});
