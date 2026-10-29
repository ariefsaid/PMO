import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

/**
 * PGB-017 regression test:
 * PipelineLens carries the query status and missing-record state into stat tiles.
 * Shows loading or an unavailable value with retry rather than inventing 0% / $0.
 */

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
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
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

const renderComponent = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <ToastProvider>
        <PipelineLens project={openDeal} />
      </ToastProvider>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  mockRefetch.mockClear();
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
    expect(loadingElements.length).toBeGreaterThan(0);
  });

  it('shows unavailable state with retry on Win probability and Weighted tiles when query errors', async () => {
    pipelineQueryState.isError = true;
    renderComponent();

    // Must NOT invent 0% or $0
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();

    // Should show unavailable copy and a Retry button
    expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0);
    const retryButtons = screen.getAllByRole('button', { name: /retry/i });
    expect(retryButtons.length).toBeGreaterThan(0);

    await userEvent.click(retryButtons[0]);
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows unavailable state with retry when project record is missing from successful pipeline query', async () => {
    pipelineQueryState.data = {
      stages: [],
      projects: [{ id: 'other-id', name: 'Other Project', status: 'Leads', contract_value: 50000, currency: 'USD', win_probability: 0.2 }],
    };
    renderComponent();

    // Must NOT invent 0% or $0
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();

    // Should show unavailable copy
    expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0);
  });
});
