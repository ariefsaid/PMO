import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import Procurement from './Procurement';

// filter_applied / search_used / procurement_detail_opened (board 'card' path) —
// 2026-07-13 wiring plan. Mirrors Procurement.test.tsx's mock harness.
const analytics = vi.hoisted(() => ({
  trackFilterApplied: vi.fn(),
  trackSearchUsed: vi.fn(),
  trackProcurementDetailOpened: vi.fn(),
  trackEmptyStateSeen: vi.fn(),
}));
// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useErpOrphans: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useHasErpPurchases: () => ({ data: false }),
}));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }), useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/pages/project-detail/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/lib/analytics', () => ({
  trackFilterApplied: analytics.trackFilterApplied,
  trackSearchUsed: analytics.trackSearchUsed,
  trackProcurementDetailOpened: analytics.trackProcurementDetailOpened,
  trackEmptyStateSeen: analytics.trackEmptyStateSeen,
}));

const seed = [
  {
    id: 'pc1',
    code: 'PROC-2026-004',
    title: 'Workstations & AV',
    status: 'Vendor Quoted',
    total_value: 150000, currency: 'USD',
    project_id: 'pr1',
    requested_by_id: 'u-alice',
    vendor_id: null,
    created_at: '2026-02-05T00:00:00Z',
    project: { name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001', project_manager_id: 'u-alice' },
    vendor: null,
    requested_by: { full_name: 'Alice Manager' },
  },
];

const procState = { data: seed as unknown[], isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));
const createMutate = vi.fn().mockResolvedValue({ id: 'pc-new' });
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: createMutate, isPending: false }),
}));
const navigate = vi.fn();
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/procurement?tab=all&view=grouped']}>
          <Procurement />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  procState.data = seed;
  sessionStorage.clear();
  navigate.mockClear();
  analytics.trackFilterApplied.mockClear();
  analytics.trackSearchUsed.mockClear();
  analytics.trackProcurementDetailOpened.mockClear();
  analytics.trackEmptyStateSeen.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Procurement: filter_applied fires on the grouped-view status filter', () => {
  it('AC: switching to Paid fires filter_applied with the option-set size', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Paid' } });
    expect(analytics.trackFilterApplied).toHaveBeenCalledWith('status', expect.any(Number), 'procurement');
  });
});

describe('Procurement: search_used fires (debounced) at the grouped-view search box', () => {
  it('AC: typing and going idle fires search_used', () => {
    renderPage();
    const input = screen.getByLabelText('Search procurements');
    fireEvent.change(input, { target: { value: 'Workstations' } });
    vi.advanceTimersByTime(500);
    expect(analytics.trackSearchUsed).toHaveBeenCalledWith('procurement-list', 1, 'procurement');
  });
});

describe('Procurement: empty_state_seen fires when there are zero requests (FIX 1)', () => {
  it('AC: renders the empty ListState and fires empty_state_seen with state_id/role/module', () => {
    procState.data = [];
    renderPage();
    expect(screen.getByText('No procurements yet')).toBeInTheDocument();
    expect(analytics.trackEmptyStateSeen).toHaveBeenCalledWith(
      'procurement-empty',
      'Project Manager',
      'procurement',
    );
  });
});
