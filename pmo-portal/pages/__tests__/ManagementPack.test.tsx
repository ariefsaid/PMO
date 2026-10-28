import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { buildManagementPack } from '@/src/lib/reports/managementPack';
import type { ManagementPackFacts } from '@/src/lib/db/managementPack';
import { BahasaProvider } from '../../test/bahasa';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  userId: 'u-fin',
  query: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown, refetch: vi.fn() },
  exportTable: vi.fn(),
  revenueRows: [{ project_id: 'p1', currency: 'IDR', total_amount: 250, open_ar: 0, invoice_count: 2 }],
  orgCurrency: { currency: 'IDR', isResolved: true, isError: false },
  salesInvoices: [] as unknown[],
}));

vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => h.query,
  useRecordProjectProgress: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDelivery: () => ({ data: {} }) }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [
    { id: 'p1', name: 'Alpha', pm: { full_name: 'Test Manager' } },
    { id: 'p2', name: 'Beta', pm: { full_name: 'Other Manager' } },
  ] }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useRevenuePerProject: () => ({ data: h.revenueRows, isPending: false, isError: false }),
  useSalesInvoices: () => ({ data: h.salesInvoices, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrencyState: () => h.orgCurrency,
}));
vi.mock('@/src/components/export/useExport', () => ({
  useExport: () => ({ exportTable: h.exportTable, exportXlsx: vi.fn(), busy: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role, canImpersonate: false, viewAs: vi.fn() }),
}));

import ManagementPack from '../ManagementPack';

const project = (id: string, name: string, pm: string) => ({
  id, name, pmo_project_number: null, code: null, status: 'Ongoing Project', currency: 'IDR', contract_net: 1_000,
  start_date: null, end_date: null, project_manager_id: pm, client_name: null,
});
const earlierInvoice = (project_id: string | null, currency: string, net: number, invoice_count: number) =>
  ({ project_id, currency, net, invoice_count });
const facts: ManagementPackFacts = {
  from: '2026-03-01', to: '2026-04-01', timezone: 'Asia/Jakarta', org_currency: 'IDR', undated_invoice_count: 0,
  projects: [project('p1', 'Alpha', 'u-pm'), project('p2', 'Beta', 'u-other')],
  invoiced: [{ project_id: 'p1', currency: 'IDR', month: '2026-04-01', net: 250, invoice_count: 1 }],
  invoiced_before: [], progress: [],
};

const renderPage = (embedded = false) =>
  render(<MemoryRouter><ToastProvider><ManagementPack embedded={embedded} /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  h.role = 'Finance';
  h.userId = 'u-fin';
  h.query = { data: buildManagementPack(facts), isPending: false, isError: false, error: null, refetch: vi.fn() };
  h.exportTable.mockReset();
  h.orgCurrency = { currency: 'IDR', isResolved: true, isError: false };
  h.revenueRows = [{ project_id: 'p1', currency: 'IDR', total_amount: 250, open_ar: 0, invoice_count: 2 }];
  h.salesInvoices = [];
});

