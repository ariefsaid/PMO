import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const project = vi.hoisted(() => ({ transition: vi.fn().mockResolvedValue(undefined), listPipelineStageConfig: vi.fn().mockResolvedValue([{ status: 'Leads', win_probability: 0.1 }, { status: 'Negotiation', win_probability: 0.75 }]), winEligibility: vi.fn() }));
const integrations = vi.hoisted(() => ({ getBinding: vi.fn(async () => null), ensureErpProject: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations, project } }));

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

import { usePipelineStageConfig, useProjectTransition, useProjectWinEligibility } from './useProjectTransitions';
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

describe('useProjectWinEligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    project.winEligibility.mockReset();
    vi.mocked(useAuth).mockReturnValue({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' } as unknown as ReturnType<typeof useAuth>);
  });

  it('reads the selected project and updates when its value witness changes', async () => {
    project.winEligibility.mockResolvedValue('allowed');
    const { Wrapper } = makeWrapper();
    const { result, rerender } = renderHook(({ revision }) => useProjectWinEligibility('p1', true, revision), { wrapper: Wrapper, initialProps: { revision: 'one' } });
    await waitFor(() => expect(result.current.data).toBe('allowed'));
    rerender({ revision: 'two' });
    await waitFor(() => expect(project.winEligibility).toHaveBeenCalledTimes(2));
    expect(project.winEligibility).toHaveBeenCalledWith('p1');
  });

  it('refreshes the actor-specific decision when the role changes', async () => {
    project.winEligibility.mockResolvedValueOnce('allowed').mockResolvedValueOnce('reviewer_required');
    vi.mocked(useAuth).mockReturnValue({ currentUser: { id: 'u1', org_id: 'org-1', role: 'Finance' } } as unknown as ReturnType<typeof useAuth>);
    const { Wrapper } = makeWrapper();
    const { result, rerender } = renderHook(() => useProjectWinEligibility('p1', true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toBe('allowed'));
    vi.mocked(useAuth).mockReturnValue({ currentUser: { id: 'u1', org_id: 'org-1', role: 'Project Manager' } } as unknown as ReturnType<typeof useAuth>);
    rerender();
    await waitFor(() => expect(result.current.data).toBe('reviewer_required'));
    expect(project.winEligibility).toHaveBeenCalledTimes(2);
  });

  it('refreshes the decision when the actor manager changes', async () => {
    project.winEligibility.mockResolvedValueOnce('allowed').mockResolvedValueOnce('reviewer_required');
    vi.mocked(useAuth).mockReturnValue({ currentUser: { id: 'u1', org_id: 'org-1', role: 'Project Manager', manager_id: 'manager-1' } } as unknown as ReturnType<typeof useAuth>);
    const { Wrapper } = makeWrapper();
    const { result, rerender } = renderHook(() => useProjectWinEligibility('p1', true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toBe('allowed'));
    vi.mocked(useAuth).mockReturnValue({ currentUser: { id: 'u1', org_id: 'org-1', role: 'Project Manager', manager_id: 'manager-2' } } as unknown as ReturnType<typeof useAuth>);
    rerender();
    await waitFor(() => expect(result.current.data).toBe('reviewer_required'));
  });

  it('does not fetch while disabled', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProjectWinEligibility('p1', false), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(project.winEligibility).not.toHaveBeenCalled();
  });
});

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

    expect(project.listPipelineStageConfig).toHaveBeenCalledTimes(1);
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
    expect(project.listPipelineStageConfig).not.toHaveBeenCalled();
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
    expect(project.transition).toHaveBeenCalledWith('proj-1', 'PQ Submitted', undefined);

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
    expect(project.transition).toHaveBeenCalledWith(
      'proj-2',
      'Won, Pending KoM',
      { customerContractRef: 'CPO-9', contractDate: '2026-03-01' },
    );

    const winCalls = invalidateSpy.mock.calls.map(c => JSON.stringify(c[0]));
    expect(
      winCalls.some(c => c.includes('"projects"') && c.includes('"org-1"')),
    ).toBe(true);
  });

  it('refreshes cached project projections for the current organization after a transition', async () => {
    const { qc, Wrapper } = makeWrapper();
    const roots = ['projects', 'project', 'sales-pipeline', 'lost-deals', 'won-deals', 'win-rate', 'dashboard'];
    for (const root of roots) {
      qc.setQueryData([root, 'org-1', 'detail'], 'old');
      qc.setQueryData([root, 'org-2', 'detail'], 'other');
    }
    const { result } = renderHook(() => useProjectTransition(), { wrapper: Wrapper });
    await act(async () => { await result.current.mutateAsync({ id: 'p1', to: 'PQ Submitted' }); });
    for (const root of roots) {
      expect(qc.getQueryState([root, 'org-1', 'detail'])?.isInvalidated).toBe(true);
      expect(qc.getQueryState([root, 'org-2', 'detail'])?.isInvalidated).toBe(false);
    }
  });

  it('routes transitions through the project repository', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProjectTransition(), { wrapper: Wrapper });
    await act(async () => { await result.current.mutateAsync({ id: 'p1', to: 'PQ Submitted' }); });
    expect(project.transition).toHaveBeenCalledWith('p1', 'PQ Submitted', undefined);
  });

  it('exposes mutateAsync function', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProjectTransition(), { wrapper: Wrapper });
    expect(typeof result.current.mutateAsync).toBe('function');
  });
});

describe('ERP setup after winning',()=>{
  it('AC-SETUP-001 winning keeps its native success if ERP linking fails and exposes the retry state',async()=>{
    integrations.getBinding.mockResolvedValueOnce({status:'active',config:{company:'Example Company'}} as never);
    integrations.ensureErpProject.mockRejectedValueOnce(new Error('unavailable'));
    const {Wrapper}=makeWrapper();const {result}=renderHook(()=>useProjectTransition(),{wrapper:Wrapper});
    await act(async()=>{await result.current.mutateAsync({id:'proj-2',to:'Won, Pending KoM',opts:{customerContractRef:'CPO-9',contractDate:'2026-03-01'}});});
    expect(result.current.isSuccess).toBe(true);
    expect(result.current).toMatchObject({erpSetupPending:true});
    expect(integrations.ensureErpProject).toHaveBeenCalledWith('proj-2');
  });
});
