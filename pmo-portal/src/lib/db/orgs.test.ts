import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable supabase query-builder mock: `.from('organizations').select('default_currency').limit(1)`
// is awaited directly (thenable), so the builder resolves the queued result.
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as string[], select: [] as unknown[], limit: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  builder.select = (arg: unknown) => {
    calls.select.push(arg);
    return builder;
  };
  builder.limit = (arg: unknown) => {
    calls.limit.push(arg);
    return builder;
  };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { getOrgDefaultCurrency } from './orgs';

describe('getOrgDefaultCurrency — org operating currency for rowless figures (FR-L10N-020, OD-CR-5)', () => {
  beforeEach(() => {
    h.calls.from.length = 0;
    h.calls.select.length = 0;
    h.calls.limit.length = 0;
    h.result.value = { data: null, error: null };
  });

  it('reads organizations.default_currency (SELECT-policy scoped to the caller org under RLS)', async () => {
    h.result.value = { data: [{ default_currency: 'IDR' }], error: null };
    await expect(getOrgDefaultCurrency()).resolves.toBe('IDR');
    expect(h.calls.from).toEqual(['organizations']);
    expect(h.calls.select).toEqual(['default_currency']);
    expect(h.calls.limit).toEqual([1]);
  });

  it('falls back to USD (0187 column default posture) when no org row is visible', async () => {
    h.result.value = { data: [], error: null };
    await expect(getOrgDefaultCurrency()).resolves.toBe('USD');
  });

  it('throws on a query error rather than silently formatting in a wrong currency', async () => {
    h.result.value = { data: null, error: { message: 'rls denied' } };
    await expect(getOrgDefaultCurrency()).rejects.toThrow('rls denied');
  });
});
