import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { axe } from 'jest-axe';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProjectFinances } from '@/src/lib/projectFinances';

const h = vi.hoisted(() => ({
  query: {
    data: undefined as ProjectFinances | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  },
  canReviewSetup: false,
  commitments: { data: 75, isPending: false, isError: false, commitmentSource: 'not-tracked' as const, ledgerBasis: 'erp' as 'erp' | 'pmo' | 'unavailable' },
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProjectCommittedSpend: () => h.commitments }));
vi.mock('@/src/hooks/useProjectFinances', () => ({ useProjectFinances: () => h.query }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canReviewSetup }));

import { ProjectFinancesSection } from './ProjectFinancesSection';

const project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Project North',
  currency: 'USD',
  contract_value: '220.00',
  tax_treatment: 'inclusive',
} as unknown as ProjectWithRefs;

const enCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8')) as Record<string, unknown>;
const idCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8')) as Record<string, unknown>;
const localeI18n = createInstance();

const payload = (overrides: Partial<ProjectFinances> = {}): ProjectFinances => ({
  project_id: project.id,
  contract_invoiced: '0.00',
  remaining_to_invoice: '220.00',
  invoices: [],
  budget: null,
  actuals: { currency: null, as_of: null, total: null, excludes_restricted_rows: false, categories: [] },
  ...overrides,
});

beforeEach(() => {
  h.query.data = undefined;
  h.query.isPending = false;
  h.query.isError = false;
  h.query.refetch.mockReset().mockResolvedValue(undefined);
  h.canReviewSetup = false;
  h.commitments = { data: 75, isPending: false, isError: false, commitmentSource: 'not-tracked', ledgerBasis: 'erp' };
});

