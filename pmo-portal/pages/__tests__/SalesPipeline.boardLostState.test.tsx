import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
// Harness: the board now mounts DraggableSalesBoard (useQueryClient), so the page renders under a QueryClientProvider (#1637).
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
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
let desktop = true;
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => desktop }));
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

const page = (path = '/sales?view=kanban') => (
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>
  );
const renderDesktop = () => render(page());

const lostDeal = { id: 'lost-recovered', name: 'Recovered Lost Deal', client_name: 'Recovered Client', status: 'Loss Tender', currency: 'USD', contract_value: 20000, win_probability: 0, last_update: '2020-01-01T00:00:00Z' };

beforeEach(() => {
  desktop = true;
  lostState.data = [];
  lostState.refetch.mockReset();
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

    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
    // While lost deals is loading, the page should show loading state, not empty
    expect(screen.queryByText(/No projects yet/i)).not.toBeInTheDocument();
  });

  it('displays lost error and retry button on desktop board when lost deals query fails', async () => {
    lostState.isError = true;
    const rendered = renderDesktop();

    // Must NOT say "No projects yet"
    expect(screen.queryByText(/No projects yet/i)).not.toBeInTheDocument();

    // Board must show lost error with retry
    expect(screen.getByText(/Couldn't load lost projects/i)).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    lostState.refetch.mockImplementation(() => { lostState.isError = false; lostState.data = [lostDeal]; rendered.rerender(page()); });
    await userEvent.click(retryBtn);
    expect(lostState.refetch).toHaveBeenCalled();
    expect(screen.getByText('Recovered Lost Deal')).toBeInTheDocument();
  });

  it.each([
    ['desktop Lost table', true, '/sales?view=table&scope=Lost'],
    ['desktop Needs attention table', true, '/sales?view=table&scope=Needs+attention'],
    ['mobile Lost list', false, '/sales?view=table&scope=Lost'],
    ['mobile Needs attention list', false, '/sales?view=table&scope=Needs+attention'],
  ])('recovers the %s after retry', async (_label, isDesktop, path) => {
    desktop = isDesktop;
    lostState.isError = true;
    const rendered = render(page(path));
    expect(screen.getByText(/Couldn't load lost projects/i)).toBeInTheDocument();
    lostState.refetch.mockImplementation(() => { lostState.isError = false; lostState.data = [lostDeal]; rendered.rerender(page(path)); });
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(screen.getByText('Recovered Lost Deal')).toBeInTheDocument();
    expect(screen.getByText('Recovered Client')).toBeInTheDocument();
  });

});
