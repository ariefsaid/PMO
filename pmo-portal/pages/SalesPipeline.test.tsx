import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import SalesPipeline from './SalesPipeline';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { formatCurrency } from '@/src/lib/format';

// Oracle stages from spec §3.8 — Won/Lost are NOT in the funnel band.
const seedStages = [
  { status: 'Leads', count: 0, total_value: 0, win_probability: 0.1, weighted_value: 0 },
  { status: 'PQ Submitted', count: 1, total_value: 800000, win_probability: 0.25, weighted_value: 200000 },
  { status: 'Quotation Submitted', count: 0, total_value: 0, win_probability: 0.4, weighted_value: 0 },
  { status: 'Tender Submitted', count: 1, total_value: 1200000, win_probability: 0.5, weighted_value: 600000 },
  { status: 'Negotiation', count: 0, total_value: 0, win_probability: 0.75, weighted_value: 0 },
];
const seedProjects = [
  { id: 'p2', name: 'Northwind ERP Rollout', client_name: 'Northwind', status: 'Tender Submitted', contract_value: 1200000, win_probability: 0.5 },
  { id: 'p10', name: 'Regional Services', client_name: null, status: 'PQ Submitted', contract_value: 800000, win_probability: 0.25 },
];

const pipelineState: {
  data: { stages: typeof seedStages; projects: typeof seedProjects } | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = { data: { stages: seedStages, projects: seedProjects }, isPending: false, isError: false, refetch: vi.fn() };

const navigate = vi.fn();

const lostState: { data: Array<Record<string, unknown>>; isPending: boolean; isError: boolean } = {
  data: [],
  isPending: false,
  isError: false,
};
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => pipelineState,
  useLostDeals: () => lostState,
  useDashboard: () => ({ data: undefined, isPending: false, isError: false }),
  useWinRate: () => ({ data: undefined, isPending: false, isError: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));
// Tabs are gone — row drill is a plain react-router navigate (AC-NAV-006).
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

// The pipeline-board journeys are a manager viewing/forecasting the pipeline; render under a
// PM real role so the A-4 Sales view-gate (Admin·Exec·PM·Finance) shows the board.
const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter>
        <SalesPipeline />
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  sessionStorage.clear();
  navigate.mockClear();
  pipelineState.data = { stages: seedStages, projects: seedProjects };
  pipelineState.isPending = false;
  pipelineState.isError = false;
  lostState.data = [];
  lostState.isPending = false;
  lostState.isError = false;
});

describe('SalesPipeline header + funnel (AC-SP-202)', () => {
  it('AC-SP-202 / C3: renders the page title, sub, and the live Export action (no dead New deal CTA)', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Sales Pipeline' })).toBeInTheDocument();
    // C3: the disabled "New deal" primary CTA is removed — a page is not
    // anchored by a dead button.
    expect(screen.queryByRole('button', { name: /New deal/i })).toBeNull();
    // the live Export outline button is kept.
    expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
  });

  it('AC-SP-202: funnel band shows the five open stages, not Won/Lost', () => {
    renderPage();
    const funnel = screen.getByLabelText('Pipeline summary');
    const f = within(funnel);
    expect(f.getByText('Leads')).toBeInTheDocument();
    expect(f.getByText('Negotiation')).toBeInTheDocument();
    expect(f.queryByText(/Won/)).toBeNull();
  });

  it('AC-1117: the weighted total test id is preserved and sums only the open stages', () => {
    renderPage();
    // 200000 + 600000 = 800000
    expect(screen.getByTestId('pipeline-weighted-total')).toHaveTextContent(formatCurrency(800000));
  });
});

