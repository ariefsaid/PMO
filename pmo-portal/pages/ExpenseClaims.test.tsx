import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { formatNumber } from '@/src/lib/format';
import { BahasaProvider } from '@/test/bahasa';
// The DOM matchers collapse NBSP to a space; Intl emits NBSP between code and digits.
const money = (v: number) => formatNumber(v);

const mockNavigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router')>();
  return { ...real, useNavigate: () => mockNavigate };
});
const h = vi.hoisted(() => ({
  listSpy: vi.fn(),
  list: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  aging: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  create: { mutateAsync: vi.fn(), isPending: false },
  projects: [{ id: 'p1', name: 'Harbour Upgrade', short_name: 'North Terminal' }],
  capture: { capture: vi.fn(), cleanupUnlinkedAttachment: vi.fn(), recovery: null as null | Record<string, unknown>, progress: null as number | null },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({
  useExpenseClaims: (filters: unknown) => { h.listSpy(filters); return h.list; },
  useExpenseAdvanceAging: () => h.aging,
  useExpenseClaimMutations: () => ({ create: h.create }),
}));
vi.mock('@/src/hooks/useExpenseCapture', async () => {
  const ReactModule = await import('react');
  return {
    useExpenseCapture: () => {
      const [recovery, setRecovery] = ReactModule.useState(h.capture.recovery);
      const capture = async (input: unknown) => {
        try { return await h.capture.capture(input); }
        catch (error) { setRecovery(h.capture.recovery); throw error; }
      };
      return { ...h.capture, recovery, capture };
    },
  };
});
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: h.projects }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));

import ExpenseClaims from './ExpenseClaims';

vi.mock('@/src/hooks/useExpensePostingReadiness', () => ({ useExpensePostingReadiness: () => ({ state: 'ready', retry: vi.fn() }) }));

const ROW = {
  id: 'c1', claim_number: 'EXP-2610060001', kind: 'claim', title: 'Site visit', claimant: { full_name: 'Budi Field' },
  project: { name: 'Harbour Upgrade' }, budget_category: 'Special expenses', amount: 750000, currency: 'IDR', status: 'Submitted', created_at: '2026-10-05T12:00:00.000Z',
};
const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location-probe" data-state={JSON.stringify(location.state ?? {})}>{`${location.pathname}${location.search}`}</output>;
};
const renderPage = (entry = '/expenses') => render(<MemoryRouter initialEntries={[entry]}><LocationProbe /><ToastProvider><ExpenseClaims /></ToastProvider></MemoryRouter>);
const renderPageInBahasa = (entry = '/expenses') => render(
  <BahasaProvider locale="id"><MemoryRouter initialEntries={[entry]}><ToastProvider><ExpenseClaims /></ToastProvider></MemoryRouter></BahasaProvider>,
);

beforeEach(() => {
  mockNavigate.mockClear();
  h.listSpy.mockClear();
  h.create.mutateAsync.mockReset();
  h.capture.capture.mockReset();
  h.capture.cleanupUnlinkedAttachment.mockReset();
  h.capture.recovery = null;
  h.projects = [{ id: 'p1', name: 'Harbour Upgrade', short_name: 'North Terminal' }];
  h.list.data = { rows: [ROW], truncated: false };
});
afterEach(() => vi.unstubAllGlobals());

