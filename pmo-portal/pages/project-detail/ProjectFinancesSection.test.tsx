import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
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
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({ useProjectFinances: () => h.query }));

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
    expect(screen.getByText('GL reading unavailable')).toBeInTheDocument();
    expect(screen.getByText('No budget')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
    expect(screen.queryByText('Cash received', { exact: true })).not.toBeInTheDocument();
  });

  it('AC-PFIN-013/015 shows billed-work margin, budget state and honest restricted/unavailable explanations', () => {
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
    expect(screen.getByText(/Draft — not active.*Draft budget.*v2.*USD/)).toBeInTheDocument();
    expect(screen.getByText('Mapped GL costs')).toBeInTheDocument();
    expect(screen.getByText('labor')).toBeInTheDocument();

    h.query.data = payload({
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '150.00', settled: '0.00', outstanding: '150.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '130.00', missing_work: 0 }],
      budget: { id: '22222222-2222-4222-8222-222222222222', name: 'Active budget', version: 3, status: 'Active', currency: 'USD', amount: '600.00' },
      actuals: { currency: 'USD', as_of: null, total: '50.00', excludes_restricted_rows: true, categories: [] },
    });
    rerender(<ProjectFinancesSection project={project} />);
    expect(within(screen.getByTestId('project-finances-USD')).getByText('Actuals exclude restricted rows')).toBeInTheDocument();
    expect(screen.getByText(/Active.*Active budget.*v3.*USD/)).toBeInTheDocument();

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
});
