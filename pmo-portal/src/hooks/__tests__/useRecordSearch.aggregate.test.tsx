import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * Aggregation gating for the ⌘K record search: only ENABLED sources contribute to the palette's
 * pending/error aggregate and to `refetch`. A disabled query idles as "pending" in TanStack, so
 * the aggregate must skip denied sources — otherwise an Engineer opening the palette would see
 * skeletons (or a failure) for reads that can never appear for them.
 */
const { state } = vi.hoisted(() => ({
  state: {
    projects: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
    procurements: { data: [] as unknown[], isPending: true, isError: false, refetch: vi.fn() },
    pipeline: { data: { stages: [], projects: [] as unknown[] }, isPending: true, isError: true, refetch: vi.fn() },
    companies: { data: [] as unknown[], isPending: true, isError: false, refetch: vi.fn() },
    contacts: { data: [] as unknown[], isPending: true, isError: false, refetch: vi.fn() },
    incidents: { data: [] as unknown[], isPending: true, isError: false, refetch: vi.fn() },
  },
}));

vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => state.projects }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => state.procurements }));
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => state.pipeline }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => state.companies }));
vi.mock('@/src/hooks/useContacts', () => ({ useContacts: () => state.contacts }));
vi.mock('@/src/hooks/useIncidents', () => ({ useIncidents: () => state.incidents }));

import { useRecordSearch } from '../useRecordSearchData';

const navigate = vi.fn();

const wrap = (realRole: string | null) => ({ children }: { children: React.ReactNode }) => (
  <ImpersonationProvider realRole={realRole as never}>{children}</ImpersonationProvider>
);

describe('useRecordSearch — aggregate covers only enabled sources', () => {
  it('an Engineer (sources denied): a denied source pending/errored never marks the palette', () => {
    // Denied sources report pending=true (procurement, companies, contacts, incidents) and the
    // pipeline even reports an error — none of that may surface for a role that cannot see them.
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrap('Engineer') });
    expect(result.current.isPending).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.records).toHaveLength(0);
  });

  it('refetch retries only the enabled sources', () => {
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrap('Engineer') });
    result.current.refetch();
    // Projects is the only enabled source for an Engineer.
    expect(state.projects.refetch).toHaveBeenCalled();
    expect(state.procurements.refetch).not.toHaveBeenCalled();
    expect(state.pipeline.refetch).not.toHaveBeenCalled();
    expect(state.companies.refetch).not.toHaveBeenCalled();
    expect(state.contacts.refetch).not.toHaveBeenCalled();
    expect(state.incidents.refetch).not.toHaveBeenCalled();
  });

  it('an Admin: pending/error of every enabled source still aggregates', () => {
    const { result } = renderHook(() => useRecordSearch(navigate), { wrapper: wrap('Admin') });
    expect(result.current.isPending).toBe(true);
    expect(result.current.isError).toBe(true);
  });
});