describe('AC-MMP-012 who sees the pack and who records progress', () => {
  it('AC-MMP-012: an Engineer gets the no-access message', () => {
    h.role = 'Engineer';
    renderPage();
    expect(screen.getByRole('heading', { name: "You don't have access to the management pack" })).toBeInTheDocument();
  });

  it('AC-MMP-012: an open project with no progress entry can record its first entry; closed projects cannot', async () => {
    const progressFacts = {
      ...facts,
      projects: [
        project('p1', 'Alpha', 'u-fin'),
        { ...project('p2', 'Beta', 'u-other'), status: 'Close Out' },
      ],
      progress: [
        { project_id: 'p2', month: '2026-03-01', pct_complete: 80, entered_at: '2026-03-01T10:00:00Z', entered_by_name: 'Finance' },
      ],
    };
    h.role = 'Executive';
    h.query.data = buildManagementPack(progressFacts);
    const { unmount } = renderPage();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    unmount();
    h.role = 'Finance';
    renderPage();
    const user = userEvent.setup();
    const alpha = screen.getByText('Alpha').closest('tr')!;
    await user.click(within(alpha).getByRole('button', { name: 'Actions for Alpha' }));
    expect(screen.getByRole('menuitem', { name: 'Record progress' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    const beta = screen.getByText('Beta').closest('tr')!;
    await user.click(within(beta).getByRole('button', { name: 'Actions for Beta' }));
    expect(screen.queryByRole('menuitem', { name: 'Record progress' })).not.toBeInTheDocument();
  });

  // R-004: Executive is Finance rank for progress (policy projectProgress.edit, server may_record_project_progress),
  // as before the restructure; this case had pinned the lost entry point.
  it('AC-1405-REPORT-002 / R-004: Executive reads the figures and records progress on an open project', async () => {
    h.role = 'Executive';
    renderPage();
    expect(screen.getByRole('region', { name: 'Report figures' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Invoices' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Actions for Alpha' }));
    expect(screen.getByRole('menuitem', { name: 'Record progress' })).toBeInTheDocument();
  });
});

// SP-1: Project Managers use the project's Contract tab for month-end progress; Reports is Finance-only.
describe('SP-1 — a Project Manager is denied the report page', () => {
  it('does not render report rows or progress actions for a Project Manager', () => {
    h.role = 'Project Manager';
    h.userId = 'u-pm';
    renderPage();
    expect(screen.getByRole('heading', { name: "You don't have access to the management pack" })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Report figures' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for Alpha/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New invoice' })).not.toBeInTheDocument();
  });
});

describe('AC-MMP-013 honest states', () => {
  it('AC-MMP-013: loading shows no figures', () => {
    h.query = { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() };
    renderPage();
    expect(screen.queryAllByTestId(/^pack-cell-/)).toHaveLength(0);
    expect(screen.queryByText('No projects to report')).toBeNull();
  });

  it('AC-MMP-013: a failed load shows the error and no figures', () => {
    h.query = { data: undefined, isPending: false, isError: true, error: new Error('boom'), refetch: vi.fn() };
    renderPage();
    expect(screen.getByText("Couldn't load the management pack")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^pack-cell-/)).toHaveLength(0);
    expect(screen.queryByText(/[^\d]0[.,]00\b/)).toBeNull();
  });

  it('AC-MMP-013: a refused window explains the allowed range', () => {
    h.query = { data: undefined, isPending: false, isError: true, error: Object.assign(new Error('w'), { code: '22023' }), refetch: vi.fn() };
    renderPage();
    expect(screen.getByText('Choose a start month on or before the as-at month, at most 24 months apart.')).toBeInTheDocument();
  });

  it('AC-MMP-013: no projects shows the empty message', () => {
    h.query = { data: buildManagementPack({ ...facts, projects: [], invoiced: [] }), isPending: false, isError: false, error: null, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText('No projects to report')).toBeInTheDocument();
  });

  it('UX-010: an empty report gives Finance its next step, a New invoice action', () => {
    h.query = { data: buildManagementPack({ ...facts, projects: [], invoiced: [] }), isPending: false, isError: false, error: null, refetch: vi.fn() };
    renderPage();
    expect(screen.getByRole('button', { name: 'New invoice' })).toBeInTheDocument();
  });
});

