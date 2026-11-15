import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * T5 (dropped-restored §2): the weighted-pipeline figure prints compact tile money ("$1.4M") and,
 * after the redesign, carried no exact value — the precise number was not reachable anywhere on
 * that tile. The home "Contract on hand" tile keeps both (AC-701: short on the tile, the exact
 * amount on hover and for screen readers), so the sales figures use the SAME mechanism
 * (FigureContent): the short value is aria-hidden with a `title`, and the exact value is sr-only.
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
      ] as Array<Record<string, unknown>>,
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  lostState: { data: [] as unknown[] },
  wonState: { data: [] as unknown[] },
}));

const viewport = vi.hoisted(() => ({ isDesktop: true }));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => viewport.isDesktop }));
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

beforeEach(() => {
  viewport.isDesktop = true;
  pipelineState.isPending = false;
  pipelineState.isError = false;
  lostState.data = [];
  wonState.data = [];
});

describe('T5: the weighted pipeline figure keeps its exact amount', () => {
  it('prints the short tile money and exposes the exact amount on hover and to screen readers', () => {
    renderPage();
    // 20,000 + 125,000 + 600,000 + 675,000 = 1,420,000 weighted.
    const weighted = screen.getByTestId('pipeline-weighted-total');
    expect(weighted).toHaveTextContent('$1.42M');

    // Hover: the short figure carries the exact amount as its title.
    const short = weighted.querySelector('[title="$1,420,000"]');
    expect(short).not.toBeNull();
    expect(short).toHaveTextContent('$1.42M');
    expect(short).toHaveAttribute('aria-hidden', 'true');

    // Screen readers: the exact amount is the accessible copy of the same figure.
    const exact = within(weighted as HTMLElement).getByText('$1,420,000');
    expect(exact).toHaveClass('sr-only');
  });
});

describe('#2199: an unknown weighted value hides the forecast, never prints it as a smaller sum', () => {
  it('a stage whose weighted value is null hides the weighted figure and keeps the open value', () => {
    const original = pipelineState.data.stages;
    pipelineState.data.stages = original.map((s) => (s.status === 'Leads' ? { ...s, weighted_value: null as unknown as number } : s));
    try {
      renderPage();
      expect(screen.queryByTestId('pipeline-weighted-total')).toBeNull();
      expect(screen.getByTestId('pipeline-open-value-figure')).toHaveTextContent('$2.8M');
      expect(screen.getByText(/1 figure hidden/)).toBeInTheDocument();
    } finally {
      pipelineState.data.stages = original;
    }
  });
});

describe('#2199 item 1: a two-currency pipeline shows the org currency figure plus a line per other currency', () => {
  const withIdrLead = () => {
    const original = { ...pipelineState.data };
    pipelineState.data = {
      stages: original.stages.map((s) => (s.status === 'Leads'
        ? { ...s, count: 2, total_value: 200000 + 1_000_000_000, weighted_value: 20000 + 100_000_000 } : s)),
      projects: [...original.projects, { id: 'p5', name: 'Leads Project Rupiah', client_name: 'Epsilon', status: 'Leads', contract_value: 1_000_000_000, currency: 'IDR', win_probability: 0.1 }],
    };
    return () => { pipelineState.data = original; };
  };

  it('the headline keeps both figures: USD first, IDR on its own second line, exact on hover', () => {
    const restore = withIdrLead();
    try {
      renderPage();
      const weighted = screen.getByTestId('pipeline-weighted-total');
      const lines = [...weighted.querySelectorAll('[data-currency-line]')].map((line) => line.textContent?.replace(/\u00a0/g, ' '));
      expect(lines).toEqual(['$1.42M', '+ IDR 100M']);
      expect(weighted.querySelector('[title]')?.getAttribute('title')?.replace(/\u00a0/g, ' ')).toBe('$1,420,000; + IDR 100,000,000');
      const open = screen.getByTestId('pipeline-open-value-figure');
      expect([...open.querySelectorAll('[data-currency-line]')].map((line) => line.textContent?.replace(/\u00a0/g, ' '))).toEqual(['$2.8M', '+ IDR 1B']);
      expect(screen.queryByTestId('figures-hidden')).toBeNull();
      expect(document.body).not.toHaveTextContent(/Mixed currencies/);
    } finally {
      restore();
    }
  });

  it('phone: the figure tiles carry the same per-currency lines', () => {
    const restore = withIdrLead();
    viewport.isDesktop = false;
    try {
      renderPage();
      const figures = screen.getByRole('region', { name: 'Pipeline figures' });
      const lines = [...figures.querySelectorAll('[data-currency-line]')].map((line) => line.textContent?.replace(/\u00a0/g, ' '));
      expect(lines).toEqual(['$1.42M', '+ IDR 100M', '$2.8M', '+ IDR 1B']);
      expect(figures).not.toHaveTextContent(/Mixed currencies/);
    } finally {
      restore();
    }
  });

  it('when a stage does not reconcile with the deals, both figures stay hidden with their reason', () => {
    const restore = withIdrLead();
    pipelineState.data.stages = pipelineState.data.stages.map((s) => (s.status === 'Leads' ? { ...s, count: 3 } : s));
    try {
      renderPage();
      expect(screen.queryByTestId('pipeline-weighted-total')).toBeNull();
      expect(screen.getByTestId('figures-hidden')).toHaveTextContent('2 figures hidden: Mixed currencies');
    } finally {
      restore();
    }
  });
});
