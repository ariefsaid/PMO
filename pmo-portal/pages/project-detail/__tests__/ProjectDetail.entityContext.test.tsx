/**
 * AC-AXP-015 — ProjectDetail publishes its loaded record to the live agent
 * context (FR-AXP-021, Track C of docs/plans/2026-07-05-agent-experience-layer.md).
 *
 * Context is GROUNDING ONLY (NFR-AXP-SEC-003): setEntity publishes {type,id,label};
 * nothing here selects a client, skips can(), or bypasses dispatchAction.
 *
 * Owning layer: Vitest/RTL — pure FE, no DB required.
 */
import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { AgentContextProvider } from '@/src/lib/agent/context/AgentContextProvider';
import { useAgentContext } from '@/src/lib/agent/context/useAgentContext';

const projData = [
  {
    id: 'p-123',
    name: 'Alpha',
    status: 'Ongoing Project',
    budget: 100_000,
    spent: 0,
    archived_at: null,
    created_at: '',
    last_update: '',
    org_id: 'o1',
    contract_value: 200_000,
    win_probability: 1,
    stage_id: null,
    code: null,
    customer_contract_ref: null,
    client: null,
    client_id: null,
    project_manager_id: null,
    pm: null,
  },
];

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: projData, isPending: false }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/lib/db/opportunity', () => ({
  useOpportunity: () => ({ data: undefined, isPending: false }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isError: false,
    error: null,
    isPending: false,
  }),
}));

// Stub tab contents — this test only asserts the entity-context side effect.
vi.mock('../tabs/OverviewTab', () => ({ default: () => <div data-testid="tab-overview">Overview</div> }));
vi.mock('../tabs/BudgetTab', () => ({ default: () => <div data-testid="tab-budget">Budget</div> }));
vi.mock('../tabs/ProcurementTab', () => ({ default: () => <div data-testid="tab-procurement">Procurement</div> }));
vi.mock('../tabs/TasksTab', () => ({ default: () => <div data-testid="tab-tasks">Tasks</div> }));
vi.mock('../tabs/DocumentsTab', () => ({ default: () => <div data-testid="tab-documents">Documents</div> }));
vi.mock('../PipelineLens', () => ({ default: () => <div>Pipeline</div> }));
vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('../ProjectDetailHeader', () => ({
  default: () => <div data-testid="stubbed-header">Header</div>,
  hasFinanceView: () => true,
}));

import ProjectDetail from '../ProjectDetail';

const Probe: React.FC = () => {
  const { getContext } = useAgentContext();
  const ctx = getContext();
  return <span data-testid="entity">{ctx.entity ? JSON.stringify(ctx.entity) : 'none'}</span>;
};

const renderPage = (path: string, mount = true) =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AgentContextProvider>
            <Probe />
            <Routes>
              <Route path="/projects/:projectId/:tab" element={mount ? <ProjectDetail /> : <div />} />
              <Route path="/projects/:projectId" element={mount ? <ProjectDetail /> : <div />} />
            </Routes>
          </AgentContextProvider>
        </MemoryRouter>
      </ToastProvider>
    </ImpersonationProvider>,
  );

it('AC-AXP-015 detail route publishes entity', () => {
  const { rerender } = renderPage('/projects/p-123');

  expect(screen.getByTestId('entity').textContent).toBe(
    JSON.stringify({ type: 'project', id: 'p-123', label: 'Alpha' }),
  );

  // Unmount ProjectDetail (navigate away) — the entity context clears.
  rerender(
    <ImpersonationProvider realRole="Project Manager">
      <ToastProvider>
        <MemoryRouter initialEntries={['/projects/p-123']}>
          <AgentContextProvider>
            <Probe />
          </AgentContextProvider>
        </MemoryRouter>
      </ToastProvider>
    </ImpersonationProvider>,
  );

  expect(screen.getByTestId('entity').textContent).toBe('none');
});
