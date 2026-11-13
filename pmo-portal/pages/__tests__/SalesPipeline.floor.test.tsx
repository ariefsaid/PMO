/**
 * Floor tests for the sales pipeline (floor-wave2).
 *
 * Twelve controls the inventory found undriven: the hidden-figures line, the Needs attention card
 * (row, Show all, the Won/Lost footer), the scope tabs, the phone stage selector, the phone
 * figures disclosure, the mobile stage strip, the sector/bidding-entity filters, the drawer's
 * Escape close, and the Won-only Retry. Each asserts the OUTCOME — the drawer that opens, the rows
 * that remain, the read that is re-issued — never a look. The harness mirrors
 * `pages/SalesPipeline.test.tsx` (same hook mocks, same QueryClient wrapper, same real router).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const viewport = vi.hoisted(() => ({ isDesktop: true }));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => viewport.isDesktop }));

const seedStages = [
  { status: 'Leads', count: 0, total_value: 0, win_probability: 0.1, weighted_value: 0 },
  { status: 'PQ Submitted', count: 1, total_value: 800000, win_probability: 0.25, weighted_value: 200000 },
  { status: 'Quotation Submitted', count: 0, total_value: 0, win_probability: 0.4, weighted_value: 0 },
  { status: 'Tender Submitted', count: 1, total_value: 1200000, win_probability: 0.5, weighted_value: 600000 },
  { status: 'Negotiation', count: 0, total_value: 0, win_probability: 0.75, weighted_value: 0 },
];
const seedProjects = [
  { id: 'p2', name: 'Northwind ERP Rollout', short_name: null, client_name: 'Northwind', pmo_project_number: 'PMO-26-7712', code: 'CLIENT-82', status: 'Tender Submitted', contract_value: 1200000, currency: 'USD', go_probability: 0.5, get_probability: 0.25, win_probability: 0.125 },
  { id: 'p10', name: 'Regional Services', short_name: null, client_name: null, status: 'PQ Submitted', contract_value: 800000, currency: 'USD', win_probability: 0.25 },
  { id: 'idr1', name: 'IDR Deal', short_name: null, client_name: 'Garuda', status: 'Tender Submitted', contract_value: 1234, currency: 'IDR', win_probability: 0.5 },
];

const pipelineState: { data: unknown; isPending: boolean; isError: boolean; refetch: ReturnType<typeof vi.fn> } = {
  data: { stages: seedStages, projects: seedProjects }, isPending: false, isError: false, refetch: vi.fn(),
};
const lostState: { data: Array<Record<string, unknown>>; isPending: boolean; isError: boolean; refetch: ReturnType<typeof vi.fn> } = {
  data: [], isPending: false, isError: false, refetch: vi.fn(),
};
const wonState: { data: Array<Record<string, unknown>>; isPending: boolean; isError: boolean; refetch: ReturnType<typeof vi.fn> } = {
  data: [], isPending: false, isError: false, refetch: vi.fn(),
};

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => pipelineState,
  useLostDeals: () => lostState,
  useWonDeals: () => wonState,
  useDashboard: () => ({ data: undefined, isPending: false, isError: false }),
  useWinRate: () => ({ data: undefined, isPending: false, isError: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));

import SalesPipeline from '../SalesPipeline';

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={location.pathname}
      data-search={location.search}
      data-state={JSON.stringify(location.state ?? null)}
    />
  );
};

const renderPage = (initialPath = '/sales') =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

const probe = () => screen.getByTestId('location-probe');
const searchParam = (key: string) => new URLSearchParams(probe().getAttribute('data-search') ?? '').get(key);

/** A deal nobody has touched for months — the Needs attention population. */
const staleDeal = (i: number) => ({
  id: `stale-${i}`,
  name: `Stale Deal ${i}`,
  short_name: null,
  client_name: 'Acme',
  status: 'Tender Submitted',
  contract_value: 100000,
  currency: 'USD',
  win_probability: 0.5,
  last_update: '2026-01-05',
  stage_started_at: '2026-01-05',
});

