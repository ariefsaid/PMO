import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import Procurement from './Procurement';

// filter_applied / search_used / procurement_detail_opened (board 'card' path) —
// 2026-07-13 wiring plan. Mirrors Procurement.test.tsx's mock harness.
const analytics = vi.hoisted(() => ({
  trackFilterApplied: vi.fn(),
  trackSearchUsed: vi.fn(),
  trackProcurementDetailOpened: vi.fn(),
}));
vi.mock('@/src/lib/analytics', () => ({
  trackFilterApplied: analytics.trackFilterApplied,
  trackSearchUsed: analytics.trackSearchUsed,
  trackProcurementDetailOpened: analytics.trackProcurementDetailOpened,
}));

const seed = [
  {
    id: 'pc1',
    code: 'PROC-2026-004',
    title: 'Workstations & AV',
    status: 'Vendor Quoted',
    total_value: 150000,
    project_id: 'pr1',
    requested_by_id: 'u-alice',
    vendor_id: null,
    created_at: '2026-02-05T00:00:00Z',
    project: { name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001' },
    vendor: null,
    requested_by: { full_name: 'Alice Manager' },
  },
];

const procState = { data: seed as unknown[], isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState }));
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
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const renderPage = () =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <Procurement />
      </MemoryRouter>
    </ToastProvider>,
  );

beforeEach(() => {
  procState.data = seed;
  sessionStorage.clear();
  navigate.mockClear();
  analytics.trackFilterApplied.mockClear();
  analytics.trackSearchUsed.mockClear();
  analytics.trackProcurementDetailOpened.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Procurement: filter_applied fires on the status SegFilter', () => {
  it('AC: switching to Paid fires filter_applied with the option-set size', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /^Paid$/ }));
    expect(analytics.trackFilterApplied).toHaveBeenCalledWith('status', expect.any(Number), 'procurement');
  });
});

describe('Procurement: search_used fires (debounced) at the requests search box', () => {
  it('AC: typing and going idle fires search_used', () => {
    renderPage();
    const input = screen.getByLabelText('Filter requests');
    fireEvent.change(input, { target: { value: 'Workstations' } });
    vi.advanceTimersByTime(500);
    expect(analytics.trackSearchUsed).toHaveBeenCalledWith('procurement-list', 1, 'procurement');
  });
});
