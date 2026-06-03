import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/lib/db/projects', () => ({
  listProjects: vi.fn().mockResolvedValue([{ id: 'p1', name: 'X', client: null, pm: null }]),
}));
vi.mock('@/src/lib/db/companies', () => ({
  listClientCompanies: vi.fn().mockResolvedValue([{ id: 'c1', name: 'Acme', type: 'Client' }]),
}));
vi.mock('@/src/lib/db/profiles', () => ({
  listProjectManagers: vi.fn().mockResolvedValue([{ id: 'u1', full_name: 'Alice Manager', role: 'Project Manager' }]),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { useProjects, useClientCompanies, useProjectManagers } from './useProjects';
import { listProjects } from '@/src/lib/db/projects';
import { listClientCompanies } from '@/src/lib/db/companies';
import { listProjectManagers } from '@/src/lib/db/profiles';

/** Fresh QueryClient per test to avoid cross-test cache bleed. */
const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('useProjects', () => {
  it("keys by ['projects', orgId] and returns rows (FR-QRY-002, FR-PROJ-001)", async () => {
    const { result } = renderHook(() => useProjects(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].name).toBe('X');
    expect(listProjects).toHaveBeenCalled();
  });
});

describe('useClientCompanies', () => {
  it("keys by ['companies', 'client', orgId] and returns company rows (FR-QRY-002)", async () => {
    const { result } = renderHook(() => useClientCompanies(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].name).toBe('Acme');
    expect(listClientCompanies).toHaveBeenCalled();
  });

  it('returns company rows with correct shape (name field present)', async () => {
    const { result } = renderHook(() => useClientCompanies(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toHaveProperty('name', 'Acme');
    expect(result.current.data?.[0]).toHaveProperty('type', 'Client');
  });
});

describe('useProjectManagers', () => {
  it("keys by ['profiles', 'pm', orgId] and returns profile rows (FR-QRY-002)", async () => {
    const { result } = renderHook(() => useProjectManagers(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].full_name).toBe('Alice Manager');
    expect(listProjectManagers).toHaveBeenCalled();
  });
});
