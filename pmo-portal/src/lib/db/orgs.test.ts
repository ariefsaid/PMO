import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable supabase query-builder mock: `.from('organizations').select('default_currency').limit(1)`
// is awaited directly (thenable), so the builder resolves the queued result.
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as string[], select: [] as unknown[], limit: [] as unknown[], single: [] as unknown[], update: [] as unknown[], eq: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  builder.select = (arg: unknown) => {
    calls.select.push(arg);
    return builder;
  };
  builder.limit = (arg: unknown) => {
    calls.limit.push(arg);
    return builder;
  };
  builder.single = () => {
    calls.single.push(true);
    return builder;
  };
  builder.update = (arg: unknown) => {
    calls.update.push(arg);
    return builder;
  };
  builder.eq = (...args: unknown[]) => {
    calls.eq.push(args);
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

import { getOrgDefaultCurrency, getOrgProjectNumberPattern, getOrgProjectNumberTimezone, setOrgProjectNumberPattern } from './orgs';

describe('getOrgDefaultCurrency — org operating currency for rowless figures (FR-L10N-020, OD-CR-5)', () => {
  beforeEach(() => {
    h.calls.from.length = 0;
    h.calls.select.length = 0;
    h.calls.limit.length = 0;
    h.calls.single.length = 0;
    h.calls.update.length = 0;
    h.calls.eq.length = 0;
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

describe('AC-CODE-001 organization project-number pattern DAL', () => {
  beforeEach(() => {
    h.calls.from.length = 0;
    h.calls.select.length = 0;
    h.calls.limit.length = 0;
    h.calls.single.length = 0;
    h.calls.update.length = 0;
    h.calls.eq.length = 0;
    h.result.value = { data: null, error: null };
  });

  it('reads the RLS-scoped current organization pattern', async () => {
    h.result.value = { data: [{ project_number_pattern: 'PR-{CLIENT}-{YY}-{SEQ4}' }], error: null };
    await expect(getOrgProjectNumberPattern()).resolves.toBe('PR-{CLIENT}-{YY}-{SEQ4}');
    expect(h.calls.from).toEqual(['organizations']);
    expect(h.calls.select).toEqual(['project_number_pattern']);
    expect(h.calls.limit).toEqual([1]);
  });

  it('reads a successful nullable organization timezone through a strict single-row projection', async () => {
    h.result.value = { data: { default_timezone: 'Asia/Jakarta' }, error: null };
    await expect(getOrgProjectNumberTimezone()).resolves.toEqual({ timezone: 'Asia/Jakarta' });
    expect(h.calls.from).toEqual(['organizations']);
    expect(h.calls.select).toEqual(['default_timezone']);
    expect(h.calls.single).toEqual([true]);
    expect(h.calls.limit).toEqual([]);
  });

  it('distinguishes a successfully read null timezone from no row and query failure', async () => {
    h.result.value = { data: { default_timezone: null }, error: null };
    await expect(getOrgProjectNumberTimezone()).resolves.toEqual({ timezone: null });

    h.result.value = { data: null, error: null };
    await expect(getOrgProjectNumberTimezone()).rejects.toThrow('Organisation numbering timezone unavailable');

    h.result.value = { data: null, error: { message: 'read denied', code: '42501' } };
    await expect(getOrgProjectNumberTimezone()).rejects.toMatchObject({ message: 'read denied', code: '42501' });
  });

  it('rejects a malformed timezone projection rather than treating it as UTC', async () => {
    h.result.value = { data: { default_timezone: 7 }, error: null };
    await expect(getOrgProjectNumberTimezone()).rejects.toMatchObject({ code: 'invalid-numbering-timezone' });
  });

  it('updates only the one readable organization row and maps system default to NULL', async () => {
    h.result.value = { data: [{ id: 'org-1' }], error: null };
    await setOrgProjectNumberPattern('PRJ-{YY}-{SEQ4}');
    expect(h.calls.select).toContain('id');
    expect(h.calls.update).toEqual([{ project_number_pattern: null }]);
    expect(h.calls.eq).toEqual([['id', 'org-1']]);
  });
});
