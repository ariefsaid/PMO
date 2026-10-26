import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
}));

vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => h.query,
  useRecordProjectProgress: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDelivery: () => ({ data: {} }) }));
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

function CurrentQuery() {
  const location = useLocation();
  return <output data-testid="current-query">{location.search}</output>;
}

const renderPage = (url = '/financial-statements?section=project-revenue&view=earned') =>
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><ManagementPack embedded /><CurrentQuery /></ToastProvider></MemoryRouter>);

const alphaProjectRow = () => screen.getAllByRole('row').find((row) =>
  within(row).queryByText('Alpha') && within(row).queryByTestId('pack-cell-invoicedToDate'),
) as HTMLElement;

beforeEach(() => {
  h.role = 'Finance';
  h.userId = 'u-fin';
  h.query = { data: buildManagementPack(facts), isPending: false, isError: false, error: null, refetch: vi.fn() };
  h.exportTable.mockReset();
});

describe('AC-MMP-012 who sees the pack and who records progress', () => {
  it('AC-MMP-012: an Engineer gets the no-access message', () => {
    h.role = 'Engineer';
    render(<MemoryRouter><ToastProvider><ManagementPack /></ToastProvider></MemoryRouter>);
    expect(screen.getByRole('heading', { name: "You don't have access to the management pack" })).toBeInTheDocument();
  });

  it('AC-MMP-012: an open project with no progress entry can record its first entry; closed projects cannot', () => {
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
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    unmount();
    h.role = 'Finance';
    renderPage();
    expect(screen.getAllByRole('button', { name: 'Record progress' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Record progress' }).closest('tr')).toHaveTextContent('Alpha');
    const betaRow = screen.getAllByRole('row').find((row) => within(row).queryByText('Beta') && within(row).queryByTestId('pack-cell-invoicedToDate'))!;
    expect(within(betaRow).queryByRole('button', { name: 'Record progress' })).not.toBeInTheDocument();
  });

  it('AC-MMP-012: a PM may record progress only on the open project they manage', () => {
    h.role = 'Project Manager';
    h.userId = 'u-pm';
    h.query.data = buildManagementPack({
      ...facts,
      progress: [{ project_id: 'p1', month: '2026-03-01', pct_complete: 25, entered_at: '2026-03-01T10:00:00Z', entered_by_name: 'Finance' }],
    });
    renderPage();
    const buttons = screen.getAllByRole('button', { name: 'Record progress' });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest('tr')).toHaveTextContent('Alpha');
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
});

describe('earned project revenue query state', () => {
  it('keeps project and currency filters collapsed while the earned range and sort remain visible', async () => {
    const user = userEvent.setup();
    renderPage('/financial-statements?section=project-revenue&view=earned&from=2026-03&to=2026-04&project=p1&currency=IDR');
    const filters = screen.getByRole('button', { name: 'Filters · 2' });
    expect(filters).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('combobox', { name: 'Sort projects' })).toHaveValue('project-name-asc');
    expect(screen.getByLabelText('From')).toHaveValue('2026-03');
    expect(screen.getByLabelText('As at')).toHaveValue('2026-04');

    await user.click(filters);

    expect(filters).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('combobox', { name: 'Filter by project' })).toHaveValue('p1');
    expect(screen.getByRole('combobox', { name: 'Filter by currency' })).toHaveValue('IDR');
  });

  it('filters project rows and preserves the earned range while sorting', async () => {
    const user = userEvent.setup();
    renderPage('/financial-statements?section=project-revenue&view=earned&from=2026-03&to=2026-04');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by project' }), 'p1');
    const projectTable = screen.getByRole('table', { name: 'Project' });
    expect(within(projectTable).getByText('Alpha')).toBeInTheDocument();
    expect(within(projectTable).queryByText('Beta')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort projects' }), 'project-name-desc');
    expect(screen.getByTestId('current-query')).toHaveTextContent('project=p1');
    expect(screen.getByTestId('current-query')).toHaveTextContent('sort=project-name-desc');
    expect(screen.getByTestId('current-query')).toHaveTextContent('from=2026-03');
    expect(screen.getByTestId('current-query')).toHaveTextContent('to=2026-04');
  });

  it('restores Monthly history from the URL without changing the as-at evidence', () => {
    renderPage('/financial-statements?section=project-revenue&view=earned&from=2026-03&to=2026-04&history=1');
    const history = screen.getByText(/^Monthly history · \d+(?: rows)?$/).closest('details');
    expect(history).toHaveProperty('open', true);
    expect(screen.getByText('Projects as at Apr 26')).toBeInTheDocument();
  });
});

describe('RF-035, RF-036, RF-038 and RF-039 report honesty', () => {
  it('RF-035: leaves the cumulative scope to the shared report header and omits monthly-scope lines (FIN-S8)', () => {
    renderPage();
    expect(screen.queryByText(/Cumulative project revenue/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Monthly figures · selected period/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Currencies with no activity, contract, or meaningful balance/)).not.toBeInTheDocument();
  });

  it('FIN-S8: the pack has no current-position section (the project Overview is the one project money summary) and its table stays intact', () => {
    renderPage();
    expect(screen.queryByRole('heading', { name: 'Current project position' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Projects as at Apr 26' })).toBeInTheDocument();
    expect(within(alphaProjectRow()).getByTestId('pack-cell-invoicedToDate')).toHaveTextContent(/250/);
  });

  it('FIN-S8: exactly one Export control replaces the CSV and XLSX pair', () => {
    renderPage();
    expect(screen.getAllByRole('button', { name: /^Export/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Export monthly data' })).toBeEnabled();
  });

  it('T10: project amounts preserve full currency precision and zero fraction semantics', () => {
    renderPage();
    const cell = within(alphaProjectRow()).getByTestId('pack-cell-invoicedToDate');
    expect(cell).toHaveTextContent(/250/);
    expect(cell.textContent).not.toMatch(/[.,]00(?!\d)/);
  });

  it('T10: the project table reports one independent total for each currency', () => {
    h.query.data = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p1', currency: 'USD', month: '2026-04-01', net: 50, invoice_count: 1 }],
    });
    renderPage();
    const projectTable = screen.getByRole('table', { name: 'Project' });
    const totalRows = within(projectTable).getAllByRole('row').filter((row) => /Total/.test(row.textContent ?? ''));
    expect(totalRows.filter((row) => /IDR|Rp/.test(row.textContent ?? ''))).toHaveLength(1);
    expect(totalRows.filter((row) => /USD|\$/.test(row.textContent ?? ''))).toHaveLength(1);
  });

  it('RF-036: labels contract-currency backlog and subtotal unavailable pending reconciliation', () => {
    h.query.data = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p1', currency: 'USD', month: '2026-04-01', net: 50, invoice_count: 1 }],
    });
    renderPage();
    const unavailable = screen.getAllByText('Unavailable');
    expect(unavailable.length).toBeGreaterThanOrEqual(2);
    expect(unavailable[0]).toHaveAttribute('title',
      'A foreign-currency invoice needs reconciliation before this balance can be known.');
  });

  it('AC-MIP-006: earlier zero-net foreign invoices show unavailable contract backlog and subtotal', () => {
    h.query.data = buildManagementPack({
      ...facts,
      invoiced_before: [earlierInvoice('p1', 'USD', 0, 2)],
    });
    renderPage();
    const rows = screen.getAllByRole('row');
    const projectRow = rows.find((candidate) => within(candidate).queryByText('Alpha'));
    const unavailable = screen.getAllByText('Unavailable');
    expect(unavailable.length).toBeGreaterThanOrEqual(2);
    expect(projectRow && within(projectRow).getByText('Unavailable')).toHaveAttribute('title',
      'A foreign-currency invoice needs reconciliation before this balance can be known.');
  });
});

describe('AC-V24P-017 real Bahasa balance-availability explanations', () => {
  const ID_UNAVAILABLE = 'Belum tersedia';
  const ID_REASON = 'Tagihan dalam mata uang asing perlu direkonsiliasi sebelum saldo ini dapat diketahui.';
  const renderBahasa = () =>
    render(<BahasaProvider><MemoryRouter><ToastProvider><ManagementPack /></ToastProvider></MemoryRouter></BahasaProvider>);

  // Alpha's name can label more than one row (contract + per-currency); take the row carrying the backlog cell.
  const alphaContractRow = () =>
    screen.getAllByRole('row').find((r) => within(r).queryByText('Alpha') && within(r).queryByText(ID_UNAVAILABLE))!;

  it('AC-V24P-017: unavailable backlog shows the Bahasa label and reason on the row and an aggregate cell, never English', () => {
    h.query.data = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p1', currency: 'USD', month: '2026-04-01', net: 50, invoice_count: 1 }],
    });
    renderBahasa();
    const unavailable = screen.getAllByText(ID_UNAVAILABLE);
    // Project row (contract currency) and its per-currency aggregate.
    expect(unavailable.length).toBeGreaterThanOrEqual(2);
    const projectRow = alphaContractRow();
    expect(within(projectRow).getByText(ID_UNAVAILABLE)).toHaveAttribute('title', ID_REASON);
    const titled = unavailable.filter((el) => el.getAttribute('title') === ID_REASON);
    expect(titled.length).toBeGreaterThanOrEqual(2);
    // Subtotal row: a cell outside the project row carries the same Bahasa explanation.
    expect(titled.some((el) => !projectRow.contains(el))).toBe(true);
    expect(screen.queryByText('Unavailable')).toBeNull();
    expect(screen.queryByTitle(/needs reconciliation/)).toBeNull();
  });

  it('AC-V24P-017: a known zero-or-positive backlog shows no unavailable copy in Bahasa', () => {
    renderBahasa();
    expect(screen.queryByText(ID_UNAVAILABLE)).toBeNull();
    expect(screen.queryByTitle(ID_REASON)).toBeNull();
    const row = within(alphaProjectRow());
    expect(row.getByTestId('pack-cell-backlog')).toHaveTextContent(/750/);
  });

  it('AC-V24P-017: earlier zero-net foreign invoices stay unavailable in Bahasa and keep the null backing figure', () => {
    h.query.data = buildManagementPack({ ...facts, invoiced_before: [earlierInvoice('p1', 'USD', 0, 2)] });
    renderBahasa();
    const projectRow = alphaContractRow();
    expect(within(projectRow).getByTestId('pack-cell-backlog')).toHaveTextContent(ID_UNAVAILABLE);
    expect(within(projectRow).getByText(ID_UNAVAILABLE)).toHaveAttribute('title', ID_REASON);
    expect(screen.queryByText('Unavailable')).toBeNull();
  });
});

describe('Management pack error recovery', () => {
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
  it('AC-MMP-011: Export monthly data hands the long-format table and as-at stem to the exporter', async () => {
    renderPage();
    const row = within(alphaProjectRow());
    expect(row.getByTestId('pack-cell-invoicedToDate')).toHaveTextContent(/250/);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export monthly data' }));
    const [table, stem, format] = h.exportTable.mock.calls[0];
    expect(stem).toBe('Management-pack_2026-04');
    expect(format).toBe('csv');
    expect(table.header).toEqual(expect.arrayContaining(['Currency', 'Tax basis']));
  });
});