beforeEach(() => {
  viewport.isDesktop = true;
  sessionStorage.clear();
  pipelineState.data = { stages: seedStages, projects: seedProjects };
  pipelineState.isPending = false;
  pipelineState.isError = false;
  pipelineState.refetch.mockClear();
  lostState.data = [];
  lostState.isPending = false;
  lostState.isError = false;
  lostState.refetch.mockClear();
  wonState.data = [];
  wonState.isPending = false;
  wonState.isError = false;
  wonState.refetch.mockClear();
});

describe('Sales pipeline floor — figures the page cannot total', () => {
  it('floor: mixed-currency deals hide the money figures and the page says why', () => {
    renderPage();
    expect(screen.queryByTestId('pipeline-weighted-total')).not.toBeInTheDocument();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent(/Mixed currencies/i);
  });
});

describe('Sales pipeline floor — Needs attention', () => {
  it('floor: a stale deal row opens that deal’s quick view', async () => {
    pipelineState.data = { stages: seedStages, projects: [staleDeal(1)] };
    renderPage();
    const attention = screen.getByRole('region', { name: 'Needs attention' });

    await userEvent.click(within(attention).getByRole('button', { name: /Stale Deal 1/ }));

    expect(await screen.findByRole('dialog', { name: /Stale Deal 1/ })).toBeInTheDocument();
  });

  it('floor: Show all opens the Needs attention scope with the whole stale population', async () => {
    pipelineState.data = { stages: seedStages, projects: Array.from({ length: 7 }, (_, i) => staleDeal(i + 1)) };
    renderPage('/sales?view=table');
    const attention = screen.getByRole('region', { name: 'Needs attention' });

    await userEvent.click(within(attention).getByRole('button', { name: 'Show all 7' }));

    await waitFor(() => expect(searchParam('scope')).toBe('Needs attention'));
    expect(screen.getByRole('tab', { name: /Needs attention/ })).toHaveAttribute('aria-selected', 'true');
    // The scope carries the WHOLE stale population, not just the five the card previews.
    expect(screen.getByTestId('pipeline-result-count')).toHaveTextContent('7 projects');
  });

  it('floor: the Won count in the attention footer opens the Won scope', async () => {
    wonState.data = [{ id: 'won1', name: 'Won Deal Alpha', short_name: null, client_name: 'Acme', status: 'Close Out', contract_value: 400000, currency: 'USD', win_probability: 1 }];
    renderPage('/sales?view=table');
    const attention = screen.getByRole('region', { name: 'Needs attention' });

    await userEvent.click(within(attention).getByRole('button', { name: /^Won 1 all time$/ }));

    await waitFor(() => expect(searchParam('scope')).toBe('Won'));
    expect(await screen.findByText('Won Deal Alpha')).toBeInTheDocument();
  });
});

describe('Sales pipeline floor — scope tabs', () => {
  it('floor: All shows every deal while Open shows only the open pipeline', async () => {
    wonState.data = [{ id: 'won1', name: 'Won Deal Alpha', short_name: null, client_name: 'Acme', status: 'Close Out', contract_value: 400000, currency: 'USD', win_probability: 1 }];
    renderPage('/sales?view=table');

    await userEvent.click(screen.getByRole('tab', { name: /^Open$/ }));
    await waitFor(() => expect(searchParam('scope')).toBe('Open'));
    expect(screen.queryByText('Won Deal Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /^All$/ }));
    await waitFor(() => expect(screen.getByText('Won Deal Alpha')).toBeInTheDocument());
  });

  it('floor: Needs attention shows the stale population and marks the scope', async () => {
    pipelineState.data = { stages: seedStages, projects: [seedProjects[1], ...Array.from({ length: 3 }, (_, i) => staleDeal(i + 1))] };
    renderPage('/sales?view=table');

    await userEvent.click(screen.getByRole('tab', { name: /Needs attention/ }));

    await waitFor(() => expect(searchParam('scope')).toBe('Needs attention'));
    expect(screen.getByTestId('pipeline-result-count')).toHaveTextContent('3 projects');
  });
});

describe('Sales pipeline floor — classification filters', () => {
  it('floor: the sector filter leaves only the deals in that sector and shows the chip', async () => {
    pipelineState.data = {
      stages: seedStages,
      projects: [
        { ...seedProjects[0], sector: 'Energy' },
        { ...seedProjects[1], sector: 'Mining' },
      ],
    };
    renderPage('/sales?view=table');
    await userEvent.click(screen.getByRole('button', { name: /^Classification$/ }));

    await userEvent.selectOptions(screen.getByLabelText('Filter by sector'), 'Energy');

    await waitFor(() => expect(screen.queryByText('Regional Services')).not.toBeInTheDocument());
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sector: Energy/ })).toBeInTheDocument();
  });

  it('floor: the bidding-entity filter leaves only the deals bid alone and shows the chip', async () => {
    pipelineState.data = {
      stages: seedStages,
      projects: [
        { ...seedProjects[0], bidding_entity: 'alone' },
        { ...seedProjects[1], bidding_entity: 'consortium' },
      ],
    };
    renderPage('/sales?view=table');
    await userEvent.click(screen.getByRole('button', { name: /^Classification$/ }));

    await userEvent.selectOptions(screen.getByLabelText('Filter by bidding entity'), 'alone');

    await waitFor(() => expect(screen.queryByText('Regional Services')).not.toBeInTheDocument());
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bidding entity: Alone/ })).toBeInTheDocument();
  });
});

