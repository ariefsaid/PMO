/** AC-ODR-010 (#2290): a customer receipt the ledger re-dated shows the ledger's date under the date the person entered. */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { receiptColumns } from './receiptColumns';
import { ReceiptCardTitle } from './ReceiptCardTitle';

afterEach(async () => { cleanup(); await financeTestI18n.changeLanguage('en'); setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }); });
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
  it('shows "Ledger date {date}" under the entered date, and the entered date stays', () => {
    dateCell(receipt({ erp_posting_date: '2026-12-01' }));
    expect(screen.getByTestId('ledger-date')).toHaveTextContent(/^Ledger date 1 Dec( 2026)? \(entered 3 Nov( 2026)?\)$/);
    expect(document.body).toHaveTextContent(/3 Nov/);
  });

  it('says it in Indonesian', async () => {
    await financeTestI18n.changeLanguage('id');
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    dateCell(receipt({ erp_posting_date: '2026-12-01' }));
    expect(screen.getByTestId('ledger-date')).toHaveTextContent(/^Tanggal buku besar 1 Des( 2026)? \(dimasukkan 3 Nov( 2026)?\)$/);
  });

  it('phone card: the line sits under the receipt number, on its own line', () => {
    const p = receipt({ erp_posting_date: '2026-12-01' });
    render(<FinanceI18nTestProvider><ReceiptCardTitle payment={p} number="RCP-01" /></FinanceI18nTestProvider>);
    expect(screen.getByText('RCP-01').nextElementSibling).toBe(screen.getByTestId('ledger-date'));
  });

  it('an unmoved or PMO-held receipt shows no ledger line', () => {
    dateCell(receipt({ erp_posting_date: '2026-11-03' }));
    expect(screen.queryByTestId('ledger-date')).toBeNull();
    cleanup();
    dateCell(receipt());
    expect(screen.queryByTestId('ledger-date')).toBeNull();
  });
});

describe('AC-ODR-010 receipt: "entered" shows only when it differs from the ledger date (#2290)', () => {
  it('(a) equal dates: one date, no entered wording; (b) different dates: the line carries the entered date', () => {
    dateCell(receipt({ erp_posting_date: '2026-11-03' }));
    expect(document.body).not.toHaveTextContent(/entered/i);
    cleanup();
    dateCell(receipt({ erp_posting_date: '2026-12-01' }));
    expect(screen.getByTestId('ledger-date')).toHaveTextContent(/entered 3 Nov/);
  });
});

describe('AC-ODR-010 the receipts date line stays on one line', () => {
  it('keeps the entered date whole (no-break spaces, nowrap) and the ledger date whole', () => {
    dateCell(receipt({ date: '2026-10-09', erp_posting_date: '2026-10-11' }));
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/9\u00a0Oct/);
    expect(text).toMatch(/11\u00a0Oct/);
    expect(text).not.toMatch(/\d{1,2} Oct/);
    const entered = Array.from(document.querySelectorAll('span.whitespace-nowrap')).find((e) => /9\u00a0Oct/.test(e.textContent ?? ''));
    expect(entered).toBeTruthy();
  });

  it('keeps Indonesian dates whole', async () => {
    await financeTestI18n.changeLanguage('id');
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    dateCell(receipt({ date: '2026-10-09', erp_posting_date: '2026-10-11' }));
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/11\u00a0Okt/);
    expect(text).not.toMatch(/\d{1,2} Okt/);
  });
});