describe('ExpenseClaims page', () => {
  it('AC-EXP-060 lists records with number, claimant, project, amount and status', () => {
    renderPage();
    const row = screen.getByRole('row', { name: /Site visit/ });
    expect(within(row).getByText(/EXP-2610060001/)).toBeInTheDocument();
    expect(within(row).getByText('Budi Field')).toBeInTheDocument();
    expect(within(row).getByText('Harbour Upgrade')).toBeInTheDocument();
    expect(within(row).getByText(money(750000))).toBeInTheDocument();
    expect(within(row).getByText('Submitted')).toBeInTheDocument();
  });

  it('AC-806 groups claim amounts by currency and shows exact whole-unit values once per group', () => {
    h.list.data = {
      rows: [
        ROW,
        { ...ROW, id: 'c2', claim_number: 'EXP-2610060002', title: 'Consultant travel', amount: 2226648000, currency: 'IDR' },
        { ...ROW, id: 'c3', claim_number: 'EXP-2610060003', title: 'Cloud services', amount: 3412800, currency: 'USD' },
      ],
      truncated: false,
    };
    renderPage();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('button', { name: /IDR.*2/ })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: /USD.*1/ })).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Consultant travel/ })).getByText('2,226,648,000')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Cloud services/ })).getByText('3,412,800')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Site visit/ })).getByText('750,000')).toBeInTheDocument();
  });

  it('AC-806 phone rows lead with full identity, status/date, exact amount and Open before collapsed facts', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    h.list.data = { rows: [{ ...ROW, title: 'Expense claim', project: { name: 'Pembangunan Gedung Layanan Terpadu Tahap IV Baru' }, amount: 2226648000 }], truncated: false };
    renderPage();
    const row = within(screen.getByTestId('dt-card-branch')).getAllByRole('listitem').find((item) =>
      within(item).queryByRole('link', { name: 'Expense claim' }),
    )!;
    expect(within(row).getByRole('link', { name: 'Expense claim' })).toBeInTheDocument();
    expect(within(row).getByText('Submitted')).toBeInTheDocument();
    expect(within(row).getByText('2,226,648,000')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Open Expense claim' })).toBeInTheDocument();
    expect(within(row).getByText('Details · 3 fields')).toBeInTheDocument();
    expect(within(row).getByText('Pembangunan Gedung Layanan Terpadu Tahap IV Baru')).toBeInTheDocument();
    expect(row.querySelector('details')).not.toHaveAttribute('open');
  });

  it('AC-806 shows the complete project identity in the collection and advance project chooser', async () => {
    const projectName = 'Pembangunan Gedung Layanan Terpadu Tahap IV Baru';
    h.projects = [{ id: 'p1', name: projectName, short_name: 'Gedung Layanan' }];
    h.list.data = { rows: [{ ...ROW, project: { name: projectName, short_name: 'Gedung Layanan' } }], truncated: false };
    renderPage();
    const row = screen.getByRole('row', { name: /Site visit/ });
    expect(within(row).getByText(projectName)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /request advance/i }));
    expect(within(screen.getByRole('dialog')).getByRole('option', { name: projectName })).toHaveValue('p1');
  });

  it('AC-806 replays search, filters and sort from the URL into the server query', () => {
    renderPage('/expenses?q=field%20visit&status=Submitted&kind=claim&category=Special%20expenses&project=p1&sort=oldest');
    expect(h.listSpy).toHaveBeenLastCalledWith({
      search: 'field visit', status: 'Submitted', kind: 'claim', budgetCategory: 'Special expenses', projectId: 'p1', sort: 'oldest',
    });
  });

  it('AC-806 orders the expenses toolbar from search through filters, sort, view and creation', () => {
    renderPage();
    const toolbar = within(screen.getByTestId('money-out-toolbar'));
    const controls = [
      toolbar.getByRole('searchbox', { name: 'Search expenses' }),
      toolbar.getByLabelText('Status'),
      toolbar.getByLabelText('Type'),
      toolbar.getByLabelText('Budget category'),
      toolbar.getByLabelText('Project'),
      toolbar.getByRole('button', { name: 'Newest claims' }),
      toolbar.getByRole('button', { name: 'Claims and advances' }),
      toolbar.getByRole('button', { name: 'Outstanding advances' }),
      toolbar.getByRole('button', { name: 'Request advance' }),
      toolbar.getByRole('button', { name: 'New claim' }),
    ];
    for (let index = 0; index < controls.length - 1; index += 1) {
      expect(Boolean(controls[index].compareDocumentPosition(controls[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    }
  });

  it('AC-806 localizes collection search, sort, views, and outstanding advances in Indonesian', () => {
    renderPageInBahasa();
    expect(screen.getByRole('searchbox', { name: 'Cari biaya' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Klaim terbaru' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tampilan daftar biaya' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Klaim dan uang muka' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uang muka belum diselesaikan' })).toBeInTheDocument();
  });

  it('AC-806 keeps the first claim action in the toolbar without duplicating it in the empty state', () => {
    h.list.data = { rows: [], truncated: false };
    renderPage();
    expect(screen.getAllByRole('button', { name: 'New claim' })).toHaveLength(1);
    expect(within(screen.getByTestId('money-out-toolbar')).getByRole('button', { name: 'New claim' })).toBeInTheDocument();
  });

  it('AC-806 category filters own their URL key while retaining the rest of the collection state', async () => {
    renderPage('/expenses?q=hotel&project=p1&sort=oldest');
    await userEvent.selectOptions(screen.getByLabelText('Budget category', { selector: 'input, select, textarea' }), 'Special expenses');
    expect(mockNavigate).toHaveBeenCalledWith('/expenses?q=hotel&project=p1&sort=oldest&category=Special+expenses', { replace: true, state: null });
  });

  it('AC-806 switches to one outstanding-advances view and labels its date sort', async () => {
    renderPage('/expenses?status=Submitted&project=p1');
    expect(screen.getByRole('button', { name: 'Newest claims' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Outstanding advances' }));
    expect(mockNavigate).toHaveBeenCalledWith('/expenses?status=Submitted&project=p1&view=outstanding', { replace: true, state: null });
  });

  it('AC-806 clears collection filters without dropping unrelated query state', async () => {
    h.list.data = { rows: [], truncated: false };
    renderPage('/expenses?q=missing&project=p1&status=Rejected&tab=mine');
    await userEvent.click(within(screen.getByTestId('money-out-toolbar')).getByRole('button', { name: 'Clear filters' }));
    expect(mockNavigate).toHaveBeenCalledWith('/expenses?tab=mine', { replace: true, state: null });
  });

  it('AC-EXP-060 New claim opens the full-page create route', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New claim' }));
    expect(mockNavigate).toHaveBeenCalledWith('/expenses/new', { state: { recordContext: { listPath: '/expenses' } } });
    expect(h.capture.capture).not.toHaveBeenCalled();
    expect(h.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-806 carries the selected project into new-claim capture', async () => {
    renderPage('/expenses?project=p1&sort=oldest');
    await userEvent.click(screen.getByRole('button', { name: 'New claim' }));
    expect(mockNavigate).toHaveBeenCalledWith('/expenses/new?project=p1', {
      state: { recordContext: { listPath: '/expenses?project=p1&sort=oldest' } },
    });
  });

  it('AC-806 opens a record with the exact expense working set as its return context', async () => {
    renderPage('/expenses?q=client&project=p1&status=Submitted&sort=oldest');
    await userEvent.click(screen.getByRole('row', { name: /Site visit/ }));
    expect(mockNavigate).toHaveBeenCalledWith(
      '/expenses/c1?q=client&project=p1&status=Submitted&sort=oldest',
      { state: { recordContext: { listPath: '/expenses?q=client&project=p1&status=Submitted&sort=oldest' } } },
    );
  });

  it('AC-806 opens a claim from its name link and keeps the return context', async () => {
    renderPage('/expenses?q=client&project=p1&status=Submitted&sort=oldest');
    const row = screen.getByRole('row', { name: /Site visit/ });
    await userEvent.click(within(row).getByText('Site visit'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/expenses/c1?q=client&project=p1&status=Submitted&sort=oldest');
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-state', JSON.stringify({ recordContext: { listPath: '/expenses?q=client&project=p1&status=Submitted&sort=oldest' } }));
  });


  it('AC-EXP-060 an advance cannot be created without an amount', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Request advance' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Trip float');
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(h.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-EXP-060 says when the list is truncated instead of trimming silently', () => {
    h.list.data = { rows: [ROW], truncated: true };
    renderPage();
    expect(screen.getByText(/Showing the latest 200/)).toBeInTheDocument();
  });

  it('AC-S12 readiness disclosure moves with the new full-page create route', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New claim' }));
    expect(mockNavigate).toHaveBeenCalledWith('/expenses/new', { state: { recordContext: { listPath: '/expenses' } } });
    expect(h.capture.capture).not.toHaveBeenCalled();
  });
});
