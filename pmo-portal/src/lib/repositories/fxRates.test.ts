import { beforeEach, describe, expect, it, vi } from 'vitest';
const dal = vi.hoisted(() => ({
  listFxRates: vi.fn(),
  existingFxRates: vi.fn(),
  fxRateOn: vi.fn(),
  upsertFxRates: vi.fn(),
  fxContext: vi.fn(),
}));
vi.mock('@/src/lib/db/fxRates', () => dal);
import { fxRatesRepository } from './fxRates';

describe('fxRatesRepository', () => {
  beforeEach(() => vi.clearAllMocks());
  it('preserves database error codes at the repository seam', async () => {
    dal.listFxRates.mockRejectedValue({ code: '42501', message: 'forbidden' });
    await expect(fxRatesRepository.list()).rejects.toMatchObject({
      code: '42501',
      message: 'forbidden',
    });
  });
  it('delegates normalized list, existing, lookup, upsert and context contracts', async () => {
    dal.listFxRates.mockResolvedValue({ rows: [], nextCursor: null });
    dal.existingFxRates.mockResolvedValue([]);
    dal.fxRateOn.mockResolvedValue(null);
    dal.upsertFxRates.mockResolvedValue({ new: 1, changed: 0, unchanged: 0 });
    dal.fxContext.mockResolvedValue({ currency: 'IDR', timezone: 'UTC' });
    expect(await fxRatesRepository.list('2026-10-09')).toEqual({ rows: [], nextCursor: null });
    expect(await fxRatesRepository.existing(['2026-10-09'])).toEqual([]);
    expect(await fxRatesRepository.onDate('USD', 'IDR', '2026-10-10')).toBeNull();
    expect(await fxRatesRepository.upsert([{ rate_date: '2026-10-09', rate: 16234 }])).toEqual({
      new: 1,
      changed: 0,
      unchanged: 0,
    });
    expect(await fxRatesRepository.context()).toEqual({ currency: 'IDR', timezone: 'UTC' });
  });
});
