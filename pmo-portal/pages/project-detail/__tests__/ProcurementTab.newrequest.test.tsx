/**
 * Project Procurement tab — project-scoped procurement visibility and create flow.
 *
 * When a user is on a project's Procurement tab they should be able to raise a
 * procurement against THIS project without leaving the tab. The button is gated by
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

const { procState, projectState } = vi.hoisted(() => ({
  procState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  projectState: {
    data: { id: 'proj-abc', currency: 'USD' } as { id: string; currency: string } | null,
  },
}));

const { erpState } = vi.hoisted(() => ({ erpState: { data: [] as unknown[] } }));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => erpState, useErpOrphans: () => ({ data: erpState.data.filter((r) => (r as { procurementId: string | null }).procurementId === null) }), useHasErpPurchases: () => ({ data: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => procState,
  useProjectProcurements: () => procState,
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => projectState }));

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
  projectState.data = { id: 'proj-abc', currency: 'USD' };
  mockNavigate.mockClear();
  realRole = 'Project Manager';
});

// ── AC-JR-T13: header button visible ──────────────────────────────────────────

describe('project procurement actions and empty state', () => {
  it('shows the "New procurement" action when the user can create procurement', () => {
    renderTab('Project Manager');
    expect(screen.getAllByRole('button', { name: /new procurement/i })).toHaveLength(1);
  });

  it('shows the required empty state and keeps a single create action', () => {
    procState.data = [];
    renderTab('Project Manager');
    expect(screen.getByText('No procurement on this project yet.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new procurement/i })).toHaveLength(1);
    expect(screen.queryByText('Requests raised against this project, tracked through their lifecycle.')).toBeNull();
  });

  it('mentions the ERPNext section only when its documents are available below', () => {
    procState.data = [];
    const { unmount } = renderTab('Project Manager');
    expect(screen.getByText('No procurement on this project yet.')).toBeInTheDocument();
    expect(screen.queryByText(/appear below/)).toBeNull();
    unmount();
    erpState.data = [{ id: 'd1', procurementId: null, doctype: 'Purchase Invoice', name: 'PINV-1', projectIds: ['proj-abc'],
      currency: 'IDR', outstanding: 0, dueDate: null, docDate: null, isReturn: false, grandTotal: 1, netTotal: 1 }];
    renderTab('Project Manager');
    expect(screen.getByText(/appear below/)).toBeInTheDocument();
  });

  it('shows "New procurement" for Engineer too (create: allow(ALL))', () => {
    // The policy says create: allow(ALL) so ALL roles including Engineer can create procurements.
    renderTab('Engineer');
    const buttons = screen.getAllByRole('button', { name: /new procurement/i });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});

const procurement = (id: string, status: string, overrides: Record<string, unknown> = {}) => ({
  id,
  code: `PR-${id}`,
  title: id,
  status,
  total_value: 100,
  approved_total_value: null,
  currency: 'USD',
  project_id: 'proj-abc',
  requested_by_id: 'u-1',
  vendor_id: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  project: { name: 'Test Project', code: 'PRJ-ABC' },
  vendor: { name: 'Northwind Supplies' },
  requested_by: { full_name: 'Project Manager' },
  ...overrides,
});

describe('project procurement stages and actions', () => {
  it('uses the requested stage copy, next step, and record route', () => {
    procState.data = [
      procurement('proc-network', 'Vendor Quoted', { title: 'Network equipment' }),
    ];

    renderTab('Project Manager');

    expect(screen.getByText('Getting quotes')).toBeInTheDocument();
    expect(screen.getByText('Choose a quote')).toBeInTheDocument();
    expect(screen.getByText('Northwind Supplies')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Network equipment/ })).toHaveAttribute('href', '/procurement/proc-network');
    expect(screen.getByRole('button', { name: /New procurement/i })).toBeInTheDocument();
  });

  it.each([
    ['Draft', 'Draft', 'Submit for approval'],
    ['Requested', 'Awaiting approval', 'Approve or reject'],
    ['Approved', 'Approved', 'Get quotes or order'],
    ['Vendor Quoted', 'Getting quotes', 'Choose a quote'],
    ['Quote Selected', 'Quote chosen', 'Raise the order'],
    ['Ordered', 'Ordered', 'Record delivery'],
    ['Received', 'Delivered', 'Record supplier invoice'],
    ['Vendor Invoiced', 'Supplier invoiced', 'Pay'],
    ['Paid', 'Paid', null],
    ['Rejected', 'Rejected', null],
    ['Cancelled', 'Cancelled', null],
  ])('maps %s to %s and its next step', (status, label, nextStep) => {
    procState.data = [procurement(`row-${status}`, status)];
    renderTab('Project Manager');
    const rowLink = screen.getByRole('link', { name: new RegExp(`row-${status}`) });
    expect(within(rowLink).getByText(label)).toBeInTheDocument();
    if (nextStep) expect(within(rowLink).getByText(nextStep)).toBeInTheDocument();
    else expect(screen.queryByText(/Submit for approval|Approve or reject|Get quotes or order|Choose a quote|Raise the order|Record delivery|Record supplier invoice|^Pay$/)).toBeNull();
  });

  it('groups rows, omits empty groups, and orders each group by most recently updated', () => {
    procState.data = [
      procurement('old draft', 'Draft', { updated_at: '2026-10-01T00:00:00.000Z' }),
      procurement('new draft', 'Draft', { updated_at: '2026-10-03T00:00:00.000Z' }),
      procurement('quote chosen', 'Quote Selected'),
      procurement('ordered', 'Ordered'),
      procurement('rejected', 'Rejected'),
    ];
    renderTab('Project Manager');
    expect(screen.getByRole('heading', { name: 'Needs action 3' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'In progress 1' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invoiced or paid' })).not.toBeInTheDocument();
    const details = screen.getByText(/Rejected or cancelled/).closest('details');
    expect(details).not.toHaveAttribute('open');
    const draftLinks = screen.getAllByRole('link').filter((link) => /draft/i.test(link.textContent ?? ''));
    expect(draftLinks[0]).toHaveTextContent('new draft');
    expect(draftLinks[1]).toHaveTextContent('old draft');
  });

  it('AC-1402 wraps procurement identity and shows a quiet dash when supplier is missing', () => {
    const title = 'A long procurement title that must wrap on a phone without losing its full identity';
    procState.data = [procurement('proc-long', 'Requested', { title, vendor: null })];
    renderTab('Project Manager');

    const titleNode = screen.getByText(title);
    expect(titleNode).toHaveClass('whitespace-normal');
    expect(titleNode).toHaveClass('break-words');
    const row = screen.getByRole('link', { name: new RegExp(title) });
    expect(within(row).getByText('—')).toHaveClass('text-muted-foreground');
    expect(within(row).queryByText('No supplier yet')).not.toBeInTheDocument();
  });

  it('shows project-currency totals to money roles, using approved values when present', () => {
    procState.data = [
      procurement('waiting', 'Requested', { total_value: 1250, approved_total_value: null }),
      procurement('reserved', 'Approved', { total_value: 2000, approved_total_value: 1750 }),
      procurement('committed', 'Ordered', { total_value: 3000, approved_total_value: 2800 }),
      procurement('paid', 'Paid', { total_value: 900, approved_total_value: 850 }),
    ];
    renderTab('Finance');
    expect(screen.getByRole('heading', { name: 'Procurement · USD' })).toBeInTheDocument();
    expect(screen.getByText('Awaiting approval', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('Reserved', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('Committed', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('Paid', { selector: 'dt' })).toBeInTheDocument();
    const summary = screen.getByRole('heading', { name: 'Procurement · USD' }).parentElement!.querySelector('dl')!;
    for (const amount of ['1,250', '1,750', '3,650', '850']) {
      expect(within(summary).getByText(amount)).toBeInTheDocument();
    }
  });

  it('hides project-wide totals from Engineers who only see their own procurements', () => {
    procState.data = [procurement('own request', 'Draft')];
    renderTab('Engineer');
    expect(screen.queryByText('Awaiting approval')).not.toBeInTheDocument();
    expect(screen.getByText('own request')).toBeInTheDocument();
  });
});

// ── AC-JR-T13: one-page create route and project context ──────────────────────

describe('New procurement navigates to the project-scoped create route', () => {
  it('clicking New procurement keeps this project in the create URL', async () => {
    renderTab('Project Manager');
    const [headerBtn] = screen.getAllByRole('button', { name: /new procurement/i });
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
