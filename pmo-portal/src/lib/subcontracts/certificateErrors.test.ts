import { describe, it, expect } from 'vitest';
import { certificateErrorKey, certificateErrorMessage } from './certificateErrors';

/** #2584: a refusal from the certificate functions is named, never shown as a raw Postgres code. */
describe('certificate refusals', () => {
  it('names the separation-of-duties refusal', () => {
    expect(certificateErrorKey({ code: '42501', details: 'needs-different-approver' })).toBe('needsDifferentApprover');
  });
  it('names the cap refusal and keeps the server wording (it carries the figures)', () => {
    const err = { code: 'SC001', message: 'line A cannot be approved: verified 0, PO 100.000, billed 0, this certificate 40.000' };
    expect(certificateErrorKey(err)).toBe('overCap');
    expect(certificateErrorMessage(err, () => 'generic')).toBe(err.message);
  });
  it('names negative net, unrated, empty, already billed, already certified, period, rate window and ERP refusals', () => {
    expect(certificateErrorKey({ details: 'cert-net-negative' })).toBe('netNegative');
    expect(certificateErrorKey({ details: 'cert-unrated' })).toBe('unrated');
    expect(certificateErrorKey({ details: 'cert-empty' })).toBe('empty');
    expect(certificateErrorKey({ details: 'cert-billed' })).toBe('alreadyBilled');
    expect(certificateErrorKey({ details: 'already-certified' })).toBe('alreadyCertified');
    expect(certificateErrorKey({ message: 'already certified in 2026-03' })).toBe('alreadyCertified');
    expect(certificateErrorKey({ details: 'cert-period-exists' })).toBe('periodExists');
    expect(certificateErrorKey({ code: '23P01', details: 'rate-overlap' })).toBe('rateWindow');
    expect(certificateErrorKey({ details: 'rate-not-month-start' })).toBe('rateMonthStart');
    expect(certificateErrorKey({ details: 'erp-deduction-unsupported' })).toBe('erpDeduction');
    expect(certificateErrorKey({ code: '42501' })).toBe('notAllowed');
  });
  it('translates a named refusal and falls back for an unknown one', () => {
    expect(certificateErrorMessage({ details: 'cert-empty' }, (k) => `t:${k}`)).toBe('t:empty');
    expect(certificateErrorKey(null)).toBe('other');
  });
});
