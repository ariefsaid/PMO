import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const { dal } = vi.hoisted(() => ({
  dal: {
    listProjects: vi.fn(async () => []),
    listProcurements: vi.fn(async () => []),
    getSalesPipeline: vi.fn(async () => ({ projects: [] })),
    list: vi.fn(async () => []),
  },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/db/projects', () => ({ listProjects: dal.listProjects }));
vi.mock('@/src/lib/db/procurements', () => ({ listProcurements: dal.listProcurements }));
vi.mock('@/src/lib/db/dashboard', () => ({ getSalesPipeline: dal.getSalesPipeline }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { company: dal, contact: dal, incident: dal },
}));

import { useRecordSearch } from '../useRecordSearch';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ImpersonationProvider realRole="Admin">{children}</ImpersonationProvider>
  </QueryClientProvider>
);

describe('AC-OVERFETCH-001 ⌘K record search loads its lists only while the palette is open', () => {
  it('fires no list query while disabled (palette closed)', () => {
    renderHook(() => useRecordSearch(vi.fn(), { enabled: false }), { wrapper });
    for (const fn of Object.values(dal)) expect(fn).not.toHaveBeenCalled();
  });

  it('loads the lists once enabled (palette open)', async () => {
    renderHook(() => useRecordSearch(vi.fn(), { enabled: true }), { wrapper });
    await waitFor(() => expect(dal.listProjects).toHaveBeenCalled());
    expect(dal.listProcurements).toHaveBeenCalled();
    expect(dal.getSalesPipeline).toHaveBeenCalled();
  });
});
