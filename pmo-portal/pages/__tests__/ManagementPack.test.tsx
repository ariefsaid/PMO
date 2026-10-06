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
  query: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown },
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
  h.query = { data: buildManagementPack(facts), isPending: false, isError: false, error: null };
  h.exportTable.mockReset();
});

describe('AC-MMP-012 who sees the pack and who records progress', () => {
  it('AC-MMP-012: an Engineer gets the no-access message', () => {
    h.role = 'Engineer';
    renderPage();
    expect(screen.getByRole('heading', { name: "You don't have access to the management pack" })).toBeInTheDocument();
  });

  it('AC-MMP-012: Executive sees the pack; Finance may record progress on every project', () => {
    h.role = 'Executive';
    const { unmount } = renderPage();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    unmount();
    h.role = 'Finance';
    renderPage();
    expect(screen.getAllByRole('button', { name: 'Record progress' })).toHaveLength(2);
  });

  it('AC-MMP-012: a PM may record progress only on the project they manage', () => {
    h.role = 'Project Manager';
    h.userId = 'u-pm';
    renderPage();
    const buttons = screen.getAllByRole('button', { name: 'Record progress' });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest('tr')).toHaveTextContent('Alpha');
  });
});

describe('AC-MMP-013 honest states', () => {
  it('AC-MMP-013: loading shows no figures', () => {
    h.query = { data: undefined, isPending: true, isError: false, error: null };
    renderPage();
    expect(screen.queryAllByTestId(/^pack-cell-/)).toHaveLength(0);
    expect(screen.queryByText('No projects to report')).toBeNull();
  });

  it('AC-MMP-013: a failed load shows the error and no figures', () => {
    h.query = { data: undefined, isPending: false, isError: true, error: new Error('boom') };
    renderPage();
    expect(screen.getByText("Couldn't load the management pack")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^pack-cell-/)).toHaveLength(0);
    expect(screen.queryByText(/[^\d]0[.,]00\b/)).toBeNull();
  });

  it('AC-MMP-013: a refused window explains the allowed range', () => {
    h.query = { data: undefined, isPending: false, isError: true, error: Object.assign(new Error('w'), { code: '22023' }) };
    renderPage();
    expect(screen.getByText('Choose a start month on or before the as-at month, at most 24 months apart.')).toBeInTheDocument();
  });

  it('AC-MMP-013: no projects shows the empty message', () => {
    h.query = { data: buildManagementPack({ ...facts, projects: [], invoiced: [] }), isPending: false, isError: false, error: null };
    renderPage();
    expect(screen.getByText('No projects to report')).toBeInTheDocument();
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
