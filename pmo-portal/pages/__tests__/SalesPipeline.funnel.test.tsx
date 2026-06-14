import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * AC-JR-W4-03: SalesPipeline Funnel scopes table/board by selected stage (onSelect/selectedIndex).
 *
 * The Funnel already supports onSelect/selectedIndex (Funnel.tsx:18,30-46) but
 * SalesPipeline.tsx passes none. After the fix, clicking a funnel stage cell:
 *   1. Highlights that cell (selected styling / aria-pressed equivalent).
 *   2. Scopes the table to show ONLY rows with that stage's status.
 *   3. Clicking the same stage again clears the filter (toggle).
 *
 * Verification: switch to table view to inspect rows; funnel is always visible in the
 * banner above the toolbar so it's present in both views.
 */

const { pipelineState, lostState } = vi.hoisted(() => ({
  pipelineState: {
    data: {
      stages: [
        { status: 'Leads', count: 1, total_value: 200000, win_probability: 0.1, weighted_value: 20000 },
        { status: 'PQ Submitted', count: 1, total_value: 500000, win_probability: 0.25, weighted_value: 125000 },
        { status: 'Quotation Submitted', count: 0, total_value: 0, win_probability: 0.4, weighted_value: 0 },
        { status: 'Tender Submitted', count: 1, total_value: 1200000, win_probability: 0.5, weighted_value: 600000 },
        { status: 'Negotiation', count: 1, total_value: 900000, win_probability: 0.75, weighted_value: 675000 },
      ],
      projects: [
        { id: 'p1', name: 'Leads Project Alpha', client_name: 'Alpha Corp', status: 'Leads', contract_value: 200000, win_probability: 0.1 },
        { id: 'p2', name: 'Tender Project Beta', client_name: 'Beta Ltd', status: 'Tender Submitted', contract_value: 1200000, win_probability: 0.5 },
        { id: 'p3', name: 'Negotiation Project Gamma', client_name: 'Gamma Inc', status: 'Negotiation', contract_value: 900000, win_probability: 0.75 },
        { id: 'p4', name: 'PQ Project Delta', client_name: 'Delta Co', status: 'PQ Submitted', contract_value: 500000, win_probability: 0.25 },
      ],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  lostState: { data: [] as unknown[] },
}));

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
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

// Force table view so we can inspect filtered rows easily.
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

const seedProjects = [
  { id: 'p1', name: 'Leads Project Alpha', client_name: 'Alpha Corp', status: 'Leads', contract_value: 200000, win_probability: 0.1 },
  { id: 'p2', name: 'Tender Project Beta', client_name: 'Beta Ltd', status: 'Tender Submitted', contract_value: 1200000, win_probability: 0.5 },
  { id: 'p3', name: 'Negotiation Project Gamma', client_name: 'Gamma Inc', status: 'Negotiation', contract_value: 900000, win_probability: 0.75 },
  { id: 'p4', name: 'PQ Project Delta', client_name: 'Delta Co', status: 'PQ Submitted', contract_value: 500000, win_probability: 0.25 },
];

beforeEach(() => {
  pipelineState.data = {
    stages: [
      { status: 'Leads', count: 1, total_value: 200000, win_probability: 0.1, weighted_value: 20000 },
      { status: 'PQ Submitted', count: 1, total_value: 500000, win_probability: 0.25, weighted_value: 125000 },
      { status: 'Quotation Submitted', count: 0, total_value: 0, win_probability: 0.4, weighted_value: 0 },
      { status: 'Tender Submitted', count: 1, total_value: 1200000, win_probability: 0.5, weighted_value: 600000 },
      { status: 'Negotiation', count: 1, total_value: 900000, win_probability: 0.75, weighted_value: 675000 },
    ],
    projects: seedProjects,
  };
  pipelineState.isPending = false;
  pipelineState.isError = false;
  lostState.data = [];
});

describe('AC-JR-W4-03: Funnel stage click scopes the table', () => {
  it('AC-JR-W4-03: before any funnel click the table shows all open projects', async () => {
    renderPage();
    // All four open projects visible
    expect(screen.getByText('Leads Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Tender Project Beta')).toBeInTheDocument();
    expect(screen.getByText('Negotiation Project Gamma')).toBeInTheDocument();
    expect(screen.getByText('PQ Project Delta')).toBeInTheDocument();
  });

  it('AC-JR-W4-03: clicking the Tender funnel stage narrows the table to Tender rows only', async () => {
    const user = userEvent.setup();
    renderPage();

    // The funnel section is in the Pipeline summary area
    const funnelSection = screen.getByLabelText('Pipeline summary');
    const tenderCell = within(funnelSection).getByText('Tender');
    await user.click(tenderCell);

    // Only "Tender Submitted" projects visible
    expect(screen.getByText('Tender Project Beta')).toBeInTheDocument();
    // Others filtered out
    expect(screen.queryByText('Leads Project Alpha')).not.toBeInTheDocument();
    expect(screen.queryByText('Negotiation Project Gamma')).not.toBeInTheDocument();
    expect(screen.queryByText('PQ Project Delta')).not.toBeInTheDocument();
  });

  it('AC-JR-W4-03: clicking the Negotiation funnel stage narrows the table to Negotiation rows only', async () => {
    const user = userEvent.setup();
    renderPage();

    const funnelSection = screen.getByLabelText('Pipeline summary');
    const negotiationCell = within(funnelSection).getByText('Negotiation');
    await user.click(negotiationCell);

    expect(screen.getByText('Negotiation Project Gamma')).toBeInTheDocument();
    expect(screen.queryByText('Leads Project Alpha')).not.toBeInTheDocument();
    expect(screen.queryByText('Tender Project Beta')).not.toBeInTheDocument();
    expect(screen.queryByText('PQ Project Delta')).not.toBeInTheDocument();
  });

  it('AC-JR-W4-03: clicking the same stage again clears the stage filter (toggle off)', async () => {
    const user = userEvent.setup();
    renderPage();

    const funnelSection = screen.getByLabelText('Pipeline summary');
    const tenderCell = within(funnelSection).getByText('Tender');

    // First click — filter ON
    await user.click(tenderCell);
    expect(screen.queryByText('Leads Project Alpha')).not.toBeInTheDocument();

    // Second click on same cell — filter OFF, all rows back
    await user.click(tenderCell);
    expect(screen.getByText('Leads Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Tender Project Beta')).toBeInTheDocument();
    expect(screen.getByText('Negotiation Project Gamma')).toBeInTheDocument();
  });

  it('AC-JR-W4-03: the active funnel cell receives selected styling (selected state applied)', async () => {
    const user = userEvent.setup();
    renderPage();

    const funnelSection = screen.getByLabelText('Pipeline summary');
    const tenderCell = within(funnelSection).getByText('Tender');
    // The cell's parent button-role div gains bg-primary/[0.06] class when selected.
    const cellEl = tenderCell.closest('[role="button"]');
    expect(cellEl).not.toBeNull();
    expect(cellEl?.className).not.toContain('bg-primary');

    await user.click(tenderCell);
    // After click the parent div should have the selection class
    expect(cellEl?.className).toContain('bg-primary');
  });

  it('AC-JR-W4-03: Funnel stage cell is keyboard-operable (Enter key)', async () => {
    const user = userEvent.setup();
    renderPage();

    const funnelSection = screen.getByLabelText('Pipeline summary');
    const tenderCell = within(funnelSection).getByText('Tender');
    const cellEl = tenderCell.closest('[role="button"]') as HTMLElement;
    expect(cellEl).not.toBeNull();

    cellEl.focus();
    await user.keyboard('{Enter}');

    expect(screen.queryByText('Leads Project Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Tender Project Beta')).toBeInTheDocument();
  });
});
