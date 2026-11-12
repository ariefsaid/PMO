import { describe, expect, it } from 'vitest';
import { selectCollectedByMonth } from './useCompanyFigures';
import type { PaidPaymentFact } from '@/src/lib/db/revenue';

const pay = (date: string, amount: number | null, currency = 'USD', status = 'Paid') => ({ date, amount, currency, status }) as unknown as PaidPaymentFact;

describe('selectCollectedByMonth', () => {
  it('sums paid receipts per month in one currency and ignores other currencies and unpaid rows', () => {
    const months = selectCollectedByMonth([pay('2026-06-03', 100), pay('2026-06-20', 50), pay('2026-07-01', 70), pay('2026-07-02', 9, 'IDR'), pay('2026-07-03', 5, 'USD', 'Pending')], 'USD');
    expect(months?.get('2026-06')).toBe(150);
    expect(months?.get('2026-07')).toBe(70);
    expect(months?.size).toBe(2);
  });

  it('is unknown, never a partial sum, when one receipt has no amount; unknown while not loaded', () => {
    expect(selectCollectedByMonth([pay('2026-06-03', 100), pay('2026-06-04', null)], 'USD')).toBeUndefined();
    expect(selectCollectedByMonth(undefined, 'USD')).toBeUndefined();
  });
});
