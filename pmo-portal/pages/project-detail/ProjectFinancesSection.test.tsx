import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { axe } from 'jest-axe';
import 'jest-axe/extend-expect'; // global registration moved out of test/setup.ts (unit-speed #1584)
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { type ProjectFinances, type ProjectReceiptCash } from '@/src/lib/projectFinances';

const h = vi.hoisted(() => ({
  query: {
    data: undefined as ProjectFinances | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  },
  collection: { data: {} as Record<string, { ledgerBasis: 'pmo' | 'erp'; actuals: { currency: string; total: string | null; complete: boolean } }>, isPending: false, isError: false },
  role: 'Project Manager' as 'Admin' | 'Finance' | 'Project Manager' | 'Engineer' | 'Executive',
  effectiveRole: 'Project Manager' as 'Admin' | 'Finance' | 'Project Manager' | 'Engineer' | 'Executive',
  commitments: { data: 75, isPending: false, isError: false, commitmentSource: 'not-tracked' as const, ledgerBasis: 'erp' as 'erp' | 'pmo' | 'unavailable',
    otherCurrencies: [] as Array<{ currency: string | null; amount: number }> },
}));
vi.mock('@/src/hooks/useProjectsMoneyCollection', () => ({ useProjectsMoneyCollection: () => h.collection }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProjectCommittedSpend: () => h.commitments }));
vi.mock('@/src/hooks/useProjectFinances', () => ({ useProjectFinances: () => h.query }));
vi.mock('@/src/components/fx/FxEquivalent', () => ({ default: () => null }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string, entity: string) =>
  action === 'manage' && entity === 'orgAccounting' && h.role === 'Admin' }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.effectiveRole }) }));

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
const enProjectCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/project.json'), 'utf8')) as Record<string, unknown>;
const idProjectCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/project.json'), 'utf8')) as Record<string, unknown>;
const enFinanceCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/finance.json'), 'utf8')) as Record<string, unknown>;
const idFinanceCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/finance.json'), 'utf8')) as Record<string, unknown>;
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
  h.collection = { data: { [project.id]: { ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '75', complete: true } } }, isPending: false, isError: false };
  h.role = 'Project Manager';
  h.effectiveRole = 'Project Manager';
  h.commitments = { data: 75, isPending: false, isError: false, commitmentSource: 'not-tracked', ledgerBasis: 'erp', otherCurrencies: [] };
});

describe('ProjectFinancesSection attributed cost (#1271 AC-3)', () => {
  const withSplit = (attributed: string | undefined) => payload({ actuals: {
    currency: 'USD', as_of: '2026-10-14T00:00:00Z', total: '150.00', tagged_total: '100.00',
    ...(attributed === undefined ? {} : { attributed_total: attributed }),
    excludes_restricted_rows: false,
    categories: [
      { category: 'Labor', mapped: true, amount: '150.00', tagged_amount: '100.00', ...(attributed === undefined ? {} : { attributed_amount: attributed }) },
    ] } });

  it('AC-CAT-016 labels attributed cost apart from tagged cost, in the total and the category drill-down', () => {
    h.query.data = withSplit('50.00');
    render(<ProjectFinancesSection project={project} />);
    // C5/C6: no padded .00, bare under the "Recorded spending · USD" heading.
    expect(screen.getByTestId('spending-attributed-note')).toHaveTextContent('Includes 50 attributed by cost rules · 100 tagged in the ERP');
    fireEvent.click(screen.getByText('Show category details'));
    const disclosure = screen.getByText('Show category details').closest('details')!;
    expect(within(disclosure).getByText('incl. 50 attributed')).toBeInTheDocument();
    // F10: the category drill-down is the shared DataTable.
    expect(within(disclosure).getByRole('table', { name: 'Recorded spending by category' })).toBeInTheDocument();
  });

  it.each([['0.00'], [undefined]])('AC-CAT-016 shows no split when attributed is %s, so screens without rules are unchanged', (attributed) => {
    h.query.data = withSplit(attributed);
    render(<ProjectFinancesSection project={project} />);
    fireEvent.click(screen.getByText('Show category details'));
    expect(screen.queryByTestId('spending-attributed-note')).toBeNull();
    expect(screen.queryByText(/attributed/i)).toBeNull();
  });
});

