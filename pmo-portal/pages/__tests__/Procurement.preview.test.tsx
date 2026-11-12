import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

/**
 * Fix #5 — Procurement list: each row opens a preview drawer over the list.
 *
 * AC-FIX5-PREVIEW-01: each table row opens its preview.
 * AC-FIX5-PREVIEW-02: the preview shows the row's details.
 * AC-FIX5-PREVIEW-03: the detail preview contains an "Open full page" link to /procurement/:id.
 */

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { procState, detailState } = vi.hoisted(() => ({
  procState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  detailState: {
    data: null as Record<string, unknown> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

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
vi.mock('@/src/hooks/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => procState,
  useProjectProcurements: () => procState,
}));

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
  useProcurementMutations: () => ({
    transition: { mutate: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1' }, role: 'Admin' }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }),
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
}));

// Mock DecisionSupportPanel (needs project data — irrelevant to this test)
vi.mock('@/pages/procurement/DecisionSupportPanel', () => ({
  DecisionSupportPanel: () => <div data-testid="decision-support-panel">Budget impact</div>,
}));

import ProcurementPage from '../Procurement';

const PROC_ROW = {
  id: 'pr-1',
  code: 'PR-0001',
  title: 'Steel Beams Supply',
  status: 'Requested',
  total_value: 50000, currency: 'USD',
  created_at: '2026-06-01T00:00:00Z',
  requested_by_id: 'u1',
  project: { name: 'Tower Build', code: 'TB-01' },
  requested_by: { full_name: 'Alice Engineer' },
  vendor: null,
  items: [],
};

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/procurement']}>
          <ProcurementPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  procState.data = [PROC_ROW];
  procState.isPending = false;
  procState.isError = false;
  detailState.data = null;
  detailState.isPending = false;
  detailState.isError = false;
});

describe('Procurement list — inline preview (fix #5)', () => {
  it('UIP-007: a Requested row shows its stage and what happens next', () => {
    renderPage();
    const row = screen.getByRole('button', { name: 'Open Steel Beams Supply' }).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Requested')).toBeInTheDocument();
    // Raised by the signed-in user, so the approval is waiting on someone else.
    expect(within(row as HTMLElement).getByText('Waiting on approver')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByRole('img', { name: 'Raised by Alice Engineer' })).toBeInTheDocument();
  });
  it('UIP-007: rows with a missing requester and a long title still list and stay openable', () => {
    const longTitle = 'Cable supply for the extended site commissioning works';
    procState.data = [PROC_ROW, { ...PROC_ROW, id: 'pr-2', title: longTitle, total_value: 9800, project: null, requested_by: null }];
    renderPage();
    const longRow = screen.getByRole('button', { name: `Open ${longTitle}` }).closest('tr') as HTMLElement;
    expect(within(longRow).getByRole('img', { name: 'Raised by Unassigned' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Steel Beams Supply' })).toBeInTheDocument();
  });
  it('AC-FIX5-PREVIEW-01: a row opens its preview drawer', async () => {
    detailState.data = DETAIL;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Open Steel Beams Supply' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  const DETAIL = {
    ...PROC_ROW,
    project_id: 'proj-1',
    items: [{ id: 'i-1', name: 'Steel beam', description: 'IPE 300', quantity: 12 }],
    purchase_requests: [], quotations: [], purchase_orders: [], receipts: [], invoices: [], payments: [],
  };
  const openPreview = async () => {
    detailState.data = DETAIL;
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Open Steel Beams Supply' }));
    return user;
  };

  it('AC-FIX5-PREVIEW-02: the preview shows line items and the next step', async () => {
    await openPreview();
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Line items')).toBeInTheDocument();
    expect(within(drawer).getByText('Steel beam · IPE 300')).toBeInTheDocument();
    expect(within(drawer).getByText('12')).toBeInTheDocument();
    expect(within(drawer).getByText('Next step')).toBeInTheDocument();
    expect(within(drawer).getByText('Request')).toBeInTheDocument();
    expect(within(drawer).getByText('Waiting on approver')).toBeInTheDocument();
  });

  it('AC-FIX5-PREVIEW-03: from the preview the user reaches the full record at /procurement/:id', async () => {
    await openPreview();
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: /open full page/i })).toHaveAttribute('href', '/procurement/pr-1');
  });
});
