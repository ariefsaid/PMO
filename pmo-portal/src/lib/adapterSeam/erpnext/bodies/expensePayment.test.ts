import { describe, expect, it } from 'vitest';
import { mirrorMoney } from '../moneyShape';
import { expensePaymentFromDoc, expensePaymentToBody } from './expensePayment';

const ctx = { refs: {}, config: {} };
const base = { id: 'c1', company: 'PMO Smoke Co', posting_date: '2026-10-08', party: 'HR-EMP-00002' };

describe('expensePaymentToBody (AC-EXP-113)', () => {
  it('AC-EXP-113 claim payment: explicit paid_from/paid_to, Employee party, one reference to the approval journal', () => {
    expect(expensePaymentToBody({ ...base, erp_doc_kind: 'expense-payment', posting: 'claim-payment', payment_type: 'Pay',
      paid_from: 'Cash - PSC', paid_to: 'Employee Payable - PSC', paid_amount: '100.00', approval_journal: 'ACC-JV-2026-00002' }, ctx))
      .toEqual({
        company: 'PMO Smoke Co', posting_date: '2026-10-08', payment_type: 'Pay', party_type: 'Employee', party: 'HR-EMP-00002',
        paid_from: 'Cash - PSC', paid_to: 'Employee Payable - PSC', paid_amount: 100, received_amount: 100,
        reference_date: '2026-10-08',
        references: [{ reference_doctype: 'Journal Entry', reference_name: 'ACC-JV-2026-00002', allocated_amount: 100 }],
      });
  });

  it('AC-EXP-113 advance payment and advance return carry no reference; the return is Receive from the advance account', () => {
    const pay = expensePaymentToBody({ ...base, erp_doc_kind: 'expense-payment', posting: 'advance-payment', payment_type: 'Pay',
      paid_from: 'Cash - PSC', paid_to: 'Employee Advances - PSC', paid_amount: '200.00', approval_journal: null }, ctx) as Record<string, unknown>;
    expect(pay.references).toEqual([]);
    expect(pay.paid_to).toBe('Employee Advances - PSC');
    const ret = expensePaymentToBody({ ...base, erp_doc_kind: 'expense-receipt', posting: 'advance-return', payment_type: 'Receive',
      paid_from: 'Employee Advances - PSC', paid_to: 'Cash - PSC', paid_amount: '20.00', approval_journal: null }, ctx) as Record<string, unknown>;
    expect(ret).toMatchObject({ payment_type: 'Receive', paid_from: 'Employee Advances - PSC', paid_to: 'Cash - PSC', references: [] });
  });

  it('AC-EXP-113 refuses a direction that contradicts the kind, a missing account, or a zero amount', () => {
    const ok = { ...base, erp_doc_kind: 'expense-receipt', posting: 'advance-return', payment_type: 'Receive',
      paid_from: 'Employee Advances - PSC', paid_to: 'Cash - PSC', paid_amount: '20.00', approval_journal: null };
    expect(() => expensePaymentToBody({ ...ok, payment_type: 'Pay' }, ctx)).toThrow(/direction/);
    expect(() => expensePaymentToBody({ ...ok, erp_doc_kind: 'expense-payment' }, ctx)).toThrow(/direction/);
    expect(() => expensePaymentToBody({ ...ok, paid_to: '' }, ctx)).toThrow(/paid_to/);
    expect(() => expensePaymentToBody({ ...ok, paid_amount: '0.00' }, ctx)).toThrow(/amount/);
  });

  it('AC-EXP-113 fromDoc maps name, lifecycle, reference_no and the paid amount', () => {
    expect(expensePaymentFromDoc({ name: 'ACC-PAY-2026-00233', docstatus: 1, modified: 'm', amended_from: null, reference_no: 'expp:x', paid_amount: 100 }))
      .toEqual({ id: 'ACC-PAY-2026-00233', erp_name: 'ACC-PAY-2026-00233', erp_docstatus: 1, erp_modified: 'm', erp_amended_from: null, reference_number: 'expp:x', amount: mirrorMoney(100) });
  });
});
