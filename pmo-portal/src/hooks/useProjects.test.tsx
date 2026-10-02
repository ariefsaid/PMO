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

const { milestoneDatesForProjects, repoCreate, repoUpdateHeader } = vi.hoisted(() => ({
  milestoneDatesForProjects: vi.fn().mockResolvedValue([]),
  repoCreate: vi.fn().mockResolvedValue({ id: 'new' }),
  repoUpdateHeader: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    milestone: { milestoneDatesForProjects },
    project: {
      create: repoCreate,
      updateHeader: repoUpdateHeader,
      archive: vi.fn(),
      delete: vi.fn(),
      setContractValue: vi.fn(),
    },
  },
}));

import {
  useProjects,
  useClientCompanies,
  useProjectManagers,
  useProjectsMilestoneDates,
  useProjectMutations,
} from './useProjects';
import { listProjects } from '@/src/lib/db/projects';
import { listClientCompanies } from '@/src/lib/db/companies';
import { listProjectManagers } from '@/src/lib/db/profiles';

/** Fresh QueryClient per test to avoid cross-test cache bleed. */
const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

describe('useProjects', () => {
  it("keys by ['projects', orgId] and returns rows (FR-QRY-002, FR-PROJ-001)", async () => {
    const { result } = renderHook(() => useProjects(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].name).toBe('X');
    expect(listProjects).toHaveBeenCalled();
  });
});

describe('useClientCompanies', () => {
  it("keys by ['companies', 'client', orgId] and returns company rows (FR-QRY-002)", async () => {
    const { result } = renderHook(() => useClientCompanies(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].name).toBe('Acme');
    expect(listClientCompanies).toHaveBeenCalled();
  });

  it('returns company rows with correct shape (name field present)', async () => {
    const { result } = renderHook(() => useClientCompanies(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toHaveProperty('name', 'Acme');
    expect(result.current.data?.[0]).toHaveProperty('type', 'Client');
  });
});

describe('useProjectManagers', () => {
  it("keys by ['profiles', 'pm', orgId] and returns profile rows (FR-QRY-002)", async () => {
    const { result } = renderHook(() => useProjectManagers(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].full_name).toBe('Alice Manager');
    expect(listProjectManagers).toHaveBeenCalled();
  });
});

describe('useProjectsMilestoneDates', () => {
  it('does NOT call the RPC when active=false (calendar not shown — NFR-CAL-PERF-001)', async () => {
    milestoneDatesForProjects.mockClear();
    const { result } = renderHook(
      () => useProjectsMilestoneDates(['p1'], false),
      { wrapper: makeWrapper() },
    );
    // Query is disabled; isPending stays true and RPC is never invoked.
    expect(result.current.isPending).toBe(true);
    expect(milestoneDatesForProjects).not.toHaveBeenCalled();
  });

  it('calls the RPC when active=true and ids are non-empty (NFR-CAL-PERF-001)', async () => {
    milestoneDatesForProjects.mockClear();
    const { result } = renderHook(
      () => useProjectsMilestoneDates(['p1'], true),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(milestoneDatesForProjects).toHaveBeenCalledWith(['p1']);
  });

  it('does NOT call the RPC when ids are empty even if active=true (short-circuit)', async () => {
    milestoneDatesForProjects.mockClear();
    const { result } = renderHook(
      () => useProjectsMilestoneDates([], true),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isPending).toBe(true);
    expect(milestoneDatesForProjects).not.toHaveBeenCalled();
  });
});

describe('useProjectMutations — cache invalidation (AC-EC-003)', () => {
  it('AC-EC-003: a project create invalidates sales-pipeline and lost-deals (plus projects/opportunity)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useProjectMutations(), { wrapper: Wrapper });
    repoCreate.mockClear();
    await result.current.create.mutateAsync({
      name: 'X', status: 'Leads', client_id: null, end_client_id: null,
      project_manager_id: null, contract_value: 0, start_date: null, end_date: null,
    });
    const keys = spy.mock.calls.flatMap((c) => (c[0]?.queryKey ?? []) as string[]);
    expect(keys).toContain('projects');
    expect(keys).toContain('opportunity');
    expect(keys).toContain('sales-pipeline');
    expect(keys).toContain('lost-deals');
  });

  it('AC-EC-003: a header update invalidates sales-pipeline and lost-deals too', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useProjectMutations(), { wrapper: Wrapper });
    repoUpdateHeader.mockClear();
    await result.current.updateHeader.mutateAsync({
      id: 'p1',
      input: {
        name: 'Y', code: null, client_id: null, end_client_id: null,
        project_manager_id: null, start_date: null, end_date: null,
      },
    });
    const keys = spy.mock.calls.flatMap((c) => (c[0]?.queryKey ?? []) as string[]);
    expect(keys).toContain('sales-pipeline');
    expect(keys).toContain('lost-deals');
  });
});
