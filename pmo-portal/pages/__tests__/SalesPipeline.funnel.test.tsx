import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
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

const { pipelineState, lostState, wonState } = vi.hoisted(() => ({
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
  lostState: { data: [] as unknown[] },
  wonState: { data: [] as unknown[] },
}));

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => pipelineState,
  useLostDeals: () => lostState,
  useWonDeals: () => ({ data: wonState.data, isPending: false, isError: false, refetch: vi.fn() }),
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

// list-working-set-return (#682): the page's view is now URL-owned; force table view via `?view=`
// (previously done by mocking the whole usePipelineView module, which also shadowed the
// DEFAULT_PIPELINE_VIEW/PIPELINE_VIEWS exports listWorkingSet.ts imports directly).
const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter initialEntries={['/sales?view=table']}>
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

const seedProjects = [
  { id: 'p1', name: 'Leads Project Alpha', client_name: 'Alpha Corp', status: 'Leads', contract_value: 200000, currency: 'USD', win_probability: 0.1 },
  { id: 'p2', name: 'Tender Project Beta', client_name: 'Beta Ltd', status: 'Tender Submitted', contract_value: 1200000, currency: 'USD', win_probability: 0.5 },
  { id: 'p3', name: 'Negotiation Project Gamma', client_name: 'Gamma Inc', status: 'Negotiation', contract_value: 900000, currency: 'USD', win_probability: 0.75 },
  { id: 'p4', name: 'PQ Project Delta', client_name: 'Delta Co', status: 'PQ Submitted', contract_value: 500000, currency: 'USD', win_probability: 0.25 },
];

beforeEach(() => {
  pipelineState.data = {
    stages: [
      { status: 'Leads', count: 1, total_value: 200000, currency: 'USD', win_probability: 0.1, weighted_value: 20000 },
      { status: 'PQ Submitted', count: 1, total_value: 500000, currency: 'USD', win_probability: 0.25, weighted_value: 125000 },
      { status: 'Quotation Submitted', count: 0, total_value: 0, currency: 'USD', win_probability: 0.4, weighted_value: 0 },
      { status: 'Tender Submitted', count: 1, total_value: 1200000, currency: 'USD', win_probability: 0.5, weighted_value: 600000 },
      { status: 'Negotiation', count: 1, total_value: 900000, currency: 'USD', win_probability: 0.75, weighted_value: 675000 },
    ],
    projects: seedProjects,
  };
  pipelineState.isPending = false;
  pipelineState.isError = false;
  lostState.data = [];
  wonState.data = [];
});

