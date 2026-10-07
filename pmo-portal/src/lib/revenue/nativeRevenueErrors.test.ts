import { describe, it, expect } from 'vitest';
import { AppError } from '@/src/lib/appError';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { NATIVE_REVENUE_REFUSALS } from '@/src/lib/db/revenueNative';
import { nativeRevenueHeadlines } from './nativeRevenueErrors';

const t = (_key: string, fallback: string) => fallback;

describe('nativeRevenueHeadlines (#784) — every server refusal code reads as a plain headline', () => {
  it('#784 each refusal code has its own headline; the server sentence stays the detail', () => {
    const headlines = nativeRevenueHeadlines(t);
    for (const code of NATIVE_REVENUE_REFUSALS) {
      const { headline, detail } = classifyMutationError(new AppError('the server sentence', code), headlines, { suppressCapture: true });
      expect(headline).not.toBe('Update failed');
      expect(detail).toBe('the server sentence');
    }
  });
  it('#784 I-2 a VAT project with no rate says so', () => {
    expect(classifyMutationError(new AppError('x', 'vat-rate-missing'), nativeRevenueHeadlines(t), { suppressCapture: true }).headline)
      .toBe('This project has no VAT rate recorded');
  });
  it('#784 the headline is keyed on the code, never the message text', () => {
    expect(classifyMutationError(new AppError('the payment date cannot be in the future', '23514'), nativeRevenueHeadlines(t), { suppressCapture: true }).headline)
      .not.toBe('The payment date cannot be in the future.');
    expect(classifyMutationError(new AppError('anything', 'payment-date-future'), nativeRevenueHeadlines(t), { suppressCapture: true }).headline)
      .toBe('The payment date cannot be in the future.');
  });
});
