import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import SalesPipeline from './SalesPipeline';
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

const openRecord = vi.fn();

vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => pipelineState,
  useDashboard: () => ({ data: undefined, isPending: false, isError: false }),
  useWinRate: () => ({ data: undefined, isPending: false, isError: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));
vi.mock('@/src/components/shell', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useWorkspaceTabs: () => ({ openRecord, openModule: vi.fn(), setDirty: vi.fn() }) };
});

const renderPage = () => render(<MemoryRouter><SalesPipeline /></MemoryRouter>);

beforeEach(() => {
  sessionStorage.clear();
  openRecord.mockClear();
  pipelineState.data = { stages: seedStages, projects: seedProjects };
  pipelineState.isPending = false;
  pipelineState.isError = false;
});

describe('SalesPipeline header + funnel (AC-SP-202)', () => {
  it('AC-SP-202: renders the page title, sub, and action buttons', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Sales Pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New deal/i })).toBeInTheDocument();
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

  it('AC-SP-203: empty renders the composed empty state with a New deal action', () => {
    pipelineState.data = { stages: [], projects: [] };
    renderPage();
    expect(screen.getByText(/No opportunities yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /New deal/i }).length).toBeGreaterThan(0);
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

  it('AC-SP-206: the chosen view persists to sessionStorage', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    expect(sessionStorage.getItem('pmo.workspace.views')).toContain('table');
  });
});

describe('SalesPipeline drill-down (AC-SP-207)', () => {
  it('AC-SP-207: clicking a card opens a record tab with the human label', () => {
    renderPage();
    fireEvent.click(screen.getByText('Northwind ERP Rollout').closest('[role="button"]')!);
    expect(openRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sales:p2', label: 'Northwind ERP Rollout', module: 'sales' }),
    );
  });

  it('AC-SP-205: a table row click opens the record tab', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    fireEvent.click(screen.getByText('Northwind ERP Rollout').closest('tr')!);
    expect(openRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'sales:p2' }));
  });
});
