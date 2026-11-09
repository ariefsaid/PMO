import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc } }));
import { upsertFxRates } from './fxRates';

// #2096: the upsert reply is validated by a hand-rolled guard (it replaced the zod schema so zod
// leaves the first-load chunk). These tests pin that contract exactly: three integer fields,
// each non-negative, no extra keys, database errors preserved.
describe('upsertFxRates reply contract (hand-rolled guard)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the rows payload and passes a valid reply through', async () => {
    rpc.mockResolvedValue({ data: { new: 1, changed: 0, unchanged: 2 }, error: null });
    const rows = [
      { rate_date: '2026-11-01', rate: 16234 },
      { rate_date: '2026-11-02', rate: 16235.5 },
    ];
    await expect(upsertFxRates(rows)).resolves.toEqual({ new: 1, changed: 0, unchanged: 2 });
    expect(rpc).toHaveBeenCalledWith('upsert_fx_rates', {
      p_rows: [
        { rate_date: '2026-11-01', rate: 16234 },
        { rate_date: '2026-11-02', rate: 16235.5 },
      ],
    });
  });

  it('rejects every malformed reply shape', async () => {
    const bad = [
      ['missing key', {}],
      ['null', null],
      ['undefined', undefined],
      ['array', [1, 2, 3]],
      ['string', '1/0/2'],
      ['float count', { new: 1.5, changed: 0, unchanged: 0 }],
      ['negative count', { new: -1, changed: 0, unchanged: 0 }],
      ['string count', { new: '1', changed: 0, unchanged: 0 }],
      ['NaN count', { new: Number.NaN, changed: 0, unchanged: 0 }],
      ['null count', { new: null, changed: 0, unchanged: 0 }],
      ['missing changed', { new: 1, unchanged: 0 }],
      ['extra key', { new: 1, changed: 0, unchanged: 0, extra: 1 }],
    ] as const;
    for (const [label, reply] of bad) {
      rpc.mockResolvedValue({ data: reply, error: null });
      await expect(upsertFxRates([]), label).rejects.toThrow();
    }
  });

  it.each([
    [0, { new: 0, changed: 0, unchanged: 0 }],
    [Number.MAX_SAFE_INTEGER, { new: Number.MAX_SAFE_INTEGER, changed: 0, unchanged: 0 }],
  ])('accepts boundary integer %i', async (_n, reply) => {
    rpc.mockResolvedValue({ data: reply, error: null });
    await expect(upsertFxRates([])).resolves.toEqual(reply);
  });

  it('preserves the database error instead of validating it', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(upsertFxRates([])).rejects.toMatchObject({ code: '42501', message: 'denied' });
  });
});