describe('Sales pipeline floor — quick view', () => {
  it('floor: Escape closes the deal quick view', async () => {
    renderPage('/sales?view=table');
    fireEvent.click(screen.getByText('Northwind ERP Rollout').closest('tr')!);
    expect(await screen.findByRole('dialog', { name: /Northwind ERP Rollout/ })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Sales pipeline floor — phone', () => {
  it('floor: the phone stage selector leaves only that stage’s deals and writes the stage', async () => {
    viewport.isDesktop = false;
    renderPage();

    const selection = screen.getByRole('combobox', { name: 'Pipeline stage' });
    await userEvent.selectOptions(selection, 'PQ Submitted');

    await waitFor(() => expect(searchParam('status')).toBe('PQ Submitted'));
    const list = screen.getByTestId('sales-phone-stage-list');
    expect(within(list).getByText('Regional Services')).toBeInTheDocument();
    expect(within(list).queryByText('Northwind ERP Rollout')).toBeNull();
  });

  it('floor: Pipeline figures on a phone is a disclosure that opens to the figures and the attention counts', async () => {
    viewport.isDesktop = false;
    wonState.data = [{ id: 'won1', name: 'Won Deal Alpha', short_name: null, client_name: 'Acme', status: 'Close Out', contract_value: 400000, currency: 'USD', win_probability: 1 }];
    renderPage();
    const details = screen.getByTestId('sales-phone-summary-details');
    expect(details).not.toHaveAttribute('open');

    await userEvent.click(within(details).getByText('Pipeline figures'));

    expect(details).toHaveAttribute('open');
    expect(within(details).getByRole('region', { name: 'Needs attention' })).toBeInTheDocument();

    await userEvent.click(within(details).getByText('Pipeline figures'));
    expect(details).not.toHaveAttribute('open');
  });

  it('floor: tapping a stage in the phone stage strip brings that column into view', async () => {
    const scrollToSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: scrollToSpy });
    renderPage('/sales?view=kanban');

    const strip = screen.getByRole('navigation', { name: 'Pipeline stage navigation' });
    await userEvent.click(within(strip).getByRole('button', { name: 'Negotiation' }));

    await waitFor(() => expect(scrollToSpy).toHaveBeenCalled());
    expect(within(strip).getByRole('button', { name: 'Negotiation' })).toHaveAttribute('aria-current', 'true');
    expect(within(strip).getByRole('button', { name: 'Leads' })).not.toHaveAttribute('aria-current');
  });
});

describe('Sales pipeline floor — recoveries', () => {
  it('floor: the Won read’s Retry refetches Won alone', async () => {
    wonState.isError = true;
    renderPage('/sales?view=kanban');

    const wonError = await screen.findByText("Couldn't load won projects");
    const alert = wonError.closest('[role="alert"]')!;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(wonState.refetch).toHaveBeenCalled();
    expect(pipelineState.refetch).not.toHaveBeenCalled();
    expect(lostState.refetch).not.toHaveBeenCalled();
  });
});