describe('RF-035, RF-036, RF-038 and RF-039 report honesty', () => {
  it('AC-1405-REPORT-003: shows the four shared revenue figures with their calculation help', () => {
    renderPage();
    for (const label of ['Earned, not yet invoiced', 'Earned to date', 'Invoiced to date', 'Backlog of contract total']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: /^How this figure is calculated: / }).length).toBeGreaterThanOrEqual(4);
  });

  it('AC-1405-REPORT-004: shows PM identity, invoice count and a missing latest-month progress flag', () => {
    h.query.data = buildManagementPack({
      ...facts,
      progress: [{ project_id: 'p1', month: '2026-03-01', pct_complete: 35, entered_at: '2026-03-20T10:00:00Z', entered_by_name: 'Finance' }],
    });
    renderPage();
    expect(screen.getByRole('img', { name: 'Test Manager' })).toHaveTextContent('TM');
    expect(screen.getByRole('columnheader', { name: 'Progress' })).toBeInTheDocument();
    expect(within(screen.getByText('Alpha').closest('tr')!).getByText('No entry for Apr')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Invoices' })).toBeInTheDocument();
    expect(within(screen.getByText('Alpha').closest('tr')!).getByText('2')).toBeInTheDocument();
  });

  it('embedded report uses a compact heading and reveals monthly totals only on request', async () => {
    renderPage(true);
    expect(screen.getByRole('heading', { level: 2, name: 'Revenue by project and month' })).toBeInTheDocument();
    expect(screen.queryByText(/Planned, recognised and invoiced revenue per project/)).not.toBeInTheDocument();
    const disclosure = screen.getByRole('button', { name: /Show monthly totals.*2 months/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table', { name: 'Monthly totals' })).not.toBeInTheDocument();
    await userEvent.setup().click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('table', { name: 'Monthly totals' })).toBeInTheDocument();
  });

  it('RF-035: the cumulative scope is stated by the as-at heading and the to-date figures; the monthly-scope lines are gone (FIN-S8)', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Projects as at Apr 26' })).toBeInTheDocument();
    expect(screen.getByText('Invoiced to date')).toBeInTheDocument();
    fireEvent.focus(screen.getByRole('button', { name: /^How this figure is calculated: Invoiced to date/ }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Cumulative .* through the as-at month/);
    expect(screen.queryByText(/Monthly figures · selected period/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Currencies with no activity, contract, or meaningful balance/)).not.toBeInTheDocument();
  });

  it('FIN-S8: the pack has no current-position section (the project Overview is the one project money summary) and its table stays intact', () => {
    renderPage();
    expect(screen.queryByRole('heading', { name: 'Current project position' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Projects as at Apr 26' })).toBeInTheDocument();
    expect(within(screen.getByText('Alpha').closest('tr')!).getByTestId('pack-cell-invoicedToDate')).toHaveTextContent(/250/);
  });

  it('FIN-S8: exactly one Export control replaces the CSV and XLSX pair', () => {
    renderPage();
    expect(screen.getAllByRole('button', { name: /^Export/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
  });

  it('T10: project amounts are full and exact — zero fraction suppressed, tabular, never monospace', () => {
    renderPage();
    const cell = within(screen.getByText('Alpha').closest('tr')!).getByTestId('pack-cell-invoicedToDate');
    expect(cell).toHaveTextContent(/250/);
    expect(cell.textContent).not.toMatch(/[.,]00(?!\d)/);
    expect(cell).toHaveClass('tabular');
    expect(cell.className).not.toContain('font-mono');
  });

  it('AC-1405-REPORT-006: projects with no progress use invoiced basis without a false missing-month warning', () => {
    renderPage();
    const row = within(screen.getByText('Alpha').closest('tr')!);

    // O11: with no progress on any project, the invoiced basis is said once, not repeated in a column.
    expect(screen.getByText('No progress is recorded yet, so earned revenue follows what has been invoiced.')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Progress' })).not.toBeInTheDocument();
    expect(row.queryByText(/No entry for/)).not.toBeInTheDocument();
    expect(row.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('AC-1405-REPORT-006: with progress on some projects, a project without it reads invoiced basis in its row', () => {
    h.query.data = buildManagementPack({
      ...facts,
      progress: [{ project_id: 'p1', month: '2026-04-01', pct_complete: 40, entered_at: '2026-04-20T10:00:00Z', entered_by_name: 'Finance' }],
    });
    renderPage();
    expect(within(screen.getByText('Beta').closest('tr')!).getByText('Invoiced basis')).toBeInTheDocument();
    expect(screen.queryByText(/No progress is recorded yet/)).not.toBeInTheDocument();
  });

  it('Reports figures are one joined strip with short amounts and the exact amount kept', () => {
    h.query.data = buildManagementPack({
      ...facts,
      projects: [{ ...project('p1', 'Alpha', 'u-pm'), contract_net: 90_000_000 }],
      invoiced: [{ project_id: 'p1', currency: 'IDR', month: '2026-04-01', net: 62_400_000, invoice_count: 1 }],
    });
    renderPage();
    const figures = screen.getByRole('region', { name: 'Report figures' });
    expect(within(figures).queryAllByRole('article')).toHaveLength(0);
    const short = within(figures).getAllByText('IDR 62.4M')[0];
    expect(short.getAttribute('title')).toMatch(/^IDR\s62,400,000$/);
  });

  it.each([
    [90, 'bg-primary'],
    [91, 'bg-warning'],
    [100, 'bg-warning'],
    [101, 'bg-destructive'],
  ])('AC-1405-REPORT-007: %s%% progress uses the expected threshold tone', (percent, tone) => {
    h.query.data = buildManagementPack({
      ...facts,
      progress: [{ project_id: 'p1', month: '2026-04-01', pct_complete: percent, entered_at: '2026-04-20T10:00:00Z', entered_by_name: 'Finance' }],
    });
    renderPage();
    const row = within(screen.getByText('Alpha').closest('tr')!);
    const progress = row.getByRole('progressbar');

    expect(progress).toHaveAttribute('aria-valuenow', String(percent));
    expect(within(progress).getByTestId('progress-fill')).toHaveClass(tone);
    expect(row.getByText(`${percent}% · Apr`)).toBeInTheDocument();
  });

  it('AC-1405-REPORT-008: the toolbar and table share one card, and money figures use whole units by currency', () => {
    h.query.data = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p2', currency: 'USD', month: '2026-04-01', net: 12_345, invoice_count: 1 }],
    });
    renderPage();

    const tableCard = screen.getByTestId('management-pack-table-card');
    expect(tableCard).toContainElement(screen.getByLabelText('From'));
    expect(tableCard).toContainElement(screen.getByLabelText('As at'));
    expect(tableCard).toContainElement(screen.getByRole('searchbox', { name: 'Search projects' }));
    expect(tableCard).toContainElement(screen.getByRole('button', { name: 'Export' }));
    expect(tableCard).toContainElement(screen.getByRole('table', { name: 'Project' }));

    const figures = screen.getByRole('region', { name: 'Report figures' });
    expect(figures).toHaveTextContent(/IDR\s250 · \$12,345/);
    expect(figures).not.toHaveTextContent(/[.,]00\b/);
    expect(screen.getByRole('columnheader', { name: 'Invoices' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
  });

  it('AC-1405-REPORT-009: an unknown lead-currency backlog is left out of the tile and explained once with its fix link', () => {
    h.query.data = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p1', currency: 'USD', month: '2026-04-01', net: 50, invoice_count: 1 }],
    });
    renderPage();
    const figures = screen.getByRole('region', { name: 'Report figures' });
    // C4: no "Unavailable" value anywhere; the backlog tile shows only what is known.
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    expect(figures).not.toHaveTextContent(/IDR\s*—/);
    expect(within(figures).getByRole('button', { name: /^How this figure is calculated: Backlog of contract total/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Backlog is left out where a foreign-currency invoice needs reconciliation/)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Review invoices' })).toHaveAttribute('href', '/finance/receivables');
  });

  it('T10: the project table closes with a per-currency total row inside its <tfoot>, never summing currencies', () => {
    h.query.data = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p1', currency: 'USD', month: '2026-04-01', net: 50, invoice_count: 1 }],
    });
    renderPage();
    const projectTable = screen.getByRole('table', { name: 'Project' });
    const footRows = within(projectTable).getAllByRole('row').filter((row) => row.closest('tfoot'));
    expect(footRows.length).toBeGreaterThanOrEqual(2);
    expect(footRows.map((row) => row.textContent).join(' ')).toMatch(/Total/);
    expect(footRows.some((row) => /IDR|Rp/.test(row.textContent ?? ''))).toBe(true);
    expect(footRows.some((row) => /\$|USD/.test(row.textContent ?? ''))).toBe(true);
  });

  it('RF-036: labels contract-currency backlog and subtotal unavailable pending reconciliation', () => {
    h.query.data = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p1', currency: 'USD', month: '2026-04-01', net: 50, invoice_count: 1 }],
    });
    renderPage();
    // Unknowable-Is-Not-Zero: the row and its subtotal show an explained dash, never a number or "Unavailable".
    const unknown = screen.getAllByTitle('A foreign-currency invoice needs reconciliation before this balance can be known.');
    expect(unknown.length).toBeGreaterThanOrEqual(2);
    unknown.forEach((element) => expect(element).toHaveTextContent(/^—/));
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
  });

  it('AC-MIP-006: earlier zero-net foreign invoices show unavailable contract backlog and subtotal', () => {
    h.query.data = buildManagementPack({
      ...facts,
      invoiced_before: [earlierInvoice('p1', 'USD', 0, 2)],
    });
    renderPage();
    const rows = screen.getAllByRole('row');
    const projectRow = rows.find((candidate) => within(candidate).queryByText('Alpha'));
    const reason = 'A foreign-currency invoice needs reconciliation before this balance can be known.';
    expect(screen.getAllByTitle(reason).length).toBeGreaterThanOrEqual(2);
    expect(projectRow && within(projectRow).getByTestId('pack-cell-backlog')).toHaveTextContent(/^—/);
    expect(projectRow && within(projectRow).getByTitle(reason)).toBeInTheDocument();
  });
});

describe('AC-V24P-017 real Bahasa balance-availability explanations', () => {
  const ID_REASON = 'Tagihan dalam mata uang asing perlu direkonsiliasi sebelum saldo ini dapat diketahui.';
  const renderBahasa = () =>
    render(<BahasaProvider><MemoryRouter><ToastProvider><ManagementPack /></ToastProvider></MemoryRouter></BahasaProvider>);

  // Alpha's name can label more than one row (contract + per-currency); take the row carrying the backlog cell.
  const alphaContractRow = () =>
    screen.getAllByRole('row').find((r) => within(r).queryByText('Alpha') && within(r).queryByTitle(ID_REASON))!;

  it('AC-V24P-017: unavailable backlog shows the Bahasa label and reason on the row and an aggregate cell, never English', () => {
    h.query.data = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p1', currency: 'USD', month: '2026-04-01', net: 50, invoice_count: 1 }],
    });
    renderBahasa();
    // Project row and per-currency subtotal retain their Bahasa reason on an explained dash.
    const projectRow = alphaContractRow();
    expect(within(projectRow).getByTestId('pack-cell-backlog')).toHaveTextContent(/^—/);
    const titled = screen.getAllByTitle(ID_REASON);
    expect(titled.length).toBeGreaterThanOrEqual(2);
    // Subtotal row: a cell outside the project row carries the same Bahasa explanation.
    expect(titled.some((el) => !projectRow.contains(el))).toBe(true);
    expect(screen.queryByText('Unavailable')).toBeNull();
    expect(screen.queryByTitle(/needs reconciliation/)).toBeNull();
  });

  it('AC-V24P-017: a known zero-or-positive backlog shows no unavailable copy in Bahasa', () => {
    renderBahasa();
    expect(screen.queryByTitle(ID_REASON)).toBeNull();
    const row = within(screen.getByText('Alpha').closest('tr')!);
    expect(row.getByTestId('pack-cell-backlog')).toHaveTextContent(/750/);
  });

  it('AC-V24P-017: earlier zero-net foreign invoices stay unavailable in Bahasa and keep the null backing figure', () => {
    h.query.data = buildManagementPack({ ...facts, invoiced_before: [earlierInvoice('p1', 'USD', 0, 2)] });
    renderBahasa();
    const projectRow = alphaContractRow();
    expect(within(projectRow).getByTestId('pack-cell-backlog')).toHaveTextContent(/^—/);
    expect(within(projectRow).getByTitle(ID_REASON)).toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).toBeNull();
  });
});

describe('Management pack design polish', () => {
  it('RE-1: the actions column has an accessible Actions header name', () => {
    renderPage();
    const header = screen.getByRole('columnheader', { name: 'Actions' });
    expect(header).toBeInTheDocument();
    expect(header.querySelector('.sr-only')).toHaveTextContent('Actions');
  });

  it('RE-2: transport errors can retry, but invalid-range errors cannot', async () => {
    const refetch = vi.fn();
    h.query = { data: undefined, isPending: false, isError: true, error: new Error('network unavailable'), refetch };
    const transportView = renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    transportView.unmount();

    h.query = { data: undefined, isPending: false, isError: true, error: Object.assign(new Error('invalid range'), { code: '22023' }), refetch };
    renderPage();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(refetch).toHaveBeenCalledOnce();
  });
});

describe('AC-MMP-011 export wiring', () => {
  it('AC-MMP-011: Export hands the long-format table and the as-at stem to the exporter', async () => {
    renderPage();
    const row = within(screen.getByText('Alpha').closest('tr')!);
    expect(row.getByTestId('pack-cell-invoicedToDate')).toHaveTextContent(/250/);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export' }));
    const [table, stem, format] = h.exportTable.mock.calls[0];
    expect(stem).toBe('Management-pack_2026-04');
    expect(format).toBe('csv');
    expect(table.header).toEqual(expect.arrayContaining(['Currency', 'Tax basis']));
  });
});

// Ported from the deleted RevenueByProject.{honesty,export}.test.tsx: the revenue-by-project goals,
// re-asserted on the report that replaced that page (/revenue-by-project redirects here).
describe('revenue by project goals carried over to the report', () => {
  function Location() {
    const location = useLocation();
    return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
  }
  const renderWithLocation = () =>
    render(<MemoryRouter><ToastProvider><ManagementPack /><Location /></ToastProvider></MemoryRouter>);

  it('AC-PFIN-009: Finance, Admin and Executive can open the unassigned invoices from the Unassigned row and the page note', async () => {
    h.query.data = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: null, currency: 'IDR', month: '2026-04-01', net: 1_200, invoice_count: 1 }],
    });
    for (const role of ['Finance', 'Admin', 'Executive']) {
      h.role = role;
      const user = userEvent.setup();
      const view = renderWithLocation();
      expect(screen.getByRole('link', { name: 'Assign projects' })).toHaveAttribute('href', '/finance/receivables?attribution=unassigned');
      await user.click(screen.getByRole('button', { name: 'Actions for Unassigned' }));
      await user.click(screen.getByRole('menuitem', { name: 'View invoices' }));
      expect(screen.getByRole('status', { name: 'Current location' })).toHaveTextContent('/finance/receivables?attribution=unassigned');
      view.unmount();
    }
  });

  it('AC-831-2: a project billed in two currencies shows a row per currency, each labelled with its own currency', () => {
    h.query.data = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p1', currency: 'USD', month: '2026-04-01', net: 50, invoice_count: 1 }],
    });
    renderPage();
    const alphaRows = screen.getAllByRole('row').filter((row) => within(row).queryByText('Alpha'));
    expect(alphaRows).toHaveLength(2);
    const foreign = alphaRows.find((row) => within(row).queryByText('Invoiced in USD, not the contract currency'));
    expect(foreign).toBeDefined();
    expect(within(foreign!).getByTestId('pack-cell-invoicedToDate')).toHaveTextContent('$50');
    const contract = alphaRows.find((row) => row !== foreign)!;
    expect(within(contract).getByTestId('pack-cell-invoicedToDate')).toHaveTextContent(/IDR\s?250/);
  });

  it('AC-802-001: while the organisation currency is unresolved, no figure is labelled with the placeholder dollar', () => {
    h.orgCurrency = { currency: 'USD', isResolved: false, isError: false };
    renderPage();
    expect(screen.getByRole('region', { name: 'Report figures' })).toHaveTextContent(/IDR\s?250/);
    expect(document.body).not.toHaveTextContent(/\$\s?\d/);
  });

  it('AC-RF-040: the report states its tax basis — revenue figures exclude tax', () => {
    renderPage();
    expect(screen.getByText('Planned, recognised and invoiced revenue per project and month. All figures exclude tax.')).toBeInTheDocument();
  });
});

