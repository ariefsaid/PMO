import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/** AC-JR-W4-03: the toolbar Stage selector owns the shared visible set. The summary is read-only. */
const { pipelineState } = vi.hoisted(() => ({
  pipelineState: {
    data: {
      stages: [
        { status: 'Leads', count: 1, total_value: 200000, currency: 'USD', win_probability: 0.1, weighted_value: 20000 },
        { status: 'PQ Submitted', count: 1, total_value: 500000, currency: 'USD', win_probability: 0.25, weighted_value: 125000 },
        { status: 'Quotation Submitted', count: 0, total_value: 0, currency: 'USD', win_probability: 0.4, weighted_value: 0 },
        { status: 'Tender Submitted', count: 1, total_value: 1200000, currency: 'USD', win_probability: 0.5, weighted_value: 600000 },
        { status: 'Negotiation', count: 1, total_value: 900000, currency: 'USD', win_probability: 0.75, weighted_value: 675000 },
      ],
      projects: [
        { id: 'p1', name: 'Leads Project Alpha', client_name: 'Alpha Corp', status: 'Leads', contract_value: 200000, currency: 'USD', win_probability: 0.1 },
        { id: 'p2', name: 'Tender Project Beta', client_name: 'Beta Ltd', status: 'Tender Submitted', contract_value: 1200000, currency: 'USD', win_probability: 0.5 },
        { id: 'p3', name: 'Negotiation Project Gamma', client_name: 'Gamma Inc', status: 'Negotiation', contract_value: 900000, currency: 'USD', win_probability: 0.75 },
        { id: 'p4', name: 'PQ Project Delta', client_name: 'Delta Co', status: 'PQ Submitted', contract_value: 500000, currency: 'USD', win_probability: 0.25 },
      ],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => pipelineState, useLostDeals: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectMutations: () => ({ create: {} }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }) }));

import SalesPipeline from '../../pages/SalesPipeline';

const renderPage = (entry = '/sales?view=table') => render(
  <ImpersonationProvider realRole="Project Manager">
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider><SalesPipeline /></ToastProvider>
    </MemoryRouter>
  </ImpersonationProvider>,
);

beforeEach(() => {
  pipelineState.isPending = false;
  pipelineState.isError = false;
});

describe('AC-JR-W4-03: Stage control scopes Board and Table', () => {
  it('shows all open projects before a stage is selected', () => {
    renderPage();
    expect(screen.getByText('Leads Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Tender Project Beta')).toBeInTheDocument();
    expect(screen.getByText('Negotiation Project Gamma')).toBeInTheDocument();
    expect(screen.getByText('PQ Project Delta')).toBeInTheDocument();
  });

  it('selecting Tender filters the actual table rows and All stages clears that subset', async () => {
    const user = userEvent.setup();
    renderPage();
    const stage = screen.getByRole('combobox', { name: 'Stage' });
    await user.selectOptions(stage, 'Tender Submitted');
    expect(screen.getByText('Tender Project Beta')).toBeInTheDocument();
    expect(screen.queryByText('Leads Project Alpha')).not.toBeInTheDocument();
    expect(screen.queryByText('Negotiation Project Gamma')).not.toBeInTheDocument();
    expect(screen.queryByText('PQ Project Delta')).not.toBeInTheDocument();
    await user.selectOptions(stage, '');
    expect(screen.getByText('Leads Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('PQ Project Delta')).toBeInTheDocument();
  });

  it('a stage URL restores the same set while the forecast remains a closed read-only summary', async () => {
    renderPage('/sales?view=table&status=Tender%20Submitted');
    expect(screen.getByRole('combobox', { name: 'Stage' })).toHaveValue('Tender Submitted');
    expect(screen.getByText('Tender Project Beta')).toBeInTheDocument();
    expect(screen.queryByText('Leads Project Alpha')).not.toBeInTheDocument();
    const summary = screen.getByTestId('sales-summary');
    expect(summary).not.toHaveAttribute('open');
    await userEvent.click(screen.getByText('Pipeline summary'));
    expect(within(summary).getByText('Leads')).toBeInTheDocument();
    expect(within(summary).queryByRole('button')).toBeNull();
  });
});
