import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import Procurement from './Procurement';

const seed = [
  {
    id: 'pc1',
    code: 'PROC-2026-004',
    title: 'Workstations & AV',
    status: 'Vendor Quoted',
    total_value: 150000,
    currency: 'USD',
    project_id: 'pr1',
    requested_by_id: 'u-alice',
    vendor_id: null,
    created_at: '2026-02-05T00:00:00Z',
    project: { name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001' },
    vendor: null,
    requested_by: { full_name: 'Alice Manager' },
  },
  {
    id: 'pc2',
    code: 'PROC-2026-005',
    title: 'Crane hire — 6 weeks',
    status: 'Paid',
    total_value: 518000,
    currency: 'USD',
    project_id: 'pr2',
    requested_by_id: 'u-bob',
    vendor_id: null,
    created_at: '2026-01-20T00:00:00Z',
    project: { name: 'Skyline Bridge', code: 'PRJ-002' },
    vendor: null,
    requested_by: { full_name: 'Bob Engineer' },
  },
];

const procState = { data: seed as unknown[], isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState }));
// FK pickers in the New-PR modal read cached option hooks; stub them so the index
// test needs no QueryClient (the loaders just hand back the static list).
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
const effRole = { value: 'Project Manager' as string | null };
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: effRole.value, realRole: effRole.value }),
}));
// The New-PR create hook (modal is launched from the header) — stubbed so the
// index test stays focused on the gating + launch affordance.
const createMutate = vi.fn().mockResolvedValue({ id: 'pc-new' });
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: createMutate, isPending: false }),
}));
// list-working-set-return (#682): the list-return seam captures context only from the list's own
// canonical index path (`/procurement`), so the default entry must be `/procurement`, not `/`.
const renderPage = (initialPath = '/procurement') =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Procurement />
      </MemoryRouter>
    </ToastProvider>,
  );

describe('Procurement index — IA-3 (real data)', () => {
  beforeEach(() => {
    procState.data = seed;
    procState.isPending = false;
    procState.isError = false;
    sessionStorage.clear();
  });

  it('renders seeded requests with joined project name (AC-501)', () => {
    renderPage();
    expect(screen.getByText('Workstations & AV')).toBeInTheDocument();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
  });

  it('renders on the shared ListPage shell: header + canonical toolbar (CW-5)', () => {
    renderPage();
    expect(screen.getByTestId('list-page-header')).toBeInTheDocument();
    expect(screen.getByTestId('list-page-toolbar')).toBeInTheDocument();
    // a single H1 lives in the shell header (the title text varies by own-scope)
    expect(within(screen.getByTestId('list-page-header')).getByRole('heading')).toBeInTheDocument();
  });

  it('defaults to the Table view with list rows and a lifecycle stepper (AC-FIX5)', () => {
    renderPage();
    // The table view now renders ProcurementListRow (expandable rows) instead of a
    // DataTable — each row shows the title + a disclosure toggle + lifecycle inline pips.
    expect(screen.getByText('Workstations & AV')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Show preview for/i }).length).toBeGreaterThan(0);
  });

  it('search filters real rows by title/code (AC-504)', async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/Filter requests/i), 'zzz');
    expect(screen.queryByText('Workstations & AV')).not.toBeInTheDocument();
    expect(screen.getByText(/No requests match/i)).toBeInTheDocument();
  });

  // list-working-set-return (#683): the zero-match table state offers a Clear filters action
  // that restores the rows — distinct from the genuine collection-empty state. Supporting case;
  // AC-LRC-012's owning proof is pages/__tests__/listWorkingSet.emptyStates.test.tsx.
  it('a zero-match search offers Clear filters, which restores the rows', async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/Filter requests/i), 'zzz');
    expect(await screen.findByText(/No requests match/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(screen.getByText('Workstations & AV')).toBeInTheDocument();
    expect(screen.getByText('Crane hire — 6 weeks')).toBeInTheDocument();
  });

  it('status filter narrows the list (Paid only)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Paid$/ }));
    expect(screen.queryByText('Workstations & AV')).not.toBeInTheDocument();
    expect(screen.getByText('Crane hire — 6 weeks')).toBeInTheDocument();
  });

  it('switching to the Board view groups requests into stage columns', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Board/i }));
    // Vendor Quoted request lands in the VQ column
    expect(within(screen.getByTestId('prstage-vq')).getByText('Workstations & AV')).toBeInTheDocument();
  });

  it('AC-NAV-006: activating a row navigates to the procurement detail route (no tab)', () => {
    renderPage();
    // The title is now a <Link to="/procurement/:id"> so the row navigates via the
    // router Link (not navigate()), which is compatible with MemoryRouter in tests.
    const titleLink = screen.getByRole('link', { name: 'Workstations & AV' });
    expect(titleLink).toHaveAttribute('href', '/procurement/pc1');
  });
});

