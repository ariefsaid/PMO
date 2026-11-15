/** AC-ODR-010 (#2290): a customer receipt the ledger re-dated shows the ledger's date under the date the person entered. */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { receiptColumns } from './receiptColumns';

afterEach(async () => { cleanup(); await financeTestI18n.changeLanguage('en'); });
const receipt = (overrides: Partial<IncomingPaymentRow> = {}): IncomingPaymentRow => ({
  id: 'receipt-1', org_id: 'org-1', customer_id: null, customer_name: 'Example customer',
  sales_invoice_id: null, ip_number: 'RCP-01', reference_number: null, date: '2026-11-03',
  amount: 123.45, currency: 'IDR', status: 'Paid', erp_docstatus: 1, erp_modified: null,
  erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-11-03T00:00:00Z',
  ...overrides,
});
function dateCell(p: IncomingPaymentRow) {
  const { exportColumns } = receiptColumns({
    t: financeTestI18n.t, embedded: false, odoo: true, invoiceNumberById: new Map(),
    location: { pathname: '/incoming-payments', search: '', hash: '', state: null, key: 'test' },
  });
  const column = exportColumns.find((c) => c.key === 'date')!;
  return render(<FinanceI18nTestProvider>{column.cell(p)}</FinanceI18nTestProvider>);
}

describe('AC-ODR-010 a receipt the ledger re-dated shows the ledger date', () => {
  it('shows "Ledger: {date}" under the entered date, and the entered date stays', () => {
    dateCell(receipt({ erp_posting_date: '2026-12-01' }));
    expect(screen.getByTestId('ledger-date')).toHaveTextContent(/^Ledger: .*2026/);
    expect(document.body).toHaveTextContent(/3.*2026/);
  });

  it('says it in Indonesian', async () => {
    await financeTestI18n.changeLanguage('id');
    dateCell(receipt({ erp_posting_date: '2026-12-01' }));
    expect(screen.getByTestId('ledger-date')).toHaveTextContent(/^Buku besar: .*2026/);
  });

  it('an unmoved or PMO-held receipt shows no ledger line', () => {
    dateCell(receipt({ erp_posting_date: '2026-11-03' }));
    expect(screen.queryByTestId('ledger-date')).toBeNull();
    cleanup();
    dateCell(receipt());
    expect(screen.queryByTestId('ledger-date')).toBeNull();
  });
});
