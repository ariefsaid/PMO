import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import idFinanceHub from '../../public/locales/id/financeHub.json';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
// The real derivation: the page, the home selectors and this test all read the same pack.
import { buildManagementPack, selectLeftToBillTotals, type ManagementPack as Pack } from '@/src/lib/reports/managementPack';
import { selectLeftToBillByProject } from '@/src/components/dashboard/restructure/useCompanyFigures';
import type { ManagementPackFacts } from '@/src/lib/db/managementPack';

const h = vi.hoisted(() => ({ pack: undefined as unknown }));

vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => true }));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => ({ data: h.pack, isPending: false, isError: false, error: null, refetch: vi.fn() }),
  useRecordProjectProgress: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDelivery: () => ({ data: {} }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [{ id: 'p1', name: 'Alpha', pm: { full_name: 'Test Manager' } }] }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useRevenuePerProject: () => ({ data: [], isPending: false, isError: false }),
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }) }));
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportTable: vi.fn(), exportXlsx: vi.fn(), busy: false }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Finance', realRole: 'Finance', canImpersonate: false, viewAs: vi.fn() }),
}));

import ManagementPack from '../ManagementPack';

// One IDR contract of 1,000,000: 60% complete (600,000 recognised) but only 200,000 invoiced.
const facts: ManagementPackFacts = {
  from: '2026-03-01', to: '2026-04-01', timezone: 'Asia/Jakarta', org_currency: 'IDR', undated_invoice_count: 0,
  projects: [{
    id: 'p1', name: 'Alpha', pmo_project_number: null, code: null, status: 'Ongoing Project', on_hand: true, currency: 'IDR',
    contract_net: 1_000_000, start_date: null, end_date: null, project_manager_id: 'u-pm', client_name: null,
  }],
  invoiced: [{ project_id: 'p1', currency: 'IDR', month: '2026-03-01', net: 200_000, invoice_count: 1 }],
  invoiced_before: [],
  progress: [{ project_id: 'p1', month: '2026-03-01', pct_complete: 60, entered_at: '2026-03-31T10:00:00Z', entered_by_name: 'Fin' }],
};

const renderPage = () => render(<MemoryRouter><ToastProvider><ManagementPack /></ToastProvider></MemoryRouter>);
const alphaRow = () => screen.getAllByRole('row').find((r) => within(r).queryByTestId('pack-cell-contract')?.textContent?.includes('1,000,000'))!;
const leftToBillTile = () =>
  within(screen.getByRole('region', { name: 'Report figures' })).getByTestId('pack-figure-leftToBill');

beforeEach(() => { h.pack = buildManagementPack(facts); });
afterEach(async () => { await act(async () => { await i18next.changeLanguage('en'); }); });

