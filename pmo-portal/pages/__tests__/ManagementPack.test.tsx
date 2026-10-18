import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { buildManagementPack } from '@/src/lib/reports/managementPack';
import type { ManagementPackFacts } from '@/src/lib/db/managementPack';

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

const renderPage = () =>
  render(<MemoryRouter><ToastProvider><ManagementPack /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  h.role = 'Finance';
  h.userId = 'u-fin';
  h.query = { data: buildManagementPack(facts), isPending: false, isError: false, error: null, refetch: vi.fn() };
  h.exportTable.mockReset();
});

describe('AC-MMP-012 who sees the pack and who records progress', () => {
  it('AC-MMP-012: an Engineer gets the no-access message', () => {
    h.role = 'Engineer';
    renderPage();
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
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    unmount();
    h.role = 'Finance';
    renderPage();
    expect(screen.getAllByRole('button', { name: 'Record progress' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Record progress' }).closest('tr')).toHaveTextContent('Alpha');
    expect(within(screen.getByText('Beta').closest('tr')!).queryByRole('button', { name: 'Record progress' })).not.toBeInTheDocument();
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

describe('RF-035, RF-036, RF-038 and RF-039 report honesty', () => {
  it('RF-035: separates cumulative through-date figures from selected-period rows', () => {
    renderPage();
    expect(screen.getByText('Cumulative amounts · since project start through Apr 26')).toBeInTheDocument();
    expect(screen.getByText('Monthly figures · selected period Mar 26–Apr 26')).toBeInTheDocument();
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
  it('AC-MMP-011: Export CSV hands the long-format table and the as-at stem to the exporter', async () => {
    renderPage();
    const row = within(screen.getByText('Alpha').closest('tr')!);
    expect(row.getByTestId('pack-cell-invoicedToDate')).toHaveTextContent(/250/);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export CSV' }));
    const [table, stem, format] = h.exportTable.mock.calls[0];
    expect(stem).toBe('Management-pack_2026-04');
    expect(format).toBe('csv');
    expect(table.header).toEqual(expect.arrayContaining(['Currency', 'Tax basis']));
  });
});
