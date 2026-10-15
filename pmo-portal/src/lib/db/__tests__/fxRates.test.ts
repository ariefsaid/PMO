import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const state: { data: unknown; error: unknown } = { data: [], error: null };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'order', 'limit', 'lt', 'in', 'eq', 'single']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(state).then(resolve);
  const rpc = vi.fn(async (_name: string, _args: unknown) => state);
  const from = vi.fn((_table: string) => builder);
  return { calls, state, rpc, from };
});
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: harness.from, rpc: harness.rpc },
}));

import { existingFxRates, fxContext, fxRateOn, listFxRates, upsertFxRates } from '../fxRates';

describe('fxRates DAL', () => {
  beforeEach(() => {
    harness.calls.length = 0;
    harness.state.data = [];
    harness.state.error = null;
    harness.rpc.mockClear();
    harness.from.mockClear();
  });

  it('AC-FX-008 uses bounded descending keyset pages and maps the sentinel row', async () => {
    harness.state.data = Array.from({ length: 51 }, (_, i) => ({
      rate_date: new Date(Date.UTC(2026, 9, 31 - i)).toISOString().slice(0, 10),
    }));
    const page = await listFxRates('2026-09-01');
    expect(harness.from).toHaveBeenCalledWith('fx_rates');
    expect(harness.calls).toContainEqual({
      method: 'order',
      args: ['rate_date', { ascending: false }],
    });
    expect(harness.calls).toContainEqual({ method: 'limit', args: [51] });
    expect(harness.calls).toContainEqual({ method: 'lt', args: ['rate_date', '2026-09-01'] });
    expect(page.rows).toHaveLength(50);
    expect(page.nextCursor).toBe('2026-09-12');
  });

  it('does not request history for an empty preview and scopes date lookups through the RPC', async () => {
    expect(await existingFxRates([])).toEqual([]);
    expect(harness.from).not.toHaveBeenCalled();
    harness.state.data = [{ rate: 16234.56, rate_date: '2026-10-09' }];
    expect(await fxRateOn('USD', 'IDR', '2026-10-10')).toEqual({
      rate: 16234.56,
      rate_date: '2026-10-09',
    });
    expect(harness.rpc).toHaveBeenCalledWith('fx_rate_on', {
      base: 'USD',
      quote: 'IDR',
      on_date: '2026-10-10',
    });
  });

  it('maps no rate to null, propagates DAL errors, and sends only normalized date/rate keys', async () => {
    harness.state.data = [];
    expect(await fxRateOn('USD', 'IDR', '2026-10-01')).toBeNull();
    harness.state.data = null;
    harness.state.error = { code: '42501', message: 'denied' };
    await expect(existingFxRates(['2026-10-09'])).rejects.toMatchObject({ code: '42501' });
    harness.state.error = null;
    harness.state.data = { new: 1, changed: 0, unchanged: 0 };
    await upsertFxRates([{ rate_date: '2026-10-09', rate: 16234.56 }]);
    expect(harness.rpc).toHaveBeenLastCalledWith('upsert_fx_rates', {
      p_rows: [{ rate_date: '2026-10-09', rate: 16234.56 }],
    });
  });

  it('requires the org currency and only defaults an absent timezone to UTC', async () => {
    harness.state.data = { default_currency: 'IDR', default_timezone: null };
    expect(await fxContext()).toEqual({ currency: 'IDR', timezone: 'UTC' });
    harness.state.data = { default_currency: null, default_timezone: null };
    await expect(fxContext()).rejects.toThrow(/currency/i);
  });
});
