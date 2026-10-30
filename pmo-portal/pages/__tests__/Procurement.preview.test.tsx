import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

/**
 * Fix #5 — Procurement list: rows must support inline expand/preview
 * (asymmetry with /approvals which already has ProcurementApprovalRow expansion).
 *
 * AC-FIX5-PREVIEW-01: each table row has a disclosure (expand) toggle button.
 * AC-FIX5-PREVIEW-02: clicking the toggle reveals the row's detail preview in place.
 * AC-FIX5-PREVIEW-03: the detail preview contains a "View full request" link to /procurement/:id.
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
vi.mock('@/pages/project-detail/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
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
    expect(within(row as HTMLElement).getByText('Request')).toBeInTheDocument();
    // Raised by the signed-in user, so the approval is waiting on someone else.
    expect(within(row as HTMLElement).getByText('Waiting on approver')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('Alice Engineer')).toBeInTheDocument();
  });
  it('UIP-007: rows with a missing requester and a long title still list and stay openable', () => {
    const longTitle = 'Cable supply for the extended site commissioning works';
    procState.data = [PROC_ROW, { ...PROC_ROW, id: 'pr-2', title: longTitle, total_value: 9800, project: null, requested_by: null }];
    renderPage();
    const longRow = screen.getByRole('button', { name: `Open ${longTitle}` }).closest('tr') as HTMLElement;
    expect(within(longRow).getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Steel Beams Supply' })).toBeInTheDocument();
  });
  it('AC-FIX5-PREVIEW-01: each table row has an expand toggle button', () => {
    renderPage();
    const toggles = screen.getAllByRole('button', { name: /show.*preview|expand|preview/i });
    expect(toggles.length).toBeGreaterThan(0);
  });

  const DETAIL = {
    ...PROC_ROW,
    project_id: 'proj-1',
    items: [{ id: 'i-1', name: 'Steel beam', description: 'IPE 300', quantity: 12 }],
    purchase_requests: [], quotations: [], purchase_orders: [], receipts: [], invoices: [], payments: [],
  };
  const expandFirstRow = async () => {
    detailState.data = DETAIL;
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /show.*preview|expand|preview/i })[0]);
    return user;
  };

  it('AC-FIX5-PREVIEW-02: clicking the toggle reveals the row detail panel in place', async () => {
    await expandFirstRow();
    // The row stays in the list; its line items and next step open beneath the title.
    const toggle = screen.getByRole('button', { name: /collapse procurement details/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Line items')).toBeInTheDocument();
    expect(screen.getByText(/Steel beam · IPE 300 · 12/)).toBeInTheDocument();
    expect(screen.getByText(/^Next step:/, { selector: 'span' })).toBeInTheDocument();
  });

  it('AC-FIX5-PREVIEW-03: from the preview the user reaches the full record at /procurement/:id', async () => {
    const user = await expandFirstRow();
    await user.click(screen.getByRole('button', { name: 'Open procurement' }));
    const link = await screen.findByRole('link', { name: /open full page/i });
    expect(link).toHaveAttribute('href', '/procurement/pr-1');
  });
});