describe('ProjectFinancesSection reading states', () => {
  it('AC-PFIN-015 renders the finance section from translated English and Indonesian catalogues without raw keys', async () => {
    await localeI18n.init({
      lng: 'en', fallbackLng: 'en', defaultNS: 'common',
      resources: { en: { common: enCatalogue }, id: { common: idCatalogue } },
      interpolation: { escapeValue: false }, react: { useSuspense: false },
    });
    h.query.data = payload();
    for (const [language, expectedTitle] of [['en', 'Project finances'], ['id', 'Keuangan proyek']] as const) {
      await localeI18n.changeLanguage(language);
      const view = render(<I18nextProvider i18n={localeI18n}><ProjectFinancesSection project={project} /></I18nextProvider>);
      expect(screen.getByRole('region', { name: expectedTitle })).toBeInTheDocument();
      expect(screen.queryByText(/^(projectFinances|invoiceProject)\./)).not.toBeInTheDocument();
      expect(await axe(view.container)).toHaveNoViolations();
      view.unmount();
    }
  });
  it('AC-PFIN-015 announces loading without presenting zero-valued finance', () => {
    h.query.isPending = true;
    render(<ProjectFinancesSection project={project} />);
    expect(screen.getByText('Loading project finances…')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('AC-PFIN-015 shows an alert on failure and Retry calls the query refetch', async () => {
    h.query.isError = true;
    const { container } = render(<ProjectFinancesSection project={project} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load project finances.");
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(h.query.refetch).toHaveBeenCalledOnce());
  });

  it('AC-PFIN-015 treats empty submitted invoices and unavailable GL as honest successful readings', () => {
    h.query.data = payload();
    render(<ProjectFinancesSection project={project} />);
    expect(screen.getByText('No submitted invoices')).toBeInTheDocument();
    expect(screen.getByText('Not available yet')).toBeInTheDocument();
    expect(screen.queryByText('No active budget')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('DD-MONEY-1 uses mapped ERP Actual when procurement is ERP-owned, PO Actual for PMO, and withholds on signal error', () => {
    h.query.data = payload({ actuals: { currency: 'USD', as_of: '2026-10-16T00:00:00Z', total: '120.00', excludes_restricted_rows: false,
      categories: [{ category: 'Labor', mapped: true, amount: '120.00' }] } });
    const { rerender } = render(<ProjectFinancesSection project={project} />);
    expect(within(screen.getByTestId('project-finances')).getAllByText('$120.00')).toHaveLength(2);

    h.commitments.ledgerBasis = 'pmo';
    rerender(<ProjectFinancesSection project={project} />);
    expect(screen.getByText('$75.00')).toBeInTheDocument();
    expect(screen.getByText('Committed PMO purchase orders')).toBeInTheDocument();

    h.commitments.ledgerBasis = 'unavailable';
    rerender(<ProjectFinancesSection project={project} />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('AC-PFIN-015 shows an unmatched cost category in plain words, not system terms (#1045)', () => {
    h.query.data = payload({
      actuals: { currency: 'IDR', as_of: '2026-10-16T00:00:00Z', total: null, excludes_restricted_rows: false,
        categories: [{ category: 'Labor', mapped: false, amount: null }] },
    });
    render(<ProjectFinancesSection project={project} />);
    fireEvent.click(screen.getByText('Show category details'));
    const row = screen.getByRole('row', { name: /Labor/ });
    expect(within(row).getByText('Not available yet')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Recorded spending' })).toBeInTheDocument();
    expect(screen.queryByText(/GL|mapping/i)).not.toBeInTheDocument();
  });

  it('AC-PFIN-015/017 keeps currencies separate and does not infer settlement when outstanding is missing', () => {
    h.query.data = payload({
      invoices: [
        { currency: 'USD', invoice_count: 2, invoiced: '100.00', settled: '25.00', outstanding: '75.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '90.00', missing_work: 0 },
        { currency: 'IDR', invoice_count: 1, invoiced: '400.00', settled: null, outstanding: null, missing_amount: 0, missing_outstanding: 1, tax_basis: 'mixed', work_revenue: null, missing_work: 1 },
        { currency: 'EUR', invoice_count: 1, invoiced: null, settled: null, outstanding: null, missing_amount: 1, missing_outstanding: 1, tax_basis: 'exclusive', work_revenue: null, missing_work: 1 },
      ],
    });
    render(<ProjectFinancesSection project={project} />);
    const usd = within(screen.getByTestId('project-finances-USD'));
    const idr = within(screen.getByTestId('project-finances-IDR'));
    const eur = within(screen.getByTestId('project-finances-EUR'));
    expect(usd.getByText('2 invoices')).toBeInTheDocument();
    expect(usd.getByText('$100.00')).toBeInTheDocument();
    expect(idr.getAllByText('Incomplete — ERP outstanding missing')).toHaveLength(2);
    expect(idr.getByText('Mixed tax bases')).toBeInTheDocument();
    expect(eur.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.getByText('Settled against invoices (cash, withholding and credits), not cash received.')).toBeInTheDocument();
    expect(screen.getByText('Cash received', { exact: true })).toBeInTheDocument();
  });

  it('AC-PFIN-013/015 keeps billing detail distinct and gives honest restricted/unavailable spending explanations', () => {
    h.query.data = payload({
      invoices: [
        { currency: 'USD', invoice_count: 1, invoiced: '150.00', settled: '0.00', outstanding: '150.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '130.00', missing_work: 0 },
        { currency: 'IDR', invoice_count: 1, invoiced: '200.00', settled: '0.00', outstanding: '200.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'exclusive', work_revenue: '200.00', missing_work: 0 },
      ],
      budget: { id: '22222222-2222-4222-8222-222222222222', name: 'Draft budget', version: 2, status: 'Draft', currency: 'USD', amount: '500.00' },
      actuals: { currency: 'USD', as_of: '2026-10-14T00:00:00Z', total: '50.00', excludes_restricted_rows: false, categories: [{ category: 'labor', mapped: true, amount: '50.00' }] },
    });
    const { rerender } = render(<ProjectFinancesSection project={project} />);
    expect(within(screen.getByTestId('project-finances-USD')).getByText('$80.00')).toBeInTheDocument();
    expect(within(screen.getByTestId('project-finances-IDR')).getByText('Unavailable — different currencies')).toBeInTheDocument();
    expect(screen.queryByText('Contract value')).not.toBeInTheDocument();
    expect(screen.queryByText('Budget')).not.toBeInTheDocument();
    expect(screen.getByText('Recorded spending')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Show category details'));
    expect(screen.getByText('labor')).toBeInTheDocument();

    h.query.data = payload({
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '150.00', settled: '0.00', outstanding: '150.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '130.00', missing_work: 0 }],
      budget: { id: '22222222-2222-4222-8222-222222222222', name: 'Active budget', version: 3, status: 'Active', currency: 'USD', amount: '600.00' },
      actuals: { currency: 'USD', as_of: null, total: '50.00', excludes_restricted_rows: true, categories: [] },
    });
    rerender(<ProjectFinancesSection project={project} />);
    expect(within(screen.getByTestId('project-finances-USD')).getByText('Actuals exclude restricted rows')).toBeInTheDocument();
    expect(screen.queryByText('Budget')).not.toBeInTheDocument();

    h.query.data = payload({
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '150.00', settled: '0.00', outstanding: '150.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: null, missing_work: 1 }],
      actuals: { currency: 'USD', as_of: null, total: '50.00', excludes_restricted_rows: false, categories: [] },
    });
    rerender(<ProjectFinancesSection project={project} />);
    const usd = within(screen.getByTestId('project-finances-USD'));
    expect(usd.getByText('Billed-work revenue unavailable')).toBeInTheDocument();
    expect(usd.getByText('Unavailable')).toBeInTheDocument();
    expect(usd.queryByText('$100.00')).not.toBeInTheDocument();
  });

  it('UX-023/024/025 summarizes incomplete spending coverage and labels freshness without exposing repeated setup errors', () => {
    h.query.data = payload({
      actuals: { currency: 'USD', as_of: '2026-10-14T00:00:00Z', total: '50.00', excludes_restricted_rows: false, categories: [
        { category: 'Labor', mapped: true, amount: '50.00' },
        { category: 'Materials', mapped: false, amount: null },
        { category: 'Equipment', mapped: false, amount: null },
      ] },
    });
    render(<ProjectFinancesSection project={project} />);

    expect(screen.getByText('Recorded spending')).toBeInTheDocument();
    expect(screen.getByText('Partial coverage · 1 of 3 categories recorded')).toBeInTheDocument();
    expect(screen.getByText(/Updated Oct 14, 2026/)).toBeInTheDocument();
    expect(screen.getByText('Cash received', { exact: true }).closest('div')).toHaveTextContent('Unavailable — receipt-backed cash data is not available yet');
    expect(screen.getByText(/Ask Finance or Admin to review spending setup/)).toBeInTheDocument();
    expect(screen.queryByText('GL actuals')).not.toBeInTheDocument();
    expect(screen.getByText('Show category details')).toBeInTheDocument();
  });

  it('UX-024 gives setup managers a direct review path instead of a generic handoff', () => {
    h.canReviewSetup = true;
    h.query.data = payload({
      actuals: { currency: 'USD', as_of: null, total: '50.00', excludes_restricted_rows: false, categories: [
        { category: 'Labor', mapped: false, amount: null },
      ] },
    });
    render(<MemoryRouter><ProjectFinancesSection project={project} /></MemoryRouter>);

    expect(screen.getByRole('link', { name: 'Review spending setup' })).toHaveAttribute(
      'href', '/administration/accounting#budget-account-map',
    );
    expect(screen.queryByText(/Ask Finance or Admin/)).not.toBeInTheDocument();
  });

  it('UX-032 explains settlement only when at least one settlement is known', () => {
    h.query.data = payload();
    const { rerender } = render(<ProjectFinancesSection project={project} />);
    expect(screen.queryByText(/Settled against invoices/)).not.toBeInTheDocument();

    h.query.data = payload({ invoices: [
      { currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: '40.00', outstanding: '60.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '100.00', missing_work: 0 },
    ] });
    rerender(<ProjectFinancesSection project={project} />);
    expect(screen.getByText(/Settled against invoices/)).toBeInTheDocument();
    expect(screen.getByText('Cash received')).toBeInTheDocument();
  });

  it('AC-PFIN-015 keeps long money strings semantic dt/dd fields that can wrap on narrow content', () => {
    h.query.data = payload({
      invoices: [{ currency: 'USD', invoice_count: 12, invoiced: '1234567890.55', settled: '1234567890.44', outstanding: '0.11', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '1234567890.33', missing_work: 0 }],
    });
    render(<ProjectFinancesSection project={project} />);
    const bucket = screen.getByTestId('project-finances-USD');
    expect(bucket).toHaveClass('min-w-0');
    // The settlement readings stay semantic description-list fields, not escaped raw text.
    const invoicedLabel = within(bucket).getByText('Invoiced');
    expect(invoicedLabel.tagName).toBe('DT');
    const invoicedValue = screen.getByText('$1,234,567,890.55').closest('dd');
    expect(invoicedValue).not.toBeNull();
    expect(invoicedValue).toHaveClass('break-words');
    expect(invoicedValue?.tagName).toBe('DD');
    expect(within(bucket).getAllByRole('term')).toHaveLength(5);
  });
});
