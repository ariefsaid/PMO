import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import SalesPipeline from './SalesPipeline';
import { formatCurrency } from '@/src/lib/format';

// Oracle stages from spec §3.8 (after SPD-S1)
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

vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => pipelineState,
  useDashboard: () => ({ data: undefined, isPending: false, isError: false }),
  useWinRate: () => ({ data: undefined, isPending: false, isError: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));

const renderPage = () => render(<MemoryRouter><SalesPipeline /></MemoryRouter>);

describe('SalesPipeline (AC-1116 / FR-SPD-014/015)', () => {
  it('AC-1116: loading state', () => {
    pipelineState.isPending = true; pipelineState.isError = false; pipelineState.data = undefined;
    renderPage();
    expect(screen.getByTestId('pipeline-loading')).toBeInTheDocument();
    pipelineState.isPending = false;
  });

  it('AC-1116: error state with retry button', () => {
    pipelineState.isError = true; pipelineState.isPending = false; pipelineState.data = undefined;
    renderPage();
    expect(screen.getByTestId('pipeline-error')).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(pipelineState.refetch).toHaveBeenCalled();
    pipelineState.isError = false;
  });

  it('AC-1116: empty state when no pipeline projects', () => {
    pipelineState.data = { stages: [], projects: [] };
    pipelineState.isPending = false; pipelineState.isError = false;
    renderPage();
    expect(screen.getByTestId('pipeline-empty')).toBeInTheDocument();
    pipelineState.data = { stages: seedStages, projects: seedProjects };
  });

  it('AC-1116: populated — five stage columns, per-stage data, total weighted value (FR-SPD-014)', () => {
    pipelineState.data = { stages: seedStages, projects: seedProjects };
    pipelineState.isPending = false; pipelineState.isError = false;
    renderPage();

    // total weighted value = 200000 + 600000 = 800000
    expect(screen.getByTestId('pipeline-weighted-total')).toHaveTextContent(formatCurrency(800000));

    // All five stage columns present
    expect(screen.getByTestId('stage-Leads')).toBeInTheDocument();
    expect(screen.getByTestId('stage-PQ Submitted')).toBeInTheDocument();
    expect(screen.getByTestId('stage-Quotation Submitted')).toBeInTheDocument();
    expect(screen.getByTestId('stage-Tender Submitted')).toBeInTheDocument();
    expect(screen.getByTestId('stage-Negotiation')).toBeInTheDocument();

    // Tender Submitted: count 1, value $1,200,000, weighted $600,000
    const tenderCol = screen.getByTestId('stage-Tender Submitted');
    expect(tenderCol).toHaveTextContent('1');
    expect(tenderCol).toHaveTextContent(formatCurrency(1200000));
    expect(tenderCol).toHaveTextContent(formatCurrency(600000));

    // PQ Submitted: count 1, value $800,000, weighted $200,000
    const pqCol = screen.getByTestId('stage-PQ Submitted');
    expect(pqCol).toHaveTextContent('1');
    expect(pqCol).toHaveTextContent(formatCurrency(800000));
    expect(pqCol).toHaveTextContent(formatCurrency(200000));

    // no mockData / hard-coded probability refs
    expect(screen.queryByText('mockData')).toBeNull();
  });
});