describe('AC-SFA-001: sales pipeline stages use one open-value scale', () => {
  it('shows open-value bars, keeps weighted values labelled, hides stage chances, and omits an empty-stage bar', () => {
    renderPage();
    const summary = screen.getByLabelText('Pipeline summary');
    const leads = within(summary).getByRole('button', { name: /Leads/ });
    const quotation = within(summary).getByRole('button', { name: /Quotation submitted/ });
    const leadsBarFill = leads.querySelector('[data-funnel-stage-bar] > span') as HTMLElement;

    expect(within(summary).queryByText(/\b\d+%/)).not.toBeInTheDocument();
    expect(parseFloat(leadsBarFill.style.width)).toBeCloseTo((200_000 / 1_200_000) * 100);
    expect(within(leads).getByText('$20,000 weighted')).toBeInTheDocument();
    // An empty stage is still a money row: its zero carries the band's currency, never a bare "0"
    // that reads as a deal count among the amounts.
    expect(within(quotation).getByText('$0', { exact: true })).toBeInTheDocument();
    expect(quotation.querySelector('[data-funnel-stage-bar]')).toBeNull();
  });

  it('keeps every stage bar on the one shared scale, the largest stage full', () => {
    renderPage();
    const summary = screen.getByLabelText('Pipeline summary');
    const widths = Array.from(summary.querySelectorAll('[data-funnel-stage-bar] > span'))
      .map((bar) => parseFloat((bar as HTMLElement).style.width));
    // Leads 200k, PQ 500k, Tender 1.2M (the maximum), Negotiation 900k; the empty stage draws none.
    expect(widths).toHaveLength(4);
    expect(widths[0]).toBeCloseTo(200 / 12, 6);
    expect(widths[1] / widths[0]).toBeCloseTo(2.5, 6);
    expect(widths[2]).toBeCloseTo(100, 6);
    expect(widths[3] / widths[2]).toBeCloseTo(0.75, 6);
  });

  it('draws no bar it cannot scale: a mixed-currency stage reads its withheld amount, and the band draws no bars at all', () => {
    pipelineState.data = {
      stages: [
        { status: 'Leads', count: 1, total_value: 200_000, currency: 'USD', win_probability: 0.1, weighted_value: 20_000 },
        { status: 'PQ Submitted', count: 1, total_value: 500_000, currency: 'USD', win_probability: 0.25, weighted_value: 125_000 },
        { status: 'Quotation Submitted', count: 0, total_value: 0, currency: 'USD', win_probability: 0.4, weighted_value: 0 },
        { status: 'Tender Submitted', count: 2, total_value: 1_201_234, win_probability: 0.5, weighted_value: 600_617 },
        { status: 'Negotiation', count: 1, total_value: 900_000, currency: 'USD', win_probability: 0.75, weighted_value: 675_000 },
      ],
      projects: [
        ...seedProjects,
        { id: 'idr-mixed', name: 'Mixed Currency Tender', client_name: 'Garuda', status: 'Tender Submitted', contract_value: 1_234, currency: 'IDR', win_probability: 0.5 },
      ],
    } as never;
    renderPage();
    const summary = screen.getByLabelText('Pipeline summary');
    const tender = within(summary).getByRole('button', { name: /Tender submitted/ });
    expect(tender.querySelector('[data-funnel-stage-amount]')).toHaveTextContent('—');
    // No shared scale exists while the open stages mix currencies, so no stage draws a bar.
    expect(summary.querySelectorAll('[data-funnel-stage-bar]')).toHaveLength(0);
  });

  it('labels the pipeline outcome counts as all time', () => {
    wonState.data = [{
      id: 'won-1', name: 'Won project', status: 'Won, Pending KoM', contract_value: 10_000,
      currency: 'USD', win_probability: 1,
    }];
    lostState.data = [{
      id: 'lost-1', name: 'Lost project', status: 'Loss Tender', contract_value: 5_000,
      currency: 'USD', win_probability: 0,
    }];

    renderPage();

    const needsAttention = screen.getByLabelText('Needs attention');
    expect(within(needsAttention).getByRole('button', { name: 'Won 1 all time' })).toBeInTheDocument();
    expect(within(needsAttention).getByRole('button', { name: 'Lost 1 all time' })).toBeInTheDocument();
  });
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
    const tenderCell = within(funnelSection).getByText('Tender submitted');
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
    const tenderCell = within(funnelSection).getByText('Tender submitted');

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
    const tenderCell = within(funnelSection).getByText('Tender submitted');
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
    const tenderCell = within(funnelSection).getByText('Tender submitted');
    const cellEl = tenderCell.closest('[role="button"]') as HTMLElement;
    expect(cellEl).not.toBeNull();

    cellEl.focus();
    await user.keyboard('{Enter}');

    expect(screen.queryByText('Leads Project Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Tender Project Beta')).toBeInTheDocument();
  });
});

describe('AC-SFA-002: funnel selection stays in sync via click, Enter, and Space', () => {
  const assertTenderOnly = () => {
    expect(screen.getByText('Tender Project Beta')).toBeInTheDocument();
    expect(screen.queryByText('Leads Project Alpha')).not.toBeInTheDocument();
    expect(screen.queryByText('PQ Project Delta')).not.toBeInTheDocument();
    expect(screen.queryByText('Negotiation Project Gamma')).not.toBeInTheDocument();
  };

  const tenderButton = () =>
    within(screen.getByLabelText('Pipeline summary')).getByRole('button', {
      name: /Tender submitted/,
    });

  it('AC-SFA-002: clicking the Tender stage selects it; aria-pressed matches the filtered list', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(tenderButton()).toHaveAttribute('aria-pressed', 'false');
    await user.click(tenderButton());
    expect(tenderButton()).toHaveAttribute('aria-pressed', 'true');
    assertTenderOnly();
  });

  it('AC-SFA-002: pressing Enter on the Tender stage selects it; aria-pressed matches the filtered list', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(tenderButton()).toHaveAttribute('aria-pressed', 'false');
    tenderButton().focus();
    await user.keyboard('{Enter}');
    expect(tenderButton()).toHaveAttribute('aria-pressed', 'true');
    assertTenderOnly();
  });

  it('AC-SFA-002: pressing Space on the Tender stage selects it; aria-pressed matches the filtered list', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(tenderButton()).toHaveAttribute('aria-pressed', 'false');
    tenderButton().focus();
    await user.keyboard(' ');
    expect(tenderButton()).toHaveAttribute('aria-pressed', 'true');
    assertTenderOnly();
  });
});
