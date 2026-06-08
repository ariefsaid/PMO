import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ── The repository seam is mocked; the hooks are the unit under test. ──
const { repo } = vi.hoisted(() => ({
  repo: {
    company: { list: vi.fn(), listClients: vi.fn() },
    profile: { listProjectManagers: vi.fn() },
    project: { list: vi.fn() },
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: repo }));

let orgId: string | undefined = 'org-1';
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: orgId ? { id: 'u1', org_id: orgId } : null }),
}));

import {
  useVendorOptions,
  useProjectOptions,
  useClientCompanyOptions,
  useProjectManagerOptions,
} from './useFkOptions';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  orgId = 'org-1';
  Object.values(repo).forEach((r) => Object.values(r).forEach((fn) => fn.mockReset()));
});

describe('useVendorOptions — vendor FK picker', () => {
  it('maps vendor companies into stable ComboboxOptions (id→value, name→label)', async () => {
    repo.company.list.mockResolvedValue([
      { id: 'v1', name: 'Apex Supply', type: 'Vendor', archived_at: null },
      { id: 'v2', name: 'Bolt Co', type: 'Vendor', archived_at: null },
    ]);
    const { result } = renderHook(() => useVendorOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(repo.company.list).toHaveBeenCalledWith({ type: 'Vendor' });
    expect(result.current.data).toEqual([
      { value: 'v1', label: 'Apex Supply', sub: 'Vendor' },
      { value: 'v2', label: 'Bolt Co', sub: 'Vendor' },
    ]);
  });

  it('is disabled (no fetch) until the org is known', () => {
    orgId = undefined;
    const { result } = renderHook(() => useVendorOptions(), { wrapper: wrapper() });
    expect(repo.company.list).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});

describe('useProjectOptions — project FK picker (archived-filtered)', () => {
  it('excludes archived projects and maps id→value, name→label, code→sub', async () => {
    repo.project.list.mockResolvedValue([
      { id: 'p1', name: 'HQ Fit-Out', code: 'PRJ-1', archived_at: null },
      { id: 'p2', name: 'Old Job', code: 'PRJ-2', archived_at: '2026-01-01T00:00:00Z' },
      { id: 'p3', name: 'No Code', code: null, archived_at: null },
    ]);
    const { result } = renderHook(() => useProjectOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([
      { value: 'p1', label: 'HQ Fit-Out', sub: 'PRJ-1' },
      { value: 'p3', label: 'No Code', sub: undefined },
    ]);
  });
});

describe('useClientCompanyOptions — client FK picker', () => {
  it('maps client companies into ComboboxOptions with a Client sub', async () => {
    repo.company.listClients.mockResolvedValue([
      { id: 'c1', name: 'Innovate Corp', type: 'Client', archived_at: null },
    ]);
    const { result } = renderHook(() => useClientCompanyOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([{ value: 'c1', label: 'Innovate Corp', sub: 'Client' }]);
  });
});

describe('useProjectManagerOptions — PM FK picker', () => {
  it('maps PM profiles into ComboboxOptions (id→value, full_name→label)', async () => {
    repo.profile.listProjectManagers.mockResolvedValue([
      { id: 'u1', full_name: 'Alice Manager', role: 'Project Manager' },
    ]);
    const { result } = renderHook(() => useProjectManagerOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([{ value: 'u1', label: 'Alice Manager' }]);
  });
});
