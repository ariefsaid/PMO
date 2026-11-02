import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FinanceI18nTestProvider } from '@/pages/__tests__/financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from '@/pages/__tests__/financeI18nTestInstance';
import { VendorInvoiceIdentity } from './VendorInvoiceIdentity';
import { vendorInvoiceIdentityAccessibleLabel } from './vendorInvoiceIdentityLabels';

describe('supplier invoice recognition identity', () => {
  it.each(['en', 'id'] as const)('#1463 renders the supplier invoice number as recorded in accounting in %s without an ID fallback', async (locale) => {
    await financeTestI18nReady;
    await financeTestI18n.changeLanguage(locale);
    render(<FinanceI18nTestProvider><VendorInvoiceIdentity
      referenceNumber="SUP-REF-2026-771"
      viNumber="VI-2609-0017"
      invoiceDate="2026-09-18"
      context={{ state: 'ready', caseTitle: 'Bridge renewal · phase B', projectName: 'Harbor works', pmoProjectNumber: 'PRJ-2641' }}
    /></FinanceI18nTestProvider>);
    expect(screen.getByText(locale === 'en' ? 'Supplier invoice reference: SUP-REF-2026-771' : 'Referensi faktur pemasok: SUP-REF-2026-771')).toBeInTheDocument();
    expect(screen.getByText(locale === 'en' ? 'Supplier invoice no. (accounting): VI-2609-0017' : 'No. faktur pemasok (akuntansi): VI-2609-0017')).toBeInTheDocument();
    expect(document.body).toHaveTextContent('VI-2609-0017');
    expect(document.body).toHaveTextContent('Bridge renewal · phase B');
    expect(document.body).toHaveTextContent('Harbor works');
    expect(document.body).toHaveTextContent('PRJ-2641');

    const missing = render(<FinanceI18nTestProvider><VendorInvoiceIdentity
      referenceNumber={null} viNumber={null} invoiceDate={null}
      context={{ state: 'unavailable' }}
    /></FinanceI18nTestProvider>);
    expect(missing.container).toHaveTextContent(locale === 'en' ? 'Supplier invoice reference not recorded' : 'Referensi faktur pemasok belum dicatat');
    expect(missing.container).toHaveTextContent(locale === 'en' ? 'Supplier invoice no. (accounting) unavailable' : 'No. faktur pemasok (akuntansi) tidak tersedia');
    expect(missing.container).not.toHaveTextContent('invoice-uuid');
  });

  it('AC-UXT-001 exposes the complete distinguishing hierarchy in the accessible label', async () => {
    await financeTestI18nReady;
    await financeTestI18n.changeLanguage('en');
    const label = vendorInvoiceIdentityAccessibleLabel({
      referenceNumber: 'DUPLICATE-REF', viNumber: 'VI-17', invoiceDate: '2026-09-18',
      context: { state: 'ready', caseTitle: 'Case North', projectName: 'Harbor works', pmoProjectNumber: 'PRJ-2641' },
      t: financeTestI18n.t.bind(financeTestI18n),
    });
    expect(label).toContain('Supplier invoice reference: DUPLICATE-REF');
    expect(label).toContain('Supplier invoice no. (accounting): VI-17');
    expect(label).toContain('Case: Case North');
    expect(label).toContain('Project: Harbor works');
    expect(label).toContain('PRJ-2641');
    expect(label).toContain('Bill date: 2026-09-18');
    expect(label).not.toContain('invoice-uuid');
  });
});
