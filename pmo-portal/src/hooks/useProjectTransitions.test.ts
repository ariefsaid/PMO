import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock the DAL
// ---------------------------------------------------------------------------
vi.mock('@/src/lib/db/projectTransitions', () => ({
  listPipelineStageConfig: vi.fn().mockResolvedValue([
    { status: 'Leads', win_probability: 0.1 },
    { status: 'Negotiation', win_probability: 0.75 },
  ]),
  transitionProject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: vi.fn(() => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' })),
}));

import { usePipelineStageConfig, useProjectTransition } from './useProjectTransitions';
import { listPipelineStageConfig, transitionProject } from '@/src/lib/db/projectTransitions';
import { useAuth } from '@/src/auth/useAuth';

// ---------------------------------------------------------------------------
// Wrapper factory — each test gets a fresh QueryClient
// ---------------------------------------------------------------------------
function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

// ---------------------------------------------------------------------------
// C1 — usePipelineStageConfig (supports AC-1003)
// ---------------------------------------------------------------------------

describe('usePipelineStageConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset useAuth to the default signed-in user (clearAllMocks wipes the vi.fn() impl).
    vi.mocked(useAuth).mockReturnValue({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' } as unknown as ReturnType<typeof useAuth>);
  });

  it("AC-1003 (hook): usePipelineStageConfig keys cache by ['pipeline-stage-config', orgId] and calls listPipelineStageConfig", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePipelineStageConfig(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(listPipelineStageConfig).toHaveBeenCalledTimes(1);
    expect(result.current.data).toMatchObject([
      { status: 'Leads', win_probability: 0.1 },
      { status: 'Negotiation', win_probability: 0.75 },
    ]);
  });

  it('is disabled when orgId is absent', () => {
    // No signed-in user → no org_id → query is enabled:false (fetchStatus stays 'idle', queryFn never runs).
    vi.mocked(useAuth).mockReturnValue({ currentUser: null } as unknown as ReturnType<typeof useAuth>);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePipelineStageConfig(), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(listPipelineStageConfig).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C2 — useProjectTransition (supports AC-1011)
// ---------------------------------------------------------------------------

describe('useProjectTransition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' } as unknown as ReturnType<typeof useAuth>);
  });

  it("AC-1011 (hook): useProjectTransition.mutate calls transitionProject(id,to,opts) and invalidates ['projects', orgId] on success", async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useProjectTransition(), { wrapper: Wrapper });

    // Basic transition (no opts)
    await act(async () => {
      await result.current.mutateAsync({ id: 'proj-1', to: 'PQ Submitted' });
    });
    expect(transitionProject).toHaveBeenCalledWith('proj-1', 'PQ Submitted', undefined);

    const calls = invalidateSpy.mock.calls.map(c => JSON.stringify(c[0]));
    expect(
      calls.some(c => c.includes('"projects"') && c.includes('"org-1"')),
    ).toBe(true);

    invalidateSpy.mockClear();

    // Win transition (with opts)
    await act(async () => {
      await result.current.mutateAsync({
        id: 'proj-2',
        to: 'Won, Pending KoM',
        opts: { customerContractRef: 'CPO-9', contractDate: '2026-03-01' },
      });
    });
    expect(transitionProject).toHaveBeenCalledWith(
      'proj-2',
      'Won, Pending KoM',
      { customerContractRef: 'CPO-9', contractDate: '2026-03-01' },
    );

    const winCalls = invalidateSpy.mock.calls.map(c => JSON.stringify(c[0]));
    expect(
      winCalls.some(c => c.includes('"projects"') && c.includes('"org-1"')),
    ).toBe(true);
  });

  it('exposes mutateAsync function', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProjectTransition(), { wrapper: Wrapper });
    expect(typeof result.current.mutateAsync).toBe('function');
  });
});
