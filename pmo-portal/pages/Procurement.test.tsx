import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';
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
    project: { name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001', project_manager_id: 'u-alice' },
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
    project: { name: 'Skyline Bridge', code: 'PRJ-002', project_manager_id: 'u-alice' },
    vendor: null,
    requested_by: { full_name: 'Bob Engineer' },
  },
];

const procState = { data: seed as unknown[], isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useErpOrphans: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useHasErpPurchases: () => ({ data: false }),
}));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }), useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/pages/project-detail/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
// Project/vendor picker options are cached hooks; stub them so the index test
// needs no QueryClient.
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
const RouteProbe = () => <output data-testid="route-path">{useLocation().pathname + useLocation().search}</output>;

// list-working-set-return (#682): the list-return seam captures context only from the list's own
// canonical index path (`/procurement`), so the default entry must be `/procurement`, not `/`.
const renderPage = (initialPath = '/procurement') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <RouteProbe />
          <Procurement />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );

const renderPageInLocale = (locale: 'en' | 'id', initialPath = '/procurement') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <BahasaProvider locale={locale}>
        <ToastProvider>
          <MemoryRouter initialEntries={[initialPath]}>
            <Procurement />
          </MemoryRouter>
        </ToastProvider>
      </BahasaProvider>
    </QueryClientProvider>,
  );

