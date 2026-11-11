import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * ⌘K source gating (role- and feature-scoped fetches): opening the palette must only pay for
 * list reads whose results the viewer's REAL role (or the incidents feature flag) can surface.
 * A denied source stays disabled — never fetched, and its pending/error state never leaks into
 * the palette's aggregated loading/error. RLS stays the authority; this is an over-fetch and
 * clarity fix, not an authorization control.
 */
const { dal } = vi.hoisted(() => ({
  dal: {
    listProjects: vi.fn(async () => []),
    listProcurements: vi.fn(async () => []),
    getSalesPipeline: vi.fn(async () => ({ projects: [] })),
    listCompanies: vi.fn(async () => []),
    listContacts: vi.fn(async () => []),
    listIncidents: vi.fn(async () => []),
  },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    project: { list: dal.listProjects },
    procurement: { list: dal.listProcurements },
    dashboard: { salesPipeline: dal.getSalesPipeline },
    company: { list: dal.listCompanies },
    contact: { list: dal.listContacts },
    incident: { list: dal.listIncidents },
  },
}));

import { useRecordSearch } from '../useRecordSearch';
import * as features from '@/src/lib/features';

const makeWrapper = (realRole: string | null) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ImpersonationProvider realRole={realRole as never}>{children}</ImpersonationProvider>
    </QueryClientProvider>
  );
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of Object.values(dal)) fn.mockClear();
});

describe('useRecordSearch — denied sources are never fetched (palette open)', () => {
  it('an Engineer (no procurement/sales/master-data nav) fires only the projects read', async () => {
    renderHook(() => useRecordSearch(vi.fn(), { enabled: true }), { wrapper: makeWrapper('Engineer') });
    await waitFor(() => expect(dal.listProjects).toHaveBeenCalled());
    await waitFor(() => expect(dal.listProjects.mock.calls.length).toBeGreaterThan(0));
    // Give any wrongly-enabled query a tick to fire before asserting the negatives.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(dal.listProcurements).not.toHaveBeenCalled();
    expect(dal.getSalesPipeline).not.toHaveBeenCalled();
    expect(dal.listCompanies).not.toHaveBeenCalled();
    expect(dal.listContacts).not.toHaveBeenCalled();
    // The incidents feature flag is off by default → its read is skipped too.
    expect(dal.listIncidents).not.toHaveBeenCalled();
  });

  it('an authorized Admin fires the visible sources (incidents stays flag-gated)', async () => {
    renderHook(() => useRecordSearch(vi.fn(), { enabled: true }), { wrapper: makeWrapper('Admin') });
    await waitFor(() => expect(dal.listProjects).toHaveBeenCalled());
    await waitFor(() => expect(dal.listProcurements).toHaveBeenCalled());
    expect(dal.getSalesPipeline).toHaveBeenCalled();
    expect(dal.listCompanies).toHaveBeenCalled();
    expect(dal.listContacts).toHaveBeenCalled();
    expect(dal.listIncidents).not.toHaveBeenCalled();
  });

  it('an Admin with the incidents flag on fires the incidents read', async () => {
    vi.spyOn(features, 'isFeatureEnabled').mockImplementation((key) =>
      key === 'incidents' ? true : features.FEATURES[key],
    );
    renderHook(() => useRecordSearch(vi.fn(), { enabled: true }), { wrapper: makeWrapper('Admin') });
    await waitFor(() => expect(dal.listIncidents).toHaveBeenCalled());
  });
});


