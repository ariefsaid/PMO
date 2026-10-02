/**
 * AC-EC-003 — issue #758: the Sales Pipeline shows the deal's end customer. The RPC projects
 * end_client_name (migration 0223); the pipeline's table column renders it and its search matches
 * it (the same way the pipeline filters by client today). Rendered under ImpersonationProvider +
 * MemoryRouter + ToastProvider, with useDashboard mocked.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import SalesPipeline from '../../pages/SalesPipeline';

const { pipelineState, lostState } = vi.hoisted(() => ({
  pipelineState: {
    data: {
      stages: [
        { status: 'Tender Submitted', count: 1, total_value: 500000, currency: 'USD', win_probability: 0.5, weighted_value: 250000 },
      ],
      projects: [
        {
          id: 'p1', name: 'Subcontractor Fit-Out', client_name: 'Main Contractor Co',
          end_client_id: '75800000-0000-0000-0000-0000000000a1', end_client_name: 'Asset Owner PT',
          status: 'Tender Submitted', contract_value: 500000, currency: 'USD',
          tax_treatment: 'exclusive', win_probability: 0.5, last_update: '2026-08-01T00:00:00Z',
        },
      ],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  lostState: { data: [] as unknown[] },
}));

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => pipelineState,
  useLostDeals: () => lostState,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [{ id: '75800000-0000-0000-0000-0000000000a1', name: 'Asset Owner PT', type: 'Client' }], isError: false }),
}));

const renderPipeline = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter initialEntries={['/sales?view=table']}>
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

describe('AC-EC-003 — pipeline end customer', () => {
  it('AC-EC-003: the table shows the End customer column with the deal end-customer name', () => {
    renderPipeline();
    expect(screen.getByText('End customer')).toBeInTheDocument();
    expect(screen.getByText('Asset Owner PT')).toBeInTheDocument();
  });

  it('AC-EC-003: pipeline search matches the end-customer name (like it matches the client)', async () => {
    const user = userEvent.setup();
    renderPipeline();
    const search = screen.getByRole('searchbox', { name: /Search projects/i });
    // Search a phrase that only the END CUSTOMER name contains — the row must still appear.
    await user.type(search, 'Asset Owner');
    expect(screen.getByText('Subcontractor Fit-Out')).toBeInTheDocument();
  });

  it('AC-EC-003: the pipeline search does not falsely match when only the client differs', async () => {
    const user = userEvent.setup();
    renderPipeline();
    const search = screen.getByRole('searchbox', { name: /Search projects/i });
    // A client-only phrase that the end customer does not contain must leave the deal visible
    // (search is on name + client + end customer).
    await user.type(search, 'Main Contractor');
    expect(screen.getByText('Subcontractor Fit-Out')).toBeInTheDocument();
  });
});