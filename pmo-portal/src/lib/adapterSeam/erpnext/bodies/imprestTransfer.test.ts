import { describe, expect, it } from 'vitest';
import { AdapterError } from '../../contract';
import { imprestTransferToBody } from './imprestTransfer';

const ctx = { refs: {}, config: {} };
const rec = {
  id: '15150000-0000-0000-0000-0000000000e3', erp_doc_kind: 'imprest-transfer', company: 'PMO Smoke Co',
  idempotency_key: 'impt:15150000-0000-0000-0000-0000000000e3:1791367200123', from_account: 'Bank - PSC',
  to_account: 'Site Cash F - PSC', amount: '800000.00', posting_date: '2026-11-01', reference: 'REP-2611010003',
};

describe('imprestTransferToBody (AC-IMP-072)', () => {
  it('AC-IMP-072 the body has exactly two rows, no party, balanced', () => {
    const body = imprestTransferToBody(rec, ctx) as { accounts: Array<Record<string, unknown>>; voucher_type: string; company: string };
    expect(body.company).toBe('PMO Smoke Co');
    expect(body.voucher_type).toBe('Bank Entry');
    expect(body.accounts).toEqual([
      { account: 'Site Cash F - PSC', debit_in_account_currency: 800000 },
      { account: 'Bank - PSC', credit_in_account_currency: 800000 },
    ]);
    expect(body.accounts.some((row) => 'party' in row || 'party_type' in row)).toBe(false);
    expect(body).toMatchObject({ cheque_no: 'REP-2611010003', cheque_date: '2026-11-01', posting_date: '2026-11-01' });
  });

  it('AC-IMP-072 equal accounts, a bad amount or a bad key are commit-rejected', () => {
    for (const bad of [{ to_account: 'Bank - PSC' }, { amount: '0.00' }, { amount: '12' }, { amount: '1.5' }, { idempotency_key: 'exp:1' }, { posting_date: '01/11/2026' }]) {
      expect(() => imprestTransferToBody({ ...rec, ...bad }, ctx)).toThrow(AdapterError);
    }
  });
});