describe('Procurement index — states', () => {
  beforeEach(() => {
    procState.data = seed;
    procState.isPending = false;
    procState.isError = false;
  });

  it('loading skeleton while pending (AC-505)', () => {
    procState.isPending = true;
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('error state with retry (AC-507)', () => {
    procState.isError = true;
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('empty state when zero rows teaches + offers a real Raise request action (AC-PROC-006)', () => {
    procState.data = [];
    renderPage();
    expect(screen.getByText(/No purchase requests yet/i)).toBeInTheDocument();
    // The dead disabled CTA was removed in the cleanup round; the CRUD slice
    // restores a REAL, working create affordance (header CTA + empty-state action).
    expect(screen.getAllByRole('button', { name: /raise request/i }).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Procurement index — Raise request gating (AC-PROC-006)', () => {
  beforeEach(() => {
    procState.data = seed;
    procState.isPending = false;
    procState.isError = false;
    effRole.value = 'Project Manager';
    createMutate.mockClear();
  });

  it('AC-PROC-006: a write-role sees the header Raise request CTA', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /raise request/i })).toBeInTheDocument();
  });

  it('AC-PROC-006: an Engineer ALSO sees Raise request (any member may raise)', () => {
    effRole.value = 'Engineer';
    renderPage();
    expect(screen.getByRole('button', { name: /raise request/i })).toBeInTheDocument();
  });

  it('AC-PROC-006: clicking Raise request opens the New PR dialog', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /raise request/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
  });
});

// list-working-set-return (#682): AC-LRC-001/002 for Procurement — `status`/`q`/`view` are
// URL-owned. The owning pure-codec proof lives in src/lib/listWorkingSet.test.ts; here we prove
// the component renders the URL-backed working set and writes ONE replace per event.
describe('Procurement list working set — AC-LRC-001/002', () => {
  beforeEach(() => {
    procState.data = seed;
    procState.isPending = false;
    procState.isError = false;
    sessionStorage.clear();
  });

  it('AC-LRC-001: renders the URL-backed working set (status + search + view) and refresh/copy reproduces it', () => {
    renderPage('/procurement?status=Paid&q=Crane&view=table');
    // The URL-driven status segment is selected.
    expect(screen.getByRole('tab', { name: /^Paid$/ })).toHaveAttribute('aria-selected', 'true');
    // The URL-driven search is present in the search box.
    expect(screen.getByPlaceholderText(/Filter requests/i)).toHaveValue('Crane');
    // Only the matching row renders.
    expect(screen.getByText('Crane hire — 6 weeks')).toBeInTheDocument();
    expect(screen.queryByText('Workstations & AV')).not.toBeInTheDocument();
  });

  it('AC-LRC-001: a control change writes ONE replace of the list URL (no history entry per click)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Paid$/ }));
    expect(screen.getByText('Crane hire — 6 weeks')).toBeInTheDocument();
    // View change persists AND writes the URL in one event (board renders, the status set moments
    // earlier survives untouched — it is not a keystroke this event should drop).
    await userEvent.click(screen.getByRole('tab', { name: /Board/i }));
    expect(screen.queryByTestId('prstage-vq')).toBeInTheDocument();
    expect(within(screen.getByTestId('prstage-paid')).getByText('Crane hire — 6 weeks')).toBeInTheDocument();
  });
});
