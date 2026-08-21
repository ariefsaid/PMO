import { describe, it, expect, vi, beforeEach } from 'vitest';
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as unknown[], select: [] as unknown[], eq: [] as unknown[], update: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => { calls[name].push(args.length === 1 ? args[0] : args); return builder; };
  builder.select = chain('select'); builder.eq = chain('eq'); builder.update = chain('update');
  builder.maybeSingle = () => Promise.resolve(result.value); builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => { calls.from.push(table); return builder; });
  return { from, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
import { getMyLocalePreferences, setMyLocalePreferences } from './preferences';
import { AppError } from '@/src/lib/appError';
beforeEach(() => { h.from.mockClear(); Object.values(h.calls).forEach(c => c.length = 0); h.result.value = { data: [{ id: 'u1' }], error: null }; });
describe('FR-L10N-006 own-preference DAL', () => {
  it('reads only own preference columns', async () => {
    h.result.value = { data: { locale: 'id', number_locale: null, timezone: 'Asia/Jakarta' }, error: null };
    await expect(getMyLocalePreferences('u1')).resolves.toEqual({ locale: 'id', numberLocale: null, timezone: 'Asia/Jakarta' });
    expect(h.calls.from).toEqual(['profiles']); expect(h.calls.select).toEqual(['locale,number_locale,timezone']); // the FILTER is asserted as (column, value), not just the value — a read scoped on the wrong
    // column would still carry 'u1' and pass a value-only assertion.
    expect(h.calls.eq).toEqual([['id', 'u1']]);
  });
  it('AC-L10N-003 reset sends NULL, never an org value', async () => {
    await setMyLocalePreferences('u1', { locale: null, numberLocale: null, timezone: null });
    expect(h.calls.update).toEqual([{ locale: null, number_locale: null, timezone: null }]);
  });
  it('writes explicit values and reports errors', async () => {
    await setMyLocalePreferences('u1', { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    expect(h.calls.update).toEqual([{ locale: 'en', number_locale: 'en-US', timezone: 'UTC' }]);
    h.result.value = { data: null, error: { message: 'JWT', code: '42501' } };
    await expect(getMyLocalePreferences('u1')).rejects.toThrow('JWT');
    await expect(setMyLocalePreferences('u1', { locale: null, numberLocale: null, timezone: null })).rejects.toThrow('JWT');
  });
  it('#534: a using-denied update (0 rows matched, no error) throws 42501 instead of resolving as success', async () => {
    h.result.value = { data: [], error: null };
    await expect(
      setMyLocalePreferences('u1', { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      setMyLocalePreferences('u1', { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }),
    ).rejects.toMatchObject({ code: '42501' });
    expect(h.calls.update.length).toBeGreaterThan(0);
  });
});
