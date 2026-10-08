/**
 * #910 (FR-VPAY-010, AC-VPAY-006) — on a flipped org the payment capture asks only for what PMO
 * owns: the bill (REQUIRED — DD-VPAY-3), the amount (defaulting to the bill's mirrored ERP
 * outstanding — DD-VPAY-10), the date and the optional PMO-side reference. It never offers a status
 * select (DD-VPAY-8: `{Pending,Processed,Cleared}` are illegal against the `('Scheduled','Paid')`
 * CHECK — every native form capture from this form fails today, 0178) and never asks for facts the
 * dispatch drops. On a PMO-native org the form is unchanged except that it submits `status: null`
 * (the native RPC coalesces `Scheduled`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// The org-tax read is unrelated to this kind; stub it like the groupRef/taxTemplate specs do.
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => undefined };
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { RecordCaptureForm, type CreatePaymentInput } from '../RecordCaptureForm';
import type { ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';
import { clearOwnershipCache, setDomainOwnership } from '@/src/lib/adapterSeam/ownershipCache';
import { FinanceI18nTestProvider } from '@/pages/__tests__/financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from '@/pages/__tests__/financeI18nTestInstance';
import { formatMoneyInputValue } from '@/src/lib/format';

afterEach(() => clearOwnershipCache());

const BILL: ProcurementInvoiceRow = {
  id: 'inv-1',
  vi_number: 'ACC-PINV-2026-00910',
  erp_outstanding_amount: 1090000,
} as unknown as ProcurementInvoiceRow;

function renderPayment(invoices: ProcurementInvoiceRow[] = [BILL]) {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  render(
    <FinanceI18nTestProvider>
      <ToastProvider>
        <RecordCaptureForm kind="payment" invoices={invoices} onCreate={onCreate} onClose={vi.fn()} />
      </ToastProvider>
    </FinanceI18nTestProvider>,
  );
  return onCreate;
}

describe('RecordCaptureForm — payment capture on a FLIPPED org (#910)', () => {
  beforeEach(async () => {
    await financeTestI18nReady;
    await financeTestI18n.changeLanguage('en');
    setDomainOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
  });

  it('no status select is offered (DD-VPAY-8)', () => {
    renderPayment();
    expect(screen.queryByTestId('payment-status-select')).not.toBeInTheDocument();
  });

  it('selecting the bill prefills the amount with its ERP outstanding 1,090,000 (DD-VPAY-10)', async () => {
    renderPayment();
    expect((screen.getByTestId('payment-amount-input') as HTMLInputElement).value).toBe('');
    await userEvent.selectOptions(screen.getByTestId('payment-invoice-select'), 'inv-1');
    expect((screen.getByTestId('payment-amount-input') as HTMLInputElement).value).toBe(formatMoneyInputValue(1090000));
  });

  it('shows the required-bill error in Indonesian', async () => {
    await financeTestI18n.changeLanguage('id');
    renderPayment();
    await userEvent.type(screen.getByTestId('payment-amount-input'), '1090000');
    await userEvent.click(screen.getByTestId('payment-save-btn'));
    expect(await screen.findByText('Pilih faktur vendor yang ditutup oleh pembayaran ini.')).toBeInTheDocument();
  });

  it('prefills and submits the exact outstanding amount in Indonesian number format', async () => {
    await financeTestI18n.changeLanguage('id');
    const onCreate = renderPayment();
    await userEvent.selectOptions(screen.getByTestId('payment-invoice-select'), 'inv-1');
    expect(screen.getByTestId('payment-amount-input')).toHaveValue(formatMoneyInputValue(1090000));
    await userEvent.click(screen.getByTestId('payment-save-btn'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 1090000 })));
  });

  it('submitting without a bill is refused locally — no dispatch call (DD-VPAY-3)', async () => {
    const onCreate = renderPayment();
    await userEvent.type(screen.getByTestId('payment-amount-input'), '1090000');
    await userEvent.click(screen.getByTestId('payment-save-btn'));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('submitting with the bill dispatches the defaulted amount (the user accepts the prefill)', async () => {
    const onCreate = renderPayment();
    await userEvent.selectOptions(screen.getByTestId('payment-invoice-select'), 'inv-1');
    await userEvent.click(screen.getByTestId('payment-save-btn'));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    const input = onCreate.mock.calls[0][0] as CreatePaymentInput;
    expect(input).toMatchObject({ invoiceId: 'inv-1', amount: 1090000, status: null });
  });

  it('the optional PMO-side reference still rides along (OQ-VPAY-4: PMO-side only, the dispatch drops it)', async () => {
    const onCreate = renderPayment();
    await userEvent.selectOptions(screen.getByTestId('payment-invoice-select'), 'inv-1');
    await userEvent.type(screen.getByTestId('payment-ref-input'), 'BANK-MEMO-1');
    await userEvent.click(screen.getByTestId('payment-save-btn'));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({ referenceNumber: 'BANK-MEMO-1' });
  });
});

describe('RecordCaptureForm — payment capture on a PMO-NATIVE org (#910 DD-VPAY-8)', () => {
  it('the form renders as today (minus the illegal status select) and submits status: null — never Pending', async () => {
    // Cold ownership map: PMO-owned.
    const onCreate = renderPayment();
    expect(screen.queryByTestId('payment-status-select')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByTestId('payment-invoice-select'), 'inv-1');
    await userEvent.type(screen.getByTestId('payment-amount-input'), '500');
    await userEvent.click(screen.getByTestId('payment-save-btn'));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    const input = onCreate.mock.calls[0][0] as CreatePaymentInput;
    expect(input.status).toBeNull();
    expect(input.amount).toBe(500);
  });

  it('a native org still treats the bill as OPTIONAL (nullable invoice_id settlement predecessor)', async () => {
    const onCreate = renderPayment();
    await userEvent.type(screen.getByTestId('payment-amount-input'), '500');
    await userEvent.click(screen.getByTestId('payment-save-btn'));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({ invoiceId: null, amount: 500 });
  });
});