describe('Procurement index — IA-3 (real data)', () => {
  beforeEach(() => {
    procState.data = seed;
    procState.isPending = false;
    procState.isError = false;
    sessionStorage.clear();
  });

  it('renders seeded requests with joined project name (AC-501)', () => {
    renderPage('/procurement?tab=all&view=grouped');
    expect(screen.getByText('Workstations & AV')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
  });

  it('renders the shared ListPage header and the procurement view switch (CW-5)', () => {
    renderPage();
    expect(screen.getByTestId('list-page-header')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Procurement view' })).toBeInTheDocument();
    // a single H1 lives in the shell header (the title text varies by own-scope)
    expect(within(screen.getByTestId('list-page-header')).getByRole('heading')).toBeInTheDocument();
  });

  it('AC-S19-002: daily rows show the procurement stage and its next step', async () => {
    renderPage('/procurement?tab=all');
    expect(screen.getByText('Workstations & AV')).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Workstations & AV/ });
    // Four user-facing stages (Request · Order · Receive · Pay): an approved request is still at Request.
    expect(within(row).getByText('Request')).toBeInTheDocument();
    expect(within(row).getByText('Choose a quote')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Expand procurement details' })).toBeInTheDocument();
    // The stage + next step carry the state; the row does not repeat a lifecycle pip strip.
    expect(within(row).queryByRole('list', { name: /Lifecycle:/i })).not.toBeInTheDocument();
  });

  it('AC-S19-002: status, search, create, and More transfer tools are accessible', async () => {
    renderPage();
    const header = within(screen.getByTestId('list-page-header'));
    const create = header.getByRole('button', { name: /new procurement/i });
    const filter = screen.getByRole('tab', { name: /^All/ });
    const search = screen.getByLabelText(/search procurement/i);
    const more = header.getByRole('button', { name: 'More' });

    const follows = (first: HTMLElement, second: HTMLElement) =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    // Create, then the list filter, then search, in reading/tab order. More (Export/Import) now sits in
    // the page header beside Create (#1404), so it is no longer after search.
    expect(follows(create, filter)).toBe(true);
    expect(follows(filter, search)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Export list' })).not.toBeInTheDocument();

    await userEvent.click(more);
    expect(screen.getByRole('button', { name: 'Export list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import procurements' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import cycle data' })).toBeInTheDocument();
  });

  // #1155 (P05): the More tools open as a floating overlay above the list. A keyboard user who
  // opens it must be able to dismiss it (Escape) and land back on the trigger, and a pointer user
  // must be able to dismiss it by clicking elsewhere — otherwise it keeps covering the rows.
  it('#1155: Escape closes More and returns focus to its trigger', async () => {
    const user = userEvent.setup();
    renderPage();
    const more = screen.getByRole('button', { name: 'More' });
    await user.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Export list' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Export list' })).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });

  it('#1155: an outside click closes More without disturbing the status filter or rows', async () => {
    const user = userEvent.setup();
    renderPage('/procurement?tab=all&view=grouped&status=Paid');
    const more = screen.getByRole('button', { name: 'More' });
    await user.click(more);
    expect(screen.getByRole('button', { name: 'Import procurements' })).toBeInTheDocument();

    // a neutral outside target (a row click would navigate away, which is a different goal)
    await user.click(within(screen.getByTestId('list-page-header')).getByRole('heading'));

    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Import procurements' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toHaveValue('Paid');
    expect(screen.getByText('Crane hire — 6 weeks')).toBeInTheDocument();
  });

  it('#1155: reopening More still offers Export, Import and Import cycle data', async () => {
    const user = userEvent.setup();
    renderPage();
    const more = screen.getByRole('button', { name: 'More' });
    await user.click(more);
    await user.keyboard('{Escape}');
    await user.click(more);
    expect(screen.getByRole('button', { name: 'Export list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import procurements' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import cycle data' })).toBeInTheDocument();
  });

  it('AC-S19-002: the canonical full status label and next-step copy are localized in Bahasa', () => {
    renderPageInLocale('id', '/procurement?tab=all&view=grouped');
    expect(screen.getByText('Penawaran pemasok')).toBeInTheDocument();
    expect(screen.getByText(/Langkah berikutnya:\s*Pilih penawaran/)).toBeInTheDocument();
  });

  it('search filters real rows by title/code (AC-504)', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/Search procurement/i), 'zzz');
    expect(screen.queryByText('Workstations & AV')).not.toBeInTheDocument();
    expect(screen.getByText(/No procurement matches these filters/i)).toBeInTheDocument();
  });

  // list-working-set-return (#683): the zero-match table state offers a Clear filters action
  // that restores the rows — distinct from the genuine collection-empty state. Supporting case;
  // AC-LRC-012's owning proof is pages/__tests__/listWorkingSet.emptyStates.test.tsx.
  it('a zero-match search offers Clear filters, which restores the rows', async () => {
    renderPage('/procurement?view=grouped');
    await userEvent.type(screen.getByLabelText(/Search procurements/i), 'zzz');
    expect(await screen.findByText(/No procurements match/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(screen.getByRole('link', { name: 'Workstations & AV' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Crane hire — 6 weeks' })).toBeInTheDocument();
  });

  it('status filter narrows the list (Paid only)', async () => {
    renderPage('/procurement?tab=all&view=grouped');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Paid');
    expect(screen.queryByText('Workstations & AV')).not.toBeInTheDocument();
    expect(screen.getByText('Crane hire — 6 weeks')).toBeInTheDocument();
  });

  it('switching to the Board view groups requests into stage columns', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Board/i }));
    // Vendor quoted procurements have cleared approval and sit in the Approved column.
    expect(within(screen.getByTestId('prstage-approved')).getByText('Workstations & AV')).toBeInTheDocument();
  });

  it('AC-NAV-006: opening a row drawer exposes the full procurement detail route', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Open Workstations & AV' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('link', { name: 'Open full page' })).toHaveAttribute('href', '/procurement/pc1');
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

  it('empty state when zero rows teaches + offers a real New procurement action (AC-PROC-006)', () => {
    procState.data = [];
    renderPage();
    expect(screen.getByText(/No procurements yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new procurement/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('the empty list says accounting-system-only purchases are not listed here, so empty is not read as "none at all"', () => {
    procState.data = [];
    renderPage();
    expect(screen.getByText(/Purchases recorded only in the accounting system are not listed here\./)).toBeInTheDocument();
  });
});

describe('Procurement index — New procurement gating (AC-PROC-006)', () => {
  beforeEach(() => {
    procState.data = seed;
    procState.isPending = false;
    procState.isError = false;
    effRole.value = 'Project Manager';
  });

  it('AC-PROC-006: a write-role sees the New procurement CTA', () => {
    renderPage();
    expect(within(screen.getByTestId('list-page-header')).getByRole('button', { name: /new procurement/i })).toBeInTheDocument();
  });

  it('AC-PROC-006: an Engineer ALSO sees New procurement (any member may raise)', () => {
    effRole.value = 'Engineer';
    renderPage();
    expect(within(screen.getByTestId('list-page-header')).getByRole('button', { name: /new procurement/i })).toBeInTheDocument();
  });

  it('AC-PROC-006: clicking New procurement navigates to the full-page create route', async () => {
    renderPage();
    await userEvent.click(within(screen.getByTestId('list-page-header')).getByRole('button', { name: /new procurement/i }));
    expect(screen.getByTestId('route-path')).toHaveTextContent('/procurement/new');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('AC-PROC1-007: legacy create deep links preserve project context and redirect to the new page', async () => {
    renderPage('/procurement?create=1&project=p1');
    await waitFor(() => expect(screen.getByTestId('route-path')).toHaveTextContent('/procurement/new?project=p1'));
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
    renderPage('/procurement?status=Paid&q=Crane&view=grouped');
    // The URL-driven status choice is selected.
    expect(screen.getByLabelText('Status')).toHaveValue('Paid');
    // The URL-driven search is present in the search box.
    expect(screen.getByLabelText(/Search procurements/i)).toHaveValue('Crane');
    // Only the matching row renders.
    expect(screen.getByText('Crane hire — 6 weeks')).toBeInTheDocument();
    expect(screen.queryByText('Workstations & AV')).not.toBeInTheDocument();
  });

  it('AC-LRC-001: a control change writes ONE replace of the list URL (no history entry per click)', async () => {
    renderPage('/procurement?view=grouped');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Paid');
    expect(screen.getByText('Crane hire — 6 weeks')).toBeInTheDocument();
    // View change persists AND writes the URL in one event (board renders, the status set moments
    // earlier survives untouched — it is not a keystroke this event should drop).
    await userEvent.click(screen.getByRole('tab', { name: /Board/i }));
    expect(screen.queryByTestId('prstage-approved')).toBeInTheDocument();
    expect(within(screen.getByTestId('prstage-paid')).getByText('Crane hire — 6 weeks')).toBeInTheDocument();
  });
});