describe('ProjectFinancesSection reading states', () => {
  it('AC-MONEY-DISPLAY: whole units are shown on the project spending block', () => {
    h.query.data = payload({ actuals: { currency: 'USD', as_of: '2026-10-14T00:00:00Z', total: '120.49', excludes_restricted_rows: false,
      categories: [{ category: 'Labor', mapped: true, amount: '120.49' }] } });
    render(<ProjectFinancesSection project={project} />);
    expect(screen.getAllByText('120')).toHaveLength(2);
    expect(screen.queryByText('$120.49')).not.toBeInTheDocument();
  });

  it('AC-MONEY-DISPLAY: Admin gets one plain setup line and a link when no spending can be shown', () => {
    h.role = 'Admin';
    h.effectiveRole = 'Admin';
    h.query.data = payload({ actuals: { currency: 'USD', as_of: null, total: null, excludes_restricted_rows: false,
      categories: [{ category: 'Labor', mapped: false, amount: null }, { category: 'Materials', mapped: false, amount: null }] } });
    render(<MemoryRouter><ProjectFinancesSection project={project} /></MemoryRouter>);
    const prompt = screen.getByTestId('spending-setup-prompt');
    expect(prompt).toHaveTextContent('Recorded spending will appear after account setup is complete.');
    expect(within(prompt).getByRole('link', { name: 'Open spending setup' })).toHaveAttribute('href', '/administration/accounting#budget-account-map');
    expect(screen.queryByRole('heading', { name: /Recorded spending/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Spending setup details')).not.toBeInTheDocument();
  });

  it('AC-MONEY-DISPLAY: project users do not see an empty spending block or setup internals', () => {
    h.query.data = payload({ actuals: { currency: 'USD', as_of: null, total: null, excludes_restricted_rows: false,
      categories: [{ category: 'Labor', mapped: false, amount: null }] } });
    render(<ProjectFinancesSection project={project} />);
    expect(screen.queryByRole('heading', { name: /Recorded spending/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/account setup|spending setup/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
  });

  it('AC-PFIN-015 renders the finance section from translated English and Indonesian catalogues without raw keys', async () => {
    await localeI18n.init({
      lng: 'en', fallbackLng: 'en', defaultNS: 'common', fallbackNS: 'common', ns: ['common', 'project', 'finance'],
      resources: { en: { common: enCatalogue, project: enProjectCatalogue, finance: enFinanceCatalogue }, id: { common: idCatalogue, project: idProjectCatalogue, finance: idFinanceCatalogue } },
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

  it('AC-PFIN-015 / PD-C: no invoices reads as ONE line, with no zero invoiced, no remaining = contract, no budget line', () => {
    h.query.data = payload();
    render(<ProjectFinancesSection project={project} />);
    expect(screen.getByTestId('project-no-invoices')).toHaveTextContent('No invoices linked to this project yet');
    for (const gone of ['No submitted invoices', 'No budget', 'Lifetime to date', 'Cash received', 'Invoiced against contract',
      'Remaining to invoice', 'Only invoices linked to this project are included.', 'No active budget']) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('heading', { name: /Recorded spending/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('PD-C/C4: with invoices, unknown cash is left out of the drill-down (Money position says why once); qualifiers move into titles', () => {
    h.query.data = payload({ invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: '40.00', outstanding: '60.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '90.00', missing_work: 0 }] });
    render(<ProjectFinancesSection project={project} />);
    expect(screen.queryByText('Cash received', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/Unavailable/)).not.toBeInTheDocument();
    expect(screen.getByText('Settled')).toHaveAttribute('title', 'Settled against invoices (cash, withholding and credits), not cash received.');
    expect(screen.getByText('Billed-work revenue')).toHaveAttribute('title', 'Net of tax; advances excluded');
    expect(screen.queryByText(/Billed-work revenue \(net of tax/)).not.toBeInTheDocument();
    expect(screen.getByTestId('project-invoicing-scope')).toBeInTheDocument();
  });

  it('PD-C: coverage shows only when partial; freshness is one inline "Updated"', () => {
    h.query.data = payload({ actuals: { currency: 'USD', as_of: '2026-10-14T00:00:00Z', total: '50.00', excludes_restricted_rows: false,
      categories: [{ category: 'Labor', mapped: true, amount: '50.00' }] } });
    const { rerender } = render(<ProjectFinancesSection project={project} />);
    expect(screen.queryByText('Complete category coverage')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Updated Oct 14, 2026/)).toHaveLength(1);
    h.query.data = payload({ actuals: { currency: 'USD', as_of: '2026-10-14T00:00:00Z', total: '50.00', excludes_restricted_rows: false,
      categories: [{ category: 'Labor', mapped: true, amount: '50.00' }, { category: 'Materials', mapped: false, amount: null }] } });
    rerender(<ProjectFinancesSection project={project} />);
    expect(screen.getByText('Partial coverage · 1 of 2 categories recorded')).toBeInTheDocument();
  });

  it('0373 a PMO-basis spending figure stays in the project currency and names other-currency commitments beside it', () => {
    h.query.data = payload({});
    h.commitments.ledgerBasis = 'pmo';
    h.commitments.otherCurrencies = [{ currency: 'EUR', amount: 40 }];
    render(<ProjectFinancesSection project={project} />);
    expect(within(screen.getByRole('heading', { name: /Recorded spending/ }).parentElement!).getByText('75', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByTestId('committed-other-currencies')).toHaveTextContent('Plus amounts in other currencies: €40');
  });

  it('names an unavailable commitment currency without formatting an invented code', () => {
    h.query.data = payload({});
    h.commitments.ledgerBasis = 'pmo';
    h.commitments.otherCurrencies = [{ currency: null, amount: 40 }];
    h.collection.data[project.id] = { ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '75', complete: false } };
    render(<ProjectFinancesSection project={project} />);
    expect(screen.getByTestId('committed-other-currencies')).toHaveTextContent('Currency unavailable');
  });

  it('uses the full PMO position for spending and withholds it on a failed read', () => {
    h.query.data = payload({});
    h.commitments.ledgerBasis = 'pmo';
    h.collection.data[project.id] = { ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '110', complete: false } };
    const { rerender } = render(<ProjectFinancesSection project={project} />);
    const spending = () => within(screen.getByRole('heading', { name: /Recorded spending/ }).parentElement!);
    expect(spending().getByText('110', { selector: 'p' })).toBeInTheDocument();
    expect(spending().getByText(/Partial position/)).toBeInTheDocument();
    h.collection.isError = true;
    rerender(<ProjectFinancesSection project={project} />);
    expect(screen.queryByText('110', { selector: 'p' })).not.toBeInTheDocument();
    expect(screen.queryByText('75', { selector: 'p' })).not.toBeInTheDocument();
    expect(spending().getByText('Spending coverage unavailable')).toBeInTheDocument();
  });

  it('withholds a position when its ledger basis disagrees with the current basis', () => {
    h.query.data = payload({});
    h.commitments.ledgerBasis = 'pmo';
    h.collection.data[project.id] = { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '110', complete: true } };
    render(<ProjectFinancesSection project={project} />);
    expect(screen.queryByText('110', { selector: 'p' })).not.toBeInTheDocument();
  });

  it('withholds a cached position when its currency differs from the project', () => {
    h.query.data = payload({});
    h.commitments.ledgerBasis = 'pmo';
    h.collection.data[project.id] = { ledgerBasis: 'pmo', actuals: { currency: 'EUR', total: '110', complete: true } };
    render(<ProjectFinancesSection project={project} />);
    expect(screen.queryByText('110', { selector: 'p' })).not.toBeInTheDocument();
  });

  it('does not calculate margin from an ERP snapshot when the position uses PMO commitments', () => {
    h.commitments.ledgerBasis = 'pmo';
    h.query.data = payload({
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100', settled: '0', outstanding: '100', missing_amount: 0, missing_outstanding: 0, tax_basis: 'exclusive', work_revenue: '100', missing_work: 0 }],
      actuals: { currency: 'USD', as_of: null, total: '40', excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: true, amount: '40' }] },
    });
    render(<ProjectFinancesSection project={project} />);
    expect(within(screen.getByTestId('project-finances-USD')).getByText(/Gross margin is left out/)).toBeInTheDocument();
  });

  it('DD-MONEY-1 uses mapped ERP Actual when procurement is ERP-owned, PO Actual for PMO, and withholds on signal error', () => {
    h.query.data = payload({ actuals: { currency: 'USD', as_of: '2026-10-16T00:00:00Z', total: '120.00', excludes_restricted_rows: false,
      categories: [{ category: 'Labor', mapped: true, amount: '120.00' }] } });
    const { rerender } = render(<ProjectFinancesSection project={project} />);
    // L6: Actual is shown once — as Recorded spending — not again in the position row.
    expect(within(screen.getByTestId('project-finance-position-details')).queryByText('Actual')).not.toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: /Recorded spending/ }).parentElement!).getByText('120', { selector: 'p' })).toBeInTheDocument();

    h.commitments.ledgerBasis = 'pmo';
    rerender(<ProjectFinancesSection project={project} />);
    expect(within(screen.getByRole('heading', { name: /Recorded spending/ }).parentElement!).getByText('75', { selector: 'p' })).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: /Recorded spending/ }).parentElement!).getByText('Committed PMO purchase orders', { selector: 'p' })).toBeInTheDocument();

    h.commitments.ledgerBasis = 'unavailable';
    rerender(<ProjectFinancesSection project={project} />);
    // C4: an unknown Actual is left out (never a placeholder value, never 0); the coverage line says why.
    const spending = within(screen.getByRole('heading', { name: /Recorded spending/ }).parentElement!);
    expect(spending.getByText('Spending coverage unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/Unavailable$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\$?0(\.00)?$/)).not.toBeInTheDocument();
  });

  it('AC-PFIN-015 shows Finance one plain-language handoff when no spending data can be shown', () => {
    h.role = 'Finance';
    h.query.data = payload({
      actuals: { currency: 'IDR', as_of: '2026-10-16T00:00:00Z', total: null, excludes_restricted_rows: false,
        categories: [{ category: 'Labor', mapped: false, amount: null }] },
    });
    render(<ProjectFinancesSection project={project} />);
    expect(screen.getByTestId('spending-setup-prompt')).toHaveTextContent('Ask an administrator to complete spending setup.');
    expect(screen.queryByRole('heading', { name: /Recorded spending/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Spending setup details')).not.toBeInTheDocument();
    expect(screen.queryByText('Show category details')).not.toBeInTheDocument();
    expect(screen.queryByText(/GL|ERP|mapping|Labor/i)).not.toBeInTheDocument();
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
    // C5/C6: bare whole figures under each currency heading.
    expect(usd.getByText('100')).toBeInTheDocument();
    // C4: unknown settled/outstanding are left out and the reason is said once per currency, never as a value.
    expect(idr.queryByText('Settled')).not.toBeInTheDocument();
    expect(idr.getAllByText('Invoice balance is not available yet')).toHaveLength(1);
    expect(idr.getByText('Mixed tax bases')).toBeInTheDocument();
    expect(eur.queryByText(/Unavailable/)).not.toBeInTheDocument();
    expect(eur.queryByText('Invoiced')).not.toBeInTheDocument();
    expect(screen.getAllByText('Settled')[0]).toHaveAttribute('title', 'Settled against invoices (cash, withholding and credits), not cash received.');
  });

  it('AC-MONEY-DISPLAY states a single currency and tax basis per project-finance block', () => {
    h.query.data = payload({
      contract_invoiced: '100.50', remaining_to_invoice: '119.50',
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.50', settled: '50.25', outstanding: '50.25', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '100.50', missing_work: 0 }],
      actuals: { currency: 'USD', as_of: '2026-10-14T00:00:00Z', total: '40.49', excludes_restricted_rows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '40.49' }] },
    });
    render(<ProjectFinancesSection project={{ ...project, status: 'Ongoing Project' } as ProjectWithRefs} />);
    expect(screen.getByRole('heading', { name: 'Contract invoice position · USD' })).toBeInTheDocument();
    expect(screen.getByTestId('project-finances-contract-basis')).toHaveTextContent('incl. PPN');
    expect(screen.queryByTestId('project-invoiced-basis')).not.toBeInTheDocument();
    expect(screen.queryByTestId('project-remaining-basis')).not.toBeInTheDocument();
    expect(screen.getByText('Recorded spending · USD')).toBeInTheDocument();
    const invoiceBucketElement = screen.getByTestId('project-finances-USD');
    const invoiceBucket = within(invoiceBucketElement);
    expect(invoiceBucket.getAllByText('101')).toHaveLength(2);
    expect(invoiceBucket.getAllByText('50')).toHaveLength(2);
    expect(invoiceBucketElement).not.toHaveTextContent('$');
    expect(within(invoiceBucketElement).getAllByRole('term')).toHaveLength(5);
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
    expect(within(screen.getByTestId('project-finances-USD')).getByText('80')).toBeInTheDocument();
    expect(within(screen.getByTestId('project-finances-IDR')).getByText('Gross margin is left out because spending and billed work use different currencies.')).toBeInTheDocument();
    expect(screen.queryByText('Contract value')).not.toBeInTheDocument();
    expect(screen.queryByText('Budget')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Recorded spending/ })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Show category details'));
    expect(screen.getByText('labor')).toBeInTheDocument();

    h.query.data = payload({
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '150.00', settled: '0.00', outstanding: '150.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '130.00', missing_work: 0 }],
      budget: { id: '22222222-2222-4222-8222-222222222222', name: 'Active budget', version: 3, status: 'Active', currency: 'USD', amount: '600.00' },
      actuals: { currency: 'USD', as_of: null, total: '50.00', excludes_restricted_rows: true, categories: [] },
    });
    rerender(<ProjectFinancesSection project={project} />);
    expect(within(screen.getByTestId('project-finances-USD')).getByText('Gross margin is left out because spending excludes restricted rows.')).toBeInTheDocument();
    expect(screen.queryByText('Budget')).not.toBeInTheDocument();

    h.query.data = payload({
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '150.00', settled: '0.00', outstanding: '150.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: null, missing_work: 1 }],
      actuals: { currency: 'USD', as_of: null, total: '50.00', excludes_restricted_rows: false, categories: [] },
    });
    rerender(<ProjectFinancesSection project={project} />);
    const usd = within(screen.getByTestId('project-finances-USD'));
    expect(usd.getByText('Gross margin is left out until billed-work revenue is complete.')).toBeInTheDocument();
    expect(usd.queryByText('Billed-work revenue')).not.toBeInTheDocument();
    expect(usd.queryByText(/Unavailable/)).not.toBeInTheDocument();
    expect(usd.queryByText('100')).not.toBeInTheDocument();
  });

  it('AC-1044-001 shows one capability-appropriate setup prompt for each real role', () => {
    h.query.data = payload({
      actuals: { currency: 'USD', as_of: '2026-10-14T00:00:00Z', total: '50.00', excludes_restricted_rows: false, categories: [
        { category: 'Labor', mapped: true, amount: '50.00' },
        { category: 'Materials', mapped: false, amount: null },
      ] },
    });
    const expected = new Map([
      ['Admin', 'link'], ['Finance', 'handoff'], ['Project Manager', null], ['Engineer', null], ['Executive', null],
    ]);
    for (const [role, prompt] of expected) {
      h.role = role as typeof h.role;
      h.effectiveRole = role as typeof h.effectiveRole;
      const view = render(<MemoryRouter><ProjectFinancesSection project={project} /></MemoryRouter>);
      const promptRegion = screen.queryByTestId('spending-setup-prompt');
      if (prompt === 'link') {
        expect(promptRegion).not.toBeNull();
        expect(promptRegion).toHaveTextContent('Recorded spending will appear after account setup is complete.');
        const setupLink = within(promptRegion!).getByRole('link', { name: 'Open spending setup' });
        expect(setupLink).toHaveAttribute('href', '/administration/accounting#budget-account-map');
        expect(setupLink).toHaveClass('text-primary-text');
        expect(screen.queryByText('Ask an administrator to complete spending setup.')).not.toBeInTheDocument();
      } else if (prompt === 'handoff') {
        expect(promptRegion).toHaveTextContent('Ask an administrator to complete spending setup.');
        expect(within(promptRegion!).queryByRole('link')).not.toBeInTheDocument();
      } else expect(promptRegion).not.toBeInTheDocument();
      expect(screen.queryAllByTestId('spending-setup-prompt')).toHaveLength(prompt ? 1 : 0);
      view.unmount();
    }
  });

  it('AC-1044-001 localizes the setup handoff and invoice scope in both catalogues', async () => {
    if (!localeI18n.isInitialized) {
      await localeI18n.init({ lng: 'en', fallbackLng: 'en', defaultNS: 'common', fallbackNS: 'common', ns: ['common', 'project', 'finance'],
        resources: { en: { common: enCatalogue, project: enProjectCatalogue, finance: enFinanceCatalogue }, id: { common: idCatalogue, project: idProjectCatalogue, finance: idFinanceCatalogue } },
        interpolation: { escapeValue: false }, react: { useSuspense: false } });
    }
    h.role = 'Finance';
    h.query.data = payload({ invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: '40.00', outstanding: '60.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '90.00', missing_work: 0 }], actuals: { currency: 'USD', as_of: '2026-10-14T00:00:00Z', total: null,
      excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: false, amount: null }] } });
    for (const [language, prompt, scope] of [
      ['en', 'Ask an administrator to complete spending setup.', 'Only invoices linked to this project are included.'],
      ['id', 'Minta administrator menyelesaikan penyiapan pengeluaran.', 'Hanya faktur yang ditautkan ke proyek ini yang disertakan.'],
    ] as const) {
      await localeI18n.changeLanguage(language);
      const view = render(<I18nextProvider i18n={localeI18n}><ProjectFinancesSection project={project} /></I18nextProvider>);
      expect(screen.getByTestId('spending-setup-prompt')).toHaveTextContent(prompt);
      expect(screen.getByTestId('project-invoicing-scope')).toHaveTextContent(scope);
      view.unmount();
    }
    await localeI18n.changeLanguage('en');
  });

  it('AC-1044-001 view-as does not grant setup visibility or capability', () => {
    h.role = 'Project Manager';
    h.effectiveRole = 'Admin';
    h.query.data = payload({ actuals: { currency: 'USD', as_of: '2026-10-14T00:00:00Z', total: null,
      excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: false, amount: null }] } });
    render(<MemoryRouter><ProjectFinancesSection project={project} /></MemoryRouter>);
    expect(screen.queryByTestId('spending-setup-prompt')).not.toBeInTheDocument();
  });

  it('AC-1044-002 keeps known amounts available and gives Finance/Admin one setup prompt', () => {
    h.query.data = payload({ actuals: { currency: 'USD', as_of: '2026-10-14T00:00:00Z', total: '20.00',
      excludes_restricted_rows: false, categories: [
        { category: 'Labor', mapped: true, amount: '0.00' },
        { category: 'Materials', mapped: true, amount: '20.00' },
        { category: 'Equipment', mapped: false, amount: null },
      ] } });
    h.role = 'Project Manager';
    const view = render(<ProjectFinancesSection project={project} />);
    const categoryDisclosure = screen.getByText('Show category details').closest('details')!;
    expect(categoryDisclosure).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Show category details'));
    // A known zero is a computed figure and stays visible (no padded .00, bare under the section currency).
    expect(within(categoryDisclosure).getByText('0')).toBeInTheDocument();
    expect(within(categoryDisclosure).getByText('20')).toBeInTheDocument();
    expect(screen.queryByText('Spending setup details')).not.toBeInTheDocument();
    expect(screen.getByText('Partial coverage · 2 of 3 categories recorded')).toBeInTheDocument();
    view.unmount();

    h.role = 'Finance';
    const financeView = render(<ProjectFinancesSection project={project} />);
    expect(screen.getByTestId('spending-setup-prompt')).toHaveTextContent('Ask an administrator to complete spending setup.');
    expect(screen.queryByText('Spending setup details')).not.toBeInTheDocument();
    financeView.unmount();

    h.role = 'Admin';
    render(<MemoryRouter><ProjectFinancesSection project={project} /></MemoryRouter>);
    expect(within(screen.getByTestId('spending-setup-prompt')).getByRole('link', { name: 'Open spending setup' })).toHaveAttribute(
      'href', '/administration/accounting#budget-account-map',
    );
  });

  it('AC-1044-002 omits an empty category disclosure for delivery roles', () => {
    h.role = 'Engineer';
    h.query.data = payload({ actuals: { currency: 'USD', as_of: '2026-10-14T00:00:00Z', total: null,
      excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: false, amount: null }] } });
    render(<ProjectFinancesSection project={project} />);
    expect(screen.queryByText('Show category details')).not.toBeInTheDocument();
  });

  it('AC-1044-003 does not infer setup from a mapped category without a reading', () => {
    h.role = 'Admin';
    h.query.data = payload({ actuals: { currency: 'USD', as_of: null, total: null, excludes_restricted_rows: false,
      categories: [{ category: 'Labor', mapped: true, amount: null }] } });
    const { rerender } = render(<ProjectFinancesSection project={project} />);
    expect(screen.queryByRole('heading', { name: /Recorded spending/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('spending-setup-prompt')).not.toBeInTheDocument();
    expect(screen.queryByText('Spending setup details')).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();

    h.query.isPending = true;
    rerender(<ProjectFinancesSection project={project} />);
    expect(screen.getByText('Loading project finances…')).toBeInTheDocument();
    expect(screen.queryByTestId('spending-setup-prompt')).not.toBeInTheDocument();
    h.query.isPending = false;
    h.query.isError = true;
    rerender(<ProjectFinancesSection project={project} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load project finances.");
    expect(screen.queryByTestId('spending-setup-prompt')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.query.refetch).toHaveBeenCalledOnce();
  });

  it('UX-023/024/025 summarizes incomplete spending coverage and labels freshness without exposing repeated setup errors', () => {
    h.role = 'Finance';
    h.query.data = payload({
      actuals: { currency: 'USD', as_of: '2026-10-14T00:00:00Z', total: '50.00', excludes_restricted_rows: false, categories: [
        { category: 'Labor', mapped: true, amount: '50.00' },
        { category: 'Materials', mapped: false, amount: null },
        { category: 'Equipment', mapped: false, amount: null },
      ] },
    });
    render(<ProjectFinancesSection project={project} />);

    expect(screen.getByRole('heading', { name: /Recorded spending/ })).toBeInTheDocument();
    expect(screen.getByText('Partial coverage · 1 of 3 categories recorded')).toBeInTheDocument();
    expect(screen.getByText(/Updated Oct 14, 2026/)).toBeInTheDocument();
    // PD-C: no invoices → one line instead of cash/invoiced/remaining.
    expect(screen.getByTestId('project-no-invoices')).toBeInTheDocument();
    expect(screen.getByText('Ask an administrator to complete spending setup.')).toBeInTheDocument();
    expect(screen.queryByText('GL actuals')).not.toBeInTheDocument();
    expect(screen.getByText('Show category details')).toBeInTheDocument();
  });

  it('UX-024 gives setup managers a direct review path instead of a generic handoff', () => {
    h.role = 'Admin';
    h.query.data = payload({
      actuals: { currency: 'USD', as_of: null, total: '50.00', excludes_restricted_rows: false, categories: [
        { category: 'Labor', mapped: false, amount: null },
      ] },
    });
    render(<MemoryRouter><ProjectFinancesSection project={project} /></MemoryRouter>);

    expect(screen.getByRole('link', { name: 'Open spending setup' })).toHaveAttribute(
      'href', '/administration/accounting#budget-account-map',
    );
    expect(screen.queryByText('Ask an administrator to complete spending setup.')).not.toBeInTheDocument();
  });

  it('UX-032 explains settlement only when at least one settlement is known', () => {
    h.query.data = payload({ invoices: [
      { currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: '0.00', outstanding: '100.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '100.00', missing_work: 0 },
    ] });
    const { rerender } = render(<ProjectFinancesSection project={project} />);
    expect(screen.getByText('Settled')).not.toHaveAttribute('title');

    h.query.data = payload({ invoices: [
      { currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: '40.00', outstanding: '60.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '100.00', missing_work: 0 },
    ] });
    rerender(<ProjectFinancesSection project={project} />);
    expect(screen.getByText('Settled')).toHaveAttribute('title', expect.stringMatching(/Settled against invoices/));
  });

  it('AC-UWC-009/C4 the drill-down adds only other-currency cash, never a placeholder value, in both catalogues', async () => {
    if (!localeI18n.isInitialized) {
      await localeI18n.init({
        lng: 'en', fallbackLng: 'en', defaultNS: 'common', fallbackNS: 'common', ns: ['common', 'project', 'finance'],
        resources: { en: { common: enCatalogue, project: enProjectCatalogue, finance: enFinanceCatalogue }, id: { common: idCatalogue, project: idProjectCatalogue, finance: idFinanceCatalogue } },
        interpolation: { escapeValue: false }, react: { useSuspense: false },
      });
    }
    const readings: Array<{ cash: ProjectReceiptCash; kind: 'zero' | 'multi' | 'incomplete' | 'invalid' }> = [
      { cash: { state: 'known', buckets: [], receipt_count: 0 }, kind: 'zero' },
      { cash: { state: 'known', buckets: [
        { currency: 'USD', amount: '30.00' }, { currency: 'IDR', amount: '7.00' },
      ], receipt_count: 2 }, kind: 'multi' },
      { cash: { state: 'incomplete', buckets: [], receipt_count: 1, reasons: ['allocation-unreported'] }, kind: 'incomplete' },
      { cash: { state: 'unavailable', buckets: [], reason: 'invalid-reading' }, kind: 'invalid' },
    ];
    for (const language of ['en', 'id'] as const) {
      await localeI18n.changeLanguage(language);
      for (const reading of readings) {
        h.query.data = payload({
          cash_received: reading.cash,
          invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: '40.00', outstanding: '60.00',
            missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '90.00', missing_work: 0 }],
          actuals: { currency: 'USD', as_of: '2026-10-16T00:00:00Z', total: '120.00', excludes_restricted_rows: false,
            categories: [{ category: 'Labor', mapped: true, amount: '120.00' }] },
        });
        const view = render(<I18nextProvider i18n={localeI18n}><ProjectFinancesSection project={project} /></I18nextProvider>);
        const cashLabel = language === 'en' ? 'Cash received' : 'Kas diterima';
        expect(screen.getByText(language === 'en' ? 'Settled' : localeI18n.t('projectFinances.settled'))).toHaveAttribute('title', language === 'en'
          ? 'Settled against invoices (cash, withholding and credits), not cash received.'
          : 'Penyelesaian tagihan (kas, potongan pajak, dan kredit), bukan kas diterima.');
        if (reading.kind === 'multi') {
          // Project-currency cash belongs to Money position; only the other currency is added here, with its code.
          const cashField = screen.getByText(cashLabel, { exact: true }).parentElement!;
          expect(cashField).toHaveTextContent('IDR 7');
          expect(cashField).not.toHaveTextContent('30');
        } else {
          expect(screen.queryByText(cashLabel, { exact: true })).not.toBeInTheDocument();
        }
        expect(view.container).not.toHaveTextContent(/Unavailable|Tidak tersedia|Incomplete:|Belum lengkap:/);
        expect(await axe(view.container)).toHaveNoViolations();
        view.unmount();
      }
    }
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
    const invoicedValue = screen.getByText('1,234,567,891').closest('dd');
    expect(invoicedValue).not.toBeNull();
    expect(invoicedValue).toHaveClass('break-words');
    expect(invoicedValue?.tagName).toBe('DD');
    // Invoiced, Settled, Outstanding, Billed-work revenue and Margin remain semantic fields; C4 keeps an unknown margin explained.
    expect(within(bucket).getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Invoiced', 'Settled', 'Outstanding', 'Billed-work revenue', 'Margin',
    ]);
    expect(within(bucket).getByText('Margin').parentElement).toHaveTextContent(
      'Gross margin is left out until spending is linked for every budget category.',
    );
  });
});
