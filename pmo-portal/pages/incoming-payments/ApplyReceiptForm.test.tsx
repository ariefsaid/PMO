import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import { AppError } from '@/src/lib/appError';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { ApplyReceiptForm } from './ApplyReceiptForm';
import { applicableInvoices } from './applicableInvoices';

const receipt = { id: 'rc-1', customer_id: 'cust-1', currency: 'IDR', amount: 100, pmo_native: true } as unknown as IncomingPaymentRow;
const invoice = (id: string, over: Record<string, unknown> = {}) => ({
  id, customer_id: 'cust-1', pmo_number: `INV-${id}`, si_number: null, pmo_native: true, status: 'Unpaid',
  erp_outstanding_amount: 60, currency: 'IDR', ...over,
}) as unknown as SalesInvoiceRow;

const setup = (invoices: SalesInvoiceRow[], onApply = vi.fn(async () => undefined), unapplied = 100) => {
  render(
    <FinanceI18nTestProvider>
      <ApplyReceiptForm receipt={receipt} unapplied={unapplied} invoices={invoices} onApply={onApply} onClose={vi.fn()} />
    </FinanceI18nTestProvider>,
  );
  return { onApply, user: userEvent.setup() };
};

beforeEach(async () => {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  await financeTestI18n.changeLanguage('en');
});
afterEach(() => resetActiveLocale());

async function chooseInvoice(user: ReturnType<typeof userEvent.setup>, index: number, name: RegExp) {
  await user.click(screen.getAllByRole('combobox', { name: /Invoice/ })[index]);
  await user.click(await screen.findByRole('option', { name }));
}

describe('applicableInvoices (#1415 D7) — which invoices a PMO receipt can take', () => {
  it('AC-NPA-004 keeps only the receipt\'s customer, PMO-native, approved, same-currency, still-owing invoices', () => {
    const all = [
      invoice('ok'), invoice('other-customer', { customer_id: 'cust-2' }), invoice('erp', { pmo_native: false }),
      invoice('draft', { status: 'Draft' }), invoice('paid', { status: 'Paid', erp_outstanding_amount: 0 }),
      invoice('usd', { currency: 'USD' }), invoice('nothing-owed', { erp_outstanding_amount: 0 }),
    ];
    expect(applicableInvoices(receipt, all).map((i) => i.id)).toEqual(['ok']);
  });
});

describe('ApplyReceiptForm (#1415)', () => {
  it('AC-NPA-002 applies across two invoices: each row names its invoice and amount, with the form session\'s request id', async () => {
    const { onApply, user } = setup([invoice('a', { erp_outstanding_amount: 60 }), invoice('b', { erp_outstanding_amount: 100 })]);
    await chooseInvoice(user, 0, /INV-a/);
    await user.click(screen.getByRole('button', { name: 'Fill balance' }));
    expect(screen.getByLabelText('Amount')).toHaveValue('60');
    await user.click(screen.getByRole('button', { name: 'Add another invoice' }));
    await chooseInvoice(user, 1, /INV-b/);
    await user.click(screen.getAllByRole('button', { name: 'Fill balance' })[1]);
    // The second row is capped by what the receipt has left (100 - 60 = 40), not the invoice's 100.
    expect(screen.getAllByLabelText('Amount')[1]).toHaveValue('40');
    expect(screen.getByText(/Left to apply: .*0\.00/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith([{ invoiceId: 'a', amount: 60 }, { invoiceId: 'b', amount: 40 }], expect.any(String));
  });

  it('AC-NPA-003 more than the receipt has left disables Apply and says so; the server refuses regardless', async () => {
    const { onApply, user } = setup([invoice('a', { erp_outstanding_amount: 500 })]);
    await chooseInvoice(user, 0, /INV-a/);
    await user.type(screen.getByLabelText('Amount'), '150');
    expect(screen.getAllByText('This is more than the payment has left to apply.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('AC-NPA-003 more than the invoice owes is refused before the round trip, naming the balance', async () => {
    const { onApply, user } = setup([invoice('a', { erp_outstanding_amount: 60 })]);
    await chooseInvoice(user, 0, /INV-a/);
    await user.type(screen.getByLabelText('Amount'), '61');
    expect(screen.getByText(/more than the invoice still owes .*60\.00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('AC-NPA-003 an empty form cannot be applied', () => {
    setup([invoice('a')]);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('AC-NPA-003 an invoice chosen on one row is not offered again on another', async () => {
    const { user } = setup([invoice('a'), invoice('b')]);
    await chooseInvoice(user, 0, /INV-a/);
    await user.click(screen.getByRole('button', { name: 'Add another invoice' }));
    await user.click(screen.getAllByRole('combobox', { name: /Invoice/ })[1]);
    const list = await screen.findByRole('listbox');
    expect(within(list).queryByRole('option', { name: /INV-a/ })).toBeNull();
    expect(within(list).getByRole('option', { name: /INV-b/ })).toBeInTheDocument();
  });

  it('AC-NPA-012 a server refusal shows its headline in the dialog, keeps the entries, and a retry reuses the request id', async () => {
    const onApply = vi.fn()
      .mockRejectedValueOnce(new AppError('more than the receipt has left to apply', 'allocation-exceeds-unapplied'))
      .mockResolvedValueOnce(undefined);
    const { user } = setup([invoice('a', { erp_outstanding_amount: 60 })], onApply);
    await chooseInvoice(user, 0, /INV-a/);
    await user.type(screen.getByLabelText('Amount'), '50');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByTestId('entity-modal-save-error')).toHaveTextContent('This is more than the payment has left to apply.');
    expect(screen.getByLabelText('Amount')).toHaveValue('50');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(onApply.mock.calls[1][1]).toBe(onApply.mock.calls[0][1]);
  });

  it('AC-NPA-012 the refusal headline is in the user\'s language', async () => {
    await financeTestI18n.changeLanguage('id');
    const onApply = vi.fn().mockRejectedValue(new AppError('x', 'allocation-currency-mismatch'));
    const { user } = setup([invoice('a', { erp_outstanding_amount: 60 })], onApply);
    await user.click(screen.getAllByRole('combobox')[0]);
    await user.click(await screen.findByRole('option', { name: /INV-a/ }));
    await user.type(screen.getAllByRole('textbox').at(-1)!, '10');
    await user.click(screen.getByRole('button', { name: financeTestI18n.t('finance:receipts.apply.submit') }));
    expect(await screen.findByTestId('entity-modal-save-error')).toHaveTextContent(financeTestI18n.t('finance:receipts.refusal.allocationCurrencyMismatch'));
    expect(financeTestI18n.t('finance:receipts.refusal.allocationCurrencyMismatch')).not.toBe('That invoice is in a different currency.');
  });

  it('AC-NPA-004 a customer with no open invoice in the receipt\'s currency is told so', () => {
    setup([invoice('usd', { currency: 'USD' })]);
    expect(screen.getByText(/no approved invoice in IDR that still owes money/)).toBeInTheDocument();
  });
});
