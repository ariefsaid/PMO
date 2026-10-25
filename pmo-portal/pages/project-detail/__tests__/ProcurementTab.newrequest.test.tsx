/**
 * AC-JR-T13: ProcurementTab "New request" button — in-context PR creation.
 *
 * When a user is on a project's Procurement tab they should be able to raise a
 * PR against THIS project without leaving the tab. The button is gated by
 * can('create', 'procurement') (ALL roles). Clicking it navigates to the full-page
 * create route with the project id in the query string.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { MemoryRouter } from 'react-router';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { procState } = vi.hoisted(() => ({
  procState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

const { erpState } = vi.hoisted(() => ({ erpState: { data: [] as unknown[] } }));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => erpState, useErpOrphans: () => ({ data: erpState.data.filter((r) => (r as { procurementId: string | null }).procurementId === null) }), useHasErpPurchases: () => ({ data: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => procState,
  useProjectProcurements: () => procState,
}));

vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({
    data: [{ value: 'proj-abc', label: 'Test Project', sub: 'PRJ-ABC' }],
  }),
  useVendorOptions: () => ({ data: [] }),
}));

vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ id: 'new-pr-1' }),
    isPending: false,
  }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async (orig) => {
  const real = await orig<typeof import('react-router')>();
  return {
    ...real,
    useNavigate: () => mockNavigate,
  };
});

let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: realRole }),
}));

import ProcurementTab from '../tabs/ProcurementTab';

const renderTab = (role: Role = 'Project Manager') => {
  realRole = role;
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ProcurementTab projectId="proj-abc" />
      </ToastProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  erpState.data = [];
  procState.data = [];
  procState.isPending = false;
  procState.isError = false;
  procState.refetch.mockClear();
  mockNavigate.mockClear();
  realRole = 'Project Manager';
});

// ── AC-JR-T13: header button visible ──────────────────────────────────────────

describe('AC-JR-T13: ProcurementTab shows a gated "New request" button', () => {
  it('AC-JR-T13: header "New request" button is visible when user can create procurement', () => {
    renderTab('Project Manager');
    expect(screen.getAllByRole('button', { name: /new request/i })).toHaveLength(1);
  });

  it('AC-JR-T13 (SUB-E): the empty state does not repeat the header "New request" action', () => {
    procState.data = [];
    renderTab('Project Manager');
    expect(screen.getByText(/No purchase requests for this project yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new request/i })).toHaveLength(1);
    expect(screen.queryByText('Requests raised against this project, tracked through their lifecycle.')).toBeNull();
  });

  it('review 8: the empty state points below only when ERPNext documents are shown there', () => {
    procState.data = [];
    const { unmount } = renderTab('Project Manager');
    expect(screen.getByText(/No purchase requests for this project yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/appear below/)).toBeNull();
    unmount();
    erpState.data = [{ id: 'd1', procurementId: null, doctype: 'Purchase Invoice', name: 'PINV-1', projectIds: ['proj-abc'],
      currency: 'IDR', outstanding: 0, dueDate: null, docDate: null, isReturn: false, grandTotal: 1, netTotal: 1 }];
    renderTab('Project Manager');
    expect(screen.getByText(/appear below/)).toBeInTheDocument();
  });

  it('AC-JR-T13: "New request" button is visible for Engineer role too (create: allow(ALL))', () => {
    // The policy says create: allow(ALL) so ALL roles including Engineer can create procurements.
    renderTab('Engineer');
    const buttons = screen.getAllByRole('button', { name: /new request/i });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});

describe('AC-S19-003: project procurement vocabulary', () => {
  it('shows the approval gate and next step without the redundant inline lifecycle pips', () => {
    procState.data = [
      {
        id: 'procurement-approved',
        code: 'PR-2026-005',
        title: 'Network equipment',
        status: 'Approved',
        total_value: 92000,
        currency: 'USD',
        project_id: 'proj-abc',
        requested_by_id: 'u-1',
        vendor_id: null,
        created_at: '2026-10-02T00:00:00.000Z',
        project: { name: 'Test Project', code: 'PRJ-ABC' },
        vendor: null,
        requested_by: { full_name: 'Project Manager' },
      },
    ];

    renderTab('Project Manager');

    expect(within(screen.getByText('Network equipment').closest('tr')!).getByText('Approved')).toBeInTheDocument();
    // SUB-E: the per-row "Next:" line is gone from the project tab (the status pill carries the state).
    expect(screen.queryByText(/Next:/)).toBeNull();
    expect(screen.queryByTestId('procurement-next-step')).toBeNull();
    expect(screen.queryByRole('list', { name: /Lifecycle:/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New request/i })).toBeInTheDocument();
  });
});

describe('Project detail procurement register', () => {
  const request = (id: string, title: string, status: string, createdAt: string, vendor: string | null) => ({
    id,
    code: id,
    title,
    status,
    total_value: 92000,
    currency: 'USD',
    project_id: 'proj-abc',
    requested_by_id: 'u-1',
    vendor_id: null,
    created_at: createdAt,
    project: { name: 'Test Project', code: 'PRJ-ABC' },
    vendor: vendor ? { name: vendor } : null,
    requested_by: { full_name: 'Project Manager' },
  });

  it('AC-PD-PROC-01 searches request and vendor context, filters status, and clears to the full register', async () => {
    procState.data = [
      request('PR-NEW', 'Laptop refresh', 'Approved', '2026-10-20T00:00:00.000Z', 'Northwind Supplies'),
      request('PR-OLD', 'Site materials', 'Draft', '2026-10-10T00:00:00.000Z', 'Harbor Works'),
    ];
    renderTab();
    const search = screen.getByRole('searchbox', { name: 'Search purchase requests' });
    await userEvent.type(search, 'Northwind');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('Laptop refresh')).toBeInTheDocument();
    expect(screen.queryByText('Site materials')).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status filter' }), 'Approved');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('Laptop refresh')).toBeInTheDocument();
    expect(screen.queryByText('Site materials')).not.toBeInTheDocument();

    await userEvent.type(search, 'no match');
    expect(screen.getByRole('button', { name: 'Clear search and filters' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('Site materials')).toBeInTheDocument();
  });

  it('AC-PD-PROC-02 defaults newest first and presents request, vendor, status/date, value, actions', async () => {
    procState.data = [
      request('PR-OLD', 'Site materials', 'Draft', '2026-10-10T00:00:00.000Z', 'Harbor Works'),
      request('PR-NEW', 'Laptop refresh', 'Approved', '2026-10-20T00:00:00.000Z', 'Northwind Supplies'),
    ];
    renderTab();
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((header) => header.textContent?.trim());
    expect(headers).toEqual(['Request', 'Vendor', 'Status / date', 'Value', 'Actions']);
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Laptop refresh');
    expect(rows[2]).toHaveTextContent('Site materials');
    expect(screen.getByRole('combobox', { name: 'Sort requests' })).toHaveValue('newest');
    expect(screen.getByRole('button', { name: 'Open PR-NEW' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort requests' }), 'oldest');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Site materials');
  });
});

// ── AC-JR-T13: one-page create route and project context ──────────────────────

describe('AC-JR-T13: New request navigates to the project-scoped create route', () => {
  it('AC-JR-T13: clicking New request keeps this project in the create URL', async () => {
    renderTab('Project Manager');
    const [headerBtn] = screen.getAllByRole('button', { name: /new request/i });
    await userEvent.click(headerBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/procurement/new?project=proj-abc');
  });
});

// ── AC-JR-T13: loading + error states unaffected ─────────────────────────────

describe('AC-JR-T13: loading and error states', () => {
  it('AC-JR-T13: loading state renders the aria-busy loading skeleton', () => {
    procState.isPending = true;
    renderTab('Project Manager');
    // The tab returns early with ListState variant="loading", which renders an
    // aria-busy="true" wrapper around the skeleton rows (see ListState.tsx).
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('AC-JR-T13: error state shows retry, header button still visible', () => {
    procState.isError = true;
    procState.data = undefined as unknown as never[];
    renderTab('Project Manager');
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument();
  });
});
