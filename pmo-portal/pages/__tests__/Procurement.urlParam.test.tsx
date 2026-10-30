/**
 * AC-IXD-DASH-W5-C2A — Procurement page URL param read-on-mount
 *
 * Tests:
 * 1. ?status=Vendor+Invoiced on mount sets the Vendor Invoiced filter (shows only VI PRs)
 * 2. Backward-compatible: no param => default behavior (All) unchanged
 * 3. Existing segment values still work
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useErpPurchases', () => import('@/pages/__tests__/helpers/erpPurchasesMock'));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }), useProject: () => ({ data: null }) }));
const { procState } = vi.hoisted(() => ({
  procState: {
    data: [
      { id: 'pr1', status: 'Vendor Invoiced', total_value: 100_000, currency: 'USD', title: 'Invoice Request', code: 'VI-001', requested_by_id: 'u1', requested_by: { full_name: 'Alice' }, project: { name: 'Alpha' }, created_at: '2026-06-01T00:00:00Z' },
      { id: 'pr2', status: 'Paid', total_value: 50_000, currency: 'USD', title: 'Paid Request', code: 'PD-001', requested_by_id: 'u1', requested_by: { full_name: 'Alice' }, project: { name: 'Beta' }, created_at: '2026-06-02T00:00:00Z' },
      { id: 'pr3', status: 'Draft', total_value: 20_000, currency: 'USD', title: 'Draft Request', code: 'DR-001', requested_by_id: 'u1', requested_by: { full_name: 'Alice' }, project: { name: 'Gamma' }, created_at: '2026-06-03T00:00:00Z' },
    ],
    isPending: false,
    isError: false,
    refetch: () => undefined,
  },
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => procState,
  useProjectProcurements: () => procState,
}));

vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Finance' }),
}));

import ProcurementPage from '../Procurement';

const renderWithUrl = (url: string, role: Role = 'Finance') =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ImpersonationProvider realRole={role}>
        <MemoryRouter initialEntries={[url]}>
          <ToastProvider>
            <ProcurementPage />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('Procurement page — URL param read-on-mount (AC-IXD-DASH-W5-C2A)', () => {
  it('AC-IXD-DASH-W5-C2A-PROC-1: backward-compatible — no param shows All (all 3 rows visible)', () => {
    renderWithUrl('/procurement');
    expect(screen.getByText('Invoice Request')).toBeInTheDocument();
    expect(screen.getByText('Paid Request')).toBeInTheDocument();
    expect(screen.getByText('Draft Request')).toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2A-PROC-2: ?status=Vendor+Invoiced shows only Vendor Invoiced rows', () => {
    renderWithUrl('/procurement?status=Vendor+Invoiced');
    expect(screen.getByText('Invoice Request')).toBeInTheDocument();
    expect(screen.queryByText('Paid Request')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft Request')).not.toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2A-PROC-3: ?status=Paid maps to Paid segment (Paid row visible, others not)', () => {
    renderWithUrl('/procurement?status=Paid');
    expect(screen.getByText('Paid Request')).toBeInTheDocument();
    expect(screen.queryByText('Invoice Request')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft Request')).not.toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2A-PROC-4: in table view the URL status filter is shown and can be cleared', async () => {
    renderWithUrl('/procurement?view=table&status=Paid');
    expect(screen.queryByText('Invoice Request')).not.toBeInTheDocument();
    const status = screen.getByRole('combobox', { name: 'Status' });
    expect(status).toHaveValue('Paid');
    const allOption = within(status).getAllByRole('option')[0];
    await userEvent.selectOptions(status, allOption);
    expect(await screen.findByText('Invoice Request')).toBeInTheDocument();
    expect(screen.getByText('Draft Request')).toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2A-PROC-5: a zero-match table offers Clear filters, which clears the URL filters and the search', async () => {
    renderWithUrl('/procurement?view=table&status=Paid');
    await userEvent.type(screen.getByPlaceholderText('Search procurement…'), 'Invoice');
    expect(await screen.findByText('No procurement matches these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Invoice Request')).toBeInTheDocument();
    expect(screen.getByText('Paid Request')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).not.toHaveValue('Paid');
  });
});