// SP-2: receivables stay in Receivables; Reports contains revenue only.
describe('SP-2 — Reports omits unpaid client balances', () => {
  const withForeignInvoice = () => {
    h.query.data = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p1', currency: 'USD', month: '2026-04-01', net: 50, invoice_count: 1 }],
    });
    h.revenueRows = [
      // Partially paid: the IDR invoice is 275 incl. tax (250 net), 1,100 still owed across the project's IDR invoices.
      { project_id: 'p1', currency: 'IDR', total_amount: 250, open_ar: 1_100, invoice_count: 2 },
      { project_id: 'p1', currency: 'USD', total_amount: 50, open_ar: 55, invoice_count: 1 },
      { project_id: 'p2', currency: 'IDR', total_amount: 0, open_ar: 0, invoice_count: 0 },
    ];
  };
  it('does not show an unpaid-balance column or total even when the revenue source includes open balances', () => {
    withForeignInvoice();
    renderPage();
    expect(screen.queryByRole('columnheader', { name: /Unpaid by client/i })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/tax included|Unpaid by client/);
    expect(screen.getAllByTestId('pack-cell-invoicedToDate').some((cell) => /IDR\s?250/.test(cell.textContent ?? ''))).toBe(true);
  });

  it('omits unpaid client balances from the export', async () => {
    withForeignInvoice();
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export' }));
    const [table] = h.exportTable.mock.calls[0];
    expect(table.header).not.toContain('Unpaid by client · incl. tax');
    expect(table.header).not.toContain('Unpaid by client');
    expect(table.body.every((row: unknown[]) => row.length === table.header.length)).toBe(true);
  });
});
