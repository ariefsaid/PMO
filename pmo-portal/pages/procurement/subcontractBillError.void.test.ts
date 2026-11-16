import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { AppError } from '@/src/lib/appError';
import { voidBillErrorText } from './subcontractBillError';

/** Returns the default copy, as i18next does with no catalogue loaded. */
const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

describe('voidBillErrorText (#1671)', () => {
  it.each([
    ['void-own-bill', 'You captured this bill, so another Admin or Finance user must void it.'],
    ['void-author-unknown', 'Nobody is recorded as capturing this bill, so it cannot be voided here.'],
    ['void-erp-bound', 'Your organisation records bills in its ERP. Cancel the bill there.'],
    ['void-erp-record', 'This bill came from an ERP record. Cancel it in the ERP.'],
    ['void-has-payment', 'This bill has a payment. Cancel the payment first.'],
    ['void-payments-exceed', 'Payments on this purchase would be more than its remaining bills. Cancel a payment first.'],
    ['void-already', 'This bill is already voided.'],
  ])('AC-SCV-008 the %s refusal is said in words', (details, words) => {
    expect(voidBillErrorText(new AppError('server text', '42501', details), t)).toBe(words);
  });

  it('AC-SCV-008 any other refusal shows the server message, and an empty one a generic sentence', () => {
    expect(voidBillErrorText(new AppError('not authorized', '42501'), t)).toBe('not authorized');
    expect(voidBillErrorText({}, t)).toBe('The bill could not be voided. Try again.');
  });
});