describe('#2203 Left to bill reads one derivation in the report tile, rows and home', () => {
  it('AC-LTB-001: progress ahead of invoicing gives the same Left to bill on the tile, the row and home', () => {
    const pack = h.pack as Pack;
    renderPage();
    // Contract less invoiced (800,000), not contract less recognised (400,000).
    expect(leftToBillTile()).toHaveTextContent(/800/);
    expect(leftToBillTile()).not.toHaveTextContent(/400/);
    expect(within(alphaRow()).getByTestId('pack-cell-leftToBill')).toHaveTextContent('800,000');
    expect(selectLeftToBillTotals(pack, 'IDR')).toEqual([{ currency: 'IDR', amount: 800_000, noValueCount: 0 }]);
    expect(selectLeftToBillByProject(pack, 'IDR')).toEqual([{ id: 'p1', name: 'Alpha', amount: 800_000 }]);
    // Every held contract has a value: no note anywhere.
    expect(screen.queryByText(/with no value/)).not.toBeInTheDocument();
  });

  it('AC-LTB-002: an invoice awaiting reconciliation leaves the tile hidden, the row explained and home unknown', () => {
    h.pack = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p1', currency: 'USD', month: '2026-03-01', net: 10, invoice_count: 1 }],
    });
    const pack = h.pack as Pack;
    renderPage();
    const figures = screen.getByRole('region', { name: 'Report figures' });
    expect(within(figures).queryByText('Left to bill')).not.toBeInTheDocument();
    expect(within(alphaRow()).getByTestId('pack-cell-leftToBill')).toHaveTextContent(/^—/);
    expect(selectLeftToBillTotals(pack, 'IDR')).toEqual([{ currency: 'IDR', amount: null, noValueCount: 0 }]);
    expect(selectLeftToBillByProject(pack, 'IDR')).toEqual([]);
  });

  it('AC-LTB-004: an archived project billed in the window shows no Left to bill and adds nothing on the tile, row total or home', () => {
    h.pack = buildManagementPack({
      ...facts,
      projects: [...facts.projects, {
        id: 'p9', name: 'Archived', pmo_project_number: null, code: null, status: 'Ongoing Project', currency: 'IDR',
        contract_net: 3_000_000, start_date: null, end_date: null, project_manager_id: null, client_name: null, on_hand: false,
      }],
      invoiced: [...facts.invoiced, { project_id: 'p9', currency: 'IDR', month: '2026-03-01', net: 1_000_000, invoice_count: 1 }],
    });
    const pack = h.pack as Pack;
    renderPage();
    expect(leftToBillTile()).toHaveTextContent(/800/);
    const archivedRow = screen.getAllByRole('row').find((r) => within(r).queryByTestId('pack-cell-contract')?.textContent?.includes('3,000,000'))!;
    const cell = within(archivedRow).getByTestId('pack-cell-leftToBill');
    expect(cell).toHaveTextContent(/^—$/);
    expect(cell.querySelector('[title]')).toBeNull();
    expect(within(alphaRow()).getByTestId('pack-cell-leftToBill')).toHaveTextContent('800,000');
    expect(selectLeftToBillTotals(pack, 'IDR')).toEqual([{ currency: 'IDR', amount: 800_000, noValueCount: 0 }]);
    expect(selectLeftToBillByProject(pack, 'IDR')).toEqual([{ id: 'p1', name: 'Alpha', amount: 800_000 }]);
    // Nothing awaits reconciliation, so the page has no hidden-figures line: no "Left to bill excludes
    // unreconciled foreign-currency invoices" reason and no Review invoices link.
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review invoices' })).not.toBeInTheDocument();
  });

  // Ruling: a held contract with no value is counted and said beside the total, which stays a number.
  const withNoValue = (): ManagementPackFacts => ({
    ...facts,
    projects: [...facts.projects, {
      id: 'p6', name: 'Zeta', pmo_project_number: null, code: null, status: 'Won, Pending KoM', currency: 'IDR',
      contract_net: 0, start_date: null, end_date: null, project_manager_id: null, client_name: null, on_hand: true,
    }],
    invoiced: [...facts.invoiced, { project_id: 'p6', currency: 'IDR', month: '2026-03-01', net: 50_000, invoice_count: 1 }],
  });
  const totalRow = () => screen.getAllByRole('row').find((r) => r.textContent?.includes('Total · IDR'))!;

  it('AC-LTB-005: a held contract with no value is said beside the tile and the row total, which stay 800,000', () => {
    h.pack = buildManagementPack(withNoValue());
    renderPage();
    const note = '1 contract with no value, not in the total';
    expect(leftToBillTile()).toHaveTextContent(/800/);
    expect(leftToBillTile()).toHaveTextContent(note);
    expect(totalRow()).toHaveTextContent('800,000');
    expect(totalRow()).toHaveTextContent(note);
    // The no-value row is a plain dash, not the reconciliation reason, and raises no hidden-figure line.
    const zeta = screen.getAllByRole('row').find((r) => r.textContent?.includes('Zeta'))!;
    expect(within(zeta).getByTestId('pack-cell-leftToBill')).toHaveTextContent(/^—$/);
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
  });

  it('AC-LTB-005: the note is plural-correct', () => {
    const two = withNoValue();
    h.pack = buildManagementPack({ ...two, projects: [...two.projects, { ...two.projects[1], id: 'p7', name: 'Eta' }] });
    renderPage();
    expect(leftToBillTile()).toHaveTextContent('2 contracts with no value, not in the total');
  });

  it('AC-LTB-005: the note reads in Bahasa Indonesia', async () => {
    i18next.addResourceBundle('id', 'financeHub', idFinanceHub, true, true);
    await act(async () => { await i18next.changeLanguage('id'); });
    h.pack = buildManagementPack(withNoValue());
    renderPage();
    expect(screen.getAllByText('1 kontrak tanpa nilai, tidak termasuk total').length).toBeGreaterThanOrEqual(2);
  });
});
