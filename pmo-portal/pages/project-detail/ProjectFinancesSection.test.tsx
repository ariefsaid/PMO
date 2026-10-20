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
import { formatExactMoney, type ProjectFinances, type ProjectReceiptCash } from '@/src/lib/projectFinances';

const h = vi.hoisted(() => ({
  query: {
    data: undefined as ProjectFinances | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  },
  role: 'Project Manager' as 'Admin' | 'Finance' | 'Project Manager' | 'Engineer' | 'Executive',
  effectiveRole: 'Project Manager' as 'Admin' | 'Finance' | 'Project Manager' | 'Engineer' | 'Executive',
  commitments: { data: 75, isPending: false, isError: false, commitmentSource: 'not-tracked' as const, ledgerBasis: 'erp' as 'erp' | 'pmo' | 'unavailable' },
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProjectCommittedSpend: () => h.commitments }));
vi.mock('@/src/hooks/useProjectFinances', () => ({ useProjectFinances: () => h.query }));
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
  h.role = 'Project Manager';
  h.effectiveRole = 'Project Manager';
  h.commitments = { data: 75, isPending: false, isError: false, commitmentSource: 'not-tracked', ledgerBasis: 'erp' };
});

describe('ProjectFinancesSection reading states', () => {
  it('AC-PFIN-015 renders the finance section from translated English and Indonesian catalogues without raw keys', async () => {
    await localeI18n.init({
      lng: 'en', fallbackLng: 'en', defaultNS: 'common', ns: ['common', 'project'],
      resources: { en: { common: enCatalogue, project: enProjectCatalogue }, id: { common: idCatalogue, project: idProjectCatalogue } },
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
    expect(screen.getByText("Spending hasn't been updated yet.")).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('PD-C: with invoices, unknown cash is a dash with its reason in the title, settlement and billed-work qualifiers move into titles', () => {
    h.query.data = payload({ invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: '40.00', outstanding: '60.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '90.00', missing_work: 0 }] });
    render(<ProjectFinancesSection project={project} />);
    const cash = screen.getByText('Cash received', { exact: true }).parentElement!;
    const cashValue = cash.querySelector('dd')!;
    expect(cashValue).toHaveTextContent('—');
    expect(cashValue).toHaveAttribute('title', 'Unavailable — receipt-backed cash data is not available yet');
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

  it('AC-PFIN-015 shows unavailable category detail in plain words, not system terms (#1045)', () => {
    h.role = 'Finance';
    h.query.data = payload({
      actuals: { currency: 'IDR', as_of: '2026-10-16T00:00:00Z', total: null, excludes_restricted_rows: false,
        categories: [{ category: 'Labor', mapped: false, amount: null }] },
    });
    render(<ProjectFinancesSection project={project} />);
    fireEvent.click(screen.getByText('Spending setup details'));
    expect(screen.getByText('Labor — Spending setup is not complete for this category.')).toBeInTheDocument();
    expect(screen.queryByText('Show category details')).not.toBeInTheDocument();
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
    expect(idr.getAllByText('Invoice balance is not available yet')).toHaveLength(2);
    expect(idr.getByText('Mixed tax bases')).toBeInTheDocument();
    expect(eur.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.getAllByText('Settled')[0]).toHaveAttribute('title', 'Settled against invoices (cash, withholding and credits), not cash received.');
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
        const setupLink = within(promptRegion!).getByRole('link', { name: 'Finish spending setup' });
        expect(setupLink).toHaveAttribute('href', '/administration/accounting#budget-account-map');
        expect(setupLink).toHaveClass('text-primary-text');
        expect(screen.queryByText('Ask an administrator to finish spending setup.')).not.toBeInTheDocument();
      } else if (prompt === 'handoff') {
        expect(promptRegion).toHaveTextContent('Ask an administrator to finish spending setup.');
        expect(within(promptRegion!).queryByRole('link')).not.toBeInTheDocument();
      } else expect(promptRegion).not.toBeInTheDocument();
      expect(screen.queryAllByTestId('spending-setup-prompt')).toHaveLength(prompt ? 1 : 0);
      view.unmount();
    }
  });

  it('AC-1044-001 localizes the setup handoff and invoice scope in both catalogues', async () => {
    if (!localeI18n.isInitialized) {
      await localeI18n.init({ lng: 'en', fallbackLng: 'en', defaultNS: 'common', ns: ['common', 'project'],
        resources: { en: { common: enCatalogue, project: enProjectCatalogue }, id: { common: idCatalogue, project: idProjectCatalogue } },
        interpolation: { escapeValue: false }, react: { useSuspense: false } });
    }
    h.role = 'Finance';
    h.query.data = payload({ invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: '40.00', outstanding: '60.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '90.00', missing_work: 0 }], actuals: { currency: 'USD', as_of: '2026-10-14T00:00:00Z', total: null,
      excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: false, amount: null }] } });
    for (const [language, prompt, scope] of [
      ['en', 'Ask an administrator to finish spending setup.', 'Only invoices linked to this project are included.'],
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

  it('AC-1044-002 keeps known zero/positive readings available and limits setup detail to Finance/Admin', () => {
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
    expect(within(categoryDisclosure).getByText('$0.00')).toBeInTheDocument();
    expect(within(categoryDisclosure).getByText('$20.00')).toBeInTheDocument();
    expect(screen.queryByText('Spending setup details')).not.toBeInTheDocument();
    expect(screen.getByText('Partial coverage · 2 of 3 categories recorded')).toBeInTheDocument();
    view.unmount();

    h.role = 'Finance';
    const financeView = render(<ProjectFinancesSection project={project} />);
    const setup = screen.getByText('Spending setup details').closest('details')!;
    expect(setup).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Spending setup details'));
    expect(within(setup).getByText(/Equipment — Spending setup is not complete for this category/)).toBeInTheDocument();
    financeView.unmount();

    h.role = 'Admin';
    render(<MemoryRouter><ProjectFinancesSection project={project} /></MemoryRouter>);
    const adminSetup = screen.getByText('Spending setup details').closest('details')!;
    fireEvent.click(screen.getByText('Spending setup details'));
    expect(within(adminSetup).getByText(/Equipment — Spending setup is not complete for this category/)).toBeInTheDocument();
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
    expect(screen.getByText("Spending hasn't been updated yet.")).toBeInTheDocument();
    expect(screen.queryByTestId('spending-setup-prompt')).not.toBeInTheDocument();
    const readingDetails = screen.getByText('Spending setup details').closest('details')!;
    fireEvent.click(screen.getByText('Spending setup details'));
    expect(within(readingDetails).getByText('Labor — Spending hasn\'t been updated yet.')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();

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

    expect(screen.getByText('Recorded spending')).toBeInTheDocument();
    expect(screen.getByText('Partial coverage · 1 of 3 categories recorded')).toBeInTheDocument();
    expect(screen.getByText(/Updated Oct 14, 2026/)).toBeInTheDocument();
    // PD-C: no invoices → one line instead of cash/invoiced/remaining.
    expect(screen.getByTestId('project-no-invoices')).toBeInTheDocument();
    expect(screen.getByText('Ask an administrator to finish spending setup.')).toBeInTheDocument();
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

    expect(screen.getByRole('link', { name: 'Finish spending setup' })).toHaveAttribute(
      'href', '/administration/accounting#budget-account-map',
    );
    expect(screen.queryByText('Ask an administrator to finish spending setup.')).not.toBeInTheDocument();
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
    expect(screen.getByText('Cash received')).toBeInTheDocument();
  });

  it('AC-UWC-009 renders known, incomplete, and invalid cash honestly in both catalogues without disturbing settlement or Actuals', async () => {
    if (!localeI18n.isInitialized) {
      await localeI18n.init({
        lng: 'en', fallbackLng: 'en', defaultNS: 'common',
        resources: { en: { common: enCatalogue }, id: { common: idCatalogue } },
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
        const scope = language === 'en' ? "Receipt cash linked to this project's invoices" : 'Kas kuitansi yang tertaut ke faktur proyek ini';
        const cashField = screen.getByText(cashLabel, { exact: true }).parentElement!;
        expect(cashField).not.toBeNull();
        expect(cashField).toHaveTextContent(scope);
        expect(screen.getByText(language === 'en' ? 'Settled' : localeI18n.t('projectFinances.settled'))).toHaveAttribute('title', language === 'en'
          ? 'Settled against invoices (cash, withholding and credits), not cash received.'
          : 'Penyelesaian tagihan (kas, potongan pajak, dan kredit), bukan kas diterima.');
        expect(screen.getAllByText(formatExactMoney('120.00', 'USD', language)!)).not.toHaveLength(0);

        if (reading.kind === 'zero') {
          expect(cashField).toHaveTextContent(formatExactMoney('0.00', 'USD', language)!);
        } else if (reading.kind === 'multi') {
          expect(cashField).toHaveTextContent(formatExactMoney('30.00', 'USD', language)!);
          expect(cashField).toHaveTextContent(formatExactMoney('7.00', 'IDR', language)!.replace(/\u00a0/g, ' '));
        } else if (reading.kind === 'incomplete') {
          expect(cashField).toHaveTextContent(language === 'en'
            ? 'Incomplete — receipt allocation cannot establish cash'
            : 'Belum lengkap — alokasi kuitansi belum dapat memastikan kas');
        } else {
          expect(cashField).toHaveTextContent(language === 'en'
            ? 'Unavailable — receipt-backed cash data could not be verified'
            : 'Tidak tersedia — data kas berbasis kuitansi tidak dapat diverifikasi');
        }
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
    const invoicedValue = screen.getByText('$1,234,567,890.55').closest('dd');
    expect(invoicedValue).not.toBeNull();
    expect(invoicedValue).toHaveClass('break-words');
    expect(invoicedValue?.tagName).toBe('DD');
    expect(within(bucket).getAllByRole('term')).toHaveLength(5);
  });
});
