import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * AC-NBR-034 — the ⌘K record search returns each source's rows as it answers.
 * `isPending` means "at least one enabled source is pending"; the new readiness fields
 * distinguish the first result from the sources that are still in flight.
 */
const { state } = vi.hoisted(() => {
  const ready = (rows: unknown[] = []) => ({ data: rows, isPending: false, isError: false, refetch: vi.fn() });
  return {
    state: {
      projects: ready(), procurements: ready(), pipeline: ready(), companies: ready(), contacts: ready(), incidents: ready(),
      ready,
    },
  };
});

vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => state.projects }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => state.procurements }));
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => state.pipeline }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanyOptions: () => state.companies }));
vi.mock('@/src/hooks/useContacts', () => ({ useContacts: () => state.contacts }));
vi.mock('@/src/hooks/useIncidents', () => ({ useIncidents: () => state.incidents }));

import { useRecordSearch } from './useRecordSearch';

const wrap = (realRole: string | null) => ({ children }: { children: React.ReactNode }) => (
  <ImpersonationProvider realRole={realRole as never}>{children}</ImpersonationProvider>
);
const pendingState = (rows: unknown[] = []) => ({ data: rows, isPending: true, isError: false, refetch: vi.fn() });

beforeEach(() => {
  state.projects = state.ready([{ id: 'p1', name: 'Harbour Works', code: null, pmo_project_number: null, customer_contract_ref: null }]);
  state.procurements = state.ready();
  state.pipeline = { ...state.ready(), data: { stages: [], projects: [] } } as never;
  state.companies = state.ready();
  state.contacts = state.ready();
  state.incidents = state.ready();
});

describe('AC-NBR-034 useRecordSearch per-source loading', () => {
  it('(P) projects ready, contacts pending: project rows remain searchable and only contacts are pending', () => {
    state.contacts = pendingState();
    const { result } = renderHook(() => useRecordSearch(vi.fn()), { wrapper: wrap('Admin') });
    expect(result.current.records.map((record) => record.id)).toContain('projects:p1');
    expect(result.current.isPending).toBe(true);
    expect(result.current.pendingSources).toEqual(['contacts']);
    expect(result.current.nothingAnswered).toBe(false);
  });

  it('(P) no enabled source has answered yet: initial state stays a full loading state', () => {
    state.projects = pendingState();
    state.procurements = pendingState();
    state.pipeline = { ...pendingState(), data: undefined } as never;
    state.companies = pendingState();
    state.contacts = pendingState();
    state.incidents = pendingState();
    const { result } = renderHook(() => useRecordSearch(vi.fn()), { wrapper: wrap('Admin') });
    expect(result.current.nothingAnswered).toBe(true);
    expect(result.current.pendingSources.length).toBeGreaterThan(1);
  });

  it('(F) a failed source does not hide other rows or remain pending', () => {
    state.procurements = { ...state.ready(), isError: true } as never;
    const { result } = renderHook(() => useRecordSearch(vi.fn()), { wrapper: wrap('Admin') });
    expect(result.current.records.map((record) => record.id)).toContain('projects:p1');
    expect(result.current.isError).toBe(true);
    expect(result.current.pendingSources).not.toContain('procurements');
  });

  it('a source disabled for the viewer is never pending (an Engineer reads projects only)', () => {
    state.procurements = pendingState();
    state.companies = pendingState();
    state.contacts = pendingState();
    state.pipeline = { ...pendingState(), data: undefined } as never;
    const { result } = renderHook(() => useRecordSearch(vi.fn()), { wrapper: wrap('Engineer') });
    expect(result.current.pendingSources).toEqual([]);
    expect(result.current.nothingAnswered).toBe(false);
  });
});
