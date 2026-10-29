import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * PGA05-006 regression test:
 * Lost-deals query pending state must enter loading state.
 * Lost-deals error must be shown on desktop board with retry (not silently omitted or false empty).
 */

const { pipelineState, lostState, wonState } = vi.hoisted(() => ({
  pipelineState: {
    data: {
      stages: [],
      projects: [],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  lostState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  wonState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => pipelineState,
  useLostDeals: () => lostState,
  useWonDeals: () => wonState,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));

import SalesPipeline from '../SalesPipeline';

const renderDesktop = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter initialEntries={['/sales?view=kanban']}>
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  pipelineState.isPending = false;
  pipelineState.isError = false;
  lostState.isPending = false;
  lostState.isError = false;
  lostState.refetch.mockClear();
  wonState.isPending = false;
  wonState.isError = false;
});

describe('SalesPipeline — PGA05-006: lost query pending and error on desktop board', () => {
  it('enters loading state when lost deals query is pending', () => {
    lostState.isPending = true;
    renderDesktop();

    // While lost deals is loading, the page should show loading state, not empty
    expect(screen.queryByText(/No projects yet/i)).not.toBeInTheDocument();
  });

  it('displays lost error and retry button on desktop board when lost deals query fails', async () => {
    lostState.isError = true;
    renderDesktop();

    // Must NOT say "No projects yet"
    expect(screen.queryByText(/No projects yet/i)).not.toBeInTheDocument();

    // Board must show lost error with retry
    expect(screen.getByText(/Couldn't load lost projects/i)).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    await userEvent.click(retryBtn);
    expect(lostState.refetch).toHaveBeenCalled();
  });
});
