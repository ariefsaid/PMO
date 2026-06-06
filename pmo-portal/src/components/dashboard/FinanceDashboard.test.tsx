import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { formatCurrency } from '@/src/lib/format';
import { FinanceDashboard } from './FinanceDashboard';

const dash = {
  active_projects: 2, total_contract_value: 8_000_000,
  on_hand_margin: 0.25, on_hand_value: 6_000_000,
  pipeline_weighted_value: 800_000, pipeline_projected_margin: 0.2, pipeline_total_value: 2_000_000,
  projects_at_risk: 1,
  projects_by_status: [], procurements_by_status: [{ status: 'Paid', count: 2 }, { status: 'Vendor Invoiced', count: 1 }],
  top_projects: [
    { id: 'p1', name: 'Alpha', client_name: 'Acme', contract_value: 5_000_000, budget: 4_000_000, spent: 3_000_000, status: 'Ongoing Project' },
    { id: 'p2', name: 'Beta', client_name: 'Beta Co', contract_value: 3_000_000, budget: 2_000_000, spent: 1_000_000, status: 'Ongoing Project' },
  ],
};

const procurements = [
  { id: 'pr1', status: 'Vendor Invoiced', total_value: 250_000 },
  { id: 'pr2', status: 'Vendor Invoiced', total_value: 150_000 },
  { id: 'pr3', status: 'Paid', total_value: 999_999 },
];

vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: dash, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: procurements, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'fin-1', org_id: 'org-1' }, role: 'Finance' }),
}));

const renderPane = () => render(<MemoryRouter><FinanceDashboard /></MemoryRouter>);

describe('FinanceDashboard KPI grid — monotonic arbitrary breakpoints (C1)', () => {
  it('KPI band uses only arbitrary min-[] variants — no named sm: mixed in', () => {
    const { container } = renderPane();
    const band = container.querySelector('[aria-label="Finance KPIs"]') as HTMLElement;
    expect(band.className).toContain('min-[560px]:grid-cols-2');
    expect(band.className).toContain('min-[1180px]:grid-cols-4');
    expect(band.className).not.toContain('sm:grid-cols');
  });
});

describe('FinanceDashboard (real — exec RPC + procurements)', () => {
  it('shows total contracted revenue from the RPC', () => {
    renderPane();
    expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('$8,000,000');
  });
  it('shows total project spend (Σ top_projects.spent)', () => {
    renderPane();
    expect(screen.getByTestId('kpi-spend')).toHaveTextContent(formatCurrency(4_000_000));
  });
  it('shows on-hand margin', () => {
    renderPane();
    expect(screen.getByTestId('kpi-margin')).toHaveTextContent('25.0%');
  });
  it('computes outstanding invoices as Σ value of Vendor Invoiced procurements (real, not 0.4 fabrication)', () => {
    renderPane();
    // 250k + 150k = 400k; the Paid one is excluded
    expect(screen.getByTestId('kpi-outstanding')).toHaveTextContent(formatCurrency(400_000));
  });
  it('renders the top-projects-by-spend table', () => {
    renderPane();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});
