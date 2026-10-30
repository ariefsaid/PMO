import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

/**
 * PGB-017 regression test:
 * PipelineLens carries the query status and missing-record state into stat tiles.
 * Shows loading or an unavailable value with retry rather than inventing 0% / $0.
 */

let role: Role = 'Project Manager';
const mockRefetch = vi.fn().mockResolvedValue(undefined);
const pipelineQueryState = {
  data: undefined as { stages: unknown[]; projects: Array<Record<string, unknown>> } | undefined,
  isPending: false,
  isError: false,
  refetch: mockRefetch,
};

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => pipelineQueryState,
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({ useProjectWinEligibility: () => ({ data: 'allowed' }) }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role }),
}));
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

import PipelineLens from '../PipelineLens';

const openDeal = {
  id: 'd1',
  name: 'Acme Tender Bid',
  code: 'OPP-0042',
  status: 'Tender Submitted',
  client_id: 'c1',
  project_manager_id: 'u-alice',
  contract_value: 1200000,
  currency: 'USD',
  budget: 0,
  spent: 0,
  decided_at: null,
  client: { name: 'Acme' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

const freshClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const component = () => (
    <MemoryRouter>
      <QueryClientProvider client={freshClient()}>
        <ImpersonationProvider realRole={role}>
          <ToastProvider>
            <PipelineLens project={openDeal} />
          </ToastProvider>
        </ImpersonationProvider>
      </QueryClientProvider>
    </MemoryRouter>
);
const renderComponent = () => render(component());
const tile = (name: string) => within(screen.getByText(name).parentElement as HTMLElement);
const recovered = (probability: number) => ({ stages: [], projects: [{ id: 'd1', contract_value: 1200000, win_probability: probability }] });

beforeEach(() => {
  role = 'Project Manager';
  mockRefetch.mockReset();
  pipelineQueryState.data = undefined;
  pipelineQueryState.isPending = false;
  pipelineQueryState.isError = false;
});

describe('PipelineLens — PGB-017: query status and missing record state', () => {
  it('shows loading indicator on Win probability and Weighted tiles while query is pending', () => {
    pipelineQueryState.isPending = true;
    renderComponent();

    // Must NOT invent 0% or $0
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();

    // Should indicate loading
    const loadingElements = screen.getAllByText(/loading/i);
    expect(loadingElements).toHaveLength(2);
    expect(tile('Win probability').getByText(/loading/i)).toBeInTheDocument();
    expect(tile('Weighted').getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows unavailable state with retry on Win probability and Weighted tiles when query errors', async () => {
    pipelineQueryState.isError = true;
    const rendered = renderComponent();

    // Must NOT invent 0% or $0
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();

    // Should show unavailable copy and a Retry button
    expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0);
    const retryButtons = screen.getAllByRole('button', { name: /retry/i });
    expect(retryButtons.length).toBeGreaterThan(0);

    expect(tile('Win probability').getByText(/unavailable/i)).toBeInTheDocument();
    expect(tile('Weighted').getByText(/unavailable/i)).toBeInTheDocument();
    mockRefetch.mockImplementation(() => { pipelineQueryState.isError = false; pipelineQueryState.data = recovered(0.5); rendered.rerender(component()); });
    await userEvent.click(retryButtons[0]);
    expect(mockRefetch).toHaveBeenCalled();
    expect(tile('Win probability').getByText('50%')).toBeInTheDocument();
    expect(tile('Weighted').getByText('$600,000')).toBeInTheDocument();
  });

  it('shows unavailable state with retry when project record is missing from successful pipeline query', async () => {
    pipelineQueryState.data = {
      stages: [],
      projects: [{ id: 'other-id', name: 'Other Project', status: 'Leads', contract_value: 50000, currency: 'USD', win_probability: 0.2 }],
    };
    const rendered = renderComponent();

    // Must NOT invent 0% or $0
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();

    expect(tile('Win probability').getByText(/unavailable/i)).toBeInTheDocument();
    expect(tile('Weighted').getByText(/unavailable/i)).toBeInTheDocument();
    mockRefetch.mockImplementation(() => { pipelineQueryState.data = recovered(0.25); rendered.rerender(component()); });
    await userEvent.click(tile('Weighted').getByRole('button', { name: /retry/i }));
    expect(tile('Win probability').getByText('25%')).toBeInTheDocument();
    expect(tile('Weighted').getByText('$300,000')).toBeInTheDocument();
  });

  it('shows genuine zero probability and weighted value when the record is present', () => {
    pipelineQueryState.data = recovered(0);
    renderComponent();
    expect(tile('Win probability').getByText('0%')).toBeInTheDocument();
    expect(tile('Weighted').getByText('$0')).toBeInTheDocument();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  it('shows probability but hides both money tiles for an Engineer', () => {
    role = 'Engineer';
    pipelineQueryState.data = recovered(0.5);
    renderComponent();
    expect(tile('Win probability').getByText('50%')).toBeInTheDocument();
    expect(screen.queryByText('Weighted')).not.toBeInTheDocument();
    expect(screen.queryByText('Value')).not.toBeInTheDocument();
    expect(screen.queryByText('$600,000')).not.toBeInTheDocument();
    expect(screen.queryByText('$1,200,000')).not.toBeInTheDocument();
  });

});
