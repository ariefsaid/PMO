import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentCaptureFields } from './PaymentCaptureFields';

const invoices = [
  { id: 'inv-1', reference_number: 'B-1', vi_number: 'VI-1', invoice_date: '2026-01-02', erp_outstanding_amount: '1090000' },
  { id: 'inv-2', reference_number: 'B-2', vi_number: 'VI-2', invoice_date: '2026-01-03', erp_outstanding_amount: null },
] as never;

const setup = (paymentBillRequired: boolean) => {
  const onSelect = vi.fn();
  const onOutstandingAmount = vi.fn();
  render(<PaymentCaptureFields formId="f" invoices={invoices} paymentBillRequired={paymentBillRequired} odooProcurement={false}
    invoiceId="" billError={undefined} onSelect={onSelect} onOutstandingAmount={onOutstandingAmount} />);
  return { onSelect, onOutstandingAmount };
};

describe('PaymentCaptureFields', () => {
  it('defaults the amount to the bill outstanding when the bill is required (flipped org)', async () => {
    const { onSelect, onOutstandingAmount } = setup(true);
    await userEvent.selectOptions(screen.getByTestId('payment-invoice-select'), 'inv-1');
    expect(onSelect).toHaveBeenCalledWith('inv-1');
    expect(onOutstandingAmount).toHaveBeenCalledTimes(1);
    expect(onOutstandingAmount.mock.calls[0][0]).toMatch(/1.?090.?000/);
  });

  it('does not touch the amount on a native org, and when the bill has no outstanding', async () => {
    const native = setup(false);
    await userEvent.selectOptions(screen.getByTestId('payment-invoice-select'), 'inv-1');
    expect(native.onSelect).toHaveBeenCalledWith('inv-1');
    expect(native.onOutstandingAmount).not.toHaveBeenCalled();
  });
});
