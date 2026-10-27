import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { BahasaProvider } from '@/test/bahasa';

/**
 * Discover 2026-09-30 — the /sales funnel band names stayed English ("Leads", "Quotation") in
 * Bahasa because `funnelStages` used the column's own English `title`. They must say the same
 * words as the board tabs (`useSalesStageLabel`). Enum values stay data; only labels translate.
 */

const { pipelineState, lostState } = vi.hoisted(() => ({
  pipelineState: {
    data: {
      stages: [
        { status: 'Leads', count: 1, total_value: 200000, currency: 'USD', win_probability: 0.1, weighted_value: 20000 },
        { status: 'PQ Submitted', count: 0, total_value: 0, currency: 'USD', win_probability: 0.25, weighted_value: 0 },
        { status: 'Quotation Submitted', count: 0, total_value: 0, currency: 'USD', win_probability: 0.4, weighted_value: 0 },
        { status: 'Tender Submitted', count: 0, total_value: 0, currency: 'USD', win_probability: 0.5, weighted_value: 0 },
        { status: 'Negotiation', count: 0, total_value: 0, currency: 'USD', win_probability: 0.75, weighted_value: 0 },
      ],
      projects: [
        { id: 'p1', name: 'Leads Project Alpha', client_name: 'Alpha Corp', status: 'Leads', contract_value: 200000, currency: 'USD', win_probability: 0.1 },
      ],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  lostState: { data: [] as unknown[] },
}));

// ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a syntax error.
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
import SalesPipeline from '../../pages/SalesPipeline';

describe('SalesPipeline funnel in Bahasa', () => {
  it('the funnel band shows Bahasa stage names, not the English column titles', () => {
    render(
      <BahasaProvider>
        <ImpersonationProvider realRole="Project Manager">
          <MemoryRouter initialEntries={['/sales?view=table']}>
            <ToastProvider>
              <SalesPipeline />
            </ToastProvider>
          </MemoryRouter>
        </ImpersonationProvider>
      </BahasaProvider>,
    );
    const grid = screen.getByTestId('funnel-stage-grid');
    const name = (n: string) => within(grid).getByText(n, { exact: true });
    expect(name('Prospek')).toBeInTheDocument();
    expect(name('Pra-kualifikasi')).toBeInTheDocument();
    expect(name('Penawaran')).toBeInTheDocument();
    expect(name('Tender')).toBeInTheDocument();
    expect(name('Negosiasi')).toBeInTheDocument();
    expect(within(grid).queryByText('Leads', { exact: true })).toBeNull();
    expect(within(grid).queryByText('Pre-Qual', { exact: true })).toBeNull();
    expect(within(grid).queryByText('Quotation', { exact: true })).toBeNull();
  });
});
