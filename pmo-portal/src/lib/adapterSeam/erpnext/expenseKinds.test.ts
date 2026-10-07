import { describe, expect, it } from 'vitest';
import { DOCTYPE_REGISTRY, reissueOnInconclusiveAbsence } from './doctypeRegistry';
import {
  KIND_DOMAIN, KIND_MIRROR_TABLE, kindFromDoctype, kindFromDoctypeAndPaymentType, pollDiscriminatorForKind, sweepKindsForOrg,
} from './feedKinds';
import { isCompanyScopedKind } from './companyScope';
import { ERPNEXT_EXPENSES_DOMAIN } from './adapter';
import { DOCTYPE_BODIES } from './doctypeBodies';
import { decodeErpWebhookEvent } from './webhookEvent';
import { terminalApplyReason } from './feedErrorPolicy';

const KINDS = ['expense-journal', 'expense-payment', 'expense-receipt'] as const;
const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';

describe('expense kinds (AC-EXP-114)', () => {
  it('AC-EXP-114 registers the three kinds with doctype, anchor and reissue policy', () => {
    expect(DOCTYPE_REGISTRY['expense-journal']).toEqual({
      doctype: 'Journal Entry', submittable: true, submitOnCreate: true, anchorField: 'user_remark', anchorMutable: false,
    });
    expect(reissueOnInconclusiveAbsence(DOCTYPE_REGISTRY['expense-journal'])).toBe(true);
    for (const kind of ['expense-payment', 'expense-receipt'] as const) {
      expect(DOCTYPE_REGISTRY[kind]).toEqual({ doctype: 'Payment Entry', submittable: true, anchorField: 'reference_no', anchorMutable: true });
      expect(reissueOnInconclusiveAbsence(DOCTYPE_REGISTRY[kind])).toBe(false);
    }
    for (const kind of KINDS) expect(DOCTYPE_BODIES[kind]).toBeDefined();
  });

  it('AC-EXP-114 maps them to the expenses domain, the side mirror and the company scope', () => {
    expect(ERPNEXT_EXPENSES_DOMAIN).toBe('expenses');
    for (const kind of KINDS) {
      expect(KIND_DOMAIN[kind]).toBe('expenses');
      expect(KIND_MIRROR_TABLE[kind]).toBe('expense_posting_erp_mirror');
      expect(isCompanyScopedKind(kind)).toBe(true);
    }
  });

  it('AC-EXP-114 leaves the Payment Entry reverse lookup as it was and routes Employee entries by party type', () => {
    expect(kindFromDoctype('Payment Entry')).toBe('incoming-payment');
    expect(kindFromDoctype('Journal Entry')).toBe('expense-journal');
    expect(kindFromDoctypeAndPaymentType('Payment Entry', 'Pay')).toBe('payment');
    expect(kindFromDoctypeAndPaymentType('Payment Entry', 'Receive')).toBe('incoming-payment');
    expect(kindFromDoctypeAndPaymentType('Payment Entry', 'Pay', 'Supplier')).toBe('payment');
    expect(kindFromDoctypeAndPaymentType('Payment Entry', 'Pay', 'Employee')).toBe('expense-payment');
    expect(kindFromDoctypeAndPaymentType('Payment Entry', 'Receive', 'Employee')).toBe('expense-receipt');
  });

  it('AC-EXP-114 an org employing only expenses also polls the Employee master', () => {
    const kinds = sweepKindsForOrg(['expenses']).map((k) => k.kind).sort();
    expect(kinds).toEqual(['employee', 'expense-journal', 'expense-payment', 'expense-receipt']);
    expect(sweepKindsForOrg(['revenue']).map((k) => k.kind)).not.toContain('employee');
  });

  it('AC-EXP-114 poll discriminators keep Employee entries out of procurement/revenue and native journals out of expenses', () => {
    const pay = pollDiscriminatorForKind('payment')!;
    expect(pay.filters).toEqual([['party_type', '!=', 'Employee']]);
    expect(pay.admits({ party_type: 'Supplier' })).toBe(true);
    expect(pay.admits({ party_type: 'Employee' })).toBe(false);
    expect(pollDiscriminatorForKind('incoming-payment')!.admits({ party_type: 'Employee' })).toBe(false);
    const exp = pollDiscriminatorForKind('expense-payment')!;
    expect(exp.filters).toEqual([['party_type', '=', 'Employee']]);
    expect(exp.admits({ party_type: 'Supplier' })).toBe(false);
    const je = pollDiscriminatorForKind('expense-journal')!;
    expect(je.filters).toEqual([['user_remark', 'like', 'exp%']]);
    expect(je.fields).toEqual(['user_remark']);
    expect(je.admits({ user_remark: `expj:${CLAIM}:1791367200123` })).toBe(true);
    expect(je.admits({ user_remark: 'expense reclass' })).toBe(false);
    expect(pollDiscriminatorForKind('sales-invoice')).toBeNull();
  });

  it('AC-EXP-114 a Payment Entry without party_type is not adopted by procurement or revenue', () => {
    for (const kind of ['payment', 'incoming-payment'] as const) {
      const d = pollDiscriminatorForKind(kind)!;
      expect(d.admits({})).toBe(false);
      expect(d.admits({ party_type: null })).toBe(false);
      expect(d.admits({ party_type: '' })).toBe(false);
      expect(d.admits({ party_type: 'Customer' })).toBe(true);
    }
  });
});

describe('expense kinds inbound (AC-EXP-114)', () => {
  it('AC-EXP-114 a webhook for an Employee Payment Entry decodes to the expense kind; a Customer/Supplier one is unchanged', () => {
    expect(decodeErpWebhookEvent({ doctype: 'Payment Entry', name: 'PE-9', payment_type: 'Receive', party_type: 'Employee' })?.kind)
      .toBe('expense-receipt');
    expect(decodeErpWebhookEvent({ doctype: 'Payment Entry', name: 'PE-7', doc: { payment_type: 'Pay', party_type: 'Employee' } })?.kind)
      .toBe('expense-payment');
    expect(decodeErpWebhookEvent({ doctype: 'Payment Entry', name: 'PE-8', payment_type: 'Receive', party_type: 'Customer' })?.kind)
      .toBe('incoming-payment');
    expect(decodeErpWebhookEvent({ doctype: 'Payment Entry', name: 'PE-6', payment_type: 'Pay' })?.kind).toBe('payment');
  });
  it('AC-EXP-114 the never-adopt code is terminal (acked, not retried)', () => {
    expect(terminalApplyReason({ code: 'native-expense-posting-not-adopted' })).toBe('native-expense-posting-not-adopted');
  });
});
