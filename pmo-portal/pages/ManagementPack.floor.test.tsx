import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { buildManagementPack } from '@/src/lib/reports/managementPack';
import type { ManagementPackFacts, ManagementPackRange } from '@/src/lib/db/managementPack';
import { resetActiveLocale } from '@/src/lib/locale/activeLocale';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  revenue: true,
  userId: 'u-fin',
  query: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown, refetch: vi.fn() },
  rangeCalls: [] as ManagementPackRange[],
  rangeFactory: null as ((range: ManagementPackRange) => unknown) | null,
  exportTable: vi.fn(),
  revenueRows: [{ project_id: 'p1', currency: 'IDR', total_amount: 250, open_ar: 0, invoice_count: 2 }],
  orgCurrency: { currency: 'IDR', isResolved: true, isError: false },
  salesInvoices: [] as unknown[],
}));

vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => h.revenue }));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: (range: ManagementPackRange) => {
    h.rangeCalls.push(range);
    return { ...h.query, data: h.rangeFactory ? h.rangeFactory(range) : h.query.data };
  },
  useRecordProjectProgress: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDelivery: () => ({ data: {} }) }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [
    { id: 'p1', name: 'Alpha', pmo_project_number: 'PRJ-001', client_name: 'Client Alpha', pm: null },
    { id: 'p2', name: 'Beta', pmo_project_number: 'PRJ-002', client_name: 'Client Beta', pm: null },
  ] }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useRevenuePerProject: () => ({ data: h.revenueRows, isPending: false, isError: false }),
  useSalesInvoices: () => ({ data: h.salesInvoices, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => h.orgCurrency }));
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportTable: h.exportTable, exportXlsx: vi.fn(), busy: false }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role, canImpersonate: false, viewAs: vi.fn() }),
}));

import ManagementPack from './ManagementPack';

const project = (id: string, name: string, pm: string) => ({
  id,
  name,
  pmo_project_number: id === 'p1' ? 'PRJ-001' : 'PRJ-002',
  code: null,
  status: 'Ongoing Project',
  currency: 'IDR',
  contract_net: 1_000,
  start_date: null,
  end_date: null,
  project_manager_id: pm,
  client_name: id === 'p1' ? 'Client Alpha' : 'Client Beta',
});

const facts: ManagementPackFacts = {
  from: '2026-03-01',
  to: '2026-04-01',
  timezone: 'Asia/Jakarta',
  org_currency: 'IDR',
  undated_invoice_count: 0,
  projects: [project('p1', 'Alpha', 'u-pm'), project('p2', 'Beta', 'u-other')],
  invoiced: [{ project_id: 'p1', currency: 'IDR', month: '2026-04-01', net: 250, invoice_count: 1 }],
  invoiced_before: [],
  progress: [],
};

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
}

const projectCell = (name: string) => screen.getAllByText(name).find((el) => !el.closest('[data-testid="pack-earned-bars"]'))!;

const renderPage = (entry = '/finance/reports') => render(
  <MemoryRouter initialEntries={[entry]}>
    <ToastProvider><ManagementPack /><CurrentLocation /></ToastProvider>
  </MemoryRouter>,
);

function route() {
  return screen.getByLabelText('Current location').textContent;
}

beforeEach(() => {
  resetActiveLocale();
  h.role = 'Finance';
  h.revenue = true;
  h.userId = 'u-fin';
  h.query = { data: buildManagementPack(facts), isPending: false, isError: false, error: null, refetch: vi.fn() };
  h.rangeCalls = [];
  h.rangeFactory = null;
  h.exportTable.mockReset();
  h.orgCurrency = { currency: 'IDR', isResolved: true, isError: false };
  h.revenueRows = [{ project_id: 'p1', currency: 'IDR', total_amount: 250, open_ar: 0, invoice_count: 2 }];
  h.salesInvoices = [];
});
afterEach(() => {
  cleanup();
  resetActiveLocale();
});

describe('Finance reports floor controls', () => {
  it('floor: From month updates the URL and rereads the selected range', () => {
    renderPage('/finance/reports?to=2026-04');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-02' } });
    const params = new URLSearchParams(new URLSearchParams(route()?.split('?')[1]));
    expect(params.get('from')).toBe('2026-02');
    expect(h.rangeCalls).toContainEqual({ from: '2026-02-01', to: '2026-04-01' });
  });

  it('floor: As at month updates the heading and query range, and invalid text clears the URL value', () => {
    h.rangeFactory = (range) => buildManagementPack({
      ...facts,
      from: range.from ?? facts.from,
      to: range.to ?? facts.to,
    });
    renderPage('/finance/reports?from=2026-03&to=2026-04');
    const asAt = screen.getByLabelText('As at');
    fireEvent.change(asAt, { target: { value: '2026-05' } });
    expect(new URLSearchParams(route()?.split('?')[1]).get('to')).toBe('2026-05');
    expect(h.rangeCalls).toContainEqual({ from: '2026-03-01', to: '2026-05-01' });
    expect(screen.getByRole('heading', { name: /^Projects as at May 2026/ })).toBeInTheDocument();

    fireEvent.change(asAt, { target: { value: 'invalid-month' } });
    expect(new URLSearchParams(route()?.split('?')[1]).has('to')).toBe(false);
  });

  it('floor: Search projects filters rows by client and updates the result count', () => {
    renderPage();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search projects' }), { target: { value: 'Client Beta' } });
    expect(projectCell('Beta')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument();
  });

  it('floor: Export row sends only its project and a suffixed file stem to the exporter', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Actions for Alpha' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export row' }));
    expect(h.exportTable).toHaveBeenCalledOnce();
    const [table, stem, format] = h.exportTable.mock.calls[0]!;
    expect(table.body.length).toBeGreaterThan(0);
    expect(table.body.every((row: unknown[]) => row[2] === 'Alpha')).toBe(true);
    expect(stem).toBe('Management-pack_2026-04_PRJ-001');
    expect(format).toBe('csv');
  });

  it('floor: New invoice from an empty report opens invoice creation', () => {
    h.query.data = buildManagementPack({ ...facts, projects: [], invoiced: [] });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'New invoice' }));
    expect(route()).toBe('/finance/receivables?create=1');
  });

  it('floor: Review invoices fix link opens receivables from the hidden figure reason', async () => {
    h.query.data = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p1', currency: 'USD', month: '2026-04-01', net: 50, invoice_count: 1 }],
    });
    renderPage();
    const hiddenLine = screen.getByTestId('figures-hidden');
    await userEvent.setup().click(within(hiddenLine).getByRole('button', { name: 'Why' }));
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Review invoices' }));
    expect(route()).toBe('/finance/receivables');
  });

  it('floor: Open invoices fix link opens receivables when the as-at figure is missing', async () => {
    const data = buildManagementPack(facts);
    data.to = '2026-05-01';
    h.query.data = data;
    renderPage();
    const hiddenLine = screen.getByTestId('figures-hidden');
    await userEvent.setup().click(within(hiddenLine).getByRole('button', { name: 'Why' }));
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Open invoices' }));
    expect(route()).toBe('/finance/receivables');
  });
});