describe('SalesPipeline states (AC-SP-203)', () => {
  it('AC-SP-203: loading renders the skeleton ListState (no spinner), aria-busy', () => {
    pipelineState.isPending = true; pipelineState.data = undefined;
    renderPage();
    // funnel band + body both skeleton (no spinner) — every loader is aria-busy.
    const loaders = screen.getAllByTestId('liststate-loading');
    expect(loaders.length).toBeGreaterThan(0);
    loaders.forEach((l) => expect(l).toHaveAttribute('aria-busy', 'true'));
  });

  it('AC-SP-203: error renders an alert + Retry that calls refetch', () => {
    pipelineState.isError = true; pipelineState.data = undefined;
    renderPage();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(pipelineState.refetch).toHaveBeenCalled();
  });

  it('AC-SP-203 / C3: empty renders the teaching empty state with NO dead CTA', () => {
    pipelineState.data = { stages: [], projects: [] };
    renderPage();
    expect(screen.getByText(/No opportunities yet/i)).toBeInTheDocument();
    // C3: the empty state teaches via its sub copy — no disabled "New deal" CTA.
    expect(screen.queryByRole('button', { name: /New deal/i })).toBeNull();
  });
});

describe('SalesPipeline view toggle (AC-SP-206) + kanban default (AC-SP-204)', () => {
  it('AC-SP-204: defaults to the Kanban view with the Tender stage column + its weighted total', () => {
    renderPage();
    const tender = screen.getByTestId('stage-Tender Submitted');
    expect(within(tender).getAllByText((t) => t.includes(formatCurrency(600000))).length).toBeGreaterThan(0);
  });

  it('AC-SP-206: the view toggle is a tablist with Kanban selected by default', () => {
    renderPage();
    const toggle = screen.getByRole('tablist', { name: /Pipeline view/i });
    const kanbanTab = within(toggle).getByRole('tab', { name: /Kanban/i });
    expect(kanbanTab).toHaveAttribute('aria-selected', 'true');
  });

  it('AC-SP-206 / AC-SP-205: switching to Table renders the DataTable with the deal rows', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    // table view: opportunity rows present
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    // win% progressbar with aria-label
    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);
  });

  it('I3: the data-less "Decision" column of em-dashes is omitted from the table', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    expect(screen.queryByRole('columnheader', { name: /Decision/i })).toBeNull();
  });

  it('AC-SP-206: the chosen view persists to sessionStorage', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    expect(sessionStorage.getItem('pmo.workspace.views')).toContain('table');
  });
});

describe('SalesPipeline drill-down (Model B canonical route)', () => {
  // Model B (ADR-0020): the deal's canonical detail route is /projects/:id (was /sales/:id).
  it('AC-IXD-PROJ-001: clicking a card navigates to the canonical /projects/:id detail route', () => {
    renderPage();
    fireEvent.click(screen.getByText('Northwind ERP Rollout').closest('[role="button"]')!);
    expect(navigate).toHaveBeenCalledWith('/projects/p2');
  });

  it('AC-IXD-PROJ-001: a table row click navigates to the canonical /projects/:id detail route', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    fireEvent.click(screen.getByText('Northwind ERP Rollout').closest('tr')!);
    expect(navigate).toHaveBeenCalledWith('/projects/p2');
  });
});

describe('SalesPipeline — Lost deals in the Pipeline (AC-IXD-PROJ-007)', () => {
  it('AC-IXD-PROJ-007: a lost deal appears in the terminal "Lost" kanban column', () => {
    lostState.data = [
      { id: 'pl', name: 'Coastal Depot Bid', client_name: 'Coastal', status: 'Loss Tender', contract_value: 950000, win_probability: 0 },
    ];
    renderPage();
    const lostColumn = screen.getByTestId('stage-Lost');
    expect(within(lostColumn).getByText('Coastal Depot Bid')).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-007: the "Lost" table filter scopes the table to lost deals', async () => {
    lostState.data = [
      { id: 'pl', name: 'Coastal Depot Bid', client_name: 'Coastal', status: 'Loss Tender', contract_value: 950000, win_probability: 0 },
    ];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    // default Open scope: the open deal shows, the lost deal does not
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.queryByText('Coastal Depot Bid')).toBeNull();
    // switch to the Lost scope: the lost deal shows, the open deal does not
    await userEvent.click(screen.getByRole('tab', { name: /^Lost$/i }));
    expect(screen.getByText('Coastal Depot Bid')).toBeInTheDocument();
    expect(screen.queryByText('Northwind ERP Rollout')).toBeNull();
  });
});
