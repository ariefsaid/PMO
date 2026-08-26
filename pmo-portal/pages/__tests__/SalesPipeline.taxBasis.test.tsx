import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * OD-TAX-1 §2 on the pipeline TABLE (#578): no bare number anywhere the treatment exists.
 *
 * This was the one money surface #548 could not label — `get_sales_pipeline()` did not project
 * `tax_treatment`, so the FE had nothing to render and left the figure bare rather than guess.
 * Migration 0208 adds the column to the projection; this proves the table renders it.
 *
 * ⚑ THE FIXTURE MIXES BASES ON PURPOSE. Two deals with DIFFERENT treatments, asserted separately:
 * a single-basis fixture cannot tell a row-derived label from a hardcoded one, which is how the
 * per-record currency gap shipped in 0044 and how #566's drawdown label passed 26 tests while
 * hardcoded. The third row carries the legal NULL basis (0197 permits it only at zero value) and
 * must render NOTHING — a guessed label is a confident claim about a contract nobody made.
 */

const { pipelineState, lostState } = vi.hoisted(() => ({
  pipelineState: {
    data: {
      stages: [
        { status: 'Leads', count: 1, total_value: 200000, win_probability: 0.1, weighted_value: 20000 },
        { status: 'Tender Submitted', count: 1, total_value: 1200000, win_probability: 0.5, weighted_value: 600000 },
        { status: 'Negotiation', count: 1, total_value: 0, win_probability: 0.75, weighted_value: 0 },
      ],
      projects: [
        { id: 'p1', name: 'Inclusive Deal Alpha', client_name: 'Alpha Corp', status: 'Leads', contract_value: 200000, currency: 'USD', tax_treatment: 'inclusive', win_probability: 0.1 },
        { id: 'p2', name: 'Exclusive Deal Beta', client_name: 'Beta Ltd', status: 'Tender Submitted', contract_value: 1200000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 0.5 },
        { id: 'p3', name: 'Unpriced Deal Gamma', client_name: 'Gamma Inc', status: 'Negotiation', contract_value: 0, currency: 'USD', tax_treatment: null, win_probability: 0.75 },
      ],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  // ⚑ The Lost column comes from useLostDeals, which hand-builds PipelineProject from a full
  // project row — a SEPARATE code path from the RPC. Typecheck forced the field to exist there;
  // only this fixture proves the value actually reaches the screen. Its basis is deliberately
  // 'inclusive' where the open deals differ, so a Lost card cannot borrow another row's label.
  lostState: {
    data: [
      { id: 'l1', name: 'Lost Deal Delta', client_name: 'Delta Co', status: 'Loss Tender', contract_value: 450000, currency: 'USD', tax_treatment: 'inclusive', win_probability: 0 },
    ] as unknown[],
  },
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
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('@/src/hooks/usePipelineView', () => ({
  usePipelineView: () => ['table', vi.fn()] as ['table', ReturnType<typeof vi.fn>],
}));

import SalesPipeline from '../../pages/SalesPipeline';

const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter>
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

const rowFor = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

describe('OD-TAX-1 §2: the pipeline table states each deal’s own tax basis (#578)', () => {
  it('AC-TAX-306: labels an inclusive row and an exclusive row from the rows themselves', () => {
    renderPage();
    expect(within(rowFor('Inclusive Deal Alpha')).getByTestId('tax-basis')).toHaveAttribute('data-tax-basis', 'inclusive');
    expect(within(rowFor('Exclusive Deal Beta')).getByTestId('tax-basis')).toHaveAttribute('data-tax-basis', 'exclusive');
  });

  it('AC-TAX-307: renders no basis where the row holds none, rather than falling back to the org default', () => {
    renderPage();
    expect(within(rowFor('Unpriced Deal Gamma')).queryByTestId('tax-basis')).toBeNull();
  });

  it('AC-TAX-308: a LOST deal states its basis too — that column is fed by useLostDeals, not the RPC', async () => {
    renderPage();
    // The table opens scoped to Open deals, so reaching a lost one means taking the same step a
    // user takes: switch the scope. Driving the real journey rather than asserting whatever the
    // default render happens to show — a bare figure on the Lost scope is still a bare figure.
    await userEvent.click(screen.getByRole('tab', { name: 'Lost' }));
    expect(within(rowFor('Lost Deal Delta')).getByTestId('tax-basis')).toHaveAttribute('data-tax-basis', 'inclusive');
  });
});
